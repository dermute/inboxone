import bcrypt
from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import AppSettings

SESSION_KEY = "authenticated"
SETTINGS_ROW_ID = 1


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


async def ensure_password_bootstrapped(db: AsyncSession) -> None:
    """Seed the stored password hash from APP_PASSWORD on first boot only.

    Once a row exists, the database is authoritative and .env edits are ignored -
    that's what makes `python -m app.cli reset-password` a real, persistent reset
    rather than something a restart would silently undo."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == SETTINGS_ROW_ID))
    if result.scalar_one_or_none() is not None:
        return
    db.add(AppSettings(id=SETTINGS_ROW_ID, password_hash=_hash_password(get_settings().app_password)))
    await db.commit()


async def set_password(db: AsyncSession, new_password: str) -> None:
    result = await db.execute(select(AppSettings).where(AppSettings.id == SETTINGS_ROW_ID))
    row = result.scalar_one_or_none()
    new_hash = _hash_password(new_password)
    if row is None:
        db.add(AppSettings(id=SETTINGS_ROW_ID, password_hash=new_hash))
    else:
        row.password_hash = new_hash
    await db.commit()


async def verify_app_password(db: AsyncSession, password: str) -> bool:
    result = await db.execute(select(AppSettings).where(AppSettings.id == SETTINGS_ROW_ID))
    row = result.scalar_one_or_none()
    if row is None:
        return False
    return bcrypt.checkpw(password.encode(), row.password_hash.encode())


def login_session(request: Request) -> None:
    request.session[SESSION_KEY] = True


def logout_session(request: Request) -> None:
    request.session.clear()


def is_authenticated(request: Request) -> bool:
    return bool(request.session.get(SESSION_KEY))


def require_session(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
