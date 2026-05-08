#!/usr/bin/env python3
"""Merge transcript-extracted health data into a client YAML.

Reads JSON from stdin:
{
  "client_id": str,
  "measurements": {          # optional — null fields are skipped
    "height_cm": float | null,
    "weight_kg": float | null,
    "bp_systolic": int | null,
    "bp_diastolic": int | null,
    "hr_bpm": int | null,
    "waist_cm": float | null,
    "hip_cm": float | null
  },
  "medications": [str],      # optional — merged (deduplicated) with existing
  "conditions": [str],       # optional — merged (deduplicated) with existing
  "source": str              # attribution note (e.g. "transcript-2026-05-03")
}

Writes JSON to stdout:
{
  "ok": bool,
  "updated_fields": [str],   # which top-level fields were touched
  "error": str | null
}
"""
from __future__ import annotations

import json
import os
import sys
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
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id: str = payload.get("client_id") or ""
    if not client_id:
        json.dump({"ok": False, "error": "client_id is required"}, sys.stdout)
        return 2

    measurements: dict = payload.get("measurements") or {}
    new_medications: list[str] = payload.get("medications") or []
    new_conditions: list[str] = payload.get("conditions") or []
    source: str = payload.get("source") or "manual"
    # lab_values are stored in snapshots but not merged into the profile
    # (profile only stores computed FM ratios from assess.py)

    # ── Load client YAML ─────────────────────────────────────────────────────
    client_dir = plans_root() / "clients" / client_id
    client_yaml = client_dir / "client.yaml"
    if not client_yaml.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml not installed: {e}"}, sys.stdout)
        return 1

    with client_yaml.open("r", encoding="utf-8") as f:
        data: dict = yaml.safe_load(f) or {}

    updated_fields: list[str] = []

    # ── Merge measurements ────────────────────────────────────────────────────
    meas_field_map = {
        "height_cm": "height_cm",
        "weight_kg": "weight_kg",
        "bp_systolic": "blood_pressure_systolic",
        "bp_diastolic": "blood_pressure_diastolic",
        "hr_bpm": "resting_heart_rate",
        "waist_cm": "waist_cm",
        "hip_cm": "hip_cm",
    }

    existing_meas: dict = data.get("measurements") or {}
    meas_updated = False

    for src_key, dst_key in meas_field_map.items():
        val = measurements.get(src_key)
        if val is not None:
            existing_meas[dst_key] = val
            meas_updated = True

    if meas_updated:
        import datetime
        existing_meas["measured_on"] = datetime.date.today().isoformat()
        existing_meas["notes"] = (
            (existing_meas.get("notes") or "") +
            f" [auto-captured from {source}]"
        ).strip()
        data["measurements"] = existing_meas
        updated_fields.append("measurements")

    # ── Merge medications ─────────────────────────────────────────────────────
    if new_medications:
        existing_meds: list[str] = data.get("current_medications") or data.get("medications") or []
        existing_lower = {m.lower() for m in existing_meds}
        added = [m for m in new_medications if m.lower() not in existing_lower]
        if added:
            merged = existing_meds + added
            # Write to whichever key the file already uses
            if "current_medications" in data:
                data["current_medications"] = merged
            else:
                data["medications"] = merged
            updated_fields.append("medications")

    # ── Merge conditions ─────────────────────────────────────────────────────
    if new_conditions:
        existing_conds: list[str] = data.get("active_conditions") or data.get("conditions") or []
        existing_lower = {c.lower() for c in existing_conds}
        added_conds = [c for c in new_conditions if c.lower() not in existing_lower]
        if added_conds:
            merged_conds = existing_conds + added_conds
            if "active_conditions" in data:
                data["active_conditions"] = merged_conds
            else:
                data["conditions"] = merged_conds
            updated_fields.append("conditions")

    if not updated_fields:
        json.dump({"ok": True, "updated_fields": [], "message": "nothing to update"}, sys.stdout)
        return 0

    # ── Append health snapshot ────────────────────────────────────────────────
    # Every apply-call adds an immutable snapshot so we can build trend charts.
    import datetime
    snap: dict = {
        "date": datetime.date.today().isoformat(),
        "source": source,
    }
    # Include whatever we received (even if not new vs profile, the snapshot is the record)
    snap_meas = {k: measurements.get(k) for k in meas_field_map if measurements.get(k) is not None}
    if snap_meas:
        snap["measurements"] = snap_meas
    snap_labs = payload.get("lab_values") or []
    if snap_labs:
        snap["lab_values"] = snap_labs
    if new_medications:
        snap["medications"] = new_medications
    if new_conditions:
        snap["conditions"] = new_conditions

    existing_snaps: list = data.get("health_snapshots") or []
    # Deduplicate: if same date+source already exists, replace it
    existing_snaps = [s for s in existing_snaps if not (s.get("date") == snap["date"] and s.get("source") == snap["source"])]
    existing_snaps.append(snap)
    data["health_snapshots"] = existing_snaps

    # Bump version
    data["version"] = (data.get("version") or 1) + 1

    with client_yaml.open("w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    json.dump({"ok": True, "updated_fields": updated_fields}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
