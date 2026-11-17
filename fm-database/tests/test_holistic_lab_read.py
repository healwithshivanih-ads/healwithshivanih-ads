"""Holistic lab read (Nov 2026): new indices, classifiers, system scores,
cross-system rules, pre-test confounders and the Thyrocare format fixes.

Every formula has a worked example. All deterministic, $0.

Run: .venv/bin/python -m pytest tests/test_holistic_lab_read.py  (from fm-database/)
"""

import math

import pytest

from fmdb.assess.client_context import lab_client_context
from fmdb.assess.lab_ratios import (
    PANEL_BIOAGE, PANEL_INFLAM, PANEL_MINERALS, _lab_test_index, _norm_marker,
    _parse_ref_range, compute_ratios, phenoage,
)
from fmdb.assess.lab_synthesis import synthesise_labs
from fmdb.plan.models import LabPretest

D = "2026-11-17"


def _lab(name, value, unit="", rng="", date=D):
    return {"test_name": name, "value": str(value), "unit": unit,
            "reference_range": rng, "date_drawn": date}


def _by_name(labs, ctx=None):
    return {r["marker_name"]: r for r in compute_ratios(labs, ctx)}


# Thyrocare-style CBC rows: % rows plus "X 10³ / µL" absolute rows.
CBC = [
    _lab("TOTAL LEUCOCYTES COUNT (WBC)", 6.11, "X 10³ / µL"),
    _lab("NEUTROPHILS", 68, "%"),
    _lab("NEUTROPHILS - ABSOLUTE COUNT", 4.15, "X 10³ / µL"),
    _lab("LYMPHOCYTE", 24.1, "%"),
    _lab("LYMPHOCYTES - ABSOLUTE COUNT", 1.47, "X 10³ / µL"),
    _lab("MONOCYTES", 2.5, "%"),
    _lab("MONOCYTES - ABSOLUTE COUNT", 0.15, "X 10³ / µL", "0.2-1.0"),
    _lab("PLATELET COUNT", 344, "X 10³ / µL"),
]


# ── Inflammation indices ─────────────────────────────────────────────────────

def test_sii_plr_mlr_from_absolute_counts():
    m = _by_name(CBC)
    sii = m["Systemic immune-inflammation index (SII)"]
    assert math.isclose(sii["value"], 344 * 4.15 / 1.47, rel_tol=1e-3)   # 971.2
    assert sii["flag"] == "high" and sii["panel"] == PANEL_INFLAM and sii["computed"]
    plr = m["Platelet/Lymphocyte ratio (PLR)"]
    assert math.isclose(plr["value"], 344 / 1.47, rel_tol=1e-3)           # 234.0
    assert plr["flag"] == "high"
    mlr = m["Monocyte/Lymphocyte ratio (MLR)"]
    assert math.isclose(mlr["value"], 0.15 / 1.47, abs_tol=0.001)         # 0.102
    assert mlr["flag"] == "optimal"


def test_nlr_never_mixes_percent_with_absolute():
    # Before: "\bneutrophil" grabbed the % row and "\blymphocyte" could grab
    # the absolute row — NLR 68 / 1.47 = 46. Now abs/abs.
    nlr = _by_name(CBC)["Neutrophil/Lymphocyte ratio (NLR)"]
    assert math.isclose(nlr["value"], 4.15 / 1.47, abs_tol=0.01)          # 2.82


def test_absolute_counts_derived_from_percent_and_wbc():
    labs = [_lab("WBC", 8.0, "10^3/uL"), _lab("Neutrophils", 60, "%"),
            _lab("Lymphocytes", 25, "%"), _lab("Platelets", 250000, "cells/cumm")]
    sii = _by_name(labs)["Systemic immune-inflammation index (SII)"]
    # neutrophils 4.8, lymphocytes 2.0 (x10^9/L); 250 x 4.8 / 2.0 = 600
    assert math.isclose(sii["value"], 600, rel_tol=1e-3)
    assert sii["flag"] == "suboptimal"
    assert "worked out from the %" in sii["fm_interpretation"]


def test_cells_per_cumm_absolute_counts_scaled():
    labs = [_lab("Absolute Neutrophil Count", 3600, "cells/cumm"),
            _lab("Absolute Lymphocyte Count", 2000, "cells/cumm"),
            _lab("Platelet Count", 2.5, "lakhs/cumm")]
    sii = _by_name(labs)["Systemic immune-inflammation index (SII)"]
    assert math.isclose(sii["value"], 250 * 3.6 / 2.0, rel_tol=1e-3)      # 450
    assert sii["flag"] == "optimal"


