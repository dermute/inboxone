"""One running pass and one merged follow-up scope per account, across all callers."""

import asyncio
import logging

from app.core import activity
from app.sync import live
from app.sync.worker import sync_account

running: dict[int, asyncio.Task] = {}
pending: dict[int, tuple[set[int] | None, bool]] = {}
retired: set[asyncio.Task] = set()
pending_activity: dict[int, str] = {}


def request_sync(
    account_id: int, folder_ids: set[int] | None = None, discover: bool = True
) -> asyncio.Task:
    if account_id in pending:
        previous, discovery = pending[account_id]
        folder_ids = None if previous is None or folder_ids is None else previous | folder_ids
        discover = discover or discovery
    metadata = {
        "folder_ids": sorted(folder_ids) if folder_ids is not None else None,
        "folder_id": next(iter(folder_ids)) if folder_ids and len(folder_ids) == 1 else None,
    }
    if account_id in pending_activity:
        activity.update(pending_activity[account_id], **metadata)
    else:
        pending_activity[account_id] = activity.begin(
            "Refreshing account…",
            kind="sync",
            state="queued",
            account_id=account_id,
            folder_ids=folder_ids,
            folder_id=metadata["folder_id"],
        )
    pending[account_id] = (folder_ids, discover)
    if account_id not in running:
        running[account_id] = asyncio.create_task(_drain(account_id))
    return running[account_id]


async def _drain(account_id: int) -> None:
    try:
        while account_id in pending:
            folders, discover = pending.pop(account_id)
            activity_id = pending_activity.pop(account_id)
            try:
                with activity.use(activity_id):
                    await sync_account(account_id, folders, discover)
            except Exception as exc:
                logging.getLogger(__name__).exception(
                    "Sync request failed for account %s", account_id
                )
                live.sync_failed(account_id, None, exc)
            finally:
                activity.finish(activity_id)
    finally:
        if running.get(account_id) is asyncio.current_task():
            running.pop(account_id, None)


def cancel_account(account_id: int) -> None:
    pending.pop(account_id, None)
    if activity_id := pending_activity.pop(account_id, None):
        activity.finish(activity_id)
    if task := running.pop(account_id, None):
        retired.add(task)
        task.add_done_callback(retired.discard)
        task.cancel()
