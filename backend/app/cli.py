"""Management CLI, run via `python -m app.cli <command>` (e.g. from `docker exec`).

Intentionally has no login/session requirement of its own - it operates directly on
the database and is meant as the recovery path for a forgotten web UI password.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from app.core.security import set_password
from app.db.session import async_session_factory


def _read_new_password() -> str:
    if sys.stdin.isatty():
        password = getpass.getpass("New password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Passwords did not match.", file=sys.stderr)
            raise SystemExit(1)
    else:
        password = sys.stdin.readline().rstrip("\n")

    if not password:
        print("Password must not be empty.", file=sys.stderr)
        raise SystemExit(1)
    return password


async def _reset_password() -> None:
    new_password = _read_new_password()
    async with async_session_factory() as db:
        await set_password(db, new_password)
    print("Password updated.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("reset-password", help="Set a new web UI login password")

    args = parser.parse_args()
    if args.command == "reset-password":
        asyncio.run(_reset_password())


if __name__ == "__main__":
    main()
