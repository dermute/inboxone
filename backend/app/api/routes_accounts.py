from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only, selectinload

from app.core.security import require_session
from app.db.models import Account, Folder, Protocol
from app.db.session import get_db
from app.schemas.account import (
    AccountCreateBasic,
    AccountOut,
    AccountUpdateBasic,
    FolderListUpdate,
    FolderOut,
    TestConnectionResult,
)
from app.services import imap_client, smtp_client
from app.services.account_connection import open_imap_connection

router = APIRouter(
    prefix="/api/accounts", tags=["accounts"], dependencies=[Depends(require_session)]
)


async def _get_account_or_404(db: AsyncSession, account_id: int) -> Account:
    result = await db.execute(
        select(Account).where(Account.id == account_id).options(selectinload(Account.folders))
    )
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def _sync_scheduler_upsert(account_id: int) -> None:
    from app.sync.scheduler import schedule_account_sync

    schedule_account_sync(account_id)


def _sync_scheduler_remove(account_id: int) -> None:
    from app.sync.scheduler import unschedule_account_sync

    unschedule_account_sync(account_id)


_ACCOUNT_LIST_COLUMNS = (
    Account.id,
    Account.name,
    Account.color,
    Account.protocol,
    Account.is_active,
    Account.imap_host,
    Account.imap_port,
    Account.imap_username,
    Account.smtp_host,
    Account.smtp_port,
    Account.smtp_username,
    Account.oauth_client_id,
    Account.oauth_tenant,
    Account.sync_interval_seconds,
    Account.last_sync_at,
    Account.last_sync_status,
    Account.last_sync_error,
)


@router.get("", response_model=list[AccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db)) -> list[Account]:
    # load_only deliberately excludes the encrypted credential/token columns - none
    # of them are in AccountOut anyway, and loading (and thus decrypting) them here
    # would let one account with an undecryptable secret break the whole listing.
    result = await db.execute(
        select(Account)
        .options(load_only(*_ACCOUNT_LIST_COLUMNS), selectinload(Account.folders))
    )
    return list(result.scalars().all())


@router.post("", response_model=AccountOut)
async def create_account(
    payload: AccountCreateBasic, db: AsyncSession = Depends(get_db)
) -> Account:
    account = Account(
        name=payload.name,
        color=payload.color,
        protocol=Protocol.IMAP_BASIC.value,
        imap_host=payload.imap_host,
        imap_port=payload.imap_port,
        imap_use_tls=payload.imap_use_tls,
        imap_username=payload.imap_username,
        imap_password_enc=payload.imap_password,
        smtp_host=payload.smtp_host,
        smtp_port=payload.smtp_port,
        smtp_use_tls=payload.smtp_use_tls,
        smtp_username=payload.smtp_username,
        smtp_password_enc=payload.smtp_password,
        sync_interval_seconds=payload.sync_interval_seconds,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account, attribute_names=["folders"])

    # Default to syncing INBOX until the user picks specific folders.
    inbox = Folder(account_id=account.id, imap_path="INBOX", display_name="Inbox")
    db.add(inbox)
    await db.commit()
    await db.refresh(account, attribute_names=["folders"])

    _sync_scheduler_upsert(account.id)
    return account


@router.put("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: int, payload: AccountUpdateBasic, db: AsyncSession = Depends(get_db)
) -> Account:
    account = await _get_account_or_404(db, account_id)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "imap_password":
            account.imap_password_enc = value
        elif key == "smtp_password":
            account.smtp_password_enc = value
        else:
            setattr(account, key, value)
    await db.commit()
    await db.refresh(account, attribute_names=["folders"])
    _sync_scheduler_upsert(account.id)
    return account


@router.delete("/{account_id}")
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    # Deliberately a raw delete-by-id rather than loading the account first: it must
    # be possible to remove an account even if its stored credentials can no longer
    # be decrypted. Folders/messages are cleaned up by the DB's ON DELETE CASCADE
    # (SQLite foreign key enforcement is turned on in db/session.py).
    result = await db.execute(delete(Account).where(Account.id == account_id))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Account not found")
    _sync_scheduler_remove(account_id)
    return {"ok": True}


@router.post("/{account_id}/test-connection", response_model=TestConnectionResult)
async def test_connection(account_id: int, db: AsyncSession = Depends(get_db)) -> TestConnectionResult:
    account = await _get_account_or_404(db, account_id)

    imap_ok, imap_error = True, None
    try:
        client = await open_imap_connection(db, account)
        client.logout()
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller, not swallowed silently
        imap_ok, imap_error = False, str(exc)

    if account.protocol != Protocol.IMAP_BASIC.value:
        return TestConnectionResult(imap_ok=imap_ok, imap_error=imap_error)

    smtp_ok, smtp_error = True, None
    try:
        await smtp_client.test_smtp_connection(
            host=account.smtp_host,
            port=account.smtp_port,
            use_tls=account.smtp_use_tls,
            username=account.smtp_username,
            password=account.smtp_password_enc,
        )
    except Exception as exc:  # noqa: BLE001
        smtp_ok, smtp_error = False, str(exc)

    return TestConnectionResult(
        imap_ok=imap_ok, imap_error=imap_error, smtp_ok=smtp_ok, smtp_error=smtp_error
    )


@router.get("/{account_id}/folders", response_model=list[FolderOut])
async def list_account_folders(account_id: int, db: AsyncSession = Depends(get_db)) -> list[Folder]:
    account = await _get_account_or_404(db, account_id)
    client = await open_imap_connection(db, account)
    try:
        import asyncio

        remote_paths = await asyncio.to_thread(imap_client.list_folders, client)
    finally:
        client.logout()

    existing = {f.imap_path: f for f in account.folders}
    changed = False
    for path in remote_paths:
        if path not in existing:
            db.add(Folder(account_id=account.id, imap_path=path, display_name=path, sync_enabled=False))
            changed = True
    if changed:
        await db.commit()
        await db.refresh(account, attribute_names=["folders"])
    return account.folders


@router.put("/{account_id}/folders", response_model=list[FolderOut])
async def update_account_folders(
    account_id: int, payload: FolderListUpdate, db: AsyncSession = Depends(get_db)
) -> list[Folder]:
    account = await _get_account_or_404(db, account_id)
    existing = {f.imap_path: f for f in account.folders}
    for selection in payload.folders:
        folder = existing.get(selection.imap_path)
        if folder is None:
            folder = Folder(account_id=account.id, imap_path=selection.imap_path)
            db.add(folder)
        folder.sync_enabled = selection.sync_enabled
        if selection.display_name:
            folder.display_name = selection.display_name
    await db.commit()
    await db.refresh(account, attribute_names=["folders"])
    return account.folders
