"""Tracks currently in-flight, user-visible background work (IMAP syncs, message
fetches, sending, etc.) in memory, so the frontend can show a live status bar
instead of leaving the user guessing why something is taking a while.

Single-process, in-memory, intentionally not persisted anywhere - this is purely
a transient "what's happening right now" view, not a history/audit log.
"""

from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from typing import Iterator

_active: dict[str, dict] = {}


@contextmanager
def track(label: str) -> Iterator[None]:
    activity_id = str(uuid.uuid4())
    _active[activity_id] = {"label": label, "started_at": time.time()}
    try:
        yield
    finally:
        _active.pop(activity_id, None)


def snapshot() -> list[dict]:
    now = time.time()
    return [
        {"label": v["label"], "seconds": round(now - v["started_at"], 1)}
        for v in sorted(_active.values(), key=lambda v: v["started_at"])
    ]
