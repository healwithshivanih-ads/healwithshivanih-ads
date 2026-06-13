#!/usr/bin/env python3
"""Persist a client-app meal swap as a tagged quick_note session.

The client swaps one meal for a coach-approved alternative from their own
plan ("Moong dal khichdi" → "Sama rice khichdi"). This records it so the
coach sees what the client is actually eating — it does NOT rewrite the
plan; it's a note on the day.

Reads JSON from stdin:
{
  "client_id": str,
  "slot": str,            # "Lunch", "Breakfast", ...
  "from_dish": str,
  "to_dish": str,
  "from_kcal": int|null,  # client-side estimates, for the coach's context
  "to_kcal": int|null,
  "date": "YYYY-MM-DD"|null
}

Writes JSON to stdout: {"ok": bool, "session_id": str?, "error": str?}
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _int_or_none(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id = (payload.get("client_id") or "").strip()
    slot = (payload.get("slot") or "").strip()[:40]
    from_dish = (payload.get("from_dish") or "").strip()[:200]
    to_dish = (payload.get("to_dish") or "").strip()[:200]
    if not client_id or not to_dish:
        json.dump({"ok": False, "error": "client_id and to_dish required"}, sys.stdout)
        return 2
    from_kcal = _int_or_none(payload.get("from_kcal"))
    to_kcal = _int_or_none(payload.get("to_kcal"))
    when = (payload.get("date") or "").strip()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not _DATE_RE.match(when):
        when = today

    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml: {e}"}, sys.stdout)
        return 1

    client_dir = _plans_root() / "clients" / client_id
    if not client_dir.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2
    sessions_dir = client_dir / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)

    existing = sorted(sessions_dir.glob(f"{today}-*.yaml")) + sorted(
        sessions_dir.glob(f"{client_id}-{today}-*.yaml")
    )
    session_id = f"{today}-{len(existing) + 1:03d}-app-swap"
    yml = sessions_dir / f"{session_id}.yaml"

    kcal_note = ""
    if from_kcal and to_kcal:
        delta = to_kcal - from_kcal
        kcal_note = f" (~{from_kcal} → ~{to_kcal} kcal, {'+' if delta >= 0 else ''}{delta})"
    summary = f"Client swapped {slot or 'a meal'} on {when}: “{from_dish}” → “{to_dish}”{kcal_note}."

    now_iso = datetime.now(timezone.utc).isoformat()
    data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "quick_note",
        "presenting_complaints": f"[session_type: quick_note] [source: client_app_swap]\n\n{summary}",
        "coach_notes": "",
        "selected_symptoms": [],
        "selected_topics": [],
        "uploaded_files": [],
        "measurements_snapshot": {},
        "ai_analysis": {},
        "chat_log": [],
        "generated_plan_slug": None,
        "five_pillars": None,
        "swap_response": {
            "slot": slot,
            "from_dish": from_dish,
            "to_dish": to_dish,
            "from_kcal": from_kcal,
            "to_kcal": to_kcal,
            "for_date": when,
            "received_at": now_iso,
        },
        "version": 1,
        "created_at": now_iso,
        "updated_at": now_iso,
        "updated_by": "client-app",
    }

    with yml.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)

    json.dump({"ok": True, "session_id": session_id}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
