"""Transient work snapshots shared by SSE and the activity endpoint."""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_active: dict[str, dict] = {}
_parent: ContextVar[str | None] = ContextVar("activity_parent", default=None)


def _publish() -> None:
    from app.sync.live import publish

    publish("activity", items=snapshot())


def begin(
    label: str,
    *,
    kind: str = "operation",
    state: str = "running",
    account_id: int | None = None,
    folder_id: int | None = None,
    message_id: int | None = None,
    folder_ids: set[int] | None = None,
) -> str:
    activity_id = str(uuid.uuid4())
    parent = _parent.get()
    if parent in _active and state == "running":
        _active[parent]["state"] = "running"
    _active[activity_id] = {
        "id": activity_id,
        "label": label,
        "kind": kind,
        "state": state,
        "started_at": time.time(),
        "account_id": account_id,
        "folder_id": folder_id,
        "message_id": message_id,
        "folder_ids": sorted(folder_ids) if folder_ids is not None else None,
        "parent_id": _parent.get(),
    }
    _publish()
    return activity_id


def update(activity_id: str, **values) -> None:
    if activity_id in _active:
        _active[activity_id].update(values)
        _publish()


def finish(activity_id: str) -> None:
    if _active.pop(activity_id, None) is not None:
        _publish()


@contextmanager
def use(activity_id: str) -> Iterator[None]:
    token = _parent.set(activity_id)
    try:
        yield
    finally:
        _parent.reset(token)


@contextmanager
def track(label: str, **metadata) -> Iterator[None]:
    activity_id = begin(label, **metadata)
    try:
        with use(activity_id):
            yield
    finally:
        finish(activity_id)


def snapshot() -> list[dict]:
    # Nested account/folder and request/server phases describe a single operation.
    # Show the most specific active phase rather than counting its parents twice.
    parents = {item["parent_id"] for item in _active.values()}
    current = time.time()
    return [
        {**item, "seconds": round(max(0, current - item["started_at"]), 1)}
        for item in sorted(_active.values(), key=lambda item: item["started_at"])
        if item["id"] not in parents
    ]
