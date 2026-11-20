"""
day_targets — the ONE place a client's daily nutrient target is decided.

Source: docs/client-app-redesign/BUILD-PLAN.md "### Confirmed targets"
(coach confirmed 20 Nov 2026, "Yes, replace it"). The client app reads it
through scripts/day-targets.py; the weekly menu drafter is to move onto it
next (that changes menus of clients in care — the coach is told first).

What it returns (computed on the Mac, where the full record is; the
per-minute staging copy projects it to Fly as client.yaml#day_targets):
  status       "ok" | "none" (no automatic targets at all) — with `why`
  kcal         {"maintenance": n} or {"phases": {...}} — calories behind the
               split, never shown to the client; the app picks the plan week
  protein      {low, high} g band | None, with `protein_note` when no number
               is shown ("Your kidney team sets your protein.", ...)
  carb_share   [low, high] share of calories — the coach's carb_level, else
               glycaemic for a recorded glycaemic diagnosis, else standard
  fat_share    [low, high]
  fibre        25, or FIBRE_GENTLE_G for bowel conditions / SIBO, or fibre_g
  notes        coach-side reasons, one line each

Rules worth knowing before editing:
  * Act only on what is recorded as a diagnosis (active_conditions /
    medical_history, read with the supplement-clash term matcher, so
    "ulcer" never hits "ulcerative"). Labs are used only where the plan says.
  * Medicines go through fmdb.drug_match.match_drugs, never a hand matcher.
  * The weight-loss calorie maths is render-client-letter.py's
    _calc_calorie_targets, imported, not copied.
  * The three open rulings are the named constants below.
"""
from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE.parent.parent / "fm-database"))

from fmdb.drug_match import match_drugs  # noqa: E402
from fmdb.plan.supplement_clash import fold, has_term  # noqa: E402
from protein_logic import _iter_lab_values  # noqa: E402

# ── the three rulings (BUILD-PLAN "Still open"), one constant each ───────────
#: 1. DECIDED (coach, 20 Nov 2026: "Yes, fat to 35%"): glycaemic plans keep carbs at 45% and fat may rise to this share.
GLYCAEMIC_FAT_MAX = 0.35
#: 2. protein before any kidney test is on record (g/kg band).
NO_KIDNEY_TEST_PROTEIN = (1.2, 1.5)
#: 3. over 65: the usual band, and no calorie deficit unless the coach says.
OVER_65_DEFICIT = False

PROTEIN_BAND = (1.2, 1.5)
#: kidney (eGFR < 60, ACR >= 30 or a diagnosis): one low figure, g/kg
KIDNEY_PROTEIN_G_KG = 0.8
#: high uric acid / gout: a low band, g/kg
URATE_PROTEIN_G_KG = (0.8, 1.0)
#: bowel conditions and SIBO: a gentle fibre target instead of none
FIBRE_GENTLE_G = 15
FIBRE_G = 25
FAT_SHARE = (0.20, 0.30)
CARB_SHARE = {"glycaemic": (0.45, 0.45), "standard": (0.50, 0.55)}
MAINTENANCE_ACTIVITY = "sedentary"  # coach, 20 Nov 2026: sedentary unless recorded


def _terms_hit(client: dict, terms: list[str], *, history: bool = True) -> str | None:
    """First record entry naming any of `terms` (folded, letter-bounded)."""
    fields = ["active_conditions"] + (["medical_history"] if history else [])
    for f in fields:
        for entry in client.get(f) or []:
            text = fold(str(entry))
            if any(has_term(text, fold(t)) for t in terms):
                return str(entry)
    return None


NO_TARGETS = {
    "pregnancy": ["pregnant", "pregnancy"],
    "breastfeeding": ["breastfeeding", "breast feeding", "lactating", "nursing mother"],
    "eating-disorder history": ["eating disorder", "anorexia", "anorexia nervosa", "bulimia", "binge eating", "arfid", "orthorexia"],
    "type 1 diabetes": ["type 1 diabetes", "t1dm", "t1d", "type i diabetes"],
    "dialysis or transplant": ["dialysis", "kidney transplant", "renal transplant"],
    "cirrhosis": ["cirrhosis", "decompensated liver", "hepatic encephalopathy"],
}
KIDNEY_DX = ["chronic kidney disease", "kidney disease", "ckd", "renal impairment", "renal insufficiency", "renal failure", "kidney failure", "nephropathy"]
URATE = ["gout", "hyperuricemia", "hyperuricaemia", "high uric acid", "raised uric acid", "elevated uric acid"]
GLYCAEMIC = ["insulin resistance", "prediabetes", "pre diabetes", "type 2 diabetes", "diabetes", "t2dm", "pcos", "pcod", "polycystic ovary", "fatty liver", "nafld", "masld", "nash"]
FIBRE_NONE = ["crohn", "crohns", "ulcerative colitis", "ibd", "inflammatory bowel disease", "diverticulitis", "celiac", "celiac disease",
              "gastroparesis", "bariatric", "gastric bypass", "sleeve gastrectomy", "colectomy", "bowel resection", "stoma", "ileostomy",
              "colostomy", "stricture", "bowel obstruction"]