def test_crp_albumin_ratio_worked_example():
    labs = [_lab("HS-CRP", 4.2, "mg/L"), _lab("Albumin", 3.93, "g/dL")]
    car = _by_name(labs)["CRP/Albumin ratio"]
    assert math.isclose(car["value"], 4.2 / 39.3, abs_tol=0.001)          # 0.107
    assert car["flag"] == "high"


def test_crp_albumin_uses_standard_crp_and_albumin_in_g_per_l():
    labs = [_lab("C-Reactive Protein (CRP)", 1.5, "mg/L"), _lab("Albumin", 45, "g/L")]
    m = _by_name(labs)
    car = m["CRP/Albumin ratio"]
    assert math.isclose(car["value"], 1.5 / 45, abs_tol=0.001)            # 0.033
    assert car["flag"] == "suboptimal" and "CRP 1.5" in car["fm_interpretation"]
    assert "CRP" in m   # the standard CRP row still passes through


# ── Lipids ───────────────────────────────────────────────────────────────────

def test_remnant_cholesterol_worked_example():
    labs = [_lab("Total Cholesterol", 190), _lab("HDL Cholesterol - Direct", 62),
            _lab("LDL Cholesterol - Direct", 110), _lab("Triglycerides", 90)]
    r = _by_name(labs)["Remnant cholesterol"]
    assert r["value"] == 18 and r["flag"] == "optimal"
    assert "measured directly" in r["fm_interpretation"]


def test_remnant_high_and_calculated_ldl_note():
    labs = [_lab("Total Cholesterol", 240), _lab("HDL", 40), _lab("LDL", 160)]
    r = _by_name(labs)["Remnant cholesterol"]
    assert r["value"] == 40 and r["flag"] == "high"
    assert "TG/5" in r["fm_interpretation"]


def test_remnant_mmol_converted():
    labs = [_lab("Total Cholesterol", 5.0), _lab("HDL", 1.5), _lab("LDL", 3.0)]
    r = _by_name(labs)["Remnant cholesterol"]
    assert math.isclose(r["value"], 0.5 * 38.67, abs_tol=0.2)             # 19.3


def test_ldl_apob_ratio():
    ok = _by_name([_lab("LDL Cholesterol - Direct", 110), _lab("Apolipoprotein B", 85)])
    assert math.isclose(ok["LDL-C/ApoB ratio"]["value"], 110 / 85, abs_tol=0.001)
    assert ok["LDL-C/ApoB ratio"]["flag"] == "optimal"
    sd = _by_name([_lab("LDL Cholesterol", 100), _lab("Apo B", 0.95, "g/L")])
    assert math.isclose(sd["LDL-C/ApoB ratio"]["value"], 100 / 95, abs_tol=0.001)
    assert sd["LDL-C/ApoB ratio"]["flag"] == "low"
    assert "small dense" in sd["LDL-C/ApoB ratio"]["fm_interpretation"]


# ── Insulin sensitivity ──────────────────────────────────────────────────────

def test_quicki_worked_examples():
    good = _by_name([_lab("Fasting Blood Glucose", 90), _lab("Fasting Insulin", 5)])["QUICKI"]
    assert math.isclose(good["value"], 1 / (math.log10(5) + math.log10(90)), abs_tol=1e-3)
    assert math.isclose(good["value"], 0.377, abs_tol=1e-3) and good["flag"] == "optimal"
    ir = _by_name([_lab("Fasting Blood Glucose", 110), _lab("Fasting Insulin", 15)])["QUICKI"]
    assert math.isclose(ir["value"], 0.311, abs_tol=1e-3) and ir["flag"] == "high"


def test_mcauley_worked_examples():
    good = _by_name([_lab("Fasting Insulin", 5), _lab("Triglycerides", 88.57)])["McAuley index"]
    assert math.isclose(good["value"], math.exp(2.63 - 0.28 * math.log(5)), abs_tol=0.01)  # 8.84
    assert good["flag"] == "optimal"
    ir = _by_name([_lab("Fasting Insulin", 20), _lab("Triglycerides", 200)])["McAuley index"]
    expected = math.exp(2.63 - 0.28 * math.log(20) - 0.31 * math.log(200 / 88.57))
    assert math.isclose(ir["value"], expected, abs_tol=0.01)              # 4.66
    assert ir["flag"] == "high"


def test_shbg_sex_aware_reading():
    low = _by_name([_lab("SHBG", 25)], {"sex": "F"})["SHBG"]
    assert low["flag"] == "low" and "insulin resistance" in low["fm_interpretation"]
    ok = _by_name([_lab("SHBG", 70)], {"sex": "F"})["SHBG"]
    assert ok["flag"] == "optimal"
    hi_m = _by_name([_lab("SHBG", 75)], {"sex": "M"})["SHBG"]
    assert hi_m["flag"] == "high"
    assert _by_name([_lab("SHBG", 25)])["SHBG"]["flag"] == "normal"   # no sex → neutral


