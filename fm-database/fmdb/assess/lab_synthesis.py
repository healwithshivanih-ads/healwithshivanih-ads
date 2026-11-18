"""The holistic, root-cause read of a client's labs: system scores, pattern
classifiers and cross-system rules.

Input is what `compute_ratios` already returned (the marker list, with flags
and any `confidence: low` from pre-test confounders) plus the client context.
Output is one JSON-safe dict, stored as `client.lab_synthesis`:

    {
      "version": 1,
      "systems":  [{key, label, status, drivers, measured, low_confidence, summary}],
      "patterns": [{key, label, kind, level, systems, detail, markers}],
      "confounders": {recorded, pretest_date, applied: [...], note},
    }

status is green / amber / red / no_data. A system turns:
  - red   when 2+ markers are firmly out of range (flag high/low/very_high,
          normal confidence), any is very_high, or a red pattern names it;
  - amber when 1 is firmly out, 2+ are suboptimal, an out-of-range marker has
          low confidence, or an amber pattern names it;
  - green when it has measured markers and none of the above.

Pure and deterministic: no API, no I/O. Every rule reads marker names that
`compute_ratios` (or the catalogue passthrough) emits; a missing marker means
the rule simply does not fire.
"""
from __future__ import annotations

import re
from typing import Any, Callable

_FIRM = {"high", "low", "very_high"}

# (key, label, marker-name regex). A marker can count in more than one system
# (hsCRP is both inflammation and cardiovascular).
SYSTEMS: list[tuple[str, str, str]] = [
    ("metabolic", "Metabolic",
     r"fasting glucose|postprandial|glucose excursion|fasting insulin|homa|hba1c|"
     r"uric acid|^tyg|quicki|mcauley|c-peptide|1-hour glucose|lipid accumulation|tg/hdl|"
     r"waist-to-height"),
    ("liver", "Liver",
     r"^alt\b|^ast\b|ast/alt|\bggt\b|^alp\b|bilirubin|^albumin\b|hepatic steatosis|"
     r"fatty liver index|^fib-?4|lipase|amylase"),
    ("inflammation", "Inflammation, immune & allergy",
     r"hscrp|^crp\b|c-reactive|crp/albumin|\bnlr\b|neutrophil/lymph|\bsii\b|"
     r"immune-inflammation|\bplr\b|\bmlr\b|^wbc\b|\bige\b|eosinophil|globulin|\besr\b"),
    ("thyroid", "Thyroid",
     r"^tsh\b|free t[34]|total t[34]|reverse t3|tpo|thyroglobulin|t3/t4|tsh/ft3|"
     r"ft3/rt3|spina|tsh index"),
    ("hormones", "Sex hormones & adrenal",
     r"estradiol|progesterone|testosterone|\bshbg\b|dhea|amh|prolactin|luteinising|"
     r"follicle stim|lh/fsh|cortisol|sodium/potassium"),
    ("nutrients", "Nutrients & methylation",
     r"vitamin d|vitamin b12|^folate|magnesium|^zinc|zinc/copper|copper|homocysteine|"
     r"\bmma\b|omega-3|vitamin k2|calcium|phosphorus|selenium"),
    ("blood", "Blood",
     r"hemoglobin|haemoglobin|ferritin|serum iron|transferrin|tibc|^mcv|^mch\b|^rdw|"
     r"^platelets|rbc count|hematocrit|mentzer"),
    ("cardiovascular", "Cardiovascular",
     r"total cholesterol|ldl|hdl cholesterol|triglycerides|tc/hdl|non-hdl|apob|apoa|"
     r"lp\(a\)|atherogenic|remnant|hscrp|homocysteine"),
    ("kidney", "Kidney",
     r"^creatinine|\bbun\b|egfr|uacr|cystatin|^sodium\b|^potassium\b|chloride"),
    ("toxic", "Toxic load",
     r"\blead\b|mercury|arsenic|cadmium|alumin(i)?um|nickel|uranium|barium|cobalt|"
     r"caesium|cesium|thallium|antimony|chromium|\btin\b|strontium|silver|vanadium|"
     r"beryllium|molybdenum"),
]
_SYSTEM_LABEL = {k: lbl for k, lbl, _ in SYSTEMS}
# Markers that are never a system driver (scores read elsewhere).
_EXCLUDE = re.compile(r"phenoage", re.I)


