#!/usr/bin/env python
"""JSON shim around fmdb.plan.lifecycle — the one lifecycle resolver.

stdin:  {"today": "YYYY-MM-DD"?, "client_id": "cl-xxx"?, "plans_root": "/path"?}
stdout: {"ok": true, "today": ..., "lifecycles": {client_id: Lifecycle, ...}}

Used by the TS parity test (lifecycle.test.ts) and by chat ("where is X?").
Read-only. `plans_root` is a test hook; production callers leave it unset so
FMDB_PLANS_DIR / ~/fm-plans resolve as everywhere else.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parents[2] / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

from fmdb.plan.lifecycle import resolve_all  # noqa: E402


def _plans_root(payload: dict) -> Path:
    override = str(payload.get("plans_root") or "").strip()
    if override:
        return Path(override).expanduser()
    env = os.environ.get("FMDB_PLANS_DIR", "").strip()
    return Path(env).expanduser() if env else Path.home() / "fm-plans"


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"bad JSON on stdin: {e}"}))
        return
    today = date.today()
    if payload.get("today"):
        try:
            today = date.fromisoformat(str(payload["today"]))
        except ValueError:
            print(json.dumps({"ok": False, "error": "today must be YYYY-MM-DD"}))
            return
    try:
        all_states = resolve_all(_plans_root(payload), today)
    except Exception as e:  # pragma: no cover - defensive
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        return
    want = str(payload.get("client_id") or "").strip()
    if want:
        all_states = {k: v for k, v in all_states.items() if k == want}
    print(json.dumps({"ok": True, "today": today.isoformat(), "lifecycles": all_states}, default=str))


if __name__ == "__main__":
    main()