# ── Thyroid ──────────────────────────────────────────────────────────────────

def test_spina_gd_conventional_and_si_units_agree():
    conv = _by_name([_lab("Free T4", 1.2), _lab("Free T3", 3.0)])["SPINA-GD (deiodinase activity)"]
    si = _by_name([_lab("Free T4", 15.444), _lab("Free T3", 4.608)])["SPINA-GD (deiodinase activity)"]
    # 8e-6 x (5e-7 + 15.444e-12) x 601 x 4.608e-12 / (0.026 x 15.444e-12) = 27.6 nmol/s
    assert math.isclose(conv["value"], 27.6, abs_tol=0.1)
    assert math.isclose(conv["value"], si["value"], abs_tol=0.1)
    assert conv["flag"] == "optimal"
    low = _by_name([_lab("Free T4", 1.6), _lab("Free T3", 2.0)])["SPINA-GD (deiodinase activity)"]
    assert math.isclose(low["value"], 13.8, abs_tol=0.1) and low["flag"] == "low"
    high = _by_name([_lab("Free T4", 0.9), _lab("Free T3", 4.4)])["SPINA-GD (deiodinase activity)"]
    assert high["flag"] == "high"


def test_jostel_tsh_index():
    ok = _by_name([_lab("TSH", 2.0), _lab("Free T4", 15.4, "pmol/L")])["Jostel's TSH index (TSHI)"]
    assert math.isclose(ok["value"], math.log(2.0) + 0.1345 * 15.4, abs_tol=0.001)  # 2.764
    assert ok["flag"] == "optimal"
    low = _by_name([_lab("TSH", 0.3), _lab("Free T4", 10)])["Jostel's TSH index (TSHI)"]
    assert math.isclose(low["value"], math.log(0.3) + 1.345, abs_tol=0.001)        # 0.141
    assert low["flag"] == "low"


def test_thyroid_structure_skipped_with_total_hormones_only():
    m = _by_name([_lab("TSH", 2.0), _lab("Total T4", 8.0), _lab("Total T3", 110)])
    assert "SPINA-GD (deiodinase activity)" not in m
    assert "Jostel's TSH index (TSHI)" not in m


# ── Minerals ─────────────────────────────────────────────────────────────────

def test_corrected_calcium():
    m = _by_name([_lab("Calcium", 9.4), _lab("Albumin", 3.93)])
    cc = m["Calcium (albumin-corrected)"]
    assert math.isclose(cc["value"], 9.4 + 0.8 * (4.0 - 3.93), abs_tol=0.001)     # 9.456
    assert cc["flag"] == "optimal" and cc["panel"] == PANEL_MINERALS
    low_alb = _by_name([_lab("Calcium", 8.2), _lab("Albumin", 3.0)])["Calcium (albumin-corrected)"]
    assert math.isclose(low_alb["value"], 9.0, abs_tol=0.001) and low_alb["flag"] == "optimal"
    mmol = _by_name([_lab("Calcium", 2.35, "mmol/L"), _lab("Albumin", 4.0)])["Calcium (albumin-corrected)"]
    assert math.isclose(mmol["value"], 2.35 * 4.008, abs_tol=0.01)
    assert "Ionised Calcium" not in m  # ionised never read as total


def test_ionised_and_urine_calcium_not_used():
    m = _by_name([_lab("Ionised Calcium", 1.2), _lab("24-hr urinary calcium", 200), _lab("Albumin", 4.0)])
    assert "Calcium (albumin-corrected)" not in m


def test_ca_p_na_k_zn_cu():
    m = _by_name([_lab("Calcium", 9.4), _lab("Phosphorus", 3.5), _lab("Sodium", 139),
                  _lab("Potassium", 4.3), _lab("Serum Zinc", 85), _lab("Serum Copper", 110)])
    assert math.isclose(m["Calcium/Phosphorus ratio"]["value"], 9.4 / 3.5, abs_tol=0.001)
    assert m["Calcium/Phosphorus ratio"]["flag"] == "optimal"
    assert math.isclose(m["Sodium/Potassium ratio"]["value"], 139 / 4.3, abs_tol=0.1)
    assert m["Sodium/Potassium ratio"]["flag"] == "optimal"
    zc = m["Zinc/Copper ratio"]
    assert math.isclose(zc["value"], 85 / 110, abs_tol=0.001) and zc["flag"] == "suboptimal"
    low_nak = _by_name([_lab("Sodium", 140), _lab("Potassium", 5.5)])["Sodium/Potassium ratio"]
    assert low_nak["flag"] == "low"


