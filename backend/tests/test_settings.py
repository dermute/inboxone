import httpx
import pytest
from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware
from test_folder_sync import mail as mailbox_fixture

from app.api import routes_settings
from app.core.security import require_session, verify_app_password
from app.db.models import AppSettings
from app.db.session import get_db
from app.services.app_settings import get_sync_interval

mail = mailbox_fixture


@pytest.mark.asyncio
async def test_refresh_settings_auth_validation_and_persistence(mail):
    app = FastAPI()
    app.add_middleware(SessionMiddleware, secret_key="test-session")
    app.include_router(routes_settings.router)

    async def db():
        async with mail.factory() as connection:
            yield connection

    app.dependency_overrides[get_db] = db
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for method in (client.get, client.patch):
            assert (await method("/api/settings")).status_code == 401
        app.dependency_overrides[require_session] = lambda: None
        assert (await client.get("/api/settings")).json() == {"sync_interval_seconds": 900}
        for value in (None, True, "900", 0, 59, 61, 900.5, 86460):
            response = await client.patch("/api/settings", json={"sync_interval_seconds": value})
            assert response.status_code == 422
        assert (await client.get("/api/settings")).json() == {"sync_interval_seconds": 900}
        for value in (60, 86400, 1800):
            response = await client.patch("/api/settings", json={"sync_interval_seconds": value})
            assert response.status_code == 200
            assert response.json() == {"sync_interval_seconds": value}
        # A new database session reads the saved value; password bootstrap/reset
        # continues to use the same singleton without changing the interval.
        async with mail.factory() as connection:
            assert await get_sync_interval(connection) == 1800
            assert await verify_app_password(connection, "test-password")
            row = await connection.get(AppSettings, 1)
            assert row.password_hash not in response.text
        assert (await client.get("/api/settings")).json() == {"sync_interval_seconds": 1800}
