from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import is_authenticated, login_session, logout_session, verify_app_password
from app.db.session import get_db
from app.schemas.auth import AuthStatus, LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=AuthStatus)
async def login(
    payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> AuthStatus:
    if not await verify_app_password(db, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")
    login_session(request)
    return AuthStatus(authenticated=True)


@router.post("/logout", response_model=AuthStatus)
def logout(request: Request) -> AuthStatus:
    logout_session(request)
    return AuthStatus(authenticated=False)


@router.get("/me", response_model=AuthStatus)
def me(request: Request) -> AuthStatus:
    return AuthStatus(authenticated=is_authenticated(request))
