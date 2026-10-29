import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core import activity
from app.core.security import require_session
from app.db.models import Account, Folder
from app.db.session import DBSession
from app.sync import live
from app.sync.requests import request_sync

router = APIRouter(prefix="/api/sync", tags=["sync"], dependencies=[Depends(require_session)])


@router.get("/activity")
async def get_activity() -> dict:
    return {"items": activity.snapshot()}


class Presence(BaseModel):
    client_id: str = Field(min_length=1, max_length=128)
    visible: bool


@router.post("/presence")
async def set_presence(payload: Presence) -> dict:
    live.presence(payload.client_id, payload.visible)
    return {"ok": True}


@router.get("/connections")
async def connections() -> dict:
    return await live.snapshot()


@router.get("/events")
async def events(request: Request):
    async def stream():
        queue: asyncio.Queue = asyncio.Queue(maxsize=64)
        live.subscribers.add(queue)
        try:
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "snapshot",
                        "status": await live.snapshot(),
                        "items": activity.snapshot(),
                    }
                )
                + "\n\n"
            )
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), 15)
                    if event["type"] == "snapshot":
                        event["status"] = await live.snapshot()
                        event["items"] = activity.snapshot()
                    yield "data: " + json.dumps(event) + "\n\n"
                except TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            live.subscribers.discard(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/trigger")
async def trigger_sync(
    db: DBSession, account_id: int | None = None, folder_id: int | None = None
) -> dict:
    if folder_id is not None:
        folder = await db.get(Folder, folder_id)
        if folder is None:
            raise HTTPException(404, "Folder not found")
        if account_id is not None and account_id != folder.account_id:
            raise HTTPException(400, "Folder does not belong to account")
        account_id = folder.account_id
    query = select(Account.id).where(Account.is_active.is_(True))
    if account_id is not None:
        query = query.where(Account.id == account_id)
    ids = list((await db.scalars(query)).all())
    for aid in ids:
        request_sync(aid, {folder_id} if folder_id is not None else None, folder_id is None)
    return {"triggered": ids}


@router.post("/retry")
async def retry(db: DBSession, account_id: int) -> dict:
    from app.sync.scheduler import schedule_account_sync

    active = await db.scalar(
        select(Account.id).where(Account.id == account_id, Account.is_active.is_(True))
    )
    if active is None:
        raise HTTPException(404, "Active account not found")
    schedule_account_sync(account_id)
    # Queue catch-up immediately, including while the old connection shuts down.
    request_sync(account_id)
    return {"triggered": [account_id]}


@router.get("/status")
async def sync_status(db: DBSession) -> list[dict]:
    # Select only plain columns - this view never needs credentials, and loading
    # full Account rows would decrypt them just to discard the values, needlessly
    # failing the whole endpoint if any one account's stored secret is undecryptable.
    result = await db.execute(
        select(
            Account.id,
            Account.name,
            Account.last_sync_at,
            Account.last_sync_status,
            Account.last_sync_error,
        )
    )
    return [
        {
            "account_id": row.id,
            "name": row.name,
            "last_sync_at": row.last_sync_at,
            "last_sync_status": row.last_sync_status,
            "last_sync_error": "Mail synchronization failed. Retry or check account settings."
            if row.last_sync_error
            else None,
        }
        for row in result.all()
    ]