class _Labs:
    """Name-based lookups over the compute_ratios marker list."""

    def __init__(self, markers: list[dict]):
        self.markers = [m for m in markers if isinstance(m, dict)]

    def get(self, pattern: str) -> dict | None:
        rx = re.compile(pattern, re.I)
        for m in self.markers:
            if rx.search(str(m.get("marker_name") or "")):
                return m
        return None

    def val(self, pattern: str) -> float | None:
        m = self.get(pattern)
        try:
            return float(m["value"]) if m is not None else None
        except (TypeError, ValueError, KeyError):
            return None

    def flag(self, pattern: str) -> str | None:
        m = self.get(pattern)
        return str(m.get("flag")) if m is not None else None


def _crp(L: _Labs) -> float | None:
    v = L.val(r"^hscrp")
    return v if v is not None else L.val(r"^crp\b(?!/)")


def _fmt(v: float | None, nd: int = 1) -> str:
    if v is None:
        return "?"
    return f"{v:.{nd}f}".rstrip("0").rstrip(".") if nd else f"{v:.0f}"


def _pattern(key: str, label: str, kind: str, level: str, systems: list[str],
             detail: str, markers: list[str]) -> dict:
    return {"key": key, "label": label, "kind": kind, "level": level,
            "systems": systems, "detail": detail, "markers": markers}


# ── Classifiers ─────────────────────────────────────────────────────────────

def classify_iron(L: _Labs, sex: str | None) -> dict | None:
    """True deficiency / inflammation-sequestered / overload / metabolic
    ferritin, plus the thalassaemia-trait screen (Mentzer, RDW index)."""
    ferritin = L.val(r"^ferritin")
    tsat = L.val(r"^transferrin sat")
    crp = _crp(L)
    hb = L.val(r"^hemoglobin|^haemoglobin")
    mcv = L.val(r"^mcv")
    mentzer = L.val(r"^mentzer")
    markers = [n for n, v in (("Ferritin", ferritin), ("Transferrin saturation", tsat),
                              ("CRP", crp), ("Hemoglobin", hb)) if v is not None]
    hb_low = hb is not None and hb < (12.0 if sex != "M" else 13.0)
    crp_high = crp is not None and crp > 3
    over_ferr = 200 if sex != "M" else 300

    if mentzer is not None and mcv is not None and mcv < 80 and mentzer < 13 and (
            ferritin is None or ferritin >= 30):
        return _pattern(
            "iron_thal_trait", "Thalassaemia-trait screen positive", "classifier", "amber",
            ["blood"],
            f"Small red cells (MCV {_fmt(mcv)}) with a Mentzer index of {_fmt(mentzer)} "
            f"(<13) and {'ferritin ' + _fmt(ferritin, 0) if ferritin is not None else 'no ferritin on file'}: "
            f"thalassaemia trait is more likely than iron deficiency. Iron will not correct "
            f"it and can overload; an Hb electrophoresis / HbA2 test confirms.",
            markers + ["MCV", "Mentzer index"])
    if ferritin is None:
        return None
    if ferritin < 30 or (ferritin < 50 and tsat is not None and tsat < 20 and not crp_high):
        return _pattern(
            "iron_deficiency",
            "Iron-deficiency anaemia" if hb_low else "Iron deficiency (stores depleted)",
            "classifier", "red" if hb_low else "amber", ["blood", "nutrients"],
            f"Ferritin {_fmt(ferritin, 0)}"
            + (f", transferrin saturation {_fmt(tsat, 0)}%" if tsat is not None else "")
            + (f", haemoglobin {_fmt(hb)}" if hb is not None else "")
            + ": true iron shortfall. Look for the leak before the pill — heavy periods, "
            "gut absorption (low stomach acid, coeliac, H. pylori), vegetarian intake, "
            "blood donation.",
            markers)
    if ferritin >= 100 and tsat is not None and tsat < 20 and crp_high:
        return _pattern(
            "iron_inflammatory_block", "Inflammatory iron block (iron sequestered)",
            "classifier", "red", ["blood", "inflammation"],
            f"Ferritin {_fmt(ferritin, 0)} is high while transferrin saturation is low "
            f"({_fmt(tsat, 0)}%) and CRP is raised ({_fmt(crp)} mg/L): inflammation "
            f"(hepcidin) is locking iron away in storage. Iron supplements will not help "
            f"and can feed the problem — treat the inflammation first.",
            markers)
    if 30 <= ferritin < 100 and tsat is not None and tsat < 20 and crp_high:
        return _pattern(
            "iron_mixed", "Iron deficiency possibly masked by inflammation",
            "classifier", "amber", ["blood", "inflammation"],
            f"Ferritin {_fmt(ferritin, 0)} looks adequate, but transferrin saturation is "
            f"low ({_fmt(tsat, 0)}%) and CRP is raised ({_fmt(crp)} mg/L). Ferritin rises "
            f"with inflammation, so true stores may be low; recheck ferritin and TSAT "
            f"once CRP settles.",
            markers)
    if tsat is not None and tsat > 45 and ferritin > over_ferr:
        return _pattern(
            "iron_overload", "Iron overload pattern", "classifier", "red", ["blood", "liver"],
            f"Ferritin {_fmt(ferritin, 0)} with transferrin saturation {_fmt(tsat, 0)}% "
            f"(>45%): iron is genuinely high, not just stored. A haemochromatosis (HFE) "
            f"screen with the doctor is worth discussing; stop any iron-containing "
            f"supplements.",
            markers)
    if ferritin > over_ferr and (tsat is None or tsat <= 45) and not crp_high:
        return _pattern(
            "iron_metabolic_ferritin", "Raised ferritin without iron overload",
            "classifier", "amber", ["blood", "metabolic", "liver"],
            f"Ferritin {_fmt(ferritin, 0)} is high"
            + (f" but transferrin saturation is normal ({_fmt(tsat, 0)}%)" if tsat is not None else "")
            + " and CRP is not raised: the commonest cause is metabolic — fatty liver and "
            "insulin resistance (dysmetabolic hyperferritinaemia); alcohol is another.",
            markers)
    return None


