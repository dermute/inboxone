from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import activity
from app.core.config import get_settings
from app.db.models import Account, Folder, Message
from app.db.session import async_session_factory
from app.services import imap_client
from app.services.account_connection import open_imap_connection
from app.services.mail_parser import parse_header_block

logger = logging.getLogger(__name__)
_sync_semaphore = asyncio.Semaphore(get_settings().max_concurrent_syncs)
# Manual triggers and scheduler jobs share the same account lock.
_account_locks: dict[int, asyncio.Lock] = {}
SYNC_BATCH_SIZE = 200


async def _discover_folders(client, db: AsyncSession, account: Account) -> list[int]:
    # Never remove local data unless LIST completed successfully.
    paths = set(await asyncio.to_thread(imap_client.list_folders, client))
    existing = {folder.imap_path: folder for folder in account.folders}
    folders = []
    for path in sorted(paths):
        folder = existing.get(path)
        if folder is None:
            folder = Folder(
                account_id=account.id,
                imap_path=path,
                display_name="Inbox" if path.lower() == "inbox" else path,
                is_inbox=path.lower() == "inbox",
            )
            db.add(folder)
        folders.append(folder)
    for path, folder in existing.items():
        if path not in paths:
            await db.delete(folder)
    await db.commit()
    return [folder.id for folder in folders]


async def _sync_folder(client, db: AsyncSession, account: Account, folder: Folder) -> None:
    validity = await asyncio.to_thread(
        imap_client.select_folder_uidvalidity, client, folder.imap_path
    )
    if folder.last_uidvalidity != validity:
        await db.execute(delete(Message).where(Message.folder_id == folder.id))
        folder.last_seen_uid = 0
        folder.history_complete = False
    folder.last_uidvalidity = validity
    await db.commit()

    # A UID snapshot bounds this pass even if mail arrives during the backfill.
    remote_uids = await asyncio.to_thread(imap_client.list_uids, client, folder.imap_path)
    new_uids = [uid for uid in remote_uids if uid > folder.last_seen_uid]
    for offset in range(0, len(new_uids), SYNC_BATCH_SIZE):
        batch = new_uids[offset : offset + SYNC_BATCH_SIZE]
        headers = await asyncio.to_thread(
            imap_client.fetch_headers, client, folder.imap_path, batch
        )
        cached = set(
            (
                await db.scalars(
                    select(Message.uid).where(
                        Message.folder_id == folder.id, Message.uid.in_(batch)
                    )
                )
            ).all()
        )
        for header in headers:
            if header.uid in cached:
                continue
            parsed = parse_header_block(header.header_bytes)
            # Date headers can be absent; INTERNALDATE gives stable pagination.
            parsed["date_sent"] = parsed["date_sent"] or header.internaldate
            db.add(
                Message(
                    account_id=account.id,
                    folder_id=folder.id,
                    uid=header.uid,
                    uidvalidity=validity,
                    size_bytes=header.size,
                    notification_eligible=folder.history_complete,
                    has_attachments=b"multipart/mixed" in header.header_bytes.lower(),
                    is_seen=b"\\Seen" in header.flags,
                    is_flagged=b"\\Flagged" in header.flags,
                    is_answered=b"\\Answered" in header.flags,
                    **parsed,
                )
            )
        folder.last_seen_uid = batch[-1]
        # Progress and messages commit atomically; a failed batch is safe to replay.
        await db.commit()

    # Walk cached messages in bounded batches to reconcile all flags and expunges.
    # Fetch only UIDs from the successful SEARCH snapshot; missing FETCH responses
    # represent messages expunged between SEARCH and FETCH.
    remote_set = set(remote_uids)
    after_uid = 0
    while True:
        messages = list(
            (
                await db.scalars(
                    select(Message)
                    .where(Message.folder_id == folder.id, Message.uid > after_uid)
                    .order_by(Message.uid)
                    .limit(SYNC_BATCH_SIZE)
                )
            ).all()
        )
        if not messages:
            break
        present = [msg.uid for msg in messages if msg.uid in remote_set]
        flags = await asyncio.to_thread(imap_client.fetch_flags, client, folder.imap_path, present)
        after_uid = messages[-1].uid
        for msg in messages:
            if msg.uid not in flags:
                await db.delete(msg)
            else:
                msg.is_seen = b"\\Seen" in flags[msg.uid]
                msg.is_flagged = b"\\Flagged" in flags[msg.uid]
                msg.is_answered = b"\\Answered" in flags[msg.uid]
        await db.commit()
    folder.history_complete = True
    folder.last_synced_at = datetime.now(UTC)
    await db.commit()


async def sync_account(account_id: int) -> None:
    lock = _account_locks.setdefault(account_id, asyncio.Lock())
    async with lock, _sync_semaphore, async_session_factory() as db:
        errors = []
        client = None
        account = None
        try:
            account = await db.scalar(
                select(Account)
                .where(Account.id == account_id, Account.is_active.is_(True))
                .options(selectinload(Account.folders))
            )
            if account is None:
                return
            with activity.track(f"Syncing {account.name}..."):
                client = await open_imap_connection(db, account)
                folder_ids = await _discover_folders(client, db, account)
                for folder_id in folder_ids:
                    folder = await db.get(Folder, folder_id)
                    if folder is None:
                        continue
                    path = folder.imap_path
                    try:
                        with activity.track(f"Syncing {path}..."):
                            await _sync_folder(client, db, account, folder)
                    except Exception as exc:
                        logger.exception("Sync failed for account %s folder %s", account_id, path)
                        errors.append(f"{path}: {exc}")
                        await db.rollback()
                        # Rollback expires ORM state, including the account credentials.
                        await db.refresh(account)
        except Exception as exc:
            logger.exception("Sync failed for account %s", account_id)
            errors.append(str(exc))
            await db.rollback()
        finally:
            if client is not None:
                try:
                    await asyncio.to_thread(client.logout)
                except Exception:
                    logger.exception("Logout failed for account %s", account_id)
            if account is not None or errors:
                await db.execute(
                    update(Account)
                    .where(Account.id == account_id)
                    .values(
                        last_sync_status="error" if errors else "ok",
                        last_sync_error="; ".join(errors) if errors else None,
                        last_sync_at=datetime.now(UTC),
                    )
                )
                await db.commit()
