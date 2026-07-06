#!/usr/bin/env python3
"""Persist a client-app body-composition + vitals update.

The client updates weight / waist / hip from the app's settings page
(height + age are read-only, sourced from the coach dashboard), and
optionally logs weight / blood pressure / energy from the daily quick-log
sheet on the Progress tab. This writes the new numbers into the SAME
places the coach dashboard reads, so a self-reported update shows up in
health-trends and powers the app's own progress charts:

  · client.measurements  — the "latest" snapshot the dashboard shows
    (weight_kg / waist_cm / hip_cm / bp_systolic / bp_diastolic +
    measured_on bumped to today)
  · client.health_snapshots[] — append (or replace today's) an entry
    tagged source "client_app", which is what the trend charts read.
    mood_score (1-5) rides along as a sibling of `measurements` on that
    same entry — it's a daily energy tap, not a body measurement, so it
    isn't folded into the measurements sub-dict or the coach's flat
    "latest" snapshot.

Only fields the client actually sent are touched; height is carried
through from the existing measurement so the snapshot stays complete.

Reads JSON from stdin:
{
  "client_id": str,
  "weight_kg": number | null,
  "waist_cm":  number | null,
  "hip_cm":    number | null,
  "bp_systolic": number | null,
  "bp_diastolic": number | null,
  "mood_score": number | null   # integer 1-5
}

Writes JSON to stdout: {"ok": bool, "measured_on": str?, "error": str?}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# sane physiological bounds — reject typos / junk before they reach the file
_BOUNDS = {
    "weight_kg": (20.0, 400.0),
    "waist_cm": (30.0, 300.0),
    "hip_cm": (30.0, 300.0),
    "bp_systolic": (70.0, 260.0),
    "bp_diastolic": (40.0, 180.0),
}


def _clean_mood(payload: dict):
    v = payload.get("mood_score")
    if v is None or v == "":
        return None
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 5 else None


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _clean(payload: dict, key: str):
    v = payload.get(key)
    if v is None or v == "":
        return None
    try:
        f = round(float(v), 1)
    except (TypeError, ValueError):
        return None
    lo, hi = _BOUNDS[key]
    return f if lo <= f <= hi else None


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

    fields = {k: _clean(payload, k) for k in _BOUNDS}
    mood = _clean_mood(payload)
    if all(v is None for v in fields.values()) and mood is None:
        json.dump({"ok": False, "error": "no valid measurements provided"}, sys.stdout)
        return 2

    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml: {e}"}, sys.stdout)
        return 1

    client_yaml = _plans_root() / "clients" / client_id / "client.yaml"
    if not client_yaml.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    try:
        with client_yaml.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except yaml.YAMLError as e:
        json.dump({"ok": False, "error": f"could not read client.yaml: {e}"}, sys.stdout)
        return 1
    if not isinstance(data, dict):
        json.dump({"ok": False, "error": "client.yaml is not a mapping"}, sys.stdout)
        return 1

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now_iso = datetime.now(timezone.utc).isoformat()

    meas = data.get("measurements")
    if not isinstance(meas, dict):
        meas = {}
    height_cm = meas.get("height_cm")
    has_measurement = any(v is not None for v in fields.values())

    # 1) update the dashboard "latest" measurement (only sent fields). Skipped
    # entirely on a mood-only submission — bumping measured_on/notes when no
    # actual measurement came in would misrepresent when weight was last taken.
    if has_measurement:
        for k, v in fields.items():
            if v is not None:
                meas[k] = v
        meas["measured_on"] = today
        note = meas.get("notes") or ""
        tag = f"[self-reported from app {today}]"
        if tag not in note:
            meas["notes"] = (note + " " + tag).strip()
        data["measurements"] = meas

    # 2) append (or replace today's) health snapshot — source client_app
    snap_meas = {}
    if height_cm:
        snap_meas["height_cm"] = height_cm
    for k, v in fields.items():
        if v is not None:
            snap_meas[k] = v

    snaps = data.get("health_snapshots")
    if not isinstance(snaps, list):
        snaps = []
    replaced = False
    for s in snaps:
        if isinstance(s, dict) and s.get("date") == today and s.get("source") == "client_app":
            existing = s.get("measurements") if isinstance(s.get("measurements"), dict) else {}
            existing.update(snap_meas)
            s["measurements"] = existing
            if mood is not None:
                s["mood_score"] = mood
            s["updated_at"] = now_iso
            replaced = True
            break
    if not replaced:
        entry = {
            "date": today,
            "source": "client_app",
            "measurements": snap_meas,
            "created_at": now_iso,
        }
        if mood is not None:
            entry["mood_score"] = mood
        snaps.append(entry)
    data["health_snapshots"] = snaps

    # atomic-ish write (temp + replace) so a crash can't truncate client.yaml
    tmp = client_yaml.with_suffix(".yaml.tmp")
    try:
        with tmp.open("w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
        os.replace(tmp, client_yaml)
    except OSError as e:
        json.dump({"ok": False, "error": f"write failed: {e}"}, sys.stdout)
        return 1
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass

    json.dump({"ok": True, "measured_on": today}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