def test_alkaline_phosphatase_never_read_as_phosphorus():
    m = _by_name([_lab("Calcium", 9.4), _lab("Alkaline Phosphatase", 80)])
    assert "Calcium/Phosphorus ratio" not in m


# ── PhenoAge ─────────────────────────────────────────────────────────────────

PHENO_LABS = [
    _lab("Albumin", 3.93), _lab("Creatinine", 0.64), _lab("Fasting Blood Glucose", 93.75),
    _lab("HS-CRP", 4.2, "mg/L"), _lab("Lymphocyte", 24.1, "%"), _lab("MCV", 86.5),
    _lab("RDW-CV", 13.6, "%"), _lab("Alkaline Phosphatase", 76.9), _lab("WBC", 6.11),
]


def test_phenoage_worked_example():
    v = phenoage(albumin_g_dl=3.93, creatinine=0.64, glucose=93.75, crp_mg_l=4.2,
                 lymph_pct=24.1, mcv=86.5, rdw_cv=13.6, alp=76.9, wbc=6.11, age=51)
    assert math.isclose(v, 46.6, abs_tol=0.1)


def test_phenoage_via_compute_ratios():
    r = _by_name(PHENO_LABS, {"age": 51})["PhenoAge (research score)"]
    assert math.isclose(r["value"], 46.6, abs_tol=0.1)
    assert r["panel"] == PANEL_BIOAGE and r["flag"] == "optimal"
    assert "research score" in r["fm_interpretation"].lower()
    assert "trend" in r["fm_interpretation"]


def test_phenoage_needs_age_and_every_input():
    assert "PhenoAge (research score)" not in _by_name(PHENO_LABS)
    assert "PhenoAge (research score)" not in _by_name(PHENO_LABS[:-1], {"age": 51})


def test_rdw_sd_never_read_as_rdw_cv():
    m = _by_name([_lab("RDW-SD", 42.1, "fL"), _lab("RDW-CV", 13.0, "%")])
    assert m["RDW (cell variability)"]["value"] == 13.0
    assert m["RDW-SD"]["flag"] == "optimal"
    only_sd = _by_name([_lab("Red Cell Distribution Width - SD (RDW-SD)", 44.0, "fL")])
    assert "RDW (cell variability)" not in only_sd


# ── Classifiers ──────────────────────────────────────────────────────────────

def _synth(labs, ctx=None):
    ctx = dict(ctx or {})
    return synthesise_labs(compute_ratios(labs, ctx), ctx)


def _patterns(labs, ctx=None):
    return {p["key"]: p for p in _synth(labs, ctx)["patterns"]}


def test_iron_true_deficiency_anaemia():
    p = _patterns([_lab("Ferritin", 15), _lab("Hemoglobin", 10.8)], {"sex": "F"})
    assert p["iron_deficiency"]["level"] == "red"
    assert p["iron_deficiency"]["label"] == "Iron-deficiency anaemia"


def test_iron_inflammatory_block_is_cross_system():
    labs = [_lab("Ferritin", 180), _lab("Serum Iron", 50), _lab("TIBC", 350),
            _lab("HS-CRP", 4.2, "mg/L")]
    p = _patterns(labs, {"sex": "F"})["iron_inflammatory_block"]
    assert p["kind"] == "cross_system" and p["level"] == "red"
    assert "inflammation" in p["systems"]


def test_iron_masked_and_overload_and_metabolic():
    masked = _patterns([_lab("Ferritin", 60), _lab("Serum Iron", 45), _lab("TIBC", 350),
                        _lab("HS-CRP", 5, "mg/L")])
    assert "iron_mixed" in masked
    over = _patterns([_lab("Ferritin", 400), _lab("Serum Iron", 180), _lab("TIBC", 300)])
    assert "iron_overload" in over
    meta = _patterns([_lab("Ferritin", 350), _lab("Serum Iron", 100), _lab("TIBC", 330),
                      _lab("HS-CRP", 0.8, "mg/L")])
    assert "iron_metabolic_ferritin" in meta


def test_thalassaemia_trait_screen():
    labs = [_lab("MCV", 68), _lab("RBC Count", 5.6, "mill/cumm"), _lab("RDW-CV", 14.0, "%"),
            _lab("Ferritin", 60), _lab("Hemoglobin", 11.5)]
    m = _by_name(labs)
    assert math.isclose(m["Mentzer index"]["value"], 68 / 5.6, abs_tol=0.05)   # 12.1
    assert "thalassaemia trait" in m["Mentzer index"]["fm_interpretation"]
    p = _patterns(labs, {"sex": "F"})
    assert "iron_thal_trait" in p and "iron_deficiency" not in p


