#!/usr/bin/env python3
"""Client-facing intake form: token lifecycle + draft save + submission.

Reads JSON from stdin:
{
  "action": "generate" | "lookup" | "save_draft" | "submit" | "revoke",
  ...action-specific fields
}

Actions:

  generate {client_id, ttl_days?}
    → Generate a fresh URL-safe token, write to client.intake_token.
      Replaces any existing un-submitted token. Returns:
      {ok, token, expires_at, url_path}

  lookup {token}
    → Resolve token → client.yaml snapshot for prefilling the form.
      Refuses if token expired or already submitted.
      Returns: {ok, client_id, display_name, intake_form_draft, prefill: {...}}

  save_draft {token, draft}
    → Persist `draft` dict into client.intake_form_draft (overwrite).
      For save-per-section autosave.
      Returns: {ok, saved_at}

  submit {token, payload}
    → Final submit. Merges `payload` fields into client.yaml (additive on
      list fields, overwrite on scalars when payload has a non-empty value),
      writes the raw payload to a tagged quick_note session, sets
      intake_submitted_at, clears intake_token to revoke the link.
      Returns: {ok, client_id, fields_updated, session_id}

  revoke {client_id}
    → Coach manually invalidates the token. Returns: {ok}

Writes JSON to stdout:
  {ok: bool, ...action-specific fields, error?: str}
"""
from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Path to other scripts in the same dir — auto-insights fires via subprocess
# rather than importing so we don't drag generate-intake-insights' deps into
# this shim's module graph.
SCRIPT_DIR = Path(__file__).resolve().parent

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_yaml(client_id: str) -> Path:
    return _plans_root() / "clients" / client_id / "client.yaml"


def _load_client(client_id: str) -> dict:
    p = _client_yaml(client_id)
    if not p.exists():
        raise FileNotFoundError(f"client not found: {client_id}")
    import yaml  # type: ignore
    with p.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _save_client(client_id: str, data: dict) -> None:
    import yaml  # type: ignore
    p = _client_yaml(client_id)
    data["updated_at"] = _now_iso()
    data["updated_by"] = data.get("updated_by") or "intake-form"
    with p.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)


def _find_client_by_token(token: str) -> tuple[str, dict] | None:
    """Scan all clients/<id>/client.yaml for matching intake_token."""
    import yaml  # type: ignore
    clients_dir = _plans_root() / "clients"
    if not clients_dir.exists():
        return None
    for sub in clients_dir.iterdir():
        if not sub.is_dir():
            continue
        yml = sub / "client.yaml"
        if not yml.exists():
            continue
        try:
            with yml.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except Exception:
            continue
        if data.get("intake_token") == token:
            return data.get("client_id") or sub.name, data
    return None


# ── action: generate ─────────────────────────────────────────────────────────

def action_generate(payload: dict) -> dict:
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    ttl_days = int(payload.get("ttl_days") or 14)
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    token = secrets.token_urlsafe(24)  # ~32 chars URL-safe
    expires = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    data["intake_token"] = token
    data["intake_token_expires_at"] = expires.isoformat()
    # NB: do NOT clear `intake_submitted_at`. It is a historical event —
    # "this client submitted at least once." Previously this line set it
    # to None on every regenerate, which destroyed the UI's ability to
    # show two-stage state correctly (Nidhi case 2026-05-19: pre-
    # discovery submitted May 15 → coach unlocked full + regenerated
    # token May 18 → submitted_at went to null → IntakeProgressCard
    # then showed "⏰ Link expired before she submitted", which was
    # wrong — she'd submitted ages ago). The card now reads `_last`
    # for "most recent activity" and `intake_submitted_at` for "ever
    # submitted." Coach's explicit `finalise` is the only thing that
    # locks state; regenerating a link should never erase history.
    #
    # The token + expiry change alone is enough to re-open the form
    # for editing; we DON'T need to lie about submission status.
    # Enable the auto-reminder cron for this client — coach is actively
    # sending an intake link, so the daily nudge is appropriate until they
    # submit. Reset reminder history so the new token gets its own 2-strike
    # quota. Coach can disable per-client via the SendIntakeFormButton UI
    # (intake_reminder_enabled toggle).
    data["intake_reminder_enabled"] = True
    data["intake_reminders_sent_at"] = []
    # v0.75 — DO NOT auto-flip engagement_status here. Sending an intake
    # link used to imply signup, but with the two-stage form (pre-discovery
    # → full), generating a token can happen BEFORE the discovery call (so
    # coach has data going in) and the client may not actually convert.
    # Coach flips engagement_status manually via the EngagementPicker after
    # the discovery call; unlock_full_intake() handles the signup transition.
    #
    # EXCEPTION — `unlock_full=True`: for direct signups (referrals, returning
    # clients, family-of-existing, anyone who's already committed and skips
    # the discovery call). Stamps intake_full_unlocked_at + engagement
    # signed_up in the same atomic write so the token they receive serves
    # the full form on first open.
    unlock_full = bool(payload.get("unlock_full"))
    if unlock_full:
        if not data.get("intake_full_unlocked_at"):
            data["intake_full_unlocked_at"] = _now_iso()
        data["engagement_status"] = "signed_up"
    _save_client(client_id, data)

    return {
        "ok": True,
        "unlock_full": unlock_full,
        "token": token,
        "expires_at": expires.isoformat(),
        "url_path": f"/intake/{token}",
    }


# ── action: lookup ───────────────────────────────────────────────────────────

