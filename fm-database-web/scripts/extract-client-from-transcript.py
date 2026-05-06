#!/usr/bin/env python3
"""Extract client intake information from a consultation transcript.

Reads JSON from stdin:
{
  "transcript_path": str | null,  # path to a saved .txt or .pdf file
  "transcript_url": str | null,   # OR a URL (Google Doc, direct link, etc.)
  "mime_type": str,               # "text/plain" | "application/pdf" (for file only)
  "dry_run": bool
}

Writes JSON to stdout:
{
  "ok": bool,
  "display_name": str | null,
  "date_of_birth": str | null,       # YYYY-MM-DD if explicitly stated
  "estimated_age": int | null,       # if age mentioned but DOB not given
  "sex": "F" | "M" | "other" | null,
  "mobile_number": str | null,
  "active_conditions": [str],
  "current_medications": [str],
  "known_allergies": [str],
  "goals": [str],
  "key_symptoms": [str],
  "notes": str,
  "intake_date": str | null,         # YYYY-MM-DD if date of consultation clear
  "fields_found": int,
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


SYSTEM_PROMPT = """\
You are a clinical intake assistant. Your job is to read a health consultation transcript
and extract structured information about the patient to pre-populate their intake record.

Be conservative: only extract information that is clearly stated. Do not infer or guess.
Return null / empty lists for anything not mentioned. The coach will fill in the gaps.
"""

EXTRACTION_PROMPT = """\
Read this consultation transcript and extract the following information about the patient.

Return ONLY a JSON object — no markdown fences, no commentary before or after.

Required JSON shape:
{
  "display_name": "Patient's name or null if not mentioned",
  "date_of_birth": "YYYY-MM-DD if exact date of birth stated, else null",
  "estimated_age": 42,
  "sex": "F" or "M" or "other" or null,
  "mobile_number": "phone number as stated, or null",
  "active_conditions": ["condition / diagnosis as stated"],
  "current_medications": ["medication name and dose as stated"],
  "known_allergies": ["allergy"],
  "goals": ["what the client wants to achieve or improve"],
  "key_symptoms": ["symptom or complaint mentioned"],
  "notes": "anything clinically relevant that doesn't fit the above — concise",
  "intake_date": "YYYY-MM-DD if date of this consultation is clear, else null"
}

Extraction rules:
- display_name: First name or full name the patient uses for themselves. Not the doctor.
- date_of_birth: Only if explicitly stated (e.g. "my birthday is March 15 1980" → "1980-03-15").
  If patient says "I'm 44 years old" → estimated_age=44, date_of_birth=null.
- sex: F=female/woman/she/her, M=male/man/he/him. Use "other" only if stated explicitly.
- mobile_number: Include country code if mentioned. Return as stated (e.g. "+91 98765 43210").
- active_conditions: Current diagnoses, even "suspected" or "borderline".
  E.g.: "Hashimoto's thyroiditis", "PCOS", "insulin resistance", "perimenopause".
- current_medications: Include supplements and OTC meds with doses.
  E.g.: "Levothyroxine 75mcg daily", "Vitamin D 2000 IU", "Metformin 500mg twice daily".
- known_allergies: Drug, food, or environmental allergies explicitly mentioned.
- goals: What the client says they want to achieve. From "I want to...", "I'm hoping to...",
  "my main concern is...", "I'd love to...".
- key_symptoms: Every symptom, complaint, or issue described by the client.
  E.g.: "constant fatigue", "brain fog", "hair loss", "irregular periods", "bloating after meals".
- notes: Brief context not captured above — family history if relevant, prior treatments,
  recent life events, red flags the client raised.
- intake_date: If transcript has a clear date (timestamp at top or "today is May 4") → YYYY-MM-DD.

