"""Liver & Metabolic Risk indices computed by lab_ratios (section 6b).

TyG, TyG-BMI, TyG-WC, Hepatic Steatosis Index, Fatty Liver Index, Lipid
Accumulation Product and FIB-4 — deterministic arithmetic over the labs plus
the client facts from `fmdb.assess.client_context.lab_client_context`.

Run: .venv/bin/python -m pytest tests/test_liver_metabolic_indices.py  (from fm-database/)
"""

import math
from datetime import date

import pytest

from fmdb.assess import lab_ratios
from fmdb.assess.client_context import lab_client_context
from fmdb.assess.lab_ratios import (
    PANEL_LIVER_METABOLIC, _lab_test_index, _norm_marker, compute_ratios,
)

D = "2026-11-01"
NAMES = {
    "TyG index", "TyG-BMI", "TyG-WC", "Hepatic Steatosis Index (HSI)",
    "Fatty Liver Index (FLI)", "Lipid accumulation product (LAP)", "FIB-4",
}


def _lab(name, value, unit=""):
    return {"test_name": name, "value": str(value), "unit": unit, "date_drawn": D}


def _labs(**v):
    names = {
        "tg": "Triglycerides", "glucose": "Fasting Blood Glucose",
        "alt": "SGPT (ALT)", "ast": "SGOT (AST)", "ggt": "Gamma GT (GGT)",
        "plt": "Platelet Count", "hba1c": "HbA1c",
    }
    return [_lab(names[k], val) for k, val in v.items()]


def _risk(labs, ctx=None):
    return {r["marker_name"]: r for r in compute_ratios(labs, ctx)
            if r["panel"] == PANEL_LIVER_METABOLIC}


# The coach's own report (worked examples from the brief).
COACH_LABS = dict(tg=54, glucose=93.75, alt=46.5, ast=26.7, plt=344000, ggt=20)
COACH_CTX = {"age": 51, "sex": "F", "bmi": 24.0, "waist_cm": 80.0,
             "diabetes": False}


# ── TyG ──────────────────────────────────────────────────────────────────────

def test_tyg_worked_example():
    r = _risk(_labs(tg=54, glucose=93.75))["TyG index"]
    assert math.isclose(r["value"], math.log(54 * 93.75 / 2), abs_tol=0.001)
    assert math.isclose(r["value"], 7.84, abs_tol=0.005)
    assert r["flag"] == "optimal" and r["computed"] is True
    assert "vary by population" in r["fm_interpretation"]
    assert "fasting" in r["fm_interpretation"]


@pytest.mark.parametrize("target,flag", [
    (8.29, "optimal"), (8.31, "suboptimal"), (8.6, "suboptimal"),
    (8.79, "suboptimal"), (8.81, "high"),
])
def test_tyg_flag_thresholds(target, flag):
    tg = 2 * math.exp(target) / 100  # glucose 100 -> TyG == target
    assert _risk(_labs(tg=round(tg, 4), glucose=100))["TyG index"]["flag"] == flag


def test_tyg_converts_mmol_units():
    mg = _risk(_labs(tg=150, glucose=99))["TyG index"]["value"]
    mmol = _risk(_labs(tg=150 / 88.57, glucose=99 / 18.016))["TyG index"]["value"]
    assert math.isclose(mg, mmol, abs_tol=0.002)


def test_tyg_bmi_and_wc_need_bmi_and_waist():
    out = _risk(_labs(tg=54, glucose=93.75))
    assert "TyG-BMI" not in out and "TyG-WC" not in out
    out = _risk(_labs(tg=54, glucose=93.75), {"bmi": 24.0})
    tyg = math.log(54 * 93.75 / 2)
    assert math.isclose(out["TyG-BMI"]["value"], tyg * 24.0, abs_tol=0.1)
    assert "TyG-WC" not in out
    out = _risk(_labs(tg=54, glucose=93.75), {"waist_cm": 80.0})
    assert math.isclose(out["TyG-WC"]["value"], tyg * 80.0, abs_tol=0.1)
    assert "TyG-BMI" not in out


# ── HSI ──────────────────────────────────────────────────────────────────────

def test_hsi_formula_female_no_diabetes():
    r = _risk(_labs(alt=46.5, ast=26.7), COACH_CTX)["Hepatic Steatosis Index (HSI)"]
    assert math.isclose(r["value"], 8 * 46.5 / 26.7 + 24.0 + 2, abs_tol=0.1)
    assert r["flag"] == "high"  # 39.9 > 36
    assert "paracetamol" in r["fm_interpretation"]