def _prefill_from_client(data: dict) -> dict:
    """Subset of client.yaml safe to send to the public form. Avoids leaking
    things like AI rework_suggestion or unrelated provenance."""
    return {
        "display_name": data.get("display_name") or "",
        "date_of_birth": str(data.get("date_of_birth") or ""),
        "sex": data.get("sex") or "",
        "email": data.get("email") or "",
        "mobile_number": data.get("mobile_number") or "",
        "city": data.get("city") or "",
        "country": data.get("country") or "",
        # Allow coach pre-fill to flow if she's started a stub
        "active_conditions": data.get("active_conditions") or [],
        "medical_history": data.get("medical_history") or [],
        "current_medications": data.get("current_medications") or [],
        "known_allergies": data.get("known_allergies") or [],
        "goals": data.get("goals") or [],
        "dietary_preference": data.get("dietary_preference") or "",
        "animal_derived_supplements_ok": data.get("animal_derived_supplements_ok") or "",
        "foods_to_avoid": data.get("foods_to_avoid") or "",
        "non_negotiables": data.get("non_negotiables") or "",
        "family_history": data.get("family_history") or "",
    }


def action_lookup(payload: dict) -> dict:
    token = (payload.get("token") or "").strip()
    if not token:
        return {"ok": False, "error": "token required"}
    hit = _find_client_by_token(token)
    if hit is None:
        return {"ok": False, "error": "invalid_or_expired", "message": "Link not found or already used."}
    client_id, data = hit
    # PATH A: previously-submitted intakes can still be re-opened for editing
    # until the coach explicitly finalises. The form copy promises this
    # ("you can keep editing until our session begins") so the lookup must
    # honour it. Only refuse if coach has explicitly locked.
    if data.get("intake_finalised_at"):
        return {"ok": False, "error": "locked", "message": "Form locked by your coach. Contact them to reopen if needed."}
    expires_iso = data.get("intake_token_expires_at")
    if expires_iso:
        try:
            exp = datetime.fromisoformat(str(expires_iso))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > exp:
                return {"ok": False, "error": "expired", "message": "Link expired. Contact your coach for a new one."}
        except Exception:
            pass
    # Stamp first-opened timestamp — once. Lets coach see on the client
    # Overview "client opened the form" vs "still hasn't clicked the
    # link". Subsequent reopens (e.g. client comes back to edit a draft)
    # don't overwrite this; the saved-draft timestamp covers that.
    if not data.get("intake_first_opened_at"):
        data["intake_first_opened_at"] = _now_iso()
        try:
            _save_client(client_id, data)
        except Exception:
            # Best effort — even if we can't persist, the lookup itself
            # should succeed (the client is staring at a loading form).
            pass
    # v0.75 — two-stage form gate. If the coach has unlocked the full intake
    # (typically after package signup), serve the full form. Otherwise serve
    # the lighter pre-discovery form.
    #
    # Belt-and-braces: if the client is already marked signed_up but the
    # full-intake gate wasn't explicitly flipped (e.g. coach used the
    # EngagementPicker but forgot the unlock button, or marked signup
    # AFTER issuing a pre-discovery token), treat them as full. Avoids
    # the bug where a signed-up client opens their old link and gets
    # the pre-discovery form by mistake.
    is_signed_up = (data.get("engagement_status") or "").lower() == "signed_up"
    stage = "full" if (data.get("intake_full_unlocked_at") or is_signed_up) else "pre_discovery"
    # v0.75.4 — `previously_submitted` lets the full intake show a
    # "welcome back" banner instead of "Begin" when a client returns
    # after submitting pre-discovery. The data they shared is preserved
    # in client.yaml (and surfaced as `prefill` below).
    previously_submitted = bool(data.get("intake_submitted_at"))
    return {
        "ok": True,
        "client_id": client_id,
        "display_name": data.get("display_name") or "",
        "intake_form_draft": data.get("intake_form_draft") or {},
        "prefill": _prefill_from_client(data),
        "stage": stage,
        "previously_submitted": previously_submitted,
    }


# ── action: save_draft ───────────────────────────────────────────────────────

def action_save_draft(payload: dict) -> dict:
    token = (payload.get("token") or "").strip()
    draft = payload.get("draft") or {}
    if not token:
        return {"ok": False, "error": "token required"}
    if not isinstance(draft, dict):
        return {"ok": False, "error": "draft must be an object"}
    hit = _find_client_by_token(token)
    if hit is None:
        return {"ok": False, "error": "invalid_or_expired"}
    client_id, data = hit
    # PATH A: still-editable until coach finalises (see action_lookup).
    if data.get("intake_finalised_at"):
        return {"ok": False, "error": "locked"}
    saved_at = _now_iso()
    data["intake_form_draft"] = draft
    data["intake_form_draft_saved_at"] = saved_at
    _save_client(client_id, data)
    return {"ok": True, "saved_at": saved_at}


# ── action: submit ───────────────────────────────────────────────────────────

