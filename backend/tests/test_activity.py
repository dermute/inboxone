"""Feedback must cover the complete lifetime of queued and running mail work."""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from test_folder_sync import mail as mailbox_fixture

from app.api import routes_sync
from app.core import activity
from app.sync import live, requests, worker

mail = mailbox_fixture


@pytest_asyncio.fixture(autouse=True)
async def clean_activity():
    activity._active.clear()
    yield
    for aid in list(requests.running):
        requests.cancel_account(aid)
    await asyncio.gather(*requests.retired, return_exceptions=True)
    assert not activity.snapshot()
    live.subscribers.clear()


def test_nested_activity_has_stable_scopes_and_compatible_fields():
    with activity.track("Syncing account…", kind="sync", account_id=1):
        root = activity.snapshot()[0]
        assert root["label"] == "Syncing account…" and root["seconds"] >= 0
        with activity.track("Syncing Inbox…", kind="sync", account_id=1, folder_id=10):
            leaf = activity.snapshot()
            assert len(leaf) == 1 and leaf[0]["parent_id"] == root["id"]
            assert leaf[0]["folder_id"] == 10 and leaf[0]["state"] == "running"
            assert activity.snapshot()[0]["id"] == leaf[0]["id"]
        assert activity.snapshot()[0]["id"] == root["id"]
    assert not activity.snapshot()


@pytest.mark.asyncio
async def test_activity_events_include_completion_and_failure_cleanup():
    queue = asyncio.Queue()
    live.subscribers.add(queue)
    with pytest.raises(ValueError), activity.track("Sending…", kind="send", account_id=1):
        first = await queue.get()
        assert first["type"] == "activity" and len(first["items"]) == 1
        raise ValueError("failure")
    assert await queue.get() == {"type": "activity", "items": []}


@pytest.mark.asyncio
async def test_coalesced_followup_is_one_queued_activity(monkeypatch):
    entered, release = asyncio.Event(), asyncio.Event()

    async def sync(*args):
        with activity.track("Syncing Inbox…", kind="sync", account_id=1, folder_id=10):
            entered.set()
            await release.wait()

    monkeypatch.setattr(requests, "sync_account", sync)
    task = requests.request_sync(1, {10}, False)
    assert activity.snapshot()[0]["state"] == "queued"
    await entered.wait()
    for _ in range(50):
        requests.request_sync(1, {11}, False)
    requests.request_sync(1, {12}, False)
    work = activity.snapshot()
    assert len(work) == 2
    queued = next(item for item in work if item["state"] == "queued")
    assert queued["folder_ids"] == [11, 12]
    assert len(requests.pending_activity) == 1
    assert any(item["state"] == "running" for item in work)
    release.set()
    await task
    assert not activity.snapshot() and not requests.pending_activity


@pytest.mark.asyncio
async def test_cancel_before_start_cleans_queued_activity(monkeypatch):
    monkeypatch.setattr(requests, "sync_account", AsyncMock())
    task = requests.request_sync(1)
    assert activity.snapshot()
    requests.cancel_account(1)
    await asyncio.gather(task, return_exceptions=True)
    assert not activity.snapshot() and not requests.pending_activity


@pytest.mark.asyncio
async def test_cancel_running_cleans_child_and_parent(monkeypatch):
    entered = asyncio.Event()

    async def sync(*args):
        with activity.track("Syncing…", kind="sync", account_id=1):
            entered.set()
            await asyncio.Event().wait()

    monkeypatch.setattr(requests, "sync_account", sync)
    task = requests.request_sync(1)
    await entered.wait()
    requests.cancel_account(1)
    await asyncio.gather(task, return_exceptions=True)
    assert not activity.snapshot()


@pytest.mark.asyncio
async def test_work_waiting_for_account_lock_stays_visible(mail):
    lock = worker._account_locks.setdefault(mail.account_id, asyncio.Lock())
    await lock.acquire()
    task = requests.request_sync(mail.account_id)
    await asyncio.sleep(0.01)
    assert not task.done()
    assert len(activity.snapshot()) == 1
    assert activity.snapshot()[0]["state"] == "queued"
    lock.release()
    await task
    assert not activity.snapshot()


@pytest.mark.asyncio
async def test_activity_snapshot_recovers_after_overflow(monkeypatch):
    monkeypatch.setattr(live, "snapshot", AsyncMock(return_value={"health": "green"}))

    class Request:
        async def is_disconnected(self):
            return False

    response = await routes_sync.events(Request())
    stream = response.body_iterator
    first = json.loads((await anext(stream)).removeprefix("data: ").strip())
    assert first["items"] == []
    try:
        with activity.track("Sending…", kind="send", account_id=1):
            for _ in range(64):
                live.publish("connection", account_id=1)
            recovered = json.loads((await anext(stream)).removeprefix("data: ").strip())
            assert recovered["type"] == "snapshot"
            assert recovered["items"][0]["label"] == "Sending…"
            assert recovered["items"][0]["account_id"] == 1
    finally:
        await stream.aclose()
    assert not live.subscribers


@pytest.mark.asyncio
async def test_work_waiting_for_global_concurrency_stays_visible(mail, monkeypatch):
    semaphore = asyncio.Semaphore(0)
    monkeypatch.setattr(worker, "_sync_semaphore", semaphore)
    task = requests.request_sync(mail.account_id)
    await asyncio.sleep(0.01)
    assert not task.done() and activity.snapshot()[0]["state"] == "queued"
    semaphore.release()
    await task
    assert not activity.snapshot()