TRANSCRIPT:
"""


def _normalise_google_doc_url(url: str) -> str:
    """Convert a Google Docs edit/view URL to a plain-text export URL."""
    import re
    m = re.search(r"docs\.google\.com/document/d/([A-Za-z0-9_-]+)", url)
    if m:
        doc_id = m.group(1)
        return f"https://docs.google.com/document/d/{doc_id}/export?format=txt"
    return url


def _fetch_url(url: str) -> tuple[str | None, bytes | None, str]:
    """Fetch URL content.  Returns (text, pdf_bytes, error_or_empty).
    Tries plain text first; detects PDF by content-type."""
    import urllib.request
    import urllib.error

    url = _normalise_google_doc_url(url)

    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read()
            if "pdf" in content_type.lower() or url.lower().endswith(".pdf"):
                return None, raw, ""
            # Attempt text decode
            encoding = "utf-8"
            for part in content_type.split(";"):
                part = part.strip()
                if part.startswith("charset="):
                    encoding = part.split("=", 1)[1].strip()
            text = raw.decode(encoding, errors="replace")
            return text, None, ""
    except urllib.error.URLError as e:
        return None, None, str(e)
    except Exception as e:
        return None, None, str(e)


def count_fields(result: dict) -> int:
    skip = {"ok", "error", "fields_found"}
    count = 0
    for k, v in result.items():
        if k in skip:
            continue
        if v is not None and v != "" and v != []:
            count += 1
    return count


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    transcript_path: str = payload.get("transcript_path") or ""
    transcript_url: str = payload.get("transcript_url") or ""
    mime_type: str = payload.get("mime_type") or "text/plain"
    dry_run: bool = bool(payload.get("dry_run"))

    if dry_run:
        mock = {
            "ok": True,
            "display_name": "Anjali",
            "date_of_birth": None,
            "estimated_age": 44,
            "sex": "F",
            "mobile_number": "+91 98765 43210",
            "active_conditions": ["Hashimoto's thyroiditis", "perimenopause"],
            "current_medications": ["Levothyroxine 75mcg daily"],
            "known_allergies": ["sulfa drugs"],
            "goals": ["reduce fatigue", "improve sleep", "lose 5kg"],
            "key_symptoms": ["extreme fatigue", "brain fog", "weight gain", "hair thinning", "poor sleep"],
            "notes": "Reports symptoms worsening over past 18 months. Previous doctor dismissed concerns.",
            "intake_date": None,
            "fields_found": 9,
            "error": None,
        }
        json.dump(mock, sys.stdout)
        return 0

    _load_dotenv()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 2

    # ── Resolve content source ───────────────────────────────────────────────
    # Priority: file path > URL
    text_content: str | None = None
    pdf_bytes: bytes | None = None

    if transcript_path:
        p = Path(transcript_path)
        if not p.exists():
            json.dump({"ok": False, "error": f"file not found: {transcript_path}"}, sys.stdout)
            return 2
        if mime_type == "application/pdf" or p.suffix.lower() == ".pdf":
            pdf_bytes = p.read_bytes()
        else:
            text_content = p.read_text(errors="replace")

    elif transcript_url:
        text_content, pdf_bytes, err = _fetch_url(transcript_url)
        if err:
            json.dump({"ok": False, "error": f"failed to fetch URL: {err}"}, sys.stdout)
            return 2
        if not text_content and not pdf_bytes:
            json.dump({"ok": False, "error": "fetched URL returned empty content"}, sys.stdout)
            return 2

    else:
        json.dump({"ok": False, "error": "provide transcript_path or transcript_url"}, sys.stdout)
        return 2

    # ── Build Claude user message ────────────────────────────────────────────
    user_content: list[dict] = []

    if pdf_bytes:
        data_b64 = base64.b64encode(pdf_bytes).decode()
        user_content.append({
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": data_b64},
            "title": Path(transcript_path).name if transcript_path else "transcript.pdf",
        })
        user_content.append({"type": "text", "text": EXTRACTION_PROMPT})
    else:
        user_content.append({"type": "text", "text": EXTRACTION_PROMPT + (text_content or "")[:16000]})

    # ── Call Claude Haiku ────────────────────────────────────────────────────
    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    client = Anthropic(api_key=api_key)

    try:
        resp = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=1500,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception as e:
        json.dump({"ok": False, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    raw_text = resp.content[0].text.strip() if resp.content else ""

    # Strip markdown fences if the model wrapped output
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        raw_text = "\n".join(lines[1:])
        raw_text = raw_text.rsplit("```", 1)[0].strip()

    try:
        extracted = json.loads(raw_text)
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"model returned non-JSON: {e}\n{raw_text[:400]}"}, sys.stdout)
        return 1

    # ── Sanitise ─────────────────────────────────────────────────────────────
    def clean_list(v: object) -> list[str]:
        if not isinstance(v, list):
            return []
        return [str(x).strip() for x in v if x and str(x).strip()]

    def clean_str(v: object) -> str | None:
        if not isinstance(v, str):
            return None
        s = v.strip()
        return s if s and s.lower() not in ("null", "none", "n/a", "unknown", "") else None

    def clean_int(v: object) -> int | None:
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    sex_raw = clean_str(extracted.get("sex"))
    sex: str | None = sex_raw if sex_raw in ("F", "M", "other") else None

    result: dict = {
        "ok": True,
        "display_name": clean_str(extracted.get("display_name")),
        "date_of_birth": clean_str(extracted.get("date_of_birth")),
        "estimated_age": clean_int(extracted.get("estimated_age")),
        "sex": sex,
        "mobile_number": clean_str(extracted.get("mobile_number")),
        "active_conditions": clean_list(extracted.get("active_conditions")),
        "current_medications": clean_list(extracted.get("current_medications")),
        "known_allergies": clean_list(extracted.get("known_allergies")),
        "goals": clean_list(extracted.get("goals")),
        "key_symptoms": clean_list(extracted.get("key_symptoms")),
        "notes": clean_str(extracted.get("notes")) or "",
        "intake_date": clean_str(extracted.get("intake_date")),
        "error": None,
    }
    result["fields_found"] = count_fields(result)

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
