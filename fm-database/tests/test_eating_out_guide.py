"""The eating-out guide is part of the plan.

The client app answers "I'm at a restaurant, what do I order" straight from
`plan.eating_out`, with nobody in between. So a plan being written cannot be
submitted without one, and a guide can never tell a client to choose a food
they do not eat. These tests are that bar.
"""

from datetime import date, datetime

from fmdb.plan.checker import Finding, _check_eating_out
from fmdb.plan.models import (
    CatalogueSnapshot,
    Client,
    EatingOutGuide,
    EatingOutSituation,
    Plan,
)

BASE = dict(
    client_id="cl-t",
    display_name="T",
    intake_date=date(2026, 1, 1),
    sex="F",
    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
    updated_by="test",
)


def client(**over):
    return Client(**{**BASE, **over})


def guide(**over):
    base = dict(
        rules=["Start with the vegetables"],
        situations=[
            EatingOutSituation(
                where="At a restaurant",
                choose=["Dal, sabzi, and rice or jowar roti"],
                skip=["Naan and cream gravies"],
            )
        ],
        not_on_list="Choose the plainest cooked dish and tell your coach afterwards.",
    )
    return EatingOutGuide(**{**base, **over})


def plan(guides=(), status="draft", weeks=12):
    return Plan(
        slug="p",
        client_id="cl-t",
        status=status,
        eating_out=list(guides),
        plan_period_start=date(2026, 1, 1),
        plan_period_weeks=weeks,
        plan_period_recheck_date=date(2026, 3, 26),
        catalogue_snapshot=CatalogueSnapshot(snapshot_date=date(2026, 1, 1)),
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        updated_by="test",
    )


def check(p, c=None):
    out: list[Finding] = []
    _check_eating_out(p, c, out)
    return out


def sev(findings):
    return sorted(f.severity for f in findings)


# ── the guide must exist ────────────────────────────────────────────────────


def test_a_plan_being_written_without_a_guide_is_refused():
    for status in ("draft", "ready_to_publish"):
        got = check(plan(status=status))
        assert sev(got) == ["CRITICAL"], status
        assert "eating-out guide" in got[0].detail


def test_a_plan_published_before_guides_existed_is_only_told():
    # It must not suddenly fail: published plans are frozen, and the fix is an
    # amendment, not a new plan.
    got = check(plan(status="published"))
    assert sev(got) == ["INFO"]
    assert "set-eating-out-guide.py" in got[0].detail


def test_a_complete_guide_passes():
    assert check(plan([guide()]), client()) == []


def test_a_guide_with_nothing_to_choose_is_refused():
    empty = guide(situations=[EatingOutSituation(where="At a restaurant", skip=["Naan"])])
    assert sev(check(plan([empty]))) == ["CRITICAL"]
    assert sev(check(plan([guide(situations=[])]))) == ["CRITICAL"]


def test_a_situation_needs_its_heading():
    g = guide(situations=[EatingOutSituation(where=" ", choose=["Dal and rice"])])
    assert "CRITICAL" in sev(check(plan([g])))


# ── the whole plan, or sections of it ──────────────────────────────────────


def test_guides_for_sections_of_the_plan_must_cover_every_week():
    remove = guide(label="Remove", from_week=1, to_week=4)
    repair = guide(label="Repair", from_week=5, to_week=12)
    assert check(plan([remove, repair])) == []
    got = check(plan([remove]))
    assert sev(got) == ["WARNING"]
    assert "5, 6, 7, 8, 9, 10, 11, 12" in got[0].detail


def test_a_whole_plan_guide_covers_the_gaps():
    remove = guide(label="Remove", from_week=1, to_week=4)
    assert check(plan([remove, guide()])) == []


def test_weeks_that_do_not_fit_the_plan_are_refused():
    assert "CRITICAL" in sev(check(plan([guide(from_week=10, to_week=14)])))
    assert "CRITICAL" in sev(check(plan([guide(from_week=6, to_week=3)])))


def test_overlapping_sections_are_flagged():
    a = guide(label="A", from_week=1, to_week=6)
    b = guide(label="B", from_week=5, to_week=12)
    got = check(plan([a, b]))
    assert sev(got) == ["WARNING"]
    assert "5, 6" in got[0].detail


# ── safe for THIS client ───────────────────────────────────────────────────


def test_a_vegetarian_is_never_told_to_choose_meat():
    g = guide(situations=[EatingOutSituation(where="At a restaurant", choose=["Grilled chicken with vegetables"])])
    got = check(plan([g]), client(dietary_preference="vegetarian"))
    assert sev(got) == ["CRITICAL"]
    assert "chicken" in got[0].detail
    # The same line is fine for someone who eats it.
    assert check(plan([g]), client(dietary_preference="non-vegetarian")) == []


def test_meat_in_the_rules_or_the_fallback_line_is_caught_too():
    veg = client(dietary_preference="vegetarian")
    assert "CRITICAL" in sev(check(plan([guide(rules=["Fish or eggs over anything fried"])]), veg))
    assert "CRITICAL" in sev(check(plan([guide(not_on_list="Have the tandoori chicken instead.")]), veg))


def test_naming_meat_as_something_to_skip_is_not_a_finding():
    g = guide(situations=[EatingOutSituation(where="At a restaurant", choose=["Dal and rice"], skip=["Chicken, mutton and fish"])])
    assert check(plan([g]), client(dietary_preference="vegetarian")) == []


def test_a_client_with_a_milk_allergy_is_never_told_to_choose_paneer():
    g = guide(situations=[EatingOutSituation(where="At a restaurant", choose=["Paneer tikka and a salad"])])
    allergic = client(known_allergies=["Milk"])
    got = check(plan([g]), allergic)
    assert sev(got) == ["CRITICAL"]
    assert "dairy" in got[0].detail
    # No dairy reaction on the record: paneer is an ordinary choice.
    assert check(plan([g]), client()) == []


def test_lactose_intolerance_is_a_warning_not_a_refusal():
    g = guide(situations=[EatingOutSituation(where="At a restaurant", choose=["A glass of milk with the meal"])])
    got = check(plan([g]), client(dairy_reaction_type="lactose_intolerance"))
    assert sev(got) == ["WARNING"]


# ── the model ──────────────────────────────────────────────────────────────


def test_existing_plans_load_unchanged():
    assert plan().eating_out == []


def test_a_typo_in_the_guide_fails_loudly():
    # extra="forbid": a misspelt key must not silently vanish from a guide the
    # client reads.
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        EatingOutGuide(rules=["x"], situaitons=[])
    with pytest.raises(ValidationError):
        EatingOutSituation(where="At a restaurant", chose=["Dal"])
