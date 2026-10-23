#!/usr/bin/env python3
"""Write (or update) a finished food diary's summary as a session.

docs/FOOD_DIARY_PLAN.md §5: when a diary ends, its summary goes on the record
by itself, so the assessment (assess.py → client_context.food_diary_summary),
the renewal brief and the /client brief can read it. No AI here — the numbers
were computed by food-diary-estimate.ts and arrive in the payload.

ONE session per diary: a later run (a late photo read, a coach correction)
rewrites the same file in place rather than adding another. Matched by
`food_diary_summary.diary_id`.

stdin:  {"client_id": str, "summary": {"diary_id": str, "line": str, ...}}
stdout: {"ok": bool, "session_id": str?, "updated": bool?, "error": str?}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env).expanduser().resolve() if env else Path.home() / "fm-plans"


def _person_dir(client_id: str) -> "Path | None":
    for bucket in ("clients", "prospects"):
        d = _plans_root() / bucket / client_id
        if d.is_dir():
            return d
    return None


def _text(s: dict) -> str:
    lines = [
        f"Food diary from the client app — {s.get('days')} day(s) from {s.get('start')}, "
        f"{s.get('photos', 0)} photo(s). AI-read estimate; the coach's corrections win.",
        "",
        str(s.get("line") or ""),
    ]
    per_day = s.get("per_day") or []
    if per_day:
        lines += ["", "## By day"]
        for d in per_day:
            lines.append(
                f"- Day {d.get('day')} ({d.get('date')}): {d.get('photos')} photo(s) · "
                f"~{d.get('protein_g')} g protein · ~{d.get('fibre_g')} g fibre"
            )
    meals = s.get("meals") or []
    if meals:
        lines += ["", "## What was eaten"]
        for m in meals:
            lines.append(f"- {m}")
    return "\n".join(lines)


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2
    client_id = str(payload.get("client_id") or "").strip()
    summary = payload.get("summary") or {}
    diary_id = str(summary.get("diary_id") or "")
    if not client_id or not diary_id:
        json.dump({"ok": False, "error": "client_id and summary.diary_id are required"}, sys.stdout)
        return 2

    import yaml  # type: ignore

    person = _person_dir(client_id)
    if not person:
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2
    sessions = person / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    existing = None
    for f in sorted(sessions.glob("*-app-fooddiary.yaml")):
        try:
            d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        if (d.get("food_diary_summary") or {}).get("diary_id") == diary_id:
            existing = (f, d)
            break

    pc = "[session_type: quick_note] [source: app_food_diary]\n\n" + _text(summary)
    block = {**summary, "written_at": now_iso}
    if existing:
        f, d = existing
        d["presenting_complaints"] = pc
        d["food_diary_summary"] = block
        d["updated_at"] = now_iso
        d["updated_by"] = "food-diary-cron"
        f.write_text(yaml.safe_dump(d, sort_keys=False, allow_unicode=True), encoding="utf-8")
        json.dump({"ok": True, "session_id": d.get("session_id"), "updated": True}, sys.stdout)
        return 0

    today = now.strftime("%Y-%m-%d")
    n = len(list(sessions.glob(f"{today}-*.yaml"))) + len(list(sessions.glob(f"{client_id}-{today}-*.yaml")))
    session_id = f"{today}-{n + 1:03d}-app-fooddiary"
    data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "quick_note",
        "presenting_complaints": pc,
        "coach_notes": "",
        "selected_symptoms": [],
        "selected_topics": [],
        "uploaded_files": [],
        "measurements_snapshot": {},
        "ai_analysis": {},
        "chat_log": [],
        "generated_plan_slug": None,
        "five_pillars": None,
        "food_diary_summary": block,
        "version": 1,
        "created_at": now_iso,
        "updated_at": now_iso,
        "updated_by": "food-diary-cron",
    }
    (sessions / f"{session_id}.yaml").write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    json.dump({"ok": True, "session_id": session_id, "updated": False}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
