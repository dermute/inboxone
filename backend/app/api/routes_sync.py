import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import activity
from app.core.security import require_session
from app.db.models import Account
from app.db.session import get_db
from app.sync.worker import sync_account

router = APIRouter(prefix="/api/sync", tags=["sync"], dependencies=[Depends(require_session)])


@router.get("/activity")
async def get_activity() -> dict:
    return {"items": activity.snapshot()}


# asyncio only keeps weak references to running tasks, so a fire-and-forget sync can
# be garbage-collected mid-flight unless something holds on to it.
_background_syncs: set[asyncio.Task] = set()


def _spawn_sync(account_id: int) -> None:
    task = asyncio.create_task(sync_account(account_id))
    _background_syncs.add(task)
    task.add_done_callback(_background_syncs.discard)


@router.post("/trigger")
async def trigger_sync(account_id: int | None = None, db: AsyncSession = Depends(get_db)) -> dict:
    # Returns as soon as the syncs are queued rather than awaiting them: a full sync
    # across several accounts can take minutes, far longer than a browser or reverse
    # proxy will hold a request open. Callers watch /api/sync/activity for progress.
    # Concurrency stays bounded by the sync worker's own semaphore, and each account's
    # failures are recorded against that account instead of surfacing here.
    if account_id is not None:
        _spawn_sync(account_id)
        return {"triggered": [account_id]}

    result = await db.execute(select(Account.id).where(Account.is_active.is_(True)))
    ids = [row[0] for row in result.all()]
    for aid in ids:
        _spawn_sync(aid)
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
