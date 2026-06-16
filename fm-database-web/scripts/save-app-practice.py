#!/usr/bin/env python3
"""Log a completed in-app practice round (EFT tapping or guided breathing).

This is the compliance + effectiveness dataset. Every completed round appends
ONE JSON line to ~/fm-plans/clients/<id>/_practice_log.jsonl — append-only,
easy to aggregate later (adherence over time, EFT SUDS deltas, breathing
frequency). No AI, no Pydantic round-trip; a plain JSONL write that syncs back
to the Mac via Mutagen like every other client-app write-back.

Reads JSON from stdin:
{
  "client_id":  str,
  "kind":       "eft" | "breath",
  "practice_id": str,
  "name":       str,          # theme label / breathing pattern name
  "theme":      str | null,   # eft theme key
  "suds_before": int | null,  # eft 0-10 before
  "suds_after":  int | null,  # eft 0-10 after
  "rounds":      int | null,  # breath rounds completed
  "seconds":     int | null   # session length in seconds
}

Writes JSON to stdout: {"ok": bool, "error": str?}
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


def _opt_int(v, lo: int, hi: int):
    if v is None or v == "":
        return None
    try:
        return max(lo, min(int(v), hi))
    except (TypeError, ValueError):
        return None


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

    kind = (payload.get("kind") or "").strip().lower()
    if kind not in ("eft", "breath", "sleep"):
        json.dump({"ok": False, "error": f"bad kind: {kind!r}"}, sys.stdout)
        return 2

    client_dir = _plans_root() / "clients" / client_id
    if not client_dir.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    now = datetime.now(timezone.utc)
    sb = _opt_int(payload.get("suds_before"), 0, 10)
    sa = _opt_int(payload.get("suds_after"), 0, 10)
    delta = (sb - sa) if (sb is not None and sa is not None) else None  # +ve = relief

    record = {
        "ts": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
        "kind": kind,
        "practice_id": (payload.get("practice_id") or "").strip()[:120],
        "name": (payload.get("name") or "").strip()[:160],
        "theme": (payload.get("theme") or None),
        "suds_before": sb,
        "suds_after": sa,
        "suds_delta": delta,
        "rounds": _opt_int(payload.get("rounds"), 0, 200),
        "seconds": _opt_int(payload.get("seconds"), 0, 36000),
        "source": "client_app",
    }

    log_path = client_dir / "_practice_log.jsonl"
    try:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        json.dump({"ok": False, "error": f"write failed: {e}"}, sys.stdout)
        return 1

    json.dump({"ok": True}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