def test_anaemia_type_bessman():
    micro = _patterns([_lab("MCV", 72), _lab("RDW-CV", 16, "%"), _lab("Hemoglobin", 10.5)],
                      {"sex": "F"})["anaemia_type"]
    assert micro["label"].startswith("Anaemia type: microcytic, mixed")
    assert "iron deficiency" in micro["detail"]
    macro = _patterns([_lab("MCV", 104), _lab("RDW-CV", 15.5, "%"), _lab("Hemoglobin", 13.0)],
                      {"sex": "F"})["anaemia_type"]
    assert macro["label"].startswith("Red-cell pattern: macrocytic")
    assert "B12 or folate" in macro["detail"]
    assert "anaemia_type" not in _patterns([_lab("MCV", 88), _lab("RDW-CV", 12.5, "%"),
                                            _lab("Hemoglobin", 13.5)])


def test_methylation_patterns():
    gap = _patterns([_lab("Homocysteine", 13), _lab("Vitamin B12", 450), _lab("Folate", 6)])
    assert gap["methylation_gap"]["kind"] == "cross_system"
    assert "folate" in gap["methylation_gap"]["label"].lower()
    block = _patterns([_lab("Homocysteine", 13), _lab("Vitamin B12", 1100), _lab("Folate", 18)])
    assert "methylation_block" in block
    early = _patterns([_lab("Homocysteine", 6), _lab("Vitamin B12", 300)])
    assert "methylation_early_b12" in early


def test_thyroid_antibody_status():
    pos = _patterns([_lab("Anti-TPO", 120, rng="<34"), _lab("TSH", 3.1)])
    assert pos["thyroid_autoimmune"]["level"] == "amber"
    assert "TPO antibodies positive" in pos["thyroid_autoimmune"]["label"]
    neg = _patterns([_lab("Anti-TPO", 12, rng="<34"), _lab("Anti-Thyroglobulin", 5, rng="Up to 95")])
    assert "thyroid_antibodies_negative" in neg


# ── Cross-system rules ───────────────────────────────────────────────────────

def test_rule_inflammation_driven_conversion():
    p = _patterns([_lab("Free T3", 2.6), _lab("HS-CRP", 5, "mg/L")])
    assert p["inflamed_thyroid_conversion"]["level"] == "red"
    assert "inflamed_thyroid_conversion" not in _patterns([_lab("Free T3", 2.6),
                                                           _lab("HS-CRP", 0.5, "mg/L")])


def test_rule_ir_driven_fatty_liver():
    labs = [_lab("SGPT (ALT)", 46.5), _lab("SGOT (AST)", 26.7), _lab("Triglycerides", 150),
            _lab("Fasting Blood Glucose", 105), _lab("SHBG", 25)]
    p = _patterns(labs, {"sex": "F"})["ir_fatty_liver"]
    assert p["level"] == "red" and set(p["systems"]) == {"liver", "metabolic"}
    # Normal SHBG argues against it — the rule stays quiet.
    labs_ok = labs[:-1] + [_lab("SHBG", 80)]
    assert "ir_fatty_liver" not in _patterns(labs_ok, {"sex": "F"})
    # SHBG not measured: still fires, amber, says SHBG would confirm.
    nos = _patterns(labs[:-1], {"sex": "F"})["ir_fatty_liver"]
    assert nos["level"] == "amber" and "SHBG not measured" in nos["detail"]


def test_rule_allergic_airway():
    labs = [_lab("Total IgE", 450, "IU/mL"),
            _lab("Eosinophils - Absolute Count", 0.6, "X 10³ / µL"),
            _lab("HS-CRP", 4, "mg/L")]
    p = _patterns(labs)["allergic_inflammation"]
    assert p["level"] == "red"


def test_rule_lpa_with_crp_and_apob_discordance_and_ferritin_thyroid():
    p = _patterns([_lab("Lipoprotein (a)", 80), _lab("HS-CRP", 4, "mg/L")])
    assert "lpa_inflammation" in p
    d = _patterns([_lab("Apolipoprotein B", 110), _lab("LDL Cholesterol - Direct", 115)])
    assert "apob_ldl_discordance_high" in d
    f = _patterns([_lab("Ferritin", 30), _lab("TSH", 3.5)])
    assert "low_ferritin_thyroid" in f


# ── System scores ────────────────────────────────────────────────────────────

def _systems(labs, ctx=None):
    return {s["key"]: s for s in _synth(labs, ctx)["systems"]}


