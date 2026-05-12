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
  "email": str | null,
  "date_of_birth": str | null,       # YYYY-MM-DD if explicitly stated
  "estimated_age": int | null,       # if age mentioned but DOB not given
  "sex": "F" | "M" | "other" | null,
  "mobile_number": str | null,
  "city": str | null,
  "state": str | null,
  "country": str | null,
  "active_conditions": [str],
  "current_medications": [str],
  "known_allergies": [str],
  "goals": [str],
  "key_symptoms": [str],
  "dietary_preference": str | null,
  "foods_to_avoid": str | null,
  "non_negotiables": str | null,
  "reported_triggers": str | null,
  "family_history": str | null,
  "digestion_notes": str | null,
  "sleep_notes": str | null,
  "energy_pattern": str | null,
  "menstrual_notes": str | null,
  "stress_response": str | null,
  "childhood_history": str | null,
  "toxic_exposures": str | null,
  "what_has_worked": str | null,
  "what_hasnt_worked": str | null,
  "five_pillars": {
    "sleep_hours": float | null,
    "sleep_quality": int | null,     # 1-5
    "sleep_issues": str | null,
    "stress_level": int | null,      # 1-5
    "stress_type": str | null,
    "movement_days_per_week": int | null,
    "movement_type": str | null,
    "movement_intensity": str | null,
    "nutrition_quality": int | null, # 1-5
    "connection_quality": int | null,# 1-5
    "connection_notes": str | null
  } | null,
  "timeline_events": [{"year": int | null, "date": str | null, "event": str, "category": str | null}],
  "presenting_complaints": str | null,   # 2-4 sentence summary of why client came in
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


SYSTEM_PROMPT = """\
You are a Functional Medicine clinical intake assistant. Your job is to read a health
consultation transcript and extract structured information about the patient — covering
both standard medical intake AND Functional Medicine-specific intake parameters.

Be conservative: only extract information that is clearly stated or strongly implied by the
patient's own words. Do not infer or guess beyond what is said. Return null / empty for
anything not mentioned — the coach will fill in the gaps.

Always extract from the patient's perspective (not the doctor's). If the patient says
"I've had bloating my whole life" → digestion_notes: "Chronic bloating, lifelong pattern".
"""

