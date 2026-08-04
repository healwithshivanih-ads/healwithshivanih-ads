"""The suitability screen, tested against the four real design cases.

These are not synthetic fixtures. They are the shapes on the actual roster that
the catalogue was built around, because a screen that passes on invented clients
and fails on real ones is worse than none.

Run: python -m tests.test_exercise_screen
"""

import pathlib

from fmdb.loader import load_exercises
from fmdb.plan.exercise_screen import (
    fold_pain_regions,
    screen_all,
    screen_exercise,
    summarise,
)

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
EXERCISES = [e.model_dump(mode="json") for e in load_exercises(DATA)]

# ── the four design cases, as records ────────────────────────────────────────
PEM_CLIENT = {  # Sudarshan-shaped: long COVID + cervical radiculopathy
    "age_band": "55-60",
    "active_conditions": ["Long-COVID (fatigue, brain fog)", "Type 2 diabetes", "NAFLD"],
    "current_medications": ["Pregabalin 75 mg", "Nortriptyline 10 mg"],
    "pain_locations": ["neck_back", "arm_left", "hip_left", "thigh_left", "calf_left"],
}
BONE_CLIENT = {  # Pranati-shaped: osteoporosis on teriparatide, plus hypertension
    "age_band": "60-65",
    "active_conditions": ["Osteoporosis", "Hypertension", "Insulin Resistance"],
    "current_medications": ["Teriparatide 750 mcg daily", "Levothyroxine 50 mcg"],
    "pain_locations": ["neck_back", "mid_back", "sacrum", "thigh_left", "thigh_right"],
}
ELDER_CLIENT = {  # Manju-shaped: 80-85, almost nothing else on record
    "age_band": "80-85",
    "active_conditions": ["Postmenopausal"],
    "pain_locations": ["head_back", "pelvis", "lower_back"],
}
PAIN_CLIENT = {  # Deepti-shaped: 16 tagged regions, no exercise-restricting dx
    "age_band": "45-50",
    "active_conditions": ["Anxiety", "Depression / anxiety (on treatment)"],
    "pain_locations": [
        "head", "face", "upper_back", "lower_back", "scapula_right", "scapula_left",
        "arm_right", "arm_left", "shoulder_left", "shoulder_right", "hip_left",
        "hip_right", "buttock_left", "buttock_right", "knee_left", "knee_right",
    ],
}


def _by_slug(client):
    return {v.slug: v for v in screen_all(EXERCISES, client)}


# ── region folding ───────────────────────────────────────────────────────────

def test_pain_regions_fold_side_and_granularity():
    got = fold_pain_regions(["knee_left", "knee_right", "scapula_left", "buttock_right",
                             "achilles_left", "neck_back", "sacrum"])
    assert got == {"knee", "upper_back", "hip", "ankle_foot", "neck", "sacrum_pelvis"}, got


def test_head_regions_are_dropped_not_folded():
    """Folding 'face' onto something would invent an overlap no exercise has."""
    assert fold_pain_regions(["head", "face", "jaw"]) == set()


# ── PEM: the block must hold, and must leave something behind ────────────────

def test_pem_client_is_blocked_from_every_progressive_entry():
    v = _by_slug(PEM_CLIENT)
    progressive = [e for e in EXERCISES if len(e.get("levels") or []) > 1]
    assert progressive
    offered = [e["slug"] for e in progressive if v[e["slug"]].verdict != "blocked"]
    assert not offered, f"progressive work still offered to a PEM record: {offered}"


def test_pem_client_still_has_pacing_and_gentle_work():
    """A screen that leaves a client with nothing gets overridden and then ignored."""
    v = _by_slug(PEM_CLIENT)
    left = [s for s, ver in v.items() if ver.offerable]
    assert "energy-envelope-pacing" in left, left
    assert len(left) >= 3, f"only {len(left)} entries survive — too little to work with: {left}"


def test_blocked_entries_carry_no_start_level():
    v = _by_slug(PEM_CLIENT)
    for ver in v.values():
        if ver.verdict == "blocked":
            assert ver.start_level is None, f"{ver.slug} is blocked but suggests a level"


# ── osteoporosis: cautioned, never blocked ───────────────────────────────────