def test_hsi_adds_two_for_diabetes_from_record_or_hba1c():
    base = {"age": 51, "sex": "M", "bmi": 24.0}
    plain = _risk(_labs(alt=20, ast=20), base)["Hepatic Steatosis Index (HSI)"]["value"]
    rec = _risk(_labs(alt=20, ast=20), {**base, "diabetes": True,
                "diabetes_record": "type 2 diabetes"})
    lab = _risk(_labs(alt=20, ast=20, hba1c=6.8), base)
    assert math.isclose(plain, 8 + 24.0, abs_tol=0.01)  # male: no +2
    assert math.isclose(rec["Hepatic Steatosis Index (HSI)"]["value"], plain + 2, abs_tol=0.01)
    assert "type 2 diabetes" in rec["Hepatic Steatosis Index (HSI)"]["fm_interpretation"]
    assert math.isclose(lab["Hepatic Steatosis Index (HSI)"]["value"], plain + 2, abs_tol=0.01)


@pytest.mark.parametrize("bmi,flag", [(21.9, "optimal"), (22.0, "suboptimal"),
                                      (28.0, "suboptimal"), (28.1, "high")])
def test_hsi_flag_thresholds(bmi, flag):
    # male, ALT == AST: HSI = 8 + BMI -> 29.9 / 30 / 36 / 36.1
    out = _risk(_labs(alt=20, ast=20), {"sex": "M", "bmi": bmi})
    assert out["Hepatic Steatosis Index (HSI)"]["flag"] == flag


def test_hsi_skipped_without_sex_or_bmi():
    assert "Hepatic Steatosis Index (HSI)" not in _risk(_labs(alt=20, ast=20), {"bmi": 25})
    assert "Hepatic Steatosis Index (HSI)" not in _risk(_labs(alt=20, ast=20), {"sex": "F"})


# ── FLI ──────────────────────────────────────────────────────────────────────

def _fli(tg, bmi, ggt, waist):
    y = 0.953 * math.log(tg) + 0.139 * bmi + 0.718 * math.log(ggt) + 0.053 * waist - 15.745
    return 100 * math.exp(y) / (1 + math.exp(y))


def test_fli_bedogni_formula_and_worked_example():
    r = _risk(_labs(tg=150, ggt=40), {"bmi": 30.0, "waist_cm": 100.0})["Fatty Liver Index (FLI)"]
    assert math.isclose(r["value"], _fli(150, 30, 40, 100), abs_tol=0.1)
    assert math.isclose(r["value"], 76, abs_tol=0.5)  # the catalogue's worked example
    assert r["flag"] == "high"
    assert "GGT is not raised by exercise" in r["fm_interpretation"]


def test_fli_flag_bands():
    low = _risk(_labs(tg=54, ggt=20), {"bmi": 24.0, "waist_cm": 80.0})["Fatty Liver Index (FLI)"]
    mid = _risk(_labs(tg=120, ggt=30), {"bmi": 27.0, "waist_cm": 92.0})["Fatty Liver Index (FLI)"]
    assert low["value"] < 30 and low["flag"] == "optimal"
    assert 30 <= mid["value"] < 60 and mid["flag"] == "suboptimal"


def test_fli_needs_waist_and_ggt():
    assert "Fatty Liver Index (FLI)" not in _risk(_labs(tg=150, ggt=40), {"bmi": 30.0})
    assert "Fatty Liver Index (FLI)" not in _risk(_labs(tg=150), {"bmi": 30.0, "waist_cm": 100.0})


# ── LAP ──────────────────────────────────────────────────────────────────────

def test_lap_sex_specific_formula():
    f = _risk(_labs(tg=88.57), {"sex": "F", "waist_cm": 90.0})["Lipid accumulation product (LAP)"]
    m = _risk(_labs(tg=88.57), {"sex": "M", "waist_cm": 90.0})["Lipid accumulation product (LAP)"]
    assert math.isclose(f["value"], 32.0, abs_tol=0.05)  # (90-58) x 1.0 mmol/L
    assert math.isclose(m["value"], 25.0, abs_tol=0.05)  # (90-65) x 1.0 mmol/L
    assert f["flag"] == "suboptimal" and m["flag"] == "optimal"


