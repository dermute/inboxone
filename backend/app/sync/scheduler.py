"""Single-process IDLE supervision and configurable reconciliation policy."""

from __future__ import annotations

import asyncio
import logging
import random
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from functools import partial

from sqlalchemy import select

from app.db.models import Account, Folder
from app.db.session import async_session_factory
from app.services.account_connection import open_imap_connection
from app.services.app_settings import get_sync_interval
from app.sync import live, requests
from app.sync.worker import _account_locks

logger = logging.getLogger(__name__)
_tasks: dict[int, asyncio.Task] = {}
_clients: dict[int, object] = {}
_accounts: dict[int, int] = {}
_background: set[asyncio.Task] = set()
_loop_task: asyncio.Task | None = None
_last_full: dict[int, float] = {}
_last_inbox: dict[int, float] = {}
_wake = asyncio.Event()
_started = False
_token_refresh: asyncio.Task | None = None
IDLE_RENEW_SECONDS = 600
IDLE_CHECK_SECONDS = 15
BACKOFF_INITIAL = 5
BACKOFF_MAX = 300
_ANY_CLIENT = object()


def _close(folder_id: int, expected=_ANY_CLIENT) -> None:
    if expected is not _ANY_CLIENT and _clients.get(folder_id) is not expected:
        return
    client = _clients.pop(folder_id, None)
    if client is not None:
        try:
            # Interrupt the blocking socket read before cancelling the async task.
            client.socket().shutdown(socket.SHUT_RDWR)
        except AttributeError:
            client.shutdown()
        except Exception:
            logger.debug("IDLE socket already closed", exc_info=True)


def _stop_folder(folder_id: int) -> None:
    _close(folder_id)
    if task := _tasks.pop(folder_id, None):
        task.cancel()
        _background.add(task)
        task.add_done_callback(_background.discard)
    _accounts.pop(folder_id, None)
    live.watchers.pop(folder_id, None)


def schedule_account_sync(account_id: int, interval_seconds: int | None = None) -> None:
    # The legacy per-account interval is ignored; use the global setting.
    if not _started:
        return
    unschedule_account_sync(account_id)
    _last_full.pop(account_id, None)
    _wake.set()


def unschedule_account_sync(account_id: int) -> None:
    for folder_id, aid in list(_accounts.items()):
        if aid == account_id:
            _stop_folder(folder_id)
    requests.cancel_account(account_id)
    live.account_errors.pop(account_id, None)
    _last_full.pop(account_id, None)
    live.publish("connection", account_id=account_id)
    _wake.set()


async def _watch(account_id: int, folder_id: int, path: str) -> None:
    # Each persistent socket gets a dedicated executor: IDLE never occupies the
    # default executor used by message reads, sends, and reconciliation.
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"idle-{folder_id}")
    loop = asyncio.get_running_loop()

    async def call(fn, *args):
        return await loop.run_in_executor(executor, partial(fn, *args))

    backoff = BACKOFF_INITIAL
    try:
        while True:
            client = None
            try:
                live.set_watcher(
                    folder_id,
                    account_id=account_id,
                    state="connecting",
                    mode="polling",
                    next_retry=None,
                )
                async with (
                    _account_locks.setdefault(account_id, asyncio.Lock()),
                    async_session_factory() as db,
                ):
                    account = await db.scalar(
                        select(Account).where(Account.id == account_id, Account.is_active.is_(True))
                    )
                    if account is None:
                        return
                    # Cancellation must not orphan a connection created in a thread.
                    opening = asyncio.create_task(open_imap_connection(db, account))
                    try:
                        client = await asyncio.shield(opening)
                    except asyncio.CancelledError:
                        client = await opening
                        raise
                _clients[folder_id] = client
                await call(client.select_folder, path, True)
                if not await call(client.has_capability, "IDLE"):
                    live.set_watcher(
                        folder_id,
                        state="polling",
                        mode="polling",
                        error=None,
                        next_retry=(datetime.now(UTC) + timedelta(minutes=15)).isoformat(),
                    )
                    await call(client.logout)
                    _clients.pop(folder_id, None)
                    client = None
                    await asyncio.sleep(900)
                    continue
                # Subscribe before catch-up to avoid a gap between SEARCH and IDLE.
                await call(client.idle)
                live.set_watcher(
                    folder_id,
                    state="reconciling",
                    mode="idle",
                    error=None,
                    error_at=None,
                    next_retry=None,
                )
                requests.request_sync(account_id, {folder_id}, False)
                backoff = BACKOFF_INITIAL
                renewed = time.monotonic()
                while True:
                    responses = await call(client.idle_check, IDLE_CHECK_SECONDS)
                    if any(response and response[0] == b"BYE" for response in responses):
                        raise ConnectionError("Server closed IDLE")
                    if responses or time.monotonic() - renewed >= IDLE_RENEW_SECONDS:
                        await call(client.idle_done)
                        # Resume immediately; repeated events merge into a single pass.
                        await call(client.idle)
                        if responses:
                            requests.request_sync(account_id, {folder_id}, False)
                        renewed = time.monotonic()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - supervise all provider failures
                logger.warning(
                    "IDLE failed for account %s folder %s (%s)",
                    account_id,
                    folder_id,
                    type(exc).__name__,
                )
                delay = min(BACKOFF_MAX, backoff * random.uniform(1, 1.2))
                backoff = min(BACKOFF_MAX, backoff * 2)
                error = live.safe_error(exc)
                terminal = "Authentication" in error or "configuration" in error
                live.set_watcher(
                    folder_id,
                    state="error" if terminal else "reconnecting",
                    mode="polling",
                    error=error,
                    error_at=live.now(),
                    next_retry=(datetime.now(UTC) + timedelta(seconds=delay)).isoformat(),
                )
                _close(folder_id, client)
                await asyncio.sleep(delay)
            finally:
                if client is not None:
                    _close(folder_id, client)
                    try:
                        await call(client.shutdown)
                    except Exception:
                        logger.debug("IDLE connection already closed", exc_info=True)
    finally:
        # Socket interruption makes the pending idle_check return before joining.
        _close(folder_id, client)
        await asyncio.to_thread(executor.shutdown, wait=True, cancel_futures=True)