# Fields that map 1:1 from form payload → client.yaml (overwrite when payload
# has a non-empty value, otherwise keep existing).
_SCALAR_FIELDS = [
    "display_name",
    "date_of_birth",
    "sex",
    "email",
    "mobile_number",
    "address_line1", "address_line2", "city", "state", "pincode", "country",
    "dietary_preference", "animal_derived_supplements_ok",
    "foods_to_avoid", "non_negotiables", "reported_triggers",
    "family_history",
    # Deep clinical narrative fields
    "digestion_notes", "sleep_notes", "energy_pattern", "menstrual_notes",
    "stress_response", "childhood_history", "toxic_exposures",
    "what_has_worked", "what_hasnt_worked",
    # Cycle / pregnancy
    "cycle_status", "cycle_regularity",
    "pregnancy_status",
    "notes",
    # ── v0.72 intake additions: scalar (text + radio = single string) ──
    "weight_trend_current", "weight_change_trigger",
    "covid_vaccine_reaction_detail",
    "cold_heat_tolerance",
    "time_to_fall_asleep", "snore_or_apnoea", "restless_legs",
    "cgm_owned", "caffeine_dependency", "morning_state",
    "hair_loss_pattern", "hair_texture_change",
    "belly_fat_pattern",
    "period_pain_impact", "pmdd_signs",
    "sun_exposure_daily", "sunscreen_use", "vit_d_supplement", "barefoot_outdoors",
    "recent_labs_when", "willing_to_share_labs", "willing_to_test_further",
    "bowel_historical",
    # ── v0.75.2 Tier 1 screening scalars ──
    "lean_test_supine_hr", "lean_test_standing_hr",
    "large_fish_frequency",
]

# Date-typed scalars — same overwrite rules but cast through ISO.
_DATE_FIELDS = [
    "last_menstrual_period",
    "pregnancy_due_date",
    "lactation_started",
    "menopause_started",
]

# Int scalars
_INT_FIELDS = [
    "cycle_length_days",
    # ── v0.72 intake additions ──
    "bowel_frequency_per_day",
    "period_pain_severity",       # 1-10 slider
    "readiness_confidence",       # 1-10 slider
]

# Float scalars (kg measurements)
_FLOAT_FIELDS = [
    "weight_highest_adult", "weight_lowest_adult",
]

# List fields — merged additively (case-insensitive dedup).
_LIST_FIELDS = [
    "active_conditions",
    "medical_history",
    "current_medications",
    "known_allergies",
    "goals",
]

# v0.72 chip-array fields — same merge rules as _LIST_FIELDS but listed
# separately for clarity since they're all client-form additions.
_INTAKE_LIST_FIELDS = [
    "work_pattern",
    "family_specific_conditions",
    "covid_history", "covid_long_symptoms",
    "covid_vaccine_history", "covid_vaccine_brand", "covid_vaccine_reactions",
    "postprandial_pattern",
    "wake_time_pattern", "sleep_tracker_owned", "energy_crashes",
    "bowel_pattern", "hair_other", "nail_signs",
    "acne_pattern", "skin_signs",
    "pain_locations", "headache_type", "pain_pattern", "pain_quality",
    "histamine_signals", "chemical_sensitivity", "oral_signs",
    "repro_diagnoses", "perimenopause_inventory",
    "recent_labs_done",
    # ── v0.75.2 Tier 1 screening chip-arrays ──
    "beighton_self_score", "beighton_supplemental",
    "hr_devices_owned", "lean_test_symptoms",
    "pem_screen", "mould_exposure",
    # ── v0.75.5 Tier 2 screening chip-arrays ──
    "ace_signals", "stop_bang_signals", "endometriosis_signals",
]

# Int-array fields (Bristol type can be 1-7, multi-tick)
_INTAKE_INT_LIST_FIELDS = ["bristol_stool_typical"]

# Repeater fields — list of structured dicts. Overwrite-on-submit (not
# additive merge) because the form is the source of truth for these.
_INTAKE_REPEATER_FIELDS = [
    "contraception_history",       # list[ContraceptionEntry]
    "pregnancies",                 # list[PregnancyEntry]
    "glp1_medications",
    "acid_suppressants",
    "nsaids_daily",
    "antibiotics_last_12mo",
    "hormonal_contraception_hrt",
    "thyroid_medication",
    "psych_medications",
    "biologics_immunosuppressants",
    "statins_bp_diabetes",
]


def _merge_lists(existing: list[str] | None, incoming: list[str] | None) -> tuple[list[str], bool]:
    existing = existing or []
    incoming = [str(x).strip() for x in (incoming or []) if str(x).strip()]
    if not incoming:
        return existing, False
    lower = {e.lower() for e in existing}
    added = [x for x in incoming if x.lower() not in lower]
    if not added:
        return existing, False
    return existing + added, True


_DRUG_INDEX_CACHE: dict | None = None


def _build_drug_index() -> dict:
    """Load drug_depletions catalogue once + build alias → entry index.

    Returns a dict of:
      {
        'aliases': { lowercase_alias_or_name: drug_dict, ... },
        'all': [drug_dict, ...],
      }
    Falls back to empty dict on any IO error — handler must work even if
    catalogue is unreadable.
    """
    global _DRUG_INDEX_CACHE
    if _DRUG_INDEX_CACHE is not None:
        return _DRUG_INDEX_CACHE
    import yaml  # type: ignore
    out_aliases: dict = {}
    out_all: list = []
    try:
        cat_dir = FMDB_ROOT / "data" / "drug_depletions"
        if cat_dir.exists():
            for p in cat_dir.glob("*.yaml"):
                try:
                    with p.open() as f:
                        d = yaml.safe_load(f) or {}
                except Exception:
                    continue
                if not isinstance(d, dict):
                    continue
                name = (d.get("drug_name") or "").strip()
                aliases = [name] + [str(a) for a in (d.get("drug_aliases") or [])]
                for a in aliases:
                    a = (a or "").strip().lower()
                    if a and a not in out_aliases:
                        out_aliases[a] = d
                out_all.append(d)
    except Exception:
        pass
    _DRUG_INDEX_CACHE = {"aliases": out_aliases, "all": out_all}
    return _DRUG_INDEX_CACHE


