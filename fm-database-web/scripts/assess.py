#!/usr/bin/env python3
"""Thin shim wrapping fmdb.assess.suggester.synthesize for the Next.js UI.

Reads JSON from stdin:
{
  "client_id": str,
  "symptoms": [str],          # symptom slugs
  "topics": [str],            # topic slugs
  "complaints": str,          # free-text presenting complaints
  "attachments": [             # optional
    {"path": str, "mime_type": str, "kind": "lab_report"|"food_journal"}
  ],
  "dry_run": bool             # if true, return a synthetic suggestion (skip Anthropic)
}

Writes JSON to stdout:
{
  "ok": bool,
  "session_id": str,
  "suggestions": {...},       # full synthesize() output
  "computed_ratios": [...],   # derived FM markers from extracted_labs
  "usage": {...},
  "subgraph_size": int,       # bytes
  "error": str | null
}

Persists a Session record to ~/fm-plans/clients/<id>/sessions/<sid>.yaml on success.
Also persists computed lab_markers to the client YAML (latest only).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

# Wire imports to the Python engine.
FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

# VitaOne inventory JSON (refreshed by scripts/vitaone-scrape.py). Loaded
# once and passed into the suggester so the model has visibility into
# which products the coach has affiliate access to.
_VITAONE_JSON_PATH = Path(__file__).resolve().parent / "vitaone-catalog.json"


def _load_vitaone_inventory() -> list[dict]:
    """Read the scraped catalog and filter out non-supplement entries (categories,
    lab tests, panels, memberships). Returns `[{slug, name, url}]` for the AI
    to map supplement suggestions onto stocked products."""
    if not _VITAONE_JSON_PATH.exists():
        return []
    try:
        data = json.loads(_VITAONE_JSON_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    import html as _html
    NON_PRODUCT_SLUGS = {
        "education-23", "functional-food-1", "lab-tests-26", "pharmacy-24",
        "199-per-order-on-event-registration-291", "50-on-specific-products-32",
        "functional-medicine-foundation-2",
        "functional-medicine-foundation-global-497",
        "functional-medicine-in-clinical-nutrition-29",
        "standard-practitioner-membership-334",
    }
    out: list[dict] = []
    for p in data.get("products", []):
        slug = p.get("slug") or ""
        name = _html.unescape(p.get("name", "")).strip()
        if not slug or not name:
            continue
        nl = name.lower()
        if nl.endswith("| vitaone") or " | vitaone" in nl:
            continue
        if slug.startswith("supplements-"):
            continue
        if slug in NON_PRODUCT_SLUGS:
            continue
        # Lab tests, genetic tests, and diagnostic panels: surfaced separately
        # via `lab_followups`, not as supplement matches.
        if "lab test" in nl or "genetic test" in nl or "panel" in nl or "health test" in nl:
            continue
        out.append({"slug": slug, "name": name, "url": p.get("url", "")})
    out.sort(key=lambda x: x["name"].lower())
    return out


def _build_intake_extras(client) -> dict:
    """Bundle every intake-form field that wasn't already surfaced in
    client_ctx. Coach explicitly asked: "no information we collect from
    the client should be ignored." Each subsection is omitted if empty
    so prompt size stays bounded for sparse clients.

    Grouping mirrors the intake form sections so the AI's mental model
    matches what the client filled.
    """
    def _nonempty(v):
        if v is None: return False
        if isinstance(v, (list, dict, str)) and not v: return False
        return True

    def _g(k, default=None):
        v = getattr(client, k, default)
        return v if _nonempty(v) else None

    def _med_entries(name):
        entries = getattr(client, name, None) or []
        if not entries: return None
        out = []
        for e in entries:
            d = e.model_dump() if hasattr(e, "model_dump") else dict(e)
            # Drop empty keys to keep prompt small.
            d = {k: v for k, v in d.items() if _nonempty(v)}
            if d:
                out.append(d)
        return out or None

    bundle: dict = {}

    # ── Weight history (the WHERE-AM-I-FROM context) ───────────────────
    weight_hx = {
        "highest_kg": _g("weight_highest_adult"),
        "lowest_kg": _g("weight_lowest_adult"),
        "current_trend": _g("weight_trend_current"),
        "change_trigger": _g("weight_change_trigger"),
    }
    if any(weight_hx.values()):
        bundle["weight_history"] = {k: v for k, v in weight_hx.items() if v is not None}

    # ── Layered medication categories (structured: name/dose/duration) ─
    meds_layered = {}
    for label, attr in [
        ("glp1", "glp1_medications"),
        ("acid_suppressants", "acid_suppressants"),
        ("nsaids_daily", "nsaids_daily"),
        ("antibiotics_last_12mo", "antibiotics_last_12mo"),
        ("hormonal_contraception_or_hrt", "hormonal_contraception_hrt"),
        ("thyroid", "thyroid_medication"),
        ("psych", "psych_medications"),
        ("biologics_immunosuppressants", "biologics_immunosuppressants"),
        ("statins_bp_diabetes", "statins_bp_diabetes"),
    ]:
        entries = _med_entries(attr)
        if entries:
            meds_layered[label] = entries
    if meds_layered:
        bundle["medications_layered"] = meds_layered

    # ── COVID history ──────────────────────────────────────────────────
    covid = {
        "history": _g("covid_history"),
        "long_symptoms": _g("covid_long_symptoms"),
        "vaccine_history": _g("covid_vaccine_history"),
        "vaccine_brand": _g("covid_vaccine_brand"),
        "vaccine_reactions": _g("covid_vaccine_reactions"),
        "vaccine_reaction_detail": _g("covid_vaccine_reaction_detail"),
    }
    if any(covid.values()):
        bundle["covid"] = {k: v for k, v in covid.items() if v is not None}

    # ── Family ─────────────────────────────────────────────────────────
    fam = {
        "free_text": _g("family_history"),
        "specific_conditions": _g("family_specific_conditions"),
    }
    if any(fam.values()):
        bundle["family"] = {k: v for k, v in fam.items() if v is not None}

    # ── Body systems inventory ─────────────────────────────────────────
    body = {
        "digestion_notes": _g("digestion_notes"),
        "bristol_typical": _g("bristol_stool_typical"),
        "bowel_frequency_per_day": _g("bowel_frequency_per_day"),
        "bowel_pattern": _g("bowel_pattern"),
        "bowel_historical": _g("bowel_historical"),
        "hair_loss_pattern": _g("hair_loss_pattern"),
        "hair_texture_change": _g("hair_texture_change"),
        "hair_other": _g("hair_other"),
        "nail_signs": _g("nail_signs"),
        "acne_pattern": _g("acne_pattern"),
        "skin_signs": _g("skin_signs"),
        "pain_locations": _g("pain_locations"),
        "pain_pattern": _g("pain_pattern"),
        "pain_quality": _g("pain_quality"),
        "headache_type": _g("headache_type"),
        "belly_fat_pattern": _g("belly_fat_pattern"),
        "histamine_signals": _g("histamine_signals"),
        "chemical_sensitivity": _g("chemical_sensitivity"),
        "oral_signs": _g("oral_signs"),
        "postprandial_pattern": _g("postprandial_pattern"),
        "cold_heat_tolerance": _g("cold_heat_tolerance"),
    }
    body = {k: v for k, v in body.items() if v is not None}
    if body:
        bundle["body_systems"] = body

    # ── Sleep depth ────────────────────────────────────────────────────
    sleep = {
        "time_to_fall_asleep": _g("time_to_fall_asleep"),
        "wake_pattern": _g("wake_time_pattern"),
        "snore_or_apnoea": _g("snore_or_apnoea"),
        "restless_legs": _g("restless_legs"),
        "sleep_tracker_owned": _g("sleep_tracker_owned"),
        "cgm_owned": _g("cgm_owned"),
        "sleep_notes": _g("sleep_notes"),
    }
    sleep = {k: v for k, v in sleep.items() if v is not None}
    if sleep:
        bundle["sleep_depth"] = sleep

    # ── Energy / morning state / stimulants ────────────────────────────
    energy = {
        "energy_crashes": _g("energy_crashes"),
        "caffeine_dependency": _g("caffeine_dependency"),
        "morning_state": _g("morning_state"),
        "energy_pattern": _g("energy_pattern"),
    }
    energy = {k: v for k, v in energy.items() if v is not None}
    if energy:
        bundle["energy"] = energy

    # ── Stress + work ──────────────────────────────────────────────────
    stress = {
        "stress_response": _g("stress_response"),
        "work_pattern": _g("work_pattern"),
    }
    stress = {k: v for k, v in stress.items() if v is not None}
    if stress:
        bundle["stress_work"] = stress

    # ── Environment ────────────────────────────────────────────────────
    env = {
        "sun_exposure_daily": _g("sun_exposure_daily"),
        "sunscreen_use": _g("sunscreen_use"),
        "vit_d_supplement": _g("vit_d_supplement"),
        "barefoot_outdoors": _g("barefoot_outdoors"),
        "toxic_exposures": _g("toxic_exposures"),
    }
    env = {k: v for k, v in env.items() if v is not None}
    if env:
        bundle["environment"] = env

    # ── Reproductive depth (beyond what cycle_context covers) ──────────
    if (getattr(client, "sex", None) or "").upper() == "F":
        repro = {
            "menstrual_notes": _g("menstrual_notes"),
            "period_pain_severity": _g("period_pain_severity"),
            "period_pain_impact": _g("period_pain_impact"),
            "pmdd_signs": _g("pmdd_signs"),
            "perimenopause_inventory": _g("perimenopause_inventory"),
            "contraception_history": [
                e.model_dump() if hasattr(e, "model_dump") else dict(e)
                for e in (getattr(client, "contraception_history", None) or [])
            ] or None,
            "pregnancies": [
                e.model_dump() if hasattr(e, "model_dump") else dict(e)
                for e in (getattr(client, "pregnancies", None) or [])
            ] or None,
            "repro_diagnoses": _g("repro_diagnoses"),
            "pregnancy_status": _g("pregnancy_status"),
            "pregnancy_due_date": _g("pregnancy_due_date"),
            "lactation_started": _g("lactation_started"),
            "menopause_started": _g("menopause_started"),
        }
        repro = {k: v for k, v in repro.items() if v is not None}
        if repro:
            bundle["reproductive_depth"] = repro

    # ── Past + readiness ───────────────────────────────────────────────
    past = {
        "childhood_history": _g("childhood_history"),
        "what_has_worked": _g("what_has_worked"),
        "what_hasnt_worked": _g("what_hasnt_worked"),
    }
    past = {k: v for k, v in past.items() if v is not None}
    if past:
        bundle["past_history"] = past

    readiness = {
        "readiness_confidence": _g("readiness_confidence"),
        "recent_labs_done": _g("recent_labs_done"),
        "recent_labs_when": _g("recent_labs_when"),
        "willing_to_share_labs": _g("willing_to_share_labs"),
        "willing_to_test_further": _g("willing_to_test_further"),
    }
    readiness = {k: v for k, v in readiness.items() if v is not None}
    if readiness:
        bundle["readiness"] = readiness

    return bundle


def _load_external_reports(plans_root: Path, client_id: str) -> list[dict]:
    """Walk clients/<id>/reports/*.yaml — these are the genetic /
    food-sensitivity / OAT / imaging / dexa reports the coach uploads
    via uploadReportAction → extract-report.py. Returned shape mirrors
    `_load_functional_tests` so the AI can treat them the same way.

    Each report's YAML has type + lab_name + date_of_report + extracted +
    key_findings + summary fields. We surface the actionable bits and
    skip the verbose raw extraction.
    """
    import yaml
    dir_ = plans_root / "clients" / client_id / "reports"
    if not dir_.exists():
        return []
    out: list[dict] = []
    for fp in sorted(dir_.glob("*.yaml")):
        try:
            d = yaml.safe_load(fp.read_text()) or {}
            if not isinstance(d, dict):
                continue
            ext = d.get("extracted") if isinstance(d.get("extracted"), dict) else {}
            entry = {
                "report_type": d.get("type") or d.get("report_type") or "unknown",
                "lab_name": d.get("lab_name") or ext.get("lab_name") or None,
                "date_of_report": d.get("date_of_report") or ext.get("date_of_report") or None,
                "summary": ext.get("summary") or d.get("summary") or "",
                "key_findings": ext.get("key_findings") or d.get("key_findings") or [],
            }
            # Food sensitivity — chip-list of reactive foods bucketed by
            # severity. The AI uses this to populate foods_to_avoid and
            # nutrition.reduce. Coach: "this info should drive the meal plan".
            if entry["report_type"] in ("food_sensitivity", "food-sensitivity"):
                entry["reactive_foods"] = ext.get("reactive_foods") or {}
                entry["food_groups_affected"] = ext.get("food_groups_affected") or []
            # Genetic — surface SNP highlights + relevant variants. AI
            # uses this for methylation/detox/sleep-gene context.
            if entry["report_type"] in ("genetic_test", "genetic"):
                entry["fm_relevant_variants"] = ext.get("fm_relevant_variants") or []
                entry["methylation_summary"] = ext.get("methylation_summary") or None
                entry["detox_summary"] = ext.get("detox_summary") or None
            # OAT — yeast/bacteria/mito/neuro/oxalate buckets.
            if entry["report_type"] in ("organic_acids", "oat"):
                for k in ("yeast_fungal", "bacterial_dysbiosis", "mitochondrial_function",
                          "neurotransmitter_metabolism", "oxalates", "detox_capacity"):
                    if ext.get(k):
                        entry[k] = ext[k]
            out.append(entry)
        except Exception:
            continue
    return out


def _load_functional_tests(plans_root: Path, client_id: str) -> list[dict]:
    """Walk clients/<id>/functional_tests/*.yaml and return a compact
    summary per file. Skip anything unreadable. Coach uploads DUTCH /
    GI-MAP / BugSpeaks / Sova / OAT etc. through the Functional Test
    panel; parse-functional-test.py produces the YAML this reads.

    Returned shape is intentionally lean — the full findings dict can
    run 50+ keys per panel, but the AI only needs the actionable summary
    + the drivers it flagged + the clinical recommendations.
    """
    import yaml  # local import — assess.py only needs it for this
    fts_dir = plans_root / "clients" / client_id / "functional_tests"
    if not fts_dir.exists():
        return []
    out: list[dict] = []
    for fp in sorted(fts_dir.glob("*.yaml")):
        try:
            d = yaml.safe_load(fp.read_text()) or {}
            if not isinstance(d, dict):
                continue
            tt = (d.get("test_type") or "unknown").lower()
            entry = {
                "test_type": d.get("test_type") or "unknown",
                "test_date": d.get("test_date") or None,
                "summary": d.get("summary") or "",
                "flagged_drivers": d.get("flagged_drivers") or [],
                # GI/DUTCH parsers write `clinical_recommendations`; the
                # genetic parser writes `fm_recommendations` — accept both.
                "clinical_recommendations": (
                    d.get("clinical_recommendations")
                    or d.get("fm_recommendations")
                    or []
                ),
                # A pruned subset of the structured findings — the keys the
                # AI is most likely to act on. Keeps prompt size sane.
                "key_findings": {
                    k: v for k, v in d.items()
                    if k in (
                        "h_pylori", "pathogens_detected", "opportunistic_overgrowth",
                        "commensal_dysbiosis", "health_markers",
                        "estrogen_metabolism", "cortisol_pattern", "neurotransmitter_metabolism",
                        "mitochondrial_function", "yeast_fungal", "bacterial_dysbiosis",
                    )
                },
            }
            # ── Type-aware extraction ──────────────────────────────────
            # A genetic / food-sensitivity / OAT report can land in
            # functional_tests/ (e.g. uploaded via the Functional Test
            # panel instead of the Reports tab). The GI-shaped key_findings
            # allowlist above would silently strip its real data — the SNP
            # list, the reactive-food buckets. Pull the type-specific
            # fields so nothing the coach uploaded is lost. Mirrors the
            # extraction in _load_external_reports; the suggester's rules
            # 11y/11a both consume these. (Bug fix 2026-05-20 — Archana's
            # genetic report sat in functional_tests/ and its MTHFR/COMT/
            # GSTP1 variants never reached the plan-generation AI.)
            if tt in ("genetic", "genetic_test"):
                snps = d.get("snps") or d.get("fm_relevant_variants") or []
                # Keep only ACTIONABLE variants — drop homozygous-wild SNPs
                # (explicitly "no action needed"). A genetic panel can list
                # 40-50 SNPs; the wild-type ones are prompt noise. The
                # heterozygous / homozygous-variant / risk ones are what
                # drive the protocol.
                entry["genetic_variants"] = [
                    {
                        "gene": s.get("gene"),
                        "variant": s.get("variant"),
                        "genotype": s.get("genotype"),
                        "zygosity": s.get("zygosity"),
                        "fm_relevance": s.get("fm_relevance") or s.get("implication"),
                    }
                    for s in snps
                    if isinstance(s, dict)
                    and "wild" not in str(s.get("zygosity") or "").lower()
                ]
                if d.get("methylation_summary"):
                    entry["methylation_summary"] = d["methylation_summary"]
                if d.get("detox_summary"):
                    entry["detox_summary"] = d["detox_summary"]
            elif tt in ("food_sensitivity", "food-sensitivity"):
                entry["reactive_foods"] = d.get("reactive_foods") or {}
                entry["food_groups_affected"] = d.get("food_groups_affected") or []
            elif tt in ("organic_acids", "oat"):
                for k in ("yeast_fungal", "bacterial_dysbiosis",
                          "mitochondrial_function", "neurotransmitter_metabolism",
                          "oxalates", "detox_capacity"):
                    if d.get(k):
                        entry[k] = d[k]
            out.append(entry)
        except Exception:
            continue
    return out


def _load_dotenv() -> None:
    """Load fm-database/.env if python-dotenv is available."""
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        # Best-effort manual parse — covers the common KEY=VALUE case.
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _synthetic_result(payload: dict) -> dict:
    """Cheap deterministic stand-in for a real Claude call. Uses the
    selected slugs so the round-trip is meaningful in dev."""
    sym = payload.get("symptoms") or []
    top = payload.get("topics") or []
    return {
        "suggestions": {
            "extracted_labs": [],
            "likely_drivers": [
                {"mechanism_slug": "hpa-axis-dysregulation", "rank": 1,
                 "reasoning": f"[dry-run] inferred from symptoms {sym}",
                 "supporting_evidence": sym[:2]},
            ] if sym else [],
            "topics_in_play": [
                {"topic_slug": t, "role": "primary", "rationale": "[dry-run]", "confidence_pct": 50}
                for t in top[:2]
            ],
            "additional_symptoms_to_screen": [],
            "lifestyle_suggestions": [
                {"name": "morning sunlight", "cadence": "daily",
                 "details": "[dry-run] 10 min within 30 min of waking",
                 "rationale": "circadian anchoring",
                 "addresses_mechanism": ["hpa-axis-dysregulation"]},
            ],
            "nutrition_suggestions": {
                "pattern": "[dry-run] gentle anti-inflammatory",
                "add": ["leafy greens"], "reduce": ["ultra-processed snacks"],
                "meal_timing": "12-hour overnight fast",
                "cooking_adjustment_slugs": [], "home_remedy_slugs": [],
                "rationale": "[dry-run]",
            },
            "supplement_suggestions": [],
            "lab_followups": [],
            "referral_triggers": [],
            "education_framings": [],
            "synthesis_notes": "[dry-run] synthetic suggestion — no Anthropic call was made.",
            "catalogue_additions_suggested": [],
        },
        "usage": {
            "model": "dry-run",
            "stop_reason": "end_turn",
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        },
    }


# ─────────────────────────────────────────────────────────────────────────
# Assess result cache (D.4) — Haiku-first re-run gate via full-result cache
# ─────────────────────────────────────────────────────────────────────────
# When the coach re-runs Analyze with identical inputs (same symptoms,
# topics, lab files, client context, presenting complaints) the previous
# AssessResult is returned from disk instead of paying for another Sonnet
# call. Cache key = sha256 of the canonicalised input bundle. Cache lives
# at ~/.fm-cache/assess/<key>.json. Disabled via FM_ASSESS_NO_CACHE=1.
#
# Cache entries are append-only — stale entries are harmless (next coach
# edit will produce a fresh key) and the dir is gitignored.

_ASSESS_CACHE_DIR = Path(
    os.environ.get("FM_ASSESS_CACHE_DIR")
    or (Path.home() / ".fm-cache" / "assess")
)


def _hash_lab_file(path: str) -> str:
    """Fast file hash for cache-key derivation. Reads the file once;
    SHA-256 prefix (16 hex chars) is enough collision resistance for the
    "did the coach upload the same lab again" check."""
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()[:16]
    except Exception:
        return "missing"


def _stable_json(obj) -> str:
    """Canonical JSON for hashing — sorted keys, no whitespace."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _assess_cache_key(
    *,
    client_ctx: dict,
    symptoms: list[str],
    topics: list[str],
    complaints: str,
    history_bundle: list[dict] | None,
    attachments: list[dict],
) -> str:
    """Derive a deterministic cache key from all inputs the model sees."""
    lab_sigs = sorted(
        _hash_lab_file(a.get("path", "")) for a in attachments if a.get("path")
    )
    blob = {
        # Strip non-deterministic fields (timestamps) from client_ctx; we
        # only hash the substance that drives the model output.
        "client_ctx": {
            k: v
            for k, v in client_ctx.items()
            if k
            not in (
                "intake_token",
                "intake_token_expires_at",
                "intake_form_draft_saved_at",
                "intake_last_submitted_at",
                "next_contact_date",
            )
        },
        "symptoms": sorted(symptoms),
        "topics": sorted(topics),
        "complaints": (complaints or "").strip(),
        "history_bundle": history_bundle or [],
        "labs": lab_sigs,
    }
    h = hashlib.sha256(_stable_json(blob).encode()).hexdigest()
    return h[:32]  # 32 hex chars = 128 bits, plenty


def _load_cached_assess(key: str) -> dict | None:
    if os.environ.get("FM_ASSESS_NO_CACHE") == "1":
        return None
    f = _ASSESS_CACHE_DIR / f"{key}.json"
    if not f.exists():
        return None
    try:
        with open(f) as fh:
            data = json.load(fh)
        # Annotate that this came from cache so the UI can surface a
        # subtle "cached" badge if it wants.
        data["_from_cache"] = True
        data["_cached_at"] = data.get("_cached_at", "")
        return data
    except Exception:
        return None


def _save_assess_cache(key: str, payload: dict) -> None:
    if os.environ.get("FM_ASSESS_NO_CACHE") == "1":
        return
    try:
        _ASSESS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        f = _ASSESS_CACHE_DIR / f"{key}.json"
        out = {**payload, "_cached_at": datetime.now(timezone.utc).isoformat()}
        with open(f, "w") as fh:
            json.dump(out, fh)
    except Exception:
        # Cache failures are NEVER fatal — fall through.
        pass


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON on stdin: {e}"}, sys.stdout)
        return 2

    client_id = payload.get("client_id") or ""
    symptoms = payload.get("symptoms") or []
    topics = payload.get("topics") or []
    complaints = payload.get("complaints") or ""
    attachments = payload.get("attachments") or []
    dry_run = bool(payload.get("dry_run"))
    session_date_str = payload.get("session_date") or None  # ISO YYYY-MM-DD or None (defaults to today)
    five_pillars_raw: dict | None = payload.get("five_pillars") or None

    if not client_id:
        json.dump({"ok": False, "error": "client_id is required"}, sys.stdout)
        return 2

    _load_dotenv()

    # Imports deferred so --help / arg-validation paths don't pay their cost.
    from fmdb.validator import load_all
    from fmdb.assess.subgraph import build_subgraph
    from fmdb.plan import storage as plan_storage
    from fmdb.plan.models import Session, UploadedFileRef, FivePillarsAssessment

    # Build FivePillarsAssessment from raw dict (if provided)
    five_pillars_obj: "FivePillarsAssessment | None" = None
    if five_pillars_raw and any(v is not None for v in five_pillars_raw.values()):
        try:
            five_pillars_obj = FivePillarsAssessment(
                sleep_hours=five_pillars_raw.get("sleep_hours"),
                sleep_quality=five_pillars_raw.get("sleep_quality"),
                stress_level=five_pillars_raw.get("stress_level"),
                movement_days_per_week=five_pillars_raw.get("movement_days_per_week"),
                nutrition_quality=five_pillars_raw.get("nutrition_quality"),
                connection_quality=five_pillars_raw.get("connection_quality"),
            )
        except Exception:
            five_pillars_obj = None

    data_dir = FMDB_ROOT / "data"
    cat = load_all(data_dir)
    root = plan_storage.plans_root()

    # Resolve client (must exist).
    try:
        client = plan_storage.load_client(root, client_id)
    except FileNotFoundError as e:
        json.dump({"ok": False, "error": f"client not found: {client_id} ({e})"}, sys.stdout)
        return 2

    # ── Subgraph cache (D.5) ────────────────────────────────────────────
    # The catalogue subgraph is a pure function of (symptoms, topics, catalogue
    # mtime). Cache by sha256 of the slug lists + catalogue mtime so the
    # ~35K-token bundle isn't re-walked from scratch on every Analyze.
    # Persists at ~/.fm-cache/assess/subgraph/<key>.json. Bust manually
    # via `rm -rf ~/.fm-cache/assess/subgraph` after catalogue edits if
    # the mtime heuristic ever drifts (gitignored, harmless to clear).
    subgraph: dict | None = None
    if os.environ.get("FM_ASSESS_NO_CACHE") != "1":
        try:
            # Catalogue mtime — use the most recent modification across the
            # data dir so a catalogue change invalidates all subgraph cache
            # entries automatically.
            cat_mtime = 0.0
            for p in Path(os.environ.get("FMDB_CATALOGUE_DIR") or "../fm-database/data").glob("**/*.yaml"):
                cat_mtime = max(cat_mtime, p.stat().st_mtime)
            sg_blob = {
                "symptoms": sorted(symptoms),
                "topics": sorted(topics),
                "cat_mtime": int(cat_mtime),
            }
            sg_key = hashlib.sha256(_stable_json(sg_blob).encode()).hexdigest()[:32]
            sg_cache_dir = _ASSESS_CACHE_DIR / "subgraph"
            sg_file = sg_cache_dir / f"{sg_key}.json"
            if sg_file.exists():
                with open(sg_file) as fh:
                    subgraph = json.load(fh)
        except Exception:
            subgraph = None
    if subgraph is None:
        subgraph = build_subgraph(cat, symptom_slugs=symptoms, topic_slugs=topics)
        # Best-effort save — failures don't break the assess flow.
        try:
            if os.environ.get("FM_ASSESS_NO_CACHE") != "1":
                sg_cache_dir = _ASSESS_CACHE_DIR / "subgraph"
                sg_cache_dir.mkdir(parents=True, exist_ok=True)
                cat_mtime = 0.0
                for p in Path(os.environ.get("FMDB_CATALOGUE_DIR") or "../fm-database/data").glob("**/*.yaml"):
                    cat_mtime = max(cat_mtime, p.stat().st_mtime)
                sg_blob = {
                    "symptoms": sorted(symptoms),
                    "topics": sorted(topics),
                    "cat_mtime": int(cat_mtime),
                }
                sg_key = hashlib.sha256(_stable_json(sg_blob).encode()).hexdigest()[:32]
                with open(sg_cache_dir / f"{sg_key}.json", "w") as fh:
                    json.dump(subgraph, fh)
        except Exception:
            pass
    subgraph_bytes = len(json.dumps(subgraph))

    # ----- attachments (already saved by the TS layer; we re-read them as base64) -----
    lab_files: list[dict] = []
    file_refs: list[UploadedFileRef] = []
    now = datetime.now(timezone.utc)
    today = date.fromisoformat(session_date_str) if session_date_str else date.today()
    for att in attachments:
        path = att.get("path")
        if not path or not os.path.exists(path):
            continue
        mime = att.get("mime_type") or "application/octet-stream"
        kind = att.get("kind") or "lab_report"
        with open(path, "rb") as fh:
            data_b64 = base64.b64encode(fh.read()).decode("ascii")
        lab_files.append({
            "filename": os.path.basename(path),
            "mime_type": mime,
            "data_b64": data_b64,
            "kind": kind,
        })
        file_refs.append(UploadedFileRef(
            filename=os.path.basename(path),
            kind=kind,
            uploaded_at=now,
        ))

    # ----- client context (mirrors the Streamlit version) -----
    m = client.measurements
    age = client.estimated_age()
    bmr = m.bmr_mifflin_st_jeor(age, client.sex) if age else None
    client_ctx = {
        "client_id": client.client_id,
        "age_band": client.age_band,
        "estimated_age": age,
        "date_of_birth": client.date_of_birth.isoformat() if client.date_of_birth else None,
        "sex": client.sex,
        "dietary_preference": client.dietary_preference or "Vegetarian",
        # Persisted coach-observed prefs (written by Intake form, profile
        # editor, and plan-chat client_patch). All free-form strings; pass
        # through as-is. The AI is instructed to treat foods_to_avoid as a
        # hard exclusion, non_negotiables as soft preference, and
        # reported_triggers as causal hypotheses to weight toward.
        "foods_to_avoid": getattr(client, "foods_to_avoid", None) or None,
        "non_negotiables": getattr(client, "non_negotiables", None) or None,
        "reported_triggers": getattr(client, "reported_triggers", None) or None,
        "active_conditions": client.active_conditions,
        "medical_history": client.medical_history,
        "current_medications": client.current_medications,
        "current_supplements": getattr(client, "current_supplements", None) or [],
        "known_allergies": client.known_allergies,
        # Functional-test findings parsed via parse-functional-test.py and
        # saved to ~/fm-plans/clients/<id>/functional_tests/<type>-<date>.yaml.
        # Previously the suggester never saw these — Nidhi's Sova/BugSpeaks
        # report with 7 flagged drivers (cryptosporidium, candida, absent
        # Lactobacillus, Prevotella dominance) produced a plan that barely
        # mentioned gut. Inject the parsed summaries so the AI can weight
        # them as primary drivers.
        "functional_test_findings": _load_functional_tests(root, client.client_id),
        # External reports (genetic / food sensitivity / OAT / imaging /
        # DEXA / etc.) uploaded via the Reports tab. parse-external-report.py
        # already extracts these to per-report YAML; until now the
        # extractions sat on disk but never fed back into the suggester.
        # Food-sensitivity reactive_foods in particular should be flowing
        # into nutrition.reduce and foods_to_avoid.
        "external_reports": _load_external_reports(root, client.client_id),
        # Genetic / rework suggestion (v0.62). When a genetic or rework
        # report is uploaded, assess-rework.py distils it into
        # client.rework_suggestion — structured `suggested_changes`
        # (op/target_kind/target_slug/reason) + a rationale. Until now this
        # was a coach-facing banner ONLY and never reached plan generation,
        # so a genetic report's whole intelligence (MTHFR → methylfolate,
        # GSTP1 → NAC, etc.) was invisible to the suggester. Feed it in so
        # the AI builds the genetics into the plan. See suggester rule 11z.
        "rework_suggestion": (
            {
                "triggered_by": _rw.get("triggered_by"),
                "rationale": _rw.get("rationale"),
                "suggested_changes": _rw.get("suggested_changes") or [],
            }
            if isinstance((_rw := getattr(client, "rework_suggestion", None)), dict)
            else None
        ),
        # Intake form depth — body systems, sleep depth, stress, COVID,
        # family-specific, environment, layered medication categories,
        # reproductive depth, past-history, readiness, weight history.
        # Each subsection is omitted when empty so the prompt stays lean
        # for sparse clients.
        "intake_extras": _build_intake_extras(client),
        "goals": client.goals,
        "notes": client.notes,
        "timeline_events": [
            {"year": e.year, "date": e.date, "event": e.event, "category": e.category}
            for e in (client.timeline_events or [])
        ],
        # AI-summarised intake insights (v0.72). Generated once by Haiku
        # after intake submit; flows into the assess pipeline so the
        # suggester's hypotheses start from the same map every downstream
        # AI call uses. Coach corrections via coach_notes_for_ai land here
        # without regenerating the rest. None when no intake on file yet.
        "intake_insights": (
            {
                "patterns": client.intake_insights.patterns,
                "red_flags": client.intake_insights.red_flags,
                "top_hypotheses": [
                    {
                        "driver": h.driver,
                        "confidence": h.confidence,
                        "reasoning": h.reasoning,
                    }
                    for h in client.intake_insights.top_hypotheses
                ],
                "verify_in_session": client.intake_insights.verify_in_session,
                "coach_notes_for_ai": client.intake_insights.coach_notes_for_ai,
            }
            if client.intake_insights
            else None
        ),
        # Measurements: prefer the legacy `measurements` sub-model when set
        # (richest history), otherwise fall back to the v2.3 top-level
        # intake fields (height_cm, weight_now_kg, waist_cm, hip_cm,
        # bp_systolic, bp_diastolic). Without this fallback the AI saw
        # null body-comp on every client who filled the new intake form
        # but hadn't been double-entered into the legacy block.
        "measurements": (lambda: {
            "height_cm": m.height_cm or getattr(client, "height_cm", None),
            "weight_kg": m.weight_kg or getattr(client, "weight_now_kg", None),
            "waist_cm": getattr(m, "waist_cm", None) or getattr(client, "waist_cm", None),
            "hip_cm": getattr(m, "hip_cm", None) or getattr(client, "hip_cm", None),
            "bmi": m.bmi,
            "waist_hip_ratio": m.waist_hip_ratio,
            "bmr_estimated_kcal_per_day": bmr,
            "resting_heart_rate": m.resting_heart_rate,
            "blood_pressure": (
                f"{m.blood_pressure_systolic}/{m.blood_pressure_diastolic}"
                if m.blood_pressure_systolic and m.blood_pressure_diastolic
                else (
                    f"{getattr(client, 'bp_systolic', None)}/{getattr(client, 'bp_diastolic', None)}"
                    if getattr(client, "bp_systolic", None) and getattr(client, "bp_diastolic", None)
                    else None
                )
            ),
            # Body-comp time series from the modal — coach logs entries
            # week-by-week. AI uses this to detect trends rather than
            # spot reads.
            "log": [
                {"date": e.get("date"), **{k: v for k, v in e.items() if k != "date" and v is not None}}
                for e in (getattr(client, "measurements_log", None) or [])
            ] or None,
        })(),
    }

    # Cycle context (women clients) — drives phase-synced nutrition + movement
    # in the AI assessment + plan letter generation. None for men, not_applicable,
    # or unset.
    try:
        cyc = client.cycle_context()
        if cyc:
            client_ctx["cycle_context"] = cyc
    except Exception:
        pass

    # IFM 7-node baseline — the coach's functional-medicine read across
    # assimilation / defense_repair / energy / biotransformation /
    # transport / communication / structural. Stored as an EXTRA field on
    # client.yaml; the Client Pydantic model uses extra="ignore", so it is
    # dropped from the `client` object — read it from the raw YAML and
    # inject it so synthesize() can anchor drivers to it. See suggester
    # prompt rule 13 (IFM BASELINE).
    try:
        _raw_client = yaml.safe_load(
            plan_storage.client_path(root, client_id).read_text()
        ) or {}
        _ifm = _raw_client.get("ifm_baseline")
        if isinstance(_ifm, dict) and _ifm.get("nodes"):
            client_ctx["ifm_baseline"] = _ifm
    except Exception:
        pass

    # ----- existing labs already on file --------------------------------
    # Without this, the AI re-orders tests that were done weeks ago because
    # it has no idea the values exist. Two surfaces feed in:
    #   1. client.lab_markers — most-recent FM-interpreted markers (one
    #      record per marker, with FM ranges + flag + value). Compact +
    #      decision-ready, this is what we surface as "known_labs".
    #   2. health_snapshots[].lab_values — every prior report's raw values
    #      indexed by date. We bundle the LAST 60 days' worth so the AI
    #      can also see freshness without ballooning the prompt.
    known_labs: list[dict] = []
    for m_lab in (client.lab_markers or []):
        known_labs.append({
            "marker_name": m_lab.get("marker_name"),
            "value": m_lab.get("value"),
            "unit": m_lab.get("unit"),
            "flag": m_lab.get("flag"),
            "reference_range": m_lab.get("reference_range"),
            "fm_interpretation": m_lab.get("fm_interpretation"),
        })
    if known_labs:
        client_ctx["known_labs"] = known_labs
        client_ctx["known_labs_date"] = (
            client.lab_markers_date if hasattr(client, "lab_markers_date") else None
        )

    # Recent raw snapshots — for cross-report comparison (e.g. ferritin
    # trend over 3 reports). Last 90 days only to keep prompt size in check.
    cutoff = (today - __import__("datetime").timedelta(days=90)).isoformat()
    recent_lab_history: list[dict] = []
    for snap in (client.health_snapshots or []):
        snap_date = snap.get("date") or ""
        if snap_date < cutoff:
            continue
        lvs = snap.get("lab_values") or []
        if not lvs:
            continue
        recent_lab_history.append({
            "date": snap_date,
            "source": snap.get("source"),
            "lab_values": [
                {"test_name": lv.get("test_name"), "value": lv.get("value"), "unit": lv.get("unit")}
                for lv in lvs
            ],
        })
    if recent_lab_history:
        client_ctx["recent_lab_history"] = recent_lab_history

    # Session-history bundle: compact prior-session summaries.
    #
    # synthesis_notes is trimmed to ~1500 chars per prior session. Coaches
    # were hitting "Failed to fetch" on clients with thorough prior assessments
    # (e.g. cl-007 had a 33 KB recent session) — the full ai_analysis bundle
    # made both the Anthropic input and the Server Action response large enough
    # to push beyond browser fetch timeouts. The first ~1500 chars carry enough
    # context for the model to "remember" the prior take without re-sending the
    # whole prior assessment.
    _SYNTH_TRIM = 1500
    _MSG_TRIM = 1200  # client_message preview per session
    _COACH_NOTES_TRIM = 2500  # coach_notes preview per session — the coach's
    # own observations (chief complaint, HPI, IFM baseline, family hx, mood /
    # body-language reads). Previously NOT passed to the AI at all — the most
    # valuable clinical signal was invisible to synthesize(). Generous trim
    # because this block is dense + high-value.
    # Strip leading [key: value] tag pairs (session_type, source, template,
    # type) that webhook + outbound code prepends to presenting_complaints.
    # We want the AI to read the actual message body, not the audit tags.
    _TAG_PREFIX_RE = re.compile(r"^(\s*\[[^\]]+\]\s*)+", re.MULTILINE)
    # Webhook-saved messages also carry a "WhatsApp message from <name>
    # (<phone>) Received: <ts>" envelope before the body. Strip that too —
    # the AI doesn't need provenance, just substance.
    _WEBHOOK_ENVELOPE_RE = re.compile(
        r"^WhatsApp message from [^\n]+\n+Received:[^\n]+\n+",
        re.IGNORECASE,
    )

    def _extract_client_message(complaints: str) -> str:
        if not complaints:
            return ""
        s = _TAG_PREFIX_RE.sub("", complaints).strip()
        s = _WEBHOOK_ENVELOPE_RE.sub("", s).strip()
        if len(s) > _MSG_TRIM:
            s = s[:_MSG_TRIM].rstrip() + " …[truncated]"
        return s

    prior = plan_storage.list_sessions(root, client.client_id)
    history_bundle = []
    for s in prior:
        ai = s.ai_analysis or {}
        notes = ai.get("synthesis_notes", "") or ""
        if len(notes) > _SYNTH_TRIM:
            notes = notes[:_SYNTH_TRIM].rstrip() + " …[truncated]"
        # Coach's own observations for this session — chief complaint, HPI,
        # IFM 7-node baseline, family history, "what worked", and the
        # section-11 mood / body-language / motivation reads. Passed to the
        # AI so synthesize() can weigh the coach's clinical intuition, not
        # just structured symptom slugs.
        coach_notes = (s.coach_notes or "") if hasattr(s, "coach_notes") else ""
        if len(coach_notes) > _COACH_NOTES_TRIM:
            coach_notes = coach_notes[:_COACH_NOTES_TRIM].rstrip() + " …[truncated]"
        # presenting_complaints carries either:
        #  - the coach's notes from a full session, OR
        #  - the raw WhatsApp body from a webhook-saved quick_note, OR
        #  - the rendered template body from an outbound send.
        # All three are useful to the AI between sessions — they're the
        # only place the client's voice + new symptoms / blockers live
        # for sessions that haven't been AI-analysed yet. Strip the audit
        # tags before passing.
        complaints_raw = (s.presenting_complaints or "") if hasattr(s, "presenting_complaints") else ""
        client_message = _extract_client_message(complaints_raw)
        # Tag the message channel so the AI can weight inbound client
        # voice differently from outbound coach sends.
        channel: str | None = None
        if "[source: whatsapp_webhook]" in complaints_raw:
            channel = "client_whatsapp"
        elif "[source: whatsapp_outbound]" in complaints_raw:
            channel = "coach_whatsapp"
        elif "[source: pre_session_brief]" in complaints_raw:
            channel = "coach_notes"
        elif client_message and not s.selected_symptoms and not s.selected_topics:
            channel = "coach_notes"

        history_bundle.append({
            "session_id": s.session_id,
            "date": s.date.isoformat(),
            "generated_plan_slug": s.generated_plan_slug,
            "selected_symptoms": s.selected_symptoms,
            "selected_topics": s.selected_topics,
            "drivers": [d.get("mechanism_slug") for d in (ai.get("likely_drivers") or [])],
            "supplements": [
                {"slug": sp.get("supplement_slug"), "dose": sp.get("dose")}
                for sp in (ai.get("supplement_suggestions") or [])
            ],
            "synthesis_notes": notes,
            "coach_notes": coach_notes,
            "client_message": client_message,
            "channel": channel,
        })

    # Calculate days_since_last_prescription from history_bundle
    days_since_last_prescription: int | None = None
    for s in reversed(history_bundle):
        if s.get("generated_plan_slug"):
            try:
                last_date = date.fromisoformat(s["date"])
                days_since_last_prescription = (today - last_date).days
            except Exception:
                pass
            break

    # Check for an existing session today (same-day reuse to avoid duplicates)
    existing_today_session: Session | None = None
    for s in prior:
        if s.date == today:
            existing_today_session = s
            # Use the most recent one from today
    existing_sid: str | None = existing_today_session.session_id if existing_today_session else None

    if dry_run:
        # Synthetic result parsed into typed model so both branches share
        # the same attribute-access interface below.
        from fmdb.assess.results import AssessSuggestions, AssessUsage
        synthetic = _synthetic_result(payload)
        suggestions = AssessSuggestions.model_validate(synthetic["suggestions"])
        usage = AssessUsage.model_validate(synthetic["usage"]).model_dump()
    else:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
            return 2

        # ── Re-run cache check (D.4) ───────────────────────────────────
        # Skip the ~$0.20 Sonnet call when the coach re-runs Analyze with
        # identical inputs (no symptom edits, no new uploads, no client
        # context change). Cache hit → return the previous AssessResult
        # verbatim from disk. Persists to ~/.fm-cache/assess/<key>.json.
        cache_key = _assess_cache_key(
            client_ctx=client_ctx,
            symptoms=symptoms,
            topics=topics,
            complaints=complaints,
            history_bundle=history_bundle,
            attachments=attachments,
        )
        cached = _load_cached_assess(cache_key)
        if cached is not None:
            from fmdb.assess.results import AssessSuggestions, AssessUsage
            try:
                suggestions = AssessSuggestions.model_validate(cached["suggestions"])
                usage = AssessUsage.model_validate(cached["usage"]).model_dump()
                usage["cache_hit"] = True
                usage["cache_key"] = cache_key
            except Exception:
                # Cache corrupted — fall through to live call.
                cached = None
        if cached is None:
            from fmdb.assess.suggester import synthesize
            try:
                result = synthesize(
                    client_context=client_ctx,
                    selected_symptom_slugs=symptoms,
                    selected_topic_slugs=topics,
                    subgraph=subgraph,
                    lab_files=lab_files,
                    additional_notes=complaints,
                    session_history=history_bundle,
                    days_since_last_prescription=days_since_last_prescription,
                    vitaone_inventory=_load_vitaone_inventory(),
                )
            except Exception as e:
                json.dump({"ok": False, "error": f"synthesize() failed: {type(e).__name__}: {e}"}, sys.stdout)
                return 1
            # `result` is an AssessResult Pydantic model with typed .suggestions.
            suggestions = result.suggestions
            usage = result.usage.model_dump()
            usage["cache_hit"] = False
            usage["cache_key"] = cache_key
            # Persist the AssessResult for next time. Best-effort.
            _save_assess_cache(
                cache_key,
                {
                    "suggestions": suggestions.model_dump(),
                    "usage": usage,
                },
            )
        try:
            from fmdb.usage import log_usage as _log_usage
            _log_usage(
                client_id=client_id,
                script="assess.py",
                model=usage.get("model"),
                usage=usage,
                notes=f"{len(symptoms)} symptoms, {len(topics)} conditions",
            )
        except Exception:
            pass

    # ----- compute FM lab ratios -----
    from fmdb.assess.lab_ratios import compute_ratios
    extracted_labs = [lab.model_dump() for lab in suggestions.extracted_labs]
    computed_ratios = compute_ratios(extracted_labs)

    # ----- persist lab_markers + per-report health snapshots to client YAML -----
    try:
        import yaml
        from datetime import datetime as _dt

        def _parse_report_date(d: object) -> str | None:
            """Convert 'DD/Mon/YYYY' (or ISO) to YYYY-MM-DD.  Returns None on failure."""
            if not d:
                return None
            import re as _re
            s = _re.sub(r"^(\d{1,2})/([A-Za-z]{3})/(\d{4})$", r"\2 \1 \3", str(d).strip())
            for fmt in ("%b %d %Y", "%Y-%m-%d", "%d/%m/%Y", "%b %Y", "%d-%b-%Y"):
                try:
                    return _dt.strptime(s, fmt).strftime("%Y-%m-%d")
                except ValueError:
                    pass
            return None

        client_p = plan_storage.client_path(root, client_id)
        raw_client = yaml.safe_load(client_p.read_text())

        # Save FM computed markers (most-recent values, already handled by _find)
        if computed_ratios:
            # Use the latest date_drawn across all extracted labs as the markers date
            all_dates = [_parse_report_date(l.get("date_drawn")) for l in extracted_labs]
            latest_report_date = max((d for d in all_dates if d), default=today.isoformat())
            raw_client["lab_markers"] = computed_ratios
            raw_client["lab_markers_date"] = latest_report_date

        # Build one health snapshot per distinct report date so health trends can
        # show how each marker changed between appointments.
        date_groups: dict[str, list[dict]] = {}
        undated: list[dict] = []
        for lab in extracted_labs:
            rd = _parse_report_date(lab.get("date_drawn"))
            if rd:
                date_groups.setdefault(rd, []).append(lab)
            else:
                undated.append(lab)

        # If there's only one date group (or none), fall back to a single
        # snapshot dated today so the data still appears on the timeline.
        if not date_groups and undated:
            date_groups[today.isoformat()] = undated

        existing_snaps: list = raw_client.get("health_snapshots") or []
        for report_date, labs in sorted(date_groups.items()):
            snap_source = f"lab-report-{report_date}"
            # Remove any previous snapshot for the same date+source, then re-add.
            existing_snaps = [
                s for s in existing_snaps
                if not (s.get("date") == report_date and s.get("source") == snap_source)
            ]
            import re as _re2
            # Strip date suffixes the AI appends to test names, e.g.
            # "TSH (Ultrasensitive) - Jan 2026" → "TSH (Ultrasensitive)"
            # so the trends chart groups them as one series across snapshots.
            _DATE_SUFFIX = _re2.compile(
                r"\s*[-–]\s*(?:\d{1,2}[/\-])?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
                r"[\s/\-]*\d{4}\s*$", _re2.IGNORECASE)
            snap_lab_values = [
                {
                    "test_name": _DATE_SUFFIX.sub("", l["test_name"]).strip(),
                    "value": str(l["value"]),
                    "unit": l.get("unit") or "",
                }
                for l in labs
            ]
            existing_snaps.append({
                "date": report_date,
                "source": snap_source,
                "lab_values": snap_lab_values,
            })

        raw_client["health_snapshots"] = existing_snaps
        client_p.write_text(yaml.safe_dump(raw_client, sort_keys=False, allow_unicode=True))
    except Exception:
        pass  # non-fatal — ratios still returned in the response

    # ----- persist session (reuse today's or create new) -----
    if existing_sid:
        # Update existing session for today
        try:
            sess = plan_storage.load_session(root, client_id, existing_sid)
            # Update the ai_analysis and related fields in-place
            from dataclasses import replace
            updated = Session(
                session_id=sess.session_id,
                client_id=sess.client_id,
                date=sess.date,
                created_at=sess.created_at,
                selected_symptoms=symptoms,
                selected_topics=topics,
                presenting_complaints=complaints,
                uploaded_files=file_refs if file_refs else sess.uploaded_files,
                measurements_snapshot=client.measurements,
                ai_analysis=suggestions.model_dump(),
                api_usage=usage,
                chat_log=sess.chat_log,
                generated_plan_slug=sess.generated_plan_slug,
                coach_notes=sess.coach_notes,
                next_session_planned=sess.next_session_planned,
                five_pillars=five_pillars_obj or sess.five_pillars,
            )
            plan_storage.update_session(root, updated)
            sid = existing_sid
        except Exception:
            # Fall through to creating a new session if update fails
            sid = plan_storage.next_session_id(root, client.client_id, today)
            sess = Session(
                session_id=sid,
                client_id=client.client_id,
                date=today,
                created_at=now,
                selected_symptoms=symptoms,
                selected_topics=topics,
                presenting_complaints=complaints,
                uploaded_files=file_refs,
                measurements_snapshot=client.measurements,
                ai_analysis=suggestions.model_dump(),
                api_usage=usage,
                five_pillars=five_pillars_obj,
            )
            try:
                plan_storage.write_session(root, sess)
            except FileExistsError:
                plan_storage.update_session(root, sess)
    else:
        sid = plan_storage.next_session_id(root, client.client_id, today)
        sess = Session(
            session_id=sid,
            client_id=client.client_id,
            date=today,
            created_at=now,
            selected_symptoms=symptoms,
            selected_topics=topics,
            presenting_complaints=complaints,
            uploaded_files=file_refs,
            measurements_snapshot=client.measurements,
            ai_analysis=suggestions.model_dump(),
            api_usage=usage,
            five_pillars=five_pillars_obj,
        )
        plan_storage.write_session(root, sess)

    json.dump({
        "ok": True,
        "session_id": sid,
        "suggestions": suggestions.model_dump(),
        "computed_ratios": computed_ratios,
        "usage": usage,
        "subgraph_size_bytes": subgraph_bytes,
        "error": None,
    }, sys.stdout, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
