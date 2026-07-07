from __future__ import annotations

import json
from email.message import EmailMessage, Message
from email.parser import BytesHeaderParser, BytesParser
from email.policy import default as default_policy
from email.utils import getaddresses, parseaddr, parsedate_to_datetime


def parse_header_block(header_bytes: bytes) -> dict:
    msg = BytesHeaderParser(policy=default_policy).parsebytes(header_bytes)
    from_name, from_addr = parseaddr(msg.get("From", ""))
    to_addrs = [addr for _name, addr in getaddresses([msg.get("To", "")]) if addr]
    cc_addrs = [addr for _name, addr in getaddresses([msg.get("Cc", "")]) if addr]

    date_sent = None
    if msg.get("Date"):
        try:
            date_sent = parsedate_to_datetime(msg["Date"])
        except (TypeError, ValueError):
            date_sent = None

    return {
        "subject": msg.get("Subject"),
        "from_name": from_name or None,
        "from_addr": from_addr or None,
        "to_addrs": json.dumps(to_addrs),
        "cc_addrs": json.dumps(cc_addrs),
        "date_sent": date_sent,
        "message_id_header": msg.get("Message-ID"),
        "in_reply_to": msg.get("In-Reply-To"),
        "references": msg.get("References"),
    }


def _iter_attachment_parts(msg: Message):
    index = 0
    for part in msg.walk():
        if part.is_multipart():
            continue
        disposition = (part.get_content_disposition() or "").lower()
        if disposition == "attachment" or (part.get_filename() and disposition != "inline"):
            yield index, part
        index += 1


def parse_full_message(raw: bytes) -> dict:
    msg = BytesParser(policy=default_policy).parsebytes(raw)
    header = parse_header_block(raw)

    text_body = None
    html_body = None
    body_part = msg.get_body(preferencelist=("plain",))
    if body_part is not None:
        text_body = body_part.get_content()
    html_part = msg.get_body(preferencelist=("html",))
    if html_part is not None:
        html_body = html_part.get_content()

    attachments = []
    for index, part in _iter_attachment_parts(msg):
        payload = part.get_payload(decode=True) or b""
        attachments.append(
            {
                "part_index": str(index),
                "filename": part.get_filename(),
                "content_type": part.get_content_type(),
                "size": len(payload),
                "content_id": part.get("Content-ID"),
            }
        )

    return {**header, "text_body": text_body, "html_body": html_body, "attachments": attachments}


def extract_attachment_bytes(raw: bytes, part_index: str) -> tuple[bytes, str, str | None]:
    msg = BytesParser(policy=default_policy).parsebytes(raw)
    for index, part in _iter_attachment_parts(msg):
        if str(index) == part_index:
            payload = part.get_payload(decode=True) or b""
            return payload, part.get_content_type(), part.get_filename()
    raise ValueError(f"Attachment part {part_index} not found")


def build_reply_mime(
    *,
    from_addr: str,
    to: list[str],
    cc: list[str],
    bcc: list[str],
    subject: str,
    body_html: str,
    original_message_id: str | None,
    original_references: str | None,
) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if bcc:
        msg["Bcc"] = ", ".join(bcc)
    msg["Subject"] = subject

    if original_message_id:
        msg["In-Reply-To"] = original_message_id
        references = f"{original_references} {original_message_id}" if original_references else original_message_id
        msg["References"] = references

    # Plain-text fallback derived by stripping tags crudely is skipped - we send
    # HTML as the primary representation with a simple plain-text mirror.
    import re

    plain_fallback = re.sub("<[^<]+?>", "", body_html)
    msg.set_content(plain_fallback)
    msg.add_alternative(body_html, subtype="html")
    return msg
