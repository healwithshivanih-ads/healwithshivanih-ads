#!/usr/bin/env python3
"""Parse free-form coach notes into structured health data.

Coach types anything — e.g.:
  "weight 68kg, height 163cm, TSH 4.2 mIU/L, ferritin 12, BP 118/76,
   on levothyroxine 50mcg and vitamin D 2000 IU, diagnosed Hashimoto's"

Reads JSON from stdin:
{
  "text": str,       # free-form text from coach
  "dry_run": bool
}

Writes JSON to stdout (same shape as extract-symptoms.py extracted_data):
{
  "ok": bool,
  "extracted_data": {
    "lab_values": [{"test_name": str, "value": str, "unit": str}],
    "measurements": {"height_cm": float|null, "weight_kg": float|null,
                     "bp_systolic": int|null, "bp_diastolic": int|null,
                     "hr_bpm": int|null, "waist_cm": float|null,
                     "hip_cm": float|null},
    "medications": [str],
    "conditions": [str]
  },
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


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


EMPTY = {
    "lab_values": [],
    "measurements": {
        "height_cm": None,
        "weight_kg": None,
        "bp_systolic": None,
        "bp_diastolic": None,
        "hr_bpm": None,
        "waist_cm": None,
        "hip_cm": None,
    },
    "medications": [],
    "conditions": [],
}


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    text: str = (payload.get("text") or "").strip()
    dry_run: bool = bool(payload.get("dry_run"))

    if not text:
        json.dump({"ok": False, "error": "text is required"}, sys.stdout)
        return 2

    if dry_run:
        json.dump({
            "ok": True,
            "extracted_data": {
                "lab_values": [
                    {"test_name": "TSH", "value": "4.2", "unit": "mIU/L"},
                    {"test_name": "Ferritin", "value": "12", "unit": "ng/mL"},
                ],
                "measurements": {
                    "height_cm": 163.0,
                    "weight_kg": 68.0,
                    "bp_systolic": 118,
                    "bp_diastolic": 76,
                    "hr_bpm": None,
                    "waist_cm": None,
                    "hip_cm": None,
                },
                "medications": ["Levothyroxine 50mcg daily", "Vitamin D 2000 IU"],
                "conditions": ["Hashimoto's thyroiditis"],
            },
        }, sys.stdout)
        return 0

    _load_dotenv()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 2

    prompt = (
        "You are a medical data extractor. The coach has typed free-form notes "
        "about a patient. Extract ALL structured health data from the text.\n\n"
        "TEXT FROM COACH:\n"
        f"{text[:20000]}\n\n"
        "Return ONLY a JSON object (no markdown, no preamble):\n"
        "{\n"
        '  "lab_values": [\n'
        '    {"test_name": "TSH", "value": "4.2", "unit": "mIU/L", "date_drawn": null}\n'
        '  ],\n'
        '  "measurements": {\n'
        '    "height_cm": null,\n'
        '    "weight_kg": null,\n'
        '    "bp_systolic": null,\n'
        '    "bp_diastolic": null,\n'
        '    "hr_bpm": null,\n'
        '    "waist_cm": null,\n'
        '    "hip_cm": null\n'
        '  },\n'
        '  "medications": ["medication name + dose"],\n'
        '  "conditions": ["condition name"]\n'
        "}\n\n"
        "Rules:\n"
        "- For BP like '118/76': bp_systolic=118, bp_diastolic=76.\n"
        "- Convert weight in lbs to kg (÷ 2.205), height in feet/inches to cm.\n"
        "- For lab values, always include the unit if mentioned.\n"
        "- If a value is missing or unclear, use null for measurements.\n"
        "- Include ALL medications and supplements mentioned, with dose if given.\n"
        "- Include ALL diagnoses and conditions mentioned.\n"
        "- Do not invent values — only extract what is explicitly stated."
    )

    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    client = Anthropic(api_key=api_key)
    try:
        resp = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as e:
        json.dump({"ok": False, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    raw_text = resp.content[0].text.strip() if resp.content else ""
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        raw_text = "\n".join(lines[1:])
        raw_text = raw_text.rsplit("```", 1)[0].strip()

    try:
        extracted = json.loads(raw_text)
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"model returned non-JSON: {e}\n{raw_text[:300]}"}, sys.stdout)
        return 1

    raw_meas = extracted.get("measurements") or {}
    extracted_data = {
        "lab_values": [
            {
                "test_name": lv.get("test_name", ""),
                "value": str(lv.get("value", "")),
                "unit": lv.get("unit") or "",
                "date_drawn": lv.get("date_drawn"),
            }
            for lv in (extracted.get("lab_values") or [])
            if lv.get("test_name") and lv.get("value") is not None
        ],
        "measurements": {
            "height_cm": raw_meas.get("height_cm"),
            "weight_kg": raw_meas.get("weight_kg"),
            "bp_systolic": raw_meas.get("bp_systolic"),
            "bp_diastolic": raw_meas.get("bp_diastolic"),
            "hr_bpm": raw_meas.get("hr_bpm"),
            "waist_cm": raw_meas.get("waist_cm"),
            "hip_cm": raw_meas.get("hip_cm"),
        },
        "medications": [m for m in (extracted.get("medications") or []) if isinstance(m, str) and m.strip()],
        "conditions": [c for c in (extracted.get("conditions") or []) if isinstance(c, str) and c.strip()],
    }

    json.dump({"ok": True, "extracted_data": extracted_data}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
