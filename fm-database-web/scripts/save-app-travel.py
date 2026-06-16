#!/usr/bin/env python3
"""Persist a client-app travel flag as a tagged quick_note session.

Travel mode (2026-06-12): the client marks "I'm travelling" in the app
with a date range + optional context (where / eating situation). The
session carries a structured `travel_response` (Session is
extra="ignore" — rides as an extra key, no model change) which:
  · the app loader reads to show a rules-based travel card and pause
    the grocery list during the window,
  · generate-week-menu.py reads as feedback so the drafted week leans
    on travel-friendly guidance instead of full home cooking.

Reads JSON from stdin:
{
  "client_id": str,
  "from": "YYYY-MM-DD",
  "to": "YYYY-MM-DD",
  "context": str,            # free text, e.g. "Work trip, hotel + restaurants"
  "cancelled": bool          # true = client tapped "I'm back / cancel travel"
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

    cancelled = bool(payload.get("cancelled"))
    d_from = (payload.get("from") or "").strip()
    d_to = (payload.get("to") or "").strip()
    context = (payload.get("context") or "").strip()[:600]
    # Structured situation type + destination (step 1, 2026-06-16). `kind`
    # drives the in-app card + the local-foods render cascade; `location`
    # is the destination for travel/festival (e.g. "Sydney, Australia").
    kind = (payload.get("kind") or "travel").strip().lower()
    if kind not in ("travel", "festival", "illness"):
        kind = "travel"
    location = (payload.get("location") or "").strip()[:120]

    if not cancelled:
        if not (_DATE_RE.match(d_from) and _DATE_RE.match(d_to)):
            json.dump({"ok": False, "error": "from/to must be YYYY-MM-DD"}, sys.stdout)
            return 2
        if d_to < d_from:
            d_from, d_to = d_to, d_from

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

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = sorted(sessions_dir.glob(f"{today}-*.yaml")) + sorted(
        sessions_dir.glob(f"{client_id}-{today}-*.yaml")
    )
    session_id = f"{today}-{len(existing) + 1:03d}-app-travel"
    yml = sessions_dir / f"{session_id}.yaml"

    if cancelled:
        summary = "Client cancelled away/travel mode from the app — back to the regular plan."
    else:
        _kind_word = {"travel": "travel", "festival": "festival", "illness": "unwell"}[kind]
        summary = f"Client flagged {_kind_word} from the app: {d_from} → {d_to}."
        if location:
            summary += f"\nDestination: {location}"
        if context:
            summary += f"\nNote: {context}"

    now_iso = datetime.now(timezone.utc).isoformat()
    data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "quick_note",
        "presenting_complaints": (
            f"[session_type: quick_note] [source: client_app_travel]\n\n{summary}"
        ),
        "coach_notes": "",
        "selected_symptoms": [],
        "selected_topics": [],
        "uploaded_files": [],
        "measurements_snapshot": {},
        "ai_analysis": {},
        "chat_log": [],
        "generated_plan_slug": None,
        "five_pillars": None,
        # Structured copy — loader + generate-week-menu.py read this.
        "travel_response": {
            "from": None if cancelled else d_from,
            "to": None if cancelled else d_to,
            "kind": kind,
            "location": location,
            "context": context,
            "cancelled": cancelled,
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
