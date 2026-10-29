"""Process-local events, presence leases, and sanitized connection state."""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime

subscribers: set[asyncio.Queue] = set()
leases: dict[str, float] = {}
watchers: dict[int, dict] = {}
account_errors: dict[int, dict] = {}


def now() -> str:
    return datetime.now(UTC).isoformat()


def safe_error(exc: Exception) -> str:
    # Server errors may echo passwords, bearer tokens, or token caches. Never expose
    # arbitrary exception text via status APIs or persistent account error fields.
    name = type(exc).__name__.lower()
    if any(word in name for word in ("login", "auth")):
        return "Authentication failed. Check credentials or reconnect OAuth."
    if any(word in name for word in ("invalidtoken", "valueerror")):
        return "Account configuration or stored credentials could not be read."
    return "Mail server connection or reconciliation failed. Retry or check server settings."


def publish(kind: str, **data) -> None:
    event = {"type": kind, **data}
    for queue in tuple(subscribers):
        if queue.full():
            while not queue.empty():
                queue.get_nowait()
            queue.put_nowait({"type": "snapshot"})
        else:
            queue.put_nowait(event)


def presence(client_id: str, visible: bool) -> None:
    if visible:
        leases[client_id] = time.monotonic() + 60
    else:
        leases.pop(client_id, None)


def visible() -> bool:
    current = time.monotonic()
    for key, expiry in list(leases.items()):
        if expiry <= current:
            leases.pop(key, None)
    return bool(leases)


def set_watcher(folder_id: int, **values) -> None:
    watchers.setdefault(folder_id, {}).update(values)
    publish("connection", account_id=watchers[folder_id].get("account_id"), folder_id=folder_id)


def synced(account_id: int, folder_id: int) -> None:
    watchers.setdefault(folder_id, {}).update(
        last_success=now(), sync_error=None, sync_error_at=None
    )
    if watchers[folder_id].get("state") == "reconciling":
        watchers[folder_id]["state"] = "connected"
    publish("folder", account_id=account_id, folder_id=folder_id)


def sync_failed(account_id: int, folder_id: int | None, exc: Exception) -> None:
    error = {"error": safe_error(exc), "error_at": now()}
    if folder_id is not None:
        watchers.setdefault(folder_id, {}).update(
            sync_error=error["error"], sync_error_at=error["error_at"]
        )
    else:
        account_errors[account_id] = error
    publish("connection", account_id=account_id, folder_id=folder_id)


async def snapshot() -> dict:
    from sqlalchemy import select

    from app.db.models import Account, Folder
    from app.db.session import async_session_factory
    from app.services.app_settings import get_sync_interval

    async with async_session_factory() as db:
        interval = await get_sync_interval(db)
        accounts = (
            await db.execute(
                select(Account.id, Account.name, Account.color).where(Account.is_active.is_(True))
            )
        ).all()
        folders = (
            await db.execute(
                select(
                    Folder.id,
                    Folder.account_id,
                    Folder.display_name,
                    Folder.imap_path,
                    Folder.is_inbox,
                    Folder.last_synced_at,
                )
            )
        ).all()
    result = []
    for account in accounts:
        items = []
        for folder in folders:
            if folder.account_id != account.id:
                continue
            state = dict(watchers.get(folder.id, {}))
            state.update(
                folder_id=folder.id,
                name=folder.display_name or folder.imap_path,
                is_inbox=folder.is_inbox,
                last_success=state.get("last_success")
                or (folder.last_synced_at.isoformat() if folder.last_synced_at else None),
            )
            state.setdefault("state", "connecting" if folder.is_inbox else "scheduled")
            state.setdefault("mode", "idle" if folder.is_inbox else "scheduled")
            state["health"] = (
                "red"
                if state.get("sync_error") or state["state"] == "error"
                else "yellow"
                if folder.is_inbox and state["state"] != "connected"
                else "green"
            )
            items.append(state)
        error = account_errors.get(account.id, {})
        health = (
            "red"
            if error
            else "red"
            if any(f["health"] == "red" for f in items)
            else "yellow"
            if not items or any(f["health"] == "yellow" for f in items)
            else "green"
        )
        result.append(
            dict(
                account_id=account.id,
                name=account.name,
                color=account.color,
                health=health,
                folders=items,
                **error,
            )
        )
    health = (
        "neutral"
        if not result
        else "red"
        if any(a["health"] == "red" for a in result)
        else "yellow"
        if any(a["health"] == "yellow" for a in result)
        else "green"
    )
    return {
        "health": health,
        "accounts": result,
        "visible": visible(),
        "refresh_seconds": interval,
    }
