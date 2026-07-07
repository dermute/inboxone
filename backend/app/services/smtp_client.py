from email.message import EmailMessage

import aiosmtplib


async def send_basic_auth(
    message: EmailMessage,
    *,
    host: str,
    port: int,
    use_tls: bool,
    username: str,
    password: str,
) -> None:
    await aiosmtplib.send(
        message,
        hostname=host,
        port=port,
        username=username,
        password=password,
        use_tls=use_tls if port == 465 else False,
        start_tls=use_tls if port != 465 else False,
    )


async def test_smtp_connection(
    *, host: str, port: int, use_tls: bool, username: str, password: str
) -> None:
    client = aiosmtplib.SMTP(
        hostname=host,
        port=port,
        use_tls=use_tls if port == 465 else False,
        start_tls=use_tls if port != 465 else False,
    )
    await client.connect()
    try:
        await client.login(username, password)
    finally:
        await client.quit()
