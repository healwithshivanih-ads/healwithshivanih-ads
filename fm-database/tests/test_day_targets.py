"""The daily nutrient targets (fm-database-web/scripts/day_targets.py) against
the coach-confirmed table in docs/client-app-redesign/BUILD-PLAN.md
"### Confirmed targets" (20 Nov 2026)."""
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent.parent / "fm-database-web" / "scripts"
sys.path.insert(0, str(_SCRIPTS))

from day_targets import day_targets  # noqa: E402


def base(**over):
    c = {
        "sex": "F",
        "date_of_birth": "1980-01-01",
        "measurements": {"weight_kg": 70, "height_cm": 160},
        "active_conditions": [],
        "current_medications": [],
        "lab_markers": [{"marker_name": "eGFR", "value": 95}],
    }
    c.update(over)
    return c


def test_everyday_client():
    t = day_targets(base())
    assert t["status"] == "ok"
    assert t["kcal"]["maintenance"] > 1500
    # BMI 27.3, so body weight: 1.2-1.5 g/kg of 70
    assert t["protein"] == {"low": 84, "high": 105}
    assert t["fibre"] == 25
    assert t["fat_share"] == [0.2, 0.3]
    assert t["carb_share"] is None  # no carb level set: no carb target


def test_carb_levels_only_when_coach_sets_them():
    assert day_targets(base(carb_level="standard"))["carb_share"] == [0.5, 0.55]
    g = day_targets(base(carb_level="glycaemic"))
    assert g["carb_share"] == [0.45, 0.45]
    assert g["fat_share"][1] == 0.35  # open ruling 1 default
    assert day_targets(base(carb_level=0.40))["carb_share"] == [0.4, 0.4]


def test_weight_loss_keeps_the_usual_band_and_uses_phases():
    t = day_targets(base(weight_loss={"enabled": True, "pace": "moderate", "activity_level": "sedentary"}))
    assert t["protein"] == {"low": 84, "high": 105}
    assert set(t["kcal"]["phases"]) == {"wk1_2", "wk3_4", "wk5_8", "wk9_10", "wk11_12"}
    assert min(t["kcal"]["phases"].values()) >= 1200


def test_adjusted_weight_at_bmi_30():
    t = day_targets(base(measurements={"weight_kg": 100, "height_cm": 160}))
    assert t["protein"]["low"] < 1.2 * 100


def test_no_automatic_targets():
    for over in (
        {"pregnancy_status": "pregnant"},
        {"active_conditions": ["Type 1 diabetes"]},
        {"active_conditions": ["Cirrhosis"]},
        {"medical_history": ["Anorexia nervosa (2015)"]},
        {"lab_markers": [{"marker_name": "eGFR", "value": 25}]},
        {"measurements": {"weight_kg": 45, "height_cm": 165}},
    ):
        assert day_targets(base(**over))["status"] == "none", over
    assert day_targets(base(active_conditions=["Cirrhosis"]))["client_line"] == "Do not cut protein or skip meals."


def test_kidney():
    t = day_targets(base(lab_markers=[{"marker_name": "eGFR", "value": 50}]))
    assert t["protein"] is None
    assert t["protein_note"] == "Your kidney team sets your protein."
    assert t["menu_protein_g"] == 56
    # one high creatinine, no diagnosis: the usual band plus a doctor line
    t = day_targets(base(lab_markers=[{"marker_name": "eGFR", "value": 80}, {"marker_name": "Creatinine", "value": 1.4}]))
    assert t["protein"] and t["protein_note"] == "Check this kidney result with your doctor."
    # kidney disease: no deficit
    t = day_targets(base(active_conditions=["CKD stage 3"], weight_loss={"enabled": True}))
    assert "maintenance" in t["kcal"]


def test_gout_shows_no_protein_number():
    t = day_targets(base(active_conditions=["Gout"]))
    assert t["protein"] is None and t["protein_note"] is None


def test_fibre_exclusions():
    assert day_targets(base(active_conditions=["Ulcerative colitis"]))["fibre"] is None
    assert day_targets(base(active_conditions=["SIBO"]))["fibre"] is None
    assert day_targets(base(active_conditions=["SIBO"], fibre_g=15))["fibre"] == 15
    assert day_targets(base(active_conditions=["IBS"]))["fibre"] == 25
    # "ulcer" must not be read as ulcerative colitis, nor the reverse
    assert day_targets(base(active_conditions=["Peptic ulcer"]))["fibre"] == 25


def test_medicines():
    wl = {"enabled": True, "pace": "moderate"}
    assert "maintenance" in day_targets(base(current_medications=["Glimepiride 1 mg"], weight_loss=wl))["kcal"]
    assert "maintenance" in day_targets(base(current_medications=["Ozempic 0.5 mg weekly"], weight_loss=wl))["kcal"]
    t = day_targets(base(current_medications=["Jardiance 10"], carb_level=0.40))
    assert t["carb_share"][0] >= 0.45


def test_over_65_no_deficit_by_default():
    t = day_targets(base(date_of_birth="1950-01-01", weight_loss={"enabled": True}))
    assert "maintenance" in t["kcal"]
