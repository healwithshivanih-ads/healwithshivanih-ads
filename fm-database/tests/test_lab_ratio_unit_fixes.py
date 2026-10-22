"""Five coach-page lab markers that were wrong for cl-906 (21 Oct 2026 panel).

1. H. pylori IgG 18 EIU (cutoff 30, NEGATIVE) read as "Positive — active
   infection" because every H. pylori name went through the stool-antigen
   branch and its 1.1 index cutoff.
2. AIP was log10 of the mg/dL quotient — 0.63 instead of the molar 0.27.
3. FT3/FT4 was divided in pg/mL ÷ ng/dL — 3.24 read as "hyperthyroid" for a
   client with TSH 12.7.
4/5. Serum calcium and morning cortisol resolved to two placeholder catalogue
   entries (24-hr urinary calcium, 4-point salivary cortisol) whose full_name
   claimed the serum test.

Run: .venv/bin/python -m pytest tests/test_lab_ratio_unit_fixes.py  (from fm-database/)
"""

import math

from fmdb.assess import lab_ratios
from fmdb.assess.lab_ratios import _lab_test_index, _norm_marker, compute_ratios

D = "2026-10-21"


def _lab(name, value, unit="", rng=""):
    return {"test_name": name, "value": str(value), "unit": unit,
            "reference_range": rng, "date_drawn": D}


def _by_name(results):
    return {r["marker_name"]: r for r in results}


def test_h_pylori_negative_igg_is_not_read_as_active_infection():
    out = _by_name(compute_ratios([_lab("H. pylori IgG antibody", 18.0, "EIU", "<30 non-reactive")]))
    assert "H. pylori (stool antigen)" not in out
    ab = out["H. pylori antibody (blood)"]
    assert ab["flag"] == "optimal"
    assert "Non-reactive" in ab["fm_interpretation"]


def test_h_pylori_positive_igg_says_exposure_not_active_infection():
    out = _by_name(compute_ratios([_lab("Helicobacter pylori IgG", 42.0, "EIU", "<30 non-reactive")]))
    ab = out["H. pylori antibody (blood)"]
    assert ab["flag"] == "high"
    assert "stool antigen or breath test" in ab["fm_interpretation"]


def test_h_pylori_stool_antigen_still_uses_its_own_cutoff():
    out = _by_name(compute_ratios([_lab("H. pylori stool antigen", 1.4, "index")]))
    assert out["H. pylori (stool antigen)"]["flag"] == "high"
    assert "H. pylori antibody (blood)" not in out


def test_aip_uses_molar_concentrations_for_mg_dl_values():
    out = _by_name(compute_ratios([_lab("Triglycerides", 199, "mg/dL"), _lab("HDL Cholesterol", 47.1, "mg/dL")]))
    aip = out["Atherogenic Index of Plasma (AIP)"]["value"]
    assert math.isclose(aip, math.log10((199 / 88.57) / (47.1 / 38.67)), abs_tol=0.002)
    assert 0.25 < aip < 0.29  # not the 0.63 the mg/dL quotient gave


def test_aip_mmol_values_are_used_as_is():
    out = _by_name(compute_ratios([_lab("Triglycerides", 1.5, "mmol/L"), _lab("HDL Cholesterol", 1.2, "mmol/L")]))
    assert math.isclose(out["Atherogenic Index of Plasma (AIP)"]["value"], math.log10(1.5 / 1.2), abs_tol=0.002)


def test_ft3_ft4_ratio_converts_conventional_units():
    labs = [_lab("TSH", 12.7, "µIU/mL"), _lab("Free T3", 2.64, "pg/mL"), _lab("Free T4", 0.814, "ng/dL")]
    conv = _by_name(compute_ratios(labs))["T3/T4 conversion ratio"]
    assert math.isclose(conv["value"], (2.64 * 1.536) / (0.814 * 12.87), abs_tol=0.003)
    assert "hyperthyroid" not in conv["fm_interpretation"].lower()
    assert "output" in conv["fm_interpretation"]


def test_ft3_ft4_ratio_in_pmol_is_unchanged():
    labs = [_lab("Free T3", 4.8, "pmol/L"), _lab("Free T4", 16.0, "pmol/L")]
    conv = _by_name(compute_ratios(labs))["T3/T4 conversion ratio"]
    assert math.isclose(conv["value"], 0.3, abs_tol=0.001)
    assert conv["flag"] == "optimal"


def test_serum_calcium_and_morning_cortisol_resolve_to_the_serum_entries():
    lab_ratios._LAB_TEST_INDEX = None  # rebuild from the corrected catalogue
    idx = _lab_test_index()
    assert idx[_norm_marker("Calcium, Serum")]["slug"] == "calcium-serum"
    assert idx[_norm_marker("Cortisol 8am")]["slug"] == "am-cortisol"
    assert idx[_norm_marker("Cortisol")]["slug"] == "am-cortisol"
