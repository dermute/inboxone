from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.db.models import Account, Folder, Message
from app.db.session import async_session_factory
from app.services import imap_client
from app.services.account_connection import open_imap_connection
from app.services.mail_parser import parse_header_block

logger = logging.getLogger(__name__)

_sync_semaphore = asyncio.Semaphore(get_settings().max_concurrent_syncs)

# How many of the most-recently-cached messages per folder get their flags
# re-checked each poll, since IMAP has no push notification for flag changes
# without the CONDSTORE extension.
FLAG_REFRESH_WINDOW = 200


def _has_attachments(header_bytes: bytes) -> bool:
    # Cheap heuristic from headers alone (no body fetched during sync):
    # a multipart/mixed Content-Type almost always means attachments.
    return b"multipart/mixed" in header_bytes.lower()


async def _sync_folder(client, db: AsyncSession, account: Account, folder: Folder) -> None:
    current_uidvalidity = await asyncio.to_thread(
        imap_client.select_folder_uidvalidity, client, folder.imap_path
    )

    if folder.last_uidvalidity is not None and folder.last_uidvalidity != current_uidvalidity:
        await db.execute(delete(Message).where(Message.folder_id == folder.id))
        folder.last_seen_uid = 0

    if folder.last_uidvalidity is None:
        floor_uid = await asyncio.to_thread(
            imap_client.initial_sync_uid_floor, client, folder.imap_path
        )
        folder.last_seen_uid = floor_uid

    folder.last_uidvalidity = current_uidvalidity

    headers = await asyncio.to_thread(
        imap_client.fetch_new_headers, client, folder.imap_path, folder.last_seen_uid
    )
    for h in headers:
        parsed = parse_header_block(h.header_bytes)
        message = Message(
            account_id=account.id,
            folder_id=folder.id,
            uid=h.uid,
            uidvalidity=current_uidvalidity,
            has_attachments=_has_attachments(h.header_bytes),
            size_bytes=h.size,
            is_seen=b"\\Seen" in h.flags,
            is_flagged=b"\\Flagged" in h.flags,
            is_answered=b"\\Answered" in h.flags,
            **parsed,
        )
        db.add(message)
        folder.last_seen_uid = max(folder.last_seen_uid, h.uid)

    # Bounded flag refresh for already-cached recent messages.
    result = await db.execute(
        select(Message.uid)
        .where(Message.folder_id == folder.id)
        .order_by(Message.uid.desc())
        .limit(FLAG_REFRESH_WINDOW)
    )
    recent_uids = [row[0] for row in result.all()]
    if recent_uids:
        flags_by_uid = await asyncio.to_thread(
            imap_client.fetch_flags, client, folder.imap_path, recent_uids
        )
        for uid, flags in flags_by_uid.items():
            result = await db.execute(
                select(Message).where(Message.folder_id == folder.id, Message.uid == uid)
            )
            msg = result.scalar_one_or_none()
            if msg is None:
                continue
            msg.is_seen = b"\\Seen" in flags
            msg.is_flagged = b"\\Flagged" in flags
            msg.is_answered = b"\\Answered" in flags

    folder.last_synced_at = datetime.now(timezone.utc)


async def sync_account(account_id: int) -> None:
    async with _sync_semaphore:
        async with async_session_factory() as db:
            try:
                result = await db.execute(
                    select(Account)
                    .where(Account.id == account_id, Account.is_active.is_(True))
                    .options(selectinload(Account.folders))
                )
                account = result.scalar_one_or_none()
            except Exception as exc:  # noqa: BLE001 - e.g. a stored credential that fails to
                # decrypt (ENCRYPTION_KEY changed since this account was added) - record it
                # against the account without crashing the scheduler job.
                logger.exception("Failed to load account %s for sync", account_id)
                await db.rollback()
                await db.execute(
                    update(Account)
                    .where(Account.id == account_id)
                    .values(
                        last_sync_status="error",
                        last_sync_error=f"Failed to load account: {exc}",
                        last_sync_at=datetime.now(timezone.utc),
                    )
                )
                await db.commit()
                return

            if account is None:
                return

            try:
                client = await open_imap_connection(db, account)
                try:
                    for folder in account.folders:
                        if folder.sync_enabled:
                            await _sync_folder(client, db, account, folder)
                finally:
                    await asyncio.to_thread(client.logout)

                account.last_sync_status = "ok"
                account.last_sync_error = None
            except Exception as exc:  # noqa: BLE001 - recorded per-account, must not crash the scheduler
                logger.exception("Sync failed for account %s", account_id)
                account.last_sync_status = "error"
                account.last_sync_error = str(exc)
            finally:
                account.last_sync_at = datetime.now(timezone.utc)
                await db.commit()
