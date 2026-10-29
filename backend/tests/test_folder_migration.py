"""Exercise the real Alembic upgrade against populated pre-feature databases."""

import sqlite3
from pathlib import Path
from types import SimpleNamespace

from alembic.config import Config

from alembic import command
from app.core import config


def test_upgrade_preserves_messages_and_backfills_all_existing_folders(tmp_path, monkeypatch):
    database = tmp_path / "migration.db"
    monkeypatch.setattr(
        config,
        "get_settings",
        lambda: SimpleNamespace(
            database_url=f"sqlite+aiosqlite:///{database}",
        ),
    )
    backend = Path(__file__).resolve().parents[1]
    alembic = Config(str(backend / "alembic.ini"))
    alembic.set_main_option("script_location", str(backend / "alembic"))
    command.upgrade(alembic, "0003")
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO app_settings (id, password_hash) VALUES (1, 'existing-hash')")
        db.execute("INSERT INTO accounts (id, name, protocol) VALUES (1, 'Example', 'imap_basic')")
        db.execute("""INSERT INTO folders
            (id, account_id, imap_path, sync_enabled, last_uidvalidity, last_seen_uid)
            VALUES (1, 1, 'inbox', 1, 123, 900), (2, 1, 'Sent', 0, 456, 700)""")
        db.execute("""INSERT INTO messages (id, account_id, folder_id, uid, uidvalidity, is_seen)
            VALUES (42, 1, 1, 900, 123, 1)""")
    command.upgrade(alembic, "head")
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT password_hash, sync_interval_seconds FROM app_settings"
        ).fetchall() == [("existing-hash", 900)]
        assert db.execute(
            "SELECT id, is_inbox, history_complete, last_seen_uid, last_uidvalidity "
            "FROM folders ORDER BY id"
        ).fetchall() == [
            (1, 1, 0, 0, 123),
            (2, 0, 0, 0, 456),
        ]
        assert db.execute(
            "SELECT id, uid, is_seen, notification_eligible FROM messages"
        ).fetchall() == [
            (42, 900, 1, 0),
        ]
        assert "sync_enabled" not in [row[1] for row in db.execute("PRAGMA table_info(folders)")]
    command.downgrade(alembic, "0003")
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT id FROM messages").fetchall() == [(42,)]
        assert db.execute("SELECT sync_enabled FROM folders").fetchall() == [(1,), (1,)]
