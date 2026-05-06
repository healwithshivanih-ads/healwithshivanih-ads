#!/usr/bin/env python3
"""Extract symptom slugs AND health data from a client call/consultation transcript.

Reads JSON from stdin:
{
  "transcript_text": str,       # raw text of the transcript
  "transcript_path": str,       # OR path to a saved file (txt or pdf)
  "mime_type": str,             # "text/plain" | "application/pdf"
  "symptom_catalogue": [        # full list of {slug, label, aliases}
    {"slug": str, "label": str, "aliases": [str]}
  ],
  "dry_run": bool
}

Writes JSON to stdout:
{
  "ok": bool,
  "matched_slugs": [str],       # catalogue slugs detected in the transcript
  "mentions": [                  # supporting evidence per slug
    {"slug": str, "quote": str}
  ],
  "extracted_data": {            # structured health data found in transcript
    "lab_values": [{"test_name": str, "value": str, "unit": str, "date_drawn": str | null}],
    "measurements": {            # any mentioned body measurements
      "height_cm": float | null,
      "weight_kg": float | null,
      "bp_systolic": int | null,
      "bp_diastolic": int | null,
      "hr_bpm": int | null,
      "waist_cm": float | null
    },
    "medications": [str],        # medications + doses mentioned
    "conditions": [str]          # diagnoses / conditions mentioned
  },
  "error": str | null
}
"""
from __future__ import annotations

import base64
import json
import os
import sys
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
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


EMPTY_EXTRACTED_DATA = {
    "lab_values": [],
    "measurements": {
        "height_cm": None,
        "weight_kg": None,
        "bp_systolic": None,
        "bp_diastolic": None,
        "hr_bpm": None,
        "waist_cm": None,
    },
    "medications": [],
    "conditions": [],
}


def _normalise_google_doc_url(url: str) -> str:
    import re
    m = re.search(r"docs\.google\.com/document/d/([A-Za-z0-9_-]+)", url)
    if m:
        return f"https://docs.google.com/document/d/{m.group(1)}/export?format=txt"
    return url


