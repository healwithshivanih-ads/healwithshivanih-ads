#!/usr/bin/env python3
"""Thin shim wrapping fmdb.assess.suggester.chat for the Next.js UI.

Reads JSON from stdin:
{
  "client_id":   str,
  "session_id":  str,           # the session created by assess.py
  "history":     [{"role": "user"|"assistant", "content": str, "at"?: iso}],
  "user_message": str,
  "dry_run":     bool           # if true, return a synthetic reply
}

Writes JSON to stdout:
{
  "ok":               bool,
  "assistant_message": str,
  "usage":            {...},
  "error":            str | null
}

On success, appends the new user + assistant turns to the session's chat_log
(persisted via fmdb.plan.storage.update_session) so history survives reload.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
sys.path.insert(0, str(FMDB_ROOT))


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _synthetic_reply(user_message: str, history_len: int) -> dict:
    return {
        "reply": (
            f"[dry-run] heard your message ({len(user_message)} chars). "
            f"This is turn #{history_len + 1}. No Anthropic call was made."
        ),
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
    session_id = payload.get("session_id") or ""
    history = payload.get("history") or []
    user_message = payload.get("user_message") or ""
    dry_run = bool(payload.get("dry_run"))

    if not user_message.strip():
        json.dump({"ok": False, "error": "user_message is required"}, sys.stdout)
        return 2

    _load_dotenv()

    now = datetime.now(timezone.utc)
    new_user_turn = {"role": "user", "content": user_message, "at": now.isoformat()}

    # Dry-run path can skip the engine entirely if we lack a real session.
    if dry_run and (not client_id or not session_id):
        result = _synthetic_reply(user_message, len(history))
        json.dump({
            "ok": True,
            "assistant_message": result["reply"],
            "usage": result["usage"],
            "error": None,
        }, sys.stdout)
        return 0

    if not client_id or not session_id:
        json.dump({"ok": False, "error": "client_id and session_id are required"}, sys.stdout)
        return 2

    # Real path: load engine + session.
    from fmdb.validator import load_all
    from fmdb.assess.subgraph import build_subgraph
    from fmdb.plan import storage as plan_storage
    from fmdb.plan.models import ChatTurn

    data_dir = FMDB_ROOT / "data"
    cat = load_all(data_dir)
    root = plan_storage.plans_root()

    try:
        client = plan_storage.load_client(root, client_id)
    except FileNotFoundError as e:
        json.dump({"ok": False, "error": f"client not found: {client_id} ({e})"}, sys.stdout)
        return 2

    try:
        session = plan_storage.load_session(root, client_id, session_id)
    except FileNotFoundError as e:
        json.dump({"ok": False, "error": f"session not found: {session_id} ({e})"}, sys.stdout)
        return 2

    # Re-build the same context that synthesize() saw, so the chat call has
    # client + subgraph + suggestions to answer follow-ups against.
    subgraph = build_subgraph(
        cat,
        symptom_slugs=session.selected_symptoms,
        topic_slugs=session.selected_topics,
    )

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

    chat_context = {
        "client_ctx": client_ctx,
        "selected_symptoms": session.selected_symptoms,
        "selected_topics": session.selected_topics,
        "additional_notes": session.presenting_complaints,
        "suggestions": session.ai_analysis or {},
        "subgraph": subgraph,
        "session_history": [],  # already baked into ai_analysis context
    }

    # Build messages for the chat call: full history + new user turn.
    # The shim wrapper takes care of the cached context preamble.
    messages = [
        {"role": t.get("role"), "content": t.get("content")}
        for t in history
        if t.get("role") in ("user", "assistant") and t.get("content")
    ]
    messages.append({"role": "user", "content": user_message})

    if dry_run:
        result = _synthetic_reply(user_message, len(history))
    else:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
            return 2
        from fmdb.assess.suggester import chat as suggester_chat
        try:
            result = suggester_chat(chat_context=chat_context, messages=messages)
        except Exception as e:
            json.dump(
                {"ok": False, "error": f"chat() failed: {type(e).__name__}: {e}"},
                sys.stdout,
            )
            return 1

    assistant_text = result.get("reply", "")
    usage = result.get("usage", {})

    # Persist both turns to session.chat_log (in-place update).
    try:
        session.chat_log.append(ChatTurn(role="user", content=user_message, at=now))
        session.chat_log.append(
            ChatTurn(role="assistant", content=assistant_text, at=datetime.now(timezone.utc))
        )
        plan_storage.update_session(root, session)
    except Exception as e:
        # Non-fatal: surface the reply, flag the persistence failure.
        json.dump({
            "ok": True,
            "assistant_message": assistant_text,
            "usage": usage,
            "error": f"reply succeeded but session-persist failed: {type(e).__name__}: {e}",
        }, sys.stdout, default=str)
        return 0

    json.dump({
        "ok": True,
        "assistant_message": assistant_text,
        "usage": usage,
        "error": None,
    }, sys.stdout, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
