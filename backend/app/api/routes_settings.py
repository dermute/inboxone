from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.security import SETTINGS_ROW_ID, ensure_password_bootstrapped, require_session
from app.db.models import AppSettings
from app.db.session import DBSession
from app.services.app_settings import get_sync_interval
from app.sync import live
from app.sync.scheduler import folders_changed

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_session)])


class RefreshSettings(BaseModel):
    sync_interval_seconds: int = Field(strict=True, ge=60, le=86400, multiple_of=60)


@router.get("", response_model=RefreshSettings)
async def get_settings(db: DBSession) -> RefreshSettings:
    return RefreshSettings(sync_interval_seconds=await get_sync_interval(db))


@router.patch("", response_model=RefreshSettings)
async def update_settings(payload: RefreshSettings, db: DBSession) -> RefreshSettings:
    await ensure_password_bootstrapped(db)
    row = await db.get(AppSettings, SETTINGS_ROW_ID)
    row.sync_interval_seconds = payload.sync_interval_seconds
    await db.commit()
    folders_changed()
    live.publish("settings")
    return payload
