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
  "usage": {...},
  "subgraph_size": int,       # bytes
  "error": str | null
}

Persists a Session record to ~/fm-plans/clients/<id>/sessions/<sid>.yaml on success.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

# Wire imports to the Python engine.
FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
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
                {"topic_slug": t, "role": "primary", "rationale": "[dry-run]"}
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

    if not client_id:
        json.dump({"ok": False, "error": "client_id is required"}, sys.stdout)
        return 2

    _load_dotenv()

    # Imports deferred so --help / arg-validation paths don't pay their cost.
    from fmdb.validator import load_all
    from fmdb.assess.subgraph import build_subgraph
    from fmdb.plan import storage as plan_storage
    from fmdb.plan.models import Session, UploadedFileRef

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
    today = date.today()
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
        "sex": client.sex,
        "active_conditions": client.active_conditions,
        "medical_history": client.medical_history,
        "current_medications": client.current_medications,
        "known_allergies": client.known_allergies,
        "goals": client.goals,
        "notes": client.notes,
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
            "selected_symptoms": s.selected_symptoms,
            "selected_topics": s.selected_topics,
            "drivers": [d.get("mechanism_slug") for d in (ai.get("likely_drivers") or [])],
            "supplements": [
                {"slug": sp.get("supplement_slug"), "dose": sp.get("dose")}
                for sp in (ai.get("supplement_suggestions") or [])
            ],
            "synthesis_notes": ai.get("synthesis_notes", ""),
        })

    if dry_run:
        result = _synthetic_result(payload)
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
            )
        except Exception as e:
            json.dump({"ok": False, "error": f"synthesize() failed: {type(e).__name__}: {e}"}, sys.stdout)
            return 1

    # ----- persist session -----
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
        ai_analysis=result.get("suggestions", {}),
        api_usage=result.get("usage", {}),
    )
    plan_storage.write_session(root, sess)

    json.dump({
        "ok": True,
        "session_id": sid,
        "suggestions": result.get("suggestions", {}),
        "usage": result.get("usage", {}),
        "subgraph_size_bytes": subgraph_bytes,
        "error": None,
    }, sys.stdout, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
