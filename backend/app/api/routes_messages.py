from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import require_session
from app.db.models import Account, Message, Protocol
from app.db.session import get_db
from app.schemas.message import (
    AttachmentMeta,
    FlagsUpdate,
    MessageDetail,
    MessageListPage,
    MessageOut,
    ReplyRequest,
)
from app.services import graph_client, imap_client, mail_parser, smtp_client
from app.services.account_connection import get_graph_token, open_imap_connection

router = APIRouter(prefix="/api/messages", tags=["messages"], dependencies=[Depends(require_session)])


def _encode_cursor(date_sent: datetime | None, message_id: int) -> str:
    payload = json.dumps([date_sent.isoformat() if date_sent else None, message_id])
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime | None, int]:
    date_str, message_id = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
    return (datetime.fromisoformat(date_str) if date_str else None, message_id)


@router.get("", response_model=MessageListPage)
async def list_messages(
    account_id: int | None = None,
    folder_id: int | None = None,
    unread_only: bool = False,
    limit: int = 50,
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> MessageListPage:
    query = select(Message).options(selectinload(Message.account))
    if account_id is not None:
        query = query.where(Message.account_id == account_id)
    if folder_id is not None:
        query = query.where(Message.folder_id == folder_id)
    if unread_only:
        query = query.where(Message.is_seen.is_(False))

    if cursor:
        cursor_date, cursor_id = _decode_cursor(cursor)
        query = query.where(
            tuple_(Message.date_sent, Message.id) < tuple_(cursor_date, cursor_id)
        )

    query = query.order_by(Message.date_sent.desc(), Message.id.desc()).limit(limit + 1)
    result = await db.execute(query)
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    rows = rows[:limit]

    items = [
        MessageOut(
            **{
                k: v
                for k, v in m.__dict__.items()
                if k in MessageOut.model_fields and k not in ("to_addrs", "cc_addrs")
            },
            account_color=m.account.color,
            account_name=m.account.name,
            to_addrs=json.loads(m.to_addrs or "[]"),
            cc_addrs=json.loads(m.cc_addrs or "[]"),
        )
        for m in rows
    ]

    next_cursor = _encode_cursor(rows[-1].date_sent, rows[-1].id) if has_more and rows else None
    return MessageListPage(items=items, next_cursor=next_cursor)


async def _fetch_and_parse(db: AsyncSession, message: Message, mark_seen: bool) -> dict:
    account = message.account
    client = await open_imap_connection(db, account)
    try:
        raw = await asyncio.to_thread(
            imap_client.fetch_full_message, client, message.folder.imap_path, message.uid, mark_seen
        )
    finally:
        await asyncio.to_thread(client.logout)
    return mail_parser.parse_full_message(raw)


@router.get("/{message_id}", response_model=MessageDetail)
async def get_message(message_id: int, db: AsyncSession = Depends(get_db)) -> MessageDetail:
    result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(selectinload(Message.account), selectinload(Message.folder))
    )
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")

    parsed = await _fetch_and_parse(db, message, mark_seen=True)

    if not message.is_seen:
        message.is_seen = True
        await db.commit()

    return MessageDetail(
        id=message.id,
        subject=parsed.get("subject"),
        from_name=parsed.get("from_name"),
        from_addr=parsed.get("from_addr"),
        to_addrs=json.loads(parsed.get("to_addrs") or "[]"),
        cc_addrs=json.loads(parsed.get("cc_addrs") or "[]"),
        date_sent=parsed.get("date_sent"),
        text_body=parsed.get("text_body"),
        html_body=parsed.get("html_body"),
        attachments=[AttachmentMeta(**a) for a in parsed.get("attachments", [])],
        message_id_header=parsed.get("message_id_header"),
        references=parsed.get("references"),
    )


@router.get("/{message_id}/attachments/{part_index}")
async def get_attachment(message_id: int, part_index: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(selectinload(Message.account), selectinload(Message.folder))
    )
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")

    account = message.account
    client = await open_imap_connection(db, account)
    try:
        raw = await asyncio.to_thread(
            imap_client.fetch_full_message, client, message.folder.imap_path, message.uid, False
        )
    finally:
        await asyncio.to_thread(client.logout)

    payload, content_type, filename = mail_parser.extract_attachment_bytes(raw, part_index)
    headers = {"Content-Disposition": f'attachment; filename="{filename or "attachment"}"'}
    return Response(content=payload, media_type=content_type, headers=headers)


@router.post("/{message_id}/flags", response_model=MessageOut)
async def update_flags(
    message_id: int, payload: FlagsUpdate, db: AsyncSession = Depends(get_db)
) -> Message:
    result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(selectinload(Message.account), selectinload(Message.folder))
    )
    message = result.scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")

    def _apply_flags():
        client.select_folder(message.folder.imap_path, readonly=False)
        if payload.seen is not None:
            (client.add_flags if payload.seen else client.remove_flags)([message.uid], [b"\\Seen"])
        if payload.flagged is not None:
            (client.add_flags if payload.flagged else client.remove_flags)(
                [message.uid], [b"\\Flagged"]
            )

    client = await open_imap_connection(db, message.account)
    try:
        await asyncio.to_thread(_apply_flags)
        if payload.seen is not None:
            message.is_seen = payload.seen
        if payload.flagged is not None:
            message.is_flagged = payload.flagged
    finally:
        await asyncio.to_thread(client.logout)

    await db.commit()
    return MessageOut(
        **{
            k: v
            for k, v in message.__dict__.items()
            if k in MessageOut.model_fields and k not in ("to_addrs", "cc_addrs")
        },
        account_color=message.account.color,
        account_name=message.account.name,
        to_addrs=json.loads(message.to_addrs or "[]"),
        cc_addrs=json.loads(message.cc_addrs or "[]"),
    )


@router.post("/{message_id}/reply")
async def reply(message_id: int, payload: ReplyRequest, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(selectinload(Message.account), selectinload(Message.folder))
    )
    original = result.scalar_one_or_none()
    if original is None:
        raise HTTPException(status_code=404, detail="Message not found")

    send_account_id = payload.account_id or original.account_id
    account_result = await db.execute(select(Account).where(Account.id == send_account_id))
    account = account_result.scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Send-as account not found")

    if account.protocol == Protocol.OAUTH_MICROSOFT.value:
        token = await get_graph_token(db, account)
        await graph_client.send_mail(
            access_token=token,
            subject=payload.subject,
            body_html=payload.body_html,
            to=payload.to,
            cc=payload.cc,
            bcc=payload.bcc,
            in_reply_to=original.message_id_header,
            references=original.references,
        )
    else:
        mime = mail_parser.build_reply_mime(
            from_addr=account.smtp_username,
            to=payload.to,
            cc=payload.cc,
            bcc=payload.bcc,
            subject=payload.subject,
            body_html=payload.body_html,
            original_message_id=original.message_id_header,
            original_references=original.references,
        )
        await smtp_client.send_basic_auth(
            mime,
            host=account.smtp_host,
            port=account.smtp_port,
            use_tls=account.smtp_use_tls,
            username=account.smtp_username,
            password=account.smtp_password_enc,
        )

    original.is_answered = True
    await db.commit()
    return {"sent": True}