def test_lap_floors_at_zero_and_needs_sex():
    r = _risk(_labs(tg=100), {"sex": "M", "waist_cm": 60.0})["Lipid accumulation product (LAP)"]
    assert r["value"] == 0
    assert "Lipid accumulation product (LAP)" not in _risk(_labs(tg=100), {"waist_cm": 90.0})


def test_lap_high_band():
    r = _risk(_labs(tg=200), {"sex": "F", "waist_cm": 100.0})["Lipid accumulation product (LAP)"]
    assert r["value"] > 50 and r["flag"] == "high"


# ── FIB-4 ────────────────────────────────────────────────────────────────────

def test_fib4_worked_example():
    r = _risk(_labs(alt=46.5, ast=26.7, plt=344), {"age": 51})["FIB-4"]
    assert math.isclose(r["value"], 51 * 26.7 / (344 * math.sqrt(46.5)), abs_tol=0.001)
    assert math.isclose(r["value"], 0.58, abs_tol=0.005)
    assert r["flag"] == "optimal"
    assert "paracetamol" in r["fm_interpretation"]


@pytest.mark.parametrize("plt", [344, 344000, 3.44])  # 10^9/L, cells/cumm, lakhs
def test_fib4_normalises_platelet_units(plt):
    r = _risk(_labs(alt=46.5, ast=26.7, plt=plt), {"age": 51})["FIB-4"]
    assert math.isclose(r["value"], 0.58, abs_tol=0.005)


def _fib4_labs(target, age, alt=25.0, plt=200.0):
    ast = target * plt * math.sqrt(alt) / age
    return _labs(alt=alt, ast=round(ast, 4), plt=plt)


@pytest.mark.parametrize("target,age,flag", [
    (1.2, 50, "optimal"), (1.31, 50, "suboptimal"), (2.67, 50, "suboptimal"),
    (2.7, 50, "high"),
    # 65+: the low-risk line moves to 2.0
    (1.6, 70, "optimal"), (1.99, 70, "optimal"), (2.01, 70, "suboptimal"),
    (2.8, 70, "high"),
])
def test_fib4_flag_thresholds(target, age, flag):
    r = _risk(_fib4_labs(target, age), {"age": age})["FIB-4"]
    assert r["flag"] == flag
    if age >= 65:
        assert "2.0" in r["fm_interpretation"]


def test_fib4_notes_young_age_and_age_band():
    r = _risk(_fib4_labs(0.5, 30), {"age": 30, "age_source": "age_band"})["FIB-4"]
    assert "under 35" in r["fm_interpretation"]
    assert "age band" in r["fm_interpretation"]


# ── missing inputs ───────────────────────────────────────────────────────────

def test_no_context_only_lab_only_index():
    out = _risk(_labs(**COACH_LABS))
    assert set(out) == {"TyG index"}


def test_full_context_gives_all_seven():
    out = _risk(_labs(**COACH_LABS), COACH_CTX)
    assert set(out) == NAMES
    assert all(r["computed"] for r in out.values())


def test_missing_labs_skip_silently():
    assert _risk(_labs(glucose=95), COACH_CTX) == {}
    assert _risk([], COACH_CTX) == {}
    out = _risk(_labs(tg=54, glucose=93.75), COACH_CTX)  # no ALT/AST/GGT/platelets
    assert set(out) == {"TyG index", "TyG-BMI", "TyG-WC", "Lipid accumulation product (LAP)"}


# ── catalogue + passthrough ──────────────────────────────────────────────────

def test_catalogue_has_an_entry_per_index():
    lab_ratios._LAB_TEST_INDEX = None
    idx = _lab_test_index()
    slugs = {lt["slug"] for lt in idx.values()}
    for slug in ("tyg-index", "tyg-bmi", "tyg-wc", "hepatic-steatosis-index",
                 "fatty-liver-index", "lipid-accumulation-product", "fib-4"):
        assert slug in slugs
    for name in NAMES:  # every coded display name resolves to its entry
        assert _norm_marker(name) in idx, name


