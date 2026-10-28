import json

import pytest

from app.services.mail_parser import parse_full_message, parse_header_block


@pytest.mark.parametrize("newline", ["=0D", "=0A", "=0D=0A"])
@pytest.mark.parametrize("field", ["From", "To", "Cc"])
def test_encoded_newlines_in_received_addresses(field, newline):
    raw = (
        f"{field}: =?utf-8?Q?Alice{newline}Smith?= <alice@example.com>\r\n"
        "Subject: Hello\r\n\r\nMessage body\r\n"
    ).encode()

    for parse in (parse_header_block, parse_full_message):
        parsed = parse(raw)
        if field == "From":
            assert parsed["from_addr"] == "alice@example.com"
            assert parsed["from_name"].split() == ["Alice", "Smith"]
        else:
            assert json.loads(parsed[f"{field.lower()}_addrs"]) == ["alice@example.com"]
        assert parsed["subject"] == "Hello"


def test_valid_encoded_and_folded_addresses():
    parsed = parse_header_block(
        b'From: =?utf-8?Q?Doe=2C_Andr=C3=A9?= <andre@example.com>\r\n'
        b'To: Alice <alice@example.com>,\r\n Bob <bob@example.com>\r\n\r\n'
    )
    assert parsed["from_name"] == "Doe, André"
    assert parsed["from_addr"] == "andre@example.com"
    assert json.loads(parsed["to_addrs"]) == ["alice@example.com", "bob@example.com"]
    assert json.loads(parsed["cc_addrs"]) == []
