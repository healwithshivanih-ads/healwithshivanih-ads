"""Capture the Python screen's output as the parity fixture for the TS mirror.

Run from fm-database/:
    .venv/bin/python scripts/dump_exercise_screen_fixture.py

Writes fm-database-web/src/lib/fmdb/__fixtures__/exercise-screen-python.json.
Regenerate BY HAND whenever the matcher legitimately changes — the fixture is
the pin, so silently regenerating it on every run would defeat the point.

The client records here are shaped from the real roster's four design cases but
carry no identifying detail, so the fixture is safe to commit alongside code.
"""

import dataclasses
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # house pattern — see scripts/check-assess-payload-size.py

from fmdb.loader import load_exercises  # noqa: E402
from fmdb.plan.exercise_screen import screen_all  # noqa: E402

OUT = ROOT.parent / "fm-database-web/src/lib/fmdb/__fixtures__/exercise-screen-python.json"

CASES = {
    "pem": {
        "age_band": "55-60",
        "active_conditions": ["Long-COVID (fatigue, brain fog)", "Type 2 diabetes", "NAFLD"],
        "current_medications": ["Pregabalin 75 mg", "Nortriptyline 10 mg"],
        "pain_locations": ["neck_back", "arm_left", "hip_left", "thigh_left", "calf_left"],
    },
    "bone": {
        "age_band": "60-65",
        "active_conditions": ["Osteoporosis", "Hypertension", "Insulin Resistance"],
        "current_medications": ["Teriparatide 750 mcg daily", "Levothyroxine 50 mcg"],
        "pain_locations": ["neck_back", "mid_back", "sacrum", "thigh_left", "thigh_right"],
    },
    "elder": {
        "age_band": "80-85",
        "active_conditions": ["Postmenopausal"],
        "pain_locations": ["head_back", "pelvis", "lower_back"],
    },
    "pain_heavy": {
        "age_band": "45-50",
        "active_conditions": ["Anxiety", "Depression / anxiety (on treatment)"],
        "pain_locations": [
            "head", "face", "upper_back", "lower_back", "scapula_right", "scapula_left",
            "arm_right", "arm_left", "shoulder_left", "shoulder_right", "hip_left",
            "hip_right", "buttock_left", "buttock_right", "knee_left", "knee_right",
        ],
    },
    # Negation + empty-record edges, which is where the two engines are most
    # likely to drift apart.
    "negated": {
        "age_band": "45-50",
        "active_conditions": ["No history of falls", "Denies any history of osteoporosis"],
        "pain_locations": [],
    },
    # The limitation is recorded ONLY under weight_loss — nothing in
    # active_conditions hints at it. If the screen stops reading that field,
    # this case silently goes clear.
    "limitation_only_in_weight_loss": {
        "age_band": "45-50",
        "active_conditions": ["Perimenopause"],
        "pain_locations": [],
        "weight_loss": {
            "enabled": True,
            "pace": "moderate",
            "exercise_current": "walks most days",
            "exercise_limitations": "knee osteoarthritis, left",
        },
    },
    "empty": {},
}


def main() -> None:
    exercises = [e.model_dump(mode="json") for e in load_exercises(ROOT / "data")]
    payload = {
        "_note": "Captured from fmdb.plan.exercise_screen. Regenerate by hand; see module docstring.",
        "exercise_count": len(exercises),
        "cases": {
            name: [dataclasses.asdict(v) for v in screen_all(exercises, client)]
            for name, client in CASES.items()
        },
        "clients": CASES,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")
    print(f"wrote {OUT} — {len(exercises)} exercises x {len(CASES)} cases")


if __name__ == "__main__":
    main()
