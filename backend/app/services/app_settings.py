from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import SETTINGS_ROW_ID
from app.db.models import AppSettings

DEFAULT_SYNC_INTERVAL_SECONDS = 900


async def get_sync_interval(db: AsyncSession) -> int:
    value = await db.scalar(
        select(AppSettings.sync_interval_seconds).where(AppSettings.id == SETTINGS_ROW_ID)
    )
    return value if value is not None else DEFAULT_SYNC_INTERVAL_SECONDS
