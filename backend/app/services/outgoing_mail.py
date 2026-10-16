"""SMTP submission and provider-side storage of the sender's copy."""

from __future__ import annotations

import asyncio
import logging
from email.message import EmailMessage
from email.policy import SMTP

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Account
from app.services import imap_client, smtp_client
from app.services.account_connection import open_imap_connection

logger = logging.getLogger(__name__)


async def send_smtp_and_save(
    db: AsyncSession, account: Account, message: EmailMessage
) -> str | None:
    """Return a warning if delivery succeeded but saving the Sent copy failed.

    Failures before SMTP submission propagate normally. After submission, never
    report a send failure that would invite the user to send the message again.
    """
    # Freeze MIME boundaries before SMTP serializes its own copy of the message.
    raw = message.as_bytes(policy=SMTP)
    # Gmail saves SMTP submissions itself, even if its copy appears later over
    # IMAP. Appending here would race that copy and could create duplicates.
    # https://support.google.com/mail/answer/78892
    gmail_saves_sent = (
        (account.smtp_host or "").lower() in {"smtp.gmail.com", "smtp.googlemail.com"}
        and (account.imap_host or "").lower() in {"imap.gmail.com", "imap.googlemail.com"}
    )

    client = None
    try:
        if not gmail_saves_sent:
            # Check access and resolve/create Sent before sending, while a
            # failure can still safely be retried without duplicate delivery.
            client = await open_imap_connection(db, account)
            sent_path = await asyncio.to_thread(imap_client.ensure_sent_folder, client)

        await smtp_client.send_basic_auth(
            message,
            host=account.smtp_host,
            port=account.smtp_port,
            use_tls=account.smtp_use_tls,
            username=account.smtp_username,
            password=account.smtp_password_enc,
        )

        if client is not None:
            try:
                await asyncio.to_thread(
                    imap_client.append_sent_message,
                    client,
                    sent_path,
                    raw,
                    str(message["Message-ID"]),
                )
            except Exception:
                logger.exception("Sent mail could not be saved for account %s", account.id)
                return (
                    "Your message was sent, but its copy could not be saved in the account's "
                    "Sent folder. Do not send it again."
                )
    finally:
        if client is not None:
            try:
                await asyncio.to_thread(client.logout)
            except Exception:
                logger.exception("IMAP logout failed for account %s after sending", account.id)

    return None