def classify_anaemia(L: _Labs, sex: str | None) -> dict | None:
    """MCV x RDW-CV (Bessman) red-cell pattern — a type when Hb is low, an
    early signal when it is not."""
    mcv = L.val(r"^mcv")
    rdw = L.val(r"^rdw \(cell")
    hb = L.val(r"^hemoglobin|^haemoglobin")
    if mcv is None or rdw is None:
        return None
    size = "micro" if mcv < 80 else ("macro" if mcv > 98 else "normo")
    hetero = rdw > 14.5
    causes = {
        ("micro", False): "thalassaemia trait or anaemia of chronic disease",
        ("micro", True): "iron deficiency (most common)",
        ("normo", False): "anaemia of chronic disease, kidney or early blood loss",
        ("normo", True): "an early or MIXED shortfall — iron together with B12/folate",
        ("macro", False): "alcohol, liver strain, low thyroid or medicines (metformin, PPIs)",
        ("macro", True): "B12 or folate deficiency",
    }
    cause = causes[(size, hetero)]
    hb_low = hb is not None and hb < (12.0 if sex != "M" else 13.0)
    shape = f"{size}cytic, {'mixed' if hetero else 'uniform'} cell sizes"
    if size == "normo" and not hetero:
        if not hb_low:
            return None
        level = "amber"
    else:
        level = "red" if hb_low else "amber"
    label = (f"Anaemia type: {shape}" if hb_low else f"Red-cell pattern: {shape}")
    return _pattern(
        "anaemia_type", label, "classifier", level, ["blood"],
        f"MCV {_fmt(mcv)} fL, RDW {_fmt(rdw)}%"
        + (f", haemoglobin {_fmt(hb)}" if hb is not None else "")
        + f": points to {cause}."
        + ("" if hb_low else " Haemoglobin is not low yet, so this is an early signal."),
        ["MCV", "RDW"] + (["Hemoglobin"] if hb is not None else []))


