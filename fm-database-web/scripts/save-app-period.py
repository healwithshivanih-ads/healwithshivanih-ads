#!/usr/bin/env python3
"""Persist a client-app period-start update (drives seed cycling).

The client taps "My period started today" in the app's seed-cycling section
so the app can work out which seeds to eat each day. This writes the new
period-start date into the SAME field the coach dashboard + plan generator
read, so the cycle phase stays accurate everywhere:

  · client.last_menstrual_period  — ISO date, period START (cycle Day 1)
  · client.cycle_status           — set to "menstruating" if it was blank

Reads JSON from stdin:
{
  "client_id": str,
  "date": "YYYY-MM-DD" | null   # optional; defaults to today (UTC)
}

Writes JSON to stdout: {"ok": bool, "last_menstrual_period": str?, "error": str?}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date as date_cls, datetime, timezone
from pathlib import Path


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _valid_date(s) -> "str | None":
    """Accept an ISO date within a sane window (not far future, not ancient)."""
    if not isinstance(s, str) or not s.strip():
        return None
    try:
        d = date_cls.fromisoformat(s.strip())
    except ValueError:
        return None
    today = datetime.now(timezone.utc).date()
    delta = (today - d).days
    # allow up to ~2 days in the future (timezone slack) and ~120 days back
    if delta < -2 or delta > 120:
        return None
    return d.isoformat()


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        json.dump({"ok": False, "error": "client_id required"}, sys.stdout)
        return 2

    new_date = _valid_date(payload.get("date")) or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml: {e}"}, sys.stdout)
        return 1

    client_yaml = _plans_root() / "clients" / client_id / "client.yaml"
    if not client_yaml.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    try:
        with client_yaml.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except yaml.YAMLError as e:
        json.dump({"ok": False, "error": f"could not read client.yaml: {e}"}, sys.stdout)
        return 1
    if not isinstance(data, dict):
        json.dump({"ok": False, "error": "client.yaml is not a mapping"}, sys.stdout)
        return 1

    data["last_menstrual_period"] = new_date
    # If the client is confirming a period, she is menstruating — only set when
    # blank so we never overwrite a coach-set perimenopausal/other status.
    if not (data.get("cycle_status") or "").strip():
        data["cycle_status"] = "menstruating"

    tmp = client_yaml.with_suffix(".yaml.tmp")
    try:
        with tmp.open("w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
        os.replace(tmp, client_yaml)
    except OSError as e:
        json.dump({"ok": False, "error": f"write failed: {e}"}, sys.stdout)
        return 1
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass

    json.dump({"ok": True, "last_menstrual_period": new_date}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
