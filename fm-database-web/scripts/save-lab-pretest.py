#!/usr/bin/env python3
"""Record pre-test answers for one lab draw, then rebuild the lab read.

Reads JSON from stdin:
{
  "client_id": str,
  "date": "YYYY-MM-DD",        # the draw (health_snapshots[].date)
  "pretest": {...}             # fmdb.plan.models.LabPretest fields
}

Sets `pretest` on every lab-bearing snapshot of that date (a CBC and a
biochemistry report from one morning share the answers), then rebuilds
lab_markers + lab_synthesis so the confounders take effect at once. $0.

Writes JSON to stdout: {"ok": bool, "snapshots": int, "markers_count": int,
"error": str | null}. Warnings go to stderr only.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _fail(msg: str, code: int = 2) -> int:
    json.dump({"ok": False, "snapshots": 0, "markers_count": 0, "error": msg}, sys.stdout)
    return code


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        return _fail(f"invalid JSON: {e}")
    client_id = str(payload.get("client_id") or "")
    date = str(payload.get("date") or "")
    if not client_id or "/" in client_id or ".." in client_id:
        return _fail("client_id is required")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return _fail("date must be YYYY-MM-DD")
    if not isinstance(payload.get("pretest"), dict):
        return _fail("pretest is required")

    try:
        import yaml  # type: ignore
        from fmdb.plan.models import LabPretest  # type: ignore
        from fmdb.assess.lab_rebuild import rebuild_lab_outputs  # type: ignore
    except Exception as e:
        return _fail(f"import failed: {e}", 1)

    try:
        pretest = LabPretest(**payload["pretest"])
    except Exception as e:
        return _fail(f"invalid pretest: {e}")
    block = pretest.model_dump(mode="json", exclude_none=True, exclude_defaults=True)
    block["recorded_at"] = datetime.now().isoformat(timespec="seconds")

    path = plans_root() / "clients" / client_id / "client.yaml"
    if not path.exists():
        return _fail(f"client not found: {client_id}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    hits = 0
    for snap in data.get("health_snapshots") or []:
        if isinstance(snap, dict) and snap.get("date") == date and snap.get("lab_values"):
            snap["pretest"] = dict(block)
            hits += 1
    if not hits:
        return _fail(f"no lab snapshot dated {date}")

    try:
        n = rebuild_lab_outputs(data)
    except Exception as e:
        print(f"WARN: lab rebuild failed: {e}", file=sys.stderr)
        n = 0
    data["version"] = (data.get("version") or 1) + 1
    with path.open("w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    json.dump({"ok": True, "snapshots": hits, "markers_count": n, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