def classify_methylation(L: _Labs) -> dict | None:
    hcy = L.val(r"^homocysteine")
    b12 = L.val(r"^vitamin b12")
    folate = L.val(r"^folate")
    mma = L.val(r"^mma")
    if hcy is None and b12 is None:
        return None
    markers = [n for n, v in (("Homocysteine", hcy), ("Vitamin B12", b12),
                              ("Folate", folate), ("MMA", mma)) if v is not None]
    b12_low = (b12 is not None and b12 < 400) or (mma is not None and mma > 0.4)
    folate_low = folate is not None and folate < 15
    if hcy is not None and hcy > 10:
        if b12_low and folate_low:
            what, why = "B12 and folate", "both methyl donors are short"
        elif b12_low:
            what, why = "B12", "B12 is low or functionally low (MMA)"
        elif folate_low:
            what, why = "folate", "folate is below the FM range"
        elif b12 is not None and b12 > 900:
            return _pattern(
                "methylation_block", "Methylation block (high B12, high homocysteine)",
                "classifier", "red", ["nutrients", "cardiovascular"],
                f"Homocysteine {_fmt(hcy)} is raised although serum B12 is high "
                f"({_fmt(b12, 0)}): B12 is in the blood but not being used. Check MMA / "
                f"active B12, MTHFR, liver; methylated forms over cyanocobalamin.",
                markers)
        else:
            what, why = "B6, riboflavin, MTHFR, thyroid or kidney", (
                "B12 and folate look replete, so look at the other inputs")
        return _pattern(
            "methylation_gap", f"Methylation gap — {what}", "classifier", "red",
            ["nutrients", "cardiovascular"],
            f"Homocysteine {_fmt(hcy)} µmol/L (>10) and {why}"
            + (f" (B12 {_fmt(b12, 0)}" if b12 is not None else " (")
            + (f", folate {_fmt(folate)})" if folate is not None else ")")
            + ". Raised homocysteine is a vascular, bone and brain risk.",
            markers)
    if hcy is not None and hcy <= 10 and b12_low:
        return _pattern(
            "methylation_early_b12", "Early B12 shortfall (homocysteine not yet raised)",
            "classifier", "amber", ["nutrients"],
            f"B12 {_fmt(b12, 0)} is below the FM range but homocysteine ({_fmt(hcy)}) is "
            f"still normal — catch it now; check intake, metformin/PPI use and absorption.",
            markers)
    if hcy is not None and hcy <= 7 and (
            (b12 is not None and b12 > 900) or (folate is not None and folate > 24)):
        return _pattern(
            "methylation_high_serum", "High serum B12/folate with normal homocysteine",
            "classifier", "info", ["nutrients"],
            "Serum B12 or folate is high but homocysteine is optimal — usually just "
            "supplementation. If not supplementing, a high B12 needs a look.",
            markers)
    return None


def classify_thyroid_antibodies(L: _Labs) -> dict | None:
    tpo = L.get(r"^tpo antibodies")
    tg = L.get(r"^thyroglobulin ab")
    if tpo is None and tg is None:
        return None
    tpo_pos = tpo is not None and tpo.get("flag") == "high"
    tg_pos = tg is not None and tg.get("flag") == "high"
    tsh = L.val(r"^tsh$")
    names = [m["marker_name"] for m in (tpo, tg) if m is not None]
    if tpo_pos or tg_pos:
        which = ("TPO and thyroglobulin antibodies" if (tpo_pos and tg_pos)
                 else "TPO antibodies" if tpo_pos else "thyroglobulin antibodies only")
        stage = ""
        if tsh is not None:
            stage = (" with a raised TSH — autoimmune thyroiditis already affecting output"
                     if tsh > 4.5 else
                     " with TSH above the FM range — early autoimmune under-function"
                     if tsh > 2.5 else
                     " with a normal TSH — the autoimmune phase before output falls")
        return _pattern(
            "thyroid_autoimmune", f"Thyroid autoimmunity: {which} positive",
            "classifier", "red" if (tpo_pos and tsh is not None and tsh > 4.5) else "amber",
            ["thyroid", "inflammation"],
            f"{which[0].upper() + which[1:]} positive{stage}. Root-cause work: gut "
            f"(permeability, gluten), vitamin D, selenium, iodine balance, stress; "
            f"retest antibodies in 3-6 months.",
            names)
    if tpo is not None and tg is not None:
        return _pattern(
            "thyroid_antibodies_negative", "Thyroid antibodies negative",
            "classifier", "info", ["thyroid"],
            "TPO and thyroglobulin antibodies both negative — no autoimmune thyroid signal.",
            names)
    return None


