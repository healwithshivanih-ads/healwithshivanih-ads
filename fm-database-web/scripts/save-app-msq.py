#!/usr/bin/env python3
"""Persist a client-app MSQ (Medical Symptom Questionnaire) submission as a
tagged check_in session.

Mirrors save-app-checkin.py (direct YAML write, no AI). The session carries
a structured `msq_response` — the FM-standard outcome score the app's
Progress tab trends and the coach reads for before/after results.

Totals are recomputed HERE from the raw answers (keys "<category>.<idx>",
values 0-4) — the client's own arithmetic is never trusted.

Reads JSON from stdin:
{
  "client_id": str,
  "week": int,
  "answers": {"head.0": 3, "digestion.4": 2, ...}
}

Writes JSON to stdout: {"ok": bool, "session_id": str?, "total": int?, "error": str?}
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


def _band(total: int) -> str:
    if total < 10:
        return "optimal"
    if total < 50:
        return "mild"
    if total < 100:
        return "moderate"
    return "high"


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

    answers_in = payload.get("answers") or {}
    if not isinstance(answers_in, dict) or not answers_in:
        json.dump({"ok": False, "error": "answers required"}, sys.stdout)
        return 2

    # Sanitise + recompute server-side. Keys are "<category>.<index>".
    answers: dict[str, int] = {}
    category_totals: dict[str, int] = {}
    for k, v in answers_in.items():
        if not isinstance(k, str) or "." not in k or len(k) > 32:
            continue
        try:
            val = max(0, min(4, int(v)))
        except (TypeError, ValueError):
            continue
        answers[k] = val
        cat = k.split(".", 1)[0]
        category_totals[cat] = category_totals.get(cat, 0) + val
    if len(answers) < 10:
        json.dump({"ok": False, "error": "too few answers for a valid MSQ"}, sys.stdout)
        return 2
    total = sum(answers.values())

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
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = sorted(sessions_dir.glob(f"{today}-*.yaml")) + sorted(
        sessions_dir.glob(f"{client_id}-{today}-*.yaml")
    )
    session_id = f"{today}-{len(existing) + 1:03d}-app-msq"
    yml = sessions_dir / f"{session_id}.yaml"

    band = _band(total)
    top = sorted(category_totals.items(), key=lambda kv: -kv[1])[:3]
    top_line = ", ".join(f"{c} {n}" for c, n in top if n > 0) or "no scoring categories"

    now_iso = datetime.now(timezone.utc).isoformat()
    data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "check_in",
        "presenting_complaints": (
            f"[session_type: check_in] [source: ochre_app_msq] [week: {week}]\n\n"
            f"MSQ symptom questionnaire from the client app — total {total} ({band}).\n"
            f"Highest categories: {top_line}.\n"
            f"{len(answers)} symptoms scored."
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
        # Structured MSQ record — the app's Progress trend + coach outcome
        # tracking read this. Session model is extra="ignore", so this rides
        # exactly like poll_response / checkin_response do.
        "msq_response": {
            "week": week,
            "total": total,
            "band": band,
            "category_totals": category_totals,
            "answers": answers,
            "received_at": now_iso,
        },
    }

    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from atomic_write import write_text_atomic  # type: ignore

        write_text_atomic(yml, yaml.safe_dump(data, sort_keys=False, allow_unicode=True))
    except Exception as e:  # noqa: BLE001
        json.dump({"ok": False, "error": f"write failed: {e}"}, sys.stdout)
        return 1

    json.dump({"ok": True, "session_id": session_id, "total": total, "band": band}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
