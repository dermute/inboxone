from email.parser import BytesParser
from email.policy import SMTP, default
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from imapclient import IMAPClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import routes_messages
from app.core.security import require_session
from app.db.models import Account, Folder, Message
from app.db.session import Base, get_db
from app.services import imap_client, outgoing_mail, smtp_client


@pytest.fixture
def mailbox(monkeypatch):
    client = Mock(spec=IMAPClient)
    client.find_special_folder.return_value = "Gesendet"
    client.search.return_value = []
    client.has_capability.return_value = False
    connect = AsyncMock(return_value=client)
    send = AsyncMock()
    monkeypatch.setattr(outgoing_mail, "open_imap_connection", connect)
    monkeypatch.setattr(smtp_client, "send_basic_auth", send)
    return SimpleNamespace(client=client, connect=connect, send=send)


@pytest_asyncio.fixture
async def api():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        accounts = [
            Account(
                name=f"Account {i}",
                protocol="imap_basic",
                imap_host=f"imap{i}.example.com",
                imap_port=993,
                imap_username=f"sender{i}@example.com",
                imap_password_enc=f"imap-password-{i}",
                smtp_host=f"smtp{i}.example.com",
                smtp_port=587,
                smtp_username=f"sender{i}@example.com",
                smtp_password_enc=f"smtp-password-{i}",
            )
            for i in (1, 2)
        ]
        db.add_all(accounts)
        await db.flush()
        folder = Folder(account_id=accounts[0].id, imap_path="INBOX")
        db.add(folder)
        await db.flush()
        original = Message(
            account_id=accounts[0].id,
            folder_id=folder.id,
            uid=12,
            uidvalidity=1,
            message_id_header="<original@example.com>",
            references="<earlier@example.com>",
        )
        db.add(original)
        await db.commit()

        async def session():
            yield db

        app = FastAPI()
        app.include_router(routes_messages.router)
        app.dependency_overrides[get_db] = session
        app.dependency_overrides[require_session] = lambda: None
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield SimpleNamespace(
                client=client, db=db, accounts=accounts, original=original
            )
    await engine.dispose()


async def send_message(api, action, account_id=None):
    return await api.client.post(
        f"/api/messages/{api.original.id}/{action}",
        json={
            "account_id": account_id,
            "to": ["recipient@example.com"],
            "cc": ["cc@example.com"],
            "bcc": ["hidden@example.com"],
            "subject": "Re: Grüße",
            "body_html": "<p>Thank you!</p>",
        },
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["reply", "forward"])
@pytest.mark.parametrize("switch_account", [False, True])
async def test_send_saves_copy_in_sending_account(api, mailbox, action, switch_account):
    account = api.accounts[1 if switch_account else 0]
    transmitted = []

    async def capture(message, **kwargs):
        # Folder resolution must succeed before delivery; APPEND must follow it.
        mailbox.client.find_special_folder.assert_called_once_with(b"\\Sent")
        mailbox.client.append.assert_not_called()
        transmitted.append(message.as_bytes(policy=SMTP))

    mailbox.send.side_effect = capture
    response = await send_message(api, action, account.id if switch_account else None)

    assert response.status_code == 200
    assert response.json() == {"sent": True, "warning": None}
    mailbox.connect.assert_awaited_once_with(api.db, account)
    mailbox.send.assert_awaited_once()
    assert mailbox.send.call_args.kwargs == {
        "host": account.smtp_host,
        "port": account.smtp_port,
        "use_tls": True,
        "username": account.smtp_username,
        "password": account.smtp_password_enc,
    }
    path, raw = mailbox.client.append.call_args.args
    assert path == "Gesendet"
    assert raw == transmitted[0]
    assert mailbox.client.append.call_args.kwargs == {"flags": [b"\\Seen"]}
    saved = BytesParser(policy=default).parsebytes(raw)
    assert saved["From"] == account.smtp_username
    assert saved["To"] == "recipient@example.com"
    assert saved["Cc"] == "cc@example.com"
    assert saved["Bcc"] == "hidden@example.com"
    assert saved["Subject"] == "Re: Grüße"
    assert saved["Date"].datetime.tzinfo is not None
    assert saved["Message-ID"]
    assert saved.get_body(preferencelist=("html",)).get_content().strip() == "<p>Thank you!</p>"
    mailbox.client.search.assert_called_once_with(["HEADER", "Message-ID", saved["Message-ID"]])
    if action == "reply":
        assert saved["In-Reply-To"] == "<original@example.com>"
        assert saved["References"] == "<earlier@example.com> <original@example.com>"
    else:
        assert saved["In-Reply-To"] is None
        assert saved["References"] is None
    assert api.original.is_answered == (action == "reply")
    mailbox.client.logout.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["reply", "forward"])
