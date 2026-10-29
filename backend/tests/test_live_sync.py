"""Live synchronization uses fake sockets and a real isolated SQLite database."""

import asyncio
import json
import queue
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from test_folder_sync import folders
from test_folder_sync import mail as mailbox_fixture

from app.api import routes_sync
from app.core.security import require_session
from app.db import session
from app.db.models import Account, Folder, Message
from app.db.session import get_db
from app.sync import live, requests, scheduler, worker

mail = mailbox_fixture


async def eventually(condition):
    async with asyncio.timeout(3):
        while not condition():
            await asyncio.sleep(0.01)


@pytest_asyncio.fixture(autouse=True)
async def clean_runtime():
    live.watchers.clear()
    live.account_errors.clear()
    live.leases.clear()
    yield
    await scheduler.stop_scheduler()
    requests.pending.clear()
    live.subscribers.clear()
    live.watchers.clear()
    live.account_errors.clear()


class IdleSocket:
    def __init__(self, supported=True):
        self.supported = supported
        self.responses = queue.Queue()
        self.closed = False
        self.idles = 0
        self.done = 0

    def select_folder(self, path, readonly):
        assert path == "INBOX" and readonly

    def has_capability(self, capability):
        assert capability == "IDLE"
        return self.supported

    def idle(self):
        self.idles += 1

    def idle_check(self, timeout):
        assert timeout == scheduler.IDLE_CHECK_SECONDS
        try:
            response = self.responses.get(timeout=0.02)
        except queue.Empty:
            return []
        if isinstance(response, Exception):
            raise response
        return response

    def idle_done(self):
        self.done += 1

    def shutdown(self):
        self.closed = True
        self.responses.put(ConnectionError("closed"))

    def logout(self):
        self.closed = True


async def prepare(mail, monkeypatch):
    await worker.sync_account(mail.account_id)
    found = await folders(mail)
    monkeypatch.setattr(scheduler, "async_session_factory", mail.factory)
    monkeypatch.setattr(session, "async_session_factory", mail.factory)
    return found["INBOX"]["id"]


@pytest.mark.asyncio
async def test_idle_arrivals_flags_deletions_and_uidvalidity(mail, monkeypatch):
    folder_id = await prepare(mail, monkeypatch)
    socket = IdleSocket()
    monkeypatch.setattr(scheduler, "open_imap_connection", AsyncMock(return_value=socket))
    task = asyncio.create_task(scheduler._watch(mail.account_id, folder_id, "INBOX"))
    try:
        await eventually(lambda: live.watchers.get(folder_id, {}).get("state") == "connected")
        mail.mailbox.folders["INBOX"][2] = ()
        mail.mailbox.folders["INBOX"][1] = (b"\\Seen",)
        socket.responses.put([(2, b"EXISTS"), (1, b"FETCH")])
        await eventually(lambda: socket.done >= 1 and not requests.running)
        async with mail.factory() as db:
            messages = list(
                (
                    await db.scalars(
                        select(Message).where(Message.folder_id == folder_id).order_by(Message.uid)
                    )
                ).all()
            )
            assert [m.uid for m in messages] == [1, 2]
            assert messages[0].is_seen and messages[1].notification_eligible
        del mail.mailbox.folders["INBOX"][1]
        socket.responses.put([(1, b"EXPUNGE")])
        await eventually(lambda: socket.done >= 2 and not requests.running)
        async with mail.factory() as db:
            assert (
                len((await db.scalars(select(Message).where(Message.folder_id == folder_id))).all())
                == 1
            )
        mail.mailbox.validity = 2
        socket.responses.put([(1, b"EXISTS")])
        await eventually(lambda: socket.done >= 3 and not requests.running)
        async with mail.factory() as db:
            message = await db.scalar(select(Message).where(Message.folder_id == folder_id))
            assert message.uidvalidity == 2 and not message.notification_eligible
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert socket.closed


