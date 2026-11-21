"""Alcohol answer, plan by plan (fm-database-web/scripts/alcohol_risk.py).
Coach, 21 Nov 2026: a risk marker gets the gentle "skip it", else the practical line."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "fm-database-web" / "scripts"))

from alcohol_risk import alcohol_risk  # noqa: E402


def c(**over):
    d = {"active_conditions": [], "current_medications": [], "lab_markers": [{"marker_name": "Fasting glucose", "value": 95}]}
    d.update(over)
    return d


def test_no_marker_no_risk():
    # "fasting" must not be read as AST
    assert alcohol_risk(c()) is False


def test_markers():
    assert alcohol_risk(c(active_conditions=["Fatty liver grade 1"]))
    assert alcohol_risk(c(active_conditions=["Gout"]))
    assert alcohol_risk(c(active_conditions=["GERD"]))
    assert alcohol_risk(c(lab_markers=[{"marker_name": "SGPT (ALT)", "value": 62}]))
    assert alcohol_risk(c(lab_markers=[{"marker_name": "Triglycerides", "value": 240}]))
    assert not alcohol_risk(c(lab_markers=[{"marker_name": "Triglycerides", "value": 140}]))
    assert alcohol_risk(c(current_medications=["Escitalopram 10 mg"]))
    assert alcohol_risk(c(current_medications=["Glimepiride 1 mg"]))
    assert alcohol_risk(c(current_medications=["Metronidazole 400"]))
    assert alcohol_risk(c(pregnancy_status="pregnant"))


def test_plan_leave_out_list():
    assert alcohol_risk(c(), {"nutrition": {"reduce": ["Alcohol", "Sugar"]}})
    assert not alcohol_risk(c(), {"nutrition": {"reduce": ["Sugar"]}})


def test_coach_override_wins():
    assert alcohol_risk(c(active_conditions=["Gout"], alcohol_ok=True)) is False
    assert alcohol_risk(c(alcohol_ok=False)) is True


def test_lab_units():
    assert not alcohol_risk(c(lab_markers=[{"marker_name": "Uric acid", "value": 300}]))  # µmol/L, normal
    assert alcohol_risk(c(lab_markers=[{"marker_name": "Uric acid", "value": 480}]))
    assert alcohol_risk(c(lab_markers=[{"marker_name": "Triglycerides", "value": 3.0}]))  # mmol/L, high
