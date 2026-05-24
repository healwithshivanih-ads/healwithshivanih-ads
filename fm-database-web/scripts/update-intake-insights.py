#!/usr/bin/env python3
"""Fix B 2026-05-23 — backfill `intake_insights.root_cause` on a client's
client.yaml WITHOUT an API call.

Coach (or the assistant in chat) hand-authors the root_cause block from
the intake transcript + audit notes, drops a JSON payload here, and this
shim merges it into `client.yaml#intake_insights.root_cause` preserving
any existing patterns / red_flags / top_hypotheses / verify_in_session /
coach_notes_for_ai.

Input (stdin JSON):
  {
    "client_id": "cl-007",
    "root_cause": {
      "label": "...",
      "reasoning": "...",
      "downstream_effects": ["..."],
      "confidence": 0.7
    },
    "regenerate_stamp": true   # optional — bumps generated_at to now
  }

If the client has no intake_insights yet, a minimal stub is created with
empty lists for the other four sections + generated_at=now + model="manual".
The Pydantic model on the Python catalogue side is extra="forbid" but the
TS loader is lenient + the renderer reads with defaults, so an
incomplete-but-valid record is fine.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sys
from pathlib import Path

import yaml


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / "fm-plans"


def _client_yaml_path(client_id: str) -> Path:
    root = _plans_root()
    a = root / "clients" / client_id / "client.yaml"
    if a.exists():
        return a
    b = root / "clients" / f"{client_id}.yaml"
    if b.exists():
        return b
    # default to the per-client-dir layout (created on first write)
    return a


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except Exception as e:
        json.dump({"ok": False, "error": f"invalid JSON stdin: {e}"}, sys.stdout)
        return 2

    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        json.dump({"ok": False, "error": "client_id is required"}, sys.stdout)
        return 2

    rc = payload.get("root_cause")
    if not isinstance(rc, dict) or not (rc.get("label") or "").strip():
        json.dump({"ok": False, "error": "root_cause.label is required"}, sys.stdout)
        return 2

    # Normalise root_cause
    norm_rc = {
        "label": str(rc["label"]).strip(),
        "reasoning": str(rc.get("reasoning") or "").strip(),
        "downstream_effects": [
            str(d).strip() for d in (rc.get("downstream_effects") or []) if str(d).strip()
        ],
        "confidence": float(rc.get("confidence") or 0.6),
    }

    yaml_path = _client_yaml_path(client_id)
    if not yaml_path.exists():
        json.dump(
            {"ok": False, "error": f"client.yaml not found at {yaml_path}"},
            sys.stdout,
        )
        return 2

    text = yaml_path.read_text()
    data = yaml.safe_load(text) or {}
    if not isinstance(data, dict):
        json.dump({"ok": False, "error": "client.yaml is not a mapping"}, sys.stdout)
        return 2

    existing = data.get("intake_insights")
    if not isinstance(existing, dict):
        existing = {
            "generated_at": _now_iso(),
            "model": "manual",
            "patterns": [],
            "red_flags": [],
            "top_hypotheses": [],
            "verify_in_session": [],
            "coach_notes_for_ai": "",
        }

    existing["root_cause"] = norm_rc
    if payload.get("regenerate_stamp"):
        existing["generated_at"] = _now_iso()
        existing["model"] = "manual"
    data["intake_insights"] = existing

    yaml_path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True))

    json.dump(
        {
            "ok": True,
            "client_id": client_id,
            "path": str(yaml_path),
            "root_cause": norm_rc,
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