def _match_drug(med_text: str) -> dict | None:
    """Substring-match a medication free-text string against the catalogue
    alias index. Longest alias wins to avoid 'metformin' inside 'metformin xr'
    matching the shorter entry when a more specific one exists.
    """
    idx = _build_drug_index()
    text = (med_text or "").lower()
    best: tuple[int, dict] | None = None
    for alias, drug in idx["aliases"].items():
        if alias and alias in text:
            if best is None or len(alias) > best[0]:
                best = (len(alias), drug)
    return best[1] if best else None


def _derive_conditions_from_intake(payload: dict) -> list[str]:
    """Infer present diseases from medications + goals + form signals.

    Two-stage lookup:

    1. CATALOGUE lookup (preferred) — scan client.current_medications and
       all medication repeater fields against drug_depletions/*.yaml.
       Each matching drug contributes its condition_implications[].label
       (gated by confidence: high → definite, moderate → "suspected …",
       low → ignored).

    2. FALLBACK heuristics — for free-text fields with no drug match
       (goals, chief_complaint), keep the original keyword rules so we
       still catch "high HbA1c", "high BP" etc. mentioned in prose.
    """
    out: list[str] = []

    def add(label: str) -> None:
        if not any(c.lower() == label.lower() for c in out):
            out.append(label)

    # ── Stage 1: catalogue-driven drug → condition lookup ──
    def _collect_med_strings(payload: dict) -> list[str]:
        """Flatten all medication-bearing fields into a list of strings."""
        strs: list[str] = []
        med_fields = (
            "current_medications", "medications",
            "glp1_medications", "acid_suppressants", "nsaids_daily",
            "antibiotics_last_12mo", "hormonal_contraception_hrt",
            "thyroid_medication", "psych_medications",
            "biologics_immunosuppressants", "statins_bp_diabetes",
        )
        for fld in med_fields:
            v = payload.get(fld) or []
            if isinstance(v, list):
                for entry in v:
                    if isinstance(entry, dict):
                        s = (entry.get("name") or "").strip()
                        if s: strs.append(s)
                    elif entry:
                        strs.append(str(entry))
        return strs

    try:
        med_strings = _collect_med_strings(payload)
        for med_text in med_strings:
            drug = _match_drug(med_text)
            if not drug:
                continue
            for impl in (drug.get("condition_implications") or []):
                conf = (impl.get("confidence") or "moderate").lower()
                if conf == "low":
                    continue  # too non-specific to auto-populate
                label = (impl.get("label") or "").strip()
                if not label:
                    continue
                if conf == "moderate":
                    label = f"Suspected: {label}"
                add(label)
    except Exception as e:
        print(f"[intake-token-action] catalogue drug lookup failed: {e}", file=sys.stderr)

    def med_names(field: str) -> str:
        v = payload.get(field) or []
        if not isinstance(v, list):
            return ""
        parts = []
        for entry in v:
            if isinstance(entry, dict):
                parts.append(str(entry.get("name") or ""))
            else:
                parts.append(str(entry))
        return " | ".join(parts).lower()

    # Free-text fields where the client may describe their condition
    goals_text = " ".join(payload.get("goals") or []).lower() if isinstance(payload.get("goals"), list) else str(payload.get("goals") or "").lower()
    chief = (payload.get("chief_complaint") or "").lower()
    notes = (payload.get("notes") or "").lower()
    free_text = " ".join([goals_text, chief, notes])

    # Aggregated med strings per category
    bp_diab = med_names("statins_bp_diabetes")
    thyroid = med_names("thyroid_medication")
    glp1 = med_names("glp1_medications")
    psych = med_names("psych_medications")
    biologics = med_names("biologics_immunosuppressants")
    hrt = med_names("hormonal_contraception_hrt")
    acid = med_names("acid_suppressants")
    current = " ".join(payload.get("current_medications") or []).lower() if isinstance(payload.get("current_medications"), list) else str(payload.get("current_medications") or "").lower()
    all_meds = " | ".join([bp_diab, thyroid, glp1, psych, biologics, hrt, acid, current])

    DIABETES_KEYS = (
        "metformin", "janumet", "januvia", "sitagliptin", "glipizide",
        "glimepiride", "gliclazide", "pioglitazone", "vildagliptin",
        "linagliptin", "saxagliptin", "empagliflozin", "dapagliflozin",
        "canagliflozin", "insulin glargine", "humalog", "lantus",
        " insulin ", " insulin,", " insulin/", "insulin pen",
        "for diabetes", "diabetes med", "diabetic med",
    )
    if any(k in all_meds for k in DIABETES_KEYS):
        add("Diabetes")
    if glp1.strip():  # any GLP1 entry present → likely diabetes or obesity
        if "ozempic" in glp1 or "mounjaro" in glp1 or "tirzepatide" in glp1 or "semaglutide" in glp1 or "wegovy" in glp1 or "saxenda" in glp1:
            add("Diabetes" if "diabetes" in (goals_text + chief) else "Obesity")
    if any(k in free_text for k in ("diabet", "hba1c", "blood sugar", "sugar med", "sugar is high", "fasting glucose")):
        add("Diabetes")

    STATIN_KEYS = ("atorvastatin", "rosuvastatin", "simvastatin", "pitavastatin", "lovastatin", "pravastatin", " statin", "fenofibrate", "ezetimibe")
    if any(k in all_meds for k in STATIN_KEYS):
        add("Dyslipidaemia")
    if any(k in free_text for k in ("high cholesterol", "dyslipid", "ldl is high", "triglycerides")):
        add("Dyslipidaemia")

    BP_KEYS = (
        "telmisartan", "olmesartan", "losartan", "valsartan", "candesartan",
        "amlodipine", "nifedipine", "cilnidipine",
        "ramipril", "enalapril", "lisinopril", "perindopril",
        "metoprolol", "bisoprolol", "atenolol", "carvedilol", "nebivolol",
        "hydrochlorothiazide", "indapamide", "chlorthalidone",
        "for bp", "for blood pressure", "dilnip", "telma", "amlong",
    )
    if any(k in all_meds for k in BP_KEYS):
        add("Hypertension")
    if any(k in free_text for k in ("hypertens", "high bp", "blood pressure med")):
        add("Hypertension")

    if thyroid.strip() or any(k in all_meds for k in ("levothyroxine", "eltroxin", "thyronorm", "synthroid", "liothyronine", "armour")):
        add("Hypothyroidism")
    if any(k in free_text for k in ("hashimoto", "hypothyroid", "thyroid is")):
        add("Hypothyroidism")

    if biologics.strip():
        add("Autoimmune disease (on immunomodulator)")
    if psych.strip() or any(k in all_meds for k in ("sertraline", "fluoxetine", "escitalopram", "venlafaxine", "duloxetine", "mirtazapine", "bupropion", " ssri", " snri")):
        add("Anxiety/Depression (on treatment)")
    if acid.strip() or any(k in all_meds for k in ("pantoprazole", "omeprazole", "esomeprazole", "rabeprazole", "lansoprazole", " ppi", "ranitidine", "famotidine")):
        add("Acid reflux / GERD")

    # Cycle / menopause status from explicit form field
    cs = (payload.get("cycle_status") or "").lower()
    if cs in ("postmenopausal", "surgical_menopause"):
        add("Postmenopausal")
    elif cs == "perimenopausal":
        add("Perimenopausal")

    return out


