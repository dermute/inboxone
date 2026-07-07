"""Resolves an Account ORM row into a live IMAP connection / send credentials,
branching on protocol (imap_basic vs oauth_microsoft) so callers (routes, sync
worker) don't need to duplicate that branching logic.
"""

from __future__ import annotations

import asyncio

from imapclient import IMAPClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Account, Protocol
from app.services import imap_client, oauth_microsoft


async def _persist_new_token_cache(db: AsyncSession, account: Account, new_cache: str | None) -> None:
    if new_cache is None:
        return
    account.oauth_token_cache_enc = new_cache
    db.add(account)
    await db.commit()


async def open_imap_connection(db: AsyncSession, account: Account) -> IMAPClient:
    if account.protocol == Protocol.IMAP_BASIC.value:
        return await asyncio.to_thread(
            imap_client.connect_basic,
            account.imap_host,
            account.imap_port,
            account.imap_use_tls,
            account.imap_username,
            account.imap_password_enc,
        )

    if account.protocol == Protocol.OAUTH_MICROSOFT.value:
        token, new_cache = await oauth_microsoft.get_imap_access_token(
            account.oauth_client_id,
            account.oauth_tenant or "common",
            account.oauth_token_cache_enc,
        )
        await _persist_new_token_cache(db, account, new_cache)
        return await asyncio.to_thread(
            imap_client.connect_oauth2,
            account.imap_host or "outlook.office365.com",
            account.imap_port or 993,
            True,
            account.imap_username,
            token,
        )

    raise ValueError(f"Unknown protocol: {account.protocol}")


async def get_graph_token(db: AsyncSession, account: Account) -> str:
    token, new_cache = await oauth_microsoft.get_graph_access_token(
        account.oauth_client_id,
        account.oauth_tenant or "common",
        account.oauth_token_cache_enc,
    )
    await _persist_new_token_cache(db, account, new_cache)
    return token
