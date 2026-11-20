#!/usr/bin/env python3
"""
Shim: one client's daily nutrient target spec (scripts/day_targets.py).

stdin  {"client_id": str, "plan_week": int | null}
stdout {"ok": true, "targets": {...}} | {"ok": false, "error": str}
Reads the client's full client.yaml under FMDB_PLANS_DIR (Mac). On Fly the app
reads the projected client.yaml#day_targets instead and never runs this.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        cid = str(payload.get("client_id") or "")
        if not cid or "/" in cid or ".." in cid:
            print(json.dumps({"ok": False, "error": "bad client_id"}))
            return 0
        import yaml
        from day_targets import day_targets

        root = Path(os.environ.get("FMDB_PLANS_DIR") or Path.home() / "fm-plans").expanduser()
        f = root / "clients" / cid / "client.yaml"
        client = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        week = payload.get("plan_week")
        print(json.dumps({"ok": True, "targets": day_targets(client, int(week) if week else None)}))
    except Exception as e:  # never a traceback on stdout
        print(json.dumps({"ok": False, "error": str(e)[:200]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
