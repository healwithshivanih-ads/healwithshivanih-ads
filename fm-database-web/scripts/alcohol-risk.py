#!/usr/bin/env python3
"""
Shim: does this client get the gentle "skip it" alcohol answer?
(scripts/alcohol_risk.py). Mac only; on Fly the app reads the projected
client.yaml#alcohol_risk.

stdin  {"client_id": str, "plan_slug": str | null}
stdout {"ok": true, "risk": bool} | {"ok": false, "error": str}
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
        slug = str(payload.get("plan_slug") or "")
        if not cid or "/" in cid or ".." in cid or "/" in slug or ".." in slug:
            print(json.dumps({"ok": False, "error": "bad id"}))
            return 0
        import yaml
        from alcohol_risk import alcohol_risk

        root = Path(os.environ.get("FMDB_PLANS_DIR") or Path.home() / "fm-plans").expanduser()
        client = yaml.safe_load((root / "clients" / cid / "client.yaml").read_text(encoding="utf-8")) or {}
        plan = None
        if slug:
            files = sorted((root / "published").glob(f"{slug}-v*.yaml"))
            if files:
                plan = yaml.safe_load(files[-1].read_text(encoding="utf-8")) or {}
        print(json.dumps({"ok": True, "risk": alcohol_risk(client, plan)}))
    except Exception as e:  # never a traceback on stdout
        print(json.dumps({"ok": False, "error": str(e)[:200]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
