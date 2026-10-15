#!/usr/bin/env python3
"""Persist a client's programme feedback as a tagged session.

Mirrors save-app-checkin.py (direct YAML write, no AI). The structured
`feedback_response` drives the coach's "How are we doing" panel and tells the
app which stage is already answered; `presenting_complaints` carries a
readable copy so the answers show up in the client's session history too.

The payload is validated by the API route (sanitiseFeedback in
src/lib/fmdb/programme-feedback.ts) before it reaches this script.

Reads JSON from stdin:
{
  "client_id": str,
  "response": {
    "stage": "midpoint" | "graduation" | "followup",
    "week": int,
    "goals": [{"goal": str, "change": int|null}],     # -1 worse .. 3 resolved
    "parts": {"menus": int|null, ...},                 # 1..5, null = didn't use
    "recommend": int|null,                             # 0..10
    "biggest_change": str, "hardest": str, "change_one_thing": str,
    "testimonial": "named" | "anonymous" | "no"
  }
}

Writes JSON to stdout: {"ok": bool, "session_id": str?, "error": str?}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

STAGE_LABEL = {
    "midpoint": "Halfway feedback",
    "graduation": "End-of-programme feedback",
    "followup": "3-month follow-up feedback",
}
CHANGE_LABEL = {-1: "Worse", 0: "No change", 1: "A little better", 2: "Much better", 3: "Resolved"}
PART_LABEL = {
    "menus": "Weekly menus & recipes",
    "supplements": "Supplement plan",
    "app": "The app",
    "whatsapp": "WhatsApp support",
    "calls": "Calls with Shivani",
}
CONSENT_LABEL = {
    "named": "Yes — may be quoted with their first name",
    "anonymous": "Yes — may be quoted anonymously",
    "no": "No — keep private",
}


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _summary(r: dict) -> str:
    stage = r.get("stage") or ""
    lines = [f"{STAGE_LABEL.get(stage, 'Feedback')} from the client app (week {r.get('week') or 0})."]
    goals = [g for g in (r.get("goals") or []) if g.get("change") is not None]
    if goals:
        lines += ["", "## 🎯 Their goals"]
        lines += [f"- {g.get('goal')}: {CHANGE_LABEL.get(g.get('change'), '?')}" for g in goals]
    parts = {k: v for k, v in (r.get("parts") or {}).items() if v is not None}
    if parts:
        lines += ["", "## ⭐ Parts of the programme (1–5)"]
        lines += [f"- {PART_LABEL.get(k, k)}: {v}/5" for k, v in parts.items()]
    if r.get("recommend") is not None:
        lines += ["", f"Would recommend: {r['recommend']}/10"]
    for key, label in (
        ("biggest_change", "Biggest change"),
        ("hardest", "Hardest part"),
        ("change_one_thing", "One thing they'd change"),
    ):
        if r.get(key):
            lines += ["", f"## {label}", r[key]]
    if stage != "midpoint":
        lines += ["", f"Testimonial: {CONSENT_LABEL.get(r.get('testimonial') or 'no')}"]
    return "\n".join(lines)


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id = (payload.get("client_id") or "").strip()
    response = payload.get("response") or {}
    if not client_id or not isinstance(response, dict) or response.get("stage") not in STAGE_LABEL:
        json.dump({"ok": False, "error": "client_id and a valid response are required"}, sys.stdout)
        return 2

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
    session_id = f"{today}-{len(existing) + 1:03d}-app-feedback"
    yml = sessions_dir / f"{session_id}.yaml"
    now_iso = datetime.now(timezone.utc).isoformat()
    stage = response["stage"]

    data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "quick_note",
        "presenting_complaints": (
            f"[session_type: quick_note] [source: client_app_feedback] [stage: {stage}]\n\n"
            + _summary(response)
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
        "feedback_response": {**response, "received_at": now_iso},
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
