"""
Compute derived FM markers and individual lab values with FM-optimal interpretation.

Each returned dict includes:
  marker_name, value, unit, reference_range, flag, fm_interpretation, panel, computed

`panel` groups markers into logical systems for the dashboard UI.
`computed` = True means it was derived from other values (ratio/calculation).
`computed` = False means it was read directly from the lab result.
"""
from __future__ import annotations
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


def _norm_marker(s: object) -> str:
    """Word-order- and punctuation-insensitive key for matching a lab name
    against the LabTest catalogue: lowercase, drop dots, tokenise, sort, join.
    So 'S.G.O.T.', 'Morning Cortisol' and 'Cortisol (Morning)' all collapse
    onto a stable key the catalogue's aliases can be matched against."""
    t = str(s or "").lower().replace(".", "")
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


def compute_ratios(extracted_labs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return list of FM-interpreted markers + computed ratios, grouped by panel."""
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
    glucose = _find(extracted_labs,
        r"fasting.glucose|glucose.fast|blood glucose|plasma glucose|fasting blood sugar|fbs\b")
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
        conv = t3_free / t4_free
        flag = "low" if conv < 0.2 else ("optimal" if conv < 0.35 else "suboptimal")
        add("T3/T4 conversion ratio", conv, "",
            "0.2–0.35 fT3/fT4; low = poor peripheral conversion",
            flag,
            f"T3/T4 {round(conv,3)}: {'Poor conversion — check selenium, zinc, cortisol, liver, iron' if conv<0.2 else 'Good conversion efficiency' if conv<0.35 else 'High — verify or hyperthyroid'}",
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
    albumin = _find(extracted_labs,
        r"\balbumin\b|serum albumin")
    globulin = _find(extracted_labs,
        r"\bglobulin\b|serum globulin")

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
        r"total cholesterol|cholesterol.total|\btotal.chol\b|\bchol\b")
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
    apob = _find(extracted_labs,
        r"\bapo[ -]?b\b|apolipoprotein.b\b|apob\b")
    apoa1 = _find(extracted_labs,
        r"\bapo[ -]?a[ -]?1\b|apolipoprotein.a1?\b|apoa1?\b")
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
    hemoglobin = _find(extracted_labs,
        r"hemoglobin|haemoglobin|\bhgb\b|\bhb\b|blood haemoglobin")
    ferritin = _find(extracted_labs,
        r"\bferritin\b|serum ferritin")
    iron = _find(extracted_labs,
        r"serum iron|s-iron|\biron\b(?!\s*binding)")
    tibc = _find(extracted_labs,
        r"\btibc\b|total iron binding|iron binding capacity")
    mcv = _find(extracted_labs,
        r"\bmcv\b|mean corpuscular volume|mean cell volume")
    rdw = _find(extracted_labs,
        r"\brdw\b|red.cell.distribution|red.cell.width|rdw[ -]?cv|rdw[ -]?sd")
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
        if platelets > 3000:
            platelets = platelets / 1000.0
        flag = "low" if platelets < 150 else ("high" if platelets > 450 else "optimal")
        add("Platelets", platelets, "10³/μL",
            "150–450 normal; >450 often reactive (inflammation/iron def)",
            flag,
            f"Platelets {platelets}: {'Low — viral, autoimmune, B12/folate, or splenic sequestration' if platelets<150 else 'High — often reactive: chronic inflammation or iron deficiency (most common); persistent >450 needs haematology' if platelets>450 else 'Normal'}",
            PANEL_IRON)

    # NLR — neutrophil/lymphocyte ratio: chronic inflammation + stress + CV mortality marker
    if neutrophils is not None and lymphocytes is not None and lymphocytes > 0:
        nlr = neutrophils / lymphocytes
        flag = "high" if nlr > 3.0 else ("suboptimal" if nlr > 2.0 else "optimal")
        add("Neutrophil/Lymphocyte ratio (NLR)", nlr, "",
            "<2.0 FM optimal; >3.0 abnormal; >5.0 significant inflammation/stress",
            flag,
            f"NLR {round(nlr,1)}: {'Elevated — chronic low-grade inflammation, sympathetic / cortisol overdrive, or acute bacterial infection. Independent CV mortality predictor; address root drivers' if nlr>3 else 'Borderline — watch trend; could be early inflammatory shift or stress' if nlr>2 else 'Balanced — low chronic inflammation signal'}",
            PANEL_IRON, computed=True)

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
    folate = _find(extracted_labs,
        r"\bfolate\b|folic acid|serum folate|rbc folate")
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

    h_pylori = _find(extracted_labs,
        r"helicobacter|h\.?\s?pylori|pylori antigen|pylori.stool")
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
        if not lt:
            add(nm, num, str(lab.get("unit") or ""),
                str(lab.get("reference_range") or ""), "normal",
                "Captured from the lab report — not yet in the lab-test catalogue. "
                "Add a LabTest entry or alias to give it FM interpretation.",
                "Other")
            continue
        fl, fh = lt.get("fm_optimal_low"), lt.get("fm_optimal_high")
        cl, ch = lt.get("conventional_low"), lt.get("conventional_high")
        flag = "normal"
        if fl is not None and fh is not None:
            if num < fl:
                flag = "suboptimal" if (cl is not None and num >= cl) else "low"
            elif num > fh:
                flag = "suboptimal" if (ch is not None and num <= ch) else "high"
            else:
                flag = "optimal"
        parts = []
        if _rng(fl, fh):
            parts.append(f"FM optimal {_rng(fl, fh)}")
        if _rng(cl, ch):
            parts.append(f"conventional {_rng(cl, ch)}")
        ref = "; ".join(parts) or str(lab.get("reference_range") or "")
        if flag == "low":
            interp = lt.get("interpretation_low") or ""
        elif flag == "high":
            interp = lt.get("interpretation_high") or ""
        elif flag == "suboptimal":
            base = (lt.get("interpretation_low") if num < (fl or 0) else lt.get("interpretation_high")) or ""
            interp = ("Within the lab's normal range but outside FM-optimal. " + base).strip()
        else:
            interp = lt.get("notes_for_coach") or ""
        if not interp:
            interp = f"{lt.get('display_name') or nm} — {num}{(' ' + lt.get('units')) if lt.get('units') else ''}."
        add(lt.get("display_name") or nm, num,
            lt.get("units") or str(lab.get("unit") or ""),
            ref, flag, interp, "Additional Markers")

    return results