def test_system_scores_green_red_amber_and_no_data():
    s = _systems([_lab("Fasting Blood Glucose", 85), _lab("HbA1c", 5.1)])
    assert s["metabolic"]["status"] == "green" and s["thyroid"]["status"] == "no_data"
    red = _systems([_lab("Fasting Blood Glucose", 110), _lab("HbA1c", 6.0),
                    _lab("Fasting Insulin", 14)])
    assert red["metabolic"]["status"] == "red"
    assert any(d["marker"] == "HbA1c" for d in red["metabolic"]["drivers"])
    amber = _systems([_lab("Fasting Blood Glucose", 110), _lab("HbA1c", 5.1)])
    assert amber["metabolic"]["status"] == "amber"


def test_system_with_only_confounded_markers_is_amber_low_confidence():
    labs = [_lab("SGPT (ALT)", 60), _lab("SGOT (AST)", 55)]
    ctx = {"pretest": {"hard_exercise_72h": True}, "pretest_date": D}
    liver = _systems(labs, ctx)["liver"]
    assert liver["status"] == "amber" and liver["low_confidence"] is True
    assert _systems(labs)["liver"]["status"] == "red"


def test_toxic_load_from_uncatalogued_metal_out_of_lab_range():
    s = _systems([_lab("Lead", 4.1, "µg/dL", "< 3.5"), _lab("Mercury", 0.5, "µg/L", "< 5")])
    assert s["toxic"]["status"] == "amber"


# ── Confounders ──────────────────────────────────────────────────────────────

def _conf(labs, pretest, ctx=None):
    c = {**(ctx or {}), "pretest": pretest, "pretest_date": D}
    return _by_name(labs, c)


def test_illness_lowers_confidence_on_inflammation_markers():
    m = _conf([_lab("HS-CRP", 6, "mg/L"), _lab("Ferritin", 250), _lab("TSH", 2)],
              {"illness_3w": True, "illness_note": "cold 10 days before"})
    assert m["hsCRP (inflammation)"]["confidence"] == "low"
    assert "Illness in the 3 weeks before" in m["hsCRP (inflammation)"]["confounded_by"]
    assert "cold 10 days before" in m["hsCRP (inflammation)"]["fm_interpretation"]
    assert m["Ferritin (iron stores)"]["confidence"] == "low"
    assert "confidence" not in m["TSH"]


def test_exercise_hits_alt_ast_ck_but_not_ggt():
    m = _conf([_lab("SGPT (ALT)", 60), _lab("SGOT (AST)", 55), _lab("GGT", 30),
               _lab("Creatine Kinase", 900)], {"hard_exercise_72h": True})
    assert m["ALT (liver cells)"]["confidence"] == "low"
    assert m["AST (liver/muscle)"]["confidence"] == "low"
    assert m["Creatine Kinase"]["confidence"] == "low"
    assert "confidence" not in m["GGT (oxidative stress)"]


def test_paracetamol_alcohol_biotin_creatine_fasting():
    m = _conf([_lab("SGPT (ALT)", 30), _lab("GGT", 30), _lab("TSH", 0.3), _lab("Free T4", 2.1),
               _lab("Creatinine", 1.2), _lab("eGFR", 70), _lab("Fasting Blood Glucose", 102),
               _lab("Triglycerides", 160)],
              {"paracetamol_48h": True, "alcohol_48h": True, "biotin_72h": True,
               "creatine": True, "fasted": False})
    assert "Paracetamol in the 48 h before" in m["ALT (liver cells)"]["confounded_by"]
    assert "Alcohol in the 48 h before" in m["GGT (oxidative stress)"]["confounded_by"]
    assert "Biotin in the 72 h before" in m["TSH"]["confounded_by"]
    assert "Taking creatine" in m["eGFR"]["confounded_by"]
    assert "Not fasted" in m["Fasting glucose"]["confounded_by"]


def test_oral_estrogen_vs_transdermal():
    labs = [_lab("SHBG", 140), _lab("HS-CRP", 3.5, "mg/L")]
    oral = _conf(labs, {"hormone_route": "oral_estrogen"}, {"sex": "F"})
    assert oral["SHBG"]["confidence"] == "low"
    assert oral["hsCRP (inflammation)"]["confidence"] == "low"
    td = _conf(labs, {"hormone_route": "transdermal_estrogen"}, {"sex": "F"})
    assert "confidence" not in td["SHBG"]


