from fastapi import APIRouter, HTTPException, Request, status

from app.core.security import is_authenticated, login_session, logout_session, verify_app_password
from app.schemas.auth import AuthStatus, LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=AuthStatus)
def login(payload: LoginRequest, request: Request) -> AuthStatus:
    if not verify_app_password(payload.password):
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
