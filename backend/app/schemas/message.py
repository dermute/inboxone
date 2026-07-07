from datetime import datetime

from pydantic import BaseModel


class MessageOut(BaseModel):
    id: int
    account_id: int
    account_color: str
    account_name: str
    folder_id: int
    subject: str | None
    from_name: str | None
    from_addr: str | None
    to_addrs: list[str] = []
    cc_addrs: list[str] = []
    date_sent: datetime | None
    is_seen: bool
    is_flagged: bool
    is_answered: bool
    has_attachments: bool
    snippet: str | None

    model_config = {"from_attributes": True}


class MessageListPage(BaseModel):
    items: list[MessageOut]
    next_cursor: str | None = None


class AttachmentMeta(BaseModel):
    part_index: str
    filename: str | None
    content_type: str
    size: int | None
    content_id: str | None = None


class MessageDetail(BaseModel):
    id: int
    subject: str | None
    from_name: str | None
    from_addr: str | None
    to_addrs: list[str] = []
    cc_addrs: list[str] = []
    date_sent: datetime | None
    text_body: str | None
    html_body: str | None
    attachments: list[AttachmentMeta] = []
    message_id_header: str | None
    references: str | None


class FlagsUpdate(BaseModel):
    seen: bool | None = None
    flagged: bool | None = None


class ReplyRequest(BaseModel):
    account_id: int | None = None
    to: list[str]
    cc: list[str] = []
    bcc: list[str] = []
    subject: str
    body_html: str
