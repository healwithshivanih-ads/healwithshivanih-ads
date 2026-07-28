"""The bug this module exists to prevent, as a failing-if-broken test.

A standing glaucoma screen on `legs-up-the-wall` was reported as a doubt about
a client whose intake had already recorded `eye_signs: []`. Absence of evidence
was treated as evidence of risk. These tests pin the three-way split so that
cannot recur.

Run: python -m tests.test_contra_screen
"""

from fmdb.plan.contra_screen import screen

LEGS_UP = {
    "slug": "legs-up-the-wall",
    "contraindications": [
        "Glaucoma or raised intraocular pressure",
        "Uncontrolled hypertension",
        "Late pregnancy — use a side-lying position instead",
        "Any acute leg swelling with pain, redness or warmth — exclude DVT before elevating",
    ],
}

# Hariharan, as actually recorded: hypertension on Telma 40, eye_signs asked and empty.
HARIHARAN = {
    "active_conditions": ["Anxiety", "Hypertension", "Sleeplessness", "Constipation"],
    "current_medications": ["Telma 40"],
    "eye_signs": [],
    "sex": "M",
}


def test_recorded_condition_is_live():
    s = screen(LEGS_UP, HARIHARAN)
    assert any(c.category == "hypertension" for c in s.live), s.live
    assert s.blocked


def test_asked_and_negative_is_cleared_not_unknown():
    """The actual bug: eye_signs was asked and empty, so glaucoma is CLEARED."""
    s = screen(LEGS_UP, HARIHARAN)
    assert any(c.category == "glaucoma" for c in s.cleared), s.cleared
    assert not any(c.category == "glaucoma" for c in s.unknown), "glaucoma must not read as unknown"
    assert not any(c.category == "glaucoma" for c in s.live)


def test_never_asked_is_unknown_not_cleared():
    """A client whose record has no eye field at all — genuinely unknown."""
    no_eye_field = {k: v for k, v in HARIHARAN.items() if k != "eye_signs"}
    no_eye_field.pop("active_conditions")
    no_eye_field.pop("medical_history", None)
    s = screen(LEGS_UP, no_eye_field)
    assert any(c.category == "glaucoma" for c in s.unknown), s.unknown
    assert not any(c.category == "glaucoma" for c in s.cleared)


def test_clean_client_is_not_blocked():
    clean = {"active_conditions": ["Bloating"], "current_medications": [],
             "eye_signs": [], "sex": "F", "pregnancy_status": "not_pregnant"}
    s = screen(LEGS_UP, clean)
    assert not s.blocked, s.live


def test_uncategorised_caution_becomes_unknown_not_dropped():
    p = {"slug": "x", "contraindications": ["Do not attempt during a solar eclipse"]}
    s = screen(p, HARIHARAN)
    assert len(s.unknown) == 1 and s.unknown[0].category == "uncategorised"


def test_every_caution_lands_in_exactly_one_bucket():
    s = screen(LEGS_UP, HARIHARAN)
    assert len(s.live) + len(s.cleared) + len(s.unknown) == len(LEGS_UP["contraindications"])


def test_summary_reads_honestly_when_clear():
    clean = {"active_conditions": [], "current_medications": [], "eye_signs": [],
             "sex": "M", "pregnancy_status": "n/a", "pain_locations": []}
    s = screen({"slug": "x", "contraindications": ["Glaucoma or raised intraocular pressure"]}, clean)
    assert "clear" in s.summary().lower()


if __name__ == "__main__":
    import sys
    import traceback

    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception:
            failures += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
