from functools import lru_cache

import bcrypt
from fastapi import HTTPException, Request, status

from app.core.config import get_settings

SESSION_KEY = "authenticated"


@lru_cache
def _app_password_hash() -> bytes:
    return bcrypt.hashpw(get_settings().app_password.encode(), bcrypt.gensalt())


def verify_app_password(password: str) -> bool:
    return bcrypt.checkpw(password.encode(), _app_password_hash())


def login_session(request: Request) -> None:
    request.session[SESSION_KEY] = True


def logout_session(request: Request) -> None:
    request.session.clear()


def is_authenticated(request: Request) -> bool:
    return bool(request.session.get(SESSION_KEY))


def require_session(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
