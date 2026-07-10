from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """Stores datetimes as UTC and guarantees they always come back timezone-aware.

    SQLite has no real datetime/timezone type - SQLAlchemy's DateTime(timezone=True)
    doesn't actually preserve tzinfo through it, so a value written as
    datetime.now(timezone.utc) round-trips as a *naive* datetime whose clock value
    happens to be UTC. FastAPI/Pydantic then serializes that naive datetime without a
    UTC marker (no "Z"/"+00:00"), and browsers interpret timezone-less ISO strings as
    *local* time - so a client several hours ahead of UTC sees timestamps that look
    hours further in the past than they really are (this is exactly what caused the
    status bar to show "synced 2h ago" right after a sync had just happened).

    Normalizes any tz-aware input to UTC before storing (important for
    Message.date_sent, which comes from parsing arbitrary-timezone email `Date:`
    headers), and re-attaches UTC tzinfo on the way out.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        return value.replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