def test_vitamin_d_dose_and_cycle_day():
    m = _conf([_lab("25-OH Vitamin D", 110), _lab("Progesterone", 0.4), _lab("FSH", 6)],
              {"high_dose_vitamin_d": True, "cycle_day": 3})
    assert m["25-OH Vitamin D"]["confidence"] == "low"
    assert m["Progesterone"]["confidence"] == "low"
    assert "early follicular" in m["Progesterone"]["fm_interpretation"]
    assert "confidence" not in m["Follicle Stimulating Hormone (FSH)"]
    unknown = _conf([_lab("Progesterone", 0.4)], {"fasted": True})
    assert "Cycle day not recorded" in unknown["Progesterone"]["confounded_by"]
    no_cycle = _conf([_lab("Progesterone", 0.4)], {"no_cycle": True})
    assert "confidence" not in no_cycle["Progesterone"]


def test_no_pretest_changes_nothing_and_synthesis_says_unknown():
    labs = [_lab("HS-CRP", 6, "mg/L")]
    m = _by_name(labs)
    assert "confidence" not in m["hsCRP (inflammation)"]
    s = _synth(labs)
    assert s["confounders"]["recorded"] is False
    assert "No pre-test answers" in s["confounders"]["note"]


def test_stale_pretest_from_an_older_draw_is_ignored():
    labs = [_lab("HS-CRP", 6, "mg/L", date="2026-12-20")]
    ctx = {"pretest": {"illness_3w": True}, "pretest_date": D}
    m = compute_ratios(labs, ctx)
    assert "confidence" not in m[0]
    s = synthesise_labs(m, ctx)
    assert s["confounders"]["recorded"] is False
    assert D in s["confounders"]["note"]


def test_synthesis_lists_applied_confounders():
    labs = [_lab("HS-CRP", 6, "mg/L"), _lab("SGPT (ALT)", 60)]
    s = _synth(labs, {"pretest": {"illness_3w": True}, "pretest_date": D})
    assert s["confounders"]["recorded"] is True
    applied = {a["label"]: a for a in s["confounders"]["applied"]}
    assert "hsCRP (inflammation)" in applied["Illness in the 3 weeks before"]["affects"]


# ── Pre-test storage ─────────────────────────────────────────────────────────

def test_lab_pretest_model_forbids_unknown_fields_and_bounds_cycle_day():
    p = LabPretest(illness_3w=True, hormone_route="oral_estrogen", cycle_day=21)
    assert p.illness_3w is True
    with pytest.raises(Exception):
        LabPretest(illness=True)
    with pytest.raises(Exception):
        LabPretest(cycle_day=0)
    with pytest.raises(Exception):
        LabPretest(hormone_route="patch")


def test_client_context_reads_pretest_of_latest_lab_draw_only():
    client = {"health_snapshots": [
        {"date": "2026-06-01", "source": "lab_report", "lab_values": [{"test_name": "TSH"}],
         "pretest": {"illness_3w": True}},
        {"date": "2026-11-17", "source": "lab_report", "lab_values": [{"test_name": "TSH"}]},
        {"date": "2026-11-20", "source": "manual", "measurements": {"weight_kg": 60}},
    ]}
    ctx = lab_client_context(client)
    assert ctx["pretest"] is None   # June answers never carry to November
    client["health_snapshots"][1]["pretest"] = {"biotin_72h": True}
    ctx = lab_client_context(client)
    assert ctx["pretest"] == {"biotin_72h": True} and ctx["pretest_date"] == "2026-11-17"


# ── Thyrocare formats and the lab-range fallback ─────────────────────────────

def test_thyrocare_thousands_per_ul_counts_normalised():
    m = _by_name([_lab("MONOCYTES - ABSOLUTE COUNT", 0.35, "X 10³ / µL")])
    mono = m["Absolute Monocyte Count"]
    assert mono["value"] == 350 and mono["flag"] == "normal"
    assert "x10³/µL" in mono["fm_interpretation"]
    low = _by_name([_lab("MONOCYTES - ABSOLUTE COUNT", 0.15, "X 10³ / µL", "0.2-1.0")])
    assert low["Absolute Monocyte Count"]["value"] == 150
    assert low["Absolute Monocyte Count"]["flag"] == "low"


def test_no_fm_range_falls_back_to_lab_range():
    hi = _by_name([_lab("Lipase", 65.5, "U/L", "5 - 60")])["Lipase"]
    assert hi["flag"] == "high" and "lab's range" in hi["fm_interpretation"]
    ok = _by_name([_lab("Lipase", 30, "U/L", "5 - 60")])["Lipase"]
    assert ok["flag"] == "normal" and "FM-optimal range" not in ok["fm_interpretation"].split(";")[0]


def test_no_lab_range_falls_back_to_conventional():
    hi = _by_name([_lab("Lipase", 65.5, "U/L")])["Lipase"]   # catalogue 10-60
    assert hi["flag"] == "high"


