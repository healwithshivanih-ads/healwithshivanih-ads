#!/usr/bin/env python3
"""Recompute client.lab_markers from the full health_snapshots history.

Reads JSON from stdin:
  {"client_id": "cl-xxx"}

Writes JSON to stdout:
  {"ok": True, "markers_count": N, "lab_markers_date": "YYYY-MM-DD"}

Walks every snapshot's lab_values, runs fmdb.assess.lab_ratios.compute_ratios
on the flattened union, and writes the result back to
~/fm-plans/clients/<id>/client.yaml. Snapshot date fills in date_drawn
where the extracted lab didn't carry one, so compute_ratios's
recency-tiebreak picks the right value when the same marker appears
in multiple snapshots.

Used by:
  - Overview FM markers panel "🔄 Re-run markers" button
  - Any time the coach suspects lab_markers has drifted from the
    snapshot truth (after manual snapshot edits, after a stale
    extraction got fixed, after re-uploading a corrected report).
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

    client_yaml = plans_root() / "clients" / client_id / "client.yaml"
    if not client_yaml.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml missing: {e}"}, sys.stdout)
        return 1

    try:
        from fmdb.assess.lab_ratios import compute_ratios  # type: ignore
    except Exception as e:
        json.dump(
            {"ok": False, "error": f"lab_ratios import failed: {e}"},
            sys.stdout,
        )
        return 1

    with client_yaml.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    snapshots = data.get("health_snapshots") or []
    all_labs: list[dict] = []
    for snap in snapshots:
        if not isinstance(snap, dict):
            continue
        snap_date = snap.get("date")
        for lv in (snap.get("lab_values") or []):
            if not isinstance(lv, dict):
                continue
            # Inherit snapshot's date if the lab entry didn't carry one
            # so compute_ratios's date-based tiebreak orders sensibly.
            if not lv.get("date_drawn") and snap_date:
                lv = dict(lv)
                lv["date_drawn"] = snap_date
            all_labs.append(lv)

    if not all_labs:
        json.dump(
            {"ok": True, "markers_count": 0, "lab_markers_date": None,
             "message": "No lab values across snapshots — nothing to compute."},
            sys.stdout,
        )
        return 0

    markers = compute_ratios(all_labs)
    data["lab_markers"] = markers
    # Newest date_drawn across all labs as the marker date
    all_dates = sorted(
        [str(lv.get("date_drawn") or "") for lv in all_labs],
        reverse=True,
    )
    latest = all_dates[0] if all_dates and all_dates[0] else None
    if latest:
        data["lab_markers_date"] = latest
    data["version"] = (data.get("version") or 1) + 1

    with client_yaml.open("w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    json.dump(
        {"ok": True, "markers_count": len(markers), "lab_markers_date": latest},
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
