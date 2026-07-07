from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_session
from app.db.models import Account
from app.db.session import get_db
from app.sync.worker import sync_account

router = APIRouter(prefix="/api/sync", tags=["sync"], dependencies=[Depends(require_session)])


@router.post("/trigger")
async def trigger_sync(account_id: int | None = None, db: AsyncSession = Depends(get_db)) -> dict:
    if account_id is not None:
        await sync_account(account_id)
        return {"triggered": [account_id]}

    result = await db.execute(select(Account.id).where(Account.is_active.is_(True)))
    ids = [row[0] for row in result.all()]
    for aid in ids:
        await sync_account(aid)
    return {"triggered": ids}


@router.get("/status")
async def sync_status(db: AsyncSession = Depends(get_db)) -> list[dict]:
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
            "last_sync_error": row.last_sync_error,
        }
        for row in result.all()
    ]
