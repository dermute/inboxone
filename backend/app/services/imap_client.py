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


def connect_oauth2(host: str, port: int, use_tls: bool, username: str, access_token: str) -> IMAPClient:
    client = IMAPClient(host, port=port, ssl=use_tls, timeout=30)
    client.oauth2_login(username, access_token)
    return client


def list_folders(client: IMAPClient) -> list[str]:
    return [path for _flags, _delim, path in client.list_folders()]


def select_folder_uidvalidity(client: IMAPClient, path: str) -> int:
    info = client.select_folder(path, readonly=True)
    return info[b"UIDVALIDITY"]


def fetch_new_headers(client: IMAPClient, path: str, since_uid: int) -> list[FetchedHeader]:
    client.select_folder(path, readonly=True)
    uids = client.search(["UID", f"{since_uid + 1}:*"])
    uids = [u for u in uids if u > since_uid]
    if not uids:
        return []
    response = client.fetch(uids, HEADER_FETCH_ITEMS)
    results = []
    for uid, data in response.items():
        results.append(
            FetchedHeader(
                uid=uid,
                flags=data.get(b"FLAGS", ()),
                internaldate=data.get(b"INTERNALDATE"),
                size=data.get(b"RFC822.SIZE"),
                header_bytes=data.get(b"BODY[HEADER]", b""),
            )
        )
    return results


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


def fetch_full_message(client: IMAPClient, path: str, uid: int, mark_seen: bool = True) -> bytes:
    client.select_folder(path, readonly=not mark_seen)
    item = "BODY[]" if mark_seen else "BODY.PEEK[]"
    response = client.fetch([uid], [item])
    data = response.get(uid, {})
    return data.get(b"BODY[]", b"")


def initial_sync_uid_floor(client: IMAPClient, path: str, keep_recent: int = 500) -> int:
    """Return a UID high-water-mark floor so the first sync of a large mailbox
    only pulls the most recent `keep_recent` messages instead of the entire history."""
    client.select_folder(path, readonly=True)
    all_uids = client.search(["ALL"])
    if len(all_uids) <= keep_recent:
        return 0
    all_uids.sort()
    return all_uids[-keep_recent - 1]
