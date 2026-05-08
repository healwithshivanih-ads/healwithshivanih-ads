#!/usr/bin/env python3
"""Compute FM lab ratios from extracted lab values.

Reads JSON from stdin:
{
  "lab_values": [
    {"test_name": str, "value": str, "unit": str, "date_drawn": str | null}
  ]
}

Writes JSON to stdout:
{
  "ok": bool,
  "ratios": [
    {
      "marker_name": str,
      "value": float,
      "unit": str,
      "reference_range": str,
      "flag": "optimal" | "suboptimal" | "out_of_range",
      "fm_interpretation": str,
      "panel": str,
      "computed": bool
    }
  ],
  "error": str | null
}
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "ratios": [], "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    lab_values = payload.get("lab_values") or []

    if not lab_values:
        json.dump({"ok": True, "ratios": [], "error": None}, sys.stdout)
        return 0

    try:
        from fmdb.assess.lab_ratios import compute_ratios
    except ImportError as e:
        json.dump({"ok": False, "ratios": [], "error": f"import error: {e}"}, sys.stdout)
        return 1

    try:
        ratios = compute_ratios(lab_values)
    except Exception as e:
        json.dump({"ok": False, "ratios": [], "error": f"compute error: {e}"}, sys.stdout)
        return 1

    json.dump({"ok": True, "ratios": ratios, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