def _derive_symptoms_from_intake(payload: dict) -> list[str]:
    """Map structured intake-form signals to symptom catalogue slugs.

    The intake form has rich symptom-like signals scattered across structured
    fields (pain_locations, pain_quality, hair_loss_pattern, bristol stool,
    wake_time_pattern, etc.). Without this mapping, the coach lands on the
    Full Assessment page with `selected_symptoms: []` and has to re-enter
    everything the client already reported.

    We map only to slugs known to exist in the catalogue. Conservative on
    purpose — better to miss a symptom than to emit broken slugs the
    validator rejects.
    """
    out: list[str] = []

    def add(slug: str) -> None:
        if slug not in out:
            out.append(slug)

    def has(field: str, value: str) -> bool:
        v = payload.get(field) or []
        if isinstance(v, list):
            return any(str(x).lower().strip() == value.lower() for x in v)
        if isinstance(v, str):
            return v.lower().strip() == value.lower()
        return False

    def has_substr(field: str, substr: str) -> bool:
        v = payload.get(field) or []
        if isinstance(v, list):
            return any(substr.lower() in str(x).lower() for x in v)
        if isinstance(v, str):
            return substr.lower() in v.lower()
        return False

    # ── Pain: quality + location ──
    pq = payload.get("pain_quality") or []
    if isinstance(pq, list):
        pql = [str(x).lower() for x in pq]
        if any("pins and needles" in q or "tingling" in q or "numb" in q for q in pql):
            add("numbness-tingling")
        if any("stiff" in q for q in pql):
            add("joint-stiffness-and-swelling")
        if any("ache" in q or "dull" in q for q in pql):
            add("joint-pain")
    # If pain_locations populated at all (any body region), surface joint-pain
    pl = payload.get("pain_locations") or []
    if isinstance(pl, list) and len(pl) > 0 and "joint-pain" not in out:
        add("joint-pain")
    if has_substr("pain_pattern", "wakes me at night"):
        add("sleep-disruption")

    # ── Sleep ──
    wt = payload.get("wake_time_pattern") or []
    if isinstance(wt, list):
        wtl = [str(x).lower() for x in wt]
        if any("3am" in w or "wake around" in w or "consistently" in w for w in wtl):
            add("insomnia")
        if any("urinate" in w or "urinat" in w for w in wtl):
            add("nocturia")
    if has("time_to_fall_asleep", "30_60") or has("time_to_fall_asleep", "over_60"):
        add("insomnia")

    # ── Energy / fatigue (uses daytime-fatigue, lethargy aliases "fatigue") ──
    ep = (payload.get("energy_pattern") or "").lower()
    if "slump" in ep or "crash" in ep or "tired" in ep or "fatigue" in ep:
        add("daytime-fatigue")
    if has_substr("energy_crashes", "afternoon") or has_substr("energy_crashes", "post-meal"):
        add("daytime-fatigue")

    # ── GI ──
    bs = payload.get("bristol_stool_typical") or []
    if isinstance(bs, list):
        # Bristol 6 or 7 = loose / diarrhea; 1 or 2 = constipation
        if any(int(x) in (6, 7) for x in bs if str(x).isdigit()):
            add("diarrhea")
    dn = (payload.get("digestion_notes") or "").lower()
    if "loose" in dn or "loosie" in dn or "diarrh" in dn:
        add("diarrhea")
    if "bloat" in dn:
        add("bloating")

    # ── Hair / skin / oral ──
    if has("hair_loss_pattern", "diffuse_thinning") or has("hair_loss_pattern", "patchy"):
        add("hair-loss")
    if has_substr("hair_other", "facial hair"):
        add("facial-hair")
    if has_substr("oral_signs", "white coating"):
        add("white-tongue-coating")

    # ── Urinary ──
    if has_substr("wake_time_pattern", "urinate"):
        add("frequent-urination")

    # ── Mood / stress ──
    sr = (payload.get("stress_response") or "").lower()
    if "shut down" in sr or "overwhelm" in sr or "anxio" in sr:
        add("stress-sensitivity")

    return out


