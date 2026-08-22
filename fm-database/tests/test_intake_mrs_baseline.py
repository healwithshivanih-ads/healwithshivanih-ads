"""The intake-submit allowlist for the MRS baseline (v0.82), as failable tests.

The client form posts `mrs_baseline` as a dict of 11 ints; `_apply_submit`
only keeps it through `_INTAKE_INT_DICT_FIELDS` + `_clean_int_dict`. If the
allowlist drifts from the Pydantic model, the form silently loses the score —
the intake-allowlist failure mode this repo has hit before.

Run: python -m tests.test_intake_mrs_baseline   (from fm-database/)
"""

import importlib.util
from pathlib import Path

from fmdb.plan.models import MenopauseRatingScale

_SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "fm-database-web" / "scripts" / "intake-token-action.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("intake_token_action", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_allowlist_keys_mirror_the_pydantic_model():
    mod = _load()
    keys, lo, hi = mod._INTAKE_INT_DICT_FIELDS["mrs_baseline"]
    assert set(keys) == set(MenopauseRatingScale.model_fields), (
        "intake allowlist and Session/Client MRS model have drifted apart"
    )
    assert (lo, hi) == (0, 4)


def test_clean_keeps_known_in_range_ints_and_drops_the_rest():
    mod = _load()
    keys, lo, hi = mod._INTAKE_INT_DICT_FIELDS["mrs_baseline"]
    out = mod._clean_int_dict(
        {
            "hot_flashes_sweating": "3",   # string int → kept
            "anxiety": 0,                  # zero is a real answer → kept
            "bladder_problems": 7,         # out of range → dropped
            "made_up_key": 2,              # unknown key → dropped
            "irritability": "",            # blank → skipped
            "sleep_problems": None,        # unanswered → skipped
            "depressive_mood": "severe",   # non-numeric → dropped
            "vaginal_dryness": True,       # bool → dropped
        },
        keys, lo, hi,
    )
    assert out == {"hot_flashes_sweating": 3, "anxiety": 0}


def test_non_dict_and_empty_inputs_yield_empty():
    mod = _load()
    keys, lo, hi = mod._INTAKE_INT_DICT_FIELDS["mrs_baseline"]
    for bad in (None, "", [], "3", 3, {}):
        assert mod._clean_int_dict(bad, keys, lo, hi) == {}


def test_full_answer_set_survives_and_validates_as_the_model():
    mod = _load()
    keys, lo, hi = mod._INTAKE_INT_DICT_FIELDS["mrs_baseline"]
    full = {k: i % 5 for i, k in enumerate(keys)}
    out = mod._clean_int_dict(full, keys, lo, hi)
    assert out == full
    MenopauseRatingScale(**out)   # round-trips into the Pydantic model


if __name__ == "__main__":
    passed = failed = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            passed += 1
            print(f"  ✓ {name}")
        except AssertionError as e:
            failed += 1
            print(f"  ✗ {name}\n      {e}")
    print(f"\n{passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)
