#!/usr/bin/env python3
"""Save a lightweight session (pre-intake or check-in) without running AI.

Reads JSON from stdin:
{
  "client_id": str,
  "session_type": "pre_intake" | "check_in",
  "session_date": str | null,          # ISO YYYY-MM-DD; defaults to today
  "selected_symptoms": [str],
  "presenting_complaints": str,
  "coach_notes": str,
  "requested_labs": [str]              # suggested lab slugs for pre-intake
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

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
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

    session_type: str = payload.get("session_type") or "pre_intake"
    session_date_str: str = payload.get("session_date") or ""
    try:
        session_date = date.fromisoformat(session_date_str) if session_date_str else date.today()
    except ValueError:
        session_date = date.today()

    selected_symptoms: list[str] = payload.get("selected_symptoms") or []
    presenting_complaints: str = payload.get("presenting_complaints") or ""
    coach_notes: str = payload.get("coach_notes") or ""
    requested_labs: list[str] = payload.get("requested_labs") or []

    try:
        from fmdb.plan.storage import next_session_id, write_session, plans_root as fmdb_plans_root  # type: ignore
        from fmdb.plan.models import Session  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "session_id": None, "error": f"fmdb import error: {e}"}, sys.stdout)
        return 1

    root = fmdb_plans_root()

    # Verify client exists
    client_yaml = root / "clients" / client_id / "client.yaml"
    if not client_yaml.exists():
        json.dump({"ok": False, "session_id": None, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    session_id = next_session_id(root, client_id, session_date)

    # Build coach notes including session type tag and requested labs
    notes_parts: list[str] = []
    if coach_notes:
        notes_parts.append(coach_notes)
    if requested_labs:
        notes_parts.append(f"[Requested labs: {', '.join(requested_labs)}]")
    full_notes = "\n".join(notes_parts)

    # Extra metadata stored as coach_notes prefix for now (until Session model gains session_type field)
    meta_prefix = f"[session_type: {session_type}] "
    full_complaints = f"{meta_prefix}{presenting_complaints}" if presenting_complaints else meta_prefix.strip()

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
        )
        write_session(root, session)
    except Exception as e:
        json.dump({"ok": False, "session_id": None, "error": str(e)}, sys.stdout)
        return 1

    json.dump({"ok": True, "session_id": session_id, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
