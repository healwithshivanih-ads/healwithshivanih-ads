#!/usr/bin/env python3
"""
render-topic-brief.py

stdin:  {"topic_slug": "hrt", "client_id": "cl-004"}
stdout: {"ok": true, "markdown": "...", "error": null}

Generates a friendly, evidence-based educational brief on a catalogue topic,
citing only trusted government and medical institution sources (NHS, NIH, WHO,
ICMR, AIIMS, Mayo Clinic, Cleveland Clinic, specialty societies). No supplement
companies, no wellness blogs, no VitaOne.
"""
import sys, json, os
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../fm-database"))

# Load .env so ANTHROPIC_API_KEY is available (same pattern as refine-letter.py)
try:
    from dotenv import load_dotenv
    _env = Path(__file__).parent.parent.parent / "fm-database" / ".env"
    load_dotenv(_env, override=True)
except Exception:
    pass

import anthropic
import yaml as pyyaml
from pathlib import Path

# ── Trusted source reference list ─────────────────────────────────────────────
TRUSTED_SOURCES = """
TRUSTED SOURCES (only cite from this list — include real URLs):
• NIH MedlinePlus:         https://medlineplus.gov
• NIH PubMed:              https://pubmed.ncbi.nlm.nih.gov
• NIH Office of Women's Health: https://www.womenshealth.gov
• NIH National Cancer Institute: https://www.cancer.gov
• NIH National Institute on Aging: https://www.nia.nih.gov
• CDC:                     https://www.cdc.gov
• WHO:                     https://www.who.int
• NHS (UK):                https://www.nhs.uk
• Mayo Clinic:             https://www.mayoclinic.org
• Cleveland Clinic:        https://my.clevelandclinic.org
• Johns Hopkins Medicine:  https://www.hopkinsmedicine.org
• Harvard Health:          https://www.health.harvard.edu
• Endocrine Society:       https://www.endocrine.org / https://www.endocrine.org/patient-engagement/endocrine-library
• ACOG (OB/GYN):           https://www.acog.org
• British Menopause Society: https://thebms.org.uk
• NAMS (Menopause Society): https://www.menopause.org
• ICMR (India):            https://www.icmr.gov.in
• AIIMS (India):           https://www.aiims.edu
• NIN India (nutrition):   https://www.nin.res.in
• Ministry of Health India: https://www.mohfw.gov.in
• NCBI Bookshelf:          https://www.ncbi.nlm.nih.gov/books/
"""

def plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env)
    return Path.home() / "fm-plans"


def load_client(client_id: str) -> dict:
    p = plans_root() / "clients" / client_id / "client.yaml"
    with open(p) as f:
        return pyyaml.safe_load(f)


def load_topic(slug: str) -> dict | None:
    """Load a topic YAML from the catalogue."""
    fmdb_root = Path(__file__).parent.parent.parent / "fm-database" / "data" / "topics"
    p = fmdb_root / f"{slug}.yaml"
    if not p.exists():
        # try fuzzy: slug might be display name
        for f in fmdb_root.glob("*.yaml"):
            if f.stem == slug:
                with open(f) as fh:
                    return pyyaml.safe_load(fh)
        return None
    with open(p) as f:
        return pyyaml.safe_load(f)