def _write_quick_note_session(client_id: str, payload: dict) -> str:
    """Append a tagged session capturing the raw intake payload for audit."""
    import yaml  # type: ignore
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sessions_dir = _plans_root() / "clients" / client_id / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    # Pick next NNN suffix for today
    existing = sorted(sessions_dir.glob(f"{today}-*.yaml"))
    suffix = len(existing) + 1
    session_id = f"{today}-{suffix:03d}-intake-form"
    yml = sessions_dir / f"{session_id}.yaml"
    # Compact summary line for human scanning
    summary_lines = []
    for k in ["digestion_notes", "sleep_notes", "energy_pattern",
              "stress_response", "what_has_worked", "what_hasnt_worked"]:
        v = (payload.get(k) or "").strip()
        if v:
            summary_lines.append(f"**{k.replace('_', ' ').title()}** — {v[:300]}")
    coach_notes = "[source: client_intake_form]\n\n" + "\n\n".join(summary_lines or ["(no narrative fields filled)"])

    derived_symptoms = _derive_symptoms_from_intake(payload)
    session_data = {
        "session_id": session_id,
        "client_id": client_id,
        "date": today,
        "session_type": "quick_note",
        "presenting_complaints": "[source: client_intake_form] Client-submitted intake questionnaire.",
        "coach_notes": coach_notes,
        "selected_symptoms": derived_symptoms,
        "selected_topics": [],
        "uploaded_files": [],
        "measurements_snapshot": payload.get("measurements") or {},
        "ai_analysis": {"raw_intake_payload": payload},
        "chat_log": [],
        "generated_plan_slug": None,
        "five_pillars": payload.get("five_pillars") or None,
        "version": 1,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "updated_by": "intake-form",
    }
    with yml.open("w", encoding="utf-8") as f:
        yaml.safe_dump(session_data, f, sort_keys=False, allow_unicode=True)
    return session_id


