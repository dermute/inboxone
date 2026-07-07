from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import Account
from app.db.session import async_session_factory
from app.sync.worker import sync_account

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()

TOKEN_REFRESH_JOB_ID = "refresh-oauth-tokens"


def _job_id(account_id: int) -> str:
    return f"sync-account-{account_id}"


def schedule_account_sync(account_id: int, interval_seconds: int | None = None) -> None:
    settings = get_settings()
    interval = max(interval_seconds or settings.sync_default_interval_seconds, settings.sync_min_interval_seconds)
    _scheduler.add_job(
        sync_account,
        "interval",
        seconds=interval,
        args=[account_id],
        id=_job_id(account_id),
        replace_existing=True,
        max_instances=1,
    )


def unschedule_account_sync(account_id: int) -> None:
    job_id = _job_id(account_id)
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


async def _refresh_all_oauth_tokens() -> None:
    from app.db.models import Protocol
    from app.services.account_connection import get_graph_token, open_imap_connection

    async with async_session_factory() as db:
        result = await db.execute(
            select(Account).where(Account.protocol == Protocol.OAUTH_MICROSOFT.value)
        )
        for account in result.scalars().all():
            try:
                client = await open_imap_connection(db, account)
                await _safe_logout(client)
                await get_graph_token(db, account)
            except Exception:  # noqa: BLE001 - one bad account must not block others
                logger.exception("Failed refreshing OAuth token for account %s", account.id)


async def _safe_logout(client) -> None:
    import asyncio

    await asyncio.to_thread(client.logout)


async def start_scheduler() -> None:
    async with async_session_factory() as db:
        result = await db.execute(select(Account).where(Account.is_active.is_(True)))
        for account in result.scalars().all():
            schedule_account_sync(account.id, account.sync_interval_seconds)

    _scheduler.add_job(
        _refresh_all_oauth_tokens,
        "interval",
        minutes=10,
        id=TOKEN_REFRESH_JOB_ID,
        replace_existing=True,
    )
    _scheduler.start()


async def stop_scheduler() -> None:
    _scheduler.shutdown(wait=False)
