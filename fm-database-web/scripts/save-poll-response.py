#!/usr/bin/env python3
"""Persist a weekly-poll button reply as a tagged quick_note session.

Reads JSON from stdin:
{
  "client_id": str,
  "raw_text": str,                # the inbound button label text
  "dim": "overall|supplements|meals|movement",
  "score": "good|partial|struggling",
  "phone": str | null,            # for audit
  "received_at": str | null       # human-readable timestamp
}

Writes JSON to stdout:
{"ok": bool, "session_id": str?, "error": str?}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


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

    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml: {e}"}, sys.stdout)
        return 1

    sessions_dir = _plans_root() / "clients" / client_id / "sessions"
    if not (_plans_root() / "clients" / client_id).exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2
    sessions_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = sorted(sessions_dir.glob(f"{today}-*.yaml"))
    suffix = len(existing) + 1
    session_id = f"{today}-{suffix:03d}-poll"
    yml = sessions_dir / f"{session_id}.yaml"

    dim = (payload.get("dim") or "overall").strip()
    score = (payload.get("score") or "").strip()
    raw_text = (payload.get("raw_text") or "").strip()
    phone = payload.get("phone")
    received_at = payload.get("received_at") or datetime.now(timezone.utc).isoformat()

    note_lines = [
        f"Weekly poll reply — {dim}: {score}",
        f"Button: {raw_text}",
    ]
    if phone:
        note_lines.append(f"From: {phone}")

    data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "quick_note",
        "presenting_complaints": (
            "[source: weekly_check_in_poll] " + raw_text
        ),
        "coach_notes": "\n".join(note_lines),
        "selected_symptoms": [],
        "selected_topics": [],
        "uploaded_files": [],
        "measurements_snapshot": {},
        "ai_analysis": {},
        "chat_log": [],
        "generated_plan_slug": None,
        "five_pillars": None,
        # Structured field used by detectAdherenceDropsAction in the
        # weekly-poll server action.
        "poll_response": {
            "dim": dim,
            "score": score,
            "raw_text": raw_text,
            "received_at": received_at,
        },
        "version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": "whatsapp-webhook",
    }

    with yml.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)

    json.dump({"ok": True, "session_id": session_id}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
