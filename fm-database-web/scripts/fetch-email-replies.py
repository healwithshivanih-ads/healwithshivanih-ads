#!/usr/bin/env python3
"""Fetch emails FROM given addresses out of the coach's mailbox — read-only.

Input (stdin JSON):
  {"addresses": ["a@b.com", ...], "since_days": 14, "skip_ids": ["<msg-id>", ...]}

Output (stdout JSON):
  {"ok": true, "messages": [{"message_id", "from", "subject", "date", "text"}], "error": null}

Used by the hourly `email-replies` job (lib/server-actions/email-replies.ts):
prospects' replies are recorded in their thread and a "no more" opts them out.

READ-ONLY by construction: the mailbox is selected with readonly=True and
messages are fetched with BODY.PEEK[], so nothing is marked read, moved or
deleted. Credentials: COACH_GMAIL_USER / COACH_GMAIL_APP_PASSWORD (the account
client email is sent from, so replies land there), falling back to
GMAIL_USER / GMAIL_APP_PASSWORD — the same pair mail-from.ts uses.

Stdlib only (imaplib + email): no new dependency on the Mac or in CI.
"""
from __future__ import annotations

import email
import email.policy
import imaplib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr, parsedate_to_datetime
from html import unescape


def _creds() -> tuple[str, str] | None:
    for u, p in (("COACH_GMAIL_USER", "COACH_GMAIL_APP_PASSWORD"), ("GMAIL_USER", "GMAIL_APP_PASSWORD")):
        user = (os.environ.get(u) or "").strip()
        pw = (os.environ.get(p) or "").strip()
        if user and pw:
            return user, pw
    return None


def _text_of(msg: email.message.EmailMessage) -> str:
    part = msg.get_body(preferencelist=("plain",))
    if part is not None:
        try:
            return part.get_content()
        except Exception:  # noqa: BLE001 — a bad charset must not lose the message
            pass
    part = msg.get_body(preferencelist=("html",))
    if part is not None:
        try:
            html = part.get_content()
        except Exception:  # noqa: BLE001
            return ""
        html = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
        html = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", html)
        return unescape(re.sub(r"<[^>]+>", " ", html))
    return ""


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        json.dump({"ok": False, "messages": [], "error": f"bad input: {e}"}, sys.stdout)
        return 1
    addresses = sorted({a.strip().lower() for a in payload.get("addresses") or [] if isinstance(a, str) and "@" in a})
    skip = set(payload.get("skip_ids") or [])
    since = datetime.now(timezone.utc) - timedelta(days=int(payload.get("since_days") or 14))
    creds = _creds()
    if not creds:
        json.dump({"ok": False, "messages": [], "error": "no mailbox credentials configured"}, sys.stdout)
        return 0
    if not addresses:
        json.dump({"ok": True, "messages": [], "error": None}, sys.stdout)
        return 0

    out = []
    try:
        imap = imaplib.IMAP4_SSL("imap.gmail.com", timeout=30)
        imap.login(*creds)
        imap.select("INBOX", readonly=True)
        since_s = since.strftime("%d-%b-%Y")
        for addr in addresses:
            typ, data = imap.search(None, "SINCE", since_s, "FROM", f'"{addr}"')
            if typ != "OK" or not data or not data[0]:
                continue
            for num in data[0].split():
                typ, msg_data = imap.fetch(num, "(BODY.PEEK[])")
                if typ != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                    continue
                msg = email.message_from_bytes(msg_data[0][1], policy=email.policy.default)
                mid = (msg.get("Message-ID") or "").strip()
                if not mid or mid in skip:
                    continue
                sender = parseaddr(msg.get("From") or "")[1].lower()
                if sender != addr:  # IMAP FROM is a substring match
                    continue
                try:
                    when = parsedate_to_datetime(msg.get("Date")).astimezone(timezone.utc).isoformat()
                except Exception:  # noqa: BLE001
                    when = datetime.now(timezone.utc).isoformat()
                out.append({
                    "message_id": mid,
                    "from": sender,
                    "subject": str(msg.get("Subject") or ""),
                    "date": when,
                    "text": _text_of(msg)[:20000],
                })
        imap.logout()
    except Exception as e:  # noqa: BLE001
        json.dump({"ok": False, "messages": out, "error": f"imap: {e}"}, sys.stdout)
        return 0

    json.dump({"ok": True, "messages": out, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
