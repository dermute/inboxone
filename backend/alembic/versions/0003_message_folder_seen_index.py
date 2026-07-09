"""index for per-folder unread counts

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-09

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "idx_messages_folder_is_seen", "messages", ["folder_id", "is_seen"]
    )


def downgrade() -> None:
    op.drop_index("idx_messages_folder_is_seen", table_name="messages")
