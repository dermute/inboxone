import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto import EncryptedString
from app.db.session import Base


class Protocol(str, enum.Enum):
    IMAP_BASIC = "imap_basic"
    OAUTH_MICROSOFT = "oauth_microsoft"


class AppSettings(Base):
    """Singleton row (id is always 1) holding app-wide settings that need to be
    mutable at runtime - currently just the web UI login password hash, which is
    only *seeded* from the APP_PASSWORD env var on first boot and is authoritative
    afterwards, so it can be reset via the CLI without touching .env."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#4F46E5")
    protocol: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # IMAP (receive) - used by both protocols; Outlook uses XOAUTH2 over the same fields
    imap_host: Mapped[str | None] = mapped_column(String)
    imap_port: Mapped[int | None] = mapped_column(Integer)
    imap_use_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    imap_username: Mapped[str | None] = mapped_column(String)
    imap_password_enc: Mapped[str | None] = mapped_column(EncryptedString)

    # SMTP (send) - basic-auth accounts only
    smtp_host: Mapped[str | None] = mapped_column(String)
    smtp_port: Mapped[int | None] = mapped_column(Integer)
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    smtp_username: Mapped[str | None] = mapped_column(String)
    smtp_password_enc: Mapped[str | None] = mapped_column(EncryptedString)

    # Microsoft OAuth specific
    oauth_client_id: Mapped[str | None] = mapped_column(String)
    oauth_tenant: Mapped[str | None] = mapped_column(String, default="common")
    oauth_token_cache_enc: Mapped[str | None] = mapped_column(EncryptedString)

    sync_interval_seconds: Mapped[int | None] = mapped_column(Integer)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_status: Mapped[str | None] = mapped_column(String)
    last_sync_error: Mapped[str | None] = mapped_column(String)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    folders: Mapped[list["Folder"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (UniqueConstraint("account_id", "imap_path", name="uq_folder_account_path"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    imap_path: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    last_uidvalidity: Mapped[int | None] = mapped_column(Integer)
    last_seen_uid: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    account: Mapped["Account"] = relationship(back_populates="folders")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="folder", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "folder_id", "uid", "uidvalidity", name="uq_message_identity"
        ),
        Index("idx_messages_date_sent", "date_sent"),
        Index("idx_messages_account_folder_uid", "account_id", "folder_id", "uid"),
        Index("idx_messages_folder_is_seen", "folder_id", "is_seen"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    folder_id: Mapped[int] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"))
    uid: Mapped[int] = mapped_column(Integer, nullable=False)
    uidvalidity: Mapped[int] = mapped_column(Integer, nullable=False)

    message_id_header: Mapped[str | None] = mapped_column(String)
    in_reply_to: Mapped[str | None] = mapped_column(String)
    references: Mapped[str | None] = mapped_column(String)

    subject: Mapped[str | None] = mapped_column(String)
    from_name: Mapped[str | None] = mapped_column(String)
    from_addr: Mapped[str | None] = mapped_column(String)
    to_addrs: Mapped[str | None] = mapped_column(String)  # JSON array
    cc_addrs: Mapped[str | None] = mapped_column(String)  # JSON array
    date_sent: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    is_seen: Mapped[bool] = mapped_column(Boolean, default=False)
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    is_answered: Mapped[bool] = mapped_column(Boolean, default=False)
    has_attachments: Mapped[bool] = mapped_column(Boolean, default=False)
    snippet: Mapped[str | None] = mapped_column(String)
    size_bytes: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    account: Mapped["Account"] = relationship(back_populates="messages")
    folder: Mapped["Folder"] = relationship(back_populates="messages")
