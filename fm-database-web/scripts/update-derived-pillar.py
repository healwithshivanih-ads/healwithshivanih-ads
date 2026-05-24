#!/usr/bin/env python3
"""Tier 1 weekly-poll rollup (added 2026-05-24).

Single pillar score from a poll button tap → merge into
client.yaml#derived_five_pillars.{pillar}. API-free. Idempotent within the
same poll-reply (writes received_at + score + raw_text every time).

Input JSON on stdin:
  {
    "client_id": "cl-005",
    "pillar":    "sleep" | "stress" | "movement" | "nutrition" | "connection",
    "rating":    1..5,
    "raw_text":  "Sleeping well",
    "received_at": ISO-8601 (defaults to now),
    "source":    "weekly_poll"
  }

Output:
  {"ok": true, "client_id": ..., "pillar": ..., "rating": ...}

The structure written:
  derived_five_pillars:
    sleep:       {rating: 5, raw: "Sleeping well", received_at: ISO, source: weekly_poll}
    stress:      {rating: 3, raw: "Some pressure", received_at: ISO, ...}
    movement:    {...}
    nutrition:   {...}
    connection:  {...}
    updated_at:  ISO  (any pillar wrote = bumped)

The OutcomeProgressCard + Overview Five Pillars tile read this alongside
manual FivePillarsAssessment captures from sessions; whichever is newer
wins for the headline number.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sys
from pathlib import Path

import yaml

VALID_PILLARS = {"sleep", "stress", "movement", "nutrition", "connection"}


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env)
    return Path.home() / "fm-plans"


def _client_yaml_path(client_id: str) -> Path:
    return _plans_root() / "clients" / client_id / "client.yaml"


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except Exception as e:
        json.dump({"ok": False, "error": f"invalid JSON stdin: {e}"}, sys.stdout)
        return 2

    client_id = (payload.get("client_id") or "").strip()
    pillar = (payload.get("pillar") or "").strip()
    if not client_id:
        json.dump({"ok": False, "error": "client_id required"}, sys.stdout)
        return 2
    if pillar not in VALID_PILLARS:
        json.dump(
            {"ok": False, "error": f"invalid pillar '{pillar}'; expected one of {sorted(VALID_PILLARS)}"},
            sys.stdout,
        )
        return 2
    rating = payload.get("rating")
    try:
        rating = int(rating)
    except Exception:
        json.dump({"ok": False, "error": "rating must be int 1..5"}, sys.stdout)
        return 2
    if not 1 <= rating <= 5:
        json.dump({"ok": False, "error": "rating must be in 1..5"}, sys.stdout)
        return 2

    raw = str(payload.get("raw_text") or "").strip()
    received_at = str(payload.get("received_at") or _now_iso())
    source = str(payload.get("source") or "weekly_poll")

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

    existing = data.get("derived_five_pillars")
    if not isinstance(existing, dict):
        existing = {}

    entry = {
        "rating": rating,
        "raw": raw,
        "received_at": received_at,
        "source": source,
    }
    # Don't overwrite with an OLDER received_at — a late-arriving webhook
    # for a previous week shouldn't clobber the most-recent answer.
    prev = existing.get(pillar) if isinstance(existing.get(pillar), dict) else None
    if prev and isinstance(prev.get("received_at"), str) and prev["received_at"] > received_at:
        # Newer record already on file. No-op but still ok=true so the
        # webhook flow doesn't error.
        json.dump(
            {
                "ok": True,
                "client_id": client_id,
                "pillar": pillar,
                "rating": prev.get("rating"),
                "skipped": "older than existing record",
            },
            sys.stdout,
        )
        return 0

    existing[pillar] = entry
    existing["updated_at"] = _now_iso()
    data["derived_five_pillars"] = existing

    yaml_path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True))

    json.dump(
        {
            "ok": True,
            "client_id": client_id,
            "pillar": pillar,
            "rating": rating,
            "path": str(yaml_path),
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