def action_submit(payload_in: dict) -> dict:
    """Submit intake. PATH A behaviour (2026-05-15): submit is NOT final.
    The form copy promises the client they can keep editing until the
    appointment, so re-submits are allowed and overwrite previous values.
    The token stays active until either (a) coach calls action_finalise,
    (b) intake_token_expires_at passes, or (c) the intake-token's TTL
    is naturally exhausted.

    Tracks:
      - intake_submitted_at — first submit only (used by UI to show "✓ Form
        submitted on ..." pill)
      - intake_last_submitted_at — every submit (used by cron auto-reminder
        to skip clients who edited within the last 7d)

    Fires auto-insights at the end if ANTHROPIC_API_KEY is set."""
    token = (payload_in.get("token") or "").strip()
    submitted = payload_in.get("payload") or {}
    if not token:
        return {"ok": False, "error": "token required"}
    if not isinstance(submitted, dict):
        return {"ok": False, "error": "payload must be an object"}
    hit = _find_client_by_token(token)
    if hit is None:
        return {"ok": False, "error": "invalid_or_expired"}
    client_id, data = hit
    # No more "already_submitted" early-return — Path A allows re-submit.
    # Coach's explicit finalise action is what locks the form.
    is_finalised = bool(data.get("intake_finalised_at"))
    if is_finalised:
        return {"ok": False, "error": "intake_locked_by_coach"}
    is_first_submit = not data.get("intake_submitted_at")

    fields_updated: list[str] = []

    # ── scalar fields ──
    for field in _SCALAR_FIELDS:
        if field in submitted:
            new_val = submitted.get(field)
            if isinstance(new_val, str):
                new_val = new_val.strip()
            if new_val:  # non-empty wins
                if data.get(field) != new_val:
                    data[field] = new_val
                    fields_updated.append(field)

    # ── date fields ── (store as ISO string; Pydantic Optional[date] will coerce on load)
    for field in _DATE_FIELDS:
        if field in submitted:
            v = (submitted.get(field) or "").strip() if isinstance(submitted.get(field), str) else None
            if v:
                data[field] = v
                fields_updated.append(field)

    # ── int fields ──
    for field in _INT_FIELDS:
        if field in submitted and submitted[field] not in (None, ""):
            try:
                v = int(submitted[field])
                data[field] = v
                fields_updated.append(field)
            except (TypeError, ValueError):
                pass

    # ── float fields (kg / measurements) ──
    for field in _FLOAT_FIELDS:
        if field in submitted and submitted[field] not in (None, ""):
            try:
                v = float(submitted[field])
                data[field] = v
                fields_updated.append(field)
            except (TypeError, ValueError):
                pass

    # ── list fields (additive merge — case-insensitive dedup) ──
    for field in _LIST_FIELDS:
        if field in submitted:
            merged, changed = _merge_lists(data.get(field), submitted.get(field))
            if changed:
                data[field] = merged
                fields_updated.append(field)

    # ── v0.72 chip-array fields (overwrite on submit — form is source of
    # truth for these, not additive like legacy condition lists). Form
    # submitting empty array clears the field; not submitting the field
    # leaves it alone. ──
    for field in _INTAKE_LIST_FIELDS:
        if field in submitted:
            incoming = submitted.get(field)
            if isinstance(incoming, list):
                cleaned = [str(x).strip() for x in incoming if str(x).strip()]
                if data.get(field) != cleaned:
                    data[field] = cleaned
                    fields_updated.append(field)

    # ── int-array fields (Bristol type 1-7 multi) ──
    for field in _INTAKE_INT_LIST_FIELDS:
        if field in submitted:
            incoming = submitted.get(field)
            if isinstance(incoming, list):
                cleaned: list[int] = []
                for x in incoming:
                    try:
                        n = int(x)
                        if 1 <= n <= 7:
                            cleaned.append(n)
                    except (TypeError, ValueError):
                        pass
                cleaned = sorted(set(cleaned))   # dedup + sort
                if data.get(field) != cleaned:
                    data[field] = cleaned
                    fields_updated.append(field)

    # ── repeater fields (medication category entries, contraception,
    # pregnancies). Form submits a list of dicts; we accept it verbatim
    # after light validation. Source of truth = form on submit. ──
    for field in _INTAKE_REPEATER_FIELDS:
        if field in submitted:
            incoming = submitted.get(field)
            if isinstance(incoming, list):
                # Filter out empty rows (no meaningful content). Each repeater
                # has its own "is this row blank?" heuristic, but a safe
                # generic: skip rows that are entirely empty/None values.
                cleaned_rows: list[dict] = []
                for row in incoming:
                    if not isinstance(row, dict):
                        continue
                    # Keep the row if any value is truthy / non-empty.
                    if any(v not in (None, "", [], {}) for v in row.values()):
                        cleaned_rows.append(row)
                if data.get(field) != cleaned_rows:
                    data[field] = cleaned_rows
                    fields_updated.append(field)

    # ── timeline events (additive merge by event-text dedup) ──
    incoming_timeline = submitted.get("timeline_events") or []
    if isinstance(incoming_timeline, list) and incoming_timeline:
        existing_timeline = data.get("timeline_events") or []
        existing_keys = {(str(t.get("year") or ""), (t.get("event") or "").lower().strip())
                         for t in existing_timeline if isinstance(t, dict)}
        added = 0
        for ev in incoming_timeline:
            if not isinstance(ev, dict):
                continue
            text = (ev.get("event") or "").strip()
            if not text:
                continue
            key = (str(ev.get("year") or ""), text.lower())
            if key in existing_keys:
                continue
            existing_timeline.append({
                "year": ev.get("year"),
                "date": ev.get("date") or None,
                "event": text,
                "category": ev.get("category") or "life_event",
            })
            existing_keys.add(key)
            added += 1
        if added:
            data["timeline_events"] = existing_timeline
            fields_updated.append("timeline_events")

    # ── measurements (overwrite individual fields when provided) ──
    incoming_meas = submitted.get("measurements") or {}
    if isinstance(incoming_meas, dict) and incoming_meas:
        existing_meas = data.get("measurements") or {}
        meas_keys = ["height_cm", "weight_kg", "waist_cm", "hip_cm",
                     "blood_pressure_systolic", "blood_pressure_diastolic",
                     "resting_heart_rate"]
        meas_changed = False
        for k in meas_keys:
            v = incoming_meas.get(k)
            if v not in (None, "", 0):
                try:
                    existing_meas[k] = float(v) if "." in str(v) or k in ("height_cm", "weight_kg", "waist_cm", "hip_cm") else int(v)
                    meas_changed = True
                except (TypeError, ValueError):
                    pass
        if meas_changed:
            existing_meas["measured_on"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            existing_meas["notes"] = ((existing_meas.get("notes") or "") +
                                      " [auto-captured from client_intake_form]").strip()
            data["measurements"] = existing_meas
            fields_updated.append("measurements")

    # ── five pillars (overwrite if any non-null values) ──
    # Form uses friendlier short keys; the Pydantic FivePillarsAssessment
    # model uses verbose ones. Remap before writing so the client.yaml
    # round-trips through Client(**yaml) without ValidationError.
    _FP_KEY_MAP = {
        "stress": "stress_level",
        "movement_days": "movement_days_per_week",
    }
    _FP_ALLOWED = {
        "sleep_quality", "sleep_hours", "sleep_notes",
        "stress_level", "stress_type", "stress_notes",
        "movement_days_per_week", "movement_type", "movement_intensity",
        "nutrition_quality", "nutrition_notes",
        "connection_quality", "connection_notes",
        "notes",
    }
    incoming_fp = submitted.get("five_pillars") or {}
    if isinstance(incoming_fp, dict) and any(v not in (None, "") for v in incoming_fp.values()):
        remapped: dict = {}
        for k, v in incoming_fp.items():
            mapped = _FP_KEY_MAP.get(k, k)
            if mapped in _FP_ALLOWED:
                remapped[mapped] = v
        if remapped:
            data["five_pillars"] = remapped
            fields_updated.append("five_pillars")

    # ── auto-derive active_conditions from medications + goals ──
    # Clients often don't tick the conditions checkbox even when they're
    # on the literal medication. Union-merge so we never overwrite what
    # the client explicitly ticked.
    try:
        derived_conditions = _derive_conditions_from_intake(submitted)
        if derived_conditions:
            merged, changed = _merge_lists(data.get("active_conditions"), derived_conditions)
            if changed:
                data["active_conditions"] = merged
                if "active_conditions" not in fields_updated:
                    fields_updated.append("active_conditions")
                fields_updated.append(f"active_conditions_auto_derived: {derived_conditions}")
    except Exception as e:  # non-fatal — log on stderr, continue
        print(f"[intake-token-action] _derive_conditions_from_intake failed: {e}", file=sys.stderr)

    # ── mark submitted (Path A — KEEP token active for re-edits) ──
    now_iso = _now_iso()
    if is_first_submit:
        data["intake_submitted_at"] = now_iso
    data["intake_last_submitted_at"] = now_iso
    # intake_token stays — coach calls action_finalise to lock.
    data["intake_form_draft"] = None
    _save_client(client_id, data)

    # ── write audit session ──
    try:
        session_id = _write_quick_note_session(client_id, submitted)
    except Exception as e:  # non-fatal: client.yaml is the source of truth
        session_id = f"(failed to write session: {e})"

    # ── auto-fire AI insights generation (Haiku, ~$0.005/run) ──
    # Refreshes intake_insights on every submit so the coach's view stays
    # current with the client's latest edits. Best-effort: failures are
    # logged on stderr; the submit itself still succeeds.
    insights_status = "skipped (no api key)"
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPT_DIR / "generate-intake-insights.py")],
                input=json.dumps({"client_id": client_id}),
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            if result.returncode == 0:
                insights_status = "ok"
            else:
                insights_status = f"err: {(result.stderr or 'no stderr')[:200]}"
                print(f"[intake-token-action] auto-insights failed: {insights_status}", file=sys.stderr)
        except Exception as e:
            insights_status = f"exc: {e}"
            print(f"[intake-token-action] auto-insights exception: {e}", file=sys.stderr)

    return {
        "ok": True,
        "client_id": client_id,
        "fields_updated": fields_updated,
        "session_id": session_id,
        "is_first_submit": is_first_submit,
        "insights_status": insights_status,
    }


