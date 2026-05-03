#!/usr/bin/env python3
"""Thin shim wrapping fmdb backlog-promote / backlog-reject for the Next.js UI.

Reads JSON from stdin:
{
  "action": "promote" | "reject",
  "id": str,
  # promote-only:
  "kind": str | null,
  "slug": str | null,
  "display_name": str | null,
  "force": bool,
  "updated_by": str | null,
  # reject-only:
  "note": str | null
}

Writes JSON to stdout:
{ "ok": bool, "stdout": str, "stderr": str, "error": str | null, "code": int }
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
PY = FMDB_ROOT / ".venv/bin/python"


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}", "code": 2}, sys.stdout)
        return 2

    action = payload.get("action")
    item_id = payload.get("id")
    if not action or not item_id:
        json.dump({"ok": False, "error": "action and id required", "code": 2}, sys.stdout)
        return 2

    if action == "promote":
        argv = [str(PY), "-m", "fmdb.cli", "backlog-promote", str(item_id)]
        if payload.get("kind"):
            argv += ["--kind", str(payload["kind"])]
        if payload.get("slug"):
            argv += ["--slug", str(payload["slug"])]
        if payload.get("display_name"):
            argv += ["--display-name", str(payload["display_name"])]
        if payload.get("force"):
            argv += ["--force"]
        if payload.get("updated_by"):
            argv += ["--updated-by", str(payload["updated_by"])]
    elif action == "reject":
        argv = [str(PY), "-m", "fmdb.cli", "backlog-reject", str(item_id)]
        if payload.get("note"):
            argv += ["--note", str(payload["note"])]
    else:
        json.dump({"ok": False, "error": f"unknown action: {action}", "code": 2}, sys.stdout)
        return 2

    env = dict(os.environ)
    proc = subprocess.run(
        argv, capture_output=True, text=True, cwd=str(FMDB_ROOT), env=env, timeout=60
    )
    json.dump({
        "ok": proc.returncode == 0,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "code": proc.returncode,
        "error": None if proc.returncode == 0 else proc.stderr.strip()[:500] or "non-zero exit",
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
