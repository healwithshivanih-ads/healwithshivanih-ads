#!/usr/bin/env python3
"""Save a lightweight session (discovery / check-in / quick note) without running AI.

Intake sessions go through the assess flow (assess.py), not this shim.

Reads JSON from stdin:
{
  "client_id": str,
  "session_type": "discovery" | "check_in" | "quick_note" | "intake",
  "session_date": str | null,          # ISO YYYY-MM-DD; defaults to today
  "selected_symptoms": [str],
  "presenting_complaints": str,
  "coach_notes": str,
  "requested_labs": [str]              # suggested lab slugs for discovery
}

Writes JSON to stdout:
{
  "ok": bool,
  "session_id": str | null,
  "error": str | null
}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "session_id": None, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id: str = payload.get("client_id") or ""
    if not client_id:
        json.dump({"ok": False, "session_id": None, "error": "client_id required"}, sys.stdout)
        return 2

    session_type: str = payload.get("session_type") or "discovery"
    session_date_str: str = payload.get("session_date") or ""
    try:
        session_date = date.fromisoformat(session_date_str) if session_date_str else date.today()
    except ValueError:
        session_date = date.today()

    selected_symptoms: list[str] = payload.get("selected_symptoms") or []
    presenting_complaints: str = payload.get("presenting_complaints") or ""
    coach_notes: str = payload.get("coach_notes") or ""
    requested_labs: list[str] = payload.get("requested_labs") or []
    five_pillars_raw: dict | None = payload.get("five_pillars") or None

    try:
        from fmdb.plan.storage import next_session_id, write_session, plans_root as fmdb_plans_root  # type: ignore
        from fmdb.plan.models import Session, FivePillarsAssessment  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "session_id": None, "error": f"fmdb import error: {e}"}, sys.stdout)
        return 1

    root = fmdb_plans_root()

    # Verify client exists
    client_yaml = root / "clients" / client_id / "client.yaml"
    if not client_yaml.exists():
        json.dump({"ok": False, "session_id": None, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    # Extra metadata stored as coach_notes prefix for now (until Session model gains session_type field)
    meta_prefix = f"[session_type: {session_type}] "
    full_complaints = f"{meta_prefix}{presenting_complaints}" if presenting_complaints else meta_prefix.strip()

    # ── Append-if-today mode ────────────────────────────────────────────
    # When the caller sets `append_if_today_match: "[source: foo]"`, look
    # for an existing same-day session whose presenting_complaints
    # contains that marker string. If found → load it, append the new
    # body separated by a divider, save, return its session_id. Used by
    # the WhatsApp inbound webhook so 9 messages in a day don't create
    # 9 separate session files — they all roll up into one "WhatsApp
    # 2026-05-16" quick_note for that client.
    append_marker = payload.get("append_if_today_match")
    if append_marker and isinstance(append_marker, str):
        try:
            import yaml as _yaml  # type: ignore
            sessions_dir = root / "clients" / client_id / "sessions"
            if sessions_dir.exists():
                # Same-day filenames: <cid>-YYYY-MM-DD-NNN.yaml
                date_prefix = session_date.isoformat()
                same_day = sorted(
                    p for p in sessions_dir.glob("*.yaml")
                    if date_prefix in p.name
                )
                for p in same_day:
                    try:
                        existing = _yaml.safe_load(p.read_text()) or {}
                    except Exception:
                        continue
                    existing_complaints = str(existing.get("presenting_complaints") or "")
                    if append_marker not in existing_complaints:
                        continue
                    # Match — append the new body. Strip the meta_prefix
                    # because the existing session already has one.
                    new_body = presenting_complaints
                    if append_marker in (new_body or ""):
                        # Webhook re-includes the [source: …] tag; strip
                        # so we don't repeat it on every append.
                        new_body = new_body.replace(append_marker, "", 1).lstrip("\n")
                    divider = "\n\n---\n\n"
                    appended = existing_complaints.rstrip() + divider + new_body
                    existing["presenting_complaints"] = appended
                    # Bump updated_at, keep created_at original
                    existing["updated_at"] = datetime.now(timezone.utc).isoformat()
                    p.write_text(
                        _yaml.dump(existing, sort_keys=False,
                                   default_flow_style=False, allow_unicode=True,
                                   width=120)
                    )
                    existing_id = str(existing.get("session_id") or p.stem)
                    json.dump(
                        {"ok": True, "session_id": existing_id, "error": None,
                         "appended": True},
                        sys.stdout,
                    )
                    return 0
        except Exception:
            # Best-effort — if anything goes wrong, fall through to the
            # normal create-new path so a real message isn't lost.
            pass

    session_id = next_session_id(root, client_id, session_date)

    # Build coach notes including session type tag and requested labs
    notes_parts: list[str] = []
    if coach_notes:
        notes_parts.append(coach_notes)
    if requested_labs:
        notes_parts.append(f"[Requested labs: {', '.join(requested_labs)}]")
    full_notes = "\n".join(notes_parts)

    # Build FivePillarsAssessment if provided
    five_pillars_obj = None
    if five_pillars_raw and any(v is not None for v in five_pillars_raw.values()):
        try:
            five_pillars_obj = FivePillarsAssessment(
                sleep_hours=five_pillars_raw.get("sleep_hours"),
                sleep_quality=five_pillars_raw.get("sleep_quality"),
                stress_level=five_pillars_raw.get("stress_level"),
                movement_days_per_week=five_pillars_raw.get("movement_days_per_week"),
                nutrition_quality=five_pillars_raw.get("nutrition_quality"),
                connection_quality=five_pillars_raw.get("connection_quality"),
            )
        except Exception:
            five_pillars_obj = None

    expected_reports_raw = payload.get("expected_reports") or []
    expected_reports = [
        str(r).strip() for r in expected_reports_raw if isinstance(r, (str, bytes))
    ] if isinstance(expected_reports_raw, list) else []

    try:
        session = Session(
            session_id=session_id,
            client_id=client_id,
            date=session_date,
            created_at=datetime.now(timezone.utc),
            selected_symptoms=selected_symptoms,
            selected_topics=[],
            presenting_complaints=full_complaints,
            coach_notes=full_notes,
            five_pillars=five_pillars_obj,
            expected_reports=expected_reports,
        )
        write_session(root, session)
    except Exception as e:
        json.dump({"ok": False, "session_id": None, "error": str(e)}, sys.stdout)
        return 1

    json.dump({"ok": True, "session_id": session_id, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
