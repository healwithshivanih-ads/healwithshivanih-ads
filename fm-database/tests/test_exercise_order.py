"""Position grouping — a session should put the client on the floor once.

Tested against the REAL catalogue, because the thing being asserted is a
property of the actual entries' `position` values, not of a fixture.

Run: python -m tests.test_exercise_order
"""

import pathlib

from fmdb.loader import load_exercises
from fmdb.plan.exercise_order import (
    group_by_position,
    position_band,
    position_transitions,
)

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
EXERCISES = [e.model_dump(mode="json") for e in load_exercises(DATA)]

BY_SLUG = {e["slug"]: e for e in EXERCISES}


def picks(*slugs):
    return [{"exercise": s, "rationale": "x"} for s in slugs]


def slugs(rows):
    return [r["exercise"] for r in rows]


# ── the case that prompted this ──────────────────────────────────────────────

def test_interleaved_session_is_grouped_and_transitions_drop():
    """The real complaint: up, down, up, down for no clinical reason."""
    session = picks(
        "joint-mobilising-sequence",   # standing — warm-up
        "sit-to-stand-no-hands",       # seated
        "floor-bridge",                # lying_supine
        "heel-raises",                 # standing
        "bird-dog",                    # four_point
        "bodyweight-squat",            # standing
    )
    before = position_transitions(session, EXERCISES)
    out = group_by_position(session, EXERCISES)
    after = position_transitions(out, EXERCISES)

    assert after < before, f"grouping did not reduce transitions ({before} → {after})"
    got = slugs(out)
    assert got[0] == "joint-mobilising-sequence", "the warm-up moved out of slot one"
    floor_idx = [i for i, s in enumerate(got) if position_band(BY_SLUG[s]["position"]) == "floor"]
    assert floor_idx == list(range(min(floor_idx), max(floor_idx) + 1)), (
        f"floor work is still split across the session: {got}"
    )
    assert set(got) == set(slugs(session)), "grouping added or dropped an exercise"


def test_every_band_ends_up_contiguous():
    session = picks(
        "joint-mobilising-sequence",
        "floor-bridge",
        "chair-dip",
        "side-plank",
        "one-leg-stand",
        "seated-knee-extension",
        "forearm-plank",
    )
    got = slugs(group_by_position(session, EXERCISES))
    seen: list[str] = []
    for s in got:
        b = position_band(BY_SLUG[s]["position"])
        if b is None:
            continue
        if not seen or seen[-1] != b:
            assert b not in seen, f"band {b!r} appears twice in {got}"
            seen.append(b)


# ── what must NOT move ───────────────────────────────────────────────────────

def test_warm_up_stays_first_and_cool_down_stays_last():
    session = picks(
        "joint-mobilising-sequence",
        "floor-bridge",
        "bodyweight-squat",
        "bird-dog",
        "cool-down-stretch-sequence",
    )
    got = slugs(group_by_position(session, EXERCISES))
    assert got[0] == "joint-mobilising-sequence"
    assert got[-1] == "cool-down-stretch-sequence"


def test_relative_order_inside_a_band_is_preserved():
    """Balance before strength must survive the regroup."""
    session = picks(
        "joint-mobilising-sequence",
        "one-leg-stand",       # standing balance
        "floor-bridge",        # floor
        "bodyweight-squat",    # standing strength
        "heel-raises",         # standing strength
    )
    got = slugs(group_by_position(session, EXERCISES))
    assert got.index("one-leg-stand") < got.index("bodyweight-squat") < got.index("heel-raises")


def test_already_grouped_session_is_left_alone():
    session = picks(
        "joint-mobilising-sequence",
        "one-leg-stand",
        "bodyweight-squat",
        "floor-bridge",
        "bird-dog",
        "cool-down-stretch-sequence",
    )
    assert slugs(group_by_position(session, EXERCISES)) == slugs(session)


def test_short_sessions_are_never_touched():
    for n in range(0, 4):
        session = picks(*["floor-bridge", "bodyweight-squat", "bird-dog"][:n])
        assert slugs(group_by_position(session, EXERCISES)) == slugs(session)


# ── it must never be the reason an exercise disappears ───────────────────────

def test_unknown_slugs_survive_intact():
    session = picks("joint-mobilising-sequence", "not-a-real-exercise", "floor-bridge", "bodyweight-squat")
    got = slugs(group_by_position(session, EXERCISES))
    assert set(got) == set(slugs(session))
    assert len(got) == len(session)


def test_empty_catalogue_returns_input_unchanged():
    session = picks("floor-bridge", "bodyweight-squat", "bird-dog", "heel-raises")
    assert slugs(group_by_position(session, [])) == slugs(session)


def test_any_position_never_forces_a_transition():
    """`floor-get-up` is any_position — it must not split the floor block."""
    session = picks(
        "joint-mobilising-sequence",
        "bodyweight-squat",
        "floor-bridge",
        "floor-get-up",
        "bird-dog",
    )
    got = slugs(group_by_position(session, EXERCISES))
    assert got.index("floor-bridge") < got.index("floor-get-up") < got.index("bird-dog"), got


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
