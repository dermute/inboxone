import httpx

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def send_mail(
    *,
    access_token: str,
    subject: str,
    body_html: str,
    to: list[str],
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> None:
    def recipients(addrs: list[str]) -> list[dict]:
        return [{"emailAddress": {"address": a}} for a in addrs]

    internet_headers = []
    if in_reply_to:
        internet_headers.append({"name": "In-Reply-To", "value": in_reply_to})
    if references:
        internet_headers.append({"name": "References", "value": references})

    message: dict = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "toRecipients": recipients(to),
    }
    if cc:
        message["ccRecipients"] = recipients(cc)
    if bcc:
        message["bccRecipients"] = recipients(bcc)
    if internet_headers:
        message["internetMessageHeaders"] = internet_headers

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/me/sendMail",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"message": message, "saveToSentItems": True},
        )
        resp.raise_for_status()
