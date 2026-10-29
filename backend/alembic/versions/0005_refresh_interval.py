"""Persist the global automatic refresh interval.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("sync_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "sync_interval_seconds")
