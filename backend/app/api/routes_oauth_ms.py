from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_session
from app.db.models import Account, Folder, Protocol
from app.db.session import get_db
from app.schemas.oauth import (
    MicrosoftOAuthPollResponse,
    MicrosoftOAuthStart,
    MicrosoftOAuthStartResponse,
)
from app.services import oauth_microsoft

router = APIRouter(
    prefix="/api/accounts/oauth/microsoft", tags=["oauth"], dependencies=[Depends(require_session)]
)

# flow_id -> pending metadata not yet known to MSAL: either a new account's name/color
# ("create" mode) or the existing account being re-authenticated ("reconnect" mode).
_pending_metadata: dict[str, dict] = {}


@router.post("/start", response_model=MicrosoftOAuthStartResponse)
async def start(payload: MicrosoftOAuthStart) -> MicrosoftOAuthStartResponse:
    client_id = payload.client_id or oauth_microsoft.DEFAULT_CLIENT_ID
    result = await oauth_microsoft.start_device_flow(client_id, payload.tenant)
    _pending_metadata[result["flow_id"]] = {
        "mode": "create",
        "name": payload.name,
        "color": payload.color,
        "client_id": client_id,
        "tenant": payload.tenant,
    }
    return MicrosoftOAuthStartResponse(**result)


@router.post("/reconnect/{account_id}", response_model=MicrosoftOAuthStartResponse)
async def reconnect(account_id: int, db: AsyncSession = Depends(get_db)) -> MicrosoftOAuthStartResponse:
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.protocol != Protocol.OAUTH_MICROSOFT.value:
        raise HTTPException(status_code=400, detail="Not an Outlook/Microsoft 365 account")

    flow = await oauth_microsoft.start_device_flow(account.oauth_client_id, account.oauth_tenant or "common")
    _pending_metadata[flow["flow_id"]] = {"mode": "reconnect", "account_id": account_id}
    return MicrosoftOAuthStartResponse(**flow)


@router.get("/poll/{flow_id}", response_model=MicrosoftOAuthPollResponse)
async def poll(flow_id: str, db: AsyncSession = Depends(get_db)) -> MicrosoftOAuthPollResponse:
    result = oauth_microsoft.poll_device_flow(flow_id)

    if result["status"] != "complete":
        return MicrosoftOAuthPollResponse(status=result["status"], error=result.get("error"))

    meta = _pending_metadata.pop(flow_id, None)
    if meta is None:
        raise HTTPException(status_code=400, detail="Unknown or already-consumed flow id")

    from app.sync.scheduler import schedule_account_sync

    if meta["mode"] == "reconnect":
        account_result = await db.execute(select(Account).where(Account.id == meta["account_id"]))
        account = account_result.scalar_one_or_none()
        if account is None:
            raise HTTPException(status_code=404, detail="Account not found")
        account.oauth_token_cache_enc = result["token_cache"]
        if result.get("username"):
            account.imap_username = result["username"]
        account.last_sync_status = None
        account.last_sync_error = None
        await db.commit()
        schedule_account_sync(account.id)
        return MicrosoftOAuthPollResponse(status="complete", account_id=account.id)

    account = Account(
        name=meta["name"],
        color=meta["color"],
        protocol=Protocol.OAUTH_MICROSOFT.value,
        imap_host="outlook.office365.com",
        imap_port=993,
        imap_use_tls=True,
        imap_username=result.get("username"),
        oauth_client_id=meta["client_id"],
        oauth_tenant=meta["tenant"],
        oauth_token_cache_enc=result["token_cache"],
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)

    db.add(Folder(account_id=account.id, imap_path="INBOX", display_name="Inbox"))
    await db.commit()

    schedule_account_sync(account.id)

    return MicrosoftOAuthPollResponse(status="complete", account_id=account.id)