# ── action: finalise (coach explicitly locks the intake) ─────────────────────

def action_finalise(payload: dict) -> dict:
    """Coach-triggered: lock the intake form. Clears intake_token so the
    client can no longer edit via the public link, and stamps
    intake_finalised_at. Idempotent — safe to call twice."""
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    if not data.get("intake_submitted_at"):
        return {"ok": False, "error": "cannot finalise — client has not submitted yet"}
    data["intake_token"] = None
    data["intake_token_expires_at"] = None
    data["intake_finalised_at"] = _now_iso()
    _save_client(client_id, data)
    return {"ok": True, "client_id": client_id, "intake_finalised_at": data["intake_finalised_at"]}


# ── action: unlock_full_intake (v0.75 — flip pre_discovery → full) ───────────

def action_unlock_full_intake(payload: dict) -> dict:
    """Coach-triggered: flip the intake form from pre-discovery to full.
    Typically called after the client signs up for the package — opens the
    deeper sections (FM body systems, ACE-lite, timeline, etc.) on the
    same intake URL. Also flips engagement_status to 'signed_up' as the
    canonical "they're in the programme" marker.

    Idempotent — safe to call twice. If the client has no intake_token yet,
    coach should generate one first (use action_generate).
    """
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    now = _now_iso()
    if not data.get("intake_full_unlocked_at"):
        data["intake_full_unlocked_at"] = now
    data["engagement_status"] = "signed_up"
    _save_client(client_id, data)
    return {
        "ok": True,
        "client_id": client_id,
        "intake_full_unlocked_at": data["intake_full_unlocked_at"],
        "engagement_status": "signed_up",
    }


# ── action: mark_discovery_session_complete (v0.75 — journey marker) ─────────

def action_mark_discovery_session_complete(payload: dict) -> dict:
    """Coach marks that the discovery call has happened. Stamps
    discovery_session_completed_at. Pure visibility — no side effects on the
    intake form or engagement status."""
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    if not data.get("discovery_session_completed_at"):
        data["discovery_session_completed_at"] = _now_iso()
    _save_client(client_id, data)
    return {"ok": True, "client_id": client_id, "discovery_session_completed_at": data["discovery_session_completed_at"]}


# ── action: mark_discovery_lab_pack_sent (v0.75 — journey marker) ────────────

def action_mark_discovery_lab_pack_sent(payload: dict) -> dict:
    """Coach marks that the discovery-promised lab recommendation has been
    delivered (WhatsApp, email, or in-app). Pure visibility — no side
    effects on the intake form or engagement status."""
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    if not data.get("discovery_lab_pack_sent_at"):
        data["discovery_lab_pack_sent_at"] = _now_iso()
    _save_client(client_id, data)
    return {"ok": True, "client_id": client_id, "discovery_lab_pack_sent_at": data["discovery_lab_pack_sent_at"]}


# ── action: revoke ───────────────────────────────────────────────────────────

def action_revoke(payload: dict) -> dict:
    client_id = (payload.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "client_id required"}
    try:
        data = _load_client(client_id)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    data["intake_token"] = None
    data["intake_token_expires_at"] = None
    _save_client(client_id, data)
    return {"ok": True}


# ── dispatcher ───────────────────────────────────────────────────────────────

ACTIONS = {
    "generate": action_generate,
    "lookup": action_lookup,
    "save_draft": action_save_draft,
    "submit": action_submit,
    "finalise": action_finalise,
    "revoke": action_revoke,
    # v0.75 — two-stage intake flow + discovery journey markers
    "unlock_full_intake": action_unlock_full_intake,
    "mark_discovery_session_complete": action_mark_discovery_session_complete,
    "mark_discovery_lab_pack_sent": action_mark_discovery_lab_pack_sent,
}


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2
    action = (payload.get("action") or "").strip()
    fn = ACTIONS.get(action)
    if fn is None:
        json.dump({"ok": False, "error": f"unknown action: {action!r}; expected one of {list(ACTIONS)}"}, sys.stdout)
        return 2
    try:
        out = fn(payload)
    except Exception as e:
        json.dump({"ok": False, "error": f"{type(e).__name__}: {e}"}, sys.stdout)
        return 1
    json.dump(out, sys.stdout)
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