# ── Cross-system rules ──────────────────────────────────────────────────────

def _rule_inflamed_conversion(L: _Labs) -> dict | None:
    ft3_flag = L.flag(r"^free t3")
    conv_low = L.flag(r"^t3/t4 conversion") == "low" or L.flag(r"^spina-gd") == "low"
    crp = _crp(L)
    if crp is None or crp <= 3 or not (ft3_flag == "low" or conv_low):
        return None
    return _pattern(
        "inflamed_thyroid_conversion", "Inflammation-driven low T3 conversion",
        "cross_system", "red", ["thyroid", "inflammation"],
        f"Free T3 / conversion is low while CRP is {_fmt(crp)} mg/L: inflammation "
        f"slows T4-to-T3 conversion (and raises reverse T3). Treat the inflammation "
        f"before reading this as thyroid disease or adding thyroid support.",
        ["Free T3", "CRP"])


def _rule_ir_fatty_liver(L: _Labs) -> dict | None:
    alt, ast = L.val(r"^alt\b"), L.val(r"^ast\b")
    tyg = L.val(r"^tyg index")
    shbg_flag = L.flag(r"^shbg")
    if alt is None or ast is None or tyg is None:
        return None
    if not (alt > ast and alt > 20 and tyg >= 8.5):
        return None
    shbg_low = shbg_flag in ("low", "suboptimal")
    if shbg_flag is not None and not shbg_low:
        return None
    level = "red" if (shbg_low and tyg > 8.8) else "amber"
    return _pattern(
        "ir_fatty_liver", "Insulin-resistance-driven fatty liver pattern",
        "cross_system", level, ["liver", "metabolic"],
        f"ALT {_fmt(alt)} above AST {_fmt(ast)}, TyG {_fmt(tyg, 2)}"
        + (" and a low SHBG" if shbg_low else " (SHBG not measured — it would confirm)")
        + ": the liver is storing fat because insulin is high. The lever is insulin — "
        "carb quality, protein at breakfast, movement after meals, sleep, waist.",
        ["ALT", "AST", "TyG index"] + (["SHBG"] if shbg_flag else []))


def _rule_allergic(L: _Labs) -> dict | None:
    ige = L.val(r"\bige\b")
    eos_abs = L.val(r"^absolute eosinophil")
    eos_pct = L.val(r"^eosinophils %")
    eos_high = (eos_abs is not None and eos_abs > 350) or (eos_pct is not None and eos_pct > 6)
    if ige is None or ige <= 100 or not eos_high:
        return None
    crp = _crp(L)
    crp_high = crp is not None and crp > 3
    return _pattern(
        "allergic_inflammation", "Allergic / airway inflammation pattern",
        "cross_system", "red" if crp_high else "amber", ["inflammation"],
        f"Total IgE {_fmt(ige, 0)} IU/mL with raised eosinophils"
        + (f" and CRP {_fmt(crp)} mg/L" if crp_high else "")
        + ": an active allergic (Th2) response — airways, skin or gut. Look at triggers "
        "(dust mite, mould, pollen, food), the gut barrier, vitamin D; parasites can "
        "also raise IgE and eosinophils.",
        ["Total IgE", "Eosinophils"] + (["CRP"] if crp_high else []))


