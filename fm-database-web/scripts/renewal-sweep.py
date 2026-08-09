#!/usr/bin/env python
"""JSON shim around fmdb.plan.renewals.sweep — the daily lapse pass.

stdin:  {"apply": bool, "grace_days": int?, "today": "YYYY-MM-DD"?}
stdout: the sweep report (see fmdb.plan.renewals.sweep)

`apply` defaults to FALSE. A shim that lapsed clients when its caller forgot a
flag would be a client-visible write triggered by an omission, so the safe
value is the default and the caller has to ask for the write.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parents[2] / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

from fmdb.plan.renewals import RENEWAL_GRACE_DAYS, sweep  # noqa: E402


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR", "").strip()
    return Path(env).expanduser() if env else Path.home() / "fm-plans"


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"bad JSON on stdin: {e}"}))
        return

    today = None
    if payload.get("today"):
        try:
            today = date.fromisoformat(str(payload["today"]))
        except ValueError:
            print(json.dumps({"ok": False, "error": "today must be YYYY-MM-DD"}))
            return

    try:
        report = sweep(
            _plans_root(),
            today=today,
            apply=bool(payload.get("apply", False)),
            grace_days=int(payload.get("grace_days") or RENEWAL_GRACE_DAYS),
        )
    except Exception as e:  # pragma: no cover - defensive
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        return

    print(json.dumps(report, default=str))


if __name__ == "__main__":
    main()
