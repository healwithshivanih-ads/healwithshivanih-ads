"""
Compute derived FM markers and individual lab values with FM-optimal interpretation.

Each returned dict includes:
  marker_name, value, unit, reference_range, flag, fm_interpretation, panel, computed

`panel` groups markers into logical systems for the dashboard UI.
`computed` = True means it was derived from other values (ratio/calculation).
`computed` = False means it was read directly from the lab result.
"""
from __future__ import annotations
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any


# Tracks id() of every extracted lab dict claimed by _find / _find_range during
# a compute_ratios run, so the passthrough at the end can surface anything no
# coded handler matched. Cleared at the start of each compute_ratios call.
_CONSUMED_IDS: set[int] = set()

# Process-cached {normalised name -> LabTest dict} index, built lazily from the
# LabTest catalogue the first time compute_ratios' passthrough needs it.
_LAB_TEST_INDEX: dict | None = None

# ── Off-panel test guard ──────────────────────────────────────────────────────
# Specialty tests a client is very unlikely to have on file. Catalogue lab_tests
# carry generic FM coach-education in notes_for_coach / interpretation_* that
# routinely references these ("less informative than 4-point salivary cortisol
# or DUTCH", "confirm on GI-MAP"…). When that text is surfaced as a PER-CLIENT
# marker interpretation, it reads as a claim about a test the client never had —
# which is exactly what the coach flagged on cl-022's AM Cortisol (she only has
# a single morning serum cortisol and has never ordered salivary/DUTCH). This is
# a deterministic guard, not a manual scrub: any sentence naming one of these
# tests is dropped before the text reaches a client's card.
_OFFPANEL_TEST_TOKENS: tuple[str, ...] = (
    "salivary", "saliva", "4-point", "4 point", "four-point", "four point",
    "dutch", "gi-map", "gimap", "gi map", "organic acid", "oat test",
    "zonulin", "dried urine", "stool test", "cortisol curve",
    "diurnal cortisol",
)


def _scrub_offpanel(text: object) -> str:
    """Drop any sentence that names an off-panel specialty test (see
    _OFFPANEL_TEST_TOKENS). Returns the surviving sentences joined, or "" if the
    whole note was about tests the client doesn't have. Deterministic — no AI —
    so no hallucinated / off-panel test reference can reach a per-client marker."""
    s = str(text or "").strip()
    if not s:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", s)
    kept = [
        seg for seg in sentences
        if not any(tok in seg.lower() for tok in _OFFPANEL_TEST_TOKENS)
    ]
    return " ".join(seg.strip() for seg in kept if seg.strip()).strip()


def _norm_marker(s: object) -> str:
    """Word-order- and punctuation-insensitive key for matching a lab name
    against the LabTest catalogue: lowercase, drop dots, tokenise, sort, join.
    So 'S.G.O.T.', 'Morning Cortisol' and 'Cortisol (Morning)' all collapse
    onto a stable key the catalogue's aliases can be matched against.

    Draw-time fragments (e.g. "08:40AM", "8 am") are stripped before
    tokenising — labs frequently append the exact draw time to
    time-sensitive markers like cortisol, and without this the timestamp
    tokens ("08", "40am") would prevent the name from ever matching the
    catalogue alias ("cortisol morning"), silently dropping it into the
    uninterpreted "Other" bucket instead of getting FM-optimal ranges."""
    t = str(s or "").lower().replace(".", "")
    t = re.sub(r"\b\d{1,2}[:.]?\d{0,2}\s*(am|pm)\b", " ", t)
    toks = sorted(tok for tok in re.split(r"[^a-z0-9]+", t) if tok)
    return "".join(toks)


