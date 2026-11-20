"""The body age report: result levels, the next step it offers, the drawings, and the approved wording.

The test profile is cl-900 (the app's test account), 4 Jul 2026 draw. `approved_*.txt` is the visible text of the
standard and deeper reports as Shivani approved them (see ALLOWED below); the generator must reproduce it exactly.
"""
from __future__ import annotations

import difflib
import html
import importlib.util
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
FIX = Path(__file__).parent / "fixtures" / "body_age"
WEB = ROOT.parent / "fm-database-web"
sys.path.insert(0, str(ROOT))

from fmdb.plan.lifecycle import IN_CARE, resolve_lifecycle  # noqa: E402
from fmdb.plan.models import Client  # noqa: E402
from fmdb.report import mail, viz  # noqa: E402
from fmdb.report.build import ReportError, make_report  # noqa: E402
from fmdb.report.decide import CREDIT_DAYS, FOUNDATION_AFTER_INR, credit_deadline, decide, next_test_date  # noqa: E402
from fmdb.report.levels import CHECKUP, DOCTOR, cutoffs_approved, doctor_wording, level_for, load_cutoffs  # noqa: E402
from fmdb.report.page import report_html  # noqa: E402
from fmdb.report.panel import num  # noqa: E402

FX = yaml.safe_load((FIX / "test_profile.yaml").read_text())

# a profile with nothing off: the test profile with its flagged results brought into range
STEADY = {"TSH (Ultrasensitive)": 2.1, "Homocysteine": 9.0, "hsCRP": 0.6, "HbA1c": 5.3, "Cholesterol - Total": 170,
          "Cholesterol - LDL": 90, "Cholesterol - VLDL": 18, "Triglycerides": 95, "Non-HDL Cholesterol": 112,
          "Lipoprotein (a) [Lp(a)]": 12, "Apolipoprotein A1 (ApoA1)": 142, "Apolipoprotein B (ApoB)": 82, "Vitamin B12": 520}


def labs(over=None, metals=False):
    over = over or {}
    rows = FX["lab_values"] + (FX["illustrative_metals"] if metals else [])
    return [dict(l, value=str(over.get(l["test_name"], l["value"]))) for l in rows]


def report(kind="standard", over=None, **kw):
    kw.setdefault("sample_date", FX["sample_date"])
    kw.setdefault("report_date", FX["report_date"])
    return make_report(FX["person"], labs(over, metals=kind == "deeper"), kind=kind, sample=True, **kw)


def text(h: str) -> str:
    h = re.sub(r"<(svg|style).*?</\1>", " ", h, flags=re.S)
    h = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", html.unescape(h)).strip()


# ── result levels ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("key,value,kw,want", [
    # the results Shivani has already seen printed in the approved samples
    ("tsh", 8.31, dict(lo=0.40, hi=4.40), "C"),
    ("hcy", 22.07, dict(lo=3.7, hi=15.0), "B"),
    ("apob", 143.2, {}, "B"), ("ldl", 142.6, {}, "B"), ("non_hdl", 174.7, dict(hi=160), "B"),
    ("hba1c", 5.8, {}, "A"),
    # the nine test buyers
    ("hba1c", 6.2, {}, "B"), ("tg", 240, {}, "B"), ("lpa", 96, {}, "C"), ("hscrp", 6.8, {}, "B"), ("apob", 151, {}, "B"),
    ("tsh", 4.9, dict(lo=0.4, hi=4.4), "A"),
    # each band's edges
    ("hba1c", 5.6, {}, ""), ("hba1c", 6.5, {}, "C"), ("hba1c", 10.0, {}, "D"),
    ("hscrp", 3.0, {}, "A"), ("hscrp", 3.1, {}, "B"), ("hscrp", 10, {}, "C"),
    ("tsh", 0.35, dict(lo=0.4, hi=4.4), "A"), ("tsh", 0.2, dict(lo=0.4, hi=4.4), "B"), ("tsh", 0.05, dict(lo=0.4, hi=4.4), "C"),
    ("tsh", 4.45, dict(lo=0.4, hi=4.4), "A"),          # outside the lab's range, short of every listed line
    ("potassium", 5.6, dict(lo=3.5, hi=5.5), "C"), ("potassium", 6.0, dict(lo=3.5, hi=5.5), "D"), ("potassium", 3.2, dict(lo=3.5, hi=5.5), "B"),
    ("sodium", 155, dict(lo=135, hi=145), "C"), ("sodium", 156, dict(lo=135, hi=145), "D"),
    ("glucose", 55, dict(lo=70, hi=110), "C"), ("glucose", 300, dict(lo=70, hi=110), "D"),
    # the lines corrected after the five-reviewer check (each was a result the first table handled wrongly)
    ("glucose", 260, dict(lo=70, hi=100), "D"), ("glucose", 240, dict(lo=70, hi=100), "C"),
    ("potassium", 5.2, dict(lo=3.5, hi=5.5), "A"),      # inside the range printed beside it: never past A
    ("potassium", 5.2, dict(lo=3.5, hi=5.1), "B"),      # outside a tighter laboratory range: the listed line applies
    ("creatinine", 1.7, dict(lo=0.6, hi=1.2), "C"),
    ("calcium", 7.2, dict(lo=8.6, hi=10.2), "D"), ("calcium", 7.8, dict(lo=8.6, hi=10.2), "C"),
    ("bilirubin", 6.0, dict(lo=0.3, hi=1.2), "D"), ("bilirubin", 4.0, dict(lo=0.3, hi=1.2), "C"),
    ("albumin", 2.0, dict(lo=3.5, hi=5.5), "C"), ("albumin", 3.1, dict(lo=3.5, hi=5.5), "B"), ("albumin", 3.4, dict(lo=3.5, hi=5.5), "A"),
    ("lpa_nmol", 110, dict(hi=75), "A"), ("lpa_nmol", 130, dict(hi=75), "B"), ("lpa_nmol", 210, dict(hi=75), "C"),
    # multiples of the laboratory's limit, and per cent above it
    ("alt", 50, dict(hi=40), "A"), ("alt", 70, dict(hi=40), "B"), ("alt", 130, dict(hi=40), "C"), ("alt", 410, dict(hi=40), "D"),
    ("creatinine", 1.25, dict(lo=0.6, hi=1.2), "A"), ("creatinine", 1.4, dict(lo=0.6, hi=1.2), "B"), ("creatinine", 2.4, dict(lo=0.6, hi=1.2), "D"),
    ("fib4", 2.0, {}, "A"), ("fib4", 2.7, {}, "C"),
    # a marker with no row: per cent beyond its range
    ("urea", 58, dict(lo=18, hi=55), "A"), ("urea", 66, dict(lo=18, hi=55), "B"), ("urea", 90, dict(lo=18, hi=55), "C"),
    ("urea", 40, dict(lo=18, hi=55), ""),
    # never a doctor line on their own
    ("insulin", 80, dict(hi=25), "A"), ("apoa1", 60, dict(lo=120, hi=190), "A"), ("b12", 1475, dict(lo=120, hi=911), "A"),
])
def test_levels(key, value, kw, want):
    assert level_for(key, value, **kw) == want


def test_levels_are_sex_aware():
    assert level_for("hb", 12.2, sex="F") == "A" and level_for("hb", 12.2, sex="M") == "C"   # any anaemia in a man: doctor
    assert level_for("hb", 13.2, sex="M") == "A"
    assert level_for("hb", 19.0, lo=13, hi=17, sex="M") == "C" and level_for("hb", 17.8, lo=13, hi=17, sex="M") == "B"
    assert level_for("hb", 17.2, lo=13, hi=17, sex="M") == "A" and level_for("hb", 16.8, lo=13, hi=17, sex="M") == ""
    assert level_for("hb", 16.0, lo=12, hi=15, sex="F") == "B" and level_for("hb", 16.8, lo=12, hi=15, sex="F") == "C"
    assert level_for("hb", 10.5, sex="F") == "C" and level_for("hb", 7.5, sex="M") == "D"
    assert level_for("hdl", 42, sex="M") == "" and level_for("hdl", 42, sex="F") == "B"
    assert level_for("hdl", 37, sex="M") == "A"


def test_a_womans_low_haemoglobin_keeps_the_check_up_step_a_mans_goes_to_the_doctor():
    def low_hb(sex):
        rp = make_report(dict(FX["person"], sex=sex), labs(dict(STEADY, Haemoglobin=11.5)), kind="standard", sample=True,
                         sample_date=FX["sample_date"], report_date=FX["report_date"])
        return rp.rows["hb"].level, text(report_html(rp))
    lv_f, t_f = low_hb("F")
    lv_m, t_m = low_hb("M")
    assert lv_f == "B" and CHECKUP in t_f and DOCTOR not in t_f
    assert lv_m == "C" and DOCTOR in t_m


def test_what_each_level_prints():
    assert doctor_wording("A") == "" and doctor_wording("B") == CHECKUP and doctor_wording("C") == DOCTOR
    assert "doctor" not in CHECKUP


