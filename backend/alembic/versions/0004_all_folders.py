"""Sync all folders and separate inbox membership from synchronization.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "folders", sa.Column("is_inbox", sa.Boolean(), nullable=False, server_default="0")
    )
    op.add_column(
        "folders", sa.Column("history_complete", sa.Boolean(), nullable=False, server_default="0")
    )
    op.add_column(
        "messages",
        sa.Column("notification_eligible", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.execute("UPDATE folders SET is_inbox = 1 WHERE lower(imap_path) = 'inbox'")
    # Replay all UIDs, retaining existing message IDs through idempotent inserts.
    op.execute("UPDATE folders SET last_seen_uid = 0")
    op.drop_column("folders", "sync_enabled")


def downgrade() -> None:
    op.add_column("folders", sa.Column("sync_enabled", sa.Boolean(), server_default=sa.true()))
    op.drop_column("messages", "notification_eligible")
    op.drop_column("folders", "history_complete")
    op.drop_column("folders", "is_inbox")