def _lab_test_index() -> dict:
    """Build (once per process) a {normalised name/alias -> lab_test dict}
    index from the LabTest catalogue, so compute_ratios' passthrough can give
    catalogue-known markers proper FM interpretation instead of dumping them
    uninterpreted. Fails soft to an empty index if the catalogue is unreadable."""
    global _LAB_TEST_INDEX
    if _LAB_TEST_INDEX is not None:
        return _LAB_TEST_INDEX
    idx: dict = {}
    try:
        import os
        import yaml as _yaml
        base = os.environ.get("FMDB_CATALOGUE_DIR")
        data_dir = Path(base) if base else Path(__file__).resolve().parents[2] / "data"
        for p in sorted((data_dir / "lab_tests").glob("*.yaml")):
            if p.name.startswith("_"):
                continue
            try:
                lt = _yaml.safe_load(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(lt, dict):
                continue
            names = [lt.get("slug"), lt.get("display_name"), lt.get("full_name")]
            names += lt.get("aliases") or []
            for nm in names:
                k = _norm_marker(nm)
                if k:
                    idx.setdefault(k, lt)
    except Exception:
        pass
    _LAB_TEST_INDEX = idx
    return idx


def _parse_lab_date(d: object) -> float:
    """Parse a lab date string to a Unix timestamp for comparison.

    Handles common formats produced by the extraction model:
      "19/Apr/2026"  (day/Mon/year)
      "2026-04-19"   (ISO)
      "Apr 2026"     (month-year only)
    Returns 0 for unparseable / missing dates so undated entries sort last.
    """
    if not d:
        return 0.0
    s = re.sub(r"^(\d{1,2})/([A-Za-z]{3})/(\d{4})$", r"\2 \1 \3", str(d).strip())
    for fmt in ("%b %d %Y", "%Y-%m-%d", "%d/%m/%Y", "%b %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).timestamp()
        except ValueError:
            pass
    return 0.0


def _find(labs: list[dict], *patterns: str) -> float | None:
    """Return the numeric value from the MOST RECENT lab matching any regex pattern.

    When multiple lab reports are uploaded in one session (e.g. Jan 2026 and
    Apr 2026), the AI names entries with date suffixes such as
    "TSH (Ultrasensitive) - Jan 2026" and "TSH (Ultrasensitive) - Apr 2026".
    This function collects every match, compares their date_drawn timestamps,
    and returns the value from the latest report so the client profile always
    reflects the current results rather than the oldest ones.
    """
    best_value: float | None = None
    best_ts: float = -1.0
    for lab in labs:
        n = str(lab.get("test_name", "")).lower().replace(".", "")
        for pat in patterns:
            if re.search(pat.lower(), n):
                _CONSUMED_IDS.add(id(lab))
                try:
                    val = float(re.sub(r"[^0-9.\-]", "", str(lab.get("value", ""))))
                    ts = _parse_lab_date(lab.get("date_drawn"))
                    if best_value is None or ts > best_ts:
                        best_value = val
                        best_ts = ts
                except (ValueError, TypeError):
                    pass
                break  # this lab matched — no need to check remaining patterns
    return best_value


def _find_range(labs: list[dict], *patterns: str) -> str | None:
    """Return the `reference_range` string of the MOST RECENT lab matching any
    pattern. Mirrors `_find` but surfaces the assay's own range rather than the
    numeric value — used for assay-dependent markers (antibodies especially)
    where a hardcoded cutoff is wrong for some labs."""
    best_range: str | None = None
    best_ts: float = -1.0
    for lab in labs:
        n = str(lab.get("test_name", "")).lower().replace(".", "")
        for pat in patterns:
            if re.search(pat.lower(), n):
                _CONSUMED_IDS.add(id(lab))
                ts = _parse_lab_date(lab.get("date_drawn"))
                if best_range is None or ts > best_ts:
                    rng = lab.get("reference_range")
                    best_range = str(rng) if rng not in (None, "") else None
                    best_ts = ts
                break
    return best_range


def _range_upper(rng: str | None) -> float | None:
    """Parse the numeric UPPER BOUND out of a lab reference-range string.

    Handles the common shapes seen on Indian lab reports:
      "Up to 95"  → 95      "< 9.0" / "<9"      → 9.0
      "1.9 - 23.0" → 23.0   "Males ≥50y: 18.7-74.2" → 74.2
    Returns None when no number can be parsed."""
    if not rng:
        return None
    s = str(rng).lower()
    m = re.search(r"(?:up\s*to|upto|<|less than|≤|<=)\s*([0-9]+(?:\.[0-9]+)?)", s)
    if m:
        return float(m.group(1))
    nums = re.findall(r"[0-9]+(?:\.[0-9]+)?", s)
    if nums:
        return float(nums[-1])
    return None


def _parse_ref_range(rng: object) -> tuple[float | None, float | None]:
    """(low, high) from a single printed range: "5 - 60", "0.6 to 1.1",
    "< 100", "Up to 95", "> 40". Anything with more than one range in it
    ("Males: 0.7-1.3; Females: 0.6-1.1", age bands) returns (None, None) — a
    guess there would false-flag."""
    s = str(rng or "").lower().replace(",", "").strip()
    if not s:
        return None, None
    nums = re.findall(r"\d+(?:\.\d+)?", s)
    if not nums or len(nums) > 2 or ";" in s or re.search(r"male|female|year|\by\b|age", s):
        return None, None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)", s)
    if m and len(nums) == 2:
        lo, hi = float(m.group(1)), float(m.group(2))
        return (lo, hi) if lo <= hi else (None, None)
    if len(nums) == 1:
        v = float(nums[0])
        if re.search(r"<|≤|up\s*to|upto|less than|below", s):
            return None, v
        if re.search(r">|≥|more than|above|greater", s):
            return v, None
    return None, None


def _range_flag(num: float, lo: float | None, hi: float | None) -> str:
    if lo is not None and num < lo:
        return "low"
    if hi is not None and num > hi:
        return "high"
    return "normal"


PANEL_LIVER_METABOLIC = "Liver & Metabolic Risk"

# Read-with-care notes appended to every Liver & Metabolic Risk interpretation.
_ENZYME_CAVEAT = (
    "Read with care: ALT/AST/GGT-based scores are unreliable within ~4 weeks of "
    "a paracetamol course or an acute illness, and after hard resistance training "
    "in the week before the draw (weightlifting raises ALT/AST for 7+ days; GGT "
    "is not raised by exercise)."
)
_FASTING_CAVEAT = (
    "Read with care: needs a true 8-12 h fasting sample; an acute illness, or a "
    "heavy or alcohol-rich meal the day before, raises TG and glucose."
)


def _tg_mg_dl(tg: float) -> float:
    """TG in mg/dL. A value under 15 can only be mmol/L (x 88.57)."""
    return tg * 88.57 if tg < 15 else tg


def _glucose_mg_dl(glucose: float) -> float:
    """Glucose in mg/dL. A value under 30 can only be mmol/L (x 18.016)."""
    return glucose * 18.016 if glucose < 30 else glucose


def _platelets_10e9(platelets: float) -> float:
    """Platelets in 10^9/L: cells/cumm (263000) -> 263; lakhs (2.63) -> 263."""
    if platelets > 3000:
        return platelets / 1000.0
    if platelets < 10:
        return platelets * 100.0
    return platelets


def _add_liver_metabolic_indices(
    add: Any,
    ctx: dict[str, Any],
    *,
    glucose: float | None,
    tg: float | None,
    hba1c: float | None,
    alt: float | None,
    ast: float | None,
    ggt: float | None,
    platelets: float | None,
) -> None:
    """TyG, TyG-BMI, TyG-WC, HSI, FLI, LAP, FIB-4 and waist-to-height ratio.

    Each is computed only when every input is present; otherwise it is
    skipped silently. Deterministic arithmetic, no API. Lab inputs come from
    `compute_ratios`; age/sex/BMI/waist/diabetes come from `ctx` (see
    `fmdb.assess.client_context.lab_client_context`)."""
    P = PANEL_LIVER_METABOLIC
    age = ctx.get("age")
    sex = ctx.get("sex") if ctx.get("sex") in ("F", "M") else None
    bmi = ctx.get("bmi")
    waist = ctx.get("waist_cm")
    bmi_note = ""
    if bmi:
        bmi_note = f"BMI {round(bmi, 1)}" + (
            f" (weight from {ctx['weight_date']})" if ctx.get("weight_date") else "")
    waist_note = ""
    if waist:
        waist_bits = [b for b in (
            "converted from inches" if ctx.get("waist_from_inches") else "",
            f"measured {ctx['waist_date']}" if ctx.get("waist_date") else "",
        ) if b]
        waist_note = f"waist {round(waist, 1)} cm" + (
            f" ({'; '.join(waist_bits)})" if waist_bits else "")

    tg_mg = _tg_mg_dl(tg) if tg and tg > 0 else None
    glu_mg = _glucose_mg_dl(glucose) if glucose and glucose > 0 else None

    # ── TyG = ln(TG mg/dL x fasting glucose mg/dL / 2) ──────────────────────
    tyg = math.log(tg_mg * glu_mg / 2) if (tg_mg and glu_mg) else None
    if tyg is not None:
        flag = "high" if tyg > 8.8 else ("suboptimal" if tyg >= 8.3 else "optimal")
        msg = (
            "High — insulin resistance and fatty-liver risk pattern; prioritise carb "
            "quality, movement after meals, sleep and waist"
            if tyg > 8.8 else
            "Borderline — early insulin-resistance signal; worth addressing now"
            if tyg >= 8.3 else
            "Optimal — no insulin-resistance signal from TG and glucose"
        )
        add("TyG index", tyg, "",
            "<8.3 optimal; 8.3-8.8 borderline; >8.8 high (IR / fatty-liver risk)",
            flag,
            f"TyG {tyg:.2f} (TG {tg_mg:.0f} mg/dL x fasting glucose {glu_mg:.0f} mg/dL): "
            f"{msg}. Works without a fasting insulin, so it reads IR when HOMA-IR "
            f"can't be computed. Cut-offs vary by population (several South Asian "
            f"cohorts sit lower); watch the trend. {_FASTING_CAVEAT}",
            P, computed=True)

        if bmi:
            tyg_bmi = tyg * bmi
            add("TyG-BMI", tyg_bmi, "",
                "No single agreed cut-off; track the trend (lower is better)",
                "normal",
                f"TyG-BMI {tyg_bmi:.0f} (TyG {tyg:.2f} x {bmi_note}): adds body size to "
                f"the TyG signal; in several studies a better fatty-liver and IR "
                f"predictor than TyG alone. No settled threshold, so use it to track "
                f"change between reports. {_FASTING_CAVEAT}",
                P, computed=True)
        if waist:
            tyg_wc = tyg * waist
            add("TyG-WC", tyg_wc, "",
                "No single agreed cut-off; track the trend (lower is better)",
                "normal",
                f"TyG-WC {tyg_wc:.0f} (TyG {tyg:.2f} x {waist_note}): adds central fat "
                f"to the TyG signal; waist tracks liver fat more closely than BMI. "
                f"No settled threshold, so use it to track change between reports. "
                f"{_FASTING_CAVEAT}",
                P, computed=True)

    # ── HSI = 8 x ALT/AST + BMI (+2 female, +2 diabetes) — Lee 2010 ─────────
    if alt and ast and ast > 0 and bmi and sex:
        diabetic_lab = hba1c is not None and hba1c >= 6.5
        diabetic = bool(ctx.get("diabetes")) or diabetic_lab
        hsi = 8 * alt / ast + bmi + (2 if sex == "F" else 0) + (2 if diabetic else 0)
        flag = "high" if hsi > 36 else ("optimal" if hsi < 30 else "suboptimal")
        msg = (
            "Above 36 — suggests fatty liver; liver-fat lifestyle work is a priority "
            "and an ultrasound is worth discussing with the doctor"
            if hsi > 36 else
            "Below 30 — fatty liver unlikely"
            if hsi < 30 else
            "30-36 — grey zone; cannot rule fatty liver in or out"
        )
        if ctx.get("diabetes"):
            dm_note = f"+2 for diabetes ({ctx.get('diabetes_record') or 'on record'})"
        elif diabetic_lab:
            dm_note = f"+2 for diabetes (HbA1c {hba1c}%)"
        else:
            dm_note = "no diabetes on record"
        add("Hepatic Steatosis Index (HSI)", hsi, "",
            "<30 rules out fatty liver; 30-36 grey zone; >36 suggests steatosis",
            flag,
            f"HSI {hsi:.1f} (8 x ALT {alt}/AST {ast} + {bmi_note}"
            f"{' + 2 female' if sex == 'F' else ''}; {dm_note}): {msg}. {_ENZYME_CAVEAT}",
            P, computed=True)

    # ── FLI — Bedogni 2006 ──────────────────────────────────────────────────
    if tg_mg and bmi and ggt and ggt > 0 and waist:
        y = (0.953 * math.log(tg_mg) + 0.139 * bmi + 0.718 * math.log(ggt)
             + 0.053 * waist - 15.745)
        fli = 100 / (1 + math.exp(-y))
        flag = "high" if fli >= 60 else ("optimal" if fli < 30 else "suboptimal")
        msg = (
            "60 or more — suggests fatty liver; liver-fat lifestyle work is a priority "
            "and an ultrasound is worth discussing with the doctor"
            if fli >= 60 else
            "Below 30 — fatty liver unlikely"
            if fli < 30 else
            "30-60 — grey zone; cannot rule fatty liver in or out"
        )
        add("Fatty Liver Index (FLI)", fli, "",
            "<30 rules out fatty liver; 30-60 grey zone; >=60 suggests steatosis",
            flag,
            f"FLI {fli:.0f} (TG {tg_mg:.0f} mg/dL, GGT {ggt} U/L, {bmi_note}, "
            f"{waist_note}): {msg}. {_ENZYME_CAVEAT}",
            P, computed=True)

    # ── LAP = (waist - 65) x TG mmol/L men; (waist - 58) x TG women — Kahn 2005
    if waist and tg_mg and sex:
        base = 65 if sex == "M" else 58
        lap = max(waist - base, 0.0) * (tg_mg / 88.57)
        flag = "high" if lap > 50 else ("optimal" if lap < 30 else "suboptimal")
        msg = (
            "High — central fat plus raised TG; strong insulin-resistance and "
            "fatty-liver signal"
            if lap > 50 else
            "Borderline — watch waist and TG together"
            if lap >= 30 else
            "Low — little central-fat / TG burden"
        )
        add("Lipid accumulation product (LAP)", lap, "",
            "Rough guide: <30 low; 30-50 borderline; >50 high (cut-offs vary by "
            "population and sex)",
            flag,
            f"LAP {lap:.1f} ((waist {round(waist, 1)} - {base}) x TG "
            f"{tg_mg / 88.57:.2f} mmol/L, {'men' if sex == 'M' else 'women'}'s formula): "
            f"{msg}. No single validated threshold — use the trend. {_FASTING_CAVEAT}",
            P, computed=True)

    # ── Waist-to-height ratio — no labs needed, but it is the input the other
    # central-fat scores lean on, so it sits beside them. ─────────────────────
    height = ctx.get("height_cm")
    if waist and height and height > 0:
        whtr = waist / height
        flag = "high" if whtr > 0.6 else ("optimal" if whtr < 0.5 else "suboptimal")
        msg = (
            "Above 0.6 — high central-fat risk"
            if whtr > 0.6 else
            "0.5-0.6 — central fat above the healthy line; raises insulin-resistance "
            "and fatty-liver risk even at a normal BMI"
            if whtr >= 0.5 else
            "Below 0.5 — waist in a healthy proportion to height"
        )
        line = ""
        if sex:
            cut = 80 if sex == "F" else 90
            side = "above" if waist >= cut else "below"
            line = (f" Waist {round(waist, 1)} cm is {side} the usual South Asian line "
                    f"of {cut} cm for {'women' if sex == 'F' else 'men'}.")
        h_note = " (height converted from inches)" if ctx.get("height_from_inches") else ""
        add("Waist-to-height ratio", whtr, "",
            "<0.5 healthy; 0.5-0.6 raised; >0.6 high (any sex)",
            flag,
            f"Waist-to-height {whtr:.2f} ({waist_note} / height {round(height, 1)} cm"
            f"{h_note}): {msg}.{line} Waist is the input in FLI, LAP and TyG-WC that "
            f"changes fastest with movement, strength work and sleep; measure at the "
            f"navel, end of a normal breath out.",
            P, computed=True)

    # ── FIB-4 = (age x AST) / (platelets 10^9/L x sqrt(ALT)) — Sterling 2006 ─
    if age and ast and alt and alt > 0 and platelets and platelets > 0:
        plt = _platelets_10e9(platelets)
        fib4 = (age * ast) / (plt * math.sqrt(alt))
        low_cut = 2.0 if age >= 65 else 1.3
        flag = "high" if fib4 > 2.67 else ("optimal" if fib4 < low_cut else "suboptimal")
        msg = (
            "Above 2.67 — high risk of advanced scarring; the doctor, promptly"
            if fib4 > 2.67 else
            f"Below {low_cut} — low risk of advanced liver scarring"
            if fib4 < low_cut else
            f"{low_cut}-2.67 — indeterminate; a liver stiffness scan (FibroScan) is "
            f"worth discussing with the doctor"
        )
        notes = []
        if age >= 65:
            notes.append("age 65+ so the low-risk line is 2.0")
        if age < 35:
            notes.append("under 35 the score is unreliable")
        if ctx.get("age_source") == "age_band":
            notes.append("age estimated from the age band — add a date of birth for an exact score")
        note = f" ({'; '.join(notes)})" if notes else ""
        add("FIB-4", fib4, "",
            "<1.3 low (<2.0 if 65+); 1.3-2.67 indeterminate; >2.67 high",
            flag,
            f"FIB-4 {fib4:.2f} (age {age} x AST {ast} / (platelets {plt:g} x "
            f"sqrt ALT {alt})){note}: {msg}. A score, not a diagnosis. {_ENZYME_CAVEAT}",
            P, computed=True)


# ══════════════════════════════════════════════════════════════════════════════
# Holistic read (Nov 2026): inflammation indices, lipid extras, insulin
# sensitivity, thyroid structure parameters, minerals and PhenoAge. Every one
# is deterministic arithmetic, computed only when all its inputs are present.
# ══════════════════════════════════════════════════════════════════════════════

PANEL_INFLAM = "Inflammation & Immune"
PANEL_MINERALS = "Minerals & Electrolytes"
PANEL_BIOAGE = "Biological Age"

_INFLAM_CAVEAT = (
    "Read with care: any infection, a cold, a vaccine or an injury in the 3 weeks "
    "before the draw raises these counts; repeat when well before acting on them."
)


def _num_of(lab: dict | None) -> float | None:
    if not lab:
        return None
    try:
        return float(re.sub(r"[^0-9.\-]", "", str(lab.get("value", ""))))
    except (TypeError, ValueError):
        return None


def _peek(labs: list[dict], *patterns: str) -> tuple[float | None, dict | None]:
    """Like `_find` (most recent matching value) but does NOT claim the row, so
    the passthrough still shows it with its catalogue interpretation. Used for
    inputs to the new indices that have no coded handler of their own."""
    best_v: float | None = None
    best_lab: dict | None = None
    best_ts = -1.0
    for lab in labs:
        if not isinstance(lab, dict):
            continue
        n = str(lab.get("test_name", "")).lower().replace(".", "")
        if not any(re.search(p, n) for p in patterns):
            continue
        v = _num_of(lab)
        if v is None:
            continue
        ts = _parse_lab_date(lab.get("date_drawn"))
        if best_v is None or ts > best_ts:
            best_v, best_lab, best_ts = v, lab, ts
    return best_v, best_lab


_DIFF_PATS = {
    "neutrophil": r"neutrophil|\banc\b|polymorph",
    "lymphocyte": r"lymphocyte",
    "monocyte": r"monocyte",
    "eosinophil": r"eosinophil|\baec\b",
    "basophil": r"basophil",
}
_DIFF_EXCLUDE = re.compile(r"ratio|/|:|atypical|reactive|immature|large unstained|variant")
# A unit that says the count is in thousands per microlitre (= 10^9/L).
_THOUSANDS_UNIT = re.compile(r"10\s*[\^*e]?\s*[3³9]|x\s*10|thou|k\s*/|/\s*nl|10\^9|giga", re.I)
_CELLS_UNIT = re.compile(r"cumm|cells|/\s*(u|µ|μ)l|/\s*mm", re.I)


def _differential(labs: list[dict], cell: str) -> tuple[float | None, float | None]:
    """(absolute count in 10^9/L, percent) for one white-cell type, latest draw.

    Labs print both a % row and an absolute row ("Neutrophils 58 %" and
    "Neutrophils - Absolute Count 3.6 X 10³/µL"). A row is a percent when its
    unit or name says %; absolute when its name says absolute/count or its unit
    is a count unit. Absolute values in cells/µL (3600) are scaled to 10^9/L
    (3.6). Does not claim the rows."""
    pat = _DIFF_PATS[cell]
    best: dict[str, tuple[float | None, float]] = {"abs": (None, -1.0), "pct": (None, -1.0)}
    for lab in labs:
        if not isinstance(lab, dict):
            continue
        n = str(lab.get("test_name", "")).lower().replace(".", "")
        if not re.search(pat, n) or _DIFF_EXCLUDE.search(n):
            continue
        v = _num_of(lab)
        if v is None:
            continue
        unit = str(lab.get("unit") or "").lower()
        is_pct = "%" in unit or "%" in n or "percent" in n
        is_abs = bool(re.search(r"absolute|\babs\b|count|#", n)) or bool(
            _THOUSANDS_UNIT.search(unit) or _CELLS_UNIT.search(unit))
        if is_pct and is_abs:
            is_abs = "%" not in unit
            is_pct = not is_abs
        if not (is_pct or is_abs):
            is_abs = v < 10
            is_pct = not is_abs
        kind = "abs" if is_abs else "pct"
        if kind == "abs":
            if _THOUSANDS_UNIT.search(unit):
                pass
            elif _CELLS_UNIT.search(unit) or v >= 50:
                v = v / 1000.0
        ts = _parse_lab_date(lab.get("date_drawn"))
        if best[kind][0] is None or ts > best[kind][1]:
            best[kind] = (v, ts)
    return best["abs"][0], best["pct"][0]


def _rdw_cv(labs: list[dict]) -> float | None:
    """RDW-CV (%) only. Many reports print RDW-SD (fL, ~39-46) as well; read
    as RDW-CV it would always look 'high' (>14.5)."""
    best_v: float | None = None
    best_ts = -1.0
    for lab in labs:
        if not isinstance(lab, dict):
            continue
        n = str(lab.get("test_name", "")).lower().replace(".", "")
        if not re.search(r"\brdw\b|red.cell.distribution|red.cell.width", n):
            continue
        v = _num_of(lab)
        unit = str(lab.get("unit") or "").lower()
        if v is None or re.search(r"\bsd\b|rdw.?sd", n) or "fl" in unit or v > 25:
            continue
        ts = _parse_lab_date(lab.get("date_drawn"))
        if best_v is None or ts > best_ts:
            best_v, best_ts = v, ts
    return best_v


def _rdw_sd(labs: list[dict]) -> float | None:
    best_v: float | None = None
    best_ts = -1.0
    for lab in labs:
        if not isinstance(lab, dict):
            continue
        n = str(lab.get("test_name", "")).lower().replace(".", "")
        if not re.search(r"\brdw\b|red.cell.distribution|red.cell.width", n):
            continue
        v = _num_of(lab)
        unit = str(lab.get("unit") or "").lower()
        if v is None or not (re.search(r"\bsd\b|rdw.?sd", n) or "fl" in unit or v > 25):
            continue
        ts = _parse_lab_date(lab.get("date_drawn"))
        if best_v is None or ts > best_ts:
            best_v, best_ts = v, ts
    return best_v


def _albumin_g_dl(albumin: float | None) -> float | None:
    """Albumin in g/dL; a value over 10 can only be g/L."""
    if not albumin or albumin <= 0:
        return None
    return albumin / 10.0 if albumin > 10 else albumin


def _add_inflammation_indices(
    add: Any, *,
    platelets: float | None,
    neut_abs: float | None,
    lymph_abs: float | None,
    mono_abs: float | None,
    crp_mg_l: float | None,
    crp_label: str,
    albumin_g_dl: float | None,
    derived: set[str],
) -> None:
    """SII, PLR, MLR (absolute counts, 10^9/L) and the CRP/albumin ratio."""
    P = PANEL_INFLAM
    src = ""
    if derived:
        src = (" Absolute " + "/".join(sorted(derived))
               + " worked out from the % and the total WBC.")

    if platelets and neut_abs and lymph_abs and lymph_abs > 0:
        sii = platelets * neut_abs / lymph_abs
        flag = "high" if sii > 800 else ("suboptimal" if sii >= 500 else "optimal")
        msg = (
            "High — platelets and neutrophils up while lymphocytes are down: an active, "
            "body-wide inflammatory load; find the driver (infection, gut, visceral fat, "
            "sleep, stress)"
            if sii > 800 else
            "Borderline — a mild inflammatory tilt; watch the trend"
            if sii >= 500 else
            "Low inflammatory signal"
        )
        add("Systemic immune-inflammation index (SII)", sii, "x10^9/L",
            "<500 FM working range; 500-800 borderline; >800 high (no agreed cut-off; "
            "rises with age)",
            flag,
            f"SII {sii:.0f} (platelets {platelets:g} x neutrophils {neut_abs:.2f} / "
            f"lymphocytes {lymph_abs:.2f}): {msg}. Population adults 45+ averaged 459 "
            f"(95% range 189-1168).{src} {_INFLAM_CAVEAT}",
            P, computed=True)

    if platelets and lymph_abs and lymph_abs > 0:
        plr = platelets / lymph_abs
        flag = "high" if plr > 200 else ("suboptimal" if plr >= 150 else "optimal")
        msg = (
            "High — platelet-driven inflammation or low lymphocytes (chronic stress, "
            "infection, iron deficiency can all push platelets up)"
            if plr > 200 else
            "Borderline — watch the trend"
            if plr >= 150 else
            "Balanced"
        )
        add("Platelet/Lymphocyte ratio (PLR)", plr, "",
            "<150 FM working range; 150-200 borderline; >200 high",
            flag,
            f"PLR {plr:.0f} (platelets {platelets:g} / lymphocytes {lymph_abs:.2f}): "
            f"{msg}. Population adults 45+ averaged 120 (95% range 61-239).{src} "
            f"{_INFLAM_CAVEAT}",
            P, computed=True)

    if mono_abs is not None and lymph_abs and lymph_abs > 0:
        mlr = mono_abs / lymph_abs
        flag = "high" if mlr > 0.35 else ("suboptimal" if mlr >= 0.25 else "optimal")
        msg = (
            "High — monocyte-led (innate) inflammation relative to lymphocytes; seen with "
            "chronic infection, visceral fat and atherosclerosis risk"
            if mlr > 0.35 else
            "Borderline — watch the trend"
            if mlr >= 0.25 else
            "Balanced"
        )
        add("Monocyte/Lymphocyte ratio (MLR)", mlr, "",
            "<0.25 FM working range; 0.25-0.35 borderline; >0.35 high (no agreed cut-off)",
            flag,
            f"MLR {mlr:.2f} (monocytes {mono_abs:.2f} / lymphocytes {lymph_abs:.2f}): "
            f"{msg}.{src} {_INFLAM_CAVEAT}",
            P, computed=True)

    if crp_mg_l is not None and albumin_g_dl:
        car = crp_mg_l / (albumin_g_dl * 10.0)
        flag = "high" if car > 0.075 else ("suboptimal" if car >= 0.025 else "optimal")
        msg = (
            "High — inflammation is outpacing the liver's protein output; find and "
            "treat the driver"
            if car > 0.075 else
            "Borderline — low-grade inflammation, or albumin on the low side"
            if car >= 0.025 else
            "Low — little inflammation relative to protein reserve"
        )
        add("CRP/Albumin ratio", car, "",
            "<0.025 FM working range; 0.025-0.075 borderline; >0.075 high "
            "(CRP mg/L / albumin g/L)",
            flag,
            f"CRP/albumin {car:.3f} ({crp_label} {crp_mg_l:g} mg/L / albumin "
            f"{albumin_g_dl * 10:.1f} g/L): {msg}. Reads CRP against albumin, which "
            f"falls as inflammation rises, so it is steadier than CRP alone. The bands "
            f"mirror the hsCRP 1 and 3 mg/L lines at a normal albumin; in hospital "
            f"admissions a ratio above 2 predicted mortality. {_INFLAM_CAVEAT}",
            P, computed=True)


def _mg_dl_lipid(v: float | None) -> float | None:
    """Cholesterol fractions in mg/dL; a value under 20 can only be mmol/L."""
    if v is None or v <= 0:
        return None
    return v * 38.67 if v < 20 else v


def _add_lipid_extras(
    add: Any, *,
    tc: float | None, ldl: float | None, hdl: float | None,
    tg: float | None, apob: float | None, ldl_direct: bool,
) -> None:
    """Remnant cholesterol and the LDL-C/ApoB ratio."""
    P = "Cardiovascular & Lipids"
    tc_m, ldl_m, hdl_m = _mg_dl_lipid(tc), _mg_dl_lipid(ldl), _mg_dl_lipid(hdl)
    if tc_m and ldl_m and hdl_m:
        rem = tc_m - hdl_m - ldl_m
        if rem >= 0:
            flag = "high" if rem > 30 else ("suboptimal" if rem >= 20 else "optimal")
            msg = (
                "High — cholesterol carried in triglyceride-rich remnant particles; a "
                "risk on top of LDL that tracks insulin resistance and high TG"
                if rem > 30 else
                "Borderline — tighten carb quality, alcohol and TG"
                if rem >= 20 else
                "Low remnant burden"
            )
            if ldl_direct:
                how = "LDL was measured directly, so this is a real remnant estimate."
            else:
                how = ("If this report CALCULATED LDL (Friedewald), remnant is just "
                       "TG/5 and adds nothing new — a direct LDL makes it meaningful.")
            add("Remnant cholesterol", rem, "mg/dL",
                "<20 FM optimal; 20-30 borderline; >30 high (TC - HDL - LDL)",
                flag,
                f"Remnant cholesterol {rem:.0f} mg/dL (TC {tc_m:.0f} - HDL {hdl_m:.0f} - "
                f"LDL {ldl_m:.0f}): {msg}. Each 39 mg/dL rise roughly tripled heart-disease "
                f"risk in Copenhagen genetic data. {how} {_FASTING_CAVEAT}",
                P, computed=True)

    if ldl_m and apob and apob > 0:
        apob_m = apob * 100.0 if apob < 3 else apob   # g/L -> mg/dL
        ratio = ldl_m / apob_m
        flag = "low" if ratio < 1.2 else "optimal"
        msg = (
            "Below 1.2 — each ApoB particle carries little cholesterol, the pattern of "
            "small dense LDL; particle count (ApoB) is the number to follow, not LDL-C"
            if ratio < 1.2 else
            "1.2 or more — LDL particles carry a normal cholesterol load (large, buoyant pattern)"
        )
        add("LDL-C/ApoB ratio", ratio, "",
            ">=1.2 typical; <1.2 suggests small dense LDL",
            flag,
            f"LDL-C/ApoB {ratio:.2f} (LDL {ldl_m:.0f} / ApoB {apob_m:.0f} mg/dL): {msg}. "
            f"A surrogate only — TG/HDL predicts small dense LDL at least as well, so "
            f"read the two together.",
            P, computed=True)


def _add_insulin_sensitivity(
    add: Any, *, glucose: float | None, insulin: float | None, tg: float | None,
) -> None:
    """QUICKI (Katz 2000) and the McAuley index (McAuley 2001)."""
    P = "Metabolic & Insulin"
    glu = _glucose_mg_dl(glucose) if glucose and glucose > 0 else None
    if glu and insulin and insulin > 0:
        denom = math.log10(insulin) + math.log10(glu)
        if denom > 0:
            q = 1.0 / denom
            flag = "high" if q < 0.33 else ("suboptimal" if q < 0.35 else "optimal")
            msg = (
                "Below 0.33 — insulin resistance (the original study's obese group "
                "averaged 0.33, type 2 diabetes 0.30)"
                if q < 0.33 else
                "0.33-0.35 — reduced insulin sensitivity; worth addressing now"
                if q < 0.35 else
                "0.35 or more — good insulin sensitivity (lean adults averaged 0.37)"
            )
            add("QUICKI", q, "",
                ">=0.35 FM optimal; 0.33-0.35 reduced; <0.33 insulin resistance",
                flag,
                f"QUICKI {q:.3f} (1 / (log insulin {insulin:g} + log glucose {glu:.0f})): "
                f"{msg}. Lower means more resistant — the opposite direction to HOMA-IR. "
                f"{_FASTING_CAVEAT}",
                P, computed=True)

    tg_mg = _tg_mg_dl(tg) if tg and tg > 0 else None
    if insulin and insulin > 0 and tg_mg:
        tg_mmol = tg_mg / 88.57
        mca = math.exp(2.63 - 0.28 * math.log(insulin) - 0.31 * math.log(tg_mmol))
        flag = "high" if mca < 5.8 else ("suboptimal" if mca < 7.0 else "optimal")
        msg = (
            "Below 5.8 — insulin resistance (the study's screening cut-off)"
            if mca < 5.8 else
            "5.8-7.0 — near the line; early insulin-resistance signal"
            if mca < 7.0 else
            "Above 7 — insulin sensitive"
        )
        add("McAuley index", mca, "",
            ">7 FM optimal; 5.8-7 borderline; <5.8 insulin resistance",
            flag,
            f"McAuley {mca:.2f} (exp(2.63 - 0.28 ln insulin {insulin:g} - 0.31 ln TG "
            f"{tg_mmol:.2f} mmol/L)): {msg}. Uses insulin and TG, so it catches IR "
            f"with a normal glucose. Lower means more resistant. {_FASTING_CAVEAT}",
            P, computed=True)


def _thyroid_si(ft4: float, ft3: float) -> tuple[float, float]:
    """(FT4 pmol/L, FT3 pmol/L). FT4 under 5 means ng/dL and FT3 pg/mL, the
    units most Indian labs print (same rule as the T3/T4 conversion ratio)."""
    if ft4 < 5:
        return ft4 * 12.87, ft3 * 1.536
    return ft4, ft3


_BIOTIN_NOTE = ("Biotin (hair/skin/nail supplements, B-complex) in the 3 days before "
                "the draw distorts these immunoassays — TSH can read falsely low and "
                "FT4/FT3 falsely high.")


def _add_thyroid_structure(
    add: Any, *, tsh: float | None, ft4: float | None, ft3: float | None,
) -> None:
    """SPINA-GD (deiodinase activity) and Jostel's TSH index."""
    P = "Thyroid"
    if ft4 and ft3 and ft4 > 0 and ft3 > 0:
        ft4_p, ft3_p = _thyroid_si(ft4, ft3)
        # GD = beta31 (KM1 + FT4) (1 + K30 TBG) FT3 / (alpha31 FT4), mol/L
        # (Dietrich). (1 + K30 TBG) turns free T3 into total T3 at a standard
        # TBG of 300 nmol/L (K30 = 2e9 L/mol) — about 601.
        b31, km1, a31, k30, tbg = 8e-6, 5e-7, 0.026, 2e9, 3e-7
        ft4_m, ft3_m = ft4_p * 1e-12, ft3_p * 1e-12
        gd = b31 * (km1 + ft4_m) * (1 + k30 * tbg) * ft3_m / (a31 * ft4_m) * 1e9   # nmol/s
        flag = "low" if gd < 20 else ("high" if gd > 40 else "optimal")
        msg = (
            "Low — the body converts little T4 to active T3: look at selenium, zinc, "
            "iron, inflammation, cortisol, calorie restriction and liver health"
            if gd < 20 else
            "High — conversion is running hot; seen early in thyroid under-function "
            "(compensation), with iodine shortage or on T3 medication"
            if gd > 40 else
            "Normal T4-to-T3 conversion"
        )
        add("SPINA-GD (deiodinase activity)", gd, "nmol/s",
            "20-40 nmol/s",
            flag,
            f"SPINA-GD {gd:.1f} nmol/s (from FT4 {ft4_p:.1f} and FT3 {ft3_p:.2f} pmol/L): "
            f"{msg}. A modelled estimate of total peripheral conversion, steadier than "
            f"the simple FT3/FT4 ratio. {_BIOTIN_NOTE}",
            P, computed=True)

    if tsh and tsh > 0 and ft4 and ft4 > 0:
        ft4_p = ft4 * 12.87 if ft4 < 5 else ft4
        tshi = math.log(tsh) + 0.1345 * ft4_p
        stshi = (tshi - 2.7) / 0.676
        flag = "low" if tshi < 1.3 else ("high" if tshi > 4.1 else "optimal")
        msg = (
            "Low — the pituitary is under-driving the thyroid for this FT4 (central "
            "pattern); worth raising with the doctor"
            if tshi < 1.3 else
            "High — TSH is high for this FT4: the gland needs a hard push "
            "(primary under-function)"
            if tshi > 4.1 else
            "TSH is in proportion to FT4"
        )
        add("Jostel's TSH index (TSHI)", tshi, "",
            "1.3-4.1 (standardised sTSHI -2 to +2)",
            flag,
            f"TSHI {tshi:.2f} (ln TSH {tsh:g} + 0.1345 x FT4 {ft4_p:.1f} pmol/L; "
            f"sTSHI {stshi:+.1f}): {msg}. {_BIOTIN_NOTE}",
            P, computed=True)


def _mg_dl_calcium(v: float | None) -> float | None:
    if v is None or v <= 0:
        return None
    return v * 4.008 if v < 4 else v


def _mg_dl_phosphorus(v: float | None) -> float | None:
    if v is None or v <= 0:
        return None
    return v * 3.097 if v < 1.8 else v


def _ug_dl_trace(v: float | None, factor: float) -> float | None:
    """Zinc / copper in µg/dL; a value under 40 is µmol/L (x factor)."""
    if v is None or v <= 0:
        return None
    return v * factor if v < 40 else v


def _add_minerals(
    add: Any, *,
    calcium: float | None, albumin_g_dl: float | None, phosphorus: float | None,
    sodium: float | None, potassium: float | None,
    zinc: float | None, copper: float | None,
) -> None:
    """Albumin-corrected calcium, Ca/P, Na/K and Zn/Cu."""
    P = PANEL_MINERALS
    ca = _mg_dl_calcium(calcium)
    if ca and albumin_g_dl:
        cca = ca + 0.8 * (4.0 - albumin_g_dl)
        if cca < 8.5:
            flag, msg = "low", "Low — check vitamin D, magnesium, PTH and kidney function"
        elif cca > 10.2:
            flag, msg = "high", ("High — check PTH, vitamin D dose (excess raises calcium) "
                                 "and kidney function with the doctor")
        elif 9.0 <= cca <= 10.0:
            flag, msg = "optimal", "Normal once albumin is accounted for"
        else:
            flag, msg = "suboptimal", "Edge of the range once albumin is accounted for"
        add("Calcium (albumin-corrected)", cca, "mg/dL",
            "9.0-10.0 FM optimal; lab 8.5-10.2",
            flag,
            f"Corrected calcium {cca:.2f} (calcium {ca:.2f} + 0.8 x (4.0 - albumin "
            f"{albumin_g_dl:.2f})): {msg}. About half of blood calcium rides on "
            f"albumin, so a low albumin makes total calcium look falsely low. Ionised "
            f"calcium is the direct measure if this is borderline.",
            P, computed=True)

    p = _mg_dl_phosphorus(phosphorus)
    if ca and p:
        cap = ca / p
        flag = "low" if cap < 2.3 else ("high" if cap > 3.3 else "optimal")
        msg = (
            "Low — phosphorus high relative to calcium: high-phosphate diet (colas, "
            "processed food), low calcium intake or kidney strain"
            if cap < 2.3 else
            "High — phosphorus low relative to calcium: low vitamin D, low protein "
            "intake, or parathyroid over-activity"
            if cap > 3.3 else
            "Balanced"
        )
        add("Calcium/Phosphorus ratio", cap, "",
            "2.3-3.3 FM working range (mg/dL ÷ mg/dL)",
            flag,
            f"Ca/P {cap:.2f} (calcium {ca:.2f} / phosphorus {p:.2f} mg/dL): {msg}. An "
            f"FM working range, not a validated cut-off — read with vitamin D and PTH.",
            P, computed=True)

    if sodium and potassium and potassium > 0:
        nak = sodium / potassium
        if nak < 27 or nak > 40:
            flag = "low" if nak < 27 else "high"
        elif nak < 30 or nak > 36:
            flag = "suboptimal"
        else:
            flag = "optimal"
        msg = (
            "Low — potassium high relative to sodium: in FM reading, an adrenal "
            "(aldosterone) under-drive pattern; also dehydration-free causes such as "
            "potassium-sparing drugs or a haemolysed sample"
            if nak < 30 else
            "High — sodium high relative to potassium: acute stress / high "
            "aldosterone pattern, low potassium intake, or diuretics"
            if nak > 36 else
            "Balanced"
        )
        add("Sodium/Potassium ratio", nak, "",
            "30-36 FM working range",
            flag,
            f"Na/K {nak:.1f} (sodium {sodium:g} / potassium {potassium:g}): {msg}. An "
            f"FM heuristic without outcome data — never a diagnosis; a haemolysed "
            f"sample falsely raises potassium.",
            P, computed=True)

    zn = _ug_dl_trace(zinc, 6.54)
    cu = _ug_dl_trace(copper, 6.355)
    if zn and cu:
        zncu = zn / cu
        if zncu < 0.7:
            flag, msg = "low", ("Copper-dominant — inflammation, oestrogen (OCP/HRT) or "
                                "low zinc pushes copper up relative to zinc")
        elif zncu < 0.85:
            flag, msg = "suboptimal", "Leaning copper-dominant"
        elif zncu <= 1.25:
            flag, msg = "optimal", "Balanced"
        elif zncu <= 1.5:
            flag, msg = "suboptimal", "Leaning zinc-dominant"
        else:
            flag, msg = "high", ("Zinc-dominant — long high-dose zinc can deplete copper; "
                                 "check for low copper (anaemia, low WBC, neuropathy)")
        add("Zinc/Copper ratio", zncu, "",
            "0.85-1.25 FM working range (Cu/Zn ~0.8-1.2)",
            flag,
            f"Zn/Cu {zncu:.2f} (zinc {zn:.0f} / copper {cu:.0f} µg/dL; Cu/Zn "
            f"{cu / zn:.2f}): {msg}. A rising Cu/Zn ratio tracks inflammation and "
            f"ageing in European cohorts.",
            P, computed=True)


def _creatinine_umol(v: float) -> float:
    """Creatinine in µmol/L; a value under 20 is mg/dL (x 88.4)."""
    return v * 88.4 if v < 20 else v


def phenoage(
    *, albumin_g_dl: float, creatinine: float, glucose: float, crp_mg_l: float,
    lymph_pct: float, mcv: float, rdw_cv: float, alp: float, wbc: float, age: float,
) -> float:
    """Levine 2018 Phenotypic Age in years. Inputs in the units Indian labs
    print (albumin g/dL, creatinine mg/dL, glucose mg/dL, CRP mg/L, WBC
    10^3/µL); converted here to the model's units (g/L, µmol/L, mmol/L,
    ln CRP mg/dL)."""
    crp_dl = max(crp_mg_l / 10.0, 0.01)
    xb = (-19.907
          - 0.0336 * albumin_g_dl * 10.0
          + 0.0095 * _creatinine_umol(creatinine)
          + 0.1953 * (_glucose_mg_dl(glucose) / 18.016)
          + 0.0954 * math.log(crp_dl)
          - 0.0120 * lymph_pct
          + 0.0268 * mcv
          + 0.3306 * rdw_cv
          + 0.00188 * alp
          + 0.0554 * wbc
          + 0.0804 * age)
    g = 0.0076927
    m = 1 - math.exp(-math.exp(xb) * (math.exp(120 * g) - 1) / g)
    m = min(max(m, 1e-12), 1 - 1e-12)
    return 141.50225 + math.log(-0.00553 * math.log(1 - m)) / 0.090165


def _add_phenoage(add: Any, ctx: dict[str, Any], **inp: Any) -> None:
    age = ctx.get("age")
    if not age or any(inp.get(k) in (None, 0) for k in (
            "albumin_g_dl", "creatinine", "glucose", "lymph_pct", "mcv", "rdw_cv",
            "alp", "wbc")) or inp.get("crp_mg_l") is None:
        return
    try:
        pa = phenoage(age=age, **inp)
    except (ValueError, OverflowError):
        return
    accel = pa - age
    flag = "high" if accel > 3 else ("suboptimal" if accel > 0 else "optimal")
    msg = (
        f"{accel:+.1f} years vs calendar age — the blood is reading older; the inputs "
        f"pulling it up are the ones to work on"
        if accel > 3 else
        f"{accel:+.1f} years vs calendar age — close to calendar age"
        if accel > 0 else
        f"{accel:+.1f} years vs calendar age — reading younger"
    )
    note = (" Age estimated from the age band — add a date of birth for an exact score."
            if ctx.get("age_source") == "age_band" else "")
    add("PhenoAge (research score)", pa, "years",
        "Research score — compare with calendar age and track the trend",
        flag,
        f"PhenoAge {pa:.1f} at calendar age {age}: {msg}. Levine 2018 blood-based "
        f"phenotypic age from albumin, creatinine, glucose, CRP, lymphocyte %, MCV, "
        f"RDW, ALP and WBC. A research score shown as a trend between reports, not "
        f"a diagnosis. An infection or a recent hard workout moves CRP, WBC and "
        f"lymphocytes and so this score.{note}",
        PANEL_BIOAGE, computed=True)


def compute_ratios(
    extracted_labs: list[dict[str, Any]],
    client_context: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Return list of FM-interpreted markers + computed ratios, grouped by panel.

    `client_context` (optional) carries the client facts some indices need —
    age, sex, BMI, waist, diabetes — as built by
    `fmdb.assess.client_context.lab_client_context(client)`. Callers pass the
    record they already hold; this function never reads a file for it. Without
    it, the lab-only indices (TyG) still compute and the rest are skipped.
    """
    results: list[dict[str, Any]] = []
    _CONSUMED_IDS.clear()

    def add(name: str, value: float | None, unit: str, ref_range: str,
            flag: str, interpretation: str, panel: str, computed: bool = False) -> None:
        if value is None:
            return
        results.append({
            "marker_name": name,
            "value": round(value, 3) if abs(value) < 10 else round(value, 1),
            "unit": unit,
            "reference_range": ref_range,
            "flag": flag,
            "fm_interpretation": interpretation,
            "panel": panel,
            "computed": computed,
        })

    PANEL_META = "Metabolic & Insulin"
    PANEL_THYROID = "Thyroid"
    PANEL_LIVER = "Liver Function"
    PANEL_KIDNEY = "Kidney Function"
    PANEL_CARDIO = "Cardiovascular & Lipids"
    PANEL_IRON = "Iron & Blood"
    PANEL_NUTRIENTS = "Key Nutrients"

    # ══════════════════════════════════════════════════════════════════════════
    # 1. METABOLIC & INSULIN
    # ══════════════════════════════════════════════════════════════════════════
    # FASTING glucose only. Labs print it as "Glucose, Fasting", "Glucose -
    # Fasting", "Glucose Plasma, Fasting" (missed by a one-character gap, so a
    # client lost HOMA-IR, TyG and PhenoAge), and "Blood Glucose - Post
    # Prandial" / "PP Plasma Glucose" / "Average Blood Glucose" used to match.
    glucose = _find(extracted_labs,
        r"^(?!.*post)(?!.*prandial)(?!.*\bpp)(?!.*random)(?!.*average)(?!.*estimated)"
        r"(?!.*\beag\b)(?!.*\babg\b)(?!.*urine)(?!.*\b2.?h)(?!.*hour)"
        r".*(?:fasting.*glucose|glucose.*fast|blood glucose|plasma glucose|fasting blood sugar|\bfbs\b)")
    insulin = _find(extracted_labs,
        r"insulin.*fast|fast.*insulin|serum insulin")
    hba1c = _find(extracted_labs,
        r"hba1c|hemoglobin a1c|glycated haemoglobin|glycosylated haemoglobin|a1c\b")
    uric_acid = _find(extracted_labs,
        r"uric acid|serum urate|urate\b")
    pp_glucose = _find(extracted_labs,
        r"post.?prandial.glucose|pp.?glucose|pp.?bs\b|2.h.*glucose|2.hour.glucose|post.meal.glucose")

    if glucose is not None:
        flag = "high" if glucose > 95 else ("low" if glucose < 70 else "optimal")
        add("Fasting glucose", glucose, "mg/dL",
            "70–90 FM optimal (lab: <100)",
            flag,
            f"Glucose {glucose}: {'Elevated — early IR or diet-driven glucose load; target <90' if glucose>95 else 'Low — hypoglycaemic tendency; check meal timing' if glucose<70 else 'FM optimal range'}",
            PANEL_META)

    if pp_glucose is not None:
        flag = "high" if pp_glucose > 140 else ("suboptimal" if pp_glucose > 110 else "optimal")
        add("Postprandial glucose (2h)", pp_glucose, "mg/dL",
            "70–110 FM optimal; 110–140 IGT; ≥140 prediabetes",
            flag,
            f"PP glucose {pp_glucose}: {'≥140 — impaired glucose tolerance / diabetes pattern; even normal fasting can hide post-meal spikes' if pp_glucose>=140 else 'Above FM optimal — early IR; check fasting insulin + HOMA-IR' if pp_glucose>110 else 'FM optimal — good post-meal handling'}",
            PANEL_META)

    # Glucose excursion (PP - fasting) — both must be present
    if glucose is not None and pp_glucose is not None:
        excursion = pp_glucose - glucose
        flag = "high" if excursion > 50 else ("suboptimal" if excursion > 30 else "optimal")
        add("Glucose excursion (PP − fasting)", excursion, "mg/dL",
            "<30 healthy response; 30–50 borderline; >50 dysglycaemia",
            flag,
            f"Excursion +{excursion}: {'Large post-meal spike — early IR or carb-heavy meal; check meal composition + insulin' if excursion>50 else 'Moderate post-meal rise — watch carb quality + timing' if excursion>30 else 'Healthy glucose handling'}",
            PANEL_META, computed=True)

    if insulin is not None:
        flag = "high" if insulin > 8 else ("suboptimal" if insulin > 5 else "optimal")
        add("Fasting insulin", insulin, "uIU/mL",
            "<5 FM optimal; <8 acceptable; lab often passes <25",
            flag,
            f"Insulin {insulin}: {'Significant hyperinsulinaemia — prioritise insulin sensitisation protocol' if insulin>8 else 'Mildly elevated — IR risk; reduce refined carbs, increase movement' if insulin>5 else 'Optimal insulin sensitivity'}",
            PANEL_META)

    if glucose and insulin:
        homa = (glucose * insulin) / 405
        flag = "high" if homa > 2.0 else ("suboptimal" if homa > 1.5 else "optimal")
        add("HOMA-IR", homa, "",
            "<1.5 optimal; <2.0 acceptable; >2.0 insulin resistance",
            flag,
            f"HOMA-IR {round(homa,2)}: {'Significant IR — target lifestyle, sleep, blood sugar protocol' if homa>2 else 'Mild IR pattern — worth addressing early' if homa>1.5 else 'Good insulin sensitivity'}",
            PANEL_META, computed=True)

    if hba1c is not None:
        flag = "high" if hba1c >= 5.7 else ("suboptimal" if hba1c >= 5.4 else "optimal")
        add("HbA1c", hba1c, "%",
            "<5.4% FM optimal; 5.4–5.7% borderline; ≥5.7% pre-diabetic",
            flag,
            f"HbA1c {hba1c}%: {'Pre-diabetic range — urgent dietary and lifestyle intervention' if hba1c>=5.7 else 'Borderline — monitor trend, tighten carb quality' if hba1c>=5.4 else 'FM optimal'}",
            PANEL_META)

    if uric_acid is not None:
        flag = "high" if uric_acid > 5.5 else ("suboptimal" if uric_acid > 4.5 else "optimal")
        add("Uric acid", uric_acid, "mg/dL",
            "<4.5 FM optimal; >5.5 signals metabolic burden (women)",
            flag,
            f"Uric acid {uric_acid}: {'Elevated — linked to IR, gout risk, kidney stress; reduce fructose, purine load' if uric_acid>5.5 else 'Borderline — watch fructose and alcohol intake' if uric_acid>4.5 else 'Good metabolic clearance'}",
            PANEL_META)

    # ══════════════════════════════════════════════════════════════════════════
    # 2. THYROID
    # ══════════════════════════════════════════════════════════════════════════
    tsh = _find(extracted_labs,
        r"\btsh\b|thyroid.stimulating.hormone|thyrotropin")
    t4_free = _find(extracted_labs,
        r"free t4|ft4\b|t4.free|free thyroxine|fT4")
    t3_free = _find(extracted_labs,
        r"free t3|ft3\b|t3.free|free triiodothyronine|fT3")
    t4_total = _find(extracted_labs,
        r"total t4|t4.total|thyroxine\b")
    t3_total = _find(extracted_labs,
        r"total t3|t3.total|triiodothyronine\b")
    rt3 = _find(extracted_labs,
        r"reverse t3|rt3\b|r-t3|rT3")
    _TPO_PAT = r"tpo\b|thyroid.peroxidase|anti.tpo|thyroid peroxidase antibod|anti-tpo"
    _TGAB_PAT = r"tgab|thyroglobulin.antibod|anti.tg\b|anti-thyroglobulin|tg.antibod"
    tpo_ab = _find(extracted_labs, _TPO_PAT)
    tgab = _find(extracted_labs, _TGAB_PAT)

    if tsh is not None:
        flag = "high" if tsh > 2.5 else ("low" if tsh < 0.5 else "optimal")
        # Pre-3.12 Python doesn't allow backslashes inside f-string expressions
        # (PEP 701) — extract the conditional so apostrophes can sit in plain
        # double-quoted string literals.
        tsh_msg = (
            "Elevated — thyroid underfunction or Hashimoto's; target <2.5"
            if tsh > 2.5
            else "Suppressed — assess for hyperthyroid pattern"
            if tsh < 0.5
            else "FM optimal"
        )
        add("TSH", tsh, "mIU/L",
            "0.5–2.5 FM optimal (lab: 0.4–4.0)",
            flag,
            f"TSH {tsh}: {tsh_msg}",
            PANEL_THYROID)

    if t4_free is not None:
        flag = "low" if t4_free < 1.0 else ("optimal" if t4_free <= 1.8 else "suboptimal")
        add("Free T4", t4_free, "ng/dL",
            "1.1–1.8 FM optimal",
            flag,
            f"fT4 {t4_free}: {'Low — insufficient thyroid hormone production' if t4_free<1.0 else 'FM optimal' if t4_free<=1.8 else 'High — verify dosing or hyperthyroid risk'}",
            PANEL_THYROID)

    if t3_free is not None:
        flag = "low" if t3_free < 3.2 else ("optimal" if t3_free <= 4.4 else "suboptimal")
        add("Free T3", t3_free, "pg/mL",
            "3.2–4.4 FM optimal (upper third of range)",
            flag,
            f"fT3 {t3_free}: {'Low active hormone — poor conversion or substrate deficiency; check selenium, iron, cortisol' if t3_free<3.2 else 'FM optimal — good active T3' if t3_free<=4.4 else 'High — verify'}",
            PANEL_THYROID)

    if rt3 is not None:
        flag = "high" if rt3 > 20 else ("suboptimal" if rt3 > 15 else "optimal")
        add("Reverse T3", rt3, "ng/dL",
            "<15 optimal; >20 elevated",
            flag,
            f"rT3 {rt3}: {'Elevated — cortisol burden, inflammation or conversion block shunting T4 → rT3' if rt3>20 else 'Borderline — monitor stress, inflammation' if rt3>15 else 'Acceptable'}",
            PANEL_THYROID)

    # Antibody cutoffs vary HUGELY by assay (TgAb negative threshold ranges
    # from <4 to <115 IU/mL across labs). A hardcoded number false-flags —
    # e.g. Sudarshan's TgAb 5.31 against this assay's "Up to 95" range is
    # NEGATIVE, but a hardcoded ">1" called it autoimmune. So: use the
    # assay's OWN reference range when the upload carries one; fall back to
    # a conservative generic only when no range is on file.
    if tpo_ab is not None:
        upper = _range_upper(_find_range(extracted_labs, _TPO_PAT))
        cutoff = upper if upper is not None else 34.0
        positive = tpo_ab > cutoff
        flag = "high" if positive else "optimal"
        tpo_msg = (
            "Elevated — confirms Hashimoto's; address gut, immune, stress, gluten"
            if positive
            else "Negative"
        )
        add("TPO antibodies", tpo_ab, "IU/mL",
            (f"lab negative <{cutoff:g}" if upper is not None
             else "<34 negative (generic — no lab range supplied)"),
            flag,
            f"TPO Ab {tpo_ab}: {tpo_msg}",
            PANEL_THYROID)

    if tgab is not None:
        upper = _range_upper(_find_range(extracted_labs, _TGAB_PAT))
        cutoff = upper if upper is not None else 40.0
        positive = tgab > cutoff
        flag = "high" if positive else "optimal"
        tgab_msg = (
            "Positive — autoimmune thyroid; assess for Hashimoto's or Graves'"
            if positive
            else "Negative"
        )
        add("Thyroglobulin Ab (TgAb)", tgab, "IU/mL",
            (f"lab negative <{cutoff:g}" if upper is not None
             else "<40 negative (generic — no lab range supplied)"),
            flag,
            f"TgAb {tgab}: {tgab_msg}",
            PANEL_THYROID)

    # Total T3 / Total T4 — surfaced as their own markers when present.
    # Flagged against the assay's range when supplied (Total ranges are
    # assay-dependent), else a standard adult range. Free T3/T4 remain the
    # preferred FM assessment — call that out in the interpretation.
    if t4_total is not None:
        upper = _range_upper(_find_range(extracted_labs, r"total t4|t4.total|thyroxine\b"))
        hi = upper if upper is not None else 12.5
        flag = "high" if t4_total > hi else ("low" if t4_total < 4.5 else "optimal")
        add("Total T4", t4_total, "ug/dL",
            (f"lab range up to {hi:g}" if upper is not None else "~4.5–12.5 typical"),
            flag,
            f"Total T4 {t4_total}: "
            + ("High — verify" if t4_total > hi
               else "Low" if t4_total < 4.5
               else "Within lab range — Free T4 preferred for FM assessment"),
            PANEL_THYROID)

    if t3_total is not None:
        upper = _range_upper(_find_range(extracted_labs, r"total t3|t3.total|triiodothyronine\b"))
        hi = upper if upper is not None else 200.0
        flag = "high" if t3_total > hi else ("low" if t3_total < 70 else "optimal")
        add("Total T3", t3_total, "ng/dL",
            (f"lab range up to {hi:g}" if upper is not None else "~70–200 typical"),
            flag,
            f"Total T3 {t3_total}: "
            + ("High — verify" if t3_total > hi
               else "Low" if t3_total < 70
               else "Within lab range — Free T3 preferred for FM assessment"),
            PANEL_THYROID)

    # T3/T4 conversion ratio — FREE values ONLY. Total T3 (ng/dL) and Total
    # T4 (ug/dL) are different units, so their quotient (~12) is meaningless.
    # Previously `t4_free or t4_total` let Total values through and produced a
    # bogus "verify units" ratio. NOTE: the AI extractor path hits the SAME
    # code — this fix corrects both manual + API ingestion.
    if t4_free and t3_free and t4_free > 0:
        # The 0.2–0.35 band is a MOLAR ratio (pmol/L ÷ pmol/L). Indian labs
        # mostly report FT4 in ng/dL (0.9–1.8) and FT3 in pg/mL — dividing those
        # raw gives ~3 and read as "hyperthyroid" for a client with a TSH of
        # 12.7 (cl-906, Oct 2026). FT4 in pmol/L runs ~10–25, so an FT4 under 5
        # means the conventional units: convert both (FT3 ×1.536, FT4 ×12.87).
        if t4_free < 5:
            conv = (t3_free * 1.536) / (t4_free * 12.87)
        else:
            conv = t3_free / t4_free
        flag = "low" if conv < 0.2 else ("optimal" if conv < 0.35 else "suboptimal")
        if conv < 0.2:
            conv_msg = "Poor conversion — check selenium, zinc, cortisol, liver, iron"
        elif conv < 0.35:
            conv_msg = "Good conversion efficiency"
        elif tsh is not None and tsh > 2.5:
            conv_msg = ("High ratio with a raised TSH — the thyroid is being pushed to "
                        "make relatively more T3; conversion is not the limiting step, "
                        "hormone output is")
        else:
            conv_msg = "High — check units, T3 medication, or a hyperthyroid pattern"
        add("T3/T4 conversion ratio", conv, "",
            "0.2–0.35 fT3/fT4 (molar); low = poor peripheral conversion",
            flag,
            f"T3/T4 {round(conv,3)}: {conv_msg}",
            PANEL_THYROID, computed=True)

    if tsh is not None and t3_free and t3_free > 0:
        tsh_ft3 = tsh / t3_free
        flag = "high" if tsh_ft3 > 0.8 else ("suboptimal" if tsh_ft3 > 0.4 else "optimal")
        add("TSH/fT3 ratio", round(tsh_ft3, 3), "",
            "<0.4 optimal; elevated = pituitary compensating for low T3",
            flag,
            f"TSH/fT3 {round(tsh_ft3,3)}: {'High — TSH driving hard for poor T3 output; conversion issue' if tsh_ft3>0.8 else 'Good pituitary-thyroid response' if tsh_ft3<0.4 else 'Borderline'}",
            PANEL_THYROID, computed=True)

    if t3_free and rt3 and rt3 > 0:
        ft3_rt3 = t3_free / rt3
        flag = "low" if ft3_rt3 < 20 else "optimal"
        add("fT3/rT3 ratio", ft3_rt3, "",
            ">20 optimal",
            flag,
            f"fT3/rT3 {round(ft3_rt3,1)}: {'Elevated rT3 — cortisol burden or conversion block; address adrenal/liver/inflammation' if ft3_rt3<20 else 'Acceptable ratio'}",
            PANEL_THYROID, computed=True)

    # ══════════════════════════════════════════════════════════════════════════
    # 3. LIVER FUNCTION
    # ══════════════════════════════════════════════════════════════════════════
    alt = _find(extracted_labs,
        r"\balt\b|sgpt\b|alanine.amino|alanine transaminase")
    ast = _find(extracted_labs,
        r"\bast\b|sgot\b|aspartate.amino|aspartate transaminase")
    ggt = _find(extracted_labs,
        r"\bggtp?\b|gamma.glutamyl|gamma-gt|γ-gt")
    alp = _find(extracted_labs,
        r"\balp\b|alkaline phosphatase|alk phos")
    bilirubin_total = _find(extracted_labs,
        r"total bilirubin|bilirubin.total|t.bili\b")
    bilirubin_direct = _find(extracted_labs,
        r"direct bilirubin|conjugated bilirubin|d.bili\b")
    # Both patterns must exclude the "Albumin/Globulin Ratio" row (matches
    # either bare word) and any *binding* globulin — SHBG, thyroxine-binding
    # globulin, cortisol-binding globulin — which are unrelated transport
    # proteins reported in nmol/L. Without the guard, cl-022's SHBG of 67.74
    # was read as her globulin (real value 2.52 g/dL), which also poisoned the
    # A/G ratio. Same class of collision as the serum-vs-RBC magnesium split.
    _NOT_RATIO_OR_BINDING = r"^(?!.*ratio)(?!.*binding)(?!.*\bshbg\b)"
    albumin = _find(extracted_labs,
        _NOT_RATIO_OR_BINDING + r".*\balbumin\b")
    globulin = _find(extracted_labs,
        _NOT_RATIO_OR_BINDING + r".*\bglobulin\b")

    if alt is not None:
        flag = "high" if alt > 25 else ("suboptimal" if alt > 20 else "optimal")
        add("ALT (liver cells)", alt, "U/L",
            "<20 FM optimal (lab: <40 women, <56 men)",
            flag,
            f"ALT {alt}: {'Elevated — liver cell stress; investigate NAFLD, toxin load, medication burden' if alt>25 else 'Borderline — reduce alcohol, fructose; support methylation' if alt>20 else 'FM optimal'}",
            PANEL_LIVER)

    if ast is not None:
        flag = "high" if ast > 25 else ("suboptimal" if ast > 20 else "optimal")
        add("AST (liver/muscle)", ast, "U/L",
            "<20 FM optimal (lab: <40)",
            flag,
            f"AST {ast}: {'Elevated — liver or muscle damage; assess with ALT ratio' if ast>25 else 'Borderline' if ast>20 else 'FM optimal'}",
            PANEL_LIVER)

    if ast and alt and alt > 0:
        ast_alt = ast / alt
        flag = "high" if ast_alt > 2.0 else ("optimal" if ast_alt <= 1.2 else "suboptimal")
        add("AST/ALT ratio", ast_alt, "",
            "<1.0 with normal enzymes; >2.0 = alcoholic pattern; <1.0 with both elevated = NAFLD",
            flag,
            f"AST/ALT {round(ast_alt,2)}: {'>2 suggests alcoholic hepatitis; assess alcohol intake' if ast_alt>2 else 'Pattern consistent with NAFLD/NASH — assess metabolic risk' if ast_alt<1 and (ast>20 or alt>20) else 'Normal ratio'}",
            PANEL_LIVER, computed=True)

    if ggt is not None:
        flag = "high" if ggt > 25 else ("suboptimal" if ggt > 16 else "optimal")
        add("GGT (oxidative stress)", ggt, "U/L",
            "<16 FM optimal (highly sensitive to liver fat, alcohol, toxin load)",
            flag,
            f"GGT {ggt}: {'Elevated — oxidative stress, liver fat or alcohol load; check glutathione status' if ggt>25 else 'Borderline elevated — monitor lifestyle factors' if ggt>16 else 'FM optimal — good antioxidant/liver status'}",
            PANEL_LIVER)

    if alp is not None:
        flag = "low" if alp < 40 else ("high" if alp > 100 else "optimal")
        add("ALP (bile/bone)", alp, "U/L",
            "40–100 FM optimal; very low (<40) = zinc deficiency",
            flag,
            f"ALP {alp}: {'Very low — likely zinc deficiency; check zinc and B6' if alp<40 else 'Elevated — bile duct stress, bone turnover or liver issue' if alp>100 else 'FM optimal'}",
            PANEL_LIVER)

    if bilirubin_total is not None:
        flag = "high" if bilirubin_total > 1.2 else ("low" if bilirubin_total < 0.3 else "optimal")
        bili_msg = (
            "Elevated — assess haemolysis, liver disease, or bile obstruction"
            if bilirubin_total > 1.2
            else "Very low"
            if bilirubin_total < 0.3
            else "Normal; mild elevation may reflect Gilbert's syndrome (protective)"
        )
        add("Total bilirubin", bilirubin_total, "mg/dL",
            "0.3–1.2 mg/dL; mild elevation (Gilbert's) can be protective",
            flag,
            f"Bilirubin {bilirubin_total}: {bili_msg}",
            PANEL_LIVER)

    if albumin is not None:
        flag = "low" if albumin < 4.0 else ("optimal" if albumin >= 4.5 else "suboptimal")
        add("Albumin", albumin, "g/dL",
            "≥4.5 FM optimal; <4.0 = liver synthetic decline or protein insufficiency",
            flag,
            f"Albumin {albumin}: {'Low — liver synthetic function declining or protein intake insufficient' if albumin<4.0 else 'FM optimal — good liver synthesis and protein status' if albumin>=4.5 else 'Low-normal — optimise protein intake, assess gut absorption'}",
            PANEL_LIVER)

    if globulin is not None:
        flag = "high" if globulin > 3.5 else ("low" if globulin < 2.0 else "optimal")
        add("Globulin (immune load)", globulin, "g/dL",
            "2.0–3.5 g/dL; elevated = chronic infection/inflammation burden",
            flag,
            f"Globulin {globulin}: {'Elevated — ongoing immune activation, chronic infection or inflammation' if globulin>3.5 else 'Low — possible immune suppression or protein deficiency' if globulin<2.0 else 'Normal immune and protein balance'}",
            PANEL_LIVER)

    if albumin and globulin and globulin > 0:
        ag_ratio = albumin / globulin
        flag = "low" if ag_ratio < 1.5 else "optimal"
        add("Albumin/Globulin ratio", ag_ratio, "",
            ">1.5 optimal; low = inflammation or immune burden dominating",
            flag,
            f"A/G {round(ag_ratio,2)}: {'Low — chronic immune activation or inflammation exceeding liver synthesis' if ag_ratio<1.5 else 'Good balance of liver synthesis to immune protein'}",
            PANEL_LIVER, computed=True)

    # ══════════════════════════════════════════════════════════════════════════
    # 4. KIDNEY FUNCTION
    # ══════════════════════════════════════════════════════════════════════════
    uacr = _find(extracted_labs,
        r"\buacr\b|urine.albumin.creatinine|albumin.creatinine.ratio|microalbumin.creatinine|albumin/creatinine|ua.cr")
    bun = _find(extracted_labs,
        r"\bbun\b|blood urea nitrogen|urea nitrogen|serum urea")
    # Anchored negative lookaheads so a urine microalbumin/creatinine RATIO
    # (or spot urine creatinine) can't leak its value into serum creatinine.
    creatinine = _find(extracted_labs,
        r"^(?!.*urine)(?!.*ratio)(?!.*albumin)(?!.*clearance).*\bcreatinine\b")
    egfr = _find(extracted_labs,
        r"\begfr\b|glomerular filtration|estimated gfr|gfr\b")

    if bun is not None:
        flag = "high" if bun > 20 else ("low" if bun < 10 else "optimal")
        add("BUN (urea nitrogen)", bun, "mg/dL",
            "10–18 FM optimal; >20 = dehydration/catabolism; <10 = protein deficiency/liver",
            flag,
            f"BUN {bun}: {'Elevated — dehydration, high-protein catabolism, or early kidney stress' if bun>20 else 'Low — possible protein deficiency, poor liver urea synthesis' if bun<10 else 'FM optimal'}",
            PANEL_KIDNEY)

    if creatinine is not None:
        # Use women's range as default (more conservative); could add sex-aware logic later
        flag = "high" if creatinine > 1.1 else ("low" if creatinine < 0.6 else "optimal")
        add("Creatinine", creatinine, "mg/dL",
            "0.6–1.1 FM optimal (varies by muscle mass)",
            flag,
            f"Creatinine {creatinine}: {'Elevated — kidney filtration stress; assess eGFR trend' if creatinine>1.1 else 'Very low — low muscle mass; assess protein intake and muscle health' if creatinine<0.6 else 'Normal range'}",
            PANEL_KIDNEY)

    if bun and creatinine and creatinine > 0:
        bun_cr = bun / creatinine
        flag = "high" if bun_cr > 20 else ("low" if bun_cr < 10 else "optimal")
        add("BUN/Creatinine ratio", bun_cr, "",
            "10–16 optimal; >20 = dehydration/catabolism; <10 = liver issue/malnutrition",
            flag,
            f"BUN/Cr {round(bun_cr,1)}: {'High — likely dehydration or protein catabolism; increase hydration and assess protein balance' if bun_cr>20 else 'Low — possible liver under-function or protein insufficiency' if bun_cr<10 else 'Good kidney-liver balance'}",
            PANEL_KIDNEY, computed=True)

    if egfr is not None:
        flag = "low" if egfr < 60 else ("suboptimal" if egfr < 90 else "optimal")
        add("eGFR", egfr, "mL/min/1.73m²",
            ">90 optimal; 60–89 = mild reduction (watch trend); <60 = moderate decline",
            flag,
            f"eGFR {egfr}: {'Moderate kidney decline — refer; avoid nephrotoxic supplements' if egfr<60 else 'Mild reduction — monitor trend, optimise hydration and blood pressure' if egfr<90 else 'Good filtration capacity'}",
            PANEL_KIDNEY)

    # UACR — Urine Albumin/Creatinine Ratio. Earliest detectable signal of
    # kidney + vascular endothelial damage in HTN / metabolic syndrome /
    # diabetes. Often missed on routine India panels.
    if uacr is not None:
        flag = "high" if uacr > 30 else ("suboptimal" if uacr > 10 else "optimal")
        add("UACR (kidney + vascular)", uacr, "mg/g",
            "<10 FM optimal; 10–30 early endothelial stress; 30–300 microalbuminuria; >300 overt",
            flag,
            f"UACR {uacr}: {'Microalbuminuria — early kidney injury + endothelial dysfunction; common in HTN, IR, T2D. Repeat in 4–6 weeks; aggressively control BP, glucose, inflammation' if uacr>30 else 'Above FM optimal — early vascular / glycation stress; modifiable with lifestyle + supplements' if uacr>10 else 'Healthy endothelial + kidney signal'}",
            PANEL_KIDNEY)

    # ══════════════════════════════════════════════════════════════════════════
    # 5. CARDIOVASCULAR & LIPIDS
    # ══════════════════════════════════════════════════════════════════════════
    tc = _find(extracted_labs,
        # include the reversed "Cholesterol - Total" / "Cholesterol, Total"
        # ordering some Indian labs print (2026-07-02: was silently missed).
        r"total cholesterol|cholesterol.total|cholesterol[\s:/,\-]+total|\btotal.chol\b|\bchol\b")
    # NOTE the \b before every `ldl` alternative — without it, the
    # `ldl.cholesterol` pattern matches the substring "ldl cholesterol"
    # INSIDE "vldl cholesterol", so a VLDL result silently overwrites LDL.
    # (Caught 2026-05-20: Sudarshan's LDL 172.2 showed as VLDL's 20.8.)
    # Lipid panels often include derived RATIO rows (TG:HDL, LDL/HDL, TC/HDL,
    # Non-HDL) as their own lab_values. Bare \bhdl\b / \btg\b / \bldl\b match
    # those ratio names and grab the ratio value instead of the real marker
    # (e.g. TG:HDL=3.826 captured as HDL). Negative-lookahead "ratio" + the
    # cross-marker names so each primary lipid only matches its own row.
    # Exclude ratio rows two ways: the literal word "ratio", AND any name with
    # ":" or "/" (e.g. "TG:HDL", "LDL/HDL" — ratios that omit the word), plus
    # the cross-marker names so each primary lipid matches only its own row.
    ldl = _find(extracted_labs,
        r"^(?!.*ratio)(?!.*[:/])(?!.*\bhdl\b)(?!.*\bvldl\b).*(?:\bldl\b|low.density.lipoprotein)")
    hdl = _find(extracted_labs,
        r"^(?!.*ratio)(?!.*[:/])(?!.*non.?hdl).*(?:\bhdl\b|high.density.lipoprotein)")
    tg = _find(extracted_labs,
        # \btg\b also matches "anti-tg" (thyroglobulin antibody) and "tg:hdl"
        # — exclude antibody/thyroid/ratio names so TG only grabs triglycerides.
        r"^(?!.*ratio)(?!.*[:/])(?!.*hdl)(?!.*anti)(?!.*thyroglob).*(?:\btriglyceride|\btg\b)")
    homocysteine = _find(extracted_labs,
        r"homocysteine|hcy\b|plasma homocysteine")
    hscrp = _find(extracted_labs,
        r"hs.crp|high.sensitivity.crp|hscrp|high sensitivity c.reactive|hs-crp"
        r"|c.?reactive.*sensitiv|sensitiv.*c.?reactive|crp.*sensitiv")
    # "apolipoprotein.b\b" only tolerates exactly ONE separator char between
    # the words — real lab names vary more than that ("Apolipoproteins B"
    # has 2 chars: the plural "s" + space; "Apolipoprotein - A1" has 3:
    # space-hyphen-space). Widened to an optional plural "s" + any run of
    # whitespace/hyphen/colon/slash separators (caught 2026-07-02: both
    # patterns silently missed real client lab values under the old regex).
    apob = _find(extracted_labs,
        r"\bapo[ -]?b\b|apolipoproteins?[\s\-:/]*b\b|apob\b")
    apoa1 = _find(extracted_labs,
        r"\bapo[ -]?a[ -]?1\b|apolipoproteins?[\s\-:/]*a1?\b|apoa1?\b")
    lpa = _find(extracted_labs,
        r"\blp\(?a\)?\b|lipoprotein.{0,5}a\b|lipoprotein.little.a")

    if tc is not None:
        flag = "low" if tc < 160 else ("high" if tc > 240 else "optimal")
        add("Total cholesterol", tc, "mg/dL",
            "160–220 FM optimal; <160 may impair hormone synthesis",
            flag,
            f"TC {tc}: {'Low — may impair steroid hormone, cell membrane and vitamin D synthesis' if tc<160 else 'Elevated — assess particle size, LDL oxidation, inflammation' if tc>240 else 'FM optimal range'}",
            PANEL_CARDIO)

    if ldl is not None:
        flag = "high" if ldl > 130 else ("suboptimal" if ldl > 100 else "optimal")
        ldl_msg = (
            "Elevated — especially if hsCRP also high (oxidised LDL risk)"
            if ldl > 130
            else "Borderline — optimise lipid quality, not just quantity"
            if ldl > 100
            else "FM optimal; ensure it's not artificially low from low cholesterol synthesis"
        )
        add("LDL cholesterol", ldl, "mg/dL",
            "<100 FM optimal; context matters — assess alongside particle size and inflammation",
            flag,
            f"LDL {ldl}: {ldl_msg}",
            PANEL_CARDIO)

    if hdl is not None:
        flag = "low" if hdl < 50 else ("optimal" if hdl >= 60 else "suboptimal")
        add("HDL cholesterol", hdl, "mg/dL",
            ">60 FM optimal (protective); <50 women/<40 men = low",
            flag,
            f"HDL {hdl}: {'Low — reduced reverse cholesterol transport; increase exercise, healthy fats, reduce refined carbs' if hdl<50 else 'FM optimal — strong cardioprotective marker' if hdl>=60 else 'Acceptable — room to improve with lifestyle'}",
            PANEL_CARDIO)

    if tg is not None:
        flag = "high" if tg > 150 else ("suboptimal" if tg > 100 else "optimal")
        add("Triglycerides", tg, "mg/dL",
            "<100 FM optimal; <150 lab normal; >150 = metabolic burden",
            flag,
            f"TG {tg}: {'Elevated — IR/carb-driven; reduce sugar, refined carbs, alcohol; address insulin' if tg>150 else 'Borderline — optimise carb quality and timing' if tg>100 else 'FM optimal'}",
            PANEL_CARDIO)

    if tg and hdl and hdl > 0:
        tg_hdl = tg / hdl
        flag = "high" if tg_hdl > 3.5 else ("suboptimal" if tg_hdl > 2.0 else "optimal")
        add("TG/HDL ratio", tg_hdl, "",
            "<2.0 optimal; >3.5 = high IR and CV risk",
            flag,
            f"TG/HDL {round(tg_hdl,2)}: {'High — strong insulin resistance signal; likely small dense LDL' if tg_hdl>3.5 else 'Moderate risk — lifestyle intervention indicated' if tg_hdl>2.0 else 'Good metabolic marker — low IR risk'}",
            PANEL_CARDIO, computed=True)

    if ldl and hdl and hdl > 0:
        ldl_hdl = ldl / hdl
        flag = "high" if ldl_hdl > 3.5 else ("suboptimal" if ldl_hdl > 2.5 else "optimal")
        add("LDL/HDL ratio", ldl_hdl, "",
            "<2.5 optimal; >3.5 elevated risk",
            flag,
            f"LDL/HDL {round(ldl_hdl,2)}: {'Unfavourable — excess LDL relative to reverse transport capacity' if ldl_hdl>3.5 else 'Borderline' if ldl_hdl>2.5 else 'Favourable ratio'}",
            PANEL_CARDIO, computed=True)

    if tc and hdl and hdl > 0:
        tc_hdl = tc / hdl
        flag = "high" if tc_hdl > 5.0 else ("suboptimal" if tc_hdl > 4.0 else "optimal")
        add("TC/HDL ratio", tc_hdl, "",
            "<4.0 optimal; >5.0 = elevated CV risk",
            flag,
            f"TC/HDL {round(tc_hdl,2)}: {'High CV risk — prioritise HDL-raising strategies' if tc_hdl>5 else 'Borderline — room to improve' if tc_hdl>4 else 'Favourable cardiac risk ratio'}",
            PANEL_CARDIO, computed=True)

    if tg and ldl and hdl:
        non_hdl = (tc or ldl + hdl + tg / 5) - hdl  # approximate if TC not available
        if tc:
            non_hdl_val = tc - hdl
            flag = "high" if non_hdl_val > 160 else ("suboptimal" if non_hdl_val > 130 else "optimal")
            add("Non-HDL cholesterol", non_hdl_val, "mg/dL",
                "<130 optimal; better predictor than LDL alone in IR patients",
                flag,
                f"Non-HDL {non_hdl_val}: {'Elevated — better reflects atherogenic lipoprotein burden' if non_hdl_val>160 else 'Borderline' if non_hdl_val>130 else 'FM optimal'}",
                PANEL_CARDIO, computed=True)

    # ApoB — single best atherogenic-particle marker for South Asians (better than LDL-C alone)
    if apob is not None:
        flag = "high" if apob > 100 else ("suboptimal" if apob > 80 else "optimal")
        add("ApoB (atherogenic particles)", apob, "mg/dL",
            "<80 FM optimal; 80–100 borderline; >100 high CV risk",
            flag,
            f"ApoB {apob}: {'High — atherogenic particle load elevated. Better than LDL-C for South Asian risk; address insulin, inflammation, diet' if apob>100 else 'Borderline — track quarterly; treat if other risks (hsCRP, TG/HDL, family hx)' if apob>80 else 'FM optimal — low atherogenic particle burden'}",
            PANEL_CARDIO)

    # ApoB / ApoA1 ratio — single most powerful lipoprotein risk metric (INTERHEART)
    if apob is not None and apoa1 is not None and apoa1 > 0:
        apob_a1 = apob / apoa1
        flag = "high" if apob_a1 > 0.9 else ("suboptimal" if apob_a1 > 0.7 else "optimal")
        add("ApoB / ApoA1 ratio", apob_a1, "",
            "<0.7 optimal (M); <0.6 optimal (F); >0.9 high risk",
            flag,
            f"ApoB/A1 {round(apob_a1,2)}: {'High — strongest single CV risk predictor in INTERHEART; address LDL particle burden + reverse transport' if apob_a1>0.9 else 'Borderline — reduce small dense LDL via TG control, raise HDL functionality' if apob_a1>0.7 else 'Favourable lipoprotein balance'}",
            PANEL_CARDIO, computed=True)

    # Lipoprotein(a) — genetic atherogenic marker, independent of LDL
    if lpa is not None:
        flag = "high" if lpa > 50 else ("suboptimal" if lpa > 30 else "optimal")
        add("Lp(a)", lpa, "mg/dL",
            "<30 optimal; 30–50 borderline; >50 high (genetic)",
            flag,
            f"Lp(a) {lpa}: {'High genetic CV risk — independent of LDL. Aggressive control of all other CV risks; family screening' if lpa>50 else 'Borderline — tighten all modifiable CV risks' if lpa>30 else 'Low genetic atherogenic burden'}",
            PANEL_CARDIO)

    # Atherogenic Index of Plasma (AIP) — log10(TG/HDL) — strongly correlates with small dense LDL
    if tg is not None and hdl is not None and hdl > 0:
        import math as _math
        try:
            # AIP is defined on MOLAR concentrations. Indian labs report TG and
            # HDL in mg/dL; log10 of the mg/dL quotient overstates AIP by
            # log10(38.67/88.57) ≈ 0.36 (cl-906: 0.63 shown vs 0.27 true).
            # mmol/L values are small (TG < ~20, HDL < ~5).
            if tg > 20 or hdl > 5:
                aip = _math.log10((tg / 88.57) / (hdl / 38.67))
            else:
                aip = _math.log10(tg / hdl)
            flag = "high" if aip > 0.24 else ("suboptimal" if aip > 0.1 else "optimal")
            add("Atherogenic Index of Plasma (AIP)", aip, "",
                "<0.10 low risk; 0.10–0.24 medium; >0.24 high (small dense LDL)",
                flag,
                f"AIP {round(aip,2)}: {'High — small dense LDL pattern likely; address IR + TG aggressively' if aip>0.24 else 'Medium — improve TG / HDL balance' if aip>0.1 else 'Low atherogenic plasma profile'}",
                PANEL_CARDIO, computed=True)
        except Exception:
            pass

    if hscrp is not None:
        flag = "high" if hscrp > 3.0 else ("suboptimal" if hscrp > 1.0 else "optimal")
        add("hsCRP (inflammation)", hscrp, "mg/L",
            "<1.0 optimal; 1.0–3.0 moderate; >3.0 high systemic inflammation",
            flag,
            f"hsCRP {hscrp}: {'Significant systemic inflammation — identify and address root drivers (gut, sleep, infection, stress)' if hscrp>3 else 'Mild-moderate inflammation — anti-inflammatory protocol indicated' if hscrp>1 else 'Low systemic inflammation'}",
            PANEL_CARDIO)

    if homocysteine is not None:
        flag = "high" if homocysteine > 10 else ("suboptimal" if homocysteine > 7 else "optimal")
        add("Homocysteine", homocysteine, "μmol/L",
            "<7 FM optimal; 7–10 suboptimal; >10 elevated methylation burden",
            flag,
            f"Homocysteine {homocysteine}: {'Elevated — methylation burden; assess B12, folate, B6, MTHFR; cardiovascular and cognitive risk' if homocysteine>10 else 'Suboptimal — optimise methylation nutrients (B12, folate, B6, riboflavin)' if homocysteine>7 else 'Optimal methylation status'}",
            PANEL_CARDIO)

    # ══════════════════════════════════════════════════════════════════════════
    # 6. IRON & BLOOD
    # ══════════════════════════════════════════════════════════════════════════
    # Whole-blood haemoglobin ONLY. "HbA1c (Glycosylated Hemoglobin)", MCH
    # ("mean corpuscular hemoglobin"), MCHC and Hb electrophoresis fractions all
    # contain the word; without the lookaheads a same-day HbA1c of 5.8 % read as
    # a haemoglobin of 5.8 g/dL (severe anaemia) on a real client.
    hemoglobin = _find(extracted_labs,
        r"^(?!.*a1c)(?!.*glyc)(?!.*corpuscular)(?!.*mean cell)(?!.*\bmchc?\b)"
        r"(?!.*concentration)(?!.*electrophoresis)(?!.*\ba2\b)(?!.*fetal)(?!.*\bhbf\b)"
        r"(?!.*urine).*(?:hemoglobin|haemoglobin|\bhgb\b|\bhb\b)")
    ferritin = _find(extracted_labs,
        r"\bferritin\b|serum ferritin")
    iron = _find(extracted_labs,
        r"serum iron|s-iron|\biron\b(?!\s*binding)")
    tibc = _find(extracted_labs,
        r"\btibc\b|total iron binding|iron binding capacity")
    mcv = _find(extracted_labs,
        r"\bmcv\b|mean corpuscular volume|mean cell volume")
    # Claims every RDW row (CV and SD), but reads only RDW-CV (%) as "RDW":
    # many reports also print RDW-SD in fL (~39-46), which read as CV always
    # looked "high". RDW-SD is surfaced as its own marker below.
    _find(extracted_labs,
        r"\brdw\b|red.cell.distribution|red.cell.width|rdw[ -]?cv|rdw[ -]?sd")
    rdw = _rdw_cv(extracted_labs)
    rdw_sd = _rdw_sd(extracted_labs)
    mch = _find(extracted_labs,
        r"\bmch\b|mean corpuscular hemoglobin|mean cell hemoglobin")
    wbc = _find(extracted_labs,
        r"\bwbc\b|white blood cell|total leucocyte|\btlc\b|leukocyte count")
    neutrophils = _find(extracted_labs,
        r"\bneutrophil|absolute neutrophil|\banc\b")
    lymphocytes = _find(extracted_labs,
        r"\blymphocyte|absolute lymphocyte")
    platelets = _find(extracted_labs,
        r"\bplatelet|\bplt\b|platelet count")

    if hemoglobin is not None:
        # Use women's optimal range (most common FM patient base); could be sex-aware
        if hemoglobin < 12.0:
            flag = "low"
            hgb_interp = "Low — anaemia; assess iron, B12, folate; fatigue, brain fog, poor oxygenation"
        elif hemoglobin <= 14.5:
            flag = "optimal"
            hgb_interp = "FM optimal range"
        elif hemoglobin <= 16.0:
            flag = "suboptimal"
            hgb_interp = f"Above typical women's range ({hemoglobin}) — assess haemoconcentration / dehydration; for men within optimal upper-normal"
        else:
            flag = "high"
            hgb_interp = f"High ({hemoglobin}) — polycythemia screen: hydration status, smoking, sleep apnoea, EPO, JAK2; recheck CBC + ferritin + EPO"
        add("Hemoglobin", hemoglobin, "g/dL",
            "12.0–14.5 women; 13.5–16.0 men (FM optimal upper-normal); >16 = polycythemia signal",
            flag,
            f"Hgb {hemoglobin}: {hgb_interp}",
            PANEL_IRON)

    if ferritin is not None:
        flag = "low" if ferritin < 30 else ("high" if ferritin > 200 else ("optimal" if ferritin >= 50 else "suboptimal"))
        add("Ferritin (iron stores)", ferritin, "ng/mL",
            "50–150 FM optimal; <30 = iron deficiency even if Hgb normal; >200 = inflammation/overload",
            flag,
            f"Ferritin {ferritin}: {'Iron deficiency — supplement; will cause fatigue, hair loss, brain fog before anaemia develops' if ferritin<30 else 'High — inflammatory marker or iron overload; assess hsCRP, haemochromatosis' if ferritin>200 else 'FM optimal' if ferritin>=50 else 'Low-normal — consider supplementation if symptomatic'}",
            PANEL_IRON)

    if iron is not None:
        flag = "low" if iron < 60 else ("high" if iron > 170 else "optimal")
        add("Serum iron", iron, "μg/dL",
            "60–170 μg/dL",
            flag,
            f"Serum iron {iron}: {'Low — iron deficiency; assess ferritin, dietary intake' if iron<60 else 'Elevated — assess ferritin and haemochromatosis risk' if iron>170 else 'Normal range'}",
            PANEL_IRON)

    if iron and tibc and tibc > 0:
        tsat = (iron / tibc) * 100
        flag = "low" if tsat < 20 else ("high" if tsat > 50 else "optimal")
        add("Transferrin saturation", tsat, "%",
            "20–50%",
            flag,
            f"Transferrin sat {round(tsat,1)}%: {'Low — iron deficiency pattern' if tsat<20 else 'High — iron overload risk; assess haemochromatosis' if tsat>50 else 'Normal iron transport'}",
            PANEL_IRON, computed=True)

    if mcv is not None:
        flag = "low" if mcv < 80 else ("high" if mcv > 95 else "optimal")
        add("MCV (cell size)", mcv, "fL",
            "82–90 fL; <80 = microcytosis (iron deficiency); >95 = macrocytosis (B12/folate)",
            flag,
            f"MCV {mcv}: {'Microcytic — iron deficiency anaemia most likely; assess ferritin, serum iron' if mcv<80 else 'Macrocytic — B12 or folate deficiency; assess methylation, absorption' if mcv>95 else 'Normal red cell size'}",
            PANEL_IRON)

    # RDW — earliest CBC signal of nutritional deficiency, independent CV mortality predictor
    if rdw is not None:
        flag = "high" if rdw > 14.5 else ("suboptimal" if rdw > 13.0 else "optimal")
        add("RDW (cell variability)", rdw, "%",
            "11.5–13.0 FM optimal; >14.5 = nutritional deficiency or chronic inflammation",
            flag,
            f"RDW {rdw}: {'Elevated — earliest signal of iron/B12/folate deficiency or chronic inflammation. Read with MCV: low MCV + high RDW = iron def; normal MCV + high RDW = mixed deficiency. Independent CV mortality predictor' if rdw>14.5 else 'Mildly elevated — early mixed nutritional dropout; order ferritin + B12 + folate' if rdw>13 else 'Healthy RBC population'}",
            PANEL_IRON)

    if mch is not None:
        flag = "low" if mch < 27 else ("high" if mch > 33 else "optimal")
        add("MCH (hemoglobin content)", mch, "pg",
            "27–33 pg normal; <27 hypochromic (iron def); >33 macrocytic",
            flag,
            f"MCH {mch}: {'Low — hypochromic; iron deficiency or thalassemia trait' if mch<27 else 'High — macrocytic; B12/folate/hypothyroid' if mch>33 else 'Normal'}",
            PANEL_IRON)

    if wbc is not None:
        # Indian labs report WBC in cells/cumm (e.g. 7050); FM thresholds are in
        # 10³/µL (e.g. 7.05). Auto-normalize when the value is in cells/cumm.
        if wbc > 1000:
            wbc = wbc / 1000.0
        flag = "low" if wbc < 4 else ("high" if wbc > 11 else ("suboptimal" if wbc > 7.5 else "optimal"))
        add("WBC", wbc, "10³/μL",
            "5.0–7.5 FM optimal; <4 leucopenia; >11 leucocytosis",
            flag,
            f"WBC {wbc}: {'Low — viral infection, autoimmune (e.g. lupus), B12/copper/folate deficiency, marrow suppression' if wbc<4 else 'High — infection/inflammation; persistently high-normal with no infection = chronic inflammatory pattern' if wbc>7.5 else 'FM optimal'}",
            PANEL_IRON)

    if platelets is not None:
        # Indian labs report platelets in cells/cumm (e.g. 263000); FM thresholds
        # are in 10³/µL (e.g. 263). Auto-normalize when the value is in cells/cumm.
        # Lakhs/cumm (2.63) too — the same rule FIB-4 uses.
        platelets = _platelets_10e9(platelets)
        flag = "low" if platelets < 150 else ("high" if platelets > 450 else "optimal")
        add("Platelets", platelets, "10³/μL",
            "150–450 normal; >450 often reactive (inflammation/iron def)",
            flag,
            f"Platelets {platelets}: {'Low — viral, autoimmune, B12/folate, or splenic sequestration' if platelets<150 else 'High — often reactive: chronic inflammation or iron deficiency (most common); persistent >450 needs haematology' if platelets>450 else 'Normal'}",
            PANEL_IRON)

    if rdw_sd is not None:
        flag = "high" if rdw_sd > 46 else ("low" if rdw_sd < 39 else "optimal")
        add("RDW-SD", rdw_sd, "fL",
            "39-46 fL",
            flag,
            f"RDW-SD {rdw_sd}: {'Raised — mixed red-cell sizes; read with RDW-CV and MCV (iron, B12 or folate shortfall)' if rdw_sd > 46 else 'Low-normal variability' if rdw_sd < 39 else 'Normal red-cell size spread'}",
            PANEL_IRON)

    # White-cell differential: absolute counts (10^9/L) and % kept apart, so a
    # ratio never divides a % by an absolute count. Absolute counts missing
    # from the report are worked out from % x WBC.
    _diff_derived: set[str] = set()
    _diff: dict[str, tuple[float | None, float | None]] = {}
    for _cell in ("neutrophil", "lymphocyte", "monocyte", "eosinophil"):
        _abs, _pct = _differential(extracted_labs, _cell)
        if _abs is None and _pct is not None and wbc:
            _abs = _pct / 100.0 * wbc
            _diff_derived.add(_cell + "s")
        if _pct is None and _abs is not None and wbc:
            _pct = _abs / wbc * 100.0
        _diff[_cell] = (_abs, _pct)
    neut_abs, neut_pct = _diff["neutrophil"]
    lymph_abs, lymph_pct = _diff["lymphocyte"]
    mono_abs, _ = _diff["monocyte"]

    # NLR — neutrophil/lymphocyte ratio: chronic inflammation + stress + CV mortality marker
    if neut_abs is not None and lymph_abs:
        neutrophils, lymphocytes = neut_abs, lymph_abs
    elif neut_pct is not None and lymph_pct:
        neutrophils, lymphocytes = neut_pct, lymph_pct
    if neutrophils is not None and lymphocytes is not None and lymphocytes > 0:
        nlr = neutrophils / lymphocytes
        flag = "high" if nlr > 3.0 else ("suboptimal" if nlr > 2.0 else "optimal")
        add("Neutrophil/Lymphocyte ratio (NLR)", nlr, "",
            "<2.0 FM optimal; >3.0 abnormal; >5.0 significant inflammation/stress",
            flag,
            f"NLR {round(nlr,1)}: {'Elevated — chronic low-grade inflammation, sympathetic / cortisol overdrive, or acute bacterial infection. Independent CV mortality predictor; address root drivers' if nlr>3 else 'Borderline — watch trend; could be early inflammatory shift or stress' if nlr>2 else 'Balanced — low chronic inflammation signal'}",
            PANEL_IRON, computed=True)

    # ══════════════════════════════════════════════════════════════════════════
    # 6b. LIVER & METABOLIC RISK — computed fatty-liver / IR / fibrosis scores
    # (after section 6 so `platelets` is already normalised to 10^9/L)
    # ══════════════════════════════════════════════════════════════════════════
    _add_liver_metabolic_indices(
        add, client_context or {},
        glucose=glucose, tg=tg, hba1c=hba1c,
        alt=alt, ast=ast, ggt=ggt, platelets=platelets,
    )

    # ══════════════════════════════════════════════════════════════════════════
    # 7. KEY NUTRIENTS
    # ══════════════════════════════════════════════════════════════════════════
    vitd = _find(extracted_labs,
        r"vitamin d|25.oh|25-oh|calcidiol|25-hydroxyvitamin")
    # Serum total B12 ONLY. Active B12 / holotranscobalamin (holoTC) is a
    # DIFFERENT analyte (different units — pMol/L vs pg/mL — and ranges); it must
    # never be collapsed into "Vitamin B12", else a newer holoTC report (e.g.
    # ">300 pMol/L") displaces the serum total and gets mis-flagged on the pg/mL
    # scale. Negative lookaheads drop any holotranscobalamin / active-B12 entry;
    # it still surfaces as its own pass-through marker.
    b12 = _find(extracted_labs,
        r"^(?!.*holotrans)(?!.*holo.?tc)(?!.*\bactive\b).*(?:vitamin b12|b-12\b|b12\b|cobalamin|cyanocobalamin)")
    # Serum folate ONLY. RBC / haemolysate folate is a different test on a
    # different scale (ng/mL of red cells, range ~500-1300); read as serum folate
    # it turned a deficient 3.9 into a "high" 448. Left unconsumed, it passes
    # through as its own marker.
    folate = _find(extracted_labs,
        r"^(?!.*\brbc\b)(?!.*red.?cell)(?!.*h(?:a)?emolysate)(?!.*erythrocyte)"
        r".*(?:\bfolate\b|folic acid)")
    # Magnesium — two distinct biomarkers with different ranges:
    #   Serum Mg: lab default, but a poor marker (only ~1% extracellular).
    #             Optimal 2.0–2.5 mg/dL; "normal" lab range starts at 1.7.
    #   RBC Mg:   intracellular pool, far more sensitive to functional
    #             deficiency. Optimal 5.4–6.8 mg/dL (or 2.2–2.7 mmol/L).
    # We surface both when present and tag them clearly so the coach
    # never confuses one for the other.
    magnesium_rbc = _find(extracted_labs,
        r"rbc magnesium|red.cell.magnesium|magnesium.rbc|rbc.mg|red cell magnesium")
    # Serum Mg pattern: must NOT contain "rbc" or "red cell" anywhere in the
    # test_name; otherwise it would match "RBC magnesium" too. ^(?!.*rbc) is
    # a Python-supported zero-width assertion on the whole string.
    magnesium_serum = _find(extracted_labs,
        r"^(?!.*rbc)(?!.*red.cell).*\bmagnesium\b", r"^\s*serum magnesium\b")
    zinc = _find(extracted_labs,
        r"\bzinc\b|serum zinc|plasma zinc")

    if vitd is not None:
        if vitd < 20:
            flag = "low"
            vitd_interp = "Deficient — supplement urgently; impacts immunity, mood, thyroid, insulin sensitivity"
        elif vitd < 40:
            flag = "low"
            vitd_interp = "Insufficient — supplementation needed"
        elif vitd < 60:
            flag = "suboptimal"
            vitd_interp = "Sub-optimal — titrate to 60–80"
        elif vitd <= 80:
            flag = "optimal"
            vitd_interp = "FM optimal"
        elif vitd <= 100:
            flag = "suboptimal"
            vitd_interp = f"Above FM optimal ({vitd}) — reduce supplementation; monitor calcium + PTH"
        elif vitd <= 150:
            flag = "high"
            vitd_interp = f"High ({vitd}) — stop supplementation; risk of hypercalcaemia, kidney stones; check ionised calcium + 24h urine calcium"
        else:
            flag = "very_high"
            vitd_interp = f"Toxic range ({vitd}) — STOP vit D immediately; urgent ionised calcium, PTH, kidney function; risk of vit D toxicity / hypercalcaemia"
        add("25-OH Vitamin D", vitd, "ng/mL",
            "60–80 FM optimal (lab: 30–100; deficient <20; toxicity >150)",
            flag,
            f"Vit D {vitd}: {vitd_interp}",
            PANEL_NUTRIENTS)

    if b12 is not None:
        if b12 < 400:
            flag = "low"
            b12_interp = "Functionally deficient — neurological, methylation and energy impact; consider active B12 (MMA test)"
        elif b12 < 600:
            flag = "suboptimal"
            b12_interp = "Low-normal — may be functionally deficient; assess MMA and homocysteine"
        elif b12 <= 900:
            flag = "optimal"
            b12_interp = "FM optimal"
        elif b12 <= 1500:
            flag = "high"
            b12_interp = f"High ({b12}) without supplementation is a RED FLAG — check MTHFR variants, methylation block (cells can't utilise B12 → serum accumulates), liver dysfunction, or myeloproliferative disorder. Test MMA + homocysteine + active B12 (holoTC); paradoxically may be functionally deficient. See claim: high-serum-b12-check-functional-markers-mthfr"
        else:
            flag = "very_high"
            b12_interp = f"Very high ({b12}) — urgent workup: MTHFR + methylation panel, liver enzymes, CBC for myeloproliferative screen, MMA + homocysteine to confirm functional status. Despite high serum, cellular utilization may be impaired"
        add("Vitamin B12", b12, "pg/mL",
            "400–900 FM optimal; >900 needs MTHFR/methylation workup (lab range 200–900 misses both functional deficiency AND functional excess)",
            flag,
            f"B12 {b12}: {b12_interp}",
            PANEL_NUTRIENTS)

    if folate is not None:
        # Note: serum folate often reported in ng/mL (lab range ~3–17) or nmol/L
        # (lab range ~7–40). Most Indian labs report ng/mL. We treat the numeric
        # value as ng/mL when <30, nmol/L otherwise — and flag >24 ng/mL (or
        # >54 nmol/L equivalent) as high since that pattern combined with high
        # serum B12 strongly suggests MTHFR / methylation block + unmetabolized
        # folic acid accumulation.
        if folate < 15:
            flag = "low"
            folate_interp = "Low — methylation burden, neural tube risk, elevated homocysteine; increase leafy greens and consider methylfolate"
        elif folate < 20:
            flag = "suboptimal"
            folate_interp = "Sub-optimal — optimise with food and/or methylfolate"
        elif folate < 24:
            flag = "optimal"
            folate_interp = "FM optimal"
        else:
            flag = "high"
            folate_interp = (
                f"High ({folate}) — when paired with high serum B12, classic methylation block / MTHFR pattern: "
                "unmetabolized folic acid (UMFA) accumulates because cells can't convert folic acid → "
                "methylfolate. Test MTHFR variants, homocysteine, MMA. Stop synthetic folic acid; "
                "switch to methylfolate. See claim: high-serum-b12-check-functional-markers-mthfr"
            )
        add("Folate", folate, "ng/mL or nmol/L",
            "15–24 FM optimal; <15 = methylation/DNA synthesis risk; >24 + high B12 = MTHFR/methylation block signal",
            flag,
            f"Folate {folate}: {folate_interp}",
            PANEL_NUTRIENTS)

    # RBC Magnesium (preferred — reflects intracellular status)
    if magnesium_rbc is not None:
        flag = "low" if magnesium_rbc < 5.4 else ("optimal" if magnesium_rbc <= 6.8 else "suboptimal")
        add("Magnesium (RBC)", magnesium_rbc, "mg/dL",
            "5.4–6.8 FM optimal (gold-standard cellular Mg status)",
            flag,
            f"RBC Mg {magnesium_rbc}: {'Low — true intracellular Mg deficiency; supplement (glycinate / malate) + address losses (PPI, diuretic, stress)' if magnesium_rbc<5.4 else 'FM optimal — intracellular Mg replete' if magnesium_rbc<=6.8 else 'High — verify; rarely seen unless supplementing aggressively'}",
            PANEL_NUTRIENTS)

    # Serum Magnesium (less sensitive; flag low-normal as functional deficiency)
    if magnesium_serum is not None:
        flag = "low" if magnesium_serum < 2.0 else ("optimal" if magnesium_serum >= 2.2 else "suboptimal")
        add("Magnesium (serum)", magnesium_serum, "mg/dL",
            "2.0–2.5 FM optimal; serum is a poor marker — RBC Mg preferred",
            flag,
            f"Serum Mg {magnesium_serum}: {'Low — likely significant intracellular deficiency; impacts 300+ enzyme systems, sleep, stress, glucose' if magnesium_serum<2.0 else 'FM optimal (serum); consider RBC Mg for true cellular status' if magnesium_serum>=2.2 else 'Low-normal — functional deficiency likely; supplementation often beneficial. Confirm with RBC Mg if symptoms persist'}",
            PANEL_NUTRIENTS)

    if zinc is not None:
        flag = "low" if zinc < 80 else ("optimal" if zinc <= 130 else "suboptimal")
        add("Zinc", zinc, "μg/dL",
            "80–130 μg/dL FM optimal; low = immune, thyroid, taste/smell issues",
            flag,
            f"Zinc {zinc}: {'Low — immune suppression, poor wound healing, thyroid conversion impaired; supplement + assess phytate load in diet' if zinc<80 else 'FM optimal' if zinc<=130 else 'High — very unusual; assess supplementation dose'}",
            PANEL_NUTRIENTS)

    # Omega-3 Index — % EPA+DHA in RBC membranes. Independent CV mortality
    # predictor; FM optimal ≥8% (Indian diets typically 2–4%).
    omega3 = _find(extracted_labs,
        r"omega.3.index|o3i\b|epa.dha.index|omega 3 index|epa\+dha")
    if omega3 is not None:
        flag = "low" if omega3 < 4 else ("optimal" if omega3 >= 8 else "suboptimal")
        add("Omega-3 Index", omega3, "%",
            "≥8% FM optimal; 4–8% intermediate; <4% high CV risk",
            flag,
            f"O3I {omega3}%: {'Critically low — typical Indian diet pattern; supplement 2–3g EPA+DHA/day or daily fatty fish' if omega3<4 else 'Suboptimal — increase fatty fish, flax, walnuts; reassess in 4 months' if omega3<8 else 'FM optimal — protective against arrhythmia, depression, all-cause mortality'}",
            PANEL_NUTRIENTS)

    # C-peptide — endogenous insulin secretion marker. Distinguishes T1 from
    # T2 diabetes and tracks beta-cell reserve in chronic IR.
    c_peptide = _find(extracted_labs,
        r"c.peptide|c peptide|cpeptide")
    if c_peptide is not None:
        flag = "high" if c_peptide > 3.0 else ("low" if c_peptide < 0.5 else "optimal")
        add("C-peptide", c_peptide, "ng/mL",
            "0.5–2.0 FM optimal; <0.5 = low beta-cell reserve; >3.0 = hyperinsulinaemia",
            flag,
            f"C-peptide {c_peptide}: {'Elevated — sustained hyperinsulinaemia from chronic IR; address insulin sensitivity aggressively' if c_peptide>3 else 'Low — declining beta-cell function (advanced T2D) or T1D pattern; refer endocrinologist' if c_peptide<0.5 else 'FM optimal — healthy beta-cell function'}",
            PANEL_META)

    # Vitamin K2 (MK-7) — bone-vascular axis; complements vit D.
    vitk2 = _find(extracted_labs,
        r"vitamin k2|mk.7|mk7|menaquinone.7|vitamin k.2")
    if vitk2 is not None:
        flag = "low" if vitk2 < 0.5 else "optimal"
        add("Vitamin K2 (MK-7)", vitk2, "ng/mL",
            "≥0.5 FM acceptable; testing is rare — clinical inference more useful",
            flag,
            f"K2 {vitk2}: {'Low — calcium may deposit in arteries rather than bone; supplement MK-7 (100–200 μg) alongside vit D' if vitk2<0.5 else 'Sufficient — calcium routing to bone supported'}",
            PANEL_NUTRIENTS)

    # MMA (Methylmalonic Acid) — functional B12 deficiency. Rises before
    # serum B12 drops; gold-standard confirmation of B12 status.
    mma = _find(extracted_labs,
        r"\bmma\b|methylmalonic acid|methylmalonate")
    if mma is not None:
        flag = "high" if mma > 0.4 else "optimal"
        add("MMA (functional B12)", mma, "μmol/L",
            "<0.27 FM optimal; >0.4 = functional B12 deficiency even if serum B12 'normal'",
            flag,
            f"MMA {mma}: {'Elevated — functional B12 deficiency confirmed regardless of serum B12. Supplement methylcobalamin + check intrinsic factor / pernicious anaemia in elders' if mma>0.4 else 'Normal — B12 status adequate at cellular level'}",
            PANEL_NUTRIENTS)

    # 1-hour glucose (OGTT) — flags early IR years before HbA1c rises.
    # Joslin / Endocrine Society now consider ≥155 mg/dL = prediabetes.
    one_hr_glucose = _find(extracted_labs,
        r"1.hour.glucose|1.hr.glucose|one.hour.glucose|1h.glucose|ogtt.1.h")
    if one_hr_glucose is not None:
        flag = "high" if one_hr_glucose > 155 else ("suboptimal" if one_hr_glucose > 130 else "optimal")
        add("1-hour glucose (OGTT)", one_hr_glucose, "mg/dL",
            "<130 FM optimal; 130–155 IGT pattern; ≥155 prediabetes signal years before HbA1c",
            flag,
            f"1h glucose {one_hr_glucose}: {'≥155 — strong prediabetes signal even with normal fasting + HbA1c; address IR now' if one_hr_glucose>155 else 'Above FM optimal — early glucose dysregulation' if one_hr_glucose>130 else 'FM optimal — good early glucose handling'}",
            PANEL_META)

    # ══════════════════════════════════════════════════════════════════════════
    # FEMALE SEX HORMONES
    # Cycle-phase dependent — surfaced with descriptive ranges and a neutral
    # flag, NOT auto-flagged high/low, because compute_ratios does not know the
    # cycle day the sample was drawn. Interpret each against that phase.
    # ══════════════════════════════════════════════════════════════════════════
    PANEL_HORMONES_F = "Hormones — Female"

    estradiol = _find(extracted_labs, r"estradiol|oestradiol|\be2\b")
    add("Estradiol (E2)", estradiol, "pg/mL",
        "Follicular 30–90; Ovulation 60–530; Luteal 60–230; Postmenopausal <140 pg/mL",
        "normal",
        f"Estradiol {estradiol}: interpret against the cycle phase on the day drawn. "
        f"A single value cannot establish oestrogen:progesterone balance; sustained "
        f"low oestradiol with a raised FSH points to the menopause transition.",
        PANEL_HORMONES_F)

    progesterone = _find(extracted_labs, r"^(?!.*17)(?!.*hydroxy).*progesterone")
    add("Progesterone", progesterone, "ng/mL",
        "Follicular <1; mid-luteal >3 confirms ovulation (assay-dependent)",
        "normal",
        f"Progesterone {progesterone}: only meaningful in the mid-luteal phase "
        f"(~7 days after ovulation). A mid-luteal value above roughly 3 ng/mL "
        f"confirms ovulation occurred; a low follicular-phase value is expected.",
        PANEL_HORMONES_F)

    testosterone = _find(extracted_labs, r"^(?!.*free).*testosterone")
    add("Testosterone (total)", testosterone, "ng/dL",
        "Female ~15–70 ng/dL (assay-dependent)",
        "normal",
        f"Total testosterone {testosterone}: raised levels suggest a PCOS / androgen-excess "
        f"pattern — assess alongside free testosterone, SHBG and fasting insulin.",
        PANEL_HORMONES_F)

    free_t = _find(extracted_labs, r"free.testosterone|free.androgen")
    add("Free Testosterone", free_t, "",
        "Assay-dependent — read against the report's own range",
        "normal",
        f"Free testosterone {free_t}: the biologically active fraction, more sensitive than "
        f"total testosterone for androgen excess. Interpret against the lab's range.",
        PANEL_HORMONES_F)

    shbg = _find(extracted_labs, r"\bshbg\b|sex.hormone.binding")
    _sex = (client_context or {}).get("sex")
    if shbg is not None and _sex in ("F", "M"):
        # Sex-aware reading. The liver makes less SHBG when insulin is high, so a
        # low SHBG is one of the earliest insulin-resistance / fatty-liver signs.
        lo, sub, hi = (30, 50, 120) if _sex == "F" else (20, 30, 60)
        if shbg < lo:
            flag = "low"
            msg = ("Low — insulin resistance and liver fat lower SHBG, which raises free "
                   "androgen (PCOS pattern in women); read with fasting insulin, TyG, ALT")
        elif shbg < sub:
            flag = "suboptimal"
            msg = "Low-normal — an early insulin-resistance signal worth tracking"
        elif shbg > hi:
            flag = "high"
            msg = ("High — oral oestrogen (OCP/HRT), an over-active thyroid, low calorie "
                   "intake or liver disease raise SHBG and lower free hormone")
        else:
            flag = "optimal"
            msg = "In the healthy range — no insulin-resistance signal from SHBG"
        add("SHBG", shbg, "nmol/L",
            (f"Women {lo}-{hi} nmol/L FM working range (<{lo} low)" if _sex == "F"
             else f"Men {lo}-{hi} nmol/L FM working range (<{lo} low)"),
            flag,
            f"SHBG {shbg}: {msg}. Assay-dependent — compare with the report's own range.",
            PANEL_HORMONES_F)
    else:
        add("SHBG", shbg, "nmol/L",
            "Female ~20–130 nmol/L (assay-dependent)",
            "normal",
            f"SHBG {shbg}: low SHBG raises free androgen and is a classic marker of insulin "
            f"resistance; high SHBG lowers free hormone availability.",
            PANEL_HORMONES_F)

    dheas = _find(extracted_labs, r"\bdhea\b|dhea.s|dheas|dehydro.?epiandrosterone")
    add("DHEA-S", dheas, "µg/dL",
        "Female, age-dependent — read against the report's own range",
        "normal",
        f"DHEA-S {dheas}: an adrenal androgen — raised in adrenal androgen excess, low with "
        f"adrenal under-function. Age-dependent; interpret against the lab's range.",
        PANEL_HORMONES_F)

    amh = _find(extracted_labs, r"\bamh\b|anti.mullerian|anti.müllerian|mullerian hormone")
    add("AMH (Anti-Müllerian Hormone)", amh, "ng/mL",
        "Age-dependent ovarian-reserve marker — read against the report's own range",
        "normal",
        f"AMH {amh}: reflects ovarian reserve — falls through perimenopause toward menopause; "
        f"a high AMH is common in PCOS. Interpret with age.",
        PANEL_HORMONES_F)

    prolactin = _find(extracted_labs, r"\bprolactin\b|\bprl\b")
    add("Prolactin", prolactin, "ng/mL",
        "Non-pregnant female ~5–25 ng/mL (assay-dependent)",
        "normal",
        f"Prolactin {prolactin}: raised prolactin can suppress ovulation and cause cycle "
        f"irregularity — confirm with a repeat morning, rested sample before acting.",
        PANEL_HORMONES_F)

    # LH/FSH ratio — PCOS workup. Elevated ratio classic feature.
    lh = _find(extracted_labs,
        r"\blh\b|luteinising hormone|luteinizing hormone")
    fsh = _find(extracted_labs,
        r"\bfsh\b|follicle.stimulating|follicle stimulating")
    add("Luteinising Hormone (LH)", lh, "mIU/mL",
        "Follicular 2–13; Ovulatory 14–96; Luteal 1–11; Postmenopausal 8–59 mIU/mL",
        "normal",
        f"LH {lh}: interpret by cycle phase / day of draw. Paired with FSH as the ratio below.",
        PANEL_HORMONES_F)
    add("Follicle Stimulating Hormone (FSH)", fsh, "mIU/mL",
        "Follicular 3.5–12.5; Ovulatory 4.7–21.5; Luteal 1.7–7.7; Postmenopausal 25–135 mIU/mL",
        "normal",
        f"FSH {fsh}: an early-follicular value above roughly 10–12 signals declining ovarian "
        f"reserve / the menopause transition.",
        PANEL_HORMONES_F)

    # A BLOOD ANTIBODY (IgG/IgA) and a STOOL ANTIGEN are different tests with
    # different cutoffs and meanings. Both used to land in the antigen branch,
    # so a NEGATIVE IgG of 18 EIU (cutoff 30) read as "Positive — active
    # infection" against the antigen's 1.1 index cutoff (cl-906, Oct 2026).
    _HP_PAT = r"helicobacter|h\.?\s?pylori|pylori antigen|pylori.stool"
    _HP_AB = re.compile(r"\big[agm]\b|antibod|serolog|igg|iga|igm", re.I)
    _hp_ab_labs = [l for l in extracted_labs
                   if re.search(_HP_PAT, str(l.get("test_name", "")).lower().replace(".", ""))
                   and _HP_AB.search(str(l.get("test_name", "")))]
    _hp_ag_labs = [l for l in extracted_labs if l not in _hp_ab_labs]
    hp_ab = _find(_hp_ab_labs, _HP_PAT)
    if hp_ab is not None:
        hp_cut = _range_upper(_find_range(_hp_ab_labs, _HP_PAT))
        if hp_cut is None:
            hp_ab_flag, hp_ab_msg = "normal", "Compare with the lab's own cutoff"
        elif hp_ab >= hp_cut:
            hp_ab_flag = "high"
            hp_ab_msg = ("Antibodies present — past or current exposure. Blood antibodies "
                         "stay positive long after the infection clears, so confirm active "
                         "infection with a stool antigen or breath test before acting")
        else:
            hp_ab_flag, hp_ab_msg = "optimal", "Non-reactive — no evidence of H. pylori exposure"
        add("H. pylori antibody (blood)", hp_ab, "",
            (f"<{hp_cut:g} non-reactive (lab cutoff)" if hp_cut is not None
             else "assay-dependent — use the lab's cutoff"),
            hp_ab_flag, f"H. pylori antibody {hp_ab}: {hp_ab_msg}", "Gut & Digestive")

    h_pylori = _find(_hp_ag_labs, _HP_PAT)
    if h_pylori is not None:
        hp_flag = "high" if h_pylori >= 1.1 else ("suboptimal" if h_pylori >= 0.9 else "optimal")
        add("H. pylori (stool antigen)", h_pylori, "index",
            "<0.9 negative; 0.9–1.1 equivocal; ≥1.1 positive",
            hp_flag,
            f"H. pylori antigen {h_pylori}: "
            + ("Positive — active infection; a driver of gastritis, low stomach acid "
               "and B12/iron malabsorption" if h_pylori >= 1.1
               else "Equivocal — repeat testing advised" if h_pylori >= 0.9
               else "Negative — H. pylori ruled out as a gut driver"),
            "Gut & Digestive")

    if lh is not None and fsh is not None and fsh > 0:
        lh_fsh = lh / fsh
        flag = "high" if lh_fsh > 2.5 else ("suboptimal" if lh_fsh > 2.0 else "optimal")
        add("LH/FSH ratio", lh_fsh, "",
            "<2.0 FM optimal; >2.5 classic PCOS pattern (assess with AMH, free T, fasting insulin)",
            flag,
            f"LH/FSH {round(lh_fsh,2)}: {'Elevated — classic PCOS pattern; pair with AMH, free testosterone, fasting insulin, pelvic US' if lh_fsh>2.5 else 'Borderline — watch trend; ovulatory dysfunction possible' if lh_fsh>2.0 else 'Balanced HPO axis'}",
            "Hormones — Female", computed=True)

    # ══════════════════════════════════════════════════════════════════════════
    # 8. HOLISTIC READ — inflammation indices, lipid extras, insulin
    # sensitivity, thyroid structure, minerals, red-cell screens, PhenoAge.
    # Inputs without a coded handler are read with _peek, so their own rows
    # still reach the passthrough below with catalogue interpretation.
    # ══════════════════════════════════════════════════════════════════════════
    ctx = client_context or {}
    # CRP: hsCRP wins; else a standard CRP row.
    crp_mg_l, crp_label = hscrp, "hsCRP"
    if crp_mg_l is None:
        crp_mg_l, _ = _peek(extracted_labs,
            r"^(?!.*sensitiv)(?!.*\bhs)(?!.*ratio).*(\bcrp\b|c.?reactive)")
        crp_label = "CRP"
    alb_g_dl = _albumin_g_dl(albumin)

    _add_inflammation_indices(
        add, platelets=platelets, neut_abs=neut_abs, lymph_abs=lymph_abs,
        mono_abs=mono_abs, crp_mg_l=crp_mg_l, crp_label=crp_label,
        albumin_g_dl=alb_g_dl, derived=_diff_derived,
    )

    _, _ldl_lab = _peek(extracted_labs,
        r"^(?!.*ratio)(?!.*[:/])(?!.*\bhdl\b)(?!.*\bvldl\b).*(?:\bldl\b|low.density.lipoprotein)")
    _add_lipid_extras(
        add, tc=tc, ldl=ldl, hdl=hdl, tg=tg, apob=apob,
        ldl_direct=bool(_ldl_lab and re.search(
            r"direct|measured", str(_ldl_lab.get("test_name", "")), re.I)),
    )

    _add_insulin_sensitivity(add, glucose=glucose, insulin=insulin, tg=tg)
    _add_thyroid_structure(add, tsh=tsh, ft4=t4_free, ft3=t3_free)

    calcium, _ = _peek(extracted_labs,
        r"^(?!.*ioni[sz])(?!.*urin)(?!.*24)(?!.*correct)(?!.*adjust)(?!.*ratio).*\bcalcium\b")
    phosphorus, _ = _peek(extracted_labs,
        r"^(?!.*alkaline)(?!.*phosphatase)(?!.*urin)(?!.*ratio).*\b(phosphorus|phosphate)\b")
    sodium, _ = _peek(extracted_labs, r"^(?!.*urin)(?!.*ratio).*(\bsodium\b|^na\b|\(na\+?\))")
    potassium, _ = _peek(extracted_labs, r"^(?!.*urin)(?!.*ratio).*(\bpotassium\b|^k\b|\(k\+?\))")
    copper, _ = _peek(extracted_labs, r"^(?!.*urin)(?!.*ceruloplasmin)(?!.*ratio).*\bcopper\b")
    _add_minerals(
        add, calcium=calcium, albumin_g_dl=alb_g_dl, phosphorus=phosphorus,
        sodium=sodium, potassium=potassium, zinc=zinc, copper=copper,
    )

    # Mentzer index (MCV / RBC count): only meaningful with small red cells.
    rbc_count, _ = _peek(extracted_labs,
        r"^(?!.*magnes)(?!.*folate)(?!.*zinc)(?!.*distribution)(?!.*morpholog)"
        r"(?!.*nucleated)(?!.*urin)(?!.*indices).*(\brbc\b|red blood cell|erythrocyte)")
    if rbc_count is not None and rbc_count > 100:
        rbc_count = rbc_count / 1e6          # cells/µL -> 10^6/µL
    if mcv is not None and mcv < 80 and rbc_count and rbc_count > 0:
        mentzer = mcv / rbc_count
        rdwi = (mcv * rdw / rbc_count) if rdw else None
        thal = mentzer < 13
        rdwi_txt = ""
        if rdwi is not None:
            rdwi_txt = (f" RDW index {rdwi:.0f} ({'<220 also favours thalassaemia trait' if rdwi < 220 else '>220 favours iron deficiency'}).")
        add("Mentzer index", mentzer, "",
            "<13 favours thalassaemia trait; >13 favours iron deficiency (small red cells only)",
            "suboptimal",
            f"Mentzer {mentzer:.1f} (MCV {mcv} / RBC {rbc_count:.2f}): "
            + ("Below 13 — small cells with a HIGH red-cell count: thalassaemia trait is "
               "more likely than iron deficiency (common in India). Iron will not fix it; "
               "an HbA2 / Hb electrophoresis test confirms. Check ferritin before any iron."
               if thal else
               "Above 13 — small cells with a low red-cell count: iron deficiency is more "
               "likely; confirm with ferritin and transferrin saturation.")
            + rdwi_txt + " A screen, not a diagnosis.",
            PANEL_IRON, computed=True)

    _add_phenoage(
        add, ctx,
        albumin_g_dl=alb_g_dl, creatinine=creatinine, glucose=glucose,
        crp_mg_l=crp_mg_l, lymph_pct=lymph_pct, mcv=mcv, rdw_cv=rdw, alp=alp,
        wbc=wbc,
    )

    # ══════════════════════════════════════════════════════════════════════════
    # PASSTHROUGH — never silently drop an extracted lab.
    # Anything not claimed by a coded handler above is resolved against the
    # LabTest catalogue: a catalogue match becomes a properly interpreted
    # marker under "Additional Markers"; an unmatched value lands in "Other",
    # which is therefore the live catalogue-gap backlog — add a LabTest entry
    # or alias to clear it. Names are normalised so a marker already emitted
    # by a coded handler is not duplicated and cross-snapshot variants of the
    # same marker collapse to the most recent value.
    # ══════════════════════════════════════════════════════════════════════════
    lt_index = _lab_test_index()
    coded_keys = {_norm_marker(r.get("marker_name")) for r in results}

    # Catalogue lab-tests whose value a coded handler above ALSO emits, under a
    # different display name (labs frequently print HOMA-IR, A/G, Non-HDL,
    # TC/HDL, LDL/HDL as their own pre-computed rows). Map catalogue slug ->
    # the coded handler's display name. In the passthrough we skip a raw row
    # ONLY when its coded equivalent is already present, so the computed
    # marker wins and we avoid a duplicate — but when the coded handler didn't
    # fire (missing components), the raw row still gets catalogue interpretation
    # instead of being lost. NOTE cholesterol/hdl and ldl/hdl catalogue entries
    # deliberately map onto the "TC/HDL ratio" / "LDL/HDL ratio" coded names
    # even though the wording differs — same ratio, different label.
    _coded_equivalent = {
        "homa-ir": "HOMA-IR",
        "non-hdl-cholesterol": "Non-HDL cholesterol",
        "albumin-globulin-ratio": "Albumin/Globulin ratio",
        "cholesterol-hdl-ratio": "TC/HDL ratio",
        "ldl-hdl-ratio": "LDL/HDL ratio",
        # Liver & Metabolic Risk indices (computed in section 6b)
        "fib-4": "FIB-4",
        "tyg-index": "TyG index",
        "tyg-bmi": "TyG-BMI",
        "tyg-wc": "TyG-WC",
        "hepatic-steatosis-index": "Hepatic Steatosis Index (HSI)",
        "fatty-liver-index": "Fatty Liver Index (FLI)",
        "lipid-accumulation-product": "Lipid accumulation product (LAP)",
        "waist-to-height-ratio": "Waist-to-height ratio",
        # Holistic read (section 8)
        "systemic-immune-inflammation-index": "Systemic immune-inflammation index (SII)",
        "platelet-lymphocyte-ratio": "Platelet/Lymphocyte ratio (PLR)",
        "monocyte-lymphocyte-ratio": "Monocyte/Lymphocyte ratio (MLR)",
        "crp-albumin-ratio": "CRP/Albumin ratio",
        "remnant-cholesterol": "Remnant cholesterol",
        "ldl-apob-ratio": "LDL-C/ApoB ratio",
        "quicki": "QUICKI",
        "mcauley-index": "McAuley index",
        "spina-gd": "SPINA-GD (deiodinase activity)",
        "jostel-tsh-index": "Jostel's TSH index (TSHI)",
        "corrected-calcium": "Calcium (albumin-corrected)",
        "calcium-phosphorus-ratio": "Calcium/Phosphorus ratio",
        "sodium-potassium-ratio": "Sodium/Potassium ratio",
        "zinc-copper-ratio": "Zinc/Copper ratio",
        "phenoage": "PhenoAge (research score)",
        "mentzer-index": "Mentzer index",
        "neutrophil-lymphocyte-ratio": "Neutrophil/Lymphocyte ratio (NLR)",
    }
    _coded_equivalent_keys = {
        slug: _norm_marker(name) for slug, name in _coded_equivalent.items()
    }

    def _rng(lo: object, hi: object) -> str:
        if lo is None and hi is None:
            return ""
        if lo is None:
            return f"<{hi}"
        if hi is None:
            return f">{lo}"
        return f"{lo}-{hi}"

    # Resolve each unconsumed lab against the catalogue, then dedup by the
    # RESOLVED lab-test slug — so two different spellings of the same marker
    # collapse to one — or by normalised name when it resolves to nothing.
    # Latest draw date wins within a group.
    picked: dict[str, tuple] = {}
    for lab in extracted_labs:
        if not isinstance(lab, dict) or id(lab) in _CONSUMED_IDS:
            continue
        nm = str(lab.get("test_name") or "").strip()
        if not nm:
            continue
        nkey = _norm_marker(nm)
        if not nkey or nkey in coded_keys:
            continue  # already represented by a coded marker
        lt = lt_index.get(nkey)
        if lt is None:
            # Tolerate compound labels that combine a full name with a
            # parenthetical abbreviation/qualifier anywhere in the string —
            # e.g. "PCV (Hematocrit)", "Packed Cell Volume (PCV)",
            # "Sodium (Na+) - Serum" — where the combined token set never
            # exactly equals a single catalogue alias's token set because
            # the name is effectively said twice (or annotated) in one
            # string. Retry with every parenthetical segment stripped out
            # entirely, and with each parenthetical segment's own inner text
            # on its own, before giving up.
            #
            # Known trade-off: this could misfire if a parenthetical is the
            # ONLY thing distinguishing two catalogue-distinct variants of
            # the same analyte (e.g. "Testosterone (Free)" vs "(Total)")
            # AND one variant's catalogue entry carelessly aliases the bare
            # analyte name. As of 2026-07 no such alias exists (checked
            # free-testosterone.yaml / total-testosterone.yaml), so this is
            # a theoretical risk to watch for in future catalogue authoring,
            # not an active bug — never alias a bare generic analyte name
            # onto a variant-specific LabTest entry.
            parens = re.findall(r"\(([^)]*)\)", nm)
            stripped = re.sub(r"\([^)]*\)", " ", nm)
            for cand in (stripped, *parens):
                pk = _norm_marker(cand)
                if pk and pk in lt_index:
                    lt = lt_index[pk]
                    break
        # If this catalogue marker duplicates one a coded handler already
        # emitted (e.g. a pre-computed "HOMA-IR Index" row when the handler
        # computed HOMA-IR from insulin+glucose), skip the raw row so the
        # computed marker isn't shown twice. Only skips when the coded marker
        # is actually present — otherwise the raw row is interpreted below.
        if lt is not None:
            eq = _coded_equivalent_keys.get(lt.get("slug"))
            if eq and eq in coded_keys:
                continue
        dkey = f"lt:{lt.get('slug')}" if lt else f"raw:{nkey}"
        prev = picked.get(dkey)
        if prev is None or _parse_lab_date(lab.get("date_drawn")) >= _parse_lab_date(prev[0].get("date_drawn")):
            picked[dkey] = (lab, lt)

    for lab, lt in picked.values():
        nm = str(lab.get("test_name") or "").strip()
        try:
            num = float(re.sub(r"[^0-9.\-]", "", str(lab.get("value", ""))))
        except (ValueError, TypeError):
            continue  # non-numeric / qualitative result — not a panel marker
        lab_rng = str(lab.get("reference_range") or "")
        lab_lo, lab_hi = _parse_ref_range(lab_rng)
        if not lt:
            # No catalogue entry: still judge it against the lab's own printed
            # range, so a toxic metal or an uncatalogued enzyme outside range
            # is not shown as "normal".
            oflag = _range_flag(num, lab_lo, lab_hi)
            add(nm, num, str(lab.get("unit") or ""),
                lab_rng, oflag,
                ("Outside the lab's reference range. " if oflag in ("low", "high") else "")
                + "Captured from the lab report — not yet in the lab-test catalogue. "
                "Add a LabTest entry or alias to give it FM interpretation.",
                "Other")
            continue
        # Count units: Thyrocare prints absolute counts as "0.15 X 10³/µL";
        # the catalogue holds them in cells/µL (200-800). Read raw, 0.15 looked
        # like 0.15 cells/µL. Scale thousands-per-µL to cells/µL first.
        unit_note = ""
        cat_unit = str(lt.get("units") or "").lower()
        if re.search(r"cells\s*/\s*(u|µ|μ)l|/\s*cumm|/\s*mm", cat_unit):
            lab_unit = str(lab.get("unit") or "")
            ch_cat = lt.get("conventional_high")
            if _THOUSANDS_UNIT.search(lab_unit) or (
                    not _CELLS_UNIT.search(lab_unit) and num < 20
                    and ch_cat is not None and ch_cat > 100):
                unit_note = f" (reported as {num:g} x10³/µL; shown in cells/µL)"
                num = num * 1000.0
                lab_lo = lab_lo * 1000.0 if lab_lo is not None else None
                lab_hi = lab_hi * 1000.0 if lab_hi is not None else None
        fl, fh = lt.get("fm_optimal_low"), lt.get("fm_optimal_high")
        cl, ch = lt.get("conventional_low"), lt.get("conventional_high")
        flag = "normal"
        range_src = ""
        if fl is not None or fh is not None:
            if fl is not None and num < fl:
                flag = "suboptimal" if (cl is not None and num >= cl) else "low"
            elif fh is not None and num > fh:
                flag = "suboptimal" if (ch is not None and num <= ch) else "high"
            else:
                flag = "optimal"
        else:
            # No FM-optimal range: fall back to the lab's own printed range
            # (assay-specific), then the catalogue's conventional range. Before
            # this a lipase of 65.5 against 5-60 read as "normal".
            if lab_lo is not None or lab_hi is not None:
                flag = _range_flag(num, lab_lo, lab_hi)
                range_src = f"the lab's range ({lab_rng.strip()})"
            elif cl is not None or ch is not None:
                flag = _range_flag(num, cl, ch)
                range_src = f"the conventional range ({_rng(cl, ch)})"
        parts = []
        if _rng(fl, fh):
            parts.append(f"FM optimal {_rng(fl, fh)}")
        if _rng(cl, ch):
            parts.append(f"conventional {_rng(cl, ch)}")
        ref = "; ".join(parts) or lab_rng
        if flag == "low":
            interp = lt.get("interpretation_low") or ""
            if range_src:
                interp = f"Below {range_src}. {interp}".strip()
        elif flag == "high":
            interp = lt.get("interpretation_high") or ""
            if range_src:
                interp = f"Above {range_src}. {interp}".strip()
        elif flag == "suboptimal":
            base = (lt.get("interpretation_low") if num < (fl or 0) else lt.get("interpretation_high")) or ""
            interp = ("Within the lab's normal range but outside FM-optimal. " + base).strip()
        else:
            # GUARD (2026-07-25): an optimal/normal marker used to dump the
            # catalogue's generic notes_for_coach verbatim — coach-education
            # prose that references off-panel tests and reads as a claim about
            # THIS client's labs. State the value is in range instead, and only
            # append the catalogue note if it survives the off-panel scrub.
            _u = (" " + lt.get("units")) if lt.get("units") else ""
            if flag == "optimal":
                interp = f"{num:g}{_u} — within FM-optimal range"
                if _rng(fl, fh):
                    interp += f" ({_rng(fl, fh)})"
            elif range_src:
                interp = f"{num:g}{_u} — within {range_src}; no FM-optimal range on file"
            else:
                interp = f"{num:g}{_u} — no reference range on file to judge it against"
            interp += unit_note + "."
            _note = _scrub_offpanel(lt.get("notes_for_coach"))
            if _note:
                interp = f"{interp} {_note}"
        # Belt-and-braces: no off-panel test reference reaches a client's card,
        # whatever branch produced the text (interpretation_low/high included).
        interp = _scrub_offpanel(interp)
        if not interp:
            interp = f"{lt.get('display_name') or nm} — {num}{(' ' + lt.get('units')) if lt.get('units') else ''}."
        if unit_note and unit_note not in interp:
            interp = f"{interp}{unit_note}"
        add(lt.get("display_name") or nm, num,
            lt.get("units") or str(lab.get("unit") or ""),
            ref, flag, interp, "Additional Markers")

    # Pre-test confounders (illness, paracetamol, exercise, biotin, ...) lower
    # the confidence of the markers they distort. No answers → no change.
    # Answers describe ONE draw: apply them only when the newest lab here is
    # from that draw (a preview of a fresh upload must not inherit the last
    # report's answers).
    from fmdb.assess.lab_confounders import apply_confounders
    if ctx.get("pretest") and ctx.get("pretest_date"):
        newest = max((_parse_lab_date(l.get("date_drawn")) for l in extracted_labs
                      if isinstance(l, dict)), default=0.0)
        if newest and newest != _parse_lab_date(str(ctx["pretest_date"])):
            ctx = {**ctx, "pretest": None}
            # Tell synthesise_labs (same context dict) the answers were set aside.
            if isinstance(client_context, dict):
                client_context["pretest_stale"] = True
    apply_confounders(results, ctx)
    return results