def test_every_cutoff_lives_in_the_one_file_and_the_table_is_approved():
    c = load_cutoffs()
    assert set(c) >= {"status", "fallback_pct", "fallback_plus", "cap_at_A", "inside_range_max_A", "markers"}
    # Shivani approved the first table on 19 Nov 2026 and the eight corrected lines the same day ("yes for the 8").
    # A change to the numbers goes back to "provisional" until she says yes again.
    assert c["status"] == "approved" and cutoffs_approved() is True


def test_lpa_is_read_on_the_lines_for_the_unit_the_laboratory_used():
    def lpa(value, unit):
        rows = [dict(l, value=str(value), unit=unit) if "Lp(a)" in l["test_name"] else l for l in labs()]
        rp = make_report(FX["person"], rows, kind="standard", sample=True, sample_date=FX["sample_date"], report_date=FX["report_date"])
        return rp.rows["lpa"].level, rp.warnings
    assert lpa(110, "mg/dL")[0] == "C" and lpa(110, "nmol/L")[0] == "A" and lpa(210, "nmol/L")[0] == "C"
    lv, warns = lpa(110, "U/L")
    assert lv == "C" and any("Lp(a)" in w and "unit" in w for w in warns)       # read as mg/dL, and the coach is told


# ── the three additions Shivani approved on 20 Nov 2026 ("Yes, add all three") ──
@pytest.mark.parametrize("key,value,kw,want", [
    # packed cell volume: check-up above 52 men / 48 women, doctor above 55, strongest above 60 / 56
    ("hct", 51, dict(lo=40, hi=50, sex="M"), "A"), ("hct", 52, dict(lo=40, hi=50, sex="M"), "A"),
    ("hct", 52.5, dict(lo=40, hi=50, sex="M"), "B"), ("hct", 55, dict(lo=40, hi=50, sex="M"), "B"),
    ("hct", 55.5, dict(lo=40, hi=50, sex="M"), "C"), ("hct", 60, dict(lo=40, hi=50, sex="M"), "C"),
    ("hct", 60.5, dict(lo=40, hi=50, sex="M"), "D"),
    ("hct", 47, dict(lo=36, hi=46, sex="F"), "A"), ("hct", 48.5, dict(lo=36, hi=46, sex="F"), "B"),
    ("hct", 55.5, dict(lo=36, hi=46, sex="F"), "C"), ("hct", 56.5, dict(lo=36, hi=46, sex="F"), "D"),
    ("hct", 45, dict(lo=40, hi=50, sex="M"), ""),
    ("hct", 33, dict(lo=40, hi=50, sex="M"), "B"),                 # the low side keeps the per-cent rule
    ("hct", 53, dict(lo=40, hi=50), "A"),                          # sex not on file: the per-cent rule only
    # the three strongest-level lines from the pathologists' list
    ("platelets", 1000, dict(lo=150, hi=450), "C"), ("platelets", 1001, dict(lo=150, hi=450), "D"),
    ("phosphorus", 1.0, dict(lo=2.5, hi=5.0, unit="mg/dL"), "C"), ("phosphorus", 0.9, dict(lo=2.5, hi=5.0, unit="mg/dL"), "D"),
    ("phosphorus", 2.3, dict(lo=2.5, hi=5.0, unit="mg/dL"), "A"),
    ("phosphorus", 0.7, dict(lo=0.8, hi=1.5, unit="mmol/L"), "A"),  # another unit: the mg/dL line is not applied
    ("phosphorus", 0.9, dict(lo=2.5, hi=5.0), "C"),                # no unit on file: not applied either
    ("urea", 179, dict(lo=18, hi=55, unit="mg/dL"), "C"), ("urea", 180, dict(lo=18, hi=55, unit="mg/dL"), "D"),
    ("urea", 60, dict(lo=18, hi=55, unit="mg/dL"), "A"),
    ("bun", 83, dict(lo=8, hi=20, unit="mg/dL"), "C"), ("bun", 84, dict(lo=8, hi=20, unit="mg/dL"), "D"),
    ("urea", 31, dict(lo=2.5, hi=7.8, unit="mmol/L"), "C"),        # mmol/L: the per-cent rule only
    # kidney filtering: doctor sentence below 60, nothing for 60 and over
    ("egfr", 95, dict(lo=60), ""), ("egfr", 60, dict(lo=60), ""), ("egfr", 59, dict(lo=60), "C"), ("egfr", 20, dict(lo=60), "C"),
])
def test_the_lines_added_on_20_nov(key, value, kw, want):
    assert level_for(key, value, **kw) == want


def _with_egfr(value, label="EST. GLOMERULAR FILTRATION RATE (eGFR)", kind="standard", first=False):
    row = dict(test_name=label, value=str(value), unit="mL/min/1.73 m2", reference_range=">= 90")
    rows = labs(STEADY, metals=kind == "deeper")
    rows = [row] + rows if first else rows + [row]
    return make_report(FX["person"], rows, kind=kind, sample=True, sample_date=FX["sample_date"], report_date=FX["report_date"])


@pytest.mark.parametrize("value", [112, 75, 60])
def test_a_kidney_filtering_figure_of_60_or_over_prints_and_says_nothing(value):
    rp = _with_egfr(value)
    r = rp.rows["egfr"]
    assert (r.level, r.state, r.kind, r.a, r.rtxt) == ("", "ok", "min", 60, "60 or over")     # not the laboratory's stages
    assert rp.decision.outcome == "nothing" and not rp.missing and not rp.warnings
    assert "Kidney filtering (eGFR)" in text(report_html(rp))


def test_a_kidney_filtering_figure_below_60_gets_the_doctor_sentence_and_its_own_words():
    rp = _with_egfr(52)
    page = text(report_html(rp))
    assert rp.rows["egfr"].level == "C" and not rp.missing and not [d for d in rp.drafts if "egfr" in d]
    assert "Your kidney filtering figure appears to be below 60" in page and "needs a doctor's attention. Please speak to your doctor." in page
    assert SOON not in page and rp.decision.outcome == "foundation"


def test_the_creatinine_row_never_reads_the_filtering_figure():
    rp = _with_egfr(52, label="eGFR (creatinine based, CKD-EPI)", first=True)
    assert rp.rows["egfr"].value == 52 and rp.rows["creatinine"].value == report(over=STEADY).rows["creatinine"].value


def test_a_strongest_level_phosphorus_prints_and_another_unit_is_flagged_not_guessed():
    rp, out, _ = outcome({"Phosphorus": 0.9}, kind="deeper")
    assert rp.rows["phosphorus"].level == "D" and out == "doctor_soon" and not rp.missing
    assert SOON in text(report_html(rp)) and not [d for d in rp.drafts if "phosphorus" in d]
    rows = [dict(l, value="1.1", unit="mmol/L", reference_range="0.8-1.5") if l["test_name"] == "Phosphorus" else l
            for l in labs(STEADY, metals=True)]
    rp = make_report(FX["person"], rows, kind="deeper", sample=True, sample_date=FX["sample_date"], report_date=FX["report_date"])
    assert rp.rows["phosphorus"].level == "" and any("Phosphorus" in w and "unit" in w for w in rp.warnings)


def test_high_red_cells_and_high_platelets_have_their_own_words():
    rp, _, _ = outcome({"Hematocrit (PCV)": 53})
    page = text(report_html(rp))
    assert rp.rows["hct"].level == "B" and "Your red cells appear to be clearly above their range." in page and "iron and B12" not in page
    rp, _, _ = outcome({"Platelet Count": 700})
    page = text(report_html(rp))
    assert rp.rows["platelets"].level == "C" and "Your platelet count appears to be far above its range." in page and "falsely low" not in page


def _with_lead(value, unit, rng):
    rows = [dict(l, value=str(value), unit=unit, reference_range=rng) if l["test_name"] == "Lead" else l
            for l in labs(STEADY, metals=True)]
    return make_report(FX["person"], rows, kind="deeper", sample=True, sample_date=FX["sample_date"], report_date=FX["report_date"])


def test_lead_reported_per_litre_is_not_read_on_the_per_decilitre_lines():
    # Found on a real panel (20 Nov 2026): the laboratory prints lead in µg/L, ten times the µg/dL number. Read on
    # the µg/dL lines, an ordinary result got the doctor sentence while its own row was drawn in range.
    for unit in ("µg/L", "ug/L", "mcg/L", "μg/L"):
        rp = _with_lead(13.06, unit, "< 150")
        assert rp.rows["lead"].level == "" and not rp.warnings, unit
        assert rp.decision.outcome == "nothing"
    assert _with_lead(60, "µg/L", "< 150").rows["lead"].level == "B"            # 6 µg/dL
    assert _with_lead(120, "µg/L", "< 150").rows["lead"].level == "C"           # 12 µg/dL
    assert _with_lead(460, "µg/L", "< 150").rows["lead"].level == "D"           # 46 µg/dL
    assert _with_lead(12, "µg/dL", "0-5").rows["lead"].level == "C"             # unchanged on its own unit
    rp = _with_lead(12, "ppm", "0-5")
    assert rp.rows["lead"].level == "C" and any("Lead" in w and "unit" in w for w in rp.warnings)