EXTRACTION_PROMPT = """\
Read this consultation transcript carefully. Extract every piece of information about the
PATIENT (not the doctor/coach). Return ONLY a valid JSON object — no markdown fences,
no explanation before or after.

REQUIRED JSON SHAPE:
{
  "display_name": "Patient's name as they introduce themselves, or null",
  "email": "email address if mentioned, or null",
  "date_of_birth": "YYYY-MM-DD if exact DOB stated, else null",
  "estimated_age": 42,
  "sex": "F" or "M" or "other" or null,
  "mobile_number": "as stated, with country code if given",
  "city": "city they live in, or null",
  "state": "state/province, or null",
  "country": "country if mentioned, or null",
  "active_conditions": ["current diagnosis / condition"],
  "current_medications": ["medication name + dose as stated"],
  "known_allergies": ["allergy"],
  "goals": ["what the client wants to achieve — in their own words"],
  "key_symptoms": ["every symptom, complaint, or health issue mentioned"],
  "dietary_preference": "Vegetarian | Vegetarian Jain | Vegan | Eggetarian | Pescatarian | Non-vegetarian | Other — or null if not clear",
  "foods_to_avoid": "foods they avoid, are sensitive to, or dislike — free text, or null",
  "non_negotiables": "things they explicitly say they won't give up (e.g. 'I won't give up my morning chai', 'chocolate is non-negotiable') — free text, or null",
  "reported_triggers": "things they notice make symptoms worse — free text, or null",
  "family_history": "health conditions in parents, siblings, grandparents — free text, or null",
  "digestion_notes": "everything about digestion: bloating, constipation, loose stools, IBS, heartburn, food reactions, bowel frequency, pain — free text, or null",
  "sleep_notes": "sleep patterns: hours, difficulty falling/staying asleep, waking times, dream recall, refreshed on waking, sleep aids used — free text, or null",
  "energy_pattern": "energy throughout the day: morning energy, afternoon crash, evening energy, fatigue patterns, when they feel best/worst — free text, or null",
  "menstrual_notes": "for female patients: cycle length, regularity, PMS symptoms, flow, pain, mood changes, perimenopause/menopause status — free text, or null",
  "stress_response": "how they respond to stress: do they shut down, get anxious, get angry, get sick, notice physical symptoms under stress — free text, or null",
  "childhood_history": "relevant childhood events: early illnesses, trauma, infections, antibiotic use, dietary history, surgeries before 18 — free text, or null",
  "toxic_exposures": "exposure to chemicals, heavy metals, pesticides, mold, medications (PPI, antibiotics, steroids), smoking history, industrial exposure — free text, or null",
  "what_has_worked": "treatments, diets, supplements, lifestyle changes that have helped — free text, or null",
  "what_hasnt_worked": "treatments, diets, supplements or interventions that did NOT help or made things worse — free text, or null",
  "five_pillars": {
    "sleep_hours": 6.5,
    "sleep_quality": 2,
    "sleep_issues": "wakes at 3am, can't fall back asleep",
    "stress_level": 4,
    "stress_type": "work deadlines + relationship tension",
    "movement_days_per_week": 2,
    "movement_type": "walks",
    "movement_intensity": "light",
    "nutrition_quality": 3,
    "connection_quality": 3,
    "connection_notes": "feels isolated since moving cities"
  },
  "timeline_events": [
    {"year": 2018, "date": null, "event": "Diagnosed with Hashimoto's thyroiditis", "category": "diagnosis"},
    {"year": 2020, "date": "2020-03-01", "event": "Started levothyroxine", "category": "medication_change"},
    {"year": null, "date": null, "event": "Hysterectomy in early 30s", "category": "surgery"}
  ],
  "presenting_complaints": "2-4 sentence summary of why the client came in: chief complaints in client's voice, current top concerns, what brought them now. Example: 'Persistent bloating and fatigue for ~2 years, worsened post-covid. Sugar cravings and brain fog by mid-afternoon. Sleep is broken — wakes at 3am most nights. Wants energy back, especially in afternoons with kids.' Null if no clear chief complaint expressed.",
  "notes": "Any clinically relevant detail not captured above — brief",
  "intake_date": "YYYY-MM-DD if date of this consultation is clear"
}

EXTRACTION RULES:
- display_name: first name or full name the patient uses. Not the doctor.
- email: only if clearly stated (not inferred).
- dietary_preference: listen for "I'm vegetarian", "we don't eat meat", "I'm vegan",
  "I eat eggs but no meat" (Eggetarian), "I eat fish" (Pescatarian), "Jain" (Vegetarian Jain).
- foods_to_avoid: both intolerances AND personal preferences — "dairy makes me bloated",
  "I avoid gluten", "I can't eat onions", "I don't eat eggs by choice".
- non_negotiables: things they explicitly say won't change — "I need my coffee", "can't give up
  my evening chai", "sweets on weekends is non-negotiable for me".
- reported_triggers: patterns they've noticed — "I always crash after lunch", "stress makes my
  gut worse", "my symptoms are worst in winter", "screens at night make sleep terrible".
- family_history: capture conditions in first-degree relatives — "my mother had diabetes",
  "both parents have thyroid issues", "my sister has PCOS", "heart disease in the family".
- digestion_notes: capture ALL gut detail — timing of symptoms, food relationships,
  stool patterns, bloating timing (morning vs after meals), gas, reflux, IBS diagnosis.
- sleep_notes: capture hours, timing, subjective quality, issues (waking, falling asleep,
  restless legs, night sweats), morning refresh feeling, any sleep aids.
- energy_pattern: day arc — "exhausted when I wake, better by 10am, crash at 2-3pm, second
  wind at night and can't sleep". This pattern is diagnostically important.
- menstrual_notes: only for female patients. Capture cycle regularity, length, PMS timing
  and symptoms, flow heaviness, pain level, mood-cycle link, perimenopause symptoms.
- five_pillars: extract numerical estimates where possible:
  - sleep_hours: typical hours per night (number)
  - sleep_quality: 1-5 where 1=terrible, 5=excellent (estimate from description)
  - stress_level: 1-5 where 1=low, 5=extreme
  - movement_days_per_week: how many days per week they exercise/move
  - nutrition_quality: 1-5 (your estimate from their description)
  - connection_quality: 1-5 (social connection, relationships — estimate from context)
  - Only include keys where you have reasonable evidence; omit (set null) if not mentioned
- timeline_events: important health events in time order. Categories:
  "life_event" | "symptom_onset" | "diagnosis" | "surgery" | "medication_change" | "other"
  Include: diagnoses, surgeries, major life stressors, when symptoms started, med changes.
  RESOLVE RELATIVE TIME REFERENCES to absolute years. The consultation date
  appears as {TODAY} below — use it as the anchor:
    "5 years ago"              → year = {TODAY_YEAR} - 5
    "in my late 20s"           → year = (year of birth, if known) + ~28; else estimated_age - 10
    "around the pandemic"      → year ≈ 2020
    "after my second child"    → leave year null, set event with that context
    "last March"               → date = "{LAST_MARCH_YEAR}-03-01"
    "a few months ago"         → year = {TODAY_YEAR}, date null
    "as a child"               → category = "childhood", year null
  If both date and year can be derived, prefer date (YYYY-MM-DD). If only the
  year is derivable, set year (int) and leave date null. If nothing is
  derivable, leave both null but STILL emit the event so the coach can
  date it later.
- what_has_worked: "going dairy-free helped a lot", "the B12 injection was a game changer",
  "yoga made my stress manageable".
- what_hasnt_worked: "I tried keto and felt terrible", "antidepressants didn't help",
  "the previous nutritionist's plan didn't work".

TRANSCRIPT:
"""


