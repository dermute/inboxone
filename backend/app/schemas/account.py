from datetime import datetime

from pydantic import BaseModel, Field


class FolderOut(BaseModel):
    id: int
    imap_path: str
    display_name: str | None
    is_inbox: bool
    history_complete: bool
    last_synced_at: datetime | None
    unread_count: int = 0

    model_config = {"from_attributes": True}


class FolderSelection(BaseModel):
    imap_path: str
    is_inbox: bool
    display_name: str | None = None


class FolderListUpdate(BaseModel):
    folders: list[FolderSelection]


class AccountBase(BaseModel):
    name: str
    color: str = Field(default="#4F46E5", pattern=r"^#[0-9A-Fa-f]{6}$")


class AccountCreateBasic(AccountBase):
    protocol: str = "imap_basic"
    imap_host: str
    imap_port: int = 993
    imap_use_tls: bool = True
    imap_username: str
    imap_password: str
    smtp_host: str
    smtp_port: int = 587
    smtp_use_tls: bool = True
    smtp_username: str
    smtp_password: str
    sync_interval_seconds: int | None = Field(
        default=None, description="Legacy compatibility field; fixed IDLE/visibility scheduling supersedes it."
    )


class AccountUpdateBasic(BaseModel):
    name: str | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    imap_host: str | None = None
    imap_port: int | None = None
    imap_use_tls: bool | None = None
    imap_username: str | None = None
    imap_password: str | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_use_tls: bool | None = None
    smtp_username: str | None = None
    smtp_password: str | None = None
    sync_interval_seconds: int | None = Field(
        default=None, description="Legacy compatibility field; fixed IDLE/visibility scheduling supersedes it."
    )
    is_active: bool | None = None


class AccountOut(BaseModel):
    id: int
    name: str
    color: str
    protocol: str
    is_active: bool
    imap_host: str | None
    imap_port: int | None
    imap_use_tls: bool
    imap_username: str | None
    smtp_host: str | None
    smtp_port: int | None
    smtp_use_tls: bool
    smtp_username: str | None
    oauth_client_id: str | None
    oauth_tenant: str | None
    sync_interval_seconds: int | None
    last_sync_at: datetime | None
    last_sync_status: str | None
    last_sync_error: str | None
    folders: list[FolderOut] = []

    model_config = {"from_attributes": True}


class TestConnectionResult(BaseModel):
    imap_ok: bool
    imap_error: str | None = None
    smtp_ok: bool | None = None
    smtp_error: str | None = None