def _rule_lpa_crp(L: _Labs) -> dict | None:
    lpa = L.val(r"^lp\(a\)")
    crp = _crp(L)
    if lpa is None or lpa <= 50 or crp is None or crp <= 2:
        return None
    return _pattern(
        "lpa_inflammation", "Amplified cardiovascular risk: high Lp(a) with inflammation",
        "cross_system", "red", ["cardiovascular", "inflammation"],
        f"Lp(a) {_fmt(lpa, 0)} mg/dL (genetic) with CRP {_fmt(crp)} mg/L: inflammation "
        f"makes Lp(a) particles more harmful. Lp(a) itself barely moves with lifestyle, "
        f"so every other lever matters more — CRP, ApoB, blood pressure, glucose.",
        ["Lp(a)", "CRP"])


def _rule_apob_discordance(L: _Labs) -> dict | None:
    apob = L.val(r"^apob \(")
    ldl = L.val(r"^ldl cholesterol")
    if apob is None or ldl is None:
        return None
    apob = apob * 100 if apob < 3 else apob
    ldl = ldl * 38.67 if ldl < 20 else ldl
    if apob >= 100 and ldl < 130:
        return _pattern(
            "apob_ldl_discordance_high", "ApoB higher than LDL suggests (discordance)",
            "cross_system", "red", ["cardiovascular", "metabolic"],
            f"ApoB {_fmt(apob, 0)} mg/dL is high while LDL-C ({_fmt(ldl, 0)}) looks "
            f"acceptable: there are more atherogenic particles than the cholesterol "
            f"number shows — usually small dense LDL from insulin resistance. Follow "
            f"ApoB, not LDL-C.",
            ["ApoB", "LDL cholesterol"])
    if apob < 80 and ldl >= 130:
        return _pattern(
            "apob_ldl_discordance_low", "LDL-C overstates particle risk (discordance)",
            "cross_system", "info", ["cardiovascular"],
            f"LDL-C {_fmt(ldl, 0)} is raised but ApoB is only {_fmt(apob, 0)} mg/dL: few, "
            f"large cholesterol-rich particles. Particle risk is lower than LDL-C implies.",
            ["ApoB", "LDL cholesterol"])
    return None


def _rule_ferritin_thyroid(L: _Labs) -> dict | None:
    ferritin = L.val(r"^ferritin")
    tsh = L.val(r"^tsh$")
    if ferritin is None or tsh is None or ferritin >= 50 or tsh <= 2.5:
        return None
    return _pattern(
        "low_ferritin_thyroid", "Low iron holding back thyroid function",
        "cross_system", "amber", ["thyroid", "blood"],
        f"Ferritin {_fmt(ferritin, 0)} (<50) with TSH {_fmt(tsh)}: the thyroid enzyme "
        f"(TPO) and T4-to-T3 conversion both need iron. Rebuild ferritin alongside any "
        f"thyroid work.",
        ["Ferritin", "TSH"])


_RULES: list[Callable[[_Labs], dict | None]] = [
    _rule_inflamed_conversion, _rule_ir_fatty_liver, _rule_allergic,
    _rule_lpa_crp, _rule_apob_discordance, _rule_ferritin_thyroid,
]


# ── System scores ───────────────────────────────────────────────────────────

