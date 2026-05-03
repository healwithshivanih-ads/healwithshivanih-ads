#!/usr/bin/env python3
"""Thin shim wrapping fmdb.plan.storage.load_session for the Next.js UI.

Loads the persisted chat_log for a session so the Assess chat panel can
rehydrate prior conversation when the page reloads (or the coach navigates
back). Returns an empty list — not an error — when the session has no
chat_log yet, so the UI can call this unconditionally on mount.

Reads JSON from stdin:
{
  "client_id":  str,
  "session_id": str,
  "dry_run":    bool   # if true, returns an empty list without touching disk
}

Writes JSON to stdout:
{
  "ok":       bool,
  "chat_log": [{"role": "user"|"assistant", "content": str, "at"?: iso}],
  "error":    str | null
}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
sys.path.insert(0, str(FMDB_ROOT))


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "chat_log": [], "error": f"invalid JSON on stdin: {e}"}, sys.stdout)
        return 2

    client_id = payload.get("client_id") or ""
    session_id = payload.get("session_id") or ""
    dry_run = bool(payload.get("dry_run"))

    if dry_run:
        json.dump({"ok": True, "chat_log": [], "error": None}, sys.stdout)
        return 0

    if not client_id or not session_id:
        json.dump(
            {"ok": False, "chat_log": [], "error": "client_id and session_id are required"},
            sys.stdout,
        )
        return 2

    from fmdb.plan import storage as plan_storage

    root = plan_storage.plans_root()

    try:
        session = plan_storage.load_session(root, client_id, session_id)
    except FileNotFoundError as e:
        json.dump(
            {"ok": False, "chat_log": [], "error": f"session not found: {session_id} ({e})"},
            sys.stdout,
        )
        return 2

    out = []
    for turn in session.chat_log or []:
        # ChatTurn is a Pydantic model; .role / .content / .at are attributes.
        item = {
            "role": getattr(turn, "role", None),
            "content": getattr(turn, "content", None),
        }
        at = getattr(turn, "at", None)
        if at is not None:
            item["at"] = at.isoformat() if hasattr(at, "isoformat") else str(at)
        out.append(item)

    json.dump({"ok": True, "chat_log": out, "error": None}, sys.stdout, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