def test_one_metal_is_spoken_of_in_the_singular():
    page = text(report_html(_with_lead(12, "µg/dL", "0-5")))
    assert "lead are" not in page.lower() and "lead is" in page.lower()


# ── found by running the deeper report on a real panel (20 Nov 2026) ─────────
def _plus(extra, over=None, kind="deeper", sex=None):
    person = dict(FX["person"], **({"sex": sex} if sex else {}))
    rows = labs(dict(STEADY, **(over or {})), metals=kind == "deeper") + extra
    return make_report(person, rows, kind=kind, sample=True, sample_date=FX["sample_date"], report_date=FX["report_date"])


def _lab(name, value, rng, unit="mg/dL"):
    return dict(test_name=name, value=str(value), unit=unit, reference_range=rng)


def test_hdl_inside_the_laboratorys_own_range_is_not_called_low():
    assert level_for("hdl", 49, lo=40, hi=60, sex="F") == ""          # the table's line is 50, the laboratory's range starts at 40
    assert level_for("hdl", 38, lo=40, hi=60, sex="F") == "B"         # below both
    assert level_for("hdl", 47, sex="F") == "A"                       # no range printed: the table's line stands


def test_a_measured_result_the_report_has_no_row_for_is_flagged_to_the_coach():
    rp = _plus([_lab("Prolactin", 40, "4-15", "ng/mL"), _lab("Total IgE", 198, "< 100", "IU/mL"), _lab("Lipase", 65.5, "5-60", "U/L"),
                _lab("DHEA-S", 200, "35-430", "ug/dL")])
    warned = " | ".join(rp.warnings)
    assert "Prolactin" in warned and "DHEA" not in warned
    assert "Total IgE" not in warned and "Lipase" not in warned         # both have rows since 20 Nov 2026
    assert report("deeper").warnings == []                            # the test profile has none


def test_ferritin_folate_and_magnesium_have_rows_in_the_deeper_report():
    rp = _plus([_lab("Ferritin", 60, "20-250", "ng/mL"), _lab("Folate", 9, "4-20", "ng/mL"), _lab("Magnesium", 2.0, "1.7-2.4")])
    assert {"ferritin", "folate", "magnesium"} <= set(rp.rows) and all(not rp.rows[k].level for k in ("ferritin", "folate", "magnesium"))
    assert "ferritin" not in _plus([_lab("Ferritin", 60, "20-250", "ng/mL")], kind="standard").rows
    rp = _plus([_lab("Ferritin", 12, "20-250", "ng/mL")])
    page = text(report_html(rp))
    assert rp.rows["ferritin"].level and "iron stores" in page.lower() and not rp.missing


def test_low_iron_carriers_never_say_the_stores_are_unmeasured_when_ferritin_is_there():
    low = {"Transferrin Saturation": 10} if any(l["test_name"] == "Transferrin Saturation" for l in FX["lab_values"]) else None
    if low is None:
        pytest.skip("the profile has no transferrin saturation")
    without = text(report_html(_plus([], low)))
    with_ = text(report_html(_plus([_lab("Ferritin", 60, "20-250", "ng/mL")], low)))
    assert "does not measure iron stores" in without and "does not measure iron stores" not in with_
    assert "Your ferritin, shown beside it" in with_


def test_rows_read_the_real_panels_spellings_and_never_a_ratio_that_shares_the_name():
    def named(old, new, extra_first=()):
        rows = list(extra_first) + [dict(l, test_name=new) if l["test_name"] == old else l for l in labs(STEADY, metals=True)]
        return make_report(FX["person"], rows, kind="deeper", sample=True, sample_date=FX["sample_date"], report_date=FX["report_date"])
    base = report("deeper", STEADY).rows
    assert named("Bilirubin Total", "BILIRUBIN - TOTAL").rows["bilirubin"].value == base["bilirubin"].value
    assert named("Phosphorus", "PHOSPHOROUS").rows["phosphorus"].value == base["phosphorus"].value
    first = [_lab("SGOT / SGPT RATIO", 9.9, "< 2", ""), _lab("Mean Platelet Volume (MPV)", 9.9, "6.5-12", "fL"),
             _lab("APO B / APO A1 RATIO (APO B/A1)", 9.9, "0.35-0.98", ""), _lab("RED CELL DISTRIBUTION WIDTH INDEX (RDWI)", 999, "< 220", "")]
    rp = named("Phosphorus", "Phosphorus", extra_first=first)
    for k in ("alt", "ast", "platelets", "apob", "apoa1", "rdw"):
        assert rp.rows[k].value == base[k].value, k


def test_chloride_has_its_own_words():
    rp, _, _ = outcome({"Chloride": 111})
    page = text(report_html(rp))
    assert "Your chloride sits just outside its range." in page and "Chloride travels with sodium" in page


def test_ldl_a_little_high_with_the_particle_count_in_range_is_not_called_artery_load():
    rp, _, _ = outcome({"Cholesterol - LDL": 112})
    ids = [h.finding.id for hs in rp.hits.values() for h in hs]
    page = text(report_html(rp))
    if rp.rows.get("apob") is not None and not rp.rows["apob"].level:
        assert "ldl_only" in ids and "lipids" not in ids
        assert "particle count is in range" in page and "artery load" not in page.lower() and "heavier load" not in page
    rp, _, _ = outcome({"Cholesterol - LDL": 135})                    # clearly off: the approved wording stands
    assert "lipids" in [h.finding.id for hs in rp.hits.values() for h in hs]


def test_lpa_is_never_told_that_blood_cannot_say_why():
    rp, _, _ = outcome({"Lipoprotein (a) [Lp(a)]": 95})
    page = text(report_html(rp))
    assert rp.rows["lpa"].level == "C" and "blood alone cannot say why" not in page and "It is inherited" in page
    rp, _, _ = outcome({"Lipoprotein (a) [Lp(a)]": 95, "Homocysteine": 35})
    step = next(t["text"] for t in rp.todo if "blood alone cannot say why" in t["text"])
    assert "homocysteine" in step.lower() and "lp(a)</a>. " not in step.lower().split("blood alone")[0][-40:]


# ── the test profile reads as the approved samples do ────────────────────────
def test_profile_statuses_and_decision():
    rp = report("deeper")
    assert {s.id: s.status for s in rp.sections} == {
        "heart": "needs attention", "sugar": "watch", "liver": "steady", "thyroid": "needs a deeper look",
        "kidneys": "steady", "blood": "steady", "nutrients": "watch", "metals": "steady"}
    d = rp.decision
    assert d.outcome == "foundation" and d.segment is None and d.soon == []
    assert d.deep_rows == ["tsh", "hcy"] and d.testimonials == ["thyroid", "sugar"]
    assert {"tsh:C", "hcy:B", "lipids:B", "sugar:A", "pattern:hcy_b12", "b12_high", "body_age:younger"} <= set(d.tags)
    assert rp.drafts == [] and rp.missing == [] and rp.warnings == []


def test_body_age_is_scored_at_the_age_on_the_sample_date():
    rp = report()                                       # born 30 Jul 1973, sample 4 Jul 2026: still 52
    assert (rp.age, rp.body_age) == (52, 41.9)
    later = report(sample_date="2026-08-01", report_date="2026-08-03")
    assert later.age == 53 and later.body_age > rp.body_age
    assert rp.next_test == date(2026, 11, 4) and rp.deadline == date(2026, 7, 21)


def test_a_record_without_a_birth_date_or_sex_is_refused():
    for drop in ("date_of_birth", "sex"):
        person = {k: v for k, v in FX["person"].items() if k != drop}
        with pytest.raises(ReportError):
            make_report(person, labs(), kind="standard", sample_date=FX["sample_date"], report_date=FX["report_date"])


# The reference text is the approved wording as it stands after Shivani's changes of 19 Nov 2026 (no "read by",
# every session online, and the eleven changes she made after the five-reviewer check). It was written from the
# generator once each difference from the earlier approved text had been read against her decisions, so from here
# on the generator must reproduce it exactly: a wording change needs her yes and a new reference.
ALLOWED: set = set()