@pytest.mark.asyncio
async def test_idle_reconnect_catches_up_with_fresh_connection(mail, monkeypatch):
    folder_id = await prepare(mail, monkeypatch)
    first, second = IdleSocket(), IdleSocket()
    connect = AsyncMock(side_effect=[first, second])
    monkeypatch.setattr(scheduler, "open_imap_connection", connect)
    monkeypatch.setattr(scheduler, "BACKOFF_INITIAL", 0.01)
    task = asyncio.create_task(scheduler._watch(mail.account_id, folder_id, "INBOX"))
    try:
        await eventually(lambda: live.watchers.get(folder_id, {}).get("state") == "connected")
        mail.mailbox.folders["INBOX"][2] = ()
        first.responses.put([(b"BYE", b"connection limit")])
        await eventually(lambda: second.idles > 0 and not requests.running)
        async with mail.factory() as db:
            assert await db.scalar(
                select(Message).where(Message.folder_id == folder_id, Message.uid == 2)
            )
        assert first.closed and connect.await_count == 2
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_idle_renewal_and_unsupported_fallback(mail, monkeypatch):
    folder_id = await prepare(mail, monkeypatch)
    socket = IdleSocket()
    monkeypatch.setattr(scheduler, "open_imap_connection", AsyncMock(return_value=socket))
    monkeypatch.setattr(scheduler, "IDLE_RENEW_SECONDS", 0.01)
    scheduled = []
    monkeypatch.setattr(requests, "request_sync", lambda *args: scheduled.append(args))
    task = asyncio.create_task(scheduler._watch(mail.account_id, folder_id, "INBOX"))
    await eventually(lambda: socket.done > 0)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert scheduled == [(mail.account_id, {folder_id}, False)]
    socket = IdleSocket(False)
    monkeypatch.setattr(scheduler, "open_imap_connection", AsyncMock(return_value=socket))
    task = asyncio.create_task(scheduler._watch(mail.account_id, folder_id, "INBOX"))
    try:
        await eventually(lambda: live.watchers.get(folder_id, {}).get("state") == "polling")
        assert live.watchers[folder_id]["mode"] == "polling"
        assert socket.idles == 0
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert socket.closed


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [ConnectionError("password=SECRET"), ValueError("token=SECRET")])
async def test_watcher_errors_are_sanitized_and_retryable(mail, monkeypatch, error):
    folder_id = await prepare(mail, monkeypatch)
    monkeypatch.setattr(scheduler, "open_imap_connection", AsyncMock(side_effect=error))
    task = asyncio.create_task(scheduler._watch(mail.account_id, folder_id, "INBOX"))
    try:
        await eventually(lambda: live.watchers.get(folder_id, {}).get("next_retry"))
        status = await live.snapshot()
        assert "SECRET" not in json.dumps(status)
        assert status["health"] == ("red" if isinstance(error, ValueError) else "yellow")
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_coalesces_bursts_merges_scopes_and_isolates_accounts(monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def sync(aid, scope, discover):
        calls.append((aid, scope, discover))
        if aid == 1 and len([c for c in calls if c[0] == 1]) == 1:
            started.set()
            await release.wait()

    monkeypatch.setattr(requests, "sync_account", sync)
    task = requests.request_sync(1, {10}, False)
    await started.wait()
    for _ in range(100):
        assert requests.request_sync(1, {11}, False) is task
    requests.request_sync(1, {12}, True)
    await requests.request_sync(2, {20}, False)
    release.set()
    await task
    assert calls == [(1, {10}, False), (2, {20}, False), (1, {11, 12}, True)]


@pytest.mark.asyncio
async def test_cancel_and_restart_does_not_lose_refresh(monkeypatch):
    started = asyncio.Event()
    calls = []

    async def sync(aid, scope, discover):
        calls.append(aid)
        if len(calls) == 1:
            started.set()
            await asyncio.Event().wait()

    monkeypatch.setattr(requests, "sync_account", sync)
    first = requests.request_sync(1)
    await started.wait()
    requests.cancel_account(1)
    await requests.request_sync(1)
    await asyncio.gather(first, return_exceptions=True)
    assert calls == [1, 1] and not requests.pending and not requests.running


@pytest.mark.asyncio
async def test_visibility_leases_multiple_tabs_and_expiry(monkeypatch):
    current = [100.0]
    monkeypatch.setattr(live.time, "monotonic", lambda: current[0])
    live.presence("a", True)
    live.presence("b", True)
    live.presence("a", False)
    assert live.visible()
    current[0] = 159
    assert live.visible()
    current[0] = 160
    assert not live.visible() and not live.leases


@pytest.mark.asyncio
async def test_policy_global_interval_visible_hidden_and_polling(mail, monkeypatch):
    folder_id = await prepare(mail, monkeypatch)
    current = [1000.0]
    monkeypatch.setattr(scheduler.time, "monotonic", lambda: current[0])
    scheduled = []
    monkeypatch.setattr(requests, "request_sync", lambda *args: scheduled.append(args))
    # Preexisting fake supervisor task keeps _tick from opening sockets.
    placeholder = asyncio.create_task(asyncio.Event().wait())
    scheduler._tasks[folder_id] = placeholder
    scheduler._accounts[folder_id] = mail.account_id
    live.set_watcher(folder_id, state="connected")
    await scheduler._tick()
    assert (mail.account_id,) in scheduled
    scheduled.clear()
    current[0] += 60
    await scheduler._tick()
    assert scheduled == []  # hidden; healthy IDLE inbox
    live.presence("visible-tab", True)
    await scheduler._tick()
    archive_id = (await folders(mail))["Archive/Old"]["id"]
    assert scheduled == []
    scheduled.clear()
    live.presence("visible-tab", False)
    live.set_watcher(folder_id, state="polling")
    current[0] += 60
    await scheduler._tick()
    assert scheduled == []
    scheduled.clear()
    current[0] = 1899
    await scheduler._tick()
    assert scheduled == []
    current[0] = 1900
    await scheduler._tick()
    assert (mail.account_id, {folder_id}, False) in scheduled
    assert (mail.account_id, {archive_id}, True) in scheduled
    scheduled.clear()
    # A runtime change applies to all accounts without restarting their watchers.
    from app.db.models import AppSettings

    async with mail.factory() as db:
        db.add(AppSettings(id=1, password_hash="unused", sync_interval_seconds=300))
        other = Account(name="Other", protocol="imap_basic")
        db.add(other)
        await db.commit()
        other_id = other.id
    await scheduler._tick()
    assert scheduled == [(other_id,)]
    scheduled.clear()
    current[0] = 2199
    live.presence("visible-tab", True)
    await scheduler._tick()
    assert scheduled == []
    current[0] = 2200
    await scheduler._tick()
    assert (mail.account_id, {archive_id}, True) in scheduled
    assert (mail.account_id, {folder_id}, False) in scheduled
    assert (other_id, set(), True) in scheduled


@pytest.mark.asyncio
async def test_lifecycle_selection_edit_deactivate_delete_and_shutdown(mail, monkeypatch):
    folder_id = await prepare(mail, monkeypatch)
    sockets = []

    async def connect(*args):
        socket = IdleSocket()
        sockets.append(socket)
        return socket

    monkeypatch.setattr(scheduler, "open_imap_connection", connect)
    monkeypatch.setattr(scheduler, "_started", True)
    await scheduler._tick()
    await eventually(lambda: sockets and sockets[0].idles)
    scheduler.schedule_account_sync(mail.account_id)
    assert not scheduler._tasks and sockets[0].closed
    await scheduler._tick()
    await eventually(lambda: len(sockets) > 1 and sockets[1].idles)
    async with mail.factory() as db:
        folder = await db.get(Folder, folder_id)
        folder.is_inbox = False
        await db.commit()
    await scheduler._tick()
    assert not scheduler._tasks and sockets[1].closed
    async with mail.factory() as db:
        folder = await db.get(Folder, folder_id)
        folder.is_inbox = True
        await db.commit()
    await scheduler._tick()
    await eventually(lambda: len(sockets) > 2 and sockets[2].idles)
    async with mail.factory() as db:
        account = await db.get(Account, mail.account_id)
        account.is_active = False
        await db.commit()
    await scheduler._tick()
    assert not scheduler._tasks and sockets[2].closed
    assert (await live.snapshot())["health"] == "neutral"
    scheduler.unschedule_account_sync(mail.account_id)
    await scheduler.stop_scheduler()
    assert not scheduler._clients and not requests.running


@pytest.mark.asyncio
async def test_events_overflow_and_committed_ordering(mail, monkeypatch):
    await prepare(mail, monkeypatch)
    events = asyncio.Queue(maxsize=2)
    live.subscribers.add(events)
    live.publish("folder", folder_id=1)
    live.publish("folder", folder_id=2)
    live.publish("folder", folder_id=3)
    assert await events.get() == {"type": "snapshot"}
    # Event consumption observes committed rows from a separate session.
    mail.mailbox.folders["INBOX"][2] = ()
    task = asyncio.create_task(worker.sync_account(mail.account_id))
    observed = False
    while not task.done() or not events.empty():
        try:
            event = await asyncio.wait_for(events.get(), 0.05)
        except TimeoutError:
            continue
        if event["type"] == "folder":
            async with mail.factory() as db:
                observed |= bool(await db.scalar(select(Message).where(Message.uid == 2)))
    await task
    assert observed


@pytest.mark.asyncio
async def test_sync_api_auth_scopes_presence_retry_and_sse_cleanup(mail, monkeypatch):
    folder_id = await prepare(mail, monkeypatch)
    app = FastAPI()
    app.include_router(routes_sync.router)

    async def db():
        async with mail.factory() as connection:
            yield connection

    app.dependency_overrides[get_db] = db
    # require_session needs session middleware even for unauthenticated requests.
    from starlette.middleware.sessions import SessionMiddleware

    app.add_middleware(SessionMiddleware, secret_key="test")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for path in ("events", "connections"):
            assert (await client.get(f"/api/sync/{path}")).status_code == 401
        app.dependency_overrides[require_session] = lambda: None
        calls = []
        monkeypatch.setattr(routes_sync, "request_sync", lambda *args: calls.append(args))
        assert (
            await client.post(f"/api/sync/trigger?folder_id={folder_id}&account_id=999")
        ).status_code == 400
        assert (await client.post("/api/sync/trigger?folder_id=999")).status_code == 404
        for _ in range(2):
            assert (
                await client.post(f"/api/sync/trigger?folder_id={folder_id}")
            ).status_code == 200
        assert calls == [(mail.account_id, {folder_id}, False)] * 2
        await client.post("/api/sync/presence", json={"client_id": "tab", "visible": True})
        assert live.visible()
        assert (await client.get("/api/sync/connections")).json()["refresh_seconds"] == 900
        assert (await client.post("/api/sync/retry?account_id=999")).status_code == 404
        assert (
            await client.post(f"/api/sync/retry?account_id={mail.account_id}")
        ).status_code == 200

    class Request:
        async def is_disconnected(self):
            return False

    response = await routes_sync.events(Request())
    stream = response.body_iterator
    first = await anext(stream)
    assert '"type": "snapshot"' in first and live.subscribers
    await stream.aclose()
    assert not live.subscribers
    assert response.headers["x-accel-buffering"] == "no"


@pytest.mark.asyncio
async def test_oauth_reauthentication_restarts_watchers(mail, monkeypatch):
    from app.services.oauth_microsoft import OAuthReauthenticationRequired

    folder_id = await prepare(mail, monkeypatch)
    socket = IdleSocket()
    attempts = []

    async def connect(db, account):
        attempts.append(account.oauth_token_cache_enc)
        if account.oauth_token_cache_enc != "fresh-cache":
            raise OAuthReauthenticationRequired("provider bearer SECRET")
        return socket

    monkeypatch.setattr(scheduler, "open_imap_connection", connect)
    monkeypatch.setattr(scheduler, "_started", True)
    await scheduler._tick()
    await eventually(lambda: live.watchers.get(folder_id, {}).get("state") == "error")
    status = await live.snapshot()
    assert status["health"] == "red" and "SECRET" not in json.dumps(status)
    async with mail.factory() as db:
        account = await db.get(Account, mail.account_id)
        account.oauth_token_cache_enc = "fresh-cache"
        await db.commit()
    scheduler.schedule_account_sync(mail.account_id)
    await scheduler._tick()
    await eventually(lambda: live.watchers.get(folder_id, {}).get("state") == "connected")
    assert attempts[-1] == "fresh-cache"
    assert (await live.snapshot())["health"] == "green"
    await scheduler.stop_scheduler()


@pytest.mark.asyncio
async def test_old_socket_cleanup_cannot_close_replacement():
    old, replacement = IdleSocket(), IdleSocket()
    scheduler._clients[10] = replacement
    scheduler._close(10, old)
    scheduler._close(10, None)
    assert not replacement.closed and scheduler._clients[10] is replacement
    scheduler._close(10)
    assert replacement.closed and 10 not in scheduler._clients


@pytest.mark.asyncio
async def test_noninbox_failure_persists_until_that_folder_recovers(mail, monkeypatch):
    folder_id = await prepare(mail, monkeypatch)
    archive_id = (await folders(mail))["Archive/Old"]["id"]
    live.set_watcher(folder_id, state="connected", mode="idle")
    mail.mailbox.failed_folder = "Archive/Old"
    await worker.sync_account(mail.account_id)
    assert (await live.snapshot())["health"] == "red"
    # An unrelated successful inbox refresh must not erase the archive failure.
    await worker.sync_account(mail.account_id, {folder_id}, False)
    assert (await live.snapshot())["health"] == "red"
    mail.mailbox.failed_folder = None
    await worker.sync_account(mail.account_id, {archive_id}, False)
    assert (await live.snapshot())["health"] == "green"


@pytest.mark.asyncio
async def test_page_request_all_scope_merges_with_running_folder(monkeypatch):
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def sync(aid, scope, discover):
        calls.append((aid, scope, discover))
        if len(calls) == 1:
            entered.set()
            await release.wait()

    monkeypatch.setattr(requests, "sync_account", sync)
    task = requests.request_sync(1, {10}, False)
    await entered.wait()
    for _ in range(10):
        requests.request_sync(1)  # opening/reloading/returning in several tabs
        requests.request_sync(1, {20}, False)
    release.set()
    await task
    assert calls == [(1, {10}, False), (1, None, True)]


@pytest.mark.asyncio
async def test_idle_renews_while_initial_backfill_is_running(mail, monkeypatch):
    folder_id = await prepare(mail, monkeypatch)
    socket = IdleSocket()
    entered, release = asyncio.Event(), asyncio.Event()

    async def slow_sync(*args):
        entered.set()
        await release.wait()

    monkeypatch.setattr(requests, "sync_account", slow_sync)
    monkeypatch.setattr(scheduler, "open_imap_connection", AsyncMock(return_value=socket))
    monkeypatch.setattr(scheduler, "IDLE_RENEW_SECONDS", 0.01)
    task = asyncio.create_task(scheduler._watch(mail.account_id, folder_id, "INBOX"))
    try:
        await entered.wait()
        await eventually(lambda: socket.done > 0)
        assert live.watchers[folder_id]["state"] == "reconciling"
        assert not release.is_set()
    finally:
        release.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.gather(*requests.running.values(), return_exceptions=True)