def _normalise_google_doc_url(url: str) -> str:
    import re
    m = re.search(r"docs\.google\.com/document/d/([A-Za-z0-9_-]+)", url)
    if m:
        doc_id = m.group(1)
        return f"https://docs.google.com/document/d/{doc_id}/export?format=txt"
    return url


def _fetch_url(url: str) -> tuple[str | None, bytes | None, str]:
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
        if v is None or v == "" or v == []:
            continue
        if isinstance(v, dict) and all(vv is None for vv in v.values()):
            continue
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
            "email": None,
            "date_of_birth": None,
            "estimated_age": 44,
            "sex": "F",
            "mobile_number": "+91 98765 43210",
            "city": "Bangalore",
            "state": "Karnataka",
            "country": "India",
            "active_conditions": ["Hashimoto's thyroiditis", "perimenopause"],
            "current_medications": ["Levothyroxine 75mcg daily"],
            "known_allergies": ["sulfa drugs"],
            "goals": ["reduce fatigue", "improve sleep", "lose 5kg"],
            "key_symptoms": ["extreme fatigue", "brain fog", "weight gain", "hair thinning", "poor sleep"],
            "dietary_preference": "Vegetarian",
            "foods_to_avoid": "dairy causes bloating",
            "non_negotiables": "morning chai",
            "reported_triggers": "stress worsens all symptoms",
            "family_history": "mother has type 2 diabetes, father had thyroid issues",
            "digestion_notes": "bloating after meals, constipation 3-4 days between bowel movements",
            "sleep_notes": "wakes at 3am unable to fall back asleep, feels unrefreshed, 5-6 hours total",
            "energy_pattern": "exhausted on waking, better by 11am, crashes at 2-3pm, second wind at 10pm",
            "menstrual_notes": "irregular cycles 35-50 days, heavy flow, severe PMS mood swings",
            "stress_response": "shuts down and withdraws, gets GI symptoms under stress",
            "childhood_history": "frequent antibiotics as child for ear infections",
            "toxic_exposures": None,
            "what_has_worked": "going gluten-free helped bloating somewhat",
            "what_hasnt_worked": "tried antidepressants, didn't help mood",
            "five_pillars": {
                "sleep_hours": 5.5,
                "sleep_quality": 2,
                "sleep_issues": "wakes at 3am, unrefreshed",
                "stress_level": 4,
                "stress_type": "work and family pressure",
                "movement_days_per_week": 1,
                "movement_type": "occasional walks",
                "movement_intensity": "light",
                "nutrition_quality": 3,
                "connection_quality": 3,
                "connection_notes": None
            },
            "timeline_events": [
                {"year": 2018, "date": None, "event": "Diagnosed with Hashimoto's thyroiditis", "category": "diagnosis"},
                {"year": 2019, "date": None, "event": "Started levothyroxine", "category": "medication_change"},
                {"year": 2022, "date": None, "event": "Perimenopause symptoms began", "category": "symptom_onset"}
            ],
            "notes": "Previous doctor dismissed symptoms. Very motivated to make changes.",
            "intake_date": None,
            "fields_found": 18,
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

    # ── Build Claude message ─────────────────────────────────────────────────
    # Substitute relative-date anchors into the prompt so the AI can resolve
    # phrases like "5 years ago" into absolute years.
    from datetime import date as _date
    today = _date.today()
    last_march_year = today.year if today.month >= 3 else today.year - 1
    prompt = (
        EXTRACTION_PROMPT
        .replace("{TODAY}", today.isoformat())
        .replace("{TODAY_YEAR}", str(today.year))
        .replace("{LAST_MARCH_YEAR}", str(last_march_year))
    )

    user_content: list[dict] = []
    if pdf_bytes:
        data_b64 = base64.b64encode(pdf_bytes).decode()
        user_content.append({
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": data_b64},
            "title": Path(transcript_path).name if transcript_path else "transcript.pdf",
        })
        user_content.append({"type": "text", "text": prompt})
    else:
        user_content.append({"type": "text", "text": prompt + (text_content or "")[:20000]})

    # ── Call Claude (Sonnet for richer extraction) ───────────────────────────
    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    client_ai = Anthropic(api_key=api_key)
    try:
        resp = client_ai.messages.create(
            model="claude-haiku-4-5",
            max_tokens=3000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
        try:
            from fmdb.usage import log_usage as _log_usage
            _log_usage(
                client_id=None,  # intake — client doesn't exist yet
                script="extract-client-from-transcript.py",
                model="claude-haiku-4-5",
                usage=resp.usage,
                notes="intake transcript parse",
            )
        except Exception:
            pass
    except Exception as e:
        json.dump({"ok": False, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    raw_text = resp.content[0].text.strip() if resp.content else ""

    # Strip markdown fences
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

    def clean_float(v: object) -> float | None:
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    sex_raw = clean_str(extracted.get("sex"))
    sex: str | None = sex_raw if sex_raw in ("F", "M", "other") else None

    # Dietary preference — normalise
    dp_raw = clean_str(extracted.get("dietary_preference"))
    valid_dp = {"Vegetarian", "Vegetarian Jain", "Vegan", "Eggetarian", "Pescatarian", "Non-vegetarian", "Other"}
    dietary_preference: str | None = dp_raw if dp_raw in valid_dp else None

    # Five pillars
    fp_raw = extracted.get("five_pillars") or {}
    if not isinstance(fp_raw, dict):
        fp_raw = {}
    five_pillars = {
        "sleep_hours": clean_float(fp_raw.get("sleep_hours")),
        "sleep_quality": clean_int(fp_raw.get("sleep_quality")),
        "sleep_issues": clean_str(fp_raw.get("sleep_issues")),
        "stress_level": clean_int(fp_raw.get("stress_level")),
        "stress_type": clean_str(fp_raw.get("stress_type")),
        "movement_days_per_week": clean_int(fp_raw.get("movement_days_per_week")),
        "movement_type": clean_str(fp_raw.get("movement_type")),
        "movement_intensity": clean_str(fp_raw.get("movement_intensity")),
        "nutrition_quality": clean_int(fp_raw.get("nutrition_quality")),
        "connection_quality": clean_int(fp_raw.get("connection_quality")),
        "connection_notes": clean_str(fp_raw.get("connection_notes")),
    }
    # Only include if at least one value was found
    has_fp = any(v is not None for v in five_pillars.values())

    # Timeline events
    raw_tl = extracted.get("timeline_events") or []
    timeline_events = []
    if isinstance(raw_tl, list):
        for ev in raw_tl:
            if not isinstance(ev, dict):
                continue
            event_text = clean_str(ev.get("event"))
            if not event_text:
                continue
            timeline_events.append({
                "year": clean_int(ev.get("year")),
                "date": clean_str(ev.get("date")),
                "event": event_text,
                "category": clean_str(ev.get("category")),
            })

    result: dict = {
        "ok": True,
        "display_name": clean_str(extracted.get("display_name")),
        "email": clean_str(extracted.get("email")),
        "date_of_birth": clean_str(extracted.get("date_of_birth")),
        "estimated_age": clean_int(extracted.get("estimated_age")),
        "sex": sex,
        "mobile_number": clean_str(extracted.get("mobile_number")),
        "city": clean_str(extracted.get("city")),
        "state": clean_str(extracted.get("state")),
        "country": clean_str(extracted.get("country")),
        "active_conditions": clean_list(extracted.get("active_conditions")),
        "current_medications": clean_list(extracted.get("current_medications")),
        "known_allergies": clean_list(extracted.get("known_allergies")),
        "goals": clean_list(extracted.get("goals")),
        "key_symptoms": clean_list(extracted.get("key_symptoms")),
        "dietary_preference": dietary_preference,
        "foods_to_avoid": clean_str(extracted.get("foods_to_avoid")),
        "non_negotiables": clean_str(extracted.get("non_negotiables")),
        "reported_triggers": clean_str(extracted.get("reported_triggers")),
        "family_history": clean_str(extracted.get("family_history")),
        "digestion_notes": clean_str(extracted.get("digestion_notes")),
        "sleep_notes": clean_str(extracted.get("sleep_notes")),
        "energy_pattern": clean_str(extracted.get("energy_pattern")),
        "menstrual_notes": clean_str(extracted.get("menstrual_notes")),
        "stress_response": clean_str(extracted.get("stress_response")),
        "childhood_history": clean_str(extracted.get("childhood_history")),
        "toxic_exposures": clean_str(extracted.get("toxic_exposures")),
        "what_has_worked": clean_str(extracted.get("what_has_worked")),
        "what_hasnt_worked": clean_str(extracted.get("what_hasnt_worked")),
        "five_pillars": five_pillars if has_fp else None,
        "timeline_events": timeline_events,
        "presenting_complaints": clean_str(extracted.get("presenting_complaints")),
        "notes": clean_str(extracted.get("notes")) or "",
        "intake_date": clean_str(extracted.get("intake_date")),
        "error": None,
    }
    result["fields_found"] = count_fields(result)

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