SIBO = ["sibo", "small intestinal bacterial overgrowth"]

# Medicine classes the confirmed targets act on. Records in the drug_match
# shape; GLP-1 comes from the catalogue entry so its aliases stay one list.
_DRUG_CLASSES = [
    {"slug": "insulin", "drug_aliases": ["insulin", "lantus", "basalog", "tresiba", "levemir", "novorapid", "humalog", "actrapid", "mixtard", "humulin", "glargine", "degludec", "aspart", "lispro"]},
    {"slug": "sulfonylurea", "drug_aliases": ["glimepiride", "gliclazide", "glipizide", "glibenclamide", "glyburide", "amaryl", "glycomet gp", "gemer", "diamicron", "reclide", "glynase"]},
    {"slug": "sglt2", "drug_aliases": ["empagliflozin", "dapagliflozin", "canagliflozin", "ertugliflozin", "remogliflozin", "jardiance", "forxiga", "invokana", "gliptagreat", "sglt2", "sglt-2"]},
]


def _drug_classes(client: dict) -> set[str]:
    records = list(_DRUG_CLASSES)
    glp1 = _HERE.parent.parent / "fm-database" / "data" / "drug_depletions" / "glp1-agonists.yaml"
    try:
        import yaml

        d = yaml.safe_load(glp1.read_text(encoding="utf-8")) or {}
        records.append({"slug": "glp1", "drug_aliases": d.get("drug_aliases") or []})
    except Exception:
        records.append({"slug": "glp1", "drug_aliases": ["semaglutide", "liraglutide", "tirzepatide", "ozempic", "wegovy", "mounjaro"]})
    found: set[str] = set()
    for med in client.get("current_medications") or []:
        for d in match_drugs(str(med), records):
            found.add(d["slug"])
    return found


def _lab(client: dict, include: tuple, exclude: tuple = ()) -> float | None:
    for name, val in _iter_lab_values(client):
        if any(t in name for t in include) and not any(x in name for x in exclude):
            return val
    return None


