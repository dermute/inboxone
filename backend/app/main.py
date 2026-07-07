from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.api import routes_accounts, routes_auth, routes_messages, routes_oauth_ms, routes_sync
from app.core.config import get_settings

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.security import ensure_password_bootstrapped
    from app.db.session import async_session_factory
    from app.sync.scheduler import start_scheduler, stop_scheduler

    async with async_session_factory() as db:
        await ensure_password_bootstrapped(db)

    await start_scheduler()
    yield
    await stop_scheduler()


app = FastAPI(title="inboxone", lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key=get_settings().secret_key, max_age=60 * 60 * 24 * 30)

app.include_router(routes_auth.router)
app.include_router(routes_accounts.router)
app.include_router(routes_oauth_ms.router)
app.include_router(routes_messages.router)
app.include_router(routes_sync.router)

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