async def test_save_failure_reports_success_with_warning(api, mailbox, action):
    mailbox.client.append.side_effect = RuntimeError("Quota exceeded")
    response = await send_message(api, action)

    assert response.status_code == 200
    assert response.json()["sent"] is True
    assert "was sent" in response.json()["warning"]
    assert "Do not send it again" in response.json()["warning"]
    mailbox.send.assert_awaited_once()
    mailbox.client.append.assert_called_once()
    mailbox.client.logout.assert_called_once()
    assert api.original.is_answered == (action == "reply")


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["connect", "folder", "smtp"])
async def test_failures_do_not_save_unsent_mail(api, mailbox, failure):
    if failure == "connect":
        mailbox.connect.side_effect = RuntimeError("IMAP unavailable")
    elif failure == "folder":
        mailbox.client.find_special_folder.side_effect = RuntimeError("IMAP unavailable")
    else:
        mailbox.send.side_effect = RuntimeError("SMTP unavailable")

    with pytest.raises(RuntimeError, match="unavailable"):
        await send_message(api, "reply")

    mailbox.client.append.assert_not_called()
    assert not api.original.is_answered
    if failure != "smtp":
        mailbox.send.assert_not_awaited()
    if failure != "connect":
        mailbox.client.logout.assert_called_once()


@pytest.mark.asyncio
async def test_logout_failure_does_not_report_send_failure(api, mailbox):
    mailbox.client.logout.side_effect = RuntimeError("Connection lost during logout")
    response = await send_message(api, "reply")

    assert response.status_code == 200
    assert response.json() == {"sent": True, "warning": None}
    mailbox.client.append.assert_called_once()


@pytest.mark.asyncio
async def test_existing_provider_copy_is_not_duplicated(api, mailbox):
    mailbox.client.search.return_value = [42]
    response = await send_message(api, "reply")

    assert response.status_code == 200
    mailbox.send.assert_awaited_once()
    mailbox.client.append.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["reply", "forward"])
async def test_gmail_relies_on_provider_copy(api, mailbox, action):
    api.accounts[0].imap_host = "imap.gmail.com"
    api.accounts[0].smtp_host = "smtp.gmail.com"
    await api.db.commit()
    response = await send_message(api, action)

    assert response.status_code == 200
    assert response.json() == {"sent": True, "warning": None}
    mailbox.send.assert_awaited_once()
    mailbox.connect.assert_not_awaited()
    mailbox.client.append.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["reply", "forward"])
async def test_microsoft_uses_graph_sent_storage(api, mailbox, monkeypatch, action):
    api.accounts[0].protocol = "oauth_microsoft"
    await api.db.commit()
    monkeypatch.setattr(routes_messages, "get_graph_token", AsyncMock(return_value="test-token"))
    post = AsyncMock(return_value=httpx.Response(202, request=httpx.Request("POST", "http://test")))
    graph = AsyncMock()
    graph.__aenter__.return_value.post = post
    monkeypatch.setattr(routes_messages.graph_client.httpx, "AsyncClient", Mock(return_value=graph))

    response = await send_message(api, action)

    assert response.status_code == 200
    assert response.json() == {"sent": True, "warning": None}
    assert post.call_args.kwargs["json"]["saveToSentItems"] is True
    mailbox.send.assert_not_awaited()
    mailbox.connect.assert_not_awaited()


@pytest.mark.parametrize(
    ("folders", "expected"),
    [
        ([((), b"/", "Sent"), ((b"\\Sent",), b"/", "Gesendet")], "Gesendet"),
        ([((), b"/", "Sent Items")], "Sent Items"),
        ([((), b".", "INBOX.Sent")], "INBOX.Sent"),
    ],
)
def test_sent_folder_discovery(folders, expected):
    client = Mock(spec=IMAPClient)
    client.has_capability.return_value = False
    client.list_folders.side_effect = lambda **kwargs: [
        folder for folder in folders if "pattern" not in kwargs or folder[2] == kwargs["pattern"]
    ]
    client.find_special_folder.side_effect = lambda flag: IMAPClient.find_special_folder(client, flag)

    assert imap_client.ensure_sent_folder(client) == expected
    client.create_folder.assert_not_called()


@pytest.mark.parametrize("prefix", [None, "", "INBOX."])
def test_missing_sent_folder_is_created_in_personal_namespace(prefix):
    client = Mock(spec=IMAPClient)
    client.find_special_folder.return_value = None
    client.has_capability.return_value = prefix is not None
    client.namespace.return_value.personal = ((prefix, "."),)

    expected = (prefix or "") + "Sent"
    assert imap_client.ensure_sent_folder(client) == expected
    client.create_folder.assert_called_once_with(expected)