def _calorie_maths():
    spec = importlib.util.spec_from_file_location("rcl_calories", _HERE / "render-client-letter.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod._calc_calorie_targets


def _age(client: dict) -> int | None:
    dob = client.get("date_of_birth")
    if dob:
        try:
            return (date.today() - date.fromisoformat(str(dob))).days // 365
        except Exception:
            pass
    band = str(client.get("age_band") or "")
    if "-" in band:
        try:
            a, b = band.split("-")[:2]
            return (int(a) + int(b)) // 2
        except Exception:
            return None
    return None


def _phase_kcal(phases: dict, week: int | None) -> int | None:
    if not phases:
        return None
    w = week or 1
    key = "wk1_2" if w <= 2 else "wk3_4" if w <= 4 else "wk5_8" if w <= 8 else "wk9_10" if w <= 10 else "wk11_12"
    return phases.get(key)


def day_targets(client: dict, plan_week: int | None = None) -> dict[str, Any]:
    notes: list[str] = []

    # 1. no automatic targets at all
    preg = str(client.get("pregnancy_status") or "").lower()
    if preg in ("pregnant", "breastfeeding", "lactating") or client.get("lactation_started"):
        return {"status": "none", "why": "pregnancy or breastfeeding"}
    for why, terms in NO_TARGETS.items():
        hit = _terms_hit(client, terms, history=why in ("eating-disorder history", "dialysis or transplant"))
        if hit:
            out: dict[str, Any] = {"status": "none", "why": why, "record": hit}
            if why == "cirrhosis":
                out["client_line"] = "Do not cut protein or skip meals."
            return out
    egfr = _lab(client, ("egfr", "gfr"))
    if egfr is not None and egfr < 30:
        return {"status": "none", "why": "eGFR under 30", "record": f"eGFR {egfr:g}"}

    m = client.get("measurements") or {}
    try:
        weight = float(m.get("weight_kg") or client.get("weight_kg") or 0)
        height = float(m.get("height_cm") or client.get("height_cm") or 0)
    except (TypeError, ValueError):
        weight = height = 0.0
    if not weight:
        return {"status": "none", "why": "no weight on record"}
    bmi = weight / ((height / 100) ** 2) if height else None
    if bmi is not None and bmi < 18.5:
        return {"status": "none", "why": "underweight", "record": f"BMI {bmi:.1f}"}

    age = _age(client)
    drugs = _drug_classes(client)

    # 2. kidney
    acr = _lab(client, ("acr", "albumin creatinine ratio", "albumin/creatinine", "microalbumin"), ("serum",))
    kidney_dx = _terms_hit(client, KIDNEY_DX)
    kidney = bool(kidney_dx) or (egfr is not None and egfr < 60) or (acr is not None and acr >= 30)
    creat = _lab(client, ("creatinine",), ("ratio", "clearance", "urine", "bun"))
    kidney_check_line = not kidney and creat is not None and creat > 1.3
    kidney_tested = egfr is not None or creat is not None

    # 3. calories: weight-loss phase, else maintenance
    wl = client.get("weight_loss") if isinstance(client.get("weight_loss"), dict) else None
    calc = _calorie_maths()
    deficit_ok = True
    for blocked, reason in (
        (kidney, "kidney: no deficit without the doctor"),
        ("insulin" in drugs or "sulfonylurea" in drugs, "insulin / sulfonylurea: no automatic calorie cut"),
        ("sglt2" in drugs, "SGLT2 inhibitor: no extra deficit"),
        ("glp1" in drugs, "GLP-1 drug: no deficit on top"),
        (age is not None and age > 65 and not OVER_65_DEFICIT, "over 65: no deficit by default"),
    ):
        if blocked and wl and wl.get("enabled"):
            deficit_ok = False
            notes.append(reason)
    kcal_spec: dict | None = None
    if wl and wl.get("enabled") and deficit_ok:
        t = calc(client, wl)
        if t and t.get("phases"):
            kcal_spec = {"phases": t["phases"]}
            notes.append("weight-loss phases (12-week build)")
    if not kcal_spec:
        maint_wl = {"enabled": True, "activity_level": (wl or {}).get("activity_level") or MAINTENANCE_ACTIVITY, "pace": "slow", "tdee_override": (wl or {}).get("tdee_override")}
        t = calc(client, maint_wl)
        if t and t.get("tdee"):
            kcal_spec = {"maintenance": int(t["tdee"])}
            if not (wl or {}).get("activity_level"):
                notes.append("maintenance at 'sedentary' activity (none recorded)")
    if not kcal_spec:
        return {"status": "none", "why": "height or age missing for calories"}
    kcal = _phase_kcal(kcal_spec.get("phases") or {}, plan_week) or kcal_spec.get("maintenance") or 0

    # 4. protein (g/kg on adjusted weight at BMI 30+)
    calc_w = weight
    if bmi is not None and bmi >= 30 and height:
        ideal = 22.5 * (height / 100) ** 2
        calc_w = ideal + 0.4 * (weight - ideal)
    band = PROTEIN_BAND if kidney_tested else NO_KIDNEY_TEST_PROTEIN
    protein: dict | None = {"low": round(band[0] * calc_w), "high": round(band[1] * calc_w)}
    protein_note = None
    menu_protein = None
    # Coach, 20 Nov 2026: kidney and gout clients get a LOW target, shown as a
    # plain number with no reason given (the reason is the coach's to explain).
    if kidney:
        menu_protein = round(KIDNEY_PROTEIN_G_KG * calc_w)
        protein = {"low": menu_protein, "high": menu_protein}
        notes.append(f"kidney: protein held at {KIDNEY_PROTEIN_G_KG} g/kg, no reason shown")
    elif _terms_hit(client, URATE):
        protein = {"low": round(URATE_PROTEIN_G_KG[0] * calc_w), "high": round(URATE_PROTEIN_G_KG[1] * calc_w)}
        notes.append("uric acid / gout: low protein band, no reason shown")
    elif kidney_check_line:
        protein_note = "Check this kidney result with your doctor."

    # 5. carbs: the coach's level, else a default from the record (coach,
    # 20 Nov 2026: "build that in or at least a default base") — glycaemic
    # when a glycaemic diagnosis is recorded, else standard.
    level = client.get("carb_level")
    carb_share = None
    if isinstance(level, (int, float)) and 0.2 <= float(level) <= 0.65:
        carb_share = (float(level), float(level))
    elif isinstance(level, str) and level in CARB_SHARE:
        carb_share = CARB_SHARE[level]
    else:
        hit = _terms_hit(client, GLYCAEMIC)
        level = "glycaemic" if hit else "standard"
        carb_share = CARB_SHARE[level]
        notes.append(f"carb level {level} by default" + (f" ({hit})" if hit else "") + "; set carb_level to change")
    if carb_share and "sglt2" in drugs and carb_share[0] < 0.45:
        carb_share = (0.45, max(0.45, carb_share[1]))
        notes.append("SGLT2 inhibitor: carbs kept at 45% or more")

    # 6. fat: 20-30%, up to GLYCAEMIC_FAT_MAX on glycaemic plans
    fat_hi = GLYCAEMIC_FAT_MAX if level == "glycaemic" else FAT_SHARE[1]
    fat_share = [FAT_SHARE[0], fat_hi]

    # 7. fibre
    fibre: int | None = FIBRE_G
    # Coach, 20 Nov 2026: a gentle, lower target rather than none, no reason shown.
    if _terms_hit(client, FIBRE_NONE) or _terms_hit(client, SIBO, history=False):
        fibre = FIBRE_GENTLE_G
        notes.append(f"bowel condition / SIBO: gentle fibre {FIBRE_GENTLE_G} g, no reason shown")
    if isinstance(client.get("fibre_g"), (int, float)):
        fibre = int(client["fibre_g"])

    return {
        "status": "ok",
        "kcal": kcal_spec,
        "kcal_now": int(kcal),
        "protein": protein,
        "protein_note": protein_note,
        "menu_protein_g": menu_protein,
        "carb_share": list(carb_share) if carb_share else None,
        "fat_share": fat_share,
        "fibre": fibre,
        "notes": notes,
    }
