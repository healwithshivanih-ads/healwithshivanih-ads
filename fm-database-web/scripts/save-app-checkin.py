#!/usr/bin/env python3
"""Persist a client-app weekly check-in as a tagged check_in session.

Mirrors save-poll-response.py (direct YAML write, no AI). The session
carries BOTH a structured `checkin_response` (drives the app's own
wellbeing trend) and a `poll_response` (so detectAdherenceDropsAction
treats app check-ins exactly like weekly WhatsApp poll replies — for
app users this REPLACES the poll, not duplicates it).

Reads JSON from stdin:
{
  "client_id": str,
  "week": int,
  "rating": int,                  # 1-5 overall feeling
  "feel": str,                    # free text
  "concerns": str,                # free text
  "supplements": [{"name": str, "status": str|null}],
  "practices":   [{"name": str, "status": str|null}]
}

Writes JSON to stdout: {"ok": bool, "session_id": str?, "error": str?}
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

    client_dir = _plans_root() / "clients" / client_id
    if not client_dir.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2
    sessions_dir = client_dir / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)

    week = int(payload.get("week") or 0)
    rating = max(0, min(int(payload.get("rating") or 0), 5))
    feel = (payload.get("feel") or "").strip()
    concerns = (payload.get("concerns") or "").strip()
    supplements = payload.get("supplements") or []
    practices = payload.get("practices") or []

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = sorted(sessions_dir.glob(f"{today}-*.yaml")) + sorted(
        sessions_dir.glob(f"{client_id}-{today}-*.yaml")
    )
    session_id = f"{today}-{len(existing) + 1:03d}-app-checkin"
    yml = sessions_dir / f"{session_id}.yaml"

    cap = ["", "Hard", "Low", "Okay", "Good", "Great"]
    lines = [f"Week {week} check-in from the client app — feeling {rating}/5 ({cap[rating]})."]
    if feel:
        lines.append(f"In their words: {feel}")
    answered_s = [s for s in supplements if s.get("status")]
    if answered_s:
        lines.append("")
        lines.append("## 💊 Supplements")
        for s in answered_s:
            lines.append(f"- {s.get('name')}: {s.get('status')}")
    answered_p = [p for p in practices if p.get("status")]
    if answered_p:
        lines.append("")
        lines.append("## 🌿 Practices")
        for p in answered_p:
            lines.append(f"- {p.get('name')}: {p.get('status')}")
    if concerns:
        lines.append("")
        lines.append(f"## ⚠ New symptoms / concerns\n{concerns}")

    score = "good" if rating >= 4 else "partial" if rating == 3 else "struggling"
    now_iso = datetime.now(timezone.utc).isoformat()

    data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "check_in",
        "presenting_complaints": (
            f"[session_type: check_in] [source: client_app_checkin] [week: {week}]\n\n"
            + "\n".join(lines)
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
        # Same shape the weekly WhatsApp poll writes, so the existing
        # adherence-drop scanner counts app check-ins too.
        "poll_response": {
            "dim": "overall",
            "score": score,
            "raw_text": f"App check-in {rating}/5",
            "received_at": now_iso,
        },
        # Structured copy for the app's wellbeing trend.
        "checkin_response": {
            "week": week,
            "rating": rating,
            "feel": feel,
            "concerns": concerns,
            "supplements": answered_s,
            "practices": answered_p,
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
