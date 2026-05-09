#!/usr/bin/env python3
"""Thin shim wrapping fmdb.assess.suggester.synthesize for the Next.js UI.

Reads JSON from stdin:
{
  "client_id": str,
  "symptoms": [str],          # symptom slugs
  "topics": [str],            # topic slugs
  "complaints": str,          # free-text presenting complaints
  "attachments": [             # optional
    {"path": str, "mime_type": str, "kind": "lab_report"|"food_journal"}
  ],
  "dry_run": bool             # if true, return a synthetic suggestion (skip Anthropic)
}

Writes JSON to stdout:
{
  "ok": bool,
  "session_id": str,
  "suggestions": {...},       # full synthesize() output
  "computed_ratios": [...],   # derived FM markers from extracted_labs
  "usage": {...},
  "subgraph_size": int,       # bytes
  "error": str | null
}

Persists a Session record to ~/fm-plans/clients/<id>/sessions/<sid>.yaml on success.
Also persists computed lab_markers to the client YAML (latest only).
"""

from __future__ import annotations

import base64
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

# Wire imports to the Python engine.
FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def _load_dotenv() -> None:
    """Load fm-database/.env if python-dotenv is available."""
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        # Best-effort manual parse — covers the common KEY=VALUE case.
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _synthetic_result(payload: dict) -> dict:
    """Cheap deterministic stand-in for a real Claude call. Uses the
    selected slugs so the round-trip is meaningful in dev."""
    sym = payload.get("symptoms") or []
    top = payload.get("topics") or []
    return {
        "suggestions": {
            "extracted_labs": [],
            "likely_drivers": [
                {"mechanism_slug": "hpa-axis-dysregulation", "rank": 1,
                 "reasoning": f"[dry-run] inferred from symptoms {sym}",
                 "supporting_evidence": sym[:2]},
            ] if sym else [],
            "topics_in_play": [
                {"topic_slug": t, "role": "primary", "rationale": "[dry-run]", "confidence_pct": 50}
                for t in top[:2]
            ],
            "additional_symptoms_to_screen": [],
            "lifestyle_suggestions": [
                {"name": "morning sunlight", "cadence": "daily",
                 "details": "[dry-run] 10 min within 30 min of waking",
                 "rationale": "circadian anchoring",
                 "addresses_mechanism": ["hpa-axis-dysregulation"]},
            ],
            "nutrition_suggestions": {
                "pattern": "[dry-run] gentle anti-inflammatory",
                "add": ["leafy greens"], "reduce": ["ultra-processed snacks"],
                "meal_timing": "12-hour overnight fast",
                "cooking_adjustment_slugs": [], "home_remedy_slugs": [],
                "rationale": "[dry-run]",
            },
            "supplement_suggestions": [],
            "lab_followups": [],
            "referral_triggers": [],
            "education_framings": [],
            "synthesis_notes": "[dry-run] synthetic suggestion — no Anthropic call was made.",
            "catalogue_additions_suggested": [],
        },
        "usage": {
            "model": "dry-run",
            "stop_reason": "end_turn",
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
    }


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON on stdin: {e}"}, sys.stdout)
        return 2

    client_id = payload.get("client_id") or ""
    symptoms = payload.get("symptoms") or []
    topics = payload.get("topics") or []
    complaints = payload.get("complaints") or ""
    attachments = payload.get("attachments") or []
    dry_run = bool(payload.get("dry_run"))
    session_date_str = payload.get("session_date") or None  # ISO YYYY-MM-DD or None (defaults to today)
    five_pillars_raw: dict | None = payload.get("five_pillars") or None

    if not client_id:
        json.dump({"ok": False, "error": "client_id is required"}, sys.stdout)
        return 2

    _load_dotenv()

    # Imports deferred so --help / arg-validation paths don't pay their cost.
    from fmdb.validator import load_all
    from fmdb.assess.subgraph import build_subgraph
    from fmdb.plan import storage as plan_storage
    from fmdb.plan.models import Session, UploadedFileRef, FivePillarsAssessment

    # Build FivePillarsAssessment from raw dict (if provided)
    five_pillars_obj: "FivePillarsAssessment | None" = None
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

    data_dir = FMDB_ROOT / "data"
    cat = load_all(data_dir)
    root = plan_storage.plans_root()

    # Resolve client (must exist).
    try:
        client = plan_storage.load_client(root, client_id)
    except FileNotFoundError as e:
        json.dump({"ok": False, "error": f"client not found: {client_id} ({e})"}, sys.stdout)
        return 2

    subgraph = build_subgraph(cat, symptom_slugs=symptoms, topic_slugs=topics)
    subgraph_bytes = len(json.dumps(subgraph))

    # ----- attachments (already saved by the TS layer; we re-read them as base64) -----
    lab_files: list[dict] = []
    file_refs: list[UploadedFileRef] = []
    now = datetime.now(timezone.utc)
    today = date.fromisoformat(session_date_str) if session_date_str else date.today()
    for att in attachments:
        path = att.get("path")
        if not path or not os.path.exists(path):
            continue
        mime = att.get("mime_type") or "application/octet-stream"
        kind = att.get("kind") or "lab_report"
        with open(path, "rb") as fh:
            data_b64 = base64.b64encode(fh.read()).decode("ascii")
        lab_files.append({
            "filename": os.path.basename(path),
            "mime_type": mime,
            "data_b64": data_b64,
            "kind": kind,
        })
        file_refs.append(UploadedFileRef(
            filename=os.path.basename(path),
            kind=kind,
            uploaded_at=now,
        ))

    # ----- client context (mirrors the Streamlit version) -----
    m = client.measurements
    age = client.estimated_age()
    bmr = m.bmr_mifflin_st_jeor(age, client.sex) if age else None
    client_ctx = {
        "client_id": client.client_id,
        "age_band": client.age_band,
        "estimated_age": age,
        "date_of_birth": client.date_of_birth.isoformat() if client.date_of_birth else None,
        "sex": client.sex,
        "dietary_preference": client.dietary_preference or "Vegetarian",
        "active_conditions": client.active_conditions,
        "medical_history": client.medical_history,
        "current_medications": client.current_medications,
        "known_allergies": client.known_allergies,
        "goals": client.goals,
        "notes": client.notes,
        "timeline_events": [
            {"year": e.year, "date": e.date, "event": e.event, "category": e.category}
            for e in (client.timeline_events or [])
        ],
        "measurements": {
            "height_cm": m.height_cm,
            "weight_kg": m.weight_kg,
            "bmi": m.bmi,
            "waist_hip_ratio": m.waist_hip_ratio,
            "bmr_estimated_kcal_per_day": bmr,
            "resting_heart_rate": m.resting_heart_rate,
            "blood_pressure": (
                f"{m.blood_pressure_systolic}/{m.blood_pressure_diastolic}"
                if m.blood_pressure_systolic and m.blood_pressure_diastolic else None
            ),
        },
    }

    # Session-history bundle: compact prior-session summaries.
    prior = plan_storage.list_sessions(root, client.client_id)
    history_bundle = []
    for s in prior:
        ai = s.ai_analysis or {}
        history_bundle.append({
            "session_id": s.session_id,
            "date": s.date.isoformat(),
            "generated_plan_slug": s.generated_plan_slug,
            "selected_symptoms": s.selected_symptoms,
            "selected_topics": s.selected_topics,
            "drivers": [d.get("mechanism_slug") for d in (ai.get("likely_drivers") or [])],
            "supplements": [
                {"slug": sp.get("supplement_slug"), "dose": sp.get("dose")}
                for sp in (ai.get("supplement_suggestions") or [])
            ],
            "synthesis_notes": ai.get("synthesis_notes", ""),
        })

    # Calculate days_since_last_prescription from history_bundle
    days_since_last_prescription: int | None = None
    for s in reversed(history_bundle):
        if s.get("generated_plan_slug"):
            try:
                last_date = date.fromisoformat(s["date"])
                days_since_last_prescription = (today - last_date).days
            except Exception:
                pass
            break

    # Check for an existing session today (same-day reuse to avoid duplicates)
    existing_today_session: Session | None = None
    for s in prior:
        if s.date == today:
            existing_today_session = s
            # Use the most recent one from today
    existing_sid: str | None = existing_today_session.session_id if existing_today_session else None

    if dry_run:
        # Synthetic result parsed into typed model so both branches share
        # the same attribute-access interface below.
        from fmdb.assess.results import AssessSuggestions, AssessUsage
        synthetic = _synthetic_result(payload)
        suggestions = AssessSuggestions.model_validate(synthetic["suggestions"])
        usage = AssessUsage.model_validate(synthetic["usage"]).model_dump()
    else:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
            return 2
        from fmdb.assess.suggester import synthesize
        try:
            result = synthesize(
                client_context=client_ctx,
                selected_symptom_slugs=symptoms,
                selected_topic_slugs=topics,
                subgraph=subgraph,
                lab_files=lab_files,
                additional_notes=complaints,
                session_history=history_bundle,
                days_since_last_prescription=days_since_last_prescription,
            )
        except Exception as e:
            json.dump({"ok": False, "error": f"synthesize() failed: {type(e).__name__}: {e}"}, sys.stdout)
            return 1
        # `result` is an AssessResult Pydantic model with typed .suggestions.
        suggestions = result.suggestions
        usage = result.usage.model_dump()

    # ----- compute FM lab ratios -----
    from fmdb.assess.lab_ratios import compute_ratios
    extracted_labs = [lab.model_dump() for lab in suggestions.extracted_labs]
    computed_ratios = compute_ratios(extracted_labs)

    # ----- persist lab_markers + per-report health snapshots to client YAML -----
    try:
        import yaml
        from datetime import datetime as _dt

        def _parse_report_date(d: object) -> str | None:
            """Convert 'DD/Mon/YYYY' (or ISO) to YYYY-MM-DD.  Returns None on failure."""
            if not d:
                return None
            import re as _re
            s = _re.sub(r"^(\d{1,2})/([A-Za-z]{3})/(\d{4})$", r"\2 \1 \3", str(d).strip())
            for fmt in ("%b %d %Y", "%Y-%m-%d", "%d/%m/%Y", "%b %Y", "%d-%b-%Y"):
                try:
                    return _dt.strptime(s, fmt).strftime("%Y-%m-%d")
                except ValueError:
                    pass
            return None

        client_p = plan_storage.client_path(root, client_id)
        raw_client = yaml.safe_load(client_p.read_text())

        # Save FM computed markers (most-recent values, already handled by _find)
        if computed_ratios:
            # Use the latest date_drawn across all extracted labs as the markers date
            all_dates = [_parse_report_date(l.get("date_drawn")) for l in extracted_labs]
            latest_report_date = max((d for d in all_dates if d), default=today.isoformat())
            raw_client["lab_markers"] = computed_ratios
            raw_client["lab_markers_date"] = latest_report_date

        # Build one health snapshot per distinct report date so health trends can
        # show how each marker changed between appointments.
        date_groups: dict[str, list[dict]] = {}
        undated: list[dict] = []
        for lab in extracted_labs:
            rd = _parse_report_date(lab.get("date_drawn"))
            if rd:
                date_groups.setdefault(rd, []).append(lab)
            else:
                undated.append(lab)

        # If there's only one date group (or none), fall back to a single
        # snapshot dated today so the data still appears on the timeline.
        if not date_groups and undated:
            date_groups[today.isoformat()] = undated

        existing_snaps: list = raw_client.get("health_snapshots") or []
        for report_date, labs in sorted(date_groups.items()):
            snap_source = f"lab-report-{report_date}"
            # Remove any previous snapshot for the same date+source, then re-add.
            existing_snaps = [
                s for s in existing_snaps
                if not (s.get("date") == report_date and s.get("source") == snap_source)
            ]
            import re as _re2
            # Strip date suffixes the AI appends to test names, e.g.
            # "TSH (Ultrasensitive) - Jan 2026" → "TSH (Ultrasensitive)"
            # so the trends chart groups them as one series across snapshots.
            _DATE_SUFFIX = _re2.compile(
                r"\s*[-–]\s*(?:\d{1,2}[/\-])?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
                r"[\s/\-]*\d{4}\s*$", _re2.IGNORECASE)
            snap_lab_values = [
                {
                    "test_name": _DATE_SUFFIX.sub("", l["test_name"]).strip(),
                    "value": str(l["value"]),
                    "unit": l.get("unit") or "",
                }
                for l in labs
            ]
            existing_snaps.append({
                "date": report_date,
                "source": snap_source,
                "lab_values": snap_lab_values,
            })

        raw_client["health_snapshots"] = existing_snaps
        client_p.write_text(yaml.safe_dump(raw_client, sort_keys=False, allow_unicode=True))
    except Exception:
        pass  # non-fatal — ratios still returned in the response

    # ----- persist session (reuse today's or create new) -----
    if existing_sid:
        # Update existing session for today
        try:
            sess = plan_storage.load_session(root, client_id, existing_sid)
            # Update the ai_analysis and related fields in-place
            from dataclasses import replace
            updated = Session(
                session_id=sess.session_id,
                client_id=sess.client_id,
                date=sess.date,
                created_at=sess.created_at,
                selected_symptoms=symptoms,
                selected_topics=topics,
                presenting_complaints=complaints,
                uploaded_files=file_refs if file_refs else sess.uploaded_files,
                measurements_snapshot=client.measurements,
                ai_analysis=suggestions.model_dump(),
                api_usage=usage,
                chat_log=sess.chat_log,
                generated_plan_slug=sess.generated_plan_slug,
                coach_notes=sess.coach_notes,
                next_session_planned=sess.next_session_planned,
                five_pillars=five_pillars_obj or sess.five_pillars,
            )
            plan_storage.update_session(root, updated)
            sid = existing_sid
        except Exception:
            # Fall through to creating a new session if update fails
            sid = plan_storage.next_session_id(root, client.client_id, today)
            sess = Session(
                session_id=sid,
                client_id=client.client_id,
                date=today,
                created_at=now,
                selected_symptoms=symptoms,
                selected_topics=topics,
                presenting_complaints=complaints,
                uploaded_files=file_refs,
                measurements_snapshot=client.measurements,
                ai_analysis=suggestions.model_dump(),
                api_usage=usage,
                five_pillars=five_pillars_obj,
            )
            try:
                plan_storage.write_session(root, sess)
            except FileExistsError:
                plan_storage.update_session(root, sess)
    else:
        sid = plan_storage.next_session_id(root, client.client_id, today)
        sess = Session(
            session_id=sid,
            client_id=client.client_id,
            date=today,
            created_at=now,
            selected_symptoms=symptoms,
            selected_topics=topics,
            presenting_complaints=complaints,
            uploaded_files=file_refs,
            measurements_snapshot=client.measurements,
            ai_analysis=suggestions.model_dump(),
            api_usage=usage,
            five_pillars=five_pillars_obj,
        )
        plan_storage.write_session(root, sess)

    json.dump({
        "ok": True,
        "session_id": sid,
        "suggestions": suggestions.model_dump(),
        "computed_ratios": computed_ratios,
        "usage": usage,
        "subgraph_size_bytes": subgraph_bytes,
        "error": None,
    }, sys.stdout, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