def build_prompt(topic: dict, client: dict) -> str:
    display_name = topic.get("display_name", topic.get("slug", "the topic"))
    summary = topic.get("summary", "")
    mechanisms = topic.get("key_mechanisms", []) or []
    symptoms = topic.get("common_symptoms", []) or []

    # Client context — gather all relevant fields
    conditions = client.get("active_conditions") or client.get("conditions") or []
    meds = client.get("medications") or client.get("current_medications") or []
    allergies = client.get("allergies") or client.get("known_allergies") or []
    goals = client.get("goals") or []
    diet_pref = client.get("dietary_preference", "")
    foods_avoid = client.get("foods_to_avoid", "")
    non_neg = client.get("non_negotiables", "")
    age_band = client.get("age_band", "")
    dob = client.get("date_of_birth", "")
    sex = client.get("sex", "")

    client_section = f"""
CLIENT PROFILE (for personalisation only — do NOT include in the document):
- Date of birth: {dob or age_band or "unknown"}
- Sex: {sex or "unknown"}
- Active conditions: {", ".join(conditions) if conditions else "none recorded"}
- Current medications: {", ".join(meds) if meds else "none recorded"}
- Known allergies: {", ".join(allergies) if allergies else "none"}
- Goals: {", ".join(goals) if isinstance(goals, list) else goals}
- Dietary preference: {diet_pref or "not specified"}
- Foods to avoid: {foods_avoid or "none specified"}
- Non-negotiables: {non_neg or "none specified"}
""".strip()

    topic_section = f"""
TOPIC FROM INTERNAL CATALOGUE (background context — do NOT copy verbatim into document):
- Topic: {display_name}
- Internal summary: {summary or "n/a"}
- Key mechanisms: {", ".join(mechanisms) if mechanisms else "n/a"}
- Related symptoms: {", ".join(symptoms[:10]) if symptoms else "n/a"}
""".strip()

    return f"""You are a health educator writing an evidence-based educational brief for a client of a functional medicine health coach.

{client_section}

{topic_section}

{TRUSTED_SOURCES}

Write a warm, clear, educational brief about "{display_name}" that:
- Is personalised to THIS client's age, sex, conditions, and goals (weave in what's relevant naturally)
- Cites only government and major medical institution sources — NO supplement companies, wellness blogs, influencers, or VitaOne
- Links to real, working pages from the trusted sources list above (if unsure of exact page URL, give the domain and a search suggestion)
- Reads at a Year 10 level — clear and empowering, not scary or overwhelming
- Is NOT a sales pitch for any product or supplement
- Does NOT recommend specific supplements or dosages
- Is concise: 700–1000 words (clients won't read walls of text)

USE THIS EXACT STRUCTURE (markdown headings):

# Understanding {display_name}
*Prepared for you by your health coach — for information only, not medical advice*

## What is {display_name}?
(Plain English. 2–3 short paragraphs. No acronyms without explanation.)

## Why this might matter for you
(Personalise to THIS client — connect their conditions, age, sex, or goals to the topic. Be warm, not alarming.)

## What the research says
(Summarise 3–4 key evidence-based points. Cite each with a real source URL. Use bullet points for readability.)

## Signs and symptoms to be aware of
(Practical, client-friendly language. What should they notice? What warrants a doctor visit? Use bullet points.)

## What you can do (lifestyle angle)
(General, evidence-based lifestyle factors — diet, sleep, exercise, stress — relevant to this topic. NO specific supplement recommendations.)

## Trusted resources to explore further
(3–5 real links from the trusted sources list, with a one-line description of what's at each link.)

---
*This document is for educational purposes only and is not a substitute for medical advice. Please discuss any concerns with your doctor or specialist.*

IMPORTANT RULES:
1. Every URL you include must be real and from the trusted sources list — do not invent URLs
2. If you are not certain of an exact page URL, write: "Search [topic name] on [domain]" instead of guessing
3. Do NOT mention or link to VitaOne, iHerb, Amazon, or any commercial supplement source
4. Do NOT recommend specific supplements, brands, or doses
5. Keep the tone warm, human, and reassuring — this person is already working with a health coach, they are in good hands
"""


def main():
    inp = json.load(sys.stdin)
    topic_slug = inp.get("topic_slug", "").strip()
    client_id = inp.get("client_id", "").strip()

    if not topic_slug:
        print(json.dumps({"ok": False, "markdown": None, "error": "topic_slug is required"}))
        return
    if not client_id:
        print(json.dumps({"ok": False, "markdown": None, "error": "client_id is required"}))
        return

    try:
        client = load_client(client_id)
    except FileNotFoundError:
        print(json.dumps({"ok": False, "markdown": None, "error": f"Client '{client_id}' not found"}))
        return
    except Exception as e:
        print(json.dumps({"ok": False, "markdown": None, "error": f"Failed to load client: {e}"}))
        return

    topic = load_topic(topic_slug)
    if not topic:
        print(json.dumps({"ok": False, "markdown": None, "error": f"Topic '{topic_slug}' not found in catalogue"}))
        return

    try:
        prompt = build_prompt(topic, client)
        api = anthropic.Anthropic()
        full_text = ""
        with api.messages.stream(
            model="claude-sonnet-4-5",
            max_tokens=4000,
            system=(
                "You are a health educator producing evidence-based client educational materials. "
                "You only cite government bodies, medical schools, and major medical institutions. "
                "You never recommend specific supplements, brands, or dosages. "
                "Your writing is warm, clear, and empowering."
            ),
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                full_text += text

        try:
            from brand_html import wrap_in_brand_html
            html = wrap_in_brand_html(
                full_text,
                title=f"Understanding {topic.get('display_name', topic_slug)}",
                subtitle="Your guide to the research",
                doc_type="Educational Brief",
            )
        except Exception:
            html = None

        print(json.dumps({"ok": True, "markdown": full_text, "html": html, "error": None}))

    except Exception as e:
        print(json.dumps({"ok": False, "markdown": None, "error": str(e)}))


if __name__ == "__main__":
    main()