def test_lab_printed_fib4_not_duplicated_when_computed():
    labs = _labs(alt=46.5, ast=26.7, plt=344) + [_lab("FIB-4 score", 0.6)]
    out = compute_ratios(labs, {"age": 51})
    assert [r["marker_name"] for r in out].count("FIB-4") == 1
    # ...but a printed score still gets catalogue reading when it can't be computed.
    out = {r["marker_name"]: r for r in compute_ratios([_lab("FIB-4 score", 0.9)])}
    assert out["FIB-4"]["panel"] == "Additional Markers"


# ── client context ───────────────────────────────────────────────────────────

TODAY = date(2026, 11, 17)


def test_context_age_sex_bmi_from_dob():
    ctx = lab_client_context({"date_of_birth": "1975-12-01", "sex": "F",
                              "measurements": {"height_cm": 160, "weight_kg": 64}},
                             today=TODAY)
    assert ctx["age"] == 50 and ctx["age_source"] == "dob"
    assert ctx["sex"] == "F"
    assert ctx["bmi"] == 25.0


def test_context_age_band_midpoint():
    ctx = lab_client_context({"age_band": "45-50", "sex": "M"}, today=TODAY)
    assert ctx["age"] == 47 and ctx["age_source"] == "age_band"


def test_context_latest_dated_value_wins_across_the_three_stores():
    c = {
        "sex": "F",
        "measurements": {"height_cm": 160, "weight_kg": 70, "waist_cm": 95,
                         "measured_on": "2026-01-01"},
        "health_snapshots": [
            {"date": "2026-06-01", "measurements": {"weight_kg": 68}},
            {"date": "2026-09-01", "measurements": {"weight_kg": 66, "waist_cm": 88}},
        ],
        "measurements_log": [
            {"date": "2026-09-01", "weight_kg": 65.5},  # same date: coach log wins
            {"date": "2026-03-01", "waist_cm": 90},
        ],
    }
    ctx = lab_client_context(c, today=TODAY)
    assert ctx["weight_kg"] == 65.5 and ctx["weight_date"] == "2026-09-01"
    assert ctx["waist_cm"] == 88 and ctx["waist_date"] == "2026-09-01"
    assert ctx["height_cm"] == 160
    assert ctx["bmi"] == round(65.5 / 1.6 ** 2, 1)


def test_context_undated_fallbacks_and_bounds():
    # undated flat block, then the v2.3 top-level intake fields (imperial too)
    ctx = lab_client_context({"sex": "F", "measurements": {"weight_kg": 60},
                              "height_ft": 5, "height_in": 4, "waist_in": 32},
                             today=TODAY)
    assert ctx["weight_kg"] == 60 and ctx["weight_date"] is None
    assert math.isclose(ctx["height_cm"], 162.56, abs_tol=0.01)
    assert math.isclose(ctx["waist_cm"], 81.28, abs_tol=0.01)
    # an unconverted 36-inch "cm" waist is out of bounds, so no waist at all
    ctx = lab_client_context({"sex": "F", "measurements": {"waist_cm": 36}}, today=TODAY)
    assert ctx["waist_cm"] is None


def test_context_diabetes_reads_firm_active_conditions_only():
    def dm(conds):
        return lab_client_context({"sex": "F", "active_conditions": conds}, today=TODAY)["diabetes"]
    assert dm(["Type 2 diabetes — on metformin"]) is True
    assert dm(["T2DM"]) is True
    assert dm(["prediabetes"]) is False
    assert dm(["suspected diabetes"]) is False
    assert dm(["hypothyroidism"]) is False


def test_context_from_pydantic_client():
    from fmdb.plan.models import Client
    c = Client(client_id="cl-999", intake_date="2026-01-01", sex="F",
               created_at="2026-01-01T00:00:00", updated_at="2026-01-01T00:00:00",
               updated_by="test",
               date_of_birth="1975-06-01", active_conditions=["type 2 diabetes"],
               measurements={"height_cm": 160, "weight_kg": 64, "waist_cm": 82,
                             "measured_on": "2026-10-01"})
    ctx = lab_client_context(c, today=TODAY)
    assert ctx["age"] == 51 and ctx["bmi"] == 25.0 and ctx["waist_cm"] == 82
    assert ctx["diabetes"] is True


def test_context_empty_record_is_all_none():
    ctx = lab_client_context({}, today=TODAY)
    assert ctx["age"] is None and ctx["bmi"] is None and ctx["waist_cm"] is None
    assert ctx["diabetes"] is False
    assert _risk(_labs(**COACH_LABS), ctx).keys() == {"TyG index"}
