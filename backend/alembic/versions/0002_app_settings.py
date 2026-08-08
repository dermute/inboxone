"""app settings (login password storage)

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("password_hash", sa.String(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
