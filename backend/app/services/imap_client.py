"""Thin synchronous wrapper around IMAPClient.

All functions here are blocking and are expected to be called via
``asyncio.to_thread`` from async callers - IMAPClient has no native asyncio
support, and running it in a worker thread is simpler and more robust than
reimplementing IMAP async.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from imapclient import IMAPClient


class MessageNotFoundError(Exception):
    pass


HEADER_FETCH_ITEMS = ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "BODY.PEEK[HEADER]"]


@dataclass
class FetchedHeader:
    uid: int
    flags: tuple
    internaldate: datetime | None
    size: int | None
    header_bytes: bytes


def connect_basic(host: str, port: int, use_tls: bool, username: str, password: str) -> IMAPClient:
    client = IMAPClient(host, port=port, ssl=use_tls, timeout=30)
    client.login(username, password)
    return client


def connect_oauth2(
    host: str, port: int, use_tls: bool, username: str, access_token: str
) -> IMAPClient:
    client = IMAPClient(host, port=port, ssl=use_tls, timeout=30)
    client.oauth2_login(username, access_token)
    return client


def list_folders(client: IMAPClient) -> list[str]:
    return [
        path
        for flags, _delim, path in client.list_folders()
        if b"\\noselect"
        not in {
            flag.lower() if isinstance(flag, bytes) else flag.lower().encode() for flag in flags
        }
    ]


def select_folder_uidvalidity(client: IMAPClient, path: str) -> int:
    info = client.select_folder(path, readonly=True)
    return info[b"UIDVALIDITY"]


def list_uids(client: IMAPClient, path: str) -> list[int]:
    client.select_folder(path, readonly=True)
    return sorted(client.search(["ALL"]))


def fetch_headers(client: IMAPClient, path: str, uids: list[int]) -> list[FetchedHeader]:
    client.select_folder(path, readonly=True)
    response = client.fetch(uids, HEADER_FETCH_ITEMS)
    return [
        FetchedHeader(
            uid=uid,
            flags=data.get(b"FLAGS", ()),
            internaldate=data.get(b"INTERNALDATE"),
            size=data.get(b"RFC822.SIZE"),
            header_bytes=data.get(b"BODY[HEADER]", b""),
        )
        for uid, data in sorted(response.items())
    ]


def fetch_flags(client: IMAPClient, path: str, uids: list[int]) -> dict[int, tuple]:
    if not uids:
        return {}
    client.select_folder(path, readonly=True)
    response = client.fetch(uids, ["FLAGS"])
    return {uid: data.get(b"FLAGS", ()) for uid, data in response.items()}


def mark_seen(client: IMAPClient, path: str, uids: list[int]) -> None:
    if not uids:
        return
    client.select_folder(path, readonly=False)
    client.add_flags(uids, [b"\\Seen"])


def find_trash_folder(client: IMAPClient) -> str | None:
    # IMAPClient checks the SPECIAL-USE \Trash attribute first, falling back to
    # common names ("Trash", "Deleted Items", ...) if the server doesn't advertise it.
    return client.find_special_folder(b"\\Trash")


def ensure_sent_folder(client: IMAPClient) -> str:
    # Prefer SPECIAL-USE \Sent (including localized folder names), then the
    # common names and personal namespaces handled by IMAPClient.
    path = client.find_special_folder(b"\\Sent")
    if path is not None:
        return path

    prefix = ""
    if client.has_capability("NAMESPACE"):
        personal = client.namespace().personal
        if personal:
            prefix = personal[0][0]
    path = prefix + "Sent"
    client.create_folder(path)
    return path


def append_sent_message(client: IMAPClient, path: str, raw: bytes, message_id: str) -> None:
    # Some SMTP providers also file a copy. Avoid appending it again if it is
    # already visible; the same Message-ID is used for SMTP and IMAP.
    client.select_folder(path, readonly=True)
    if not client.search(["HEADER", "Message-ID", message_id]):
        client.append(path, raw, flags=[b"\\Seen"])


def move_to_trash(client: IMAPClient, source_path: str, uid: int, trash_path: str) -> None:
    # COPY + STORE \Deleted + EXPUNGE rather than the MOVE extension (RFC 6851) -
    # not every IMAP server supports MOVE, but these three are baseline IMAP4rev1.
    client.select_folder(source_path, readonly=False)
    client.copy([uid], trash_path)
    client.delete_messages([uid])
    client.expunge()


def fetch_full_message(client: IMAPClient, path: str, uid: int, mark_seen: bool = True) -> bytes:
    client.select_folder(path, readonly=not mark_seen)
    item = "BODY[]" if mark_seen else "BODY.PEEK[]"
    response = client.fetch([uid], [item])
    data = response.get(uid, {})
    raw = data.get(b"BODY[]")
    if not raw:
        raise MessageNotFoundError("Message no longer exists on the mail server")
    return raw