@pytest.mark.parametrize("kind,ref,no", [("standard", "approved_standard.txt", "SR-SAMPLE-01"), ("deeper", "approved_deeper.txt", "SRP-SAMPLE-01")])
def test_the_report_reproduces_the_approved_text(kind, ref, no):
    a = (FIX / ref).read_text().split()
    b = text(report_html(report(kind, report_no=no, book_url="https://example.test/foundation/t"))).split()
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    diffs = {(" ".join(a[i1:i2]), " ".join(b[j1:j2])) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal"}
    assert diffs <= ALLOWED, sorted(diffs - ALLOWED)


# "ring" may only mean the tree's rings (the drawing and its one sentence), never the product or a test
BRAND = "Sequoya by Shivani Hari"       # her wording, 19 Nov 2026; embargoed until 2 Jan 2027, 20:00 IST
FORBIDDEN = re.compile(r"sequoya|rings\+|rings? report|\b(?:your|next|first|each|every|three|this) rings?\b|thyrocare|85,000|"
                       r"twelve.week|programme|12.week|results call|"
                       # every session is online (her rule, 19 Nov 2026): nothing may suggest meeting in person
                       r"\bwe meet\b|\bin the room\b|\bsee you\b|\bin person\b|\bsit down together\b", re.I)


@pytest.mark.parametrize("kind", ["standard", "deeper"])
@pytest.mark.parametrize("over", [None, STEADY])
def test_nothing_a_buyer_reads_names_the_product_the_lab_or_the_programme(kind, over):
    rp = report(kind, over)
    page = text(report_html(rp))
    # the brand name appears in exactly two places on the page ("from" and "Prepared by"), always as this phrase
    assert page.count("Sequoya") == 2 == page.count(BRAND)
    for h in (page.replace(BRAND, ""), mail.email_html(rp), mail.attachment_name(rp), mail.SUBJECT):
        t = text(h)
        assert not FORBIDDEN.search(t), FORBIDDEN.search(t).group(0)
    assert "read by" not in page.lower() and "reviewed by" not in page.lower()


def test_email_carries_the_approved_short_version():
    rp = report(book_url="https://example.test/foundation/t")
    t = text(mail.email_html(rp))
    assert "Your body age is about 42 . You are 52." in t
    assert "Most people need two to four further tests, usually ₹1,000 to ₹5,000 in all" in t      # no surprise later
    assert "A Foundation session, online: ₹12,000 ₹7,000 (42% off)." in t      # the full price is crossed out (Shivani, 20 Nov 2026)
    assert "fully adjusted against a Foundation session if you sign up by 21 July 2026" in t
    assert "online session by video call" in t
    assert "https://example.test/foundation/t" in mail.email_html(rp)
    assert 'src="cid:ring"' in mail.email_html(rp)
    assert mail.attachment_name(rp) == "Body age report, R., 4 July 2026.pdf"


# ── the next step, the longevity flag and the tags ───────────────────────────
def outcome(over, kind="standard"):
    rp = report(kind, dict(STEADY, **over))
    return rp, rp.decision.outcome, rp.decision.segment


def test_a_steady_report_offers_nothing_and_files_a_longevity_customer():
    rp, out, seg = outcome({})
    assert (out, seg) == ("nothing", "longevity_customer") and "steady" in rp.decision.tags
    assert all(s.status == "steady" for s in rp.sections)
    assert rp.next_test == date(2027, 7, 4)                      # about a year, not four months
    t = text(report_html(rp))
    assert "Foundation session" not in t and "₹" not in t        # a steady page quotes no price
    assert "Book your session" not in t


def test_one_or_two_small_things_are_the_buyers_own_to_work_on():
    rp, out, seg = outcome({"HbA1c": 5.8})
    assert (out, seg) == ("self", "longevity_customer") and "sugar:A" in rp.decision.tags
    assert "Foundation session" not in text(report_html(rp))
    assert outcome({"HbA1c": 5.8, "TSH (Ultrasensitive)": 4.9})[1] == "self"


def test_foundation_is_offered_for_a_clear_result_three_small_ones_or_an_older_body_age():
    assert outcome({"HbA1c": 6.2})[1] == "foundation"                                               # clearly raised
    assert outcome({"HbA1c": 5.8, "TSH (Ultrasensitive)": 4.9, "hsCRP": 2.0})[1] == "foundation"    # three in the middle zone
    rp = report(over=STEADY)
    assert decide(rp.sections, body_age=rp.age + 3.1, age=rp.age, deeper=False).outcome == "foundation"
    assert decide(rp.sections, body_age=rp.age + 3.0, age=rp.age, deeper=False).outcome == "nothing"


def test_an_inherited_doctor_only_result_gets_the_doctor_line_and_no_session_offer():
    rp, out, seg = outcome({"Lipoprotein (a) [Lp(a)]": 96})
    assert (out, seg) == ("doctor_only", None) and "lpa:C" in rp.decision.tags
    assert "price" not in rp.step and "doctor" in rp.step["headline"]
    mild, out_mild, _ = outcome({"Lipoprotein (a) [Lp(a)]": 60})          # clearly raised, not far out: the check-up line, still no offer
    assert out_mild == "doctor_only" and "routine check-up" in mild.step["headline"] and "doctor" not in mild.step["headline"]
    # with something of the buyer's own to work on as well, still no session: it is theirs to do
    assert outcome({"Lipoprotein (a) [Lp(a)]": 96, "HbA1c": 5.8})[1] == "self"


def test_foundation_price_and_deadline_follow_the_report_type_and_date():
    std, deep = report("standard"), report("deeper")
    assert (std.step["price"], deep.step["price"]) == (7000, 2000) == (FOUNDATION_AFTER_INR["standard"], FOUNDATION_AFTER_INR["deeper"])
    assert credit_deadline(date(2026, 7, 7)) == date(2026, 7, 21) and CREDIT_DAYS == 14
    assert std.step["credit"] == "The price of your body age report is fully adjusted against a Foundation session if you sign up by 21 July 2026."
    assert (std.step["pct_off"], deep.step["pct_off"]) == (42, 83) and std.step["fresh"] == "After 21 July 2026 the session is ₹12,000."
    assert "₹12,000 ₹2,000 83% off" in text(report_html(deep)) and "<s>₹12,000</s> ₹2,000 (83% off)" in deep.step["email_offer"]


def test_the_web_price_rule_and_the_report_print_the_same_figures():
    ts = (WEB / "src/lib/fmdb/foundation-orders.ts").read_text()
    m = re.search(r"FOUNDATION_AFTER_BODY_AGE_REPORT_INR[^=]*=\s*\{\s*standard:\s*(\d+),\s*deeper:\s*(\d+)\s*\}", ts)
    assert m and {"standard": int(m.group(1)), "deeper": int(m.group(2))} == FOUNDATION_AFTER_INR
    assert int(re.search(r"BODY_AGE_CREDIT_DAYS\s*=\s*(\d+)", ts).group(1)) == CREDIT_DAYS


# Shivani, 19 Nov 2026: nothing is called urgent (a buyer may panic) and nothing is held back. The strongest level
# prints the far-out message in slightly stronger words, puts the doctor first and offers no session.
SOON = "Please see your doctor in the next day or two"


@pytest.mark.parametrize("kind", ["standard", "deeper"])
@pytest.mark.parametrize("over", [{"Potassium": 6.2}, {"Fasting Glucose": 270}, {"Calcium": 7.2}, {"Bilirubin Total": 6.0},
                                  {"Haemoglobin": 7.5}, {"Potassium": 6.2, "TSH (Ultrasensitive)": 8.3, "HbA1c": 6.1},
                                  {"Platelet Count": 1100}, {"Blood Urea": 190}, {"BUN - Blood Urea Nitrogen": 90},
                                  {"Hematocrit (PCV)": 61}])                     # the lines added 20 Nov 2026
def test_the_strongest_level_prints_stronger_doctor_words_and_never_the_word_urgent(kind, over):
    rp, outcome_, seg = outcome(over, kind)
    assert outcome_ == "doctor_soon" and seg is None and rp.decision.soon and not rp.missing and rp.ready is True
    page = text(report_html(rp))
    mailed = text(mail.email_html(rp))
    for t in (page, mailed):
        assert SOON in t and not re.search(r"urgent|emergency|immediately|at once|phone", t, re.I)
    assert rp.todo[0]["tag"] == "See your doctor first" and "needs a doctor's attention soon" in rp.todo[0]["text"]
    step = page[page.rfind("Your next step"):page.rfind("Methods and references")]
    assert "needs a doctor's attention soon" in step or "need a doctor's attention soon" in step
    assert "₹" not in step and "session" not in step.lower()                  # the doctor first: no offer beside it
    assert not [d for d in rp.drafts if ".soon" in d]                           # approved by Shivani, 20 Nov 2026


def test_the_strongest_level_words_are_the_ones_shivani_approved():
    from fmdb.report.wording import APPROVED_DRAFTS, DRAFT
    approved = {
        "line.soon": "A result at this level needs a doctor's attention soon. Please see your doctor in the next day or two.",
        "line.soon.short": "Needs a doctor's attention soon.",
        "todo.soon": "{names} {is_are} at a level that needs a doctor's attention soon. Please see your doctor in the next day or two, "
                     "and take this report with you.",
        "step.soon.headline": "{count} here {needs} a doctor's attention soon: your {names}.",
        "step.soon.para": "Please see your doctor in the next day or two, and take this report with you. That comes before anything else here.",
    }
    assert set(approved) <= APPROVED_DRAFTS
    for key, words in approved.items():
        assert DRAFT[key][1] == words, key                                      # a changed word needs her yes again


def test_far_out_keeps_her_sentence_and_only_the_strongest_level_says_soon():
    rp, outcome_, _ = outcome({"Potassium": 5.8})
    page = text(report_html(rp))
    assert rp.rows["potassium"].level == "C" and outcome_ == "foundation"
    assert "needs a doctor's attention. Please speak to your doctor." in page and "soon" not in page.lower().replace("sooner", "")


def test_a_far_out_result_nobody_wrote_for_stops_the_report():
    rp, _, _ = outcome({"Phosphorus": 8.0}, kind="deeper")       # a HIGH phosphorus: the per-cent rule, and no block of its own
    assert rp.rows["phosphorus"].level == "C"
    assert rp.missing and any("Phosphorus" in m for m in rp.missing) and rp.ready is False


def test_draft_sentences_are_listed_so_she_can_see_them(monkeypatch):
    from fmdb.report import wording
    monkeypatch.setattr(wording, "APPROVED_DRAFTS", set())       # as if nothing had been approved yet: the mechanism itself
    rp, _, _ = outcome({})
    assert "steady.heart.head" in rp.drafts and "step.nothing.headline" in rp.drafts and rp.missing == []
    rp, _, _ = outcome({"HbA1c": 6.2})
    assert "finding.sugar.B" in rp.drafts
    assert report().drafts == []                                  # the approved samples' own findings carry no drafts


# every finding the library has wording for, at the levels the cut-off table gives it
SWEEP = [
    ("standard", {"hsCRP": 2.0}, "crp", "A"), ("standard", {"hsCRP": 6.8}, "crp", "B"), ("standard", {"hsCRP": 14}, "crp", "C"),
    ("standard", {"Homocysteine": 16}, "hcy", "A"), ("standard", {"Homocysteine": 22}, "hcy", "B"), ("standard", {"Homocysteine": 35}, "hcy", "C"),
    ("standard", {"Lipoprotein (a) [Lp(a)]": 40}, "lpa", "A"), ("standard", {"Lipoprotein (a) [Lp(a)]": 60}, "lpa", "B"),
    ("standard", {"Cholesterol - LDL": 112}, "ldl_only", "A"), ("standard", {"Cholesterol - LDL": 195}, "lipids", "C"),
    ("standard", {"Cholesterol - HDL": 33}, "hdl_low", "B"), ("standard", {"Triglycerides": 240}, "tg", "B"),
    ("standard", {"Triglycerides": 170}, "tg", "A"), ("standard", {"Triglycerides": 620}, "tg", "C"),
    ("standard", {"Fasting Glucose": 104}, "sugar", "A"), ("standard", {"HbA1c": 6.2}, "sugar", "B"), ("standard", {"HbA1c": 6.9}, "sugar", "C"),
    ("standard", {"Fasting Glucose": 55}, "glucose_low", "C"), ("standard", {"Uric Acid": 8.2}, "uric", "A"), ("standard", {"Uric Acid": 9.5}, "uric", "B"),
    ("standard", {"ALT (SGPT)": 50}, "enzymes", "A"), ("standard", {"ALT (SGPT)": 70}, "enzymes", "B"), ("standard", {"ALT (SGPT)": 130, "AST (SGOT)": 125}, "enzymes", "C"),
    ("standard", {"Bilirubin Total": 1.5}, "bilirubin", "A"), ("standard", {"Alkaline Phosphatase (ALP)": 150}, "alp", "A"),
    ("standard", {"TSH (Ultrasensitive)": 4.9}, "tsh_high", "A"), ("standard", {"TSH (Ultrasensitive)": 6.5}, "tsh_high", "B"),
    ("standard", {"TSH (Ultrasensitive)": 0.2}, "tsh_low", "B"), ("standard", {"TSH (Ultrasensitive)": 0.05}, "tsh_low", "C"),
    ("standard", {"Thyroxine (T4, Total)": 13.5}, "thyroid_hormones", "A"),
    ("standard", {"Creatinine": 1.25}, "kidney", "A"), ("standard", {"Creatinine": 1.4}, "kidney", "B"), ("standard", {"Creatinine": 1.7}, "kidney", "C"),
    ("standard", {"Potassium": 5.3}, "salts", "A"), ("standard", {"Potassium": 3.3}, "salts", "B"), ("standard", {"Sodium": 128}, "salts", "C"), ("standard", {"Chloride": 111}, "chloride", "A"),
    ("standard", {"Haemoglobin": 13.2}, "hb_low", "A"), ("standard", {"Haemoglobin": 12.5}, "hb_low", "C"), ("standard", {"Haemoglobin": 10.0}, "hb_low", "C"),
    ("standard", {"Haemoglobin": 17.3}, "hb_high", "A"), ("standard", {"Haemoglobin": 17.8}, "hb_high", "B"), ("standard", {"Haemoglobin": 19.0}, "hb_high", "C"),
    ("standard", {"Albumin": 3.4}, "albumin", "A"), ("standard", {"Albumin": 3.1}, "albumin", "B"), ("standard", {"Albumin": 2.8}, "albumin", "C"),
    ("standard", {"MCV": 78}, "red_cells", "A"), ("standard", {"Total Leucocyte Count (TLC)": 12500}, "white_cells", "B"),
    ("standard", {"Platelet Count": 120}, "platelets", "B"), ("standard", {"Blood Urea": 12}, "generic", "B"),
    ("deeper", {"Vitamin D (25-OH)": 24}, "vitd_low", "A"), ("deeper", {"Vitamin D (25-OH)": 15}, "vitd_low", "B"),
    ("deeper", {"Vitamin D (25-OH)": 9}, "vitd_low", "C"), ("deeper", {"Vitamin D (25-OH)": 120}, "vitd_high", "B"),
    ("deeper", {"Vitamin B12": 250}, "b12_low", "A"), ("deeper", {"Vitamin B12": 180}, "b12_low", "B"), ("deeper", {"Vitamin B12": 110}, "b12_low", "C"),
    ("deeper", {"Vitamin B12": 1400}, "b12_high", "A"),
    ("deeper", {"Transferrin Saturation": 12}, "iron_low", "B"), ("deeper", {"Transferrin Saturation": 65}, "iron_high", "C"),
    ("deeper", {"Lead": 7}, "metals", "B"), ("deeper", {"Mercury": 12, "Lead": 11}, "metals", "C"),
    # several at once: the buyers the design was tested on
    ("standard", {"HbA1c": 6.2, "Triglycerides": 240}, "sugar", "B"),
    ("standard", {"hsCRP": 6.8, "Apolipoprotein B (ApoB)": 148, "HbA1c": 6.0}, "lipids", "B"),
    ("deeper", {"Haemoglobin": 11.5, "Transferrin Saturation": 11, "Vitamin B12": 190}, "hb_low", "C"),
]


@pytest.mark.parametrize("kind,over,finding,level", SWEEP)
def test_every_finding_has_wording_and_the_doctor_line_only_where_it_is_earned(kind, over, finding, level):
    rp = report(kind, dict(STEADY, **over))
    found = {h.finding.id: h.level for hs in rp.hits.values() for h in hs}
    assert found.get(finding) == level, found
    assert rp.missing == [], rp.missing
    page, email = text(report_html(rp)).replace(BRAND, ""), text(mail.email_html(rp))
    for t in (page, email):
        assert not FORBIDDEN.search(t), FORBIDDEN.search(t).group(0)
        assert "[needs wording" not in t and "{" not in t and "}" not in t
    worst = max(found.values())
    assert ("doctor's attention" in page) == (worst >= "C"), f"doctor line vs worst level {worst}"
    if worst < "B":
        assert "routine check-up" not in page
    # nothing in a report tells the buyer to take a supplement or a medicine
    assert not re.search(r"\btake (?:a|an|your|some) (?:supplement|tablet|capsule|dose)|\d\s?(?:mg|mcg|IU)\b(?!/)", page)


# what five reviewers flagged in the draft wording on 19 Nov 2026 (body-age-review-findings.md), pinned
SOFT = re.compile(r"usually passing|usually means little|commonest reason|usually harmless|topping up|leave out any biotin", re.I)


@pytest.mark.parametrize("kind,over,finding,level", [c for c in SWEEP if c[3] == "C"])
def test_a_far_out_result_is_never_soft_pedalled(kind, over, finding, level):
    rp = report(kind, dict(STEADY, **over))
    sid = next(s.id for s in rp.sections if any(h.finding.id == finding for h in rp.hits[s.id]))
    lead = rp.hits[sid][0]
    head, means = rp.section_text[sid]
    block = " ".join([head] + [b for _a, b in means])
    assert not SOFT.search(block), SOFT.search(block).group(0)
    today = dict(means).get("Today", "")
    if finding not in ("hcy", "lipids", "vitd_low", "b12_low", "glucose_low", "sugar", "hb_low", "iron_high"):
        assert today != "Nothing you would feel.", "a far-out result can be felt: say what to watch for"
    if not lead.approved:                    # the doctor sentence leads; the approved blocks keep their approved order
        assert "doctor's attention" in dict(means)["What to do"].split(". ")[0]


def test_no_draft_gives_supplement_advice_or_false_comfort_above_just_outside():
    from fmdb.report.findings import FINDINGS, GENERIC, at
    for f in FINDINGS + [GENERIC]:
        for lv in ("B", "C"):
            if f.id == "u_red_cells":       # F17 as Shivani approved it on 20 Nov 2026 ("The commonest reasons are a period...")
                continue
            block = " ".join(at(t, lv) for t in (f.head, f.today, f.why, f.do, f.summary)) + " " + f.line.get(lv, "")
            assert not SOFT.search(block), (f.id, lv, SOFT.search(block).group(0))


def test_an_unlisted_result_that_is_clearly_off_is_pointed_out_to_the_coach():
    rp, _, _ = outcome({"Blood Urea": 12})                        # 33% below range: level B, catch-all wording only
    assert any("Urea" in w and "catch-all" in w for w in rp.warnings)


def _approved_finding_text() -> str:
    """Every finding level approved through APPROVED_DRAFTS, as the words a report prints."""
    from fmdb.report.findings import BY_ID, GENERIC, at
    from fmdb.report.wording import APPROVED_DRAFTS, DRAFT
    out = [f"[{key}]\nphrase: {DRAFT[key][1]}\n" for key in sorted(APPROVED_DRAFTS) if not key.startswith("finding.")]
    for key in sorted(k for k in APPROVED_DRAFTS if k.startswith("finding.")):
        _, fid, lv = key.split(".")
        f = BY_ID.get(fid) or GENERIC
        out += [f"[{key}]"] + [f"{name}: {at(t, lv)}" for name, t in
                               (("head", f.head), ("today", f.today), ("why", f.why), ("do", f.do), ("summary", f.summary))]
        out += [f"closing: {f.line.get(lv, '').strip()}", f"page 1 step: {f.step}", ""]
    return "\n".join(out)


def test_approved_finding_blocks_read_word_for_word_as_shivani_approved_them():
    # To record a NEW approval: add the keys to wording.APPROVED_DRAFTS, then run with FMDB_WRITE_APPROVED=1 once.
    path = FIX / "approved_findings.txt"
    if os.environ.get("FMDB_WRITE_APPROVED"):
        path.write_text(_approved_finding_text())
    assert _approved_finding_text() == path.read_text()            # a changed word needs her yes again


def test_the_approval_document_lists_every_draft_and_no_approved_sentence():
    from fmdb.report.findings import FINDINGS
    from fmdb.report.library_doc import markdown
    from fmdb.report.wording import APPROVED_DRAFTS, DRAFT
    doc = markdown()
    for key, (_where, sentence) in DRAFT.items():
        assert (f"<sub>{key}</sub>" in doc) == (key not in APPROVED_DRAFTS), key     # approved: no longer up for review
    from fmdb.report.library_doc import todo_levels
    for f in FINDINGS:
        for lv in "ABC":
            assert (f"finding.{f.id}.{lv}" in doc) == (lv in todo_levels(f)), (f.id, lv)      # approved: not up for review
    assert "Your morning sugar is calm." not in doc and "Clear. Nothing to act on." not in doc     # approved: not up for review
    assert "finding.lipids.B" not in doc and "finding.tsh_high.C" not in doc
    assert not FORBIDDEN.search(doc.split("## 1.", 1)[1]) and "{" not in doc      # the sentences, not my note about the rules


def test_next_test_is_four_months_with_something_to_work_on():
    rp = report()
    assert next_test_date(rp.sample_date, rp.sections) == date(2026, 11, 4)


# ── the three drawings follow the data ───────────────────────────────────────
def test_only_the_deeper_report_has_drawings():
    assert report("standard").figures == {} and set(report("deeper").figures) == {"glance", "nutrients", "onebody"}


def test_organ_tints_come_from_each_sections_status():
    sick, well = report("deeper").figures["glance"][1], report("deeper", STEADY).figures["glance"][1]
    assert sick.count(viz.ZOUT) == 2 and well.count(viz.ZOUT) == 0          # thyroid and heart tinted; none when steady
    assert "needs a deeper look" in sick and "needs a deeper look" not in well
    assert well.count(">steady<") == 8                                        # six organs and the two blood-only sections


def test_jar_levels_come_from_the_values_and_their_ranges():
    assert viz.jar_note(42.2, 30, 100) == ("in range, lower third", "ok")
    assert viz.jar_note(32.8, 16, 50) == ("comfortable", "ok")
    assert viz.jar_note(1475, 120, 911) == ("overfull", "over") and viz.jar_note(18, 30, 100) == ("below the low line", "low")
    jars = viz.jars_for(report("deeper").rows, num)
    assert [(j[0], j[1], j[6]) for j in jars] == [("Vitamin D", "42.2", "in range, lower third"), ("Vitamin B12", "1,475", "overfull"),
                                                  ("Iron carriers", "32.8%", "comfortable")]
    low = viz.jars_for(report("deeper", dict(STEADY, **{"Vitamin D (25-OH)": 14})).rows, num)
    assert low[0][6:] == ("below the low line", "low")


def test_map_nodes_and_links_come_from_the_rules_that_write_the_text():
    rp = report("deeper")
    said = {c.id for c in rp.decision.connections if c.title}
    assert said == {"thyroid_arteries", "sugar_fats", "hcy_b12"}
    t = text(report_html(rp))
    for c in rp.decision.connections:
        if c.title:
            assert c.text in t
    from fmdb.report.decide import groups_of
    nodes, links, aside = viz.map_for(rp.sections, rp.decision.connections, rp.rows, groups_of(rp.sections))
    assert list(nodes) == ["thyroid", "b12", "hcy", "art", "sugar"] and len(links) == 4
    assert nodes["thyroid"][1:3] == ("needs a deeper look", "deep") and nodes["art"][1:3] == ("needs attention", "att")
    assert nodes["b12"][1] == "overfull" and nodes["sugar"][1] == "watch"
    assert aside[0] == "steady, and not on this map: liver, kidneys, blood count, metals"
    assert viz.overlaps(nodes, links) == []
    # a report where nothing connects draws no map and says so in words
    well = report("deeper", STEADY)
    assert "onebody" not in well.figures and not any(c.title for c in well.decision.connections)


# ── a buyer is not a client in care ──────────────────────────────────────────
def buyer_record():
    return {"client_id": "cl-950", "display_name": "Test Buyer", "sex": "F", "date_of_birth": "1980-01-01",
            "intake_date": "2027-01-03", "created_at": "2027-01-03T10:00:00Z", "updated_at": "2027-01-10T10:00:00Z",
            "updated_by": "coach", "body_age_report_kind": "standard", "body_age_report_date": "2027-01-10",
            "segment": "longevity_customer",
            "body_age_reports": [{"report_no": "BA-S-950-270105", "kind": "standard", "sample_date": "2027-01-05",
                                  "report_date": "2027-01-10", "outcome": "nothing", "tags": ["steady"]}]}


def test_a_report_buyer_resolves_to_prospect_and_is_never_in_care():
    life = resolve_lifecycle(buyer_record(), [], date(2027, 1, 12))
    assert life["state"] == "prospect" and life["state"] not in IN_CARE
    # and stays one however long ago the report was
    assert resolve_lifecycle(buyer_record(), [], date(2028, 1, 12))["state"] == "prospect"


def test_the_client_model_holds_the_buyer_fields():
    c = Client.model_validate(buyer_record())
    assert c.body_age_report_date == date(2027, 1, 10) and c.body_age_reports[0].outcome == "nothing" and c.segment == "longevity_customer"


def test_only_the_credit_fields_reach_the_public_box():
    src = (WEB / "scripts/app-staging-action.py").read_text()
    assert '    "body_age_report_kind",\n    "body_age_report_date",\n' in src
    assert "body_age_reports" not in src                 # findings and tags stay on the Mac


# ── the command ──────────────────────────────────────────────────────────────
def shim():
    spec = importlib.util.spec_from_file_location("body_age_report_shim", WEB / "scripts/body-age-report.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_person(root: Path, cid: str, bucket: str = "prospects") -> Path:
    d = root / bucket / cid
    d.mkdir(parents=True)
    person = dict(FX["person"], client_id=cid, intake_date="2026-05-04", created_at="2026-05-04T00:00:00Z",
                  updated_at="2026-05-04T00:00:00Z", updated_by="coach", health_snapshots=[{"date": FX["sample_date"], "lab_values": FX["lab_values"]}])
    (d / "client.yaml").write_text(yaml.safe_dump(person, sort_keys=False))
    return d


def run(mod, capsys, **req):
    import io
    old = sys.stdin
    sys.stdin = io.StringIO(json.dumps(req))
    try:
        mod.main([])
    finally:
        sys.stdin = old
    return json.loads(capsys.readouterr().out)


def test_command_refuses_a_real_buyer_while_the_cutoffs_are_provisional(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    monkeypatch.setattr("fmdb.report.levels.cutoffs_approved", lambda path=None: False)
    write_person(tmp_path, "cl-950")
    from datetime import datetime
    from zoneinfo import ZoneInfo
    mod = shim()
    mod.now_ist = lambda: datetime(2027, 1, 5, 10, 0, tzinfo=ZoneInfo("Asia/Kolkata"))
    out = run(mod, capsys, client_id="cl-950", kind="standard")
    assert out["ok"] is False and "provisional" in out["error"]


def test_command_refuses_a_real_buyer_before_the_launch(tmp_path, monkeypatch, capsys):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    monkeypatch.setattr("fmdb.report.levels.cutoffs_approved", lambda path=None: True)     # as it is once she says yes
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    write_person(tmp_path, "cl-950")
    mod = shim()
    ist = ZoneInfo("Asia/Kolkata")
    mod.now_ist = lambda: datetime(2027, 1, 2, 19, 59, tzinfo=ist)
    out = run(mod, capsys, client_id="cl-950", kind="standard", html_only=True)
    assert out["ok"] is False and "embargoed" in out["error"]
    mod.now_ist = lambda: datetime(2027, 1, 2, 20, 0, tzinfo=ist)
    assert run(mod, capsys, client_id="cl-950", kind="standard", report_date="2027-01-02", html_only=True)["ok"] is True


def test_command_builds_a_buyer_stored_as_a_prospect_once_the_table_is_approved(tmp_path, monkeypatch, capsys):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    monkeypatch.setattr("fmdb.report.levels.cutoffs_approved", lambda path=None: True)     # as it is once she says yes
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    d = write_person(tmp_path, "cl-950")                                    # in prospects/, not clients/
    mod = shim()
    mod.now_ist = lambda: datetime(2027, 1, 5, 10, 0, tzinfo=ZoneInfo("Asia/Kolkata"))      # after the launch
    out = run(mod, capsys, client_id="cl-950", kind="deeper", report_date=FX["report_date"], record=True, html_only=True)
    assert out["ok"] and out["report"]["kind"] == "deeper" and out["report"]["report_no"] == "BA-D-950-260704"
    assert "Sample report" not in Path(out["files"]["html"]).read_text()    # a real buyer's page carries no sample marks
    saved = yaml.safe_load((d / "client.yaml").read_text())
    assert saved["body_age_report_kind"] == "deeper"
    assert resolve_lifecycle(saved, [], date(2026, 7, 8))["state"] == "prospect"


def test_command_builds_the_test_profile_and_records_it(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    d = write_person(tmp_path, "cl-900", bucket="clients")
    out = run(shim(), capsys, client_id="cl-900", kind="standard", report_date=FX["report_date"], record=True, html_only=True)
    assert out["ok"] and out["report"]["outcome"] == "foundation" and out["report"]["credit_until"] == "2026-07-21"
    # no app token on this record yet, so there is no personal link: the report is not ready to send
    assert out["ready"] is False and any("Foundation link" in b for b in out["blockers"])
    saved = yaml.safe_load((d / "client.yaml").read_text())
    assert saved["body_age_report_kind"] == "standard" and str(saved["body_age_report_date"]) == FX["report_date"]
    assert saved["body_age_reports"][0]["report_no"] == out["report"]["report_no"] and "segment" not in saved
    Client.model_validate(saved)
    assert Path(out["files"]["html"]).is_file() and Path(out["files"]["email_html"]).is_file()


@pytest.mark.skipif(os.environ.get("FMDB_PDF_TESTS") != "1", reason="prints with Chrome; run locally with FMDB_PDF_TESTS=1")
@pytest.mark.parametrize("kind,pages", [("standard", 18), ("deeper", 20)])      # 16 and 19 before the extra results of 20 Nov 2026
def test_pdf_has_the_approved_page_count_and_working_links(kind, pages, tmp_path):
    from fmdb.report.pdf import build_pdf
    from pypdf import PdfReader
    rp = report(kind, book_url="https://example.test/foundation/t")
    res = build_pdf(rp, tmp_path / "r.pdf")
    assert res["pages"] == pages
    kinds = {k for _, k, _ in res["links"]}
    assert "BROKEN" not in kinds and ("web" in kinds and "jump" in kinds)
    assert any(t == "https://example.test/foundation/t" for _, _, t in res["links"])
    meta = PdfReader(str(tmp_path / "r.pdf")).metadata
    assert "body age report" in meta.title.lower() and not FORBIDDEN.search(meta.title + str(meta.author))
    pages_text = [pg.extract_text() for pg in PdfReader(str(tmp_path / "r.pdf")).pages]
    assert all("It does not diagnose, treat or prescribe." in t for t in pages_text), "the disclaimer is on every page"
    first = pages_text[0]
    assert "Sequoya by Shivani Hari" in first and "Read by" not in first


# ── the extra results: every other test the two packages print (her "All approved", 20 Nov 2026) ─────────────
def _urine(**over):
    base = {"Urine Colour": ("Pale Yellow", "Pale Yellow"), "Urine Appearance": ("Clear", "Clear"), "Urine Volume": ("20", ""),
            "Specific Gravity": ("1.015", "1.003-1.030"), "Urine pH": ("6.0", "5-8"), "Urinary Protein": ("Absent", "Absent"),
            "Urinary Glucose": ("Absent", "Absent"), "Urine Ketone": ("Absent", "Absent"), "Urinary Bilirubin": ("Absent", "Absent"),
            "Urobilinogen": ("Normal", "Normal"), "Bile Salt": ("Absent", "Absent"), "Bile Pigment": ("Absent", "Absent"),
            "Urine Blood": ("Absent", "Absent"), "Nitrite": ("Absent", "Absent"), "Leucocyte Esterase": ("Absent", "Absent"),
            "Urinary Leucocytes (Pus Cells)": ("1-2", "0-5"), "Urine Red Blood Cells": ("Absent", "0-2"), "Epithelial Cells": ("Few", ""),
            "Casts": ("Absent", "Absent"), "Crystals": ("Absent", "Absent"), "Bacteria": ("Absent", "Absent"), "Yeast": ("Absent", "Absent"),
            "Parasite": ("Absent", "Absent"), "Mucus": ("Present", "")}
    for k, v in over.items():
        name = next(n for n in base if k.lower() in n.lower())
        base[name] = (v, base[name][1])
    return [dict(test_name=n, value=v, unit="", reference_range=r) for n, (v, r) in base.items()]


def test_extras_change_neither_body_age_nor_the_drawings_nor_the_outcome_when_in_range():
    a, b = _plus([]), _plus(_urine() + [_lab("Total IgE", 40, "< 100", "IU/mL"), _lab("Lipase", 30, "5-60", "U/L"), _lab("Nickel", 2, "< 15", "µg/L")])
    assert (a.body_age, a.decision.outcome, a.figures.keys()) == (b.body_age, b.decision.outcome, b.figures.keys())
    assert [s.id for s in b.sections][-4:] == ["immune", "pancreas", "metals", "urine"] and not b.drafts and not b.missing and not b.warnings
    page = text(report_html(b))
    for want in ("Your urine test is clear.", "Your allergy and autoimmune markers are quiet.", "Your pancreas enzymes are in range.",
                 "How it looks", "What is dissolved in it", "Under the microscope", "Metals and trace elements", "No known use in the body"):
        assert want in page, want
    assert "your urine test" in b.rest and not FORBIDDEN.search(page.replace(BRAND, ""))


def test_an_older_draw_without_urine_results_simply_has_no_urine_section():
    rp = report("standard")
    assert "urine" not in [s.id for s in rp.sections] and not rp.warnings
    assert "urine" in [s.id for s in _plus(_urine(), kind="standard").sections]            # both reports carry it


def test_total_ige_never_goes_past_the_checkup_sentence_and_never_brings_the_session_offer():
    for v in (198, 2500):
        rp = _plus([_lab("Total IgE", v, "< 100", "IU/mL")])
        sec = next(s for s in rp.sections if s.id == "immune")
        page = text(report_html(rp))
        assert (rp.rows["ige"].level, sec.status) == ("B", "watch") and rp.decision.outcome == "self"
        assert "Your allergy antibody is raised." in page and "worth mentioning at your next routine check-up" in page
        assert DOCTOR not in page and not rp.drafts and "immune" in [x["id"] for x in rp.stand]      # clearly off: listed on page 1 (D7)


@pytest.mark.parametrize("name,value,rng,level", [("Rheumatoid Factor (RF)", 20, "<=18", "B"), ("Rheumatoid Factor (RF)", 60, "<=18", "C"),
                                                   ("Anti CCP (ACCP)", 6, "<5", "B"), ("Anti Nuclear Antibodies (ANA)", 70, "<=20", "C")])
def test_an_autoimmune_marker_above_its_limit_gets_the_checkup_sentence_and_three_times_the_doctor_sentence(name, value, rng, level):
    rp = _plus([_lab(name, value, rng, "IU/mL")])
    page = text(report_html(rp))
    assert [h.level for h in rp.hits["immune"]] == [level] and "One of your autoimmune markers is raised." in page
    assert (DOCTOR in page) == (level == "C") and rp.decision.outcome == "foundation" and not rp.drafts and not rp.missing


def test_a_small_extra_is_in_its_section_and_on_the_one_page_summary_but_not_on_page_one():
    rp = _plus([_lab("Lipase", 65.5, "5-60", "U/L"), _lab("Amylase", 105, "28-100", "U/L"), _lab("Magnesium", 1.85, "1.90-3.10"),
                _lab("Folate", 5.2, ">5.38", "ng/mL"), _lab("Fructosamine", 290, "<286", "umol/L")])
    assert rp.decision.outcome == "self"                               # five small extras do not bring the session offer
    assert not rp.stand and "pancreas" not in rp.rest and all(t["tag"] != "Worth watching" for t in rp.todo)
    page = text(report_html(rp))
    for want in ("One of your pancreas enzymes is above its range.", "see a doctor the same day", "Your magnesium is low.", "Your folate is low.",
                 "Your sugar average over the last few weeks reads high."):
        assert want in page, want
    assert not rp.drafts and not rp.missing
    assert any("pancreas enzymes" in t for _n, t, _i in rp.summary["work"])


def test_one_white_cell_type_off_leaves_the_blood_count_steady_with_one_paragraph():
    rp = _plus([_lab("Monocytes - Absolute Count", 0.15, "0.2 - 1.0", "X 10³ / µL")], over={"Eosinophils": 9})
    sec = next(s for s in rp.sections if s.id == "blood")
    assert sec.status == "steady" and not rp.hits["blood"] and rp.decision.outcome == "nothing"
    para = dict(rp.section_text["blood"][1])["Eosinophils and Monocytes"]
    assert para.startswith("One type of white cell sits outside its range.") and "such as worms" in para and para.endswith("It is read again at your next test.")
    page = text(report_html(rp))
    assert "Your white cell types, as actual counts" in page and "the same cells as actual numbers in your blood" in page


def test_a_finer_blood_measure_off_prints_one_sentence_and_says_what_it_is_read_with():
    rp = _plus([_lab("Mean Platelet Volume (MPV)", 13.1, "6.5-12", "fL"), _lab("Mean Corp.Hemo. Conc (MCHC)", 31.0, "31.5-34.5", "g/dL")])
    paras = dict(rp.section_text["blood"][1])
    assert next(s for s in rp.sections if s.id == "blood").status == "steady"
    assert paras["Haemoglobin concentration (MCHC) and Platelet size (MPV)"].endswith("your haemoglobin and platelet count, which are in range.")
    assert rp.rows["platelets"].value == 236 and rp.rows["hb"].value == 14.7                 # the count and haemoglobin rows still read their own lines


def test_the_laboratorys_own_ratios_are_shown_and_never_flag():
    rp = _plus([_lab("TC/ HDL CHOLESTEROL RATIO", 6.2, "3-5", "Ratio"), _lab("LDL / HDL RATIO", 3.9, "1.5-3.5", "Ratio"),
                _lab("HDL / LDL RATIO", 0.3, "> 0.40", "Ratio"), _lab("SGOT / SGPT RATIO", 2.4, "<2", "Ratio"),
                _lab("BUN / Sr.CREATININE RATIO", 25, "9:1-23:1", "Ratio"), _lab("AVERAGE BLOOD GLUCOSE (ABG)", 125, "90-120")])
    for k in ("tc_hdl_lab", "ldl_hdl_lab", "hdl_ldl_lab", "ast_alt", "bun_creat", "avg_glucose", "vldl"):
        assert k in rp.rows and not rp.rows[k].level, k
    assert rp.decision.outcome == "nothing" and all(s.status == "steady" for s in rp.sections) and not rp.warnings
    assert rp.rows["ast"].value == 20.9 and rp.rows["hdl"].value == 56.3                     # the results themselves are untouched
    assert "Your laboratory's cholesterol ratios" in text(report_html(rp))


def test_a_further_element_above_its_range_is_named_and_a_low_one_only_when_the_body_needs_it():
    rp = _plus([_lab("NICKEL", 20, "< 15", "µg/L"), _lab("STRONTIUM", 5, "8 - 38", "µg/L"), _lab("SELENIUM", 50, "60 - 340", "µg/L"),
                _lab("TIN", 1, "<2", "µg/L"), _lab("CREATININE - URINE", 100, "20-300")])
    ids = sorted((h.finding.id, h.rows[0].key) for h in rp.hits["metals"])
    assert ids == [("element_high", "nickel"), ("element_low", "selenium")] and not rp.rows["strontium"].level
    page = text(report_html(rp))
    assert "One element is above its range: Nickel." in page and "Your selenium is low." in page
    assert "Your blood was also read for four further elements." in page and not rp.drafts and not rp.missing


def test_direct_and_indirect_bilirubin_print_the_approved_bilirubin_finding():
    rp = _plus([_lab("BILIRUBIN -DIRECT", 0.26, "0 - 0.20"), _lab("BILIRUBIN (INDIRECT)", 0.4, "0-0.9")], kind="standard")
    assert [(h.finding.id, [r.key for r in h.rows]) for h in rp.hits["liver"]] == [("bilirubin", ["bili_direct"])]
    assert rp.rows["bilirubin"].value == 0.59 and rp.rows["bili_indirect"].value == 0.4


def test_the_kidney_intro_names_potassium_only_when_the_laboratory_measured_it():
    with_k = text(report_html(report("standard")))
    without = text(report_html(make_report(FX["person"], [l for l in labs() if l["test_name"] != "Potassium"], kind="standard", sample=True,
                                           sample_date=FX["sample_date"], report_date=FX["report_date"])))
    assert "Sodium, potassium, chloride and calcium" in with_k and "Sodium, chloride and calcium show" in without


@pytest.mark.parametrize("over,finding,level,words", [
    (dict(protein="Trace"), "u_protein", "A", "Your urine shows protein."),
    (dict(protein="Present (++)"), "u_protein", "B", "It needs a repeat on a fresh morning sample."),
    (dict(glucose="Present"), "u_glucose", "B", "Your urine shows glucose."),
    (dict(ketone="Trace"), "u_ketones", "A", "Your urine shows ketones."),
    (dict(blood="Present"), "u_red_cells", "B", "It needs a repeat sample, away from your period."),
    (dict(nitrite="Positive"), "u_infection", "B", "see a doctor now"),
    (dict(pus="8-10"), "u_infection", "B", "Your urine shows signs of a possible infection."),
    (dict(crystals="Few"), "u_other", "A", "One result in your urine test is outside the usual."),
    (dict(colour="Red"), "u_other", "A", "One result in your urine test is outside the usual."),
])
def test_a_urine_result_prints_its_paragraph_marks_the_section_and_never_brings_the_session_offer(over, finding, level, words):
    rp = _plus(_urine(**over), kind="standard")
    sec = next(s for s in rp.sections if s.id == "urine")
    assert [(h.finding.id, h.level) for h in rp.hits["urine"]] == [(finding, level)] and sec.status == "watch"
    page = text(report_html(rp))
    assert words in page and rp.decision.outcome == "self" and DOCTOR not in page and not rp.drafts and not rp.missing and not rp.warnings
    assert ("worth mentioning at your next routine check-up" in page) == (level == "B")
    assert ("urine" in [x["id"] for x in rp.stand]) == (level == "B")                       # D7


def test_urine_words_that_cannot_be_read_are_shown_unmarked_and_the_coach_is_told():
    rp = _plus(_urine(casts="see remarks"), kind="standard")
    assert not rp.rows["u_casts"].level and any("casts" in w and "read it yourself" in w for w in rp.warnings)
    rp = _plus(_urine(epithelial="Plenty", mucus="Present"), kind="standard")
    assert next(s for s in rp.sections if s.id == "urine").status == "steady" and not rp.warnings


def test_a_blood_result_is_never_read_as_a_urine_result():
    rp = _plus([_lab("Blood Glucose - Random", 300, "70-140"), _lab("C-Reactive Protein", 30, "<5", "mg/L")], kind="standard")
    assert "urine" not in [s.id for s in rp.sections]


def test_every_urine_finding_prints_its_own_paragraph_even_beside_a_clearer_one():
    rp = _plus(_urine(protein="Trace", pus="8-10"), kind="standard")
    titles = [a for a, _b in rp.section_text["urine"][1]]
    assert rp.section_text["urine"][0] == "Your urine shows signs of a possible infection." and "Protein in the urine" in titles


def test_the_two_small_cell_indices_say_when_there_is_nothing_to_read_and_flag_the_inherited_pattern_when_there_is():
    idx = [_lab("MENTZER INDEX", 19.1, "", "-"), _lab("RED CELL DISTRIBUTION WIDTH INDEX (RDWI)", 260, "", "-")]
    rp = _plus(idx)
    page = text(report_html(rp))
    assert "to help tell low iron from an inherited trait. Your red cells are a normal size, so there is nothing to read here." in page
    assert not rp.drafts and "Small red cells" not in dict(rp.section_text["blood"][1])
    small = _plus([_lab("MENTZER INDEX", 11.5, "", "-")], over={"MCV": 70})
    page = text(report_html(small))
    assert "nothing to read here" not in page and "That pattern can be inherited" in dict(small.section_text["blood"][1])["Small red cells"]
    assert not small.drafts                                                # she approved the sentence on 20 Nov 2026
    iron = _plus([_lab("MENTZER INDEX", 16, "", "-")], over={"MCV": 70})
    assert "Small red cells" not in dict(iron.section_text["blood"][1])
