"""Folder discovery, resumable full-history sync, and inbox API integration."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import routes_accounts, routes_messages
from app.core.security import require_session
from app.db.models import Account, Folder, Message
from app.db.session import Base, get_db
from app.services import imap_client
from app.sync import worker


class Mailbox:
    def __init__(self):
        self.folders = {"INBOX": {1: ()}, "Archive/Old": {1: (b"\\Seen",)}}
        self.selected = None
        self.validity = 1
        self.failed_folder = None
        self.fail_header_batch = None
        self.header_batches = []
        self.marked = []
        self.list_error = False

    def list_folders(self):
        if self.list_error:
            raise RuntimeError("LIST unavailable")
        return [((), b"/", path) for path in self.folders] + [((b"\\Noselect",), b"/", "Archive")]

    def select_folder(self, path, readonly=True):
        if path == self.failed_folder:
            raise RuntimeError("Folder unavailable")
        self.selected = path
        return {b"UIDVALIDITY": self.validity}

    def search(self, criteria):
        assert criteria == ["ALL"]
        return list(self.folders[self.selected])

    def fetch(self, uids, items):
        if items == imap_client.HEADER_FETCH_ITEMS:
            self.header_batches.append(list(uids))
            if len(self.header_batches) == self.fail_header_batch:
                raise RuntimeError("Interrupted fetch")
        result = {}
        for uid in uids:
            if uid not in self.folders[self.selected]:
                continue
            if items == ["BODY[]"]:
                self.folders[self.selected][uid] = (b"\\Seen",)
            raw = f"Subject: Mail {uid}\r\nFrom: sender@example.com\r\n\r\nHello".encode()
            result[uid] = {
                b"FLAGS": self.folders[self.selected][uid],
                b"BODY[HEADER]": raw,
                b"BODY[]": raw,
                b"INTERNALDATE": datetime(2026, 1, 1, tzinfo=UTC),
            }
        return result

    def add_flags(self, uids, flags):
        self.marked.append((self.selected, list(uids)))
        for uid in uids:
            self.folders[self.selected][uid] = tuple(flags)

    def logout(self):
        pass


@pytest_asyncio.fixture
async def mail(monkeypatch, tmp_path):
    # File-backed SQLite matches production and supports concurrent independent
    # sessions, including cancellation invalidating one connection.
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'mail.db'}")

    @event.listens_for(engine.sync_engine, "connect")
    def foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        account = Account(name="Primary", protocol="imap_basic")
        db.add(account)
        await db.commit()
        account_id = account.id
    mailbox = Mailbox()
    connect = AsyncMock(return_value=mailbox)
    monkeypatch.setattr(worker, "async_session_factory", factory)
    monkeypatch.setattr(worker, "_account_locks", {})
    monkeypatch.setattr(worker, "open_imap_connection", connect)
    monkeypatch.setattr(routes_messages, "open_imap_connection", connect)

    async def session():
        async with factory() as db:
            yield db

    app = FastAPI()
    app.include_router(routes_accounts.router)
    app.include_router(routes_messages.router)
    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_session] = lambda: None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield SimpleNamespace(
            client=client,
            factory=factory,
            mailbox=mailbox,
            account_id=account_id,
        )
    await engine.dispose()


async def folders(mail):
    response = await mail.client.get("/api/accounts")
    assert response.status_code == 200
    return {folder["imap_path"]: folder for folder in response.json()[0]["folders"]}


@pytest.mark.asyncio
async def test_sync_continues_past_encoded_newlines_in_addresses(mail, monkeypatch):
    mail.mailbox.folders = {"INBOX": {1: (), 2: ()}}
    original_fetch = mail.mailbox.fetch

    def fetch(uids, items):
        result = original_fetch(uids, items)
        if items == imap_client.HEADER_FETCH_ITEMS and 1 in result:
            result[1][b"BODY[HEADER]"] = (
                b"From: =?utf-8?Q?Alice=0D=0ASmith?= <alice@example.com>\r\n"
                b"Subject: Malformed sender\r\n\r\n"
            )
        return result

    monkeypatch.setattr(mail.mailbox, "fetch", fetch)
    await worker.sync_account(mail.account_id)

    async with mail.factory() as db:
        account = await db.get(Account, mail.account_id)
        assert account.last_sync_status == "ok"
        assert account.last_sync_error is None
        messages = list((await db.scalars(select(Message).order_by(Message.uid))).all())
        assert [message.uid for message in messages] == [1, 2]
        assert messages[0].from_addr == "alice@example.com"
    assert (await folders(mail))["INBOX"]["history_complete"] is True


@pytest.mark.asyncio
async def test_discovers_all_selectable_folders_and_preserves_inbox_choices(mail):
    await worker.sync_account(mail.account_id)
    found = await folders(mail)
    assert set(found) == {"INBOX", "Archive/Old"}
    assert found["INBOX"]["is_inbox"] is True
    assert found["Archive/Old"]["is_inbox"] is False
    assert all(folder["history_complete"] for folder in found.values())
    response = await mail.client.put(
        f"/api/accounts/{mail.account_id}/folders",
        json={
            "folders": [{"imap_path": "INBOX", "is_inbox": False}],
        },
    )
    assert response.status_code == 200
    mail.mailbox.folders["Sent"] = {5: (b"\\Seen",)}
    await worker.sync_account(mail.account_id)
    found = await folders(mail)
    assert found["INBOX"]["is_inbox"] is False
    assert found["Sent"]["is_inbox"] is False
    assert "sync_enabled" not in found["Sent"]


@pytest.mark.asyncio
async def test_full_history_resumes_without_duplicates_and_preserves_existing_ids(mail):
    mail.mailbox.folders = {"INBOX": {uid: () for uid in range(1, 652)}}
    async with mail.factory() as db:
        folder = Folder(
            account_id=mail.account_id,
            imap_path="INBOX",
            is_inbox=True,
            last_uidvalidity=1,
            last_seen_uid=0,
        )
        db.add(folder)
        await db.flush()
        old = Message(account_id=mail.account_id, folder_id=folder.id, uid=600, uidvalidity=1)
        db.add(old)
        await db.commit()
        old_id = old.id
    mail.mailbox.fail_header_batch = 2
    await worker.sync_account(mail.account_id)
    async with mail.factory() as db:
        folder = await db.scalar(select(Folder))
        assert folder.last_seen_uid == 200
        assert folder.history_complete is False
        assert await db.scalar(select(func.count(Message.id))) == 201
    await worker.sync_account(mail.account_id)
    async with mail.factory() as db:
        assert await db.scalar(select(func.count(Message.id))) == 651
        assert (await db.get(Message, old_id)).uid == 600
        assert (
            await db.scalar(
                select(func.count(Message.id)).where(Message.notification_eligible.is_(True))
            )
            == 0
        )
    assert max(map(len, mail.mailbox.header_batches)) == 200
    # New arrivals are eligible, historical imports never become notifications.
    mail.mailbox.folders["INBOX"][652] = ()
    await worker.sync_account(mail.account_id)
    response = await mail.client.get("/api/messages?notifications_only=true&unread_only=true")
    assert [m["subject"] for m in response.json()["items"]] == ["Mail 652"]


@pytest.mark.asyncio
async def test_reconciles_old_flags_expunges_and_uidvalidity(mail):
    mail.mailbox.folders = {"INBOX": {uid: () for uid in range(1, 452)}}
    await worker.sync_account(mail.account_id)
    mail.mailbox.folders["INBOX"][1] = (b"\\Seen", b"\\Flagged", b"\\Answered")
    del mail.mailbox.folders["INBOX"][2]
    await worker.sync_account(mail.account_id)
    async with mail.factory() as db:
        message = await db.scalar(select(Message).where(Message.uid == 1))
        assert message.is_seen and message.is_flagged and message.is_answered
        assert await db.scalar(select(Message).where(Message.uid == 2)) is None
    mail.mailbox.validity = 2
    mail.mailbox.folders = {"INBOX": {1: ()}}
    await worker.sync_account(mail.account_id)
    async with mail.factory() as db:
        messages = list((await db.scalars(select(Message))).all())
        assert len(messages) == 1
        assert messages[0].uidvalidity == 2
        assert messages[0].notification_eligible is False


@pytest.mark.asyncio
async def test_folder_failure_isolated_and_failed_discovery_preserves_data(mail):
    mail.mailbox.failed_folder = "Archive/Old"
    await worker.sync_account(mail.account_id)
    found = await folders(mail)
    assert found["INBOX"]["history_complete"] is True
    assert found["Archive/Old"]["history_complete"] is False
    response = await mail.client.get("/api/accounts")
    assert response.json()[0]["last_sync_status"] == "error"
    assert "Archive/Old" in response.json()[0]["last_sync_error"]
    mail.mailbox.list_error = True
    await worker.sync_account(mail.account_id)
    assert len(await folders(mail)) == 2
    mail.mailbox.list_error = False
    del mail.mailbox.folders["INBOX"]
    await worker.sync_account(mail.account_id)
    assert set(await folders(mail)) == {"Archive/Old"}
    async with mail.factory() as db:
        assert await db.scalar(select(func.count(Message.id))) == 0


@pytest.mark.asyncio
async def test_inbox_filters_search_explicit_folder_bulk_read_and_counts(mail):
    mail.mailbox.folders["Archive/Old"][1] = ()
    await worker.sync_account(mail.account_id)
    found = await folders(mail)
    inbox_id = found["INBOX"]["id"]
    archive_id = found["Archive/Old"]["id"]
    assert found["Archive/Old"]["unread_count"] == 1
    for params in ("", f"account_id={mail.account_id}", "unread_only=true&search=Mail"):
        response = await mail.client.get(f"/api/messages?{params}")
        assert [m["folder_id"] for m in response.json()["items"]] == [inbox_id]
    response = await mail.client.get(f"/api/messages?folder_id={archive_id}")
    assert [m["folder_id"] for m in response.json()["items"]] == [archive_id]
    response = await mail.client.post("/api/messages/mark-all-read")
    assert response.json() == {"updated": 1}
    assert mail.mailbox.marked == [("INBOX", [1])]
    response = await mail.client.post(f"/api/messages/mark-all-read?folder_id={archive_id}")
    assert response.json() == {"updated": 1}
    response = await mail.client.put(
        f"/api/accounts/{mail.account_id}/folders",
        json={
            "folders": [{"imap_path": "INBOX", "is_inbox": False}],
        },
    )
    assert response.status_code == 200
    assert (await mail.client.get("/api/messages")).json()["items"] == []
    assert len((await mail.client.get(f"/api/messages?folder_id={inbox_id}")).json()["items"]) == 1
    response = await mail.client.put(
        f"/api/accounts/{mail.account_id}/folders",
        json={
            "folders": [{"imap_path": "Unknown", "is_inbox": True}],
        },
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_reading_any_folder_and_missing_remote_message(mail):
    mail.mailbox.folders["Archive/Old"][1] = ()
    await worker.sync_account(mail.account_id)
    archive_id = (await folders(mail))["Archive/Old"]["id"]
    summary = (await mail.client.get(f"/api/messages?folder_id={archive_id}")).json()["items"][0]
    response = await mail.client.get(f"/api/messages/{summary['id']}")
    assert response.status_code == 200
    assert response.json()["text_body"] == "Hello"
    async with mail.factory() as db:
        assert (await db.get(Message, summary["id"])).is_seen is True
    del mail.mailbox.folders["Archive/Old"][1]
    response = await mail.client.get(f"/api/messages/{summary['id']}")
    assert response.status_code == 404
    mail.mailbox.validity = 2
    response = await mail.client.get(f"/api/messages/{summary['id']}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_pagination_includes_messages_without_date(mail):
    await worker.sync_account(mail.account_id)
    async with mail.factory() as db:
        folder = await db.scalar(select(Folder).where(Folder.is_inbox.is_(True)))
        for uid in (10, 11, 12):
            db.add(Message(account_id=mail.account_id, folder_id=folder.id, uid=uid, uidvalidity=1))
        await db.commit()
    ids = []
    cursor = None
    while True:
        params = {"limit": 1}
        if cursor:
            params["cursor"] = cursor
        response = await mail.client.get("/api/messages", params=params)
        assert response.status_code == 200
        page = response.json()
        ids.extend(m["id"] for m in page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(ids) == len(set(ids)) == 4


@pytest.mark.asyncio
async def test_account_scope_excludes_other_accounts_and_non_inbox_notifications(mail):
    await worker.sync_account(mail.account_id)
    async with mail.factory() as db:
        other = Account(name="Other", protocol="oauth_microsoft")
        db.add(other)
        await db.flush()
        folder = Folder(
            account_id=other.id, imap_path="INBOX", is_inbox=True, history_complete=True
        )
        db.add(folder)
        await db.flush()
        db.add(
            Message(
                account_id=other.id,
                folder_id=folder.id,
                uid=1,
                uidvalidity=1,
                notification_eligible=True,
            )
        )
        await db.commit()
        other_id = other.id
    response = await mail.client.get(f"/api/messages?account_id={other_id}")
    assert [message["account_id"] for message in response.json()["items"]] == [other_id]
    response = await mail.client.get(f"/api/messages?account_id={mail.account_id}")
    assert [message["account_id"] for message in response.json()["items"]] == [mail.account_id]
    mail.mailbox.folders["Archive/Old"][2] = ()
    await worker.sync_account(mail.account_id)
    archive_id = (await folders(mail))["Archive/Old"]["id"]
    response = await mail.client.get(
        f"/api/messages?notifications_only=true&folder_id={archive_id}"
    )
    assert response.json()["items"] == []


@pytest.mark.asyncio
async def test_read_errors_are_retryable_and_do_not_mark_cached_message_read(mail, monkeypatch):
    await worker.sync_account(mail.account_id)
    summary = (await mail.client.get("/api/messages")).json()["items"][0]
    monkeypatch.setattr(
        routes_messages, "open_imap_connection", AsyncMock(side_effect=RuntimeError("Disconnected"))
    )
    response = await mail.client.get(f"/api/messages/{summary['id']}")
    assert response.status_code == 502
    async with mail.factory() as db:
        assert (await db.get(Message, summary["id"])).is_seen is False
    monkeypatch.setattr(
        routes_messages, "open_imap_connection", AsyncMock(return_value=mail.mailbox)
    )
    response = await mail.client.get(f"/api/messages/{summary['id']}")
    assert response.status_code == 200
    assert response.json()["account_id"] == mail.account_id
    assert response.json()["folder_id"] == summary["folder_id"]


@pytest.mark.asyncio
async def test_scheduler_and_manual_syncs_are_serialized_per_account(mail, monkeypatch):
    import asyncio

    original = worker._sync_folder
    active = 0
    peak = 0

    async def tracked(*args):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.01)
            await original(*args)
        finally:
            active -= 1

    monkeypatch.setattr(worker, "_sync_folder", tracked)
    await asyncio.gather(worker.sync_account(mail.account_id), worker.sync_account(mail.account_id))
    assert peak == 1
    async with mail.factory() as db:
        assert await db.scalar(select(func.count(Message.id))) == 2


@pytest.mark.asyncio
async def test_attachment_download_from_non_inbox_does_not_mark_read(mail, monkeypatch):
    from email.message import EmailMessage

    mail.mailbox.folders["Archive/Old"][1] = ()
    await worker.sync_account(mail.account_id)
    archive_id = (await folders(mail))["Archive/Old"]["id"]
    summary = (await mail.client.get(f"/api/messages?folder_id={archive_id}")).json()["items"][0]
    message = EmailMessage()
    message.set_content("Body")
    message.add_attachment(
        b"attachment contents",
        maintype="application",
        subtype="octet-stream",
        filename="example.bin",
    )
    original_fetch = mail.mailbox.fetch

    def fetch(uids, items):
        if items == ["BODY.PEEK[]"]:
            return {uids[0]: {b"BODY[]": message.as_bytes()}}
        return original_fetch(uids, items)

    monkeypatch.setattr(mail.mailbox, "fetch", fetch)
    response = await mail.client.get(f"/api/messages/{summary['id']}/attachments/1")
    assert response.status_code == 200
    assert response.content == b"attachment contents"
    assert "example.bin" in response.headers["content-disposition"]
    async with mail.factory() as db:
        assert (await db.get(Message, summary["id"])).is_seen is False
    response = await mail.client.get(f"/api/messages/{summary['id']}/attachments/99")
    assert response.status_code == 404