def test_uncatalogued_marker_judged_against_lab_range():
    m = _by_name([_lab("Thallium", 0.9, "µg/L", "< 0.4")])
    assert m["Thallium"]["flag"] == "high" and m["Thallium"]["panel"] == "Other"


@pytest.mark.parametrize("rng,expected", [
    ("5 - 60", (5, 60)), ("0.6 to 1.1", (0.6, 1.1)), ("< 100", (None, 100)),
    ("Up to 95", (None, 95)), ("> 40", (40, None)),
    ("Males: 0.7-1.3; Females: 0.6-1.1", (None, None)),
    ("Males ≥50y: 18.7-74.2", (None, None)), ("", (None, None)),
])
def test_parse_ref_range(rng, expected):
    assert _parse_ref_range(rng) == expected


# ── Catalogue ────────────────────────────────────────────────────────────────

NEW_SLUGS = [
    "systemic-immune-inflammation-index", "platelet-lymphocyte-ratio",
    "monocyte-lymphocyte-ratio", "crp-albumin-ratio", "remnant-cholesterol",
    "ldl-apob-ratio", "quicki", "mcauley-index", "spina-gd", "jostel-tsh-index",
    "corrected-calcium", "calcium-phosphorus-ratio", "sodium-potassium-ratio",
    "zinc-copper-ratio", "phenoage",
]


def test_every_new_index_has_a_catalogue_entry():
    slugs = {lt["slug"] for lt in _lab_test_index().values()}
    assert set(NEW_SLUGS) <= slugs


def test_lab_printed_index_does_not_duplicate_the_computed_one():
    labs = CBC + [_lab("SII", 900, "")]
    names = [r["marker_name"] for r in compute_ratios(labs)]
    assert names.count("Systemic immune-inflammation index (SII)") == 1
    assert not any(_norm_marker(n) == _norm_marker("SII") for n in names)


# ── Rebuild helper + save-lab-pretest.py ─────────────────────────────────────

def test_rebuild_lab_outputs_writes_markers_and_synthesis():
    from fmdb.assess.lab_rebuild import rebuild_lab_outputs
    data = {"sex": "F", "health_snapshots": [
        {"date": D, "source": "lab_report", "pretest": {"illness_3w": True},
         "lab_values": [{"test_name": "HS-CRP", "value": "4.2", "unit": "mg/L"}]},
    ]}
    assert rebuild_lab_outputs(data) == len(data["lab_markers"]) > 0
    assert data["lab_markers_date"] == D
    assert data["lab_synthesis"]["confounders"]["recorded"] is True
    assert data["lab_markers"][0]["confidence"] == "low"
    assert rebuild_lab_outputs({"health_snapshots": []}) == 0


def test_save_lab_pretest_script(tmp_path):
    import json
    import subprocess
    import sys
    from pathlib import Path

    import yaml

    client_dir = tmp_path / "clients" / "cl-x"
    client_dir.mkdir(parents=True)
    (client_dir / "client.yaml").write_text(yaml.safe_dump({
        "client_id": "cl-x", "sex": "F",
        "health_snapshots": [
            {"date": D, "source": "lab_report",
             "lab_values": [{"test_name": "SGPT", "value": "60", "unit": "U/L"}]},
            {"date": D, "source": "cbc_report",
             "lab_values": [{"test_name": "WBC", "value": "6.1", "unit": ""}]},
        ],
    }))
    script = (Path(__file__).resolve().parents[2] / "fm-database-web" / "scripts"
              / "save-lab-pretest.py")
    env = {"FMDB_PLANS_DIR": str(tmp_path), "PATH": "/usr/bin:/bin"}

    def run(payload):
        out = subprocess.run([sys.executable, str(script)], input=json.dumps(payload),
                             capture_output=True, text=True, env=env, timeout=60)
        return json.loads(out.stdout)

    res = run({"client_id": "cl-x", "date": D, "pretest": {"hard_exercise_72h": True}})
    assert res["ok"] and res["snapshots"] == 2
    data = yaml.safe_load((client_dir / "client.yaml").read_text())
    assert all(s["pretest"]["hard_exercise_72h"] for s in data["health_snapshots"])
    alt = next(m for m in data["lab_markers"] if m["marker_name"].startswith("ALT"))
    assert alt["confidence"] == "low"
    assert data["lab_synthesis"]["confounders"]["recorded"] is True

    assert run({"client_id": "cl-x", "date": D, "pretest": {"nope": 1}})["ok"] is False
    assert run({"client_id": "cl-x", "date": "2026-01-01", "pretest": {}})["ok"] is False
    assert run({"client_id": "../x", "date": D, "pretest": {}})["ok"] is False
