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
import re
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


# A `[session_type: X]` tag at the head of presenting_complaints IS the
# session's type on disk — the Session model has no session_type field, and
# every reader (parseSessionType in session-utils.ts, the dashboard, the
# calendar, the rework prompt) parses this tag back out.
#
# "At the head" means anywhere in the RUN of bracketed tags that opens the
# string, not strictly first: the WhatsApp rollup leads with
# `[plan: X] [window: Y]`. Deliberately bounded to that run — an unbounded
# match would also fire on a client message quoting the literal text.
_SESSION_TYPE_TAG_IN_HEAD = re.compile(
    r"^((?:\s*\[[^\]]+\])*?)\s*\[session_type:\s*[^\]]+\]"
)


def _strip_session_type_tag(text: str) -> str:
    """Drop the leading `[session_type: …]` tag, keeping any tags before it.

    Used when appending a segment to an existing session: the session-level
    tag is written once, at the head of the file, and repeating it per segment
    would break the thread loader's `---` split.
    """
    return _SESSION_TYPE_TAG_IN_HEAD.sub(r"\1", text, count=1).lstrip()


def _with_session_type_tag(text: str, session_type: str) -> str:
    """Return `text` opening with exactly ONE `[session_type: …]` tag.

    This shim owns the tag: it derives it from the structured `session_type`
    field. But it must be idempotent, because most callers pre-embed a tag in
    the text as well — sometimes a MORE specific one the 4-value enum cannot
    carry (`protocol_checkin`, `discovery_consultation`), which downstream
    readers key on. Prepending unconditionally doubled the tag on every such
    save ("[session_type: quick_note] [session_type: quick_note] …"; 46 of 240
    sessions on disk by 2026-08-22). When the text already opens with a tag,
    keep the caller's and add nothing.
    """
    if _SESSION_TYPE_TAG_IN_HEAD.match(text):
        return text
    tag = f"[session_type: {session_type}]"
    return f"{tag} {text}" if text else tag


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
    _requested_labs_raw = payload.get("requested_labs") or []
    requested_labs: list[str] = (
        [str(x).strip() for x in _requested_labs_raw if str(x).strip()]
        if isinstance(_requested_labs_raw, list)
        else []
    )
    five_pillars_raw: dict | None = payload.get("five_pillars") or None
    mrs_raw: dict | None = payload.get("mrs") or None

    try:
        from fmdb.plan.storage import next_session_id, write_session, plans_root as fmdb_plans_root  # type: ignore
        from fmdb.plan.models import Session, FivePillarsAssessment, MenopauseRatingScale  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "session_id": None, "error": f"fmdb import error: {e}"}, sys.stdout)
        return 1

    root = fmdb_plans_root()

    # Verify client exists
    client_yaml = root / "clients" / client_id / "client.yaml"
    if not client_yaml.exists():
        json.dump({"ok": False, "session_id": None, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    # Session type lives as a tag at the head of presenting_complaints (the
    # Session model has no session_type field). Exactly one tag — see
    # _with_session_type_tag for why this must not prepend blindly.
    full_complaints = _with_session_type_tag(presenting_complaints, session_type)

    # ── Append-if-today mode ────────────────────────────────────────────
    # `append_if_today_match` is a SUBSTRING. If any same-day session's
    # presenting_complaints contains it, append this body there instead
    # of creating a new file.
    #
    # For WhatsApp messages the caller passes the prefix
    # "[source: whatsapp_" — which matches both whatsapp_webhook (inbound)
    # AND whatsapp_outbound (outbound). Inbound + outbound for the same
    # client on the same day merge into ONE session so the chat thread's
    # back-and-forth context is preserved.
    #
    # We KEEP the per-segment [source:] tag on each appended chunk so
    # the WhatsApp thread loader can split on `---` and parse direction
    # per segment. Only `[session_type: …]` is stripped from non-first
    # chunks (it's identical across the whole session).
    append_marker = payload.get("append_if_today_match")
    # `match_anywhere: true` widens the search beyond same-day — the
    # matcher scans every session for the marker. Used by the per-plan
    # WhatsApp rollup (one rolling thread per client per published plan,
    # tagged `[plan: <slug>]`). When false (default), preserves the
    # original same-day behaviour for callers that want it.
    match_anywhere = bool(payload.get("match_anywhere", False))
    if append_marker and isinstance(append_marker, str):
        try:
            import yaml as _yaml  # type: ignore
            sessions_dir = root / "clients" / client_id / "sessions"
            if sessions_dir.exists():
                if match_anywhere:
                    candidates = sorted(
                        sessions_dir.glob("*.yaml"),
                        key=lambda p: p.stat().st_mtime,
                        reverse=True,  # newest first — most likely to match
                    )
                else:
                    date_prefix = session_date.isoformat()
                    candidates = sorted(
                        p for p in sessions_dir.glob("*.yaml")
                        if date_prefix in p.name
                    )
                for p in candidates:
                    try:
                        existing = _yaml.safe_load(p.read_text()) or {}
                    except Exception:
                        continue
                    existing_complaints = str(existing.get("presenting_complaints") or "")
                    if append_marker not in existing_complaints:
                        continue
                    # Match — append the new body. Strip only the shared
                    # session_type prefix; KEEP the per-segment [source:]
                    # tag (the thread loader needs it to decide direction).
                    new_body = presenting_complaints or ""
                    new_body = _strip_session_type_tag(new_body)
                    divider = "\n\n---\n\n"
                    appended = existing_complaints.rstrip() + divider + new_body
                    existing["presenting_complaints"] = appended
                    existing["updated_at"] = datetime.now(timezone.utc).isoformat()
                    # Atomic write (audit Phase-1b): temp+os.replace avoids a
                    # truncated session file on a crash mid-write. (A cross-
                    # process lock to fully close the concurrent inbound+outbound
                    # lost-append race remains an open item.)
                    from atomic_write import write_text_atomic
                    write_text_atomic(p, _yaml.dump(existing, sort_keys=False,
                                                    default_flow_style=False, allow_unicode=True,
                                                    width=120))
                    existing_id = str(existing.get("session_id") or p.stem)
                    json.dump(
                        {"ok": True, "session_id": existing_id, "error": None,
                         "appended": True},
                        sys.stdout,
                    )
                    return 0
        except Exception:
            # Best-effort — if anything goes wrong, fall through to the
            # normal create-new path so a real message is never lost.
            pass

    session_id = next_session_id(root, client_id, session_date)

    # Coach notes. The selected lab markers are persisted in the structured
    # `requested_labs` field below — NOT embedded as a "[Requested labs: …]"
    # free-text block any more. That round-trip shattered marker names with
    # internal commas (e.g. "Morning Cortisol (8am, fasting)"). Every reader
    # now prefers the structured field and only falls back to parsing the
    # legacy block for older sessions on disk.
    full_notes = coach_notes or ""

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

    # Build MenopauseRatingScale if provided (mirrors five_pillars_obj above)
    mrs_obj = None
    if mrs_raw and any(v is not None for v in mrs_raw.values()):
        try:
            mrs_obj = MenopauseRatingScale(
                hot_flashes_sweating=mrs_raw.get("hot_flashes_sweating"),
                heart_discomfort=mrs_raw.get("heart_discomfort"),
                sleep_problems=mrs_raw.get("sleep_problems"),
                joint_muscular_discomfort=mrs_raw.get("joint_muscular_discomfort"),
                depressive_mood=mrs_raw.get("depressive_mood"),
                irritability=mrs_raw.get("irritability"),
                anxiety=mrs_raw.get("anxiety"),
                physical_mental_exhaustion=mrs_raw.get("physical_mental_exhaustion"),
                sexual_problems=mrs_raw.get("sexual_problems"),
                bladder_problems=mrs_raw.get("bladder_problems"),
                vaginal_dryness=mrs_raw.get("vaginal_dryness"),
            )
        except Exception:
            mrs_obj = None

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
            mrs=mrs_obj,
            expected_reports=expected_reports,
            requested_labs=requested_labs,
        )
        write_session(root, session)
    except Exception as e:
        json.dump({"ok": False, "session_id": None, "error": str(e)}, sys.stdout)
        return 1

    json.dump({"ok": True, "session_id": session_id, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
