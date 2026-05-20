#!/usr/bin/env python3
"""Generate (or refresh) the AI-summarised IntakeInsights for a client.

Reads JSON from stdin:
  {
    "client_id": "cl-004",
    "dry_run": false
  }

Writes JSON to stdout:
  {
    "ok": bool,
    "client_id": str,
    "insights": {...full IntakeInsights dump...} | null,
    "usage": {"input_tokens": N, "output_tokens": N, "cost_usd": float} | null,
    "error": str | null
  }

Approach:
  1. Load ~/fm-plans/clients/<client_id>/client.yaml via fmdb.plan.storage.
  2. Refuse if intake_submitted_at is null.
  3. Build a Haiku prompt with the structured intake payload (only fields
     that are project-relevant, organised by section).
  4. One Haiku call with tool_use forcing `record_intake_insights` to
     return structured output matching IntakeInsights exactly.
  5. Preserve any pre-existing coach_notes_for_ai.
  6. Write back to client.intake_insights and save.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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


# Haiku pricing (USD per million tokens)
_HAIKU_INPUT_PRICE = 0.25
_HAIKU_OUTPUT_PRICE = 1.25


def _format_meds_block(label: str, entries: list[dict[str, Any]] | None) -> str:
    if not entries:
        return ""
    out = [f"\n  - {label}:"]
    for e in entries:
        bits = []
        if e.get("name"):
            bits.append(str(e["name"]))
        if e.get("dose"):
            bits.append(f"dose: {e['dose']}")
        if e.get("started"):
            bits.append(f"started: {e['started']}")
        if e.get("still_taking") is True:
            bits.append("still taking")
        elif e.get("still_taking") is False:
            bits.append("stopped")
        if e.get("side_effects"):
            bits.append(f"side effects: {e['side_effects']}")
        if bits:
            out.append(f"      • {' | '.join(bits)}")
    return "\n".join(out)


def _format_list(label: str, val: Any) -> str:
    if not val:
        return ""
    if isinstance(val, list):
        if not val:
            return ""
        rendered = ", ".join(str(v) for v in val if v not in (None, ""))
        if not rendered:
            return ""
        return f"  - {label}: {rendered}\n"
    if isinstance(val, (str, int, float)):
        s = str(val).strip()
        if not s:
            return ""
        return f"  - {label}: {s}\n"
    return ""


def _format_pregnancies(pregs: list[dict[str, Any]] | None) -> str:
    if not pregs:
        return ""
    out = ["\n  - Pregnancies:"]
    for p in pregs:
        bits = []
        if p.get("year"):
            bits.append(f"year: {p['year']}")
        if p.get("outcome"):
            bits.append(f"outcome: {p['outcome']}")
        if p.get("birth_type"):
            bits.append(f"birth: {p['birth_type']}")
        if p.get("complications"):
            bits.append(f"complications: {', '.join(p['complications'])}")
        if p.get("breastfeeding_months") is not None:
            bits.append(f"bf months: {p['breastfeeding_months']}")
        if bits:
            out.append(f"      • {' | '.join(bits)}")
    return "\n".join(out)


def _format_contraception(entries: list[dict[str, Any]] | None) -> str:
    if not entries:
        return ""
    out = ["\n  - Contraception history:"]
    for e in entries:
        bits = []
        if e.get("type"):
            bits.append(e["type"])
        if e.get("started_year"):
            bits.append(f"started {e['started_year']}")
        if e.get("stopped_year"):
            bits.append(f"stopped {e['stopped_year']}")
        elif e.get("started_year"):
            bits.append("ongoing")
        if e.get("side_effects"):
            bits.append(f"side effects: {', '.join(e['side_effects'])}")
        if bits:
            out.append(f"      • {' | '.join(bits)}")
    return "\n".join(out)


def _format_timeline(events: list[dict[str, Any]] | None) -> str:
    if not events:
        return ""
    sorted_events = sorted(events, key=lambda e: (e.get("year") or 0, e.get("date") or ""))
    out = ["\n  - Personal health timeline:"]
    for e in sorted_events:
        date_label = e.get("date") or (str(e.get("year")) if e.get("year") else "?")
        cat = e.get("category", "")
        ev = e.get("event", "")
        out.append(f"      • {date_label} [{cat}]: {ev}")
    return "\n".join(out)


def _build_intake_payload(client_dict: dict[str, Any]) -> str:
    """Render the structured intake fields into a clean block for Haiku."""
    c = client_dict
    sections: list[str] = []

    # ABOUT
    about_parts = [
        f"Sex: {c.get('sex') or '—'}",
    ]
    if c.get("date_of_birth"):
        about_parts.append(f"DOB: {c['date_of_birth']}")
    if c.get("age_band"):
        about_parts.append(f"Age band: {c['age_band']}")
    loc = ", ".join(s for s in [c.get("city"), c.get("country")] if s)
    if loc:
        about_parts.append(f"Location: {loc}")
    for k in ("occupation", "marital_status", "household", "work_pattern"):
        if c.get(k):
            v = c[k]
            about_parts.append(f"{k.replace('_', ' ').title()}: {v if not isinstance(v, list) else ', '.join(v)}")
    if c.get("height_cm") or c.get("weight_kg") or c.get("waist_cm"):
        bits = []
        if c.get("height_cm"):
            bits.append(f"height {c['height_cm']}cm")
        if c.get("weight_kg"):
            bits.append(f"weight {c['weight_kg']}kg")
        if c.get("waist_cm"):
            bits.append(f"waist {c['waist_cm']}cm")
        about_parts.append("Measurements: " + ", ".join(bits))
    if c.get("weight_highest_adult"):
        about_parts.append(f"Highest adult weight: {c['weight_highest_adult']}kg")
    if c.get("weight_lowest_adult"):
        about_parts.append(f"Lowest adult weight: {c['weight_lowest_adult']}kg")
    if c.get("weight_trend_current"):
        about_parts.append(f"Weight trend: {c['weight_trend_current']}")
    if c.get("weight_change_trigger"):
        about_parts.append(f"Weight-change trigger: {c['weight_change_trigger']}")
    sections.append("=== ABOUT THE CLIENT ===\n" + "\n".join(f"  - {p}" for p in about_parts))

    # CONCERNS / GOALS
    cg = ""
    cg += _format_list("Goals (top concerns)", c.get("goals"))
    cg += _format_list("Notes (free-form)", c.get("notes"))
    if cg:
        sections.append("=== CONCERNS / GOALS ===\n" + cg.rstrip())

    # BIRTH & EARLY YEARS
    bey = ""
    bey += _format_list("Childhood history", c.get("childhood_history"))
    bey += _format_list("Toxic exposures", c.get("toxic_exposures"))
    if bey:
        sections.append("=== BIRTH & EARLY YEARS ===\n" + bey.rstrip())

    # FAMILY HISTORY
    fh = ""
    fh += _format_list("Family history (free)", c.get("family_history"))
    fh += _format_list("Family-specific conditions", c.get("family_specific_conditions"))
    if fh:
        sections.append("=== FAMILY HISTORY ===\n" + fh.rstrip())

    # MEDICAL HISTORY
    mh = ""
    mh += _format_list("Active conditions", c.get("active_conditions"))
    mh += _format_list("Past medical history", c.get("medical_history"))
    mh += _format_list("Known allergies", c.get("known_allergies"))
    mh += _format_list("Current medications (free)", c.get("current_medications"))
    mh += _format_list("Current supplements (OTC — vitamins / minerals / herbs / probiotics)", c.get("current_supplements"))
    mh += _format_list("COVID history", c.get("covid_history"))
    mh += _format_list("COVID long-haul symptoms", c.get("covid_long_symptoms"))
    mh += _format_list("COVID vaccine history", c.get("covid_vaccine_history"))
    mh += _format_list("COVID vaccine brand", c.get("covid_vaccine_brand"))
    mh += _format_list("COVID vaccine reactions", c.get("covid_vaccine_reactions"))
    mh += _format_list("Vaccine reaction detail", c.get("covid_vaccine_reaction_detail"))
    if mh:
        sections.append("=== MEDICAL HISTORY ===\n" + mh.rstrip())

    # MEDICATIONS (deep)
    med_blocks: list[str] = []
    for label, key in [
        ("GLP-1s", "glp1_medications"),
        ("Acid suppressants (PPIs / H2 blockers)", "acid_suppressants"),
        ("NSAIDs (daily/regular)", "nsaids_daily"),
        ("Antibiotics in last 12 months", "antibiotics_last_12mo"),
        ("Hormonal contraception / HRT", "hormonal_contraception_hrt"),
        ("Thyroid medication", "thyroid_medication"),
        ("Psych medications", "psych_medications"),
        ("Biologics / immunosuppressants", "biologics_immunosuppressants"),
        ("Statins / BP / diabetes meds", "statins_bp_diabetes"),
    ]:
        block = _format_meds_block(label, c.get(key))
        if block:
            med_blocks.append(block)
    if med_blocks:
        sections.append("=== MEDICATION DEEP-DIVE ===" + "".join(med_blocks))

    # DIET & LIFESTYLE
    dl = ""
    dl += _format_list("Dietary preference", c.get("dietary_preference"))
    dl += _format_list("Foods to avoid", c.get("foods_to_avoid"))
    dl += _format_list("Non-negotiables", c.get("non_negotiables"))
    dl += _format_list("Reported triggers (n=1)", c.get("reported_triggers"))
    dl += _format_list("Postprandial pattern", c.get("postprandial_pattern"))
    dl += _format_list("Cold / heat tolerance", c.get("cold_heat_tolerance"))
    if dl:
        sections.append("=== DIET & LIFESTYLE ===\n" + dl.rstrip())

    # SLEEP / ENERGY / FIVE PILLARS
    sep = ""
    if c.get("five_pillars"):
        fp = c["five_pillars"]
        fp_bits = []
        for k, label in [
            ("sleep_quality", "sleep quality"),
            ("sleep_hours", "sleep hrs"),
            ("stress_level", "stress level"),
            ("stress_type", "stress type"),
            ("movement_days_per_week", "movement d/wk"),
            ("movement_type", "movement type"),
            ("nutrition_quality", "nutrition quality"),
            ("connection_quality", "connection quality"),
        ]:
            if fp.get(k) not in (None, ""):
                fp_bits.append(f"{label}={fp[k]}")
        if fp_bits:
            sep += f"  - Five Pillars: {', '.join(fp_bits)}\n"
    sep += _format_list("Time to fall asleep", c.get("time_to_fall_asleep"))
    sep += _format_list("Wake pattern", c.get("wake_time_pattern"))
    sep += _format_list("Snore / apnoea", c.get("snore_or_apnoea"))
    sep += _format_list("Restless legs", c.get("restless_legs"))
    sep += _format_list("Sleep tracker owned", c.get("sleep_tracker_owned"))
    sep += _format_list("CGM owned", c.get("cgm_owned"))
    sep += _format_list("Energy crashes", c.get("energy_crashes"))
    sep += _format_list("Caffeine dependency", c.get("caffeine_dependency"))
    sep += _format_list("Morning state", c.get("morning_state"))
    sep += _format_list("Sleep notes (free)", c.get("sleep_notes"))
    sep += _format_list("Energy pattern (free)", c.get("energy_pattern"))
    sep += _format_list("Stress response (free)", c.get("stress_response"))
    if sep:
        sections.append("=== SLEEP / ENERGY / FIVE PILLARS ===\n" + sep.rstrip())

    # BODY SYSTEMS
    bs = ""
    bs += _format_list("Digestion notes (free)", c.get("digestion_notes"))
    bs += _format_list("Bristol stool typical", c.get("bristol_stool_typical"))
    bs += _format_list("Bowel frequency / day", c.get("bowel_frequency_per_day"))
    bs += _format_list("Bowel pattern", c.get("bowel_pattern"))
    bs += _format_list("Bowel historical", c.get("bowel_historical"))
    bs += _format_list("Hair loss pattern", c.get("hair_loss_pattern"))
    bs += _format_list("Hair texture change", c.get("hair_texture_change"))
    bs += _format_list("Hair other", c.get("hair_other"))
    bs += _format_list("Nail signs", c.get("nail_signs"))
    bs += _format_list("Acne pattern", c.get("acne_pattern"))
    bs += _format_list("Skin signs", c.get("skin_signs"))
    bs += _format_list("Pain locations", c.get("pain_locations"))
    bs += _format_list("Headache type", c.get("headache_type"))
    bs += _format_list("Pain pattern", c.get("pain_pattern"))
    bs += _format_list("Pain quality", c.get("pain_quality"))
    bs += _format_list("Belly fat pattern", c.get("belly_fat_pattern"))
    bs += _format_list("Histamine signals", c.get("histamine_signals"))
    bs += _format_list("Chemical sensitivity", c.get("chemical_sensitivity"))
    bs += _format_list("Oral signs", c.get("oral_signs"))
    if bs:
        sections.append("=== BODY SYSTEMS ===\n" + bs.rstrip())

    # v0.75.4 — TIER 1 SCREENING (Joints / Standing / Recovery / Environment)
    # Captures the MCAS-POTS-EDS / long-COVID / mould-CIRS family on intake.
    # The system prompt specifically calls these out as triad-suspicion
    # signals so Haiku frames hypotheses across them, not in isolation.
    ts = ""
    ts += _format_list("Beighton self-score (joint hypermobility, /5)", c.get("beighton_self_score"))
    ts += _format_list("Hypermobility supplementals", c.get("beighton_supplemental"))
    ts += _format_list("HR-measuring devices owned", c.get("hr_devices_owned"))
    if c.get("lean_test_supine_hr"):
        ts += _format_list("Lean test — supine HR (bpm)", c.get("lean_test_supine_hr"))
    if c.get("lean_test_standing_hr"):
        ts += _format_list("Lean test — standing HR after 10 min (bpm)", c.get("lean_test_standing_hr"))
    ts += _format_list("Standing-tolerance / lean-test symptoms", c.get("lean_test_symptoms"))
    ts += _format_list("Post-exertional malaise (PEM) screen", c.get("pem_screen"))
    ts += _format_list("Mould / environmental exposure", c.get("mould_exposure"))
    if c.get("large_fish_frequency"):
        ts += _format_list("Large-fish frequency", c.get("large_fish_frequency"))
    # Coach-verified findings — override self-report when present
    findings = c.get("physical_exam_findings") or []
    if isinstance(findings, list) and findings:
        # Show the latest of each kind
        latest_by_kind: dict = {}
        for f in findings:
            if not isinstance(f, dict):
                continue
            kind = f.get("kind")
            if not kind:
                continue
            cur = latest_by_kind.get(kind)
            if cur is None or (f.get("assessed_at") or "") > (cur.get("assessed_at") or ""):
                latest_by_kind[kind] = f
        for kind, f in latest_by_kind.items():
            result = f.get("result") or {}
            if kind == "beighton":
                score = result.get("score")
                hyp = result.get("hypermobile")
                ts += _format_list(
                    "Beighton — coach-verified (overrides self-score)",
                    f"{score}/9{' — hypermobile' if hyp else ''} (assessed {f.get('assessed_at', '?')[:10]})",
                )
            elif kind == "nasa_lean_test":
                delta = result.get("delta_hr")
                pots = result.get("pots_pattern")
                ts += _format_list(
                    "NASA lean — coach-verified",
                    f"ΔHR +{delta} bpm{' — POTS pattern POSITIVE' if pots else ''} (assessed {f.get('assessed_at', '?')[:10]})",
                )
    if ts:
        sections.append("=== TIER 1 SCREENING (joints / standing / recovery / mould) ===\n" + ts.rstrip())

    # REPRODUCTIVE (women)
    if c.get("sex") == "F":
        rp = ""
        rp += _format_list("Cycle status", c.get("cycle_status"))
        rp += _format_list("Cycle regularity", c.get("cycle_regularity"))
        rp += _format_list("Cycle length (days)", c.get("cycle_length_days"))
        rp += _format_list("Last menstrual period", c.get("last_menstrual_period"))
        rp += _format_list("Menstrual notes (free)", c.get("menstrual_notes"))
        rp += _format_list("Period pain severity (1-10)", c.get("period_pain_severity"))
        rp += _format_list("Period pain impact", c.get("period_pain_impact"))
        rp += _format_list("PMDD signs", c.get("pmdd_signs"))
        rp += _format_list("Repro diagnoses", c.get("repro_diagnoses"))
        rp += _format_list("Perimenopause inventory", c.get("perimenopause_inventory"))
        rp += _format_list("Pregnancy status", c.get("pregnancy_status"))
        rp += _format_list("Pregnancy due date", c.get("pregnancy_due_date"))
        rp += _format_list("Lactation started", c.get("lactation_started"))
        rp += _format_list("Menopause started", c.get("menopause_started"))
        contra = _format_contraception(c.get("contraception_history"))
        pregs = _format_pregnancies(c.get("pregnancies"))
        body = rp.rstrip() + contra + pregs
        if body:
            sections.append("=== REPRODUCTIVE HEALTH ===\n" + body)

    # ENVIRONMENT
    env = ""
    env += _format_list("Sun exposure daily", c.get("sun_exposure_daily"))
    env += _format_list("Sunscreen use", c.get("sunscreen_use"))
    env += _format_list("Vitamin D supplement", c.get("vit_d_supplement"))
    env += _format_list("Barefoot outdoors", c.get("barefoot_outdoors"))
    if env:
        sections.append("=== ENVIRONMENT ===\n" + env.rstrip())

    # TIMELINE
    tl = _format_timeline(c.get("timeline_events"))
    if tl:
        sections.append("=== TIMELINE ===\n" + tl.lstrip("\n"))

    # ACTUAL LAB VALUES (from extracted reports). This block is critical —
    # without it the AI sees only the chip selection from the intake form
    # ("Recent labs done: B12, ferritin") with no values, and recommends
    # ordering tests that are already on file.
    lab_lines: list[str] = []
    markers = c.get("lab_markers") or []
    for m in markers if isinstance(markers, list) else []:
        if not isinstance(m, dict):
            continue
        name = m.get("marker") or m.get("name") or m.get("test_name") or ""
        val = m.get("value")
        unit = m.get("unit") or ""
        flag = m.get("flag") or ""
        ref = m.get("reference_range") or ""
        bits = [str(name)] if name else []
        bits.append(f"= {val} {unit}".strip())
        if ref:
            bits.append(f"(ref {ref})")
        if flag:
            bits.append(f"[{flag}]")
        lab_lines.append("  - " + " ".join(b for b in bits if b))
    # Also surface lab_values stored inside health_snapshots — older extractor
    # paths wrote there instead of the top-level lab_markers list.
    snaps = c.get("health_snapshots") or []
    for s in snaps if isinstance(snaps, list) else []:
        labs_in_snap = (s or {}).get("lab_values") or []
        if not isinstance(labs_in_snap, list):
            continue
        for lv in labs_in_snap:
            if not isinstance(lv, dict):
                continue
            name = lv.get("test_name") or lv.get("marker") or ""
            val = lv.get("value")
            unit = lv.get("unit") or ""
            date = lv.get("date_drawn") or s.get("date") or ""
            if name and val is not None:
                bit = f"  - {name} = {val} {unit}".rstrip()
                if date:
                    bit += f" (drawn {date})"
                lab_lines.append(bit)
    if lab_lines:
        sections.append(
            "=== LAB VALUES ON FILE (numeric — DO NOT recommend re-ordering these) ===\n"
            + "\n".join(lab_lines)
        )

    # READINESS
    rd = ""
    rd += _format_list("What has worked before", c.get("what_has_worked"))
    rd += _format_list("What hasn't worked", c.get("what_hasnt_worked"))
    rd += _format_list("Recent labs done", c.get("recent_labs_done"))
    rd += _format_list("Recent labs when", c.get("recent_labs_when"))
    rd += _format_list("Willing to share labs", c.get("willing_to_share_labs"))
    rd += _format_list("Willing to test further", c.get("willing_to_test_further"))
    rd += _format_list("Readiness confidence (1-10)", c.get("readiness_confidence"))
    if rd:
        sections.append("=== READINESS ===\n" + rd.rstrip())

    return "\n\n".join(sections)


SYSTEM_PROMPT = (
    "You are an FM-trained clinical reasoning assistant helping Shivani Hariharan, "
    "a functional medicine coach, prepare for her first session with a new client. "
    "The client has just submitted a detailed intake form. Your job is to surface "
    "the 3-5 most clinically significant PATTERNS, the protocol-gating RED FLAGS, "
    "the top 3 FM-driver HYPOTHESES, and 3-5 things Shivani should VERIFY in the "
    "upcoming session.\n\n"
    "LENGTH DISCIPLINE — this is the most important rule. Each item across ALL "
    "four lists is at most 2 short sentences. Coach reads this in 90 seconds. "
    "Don't pile 5 facts into one pattern — split them into separate patterns, or "
    "drop the weaker ones. If a sentence has 'plus', 'as well as', 'and also' — "
    "cut it. Total output across all 4 lists should fit in ~600 words.\n\n"
    "Be specific. No generic FM teaching. No platitudes. Every pattern must reference "
    "at least one specific piece of data from the intake (a med, a year, a chip "
    "value, a slider score).\n\n"
    "PATTERNS are the clinical story — the 3-5 most diagnostically meaningful "
    "threads visible across the data. RED FLAGS are different: they GATE the protocol "
    "(GLP-1 affects gastric emptying; recent autoimmune family flag should drive labs; "
    "trauma left blank means 'leave space, don't push'). Don't confuse the two; don't "
    "duplicate between them.\n\n"
    "TOP HYPOTHESES — at most 3, ranked by confidence (0-1). Each one's reasoning is "
    "ONE short sentence pointing to 1-2 specific intake observations.\n\n"
    "VERIFY-IN-SESSION items are short coach-to-client questions only an in-person "
    "conversation can answer — gaps, ambiguities, sensitive areas, things the client "
    "may have under-disclosed.\n\n"
    "SUPPLEMENTS the client is currently taking are listed under 'Current supplements'. "
    "Treat them as load-bearing data, not as items to ignore:\n"
    "  - If a current supplement is appropriate for the FM picture, include a "
    "    pattern or verify-item that says CONTINUE it (e.g. 'Continue magnesium "
    "    glycinate — appropriate for HPA-axis + sleep'). Don't silently omit it.\n"
    "  - If a current supplement INTERACTS or CONFLICTS with a listed medication, "
    "    that's a RED FLAG (e.g. 'Ashwagandha + thyroid medication — risk of "
    "    over-replacement, flag to prescriber').\n"
    "  - If a current supplement is INAPPROPRIATE for the client's profile "
    "    (e.g. high-dose iron without confirmed deficiency, ashwagandha during "
    "    pregnancy, St John's wort on SSRIs), that's a RED FLAG.\n"
    "  - If a current supplement is just unnecessary noise (poly-pharmacy, "
    "    duplicate ingredients), surface it as a pattern so the coach can "
    "    discuss simplification.\n"
    "Never assume a supplement on the list is fine — every entry is a decision "
    "the coach needs to make: continue, adjust, or stop.\n\n"
    "MEDICATION LIST IS COMPLETE — treat it as authoritative. The medications "
    "in 'Current medications' and the structured medication chips ARE the "
    "client's full medication list. If a medication is NOT listed, assume the "
    "client is NOT taking it — do not speculate that the list might be "
    "incomplete, and do NOT raise a red flag or verify-item asking the coach "
    "to 'clarify medication status' or 'confirm whether the client is on X'. "
    "The intake form explicitly asked for medications; a blank means none. "
    "Example of what NOT to do: 'TSH high but no levothyroxine documented — "
    "clarify thyroid medication status.' Instead, reason from what IS there: "
    "if a Hashimoto's client lists no thyroid medication, she is untreated — "
    "state that as the clinical fact and reason forward from it. The ONLY "
    "exception: if two pieces of intake data directly contradict each other "
    "(e.g. 'I take levothyroxine' written in a free-text box but no thyroid "
    "med chipped), THAT contradiction is worth a verify-item.\n\n"
    "TIER 1 SCREENING — pattern-matching that earns its keep:\n"
    "The intake now captures specific signals for the MCAS-POTS-EDS / long "
    "COVID / mould-CIRS family of conditions. These signals individually "
    "look unremarkable but together form a recognisable triad. When you "
    "see ≥ 2 of the following in TIER 1 SCREENING + BODY SYSTEMS:\n"
    "  • Histamine signals ≥ 3 (or 'diagnosed MCAS' chip)\n"
    "  • Beighton self-score ≥ 3/5 OR coach-verified hypermobile\n"
    "  • POTS pattern (coach-verified) OR ≥ 3 standing-tolerance symptoms\n"
    "  • PEM screen ≥ 2 chips (post-exertional malaise / ME/CFS / long COVID)\n"
    "  • Mould exposure ≥ 2 chips (current home, leaks, musty smell)\n"
    "→ Surface the TRIAD HYPOTHESIS in `top_hypotheses` as ONE entry, "
    "not 5 separate ones. Confidence rises with each additional positive. "
    "Example label: 'MCAS-POTS-EDS triad with PEM overlap' (confidence 0.8). "
    "Frame the pattern across the cluster rather than treating each finding "
    "in isolation — the protocols differ substantially: pacing not push-"
    "through, recumbent not upright exercise, low-histamine meal plan, "
    "gentle supplement titration starting at quarter doses, avoid "
    "quercetin > 1g / high-dose curcumin / aggressive detox.\n\n"
    "Beighton + lean-test specifics: if the client reports POTS-pattern "
    "symptoms but no HR device, flag in `verify_in_session` that the coach "
    "should run the 10-min lean test on the Zoom call. Same for Beighton "
    "≥ 3 — coach should re-check bilateral for the /9 score.\n\n"
    "PEM is the ONE signal that changes exercise prescription radically. "
    "If pem_screen has any ticks, flag in `red_flags`: 'PEM positive — "
    "graded exercise therapy contraindicated; coach should use pacing + "
    "energy-envelope framing'. This prevents the most common harm in "
    "this client population.\n\n"
    "Mould exposure ≥ 2 ticks + multi-system symptoms (especially "
    "neuroinflammation / brain fog / fatigue / chemical sensitivity) "
    "→ surface CIRS hypothesis. Coach can refer for mould workup; "
    "supplement protocol should be gentle (binders + glutathione, NOT "
    "aggressive detox).\n\n"
    "RETROSPECTIVE TIER 1 INFERENCE — legacy clients (intake pre-v0.75.2):\n"
    "If the `TIER 1 SCREENING` section is ABSENT or empty but other sections "
    "(BODY SYSTEMS / MEDICAL HISTORY / COVID / FAMILY HISTORY / TIMELINE) "
    "contain inferable signals, you MUST still flag SUSPECTED patterns at "
    "MODERATE confidence (0.4-0.6, never high) AND add a `verify_in_session` "
    "entry: 'Coach: re-issue intake to capture Tier 1 fields (Beighton, "
    "NASA lean, PEM, mould) — this client submitted before those sections "
    "existed.' Inference rules:\n"
    "  • PEM suspicion ← `COVID long-haul symptoms now/past` AND any of "
    "    {fatigue / brain fog / sleep changes / post-viral pattern} in "
    "    notes_for_coach / concerns. Surface as 'Suspected post-viral PEM "
    "    pattern — verify on intake refresh' in red_flags + recommend "
    "    pacing-not-graded-exercise even on suspicion alone.\n"
    "  • MCAS suspicion ← Histamine signals ≥ 3 already in BODY SYSTEMS, OR "
    "    'react strongly to multiple medications/supplements' chip, OR "
    "    chemical_sensitivity ≥ 2 chips + unexplained multi-system "
    "    inflammation pattern.\n"
    "  • POTS suspicion ← 'feel lightheaded standing', 'palpitations', "
    "    'fainting / near-fainting', or 'wake-with-racing-heart' pattern "
    "    in free text, especially post-COVID or post-pregnancy.\n"
    "  • Hypermobility suspicion ← family_specific_conditions includes "
    "    'joint hypermobility / Ehlers-Danlos', OR concerns mention "
    "    'always been bendy / flexible / double-jointed / dislocations'.\n"
    "  • Mould suspicion ← `toxic_exposures` free text mentions mould / "
    "    leaks / damp / musty smell, OR symptoms specifically worse on "
    "    humid days, OR multi-room respiratory + cognitive cluster.\n"
    "Retrospective inferences are FLOORED at confidence 0.6 — only the "
    "next intake refresh with real Tier 1 data can earn 0.7+ confidence. "
    "Never combine retrospective inferences into a single triad hypothesis "
    "above 0.65 — too speculative without the structured data. The point "
    "of inference is to PROMPT THE RE-ISSUE, not to substitute for it.\n\n"
    "DIETARY PREFERENCES — common confusions to avoid:\n"
    "  - 'Vegetarian Jain' is LACTO-VEGETARIAN. Dairy (milk, ghee, paneer, "
    "    dahi/curd, buttermilk) is fully permitted and traditionally central. "
    "    Only flesh foods, fish, eggs and gelatin are excluded; Jain ALSO "
    "    excludes onion / garlic / underground vegetables (potato, carrot, "
    "    beetroot, radish, turnip). Do NOT flag dairy in a Jain client's "
    "    non-negotiables as a conflict.\n"
    "  - 'Vegan' excludes all animal products including dairy + honey.\n"
    "  - 'Eggetarian' = vegetarian + eggs (no flesh/fish).\n"
    "  - 'Pescatarian' = vegetarian + fish.\n\n"
    "You'll use the `record_intake_insights` tool to return your structured output. "
    "Fill ALL FOUR lists. Empty hypotheses or empty verify-in-session is a failure."
)


TOOL_SCHEMA = {
    "name": "record_intake_insights",
    "description": "Record the structured clinical summary of the intake.",
    "input_schema": {
        "type": "object",
        "properties": {
            "patterns": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 3,
                "maxItems": 5,
                "description": "3-5 most clinically significant FM patterns visible in the intake.",
            },
            "red_flags": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 6,
                "description": "Protocol-gating concerns Shivani should know about before designing interventions.",
            },
            "top_hypotheses": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "driver": {"type": "string"},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "reasoning": {"type": "string"},
                    },
                    "required": ["driver", "confidence", "reasoning"],
                },
                "minItems": 1,
                "maxItems": 3,
            },
            "verify_in_session": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 5,
                "description": "Things Shivani should verify in person — gaps, ambiguities, sensitive areas.",
            },
        },
        "required": ["patterns", "red_flags", "top_hypotheses", "verify_in_session"],
    },
}


def _mock_insights() -> dict[str, Any]:
    return {
        "patterns": [
            "Chronic PPI use (pantoprazole 6 yrs) → likely B12/iron/Mg depletion + gastric pH disruption",
            "GLP-1 in last 12 months → delayed gastric emptying may explain bloating after meals",
            "Family Hashimoto's + reported fatigue + cold intolerance — thyroid axis worth screening",
        ],
        "red_flags": [
            "GLP-1 + supplements: titrate slowly, separate from meals, watch for nausea",
            "PPI on board: do not stack acid-binding minerals at the same dose hour",
            "Family thyroid + autoimmune flags — full thyroid panel (TSH, fT3, fT4, TPO) before any iodine/selenium",
        ],
        "top_hypotheses": [
            {
                "driver": "Post-PPI nutrient depletion + dysbiosis",
                "confidence": 0.78,
                "reasoning": "6-year pantoprazole + reported fatigue + brittle nails + reported reflux relapse on tapering attempt.",
            },
            {
                "driver": "Subclinical hypothyroidism",
                "confidence": 0.55,
                "reasoning": "Family Hashimoto's, cold intolerance, weight regain after GLP-1, hair thinning.",
            },
            {
                "driver": "HPA-axis dysregulation",
                "confidence": 0.42,
                "reasoning": "Shift work pattern + wake-at-3am + caffeine dependency.",
            },
        ],
        "verify_in_session": [
            "Has client ever had a full thyroid antibody panel? (only TSH on file)",
            "Confirm whether GLP-1 was stopped or just paused (intake said 'on hold' — ambiguous)",
            "Childhood trauma section was blank — leave space; don't push but note for later",
            "Sleep tracker shows 5.5h average — is this typical or recent-only?",
        ],
    }


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id: str = (payload.get("client_id") or "").strip()
    dry_run: bool = bool(payload.get("dry_run"))

    if not client_id:
        json.dump({"ok": False, "error": "client_id is required"}, sys.stdout)
        return 2

    try:
        from fmdb.plan.storage import plans_root, load_client, write_client
        from fmdb.plan.models import IntakeInsights, IntakeInsightHypothesis
    except Exception as e:
        json.dump({"ok": False, "error": f"import failed: {e}"}, sys.stdout)
        return 1

    root = plans_root()
    try:
        client = load_client(root, client_id)
    except FileNotFoundError:
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 1
    except Exception as e:
        json.dump({"ok": False, "error": f"load failed: {e}"}, sys.stdout)
        return 1

    if not client.intake_submitted_at:
        json.dump({"ok": False, "error": "intake not yet submitted for this client"}, sys.stdout)
        return 1

    # Coach notes for the AI. If the caller supplied fresh notes in the
    # payload (typed in the UI before clicking Regenerate), those take
    # precedence — otherwise fall back to whatever is already on disk.
    payload_notes = (payload.get("coach_notes_for_ai") or "").strip()
    existing_notes = ""
    if payload_notes:
        existing_notes = payload_notes
    elif client.intake_insights is not None:
        existing_notes = client.intake_insights.coach_notes_for_ai or ""

    if dry_run:
        mock = _mock_insights()
        result = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": "claude-haiku-4-5",
            "patterns": mock["patterns"],
            "red_flags": mock["red_flags"],
            "top_hypotheses": mock["top_hypotheses"],
            "verify_in_session": mock["verify_in_session"],
            "coach_notes_for_ai": existing_notes,
        }
        json.dump({
            "ok": True,
            "client_id": client_id,
            "insights": result,
            "usage": {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
            "error": None,
        }, sys.stdout)
        return 0

    _load_dotenv()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 2

    # Build the prompt. Use model_dump(mode='json') so dates / datetimes / enums
    # serialise cleanly without surprising us at runtime.
    client_dict = client.model_dump(mode="json")
    intake_block = _build_intake_payload(client_dict)

    coach_notes_block = ""
    if existing_notes.strip():
        coach_notes_block = (
            "=== COACH NOTES — HIGHEST PRIORITY ===\n"
            "These notes override your interpretation. They are corrections / context\n"
            "from the coach who knows this client. Honour them verbatim. If a note\n"
            "says a value exists, do NOT recommend ordering that test.\n\n"
            f"{existing_notes.strip()}\n\n"
        )

    user_prompt = (
        f"Here is the full structured intake submission for client "
        f"{client.display_name or client.client_id}.\n\n"
        f"{coach_notes_block}"
        f"{intake_block}\n\n"
        "Use the `record_intake_insights` tool to record your structured summary. "
        "Ground every pattern, red flag, and hypothesis in specific values above. "
        "Before recommending any lab test under verify_in_session or red_flags, "
        "scan the LAB VALUES ON FILE section — if the marker is already there, "
        "interpret the existing value instead of asking the coach to order it."
    )

    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    api = Anthropic(api_key=api_key)
    model_id = "claude-haiku-4-5"
    try:
        with api.messages.stream(
            model=model_id,
            # Real-world test 2026-05-14: 2048 tokens ran out after 5 patterns
            # + 6 red flags (Haiku is verbose with clinical detail), leaving
            # top_hypotheses + verify_in_session empty. 4096 gives headroom
            # for all 4 sections + tighter-prompt instruction below.
            max_tokens=4096,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[TOOL_SCHEMA],
            tool_choice={"type": "tool", "name": "record_intake_insights"},
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            resp = stream.get_final_message()
    except Exception as e:
        json.dump({"ok": False, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    # Usage telemetry (best effort).
    try:
        from fmdb.usage import log_usage as _log_usage
        _log_usage(
            client_id=client_id,
            script="generate-intake-insights.py",
            model=model_id,
            usage=resp.usage,
            notes=f"intake_chars={len(intake_block)}",
        )
    except Exception:
        pass

    tool_use = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
    if not tool_use:
        json.dump({"ok": False, "error": "no tool_use in response"}, sys.stdout)
        return 1

    tool_input = tool_use.input or {}

    # Coerce into Pydantic to validate, then write back.
    try:
        hypotheses = [
            IntakeInsightHypothesis(**h) for h in (tool_input.get("top_hypotheses") or [])
        ]
        insights = IntakeInsights(
            generated_at=datetime.now(timezone.utc),
            model=model_id,
            patterns=list(tool_input.get("patterns") or []),
            red_flags=list(tool_input.get("red_flags") or []),
            top_hypotheses=hypotheses,
            verify_in_session=list(tool_input.get("verify_in_session") or []),
            coach_notes_for_ai=existing_notes,
        )
    except Exception as e:
        json.dump({"ok": False, "error": f"validation of tool output failed: {e}"}, sys.stdout)
        return 1

    client.intake_insights = insights
    try:
        write_client(root, client)
    except Exception as e:
        json.dump({"ok": False, "error": f"write_client failed: {e}"}, sys.stdout)
        return 1

    # Cost (USD)
    try:
        inp = int(getattr(resp.usage, "input_tokens", 0) or 0)
        out = int(getattr(resp.usage, "output_tokens", 0) or 0)
        cost = (inp * _HAIKU_INPUT_PRICE + out * _HAIKU_OUTPUT_PRICE) / 1_000_000
    except Exception:
        inp = out = 0
        cost = 0.0

    json.dump({
        "ok": True,
        "client_id": client_id,
        "insights": insights.model_dump(mode="json"),
        "usage": {"input_tokens": inp, "output_tokens": out, "cost_usd": round(cost, 4)},
        "error": None,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