def _score_systems(markers: list[dict], patterns: list[dict]) -> list[dict]:
    out: list[dict] = []
    for key, label, pat in SYSTEMS:
        rx = re.compile(pat, re.I)
        mine = [m for m in markers
                if rx.search(str(m.get("marker_name") or ""))
                and not _EXCLUDE.search(str(m.get("marker_name") or ""))]
        firm = [m for m in mine if m.get("flag") in _FIRM and m.get("confidence") != "low"]
        firm_lc = [m for m in mine if m.get("flag") in _FIRM and m.get("confidence") == "low"]
        mild = [m for m in mine if m.get("flag") == "suboptimal"]
        pats = [p for p in patterns if key in p.get("systems", [])]
        red_p = [p for p in pats if p["level"] == "red"]
        amber_p = [p for p in pats if p["level"] == "amber"]
        if not mine:
            status = "no_data"
        elif len(firm) >= 2 or any(m.get("flag") == "very_high" for m in firm) or red_p:
            status = "red"
        elif firm or firm_lc or len(mild) >= 2 or amber_p:
            status = "amber"
        else:
            status = "green"
        drivers = [{
            "marker": m.get("marker_name"), "value": m.get("value"),
            "unit": m.get("unit") or "", "flag": m.get("flag"),
            "low_confidence": m.get("confidence") == "low",
        } for m in firm + firm_lc + mild]
        if status == "no_data":
            summary = "Not measured on file."
        elif status == "green":
            summary = f"{len(mine)} marker{'s' if len(mine) != 1 else ''} in range."
        else:
            bits = []
            if firm:
                bits.append(f"{len(firm)} out of range")
            if firm_lc:
                bits.append(f"{len(firm_lc)} out of range but low-confidence")
            if mild:
                bits.append(f"{len(mild)} outside FM-optimal")
            if pats:
                bits.append("pattern: " + "; ".join(p["label"] for p in pats))
            summary = ", ".join(bits) + "."
        out.append({
            "key": key, "label": label, "status": status, "drivers": drivers,
            "measured": len(mine),
            "low_confidence": bool(firm_lc) and not firm,
            "summary": summary,
        })
    return out


def synthesise_labs(markers: list[dict[str, Any]],
                    client_context: dict[str, Any] | None = None) -> dict:
    """The holistic read: system scores, pattern classifiers, cross-system
    rules and the pre-test confounder summary. `markers` is compute_ratios'
    output; `client_context` is lab_client_context(client)."""
    ctx = client_context or {}
    markers = [m for m in (markers or []) if isinstance(m, dict)]
    L = _Labs(markers)
    sex = ctx.get("sex") if ctx.get("sex") in ("F", "M") else None

    iron = classify_iron(L, sex)
    meth = classify_methylation(L)
    # Two of the cross-system rules are classifier outcomes: an inflammatory
    # iron block (high ferritin + low TSAT + high CRP) and a folate-driven
    # methylation gap (high homocysteine + low folate). Mark them, don't repeat.
    for p in (iron, meth):
        if p and (p["key"] == "iron_inflammatory_block" or (
                p["key"] == "methylation_gap" and "folate" in p["label"].lower())):
            p["kind"] = "cross_system"
    patterns = [p for p in (
        iron, classify_anaemia(L, sex), meth, classify_thyroid_antibodies(L),
    ) if p]
    for rule in _RULES:
        p = rule(L)
        if p:
            patterns.append(p)

    # Confounders: what apply_confounders marked on the markers.
    applied: dict[str, dict] = {}
    for m in markers:
        for lbl in m.get("confounded_by") or []:
            applied.setdefault(lbl, {"label": lbl, "affects": []})["affects"].append(
                m.get("marker_name"))
    pretest = ctx.get("pretest") if isinstance(ctx.get("pretest"), dict) else None
    if pretest is not None and ctx.get("pretest_stale"):
        pretest = None
        cnote = (f"Pre-test answers on file are for the {ctx.get('pretest_date')} draw, "
                 f"not these results — record answers for this draw.")
    elif pretest is None:
        cnote = ("No pre-test answers recorded for the latest draw — illness, "
                 "paracetamol, exercise, biotin and fasting are unknown, so read "
                 "borderline results loosely.")
    elif applied:
        cnote = f"{len(applied)} confounder(s) lower confidence on {sum(len(a['affects']) for a in applied.values())} marker(s)."
    else:
        cnote = "Pre-test answers recorded — nothing that distorts these results."

    rank = {"red": 0, "amber": 1, "info": 2}
    patterns.sort(key=lambda p: (rank.get(p["level"], 3), p["kind"] != "cross_system"))
    return {
        "version": 1,
        "systems": _score_systems(markers, patterns),
        "patterns": patterns,
        "confounders": {
            "recorded": pretest is not None,
            "pretest_date": ctx.get("pretest_date"),
            "applied": list(applied.values()),
            "note": cnote,
        },
    }