def _fetch_url(url: str) -> tuple:
    """Returns (text_or_none, pdf_bytes_or_none, error_str)."""
    import urllib.request, urllib.error
    url = _normalise_google_doc_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            ct = resp.headers.get("Content-Type", "")
            raw = resp.read()
            if "pdf" in ct.lower() or url.lower().endswith(".pdf"):
                return None, raw, ""
            enc = "utf-8"
            for part in ct.split(";"):
                part = part.strip()
                if part.startswith("charset="):
                    enc = part.split("=", 1)[1].strip()
            return raw.decode(enc, errors="replace"), None, ""
    except Exception as e:
        return None, None, str(e)


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    transcript_text: str = payload.get("transcript_text") or ""
    transcript_path: str = payload.get("transcript_path") or ""
    transcript_url: str = payload.get("transcript_url") or ""
    mime_type: str = payload.get("mime_type") or "text/plain"
    symptom_catalogue: list[dict] = payload.get("symptom_catalogue") or []
    dry_run: bool = bool(payload.get("dry_run"))

    if dry_run:
        json.dump({
            "ok": True,
            "matched_slugs": ["fatigue", "brain-fog", "bloating"],
            "mentions": [
                {"slug": "fatigue", "quote": "[dry-run] always tired"},
                {"slug": "brain-fog", "quote": "[dry-run] can't focus"},
                {"slug": "bloating", "quote": "[dry-run] stomach bloated after meals"},
            ],
            "extracted_data": {
                "lab_values": [
                    {"test_name": "TSH", "value": "4.2", "unit": "mIU/L", "date_drawn": None},
                    {"test_name": "Fasting Glucose", "value": "98", "unit": "mg/dL", "date_drawn": None},
                    {"test_name": "Ferritin", "value": "12", "unit": "ng/mL", "date_drawn": None},
                ],
                "measurements": {
                    "height_cm": 163.0,
                    "weight_kg": 68.0,
                    "bp_systolic": 118,
                    "bp_diastolic": 76,
                    "hr_bpm": None,
                    "waist_cm": None,
                },
                "medications": ["Levothyroxine 50mcg daily"],
                "conditions": ["Hypothyroidism", "Iron deficiency"],
            },
        }, sys.stdout)
        return 0

    _load_dotenv()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 2

    # ── Read file if path given ──────────────────────────────────────────────
    content_blocks: list[dict] = []

    if transcript_path and not transcript_text:
        p = Path(transcript_path)
        if not p.exists():
            json.dump({"ok": False, "error": f"file not found: {transcript_path}"}, sys.stdout)
            return 2

        if mime_type == "application/pdf":
            data_b64 = base64.b64encode(p.read_bytes()).decode()
            content_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": data_b64},
                "title": p.name,
            })
        else:
            transcript_text = p.read_text(errors="replace")

    elif transcript_url and not transcript_text and not content_blocks:
        text, pdf_bytes, err = _fetch_url(transcript_url)
        if err:
            json.dump({"ok": False, "error": f"Failed to fetch URL: {err}"}, sys.stdout)
            return 2
        if pdf_bytes is not None:
            data_b64 = base64.b64encode(pdf_bytes).decode()
            content_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": data_b64},
                "title": transcript_url,
            })
        elif text:
            transcript_text = text
        else:
            json.dump({"ok": False, "error": "URL returned empty content"}, sys.stdout)
            return 2

    if not transcript_text and not content_blocks:
        json.dump({"ok": False, "error": "no transcript text, path, or URL provided"}, sys.stdout)
        return 2

    # ── Build compact catalogue reference (slug: label + top aliases) ────────
    catalogue_lines = []
    for s in symptom_catalogue[:300]:
        slug = s.get("slug", "")
        label = s.get("label", slug)
        aliases = s.get("aliases") or []
        alias_str = f" (also: {', '.join(aliases[:4])})" if aliases else ""
        catalogue_lines.append(f"  {slug}: {label}{alias_str}")
    catalogue_ref = "\n".join(catalogue_lines)

    # ── Build the user message ───────────────────────────────────────────────
    instruction = (
        "You are extracting structured health information from a patient consultation transcript.\n\n"
        "SYMPTOM CATALOGUE (slug: label):\n"
        f"{catalogue_ref}\n\n"
        "TASK: Read the transcript and extract ALL of the following:\n\n"
        "1. SYMPTOMS — every symptom the patient mentions, complains about, or describes. "
        "Match each to the closest catalogue slug. Only include clearly described symptoms.\n\n"
        "2. LAB VALUES — any test results mentioned (e.g. 'TSH is 4.2', 'fasting glucose 98', "
        "'ferritin came back at 12'). Capture test name, numeric value, unit, and date if mentioned.\n\n"
        "3. MEASUREMENTS — body measurements mentioned (height, weight, waist, "
        "blood pressure like '118/76', heart rate). Convert to metric where possible.\n\n"
        "4. MEDICATIONS — all medications and supplements mentioned with doses "
        "(e.g. 'Levothyroxine 50mcg', 'vitamin D 2000 IU daily').\n\n"
        "5. CONDITIONS — diagnoses or medical conditions mentioned "
        "(e.g. 'Hashimoto's', 'PCOS', 'insulin resistance').\n\n"
        "Return ONLY a JSON object (no markdown, no preamble):\n"
        "{\n"
        '  "matched_slugs": ["slug1", "slug2", ...],\n'
        '  "mentions": [{"slug": "slug1", "quote": "brief quote from transcript"}, ...],\n'
        '  "extracted_data": {\n'
        '    "lab_values": [\n'
        '      {"test_name": "TSH", "value": "4.2", "unit": "mIU/L", "date_drawn": null}\n'
        '    ],\n'
        '    "measurements": {\n'
        '      "height_cm": null,\n'
        '      "weight_kg": null,\n'
        '      "bp_systolic": null,\n'
        '      "bp_diastolic": null,\n'
        '      "hr_bpm": null,\n'
        '      "waist_cm": null\n'
        '    },\n'
        '    "medications": ["medication name + dose"],\n'
        '    "conditions": ["condition name"]\n'
        '  }\n'
        "}\n\n"
        "Rules:\n"
        "- For measurements: only include values explicitly stated, not inferred. Use null for unknown.\n"
        "- For lab values: include the raw value as a string. Unit is required if stated.\n"
        "- For BP: parse '118/76' as bp_systolic=118, bp_diastolic=76.\n"
        "- If nothing found for a section, return empty array or null values.\n\n"
        "TRANSCRIPT:\n"
    )

    user_content: list[dict] = []
    # PDF doc blocks first if any
    user_content.extend(content_blocks)
    # Text content
    if transcript_text:
        user_content.append({"type": "text", "text": instruction + transcript_text[:30000]})
    else:
        user_content.append({"type": "text", "text": instruction})

    # ── Anthropic call (Haiku — fast + cheap for extraction) ─────────────────
    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    client = Anthropic(api_key=api_key)

    try:
        resp = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=8192,   # large lab panels (78+ markers) + full symptom catalogue need the full Haiku limit
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception as e:
        json.dump({"ok": False, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    raw_text = resp.content[0].text.strip() if resp.content else ""

    # Strip markdown fences if the model wrapped in ```json ... ```
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        raw_text = "\n".join(lines[1:])
        raw_text = raw_text.rsplit("```", 1)[0].strip()

    try:
        extracted = json.loads(raw_text)
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"model returned non-JSON: {e}\n{raw_text[:300]}"}, sys.stdout)
        return 1

    # Validate matched slugs against catalogue
    valid_slugs = {s["slug"] for s in symptom_catalogue}
    matched = [sl for sl in (extracted.get("matched_slugs") or []) if sl in valid_slugs]
    mentions = [m for m in (extracted.get("mentions") or []) if m.get("slug") in valid_slugs]

    # Sanitise extracted_data — ensure expected shape even if model omits keys
    raw_data = extracted.get("extracted_data") or {}
    raw_meas = raw_data.get("measurements") or {}

    extracted_data = {
        "lab_values": [
            {
                "test_name": lv.get("test_name", ""),
                "value": str(lv.get("value", "")),
                "unit": lv.get("unit") or "",
                "date_drawn": lv.get("date_drawn"),
            }
            for lv in (raw_data.get("lab_values") or [])
            if lv.get("test_name") and lv.get("value") is not None
        ],
        "measurements": {
            "height_cm": raw_meas.get("height_cm"),
            "weight_kg": raw_meas.get("weight_kg"),
            "bp_systolic": raw_meas.get("bp_systolic"),
            "bp_diastolic": raw_meas.get("bp_diastolic"),
            "hr_bpm": raw_meas.get("hr_bpm"),
            "waist_cm": raw_meas.get("waist_cm"),
        },
        "medications": [m for m in (raw_data.get("medications") or []) if isinstance(m, str) and m.strip()],
        "conditions": [c for c in (raw_data.get("conditions") or []) if isinstance(c, str) and c.strip()],
    }

    json.dump({
        "ok": True,
        "matched_slugs": matched,
        "mentions": mentions,
        "extracted_data": extracted_data,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
