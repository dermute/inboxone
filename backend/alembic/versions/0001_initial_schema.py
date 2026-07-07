"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-07-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=False, server_default="#4F46E5"),
        sa.Column("protocol", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.Column("imap_host", sa.String()),
        sa.Column("imap_port", sa.Integer()),
        sa.Column("imap_use_tls", sa.Boolean(), server_default=sa.true()),
        sa.Column("imap_username", sa.String()),
        sa.Column("imap_password_enc", sa.String()),
        sa.Column("smtp_host", sa.String()),
        sa.Column("smtp_port", sa.Integer()),
        sa.Column("smtp_use_tls", sa.Boolean(), server_default=sa.true()),
        sa.Column("smtp_username", sa.String()),
        sa.Column("smtp_password_enc", sa.String()),
        sa.Column("oauth_client_id", sa.String()),
        sa.Column("oauth_tenant", sa.String(), server_default="common"),
        sa.Column("oauth_token_cache_enc", sa.String()),
        sa.Column("sync_interval_seconds", sa.Integer()),
        sa.Column("last_sync_at", sa.DateTime(timezone=True)),
        sa.Column("last_sync_status", sa.String()),
        sa.Column("last_sync_error", sa.String()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("imap_path", sa.String(), nullable=False),
        sa.Column("display_name", sa.String()),
        sa.Column("sync_enabled", sa.Boolean(), server_default=sa.true()),
        sa.Column("last_uidvalidity", sa.Integer()),
        sa.Column("last_seen_uid", sa.Integer(), server_default="0"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("account_id", "imap_path", name="uq_folder_account_path"),
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "folder_id", sa.Integer(), sa.ForeignKey("folders.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("uid", sa.Integer(), nullable=False),
        sa.Column("uidvalidity", sa.Integer(), nullable=False),
        sa.Column("message_id_header", sa.String()),
        sa.Column("in_reply_to", sa.String()),
        sa.Column("references", sa.String()),
        sa.Column("subject", sa.String()),
        sa.Column("from_name", sa.String()),
        sa.Column("from_addr", sa.String()),
        sa.Column("to_addrs", sa.String()),
        sa.Column("cc_addrs", sa.String()),
        sa.Column("date_sent", sa.DateTime(timezone=True)),
        sa.Column("is_seen", sa.Boolean(), server_default=sa.false()),
        sa.Column("is_flagged", sa.Boolean(), server_default=sa.false()),
        sa.Column("is_answered", sa.Boolean(), server_default=sa.false()),
        sa.Column("has_attachments", sa.Boolean(), server_default=sa.false()),
        sa.Column("snippet", sa.String()),
        sa.Column("size_bytes", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint(
            "account_id", "folder_id", "uid", "uidvalidity", name="uq_message_identity"
        ),
    )
    op.create_index("idx_messages_date_sent", "messages", ["date_sent"])
    op.create_index("idx_messages_account_folder_uid", "messages", ["account_id", "folder_id", "uid"])


def downgrade() -> None:
    op.drop_index("idx_messages_account_folder_uid", table_name="messages")
    op.drop_index("idx_messages_date_sent", table_name="messages")
    op.drop_table("messages")
    op.drop_table("folders")
    op.drop_table("accounts")