def test_bone_client_keeps_the_loading_work():
    """The whole point of LIFTMOR: low bone mass needs loading, not exclusion.

    This began life as a blanket "never blocked", and that held only because
    every entry then on disk came from the Otago falls manual — none of which
    bends the loaded spine, so nothing could fire. The catalogue now carries
    entries that do, and `ExerciseCautionSeverity` exists precisely so they can
    be stopped: its docstring names loaded spinal flexion in vertebral
    osteoporosis as the reason a real block tier was needed at all. A blanket
    assertion would now force that flag off and defeat the axis it protects.

    So the claim is narrower and truer than before: a bone client may lose the
    spine-bending movements, and must keep every single thing that loads bone.
    """
    v = _by_slug(BONE_CLIENT)
    blocked = {s for s, ver in v.items() if ver.verdict == "blocked"}
    flexes = {e["slug"] for e in EXERCISES if e.get("spinal_flexion")}
    assert blocked <= flexes, \
        f"bone-loss client blocked from work that does not bend the spine: {sorted(blocked - flexes)}"

    loading = [e["slug"] for e in EXERCISES
               if e.get("modality") in {"strength", "balance"} and not e.get("spinal_flexion")]
    assert loading, "no loading work on disk to check"
    lost = [s for s in loading if s in blocked]
    assert not lost, f"bone-loss client lost loading work — this is the LIFTMOR failure: {lost}"


def test_bone_client_gets_modifications_not_bare_warnings():
    v = _by_slug(BONE_CLIENT)
    cautions = [n for ver in v.values() for n in ver.notes if n.kind == "caution"]
    assert cautions, "expected osteoporosis/hypertension cautions to fire"
    assert all(n.modification.strip() for n in cautions), \
        [n.label for n in cautions if not n.modification.strip()]


def test_bone_client_starts_supported_on_balance_work():
    v = _by_slug(BONE_CLIENT)
    ols = v["one-leg-stand"]
    assert ols.start_level is not None
    assert ols.start_reason == "start supported", ols.start_reason


# ── age: the gap the first screen run missed entirely ────────────────────────

def test_elder_client_is_flagged_on_high_balance_demand():
    """Manju's record has no falls history, so nothing condition-based fires.
    Before the age rule she came back 18/18 clear — including 30 seconds of
    unsupported single-leg stance."""
    v = _by_slug(ELDER_CLIENT)
    ols = v["one-leg-stand"]
    assert ols.verdict != "clear", "high balance demand cleared for an 80-year-old"
    assert any(n.kind == "age" for n in ols.notes), ols.notes
    assert ols.start_reason == "start supported"


def test_elder_client_is_not_blocked_from_anything():
    """Otago's own finding: the over-80s benefit most. Age gates HOW, not WHETHER."""
    v = _by_slug(ELDER_CLIENT)
    assert not [s for s, ver in v.items() if ver.verdict == "blocked"]


def test_seated_work_stays_clear_for_the_elder_client():
    """The age rule keys on balance demand, so it must not sweep up seated work."""
    v = _by_slug(ELDER_CLIENT)
    assert v["seated-knee-extension"].verdict in ("clear", "watch")
    assert not any(n.kind == "age" for n in v["seated-knee-extension"].notes)


# ── pain regions ─────────────────────────────────────────────────────────────

def test_pain_client_gets_watch_on_the_exercises_that_load_their_regions():
    v = _by_slug(PAIN_CLIENT)
    # knees and hips are tagged; sit-to-stand loads both
    sts = v["chair-sit-to-stand"]
    assert any(n.kind == "pain" for n in sts.notes), sts.notes
    assert "knee" in " ".join(n.label for n in sts.notes if n.kind == "pain")


def test_pain_watch_does_not_fire_where_regions_do_not_overlap():
    v = _by_slug(PAIN_CLIENT)
    # neck mobility loads the neck; this client has no neck region tagged
    assert not any(n.kind == "pain" for n in v["neck-mobility"].notes), v["neck-mobility"].notes


def test_negated_record_text_does_not_fire_a_caution():
    """'no history of falls' must not read as a falls history — the guard shared
    with contra_screen."""
    clean = {"age_band": "45-50", "active_conditions": ["No history of falls"],
             "pain_locations": []}
    v = {x.slug: x for x in screen_all(EXERCISES, clean)}
    assert v["one-leg-stand"].verdict == "clear", v["one-leg-stand"].notes


# ── ordering + summary ───────────────────────────────────────────────────────

def test_blocked_sorts_first():
    ordered = screen_all(EXERCISES, PEM_CLIENT)
    verdicts = [v.verdict for v in ordered]
    assert verdicts == sorted(verdicts, key=lambda x: {"blocked": 0, "caution": 1, "watch": 2, "clear": 3}[x])


def test_summary_totals_match():
    ordered = screen_all(EXERCISES, BONE_CLIENT)
    assert sum(summarise(ordered).values()) == len(EXERCISES)


def test_empty_client_record_screens_clean_without_crashing():
    ordered = screen_all(EXERCISES, {})
    assert len(ordered) == len(EXERCISES)
    assert all(v.verdict in ("clear", "watch") for v in ordered)


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