async def _tick() -> None:
    if requests.retired:
        await asyncio.gather(*requests.retired, return_exceptions=True)
    async with async_session_factory() as db:
        interval = await get_sync_interval(db)
        active = set(
            (await db.scalars(select(Account.id).where(Account.is_active.is_(True)))).all()
        )
        folders = (
            await db.execute(
                select(Folder.id, Folder.account_id, Folder.imap_path, Folder.is_inbox).where(
                    Folder.account_id.in_(active)
                )
            )
        ).all()
    folder_ids = {f.id for f in folders}
    for folder_id in set(live.watchers) - folder_ids:
        live.watchers.pop(folder_id, None)
    for account_id in set(live.account_errors) - active:
        live.account_errors.pop(account_id, None)
    desired = {f.id: f for f in folders if f.is_inbox}
    for folder_id in list(_tasks):
        if folder_id not in desired or _tasks[folder_id].done():
            _stop_folder(folder_id)
    for account_id in set(_last_full) - active:
        unschedule_account_sync(account_id)
    for folder_id, folder in desired.items():
        if folder_id not in _tasks:
            _accounts[folder_id] = folder.account_id
            live.set_watcher(
                folder_id, account_id=folder.account_id, state="connecting", mode="idle"
            )
            _tasks[folder_id] = asyncio.create_task(
                _watch(folder.account_id, folder_id, folder.imap_path)
            )
    current = time.monotonic()
    for account_id in active:
        if account_id not in _last_full:
            requests.request_sync(account_id)
            _last_full[account_id] = current
            for folder in folders:
                if folder.account_id == account_id and folder.is_inbox:
                    _last_inbox[folder.id] = current
        elif current - _last_full[account_id] >= interval:
            scope = {f.id for f in folders if f.account_id == account_id and not f.is_inbox}
            requests.request_sync(account_id, scope, True)
            _last_full[account_id] = current
        for folder in folders:
            if folder.account_id != account_id or not folder.is_inbox:
                continue
            if current - _last_inbox.get(folder.id, 0) >= interval:
                requests.request_sync(account_id, {folder.id}, False)
                _last_inbox[folder.id] = current
    for folder_id in set(_last_inbox) - set(desired):
        _last_inbox.pop(folder_id, None)


def folders_changed() -> None:
    if _started:
        _wake.set()


async def _refresh_all_oauth_tokens() -> None:
    """Keep both receive and send grants fresh without an extra IMAP socket."""
    from app.db.models import Protocol
    from app.services import oauth_microsoft
    from app.services.account_connection import _persist_new_token_cache, get_graph_token

    async with async_session_factory() as db:
        ids = list(
            (
                await db.scalars(
                    select(Account.id).where(
                        Account.is_active.is_(True),
                        Account.protocol == Protocol.OAUTH_MICROSOFT.value,
                    )
                )
            ).all()
        )
    for aid in ids:
        try:
            async with (
                _account_locks.setdefault(aid, asyncio.Lock()),
                async_session_factory() as db,
            ):
                account = await db.scalar(
                    select(Account).where(Account.id == aid, Account.is_active.is_(True))
                )
                if account is None:
                    continue
                _, cache = await oauth_microsoft.get_imap_access_token(
                    account.oauth_client_id,
                    account.oauth_tenant or "common",
                    account.oauth_token_cache_enc,
                )
                await _persist_new_token_cache(db, account, cache)
                await get_graph_token(db, account)
        except Exception:  # noqa: BLE001 - isolate provider/account token failures
            logger.warning("OAuth token refresh failed for account %s", aid)


async def _run() -> None:
    global _token_refresh
    refreshed = time.monotonic()
    while True:
        _wake.clear()
        if time.monotonic() - refreshed >= 600 and (not _token_refresh or _token_refresh.done()):
            _token_refresh = asyncio.create_task(_refresh_all_oauth_tokens())
            refreshed = time.monotonic()
        try:
            await _tick()
        except Exception:
            logger.exception("Sync supervisor tick failed")
        try:
            await asyncio.wait_for(_wake.wait(), 5)
        except TimeoutError:
            pass


async def start_scheduler() -> None:
    global _loop_task, _started
    _started = True
    _loop_task = asyncio.create_task(_run())


async def stop_scheduler() -> None:
    global _started, _loop_task, _token_refresh
    _started = False
    if _loop_task:
        _loop_task.cancel()
        await asyncio.gather(_loop_task, return_exceptions=True)
        _loop_task = None
    if _token_refresh:
        _token_refresh.cancel()
        await asyncio.gather(_token_refresh, return_exceptions=True)
        _token_refresh = None
    for folder_id in list(_tasks):
        _stop_folder(folder_id)
    for account_id in list(requests.running):
        requests.cancel_account(account_id)
    await asyncio.gather(
        *_background, *requests.running.values(), *requests.retired, return_exceptions=True
    )
    _last_full.clear()
    _last_inbox.clear()
    live.leases.clear()
