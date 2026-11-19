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


# One card for every place and cuisine a full guide covers.
PLACES = [
    "At a restaurant",
    "North Indian",
    "South Indian",
    "Chinese and Asian",
    "Italian and continental",
    "At a cafe",
    "Street food and chaat",
    "Sweets and desserts",
    "Drinks",
    "At a hotel buffet",
    "Travelling",
    "At a wedding or party",
    "Ordering in",
]


def card(where, choose=("Dal and a cooked vegetable",), skip=("Anything deep fried",)):
    return EatingOutSituation(where=where, choose=list(choose), skip=list(skip))


def full(first=None):
    """Every standard card; `first` replaces the restaurant card."""
    return [first or card(PLACES[0])] + [card(w) for w in PLACES[1:]]


def guide(**over):
    base = dict(
        rules=["Start with the vegetables"],
        situations=full(),
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
    assert [f.field for f in check(plan([empty]))] == ["situations"]
    assert sev(check(plan([guide(situations=[])]))) == ["CRITICAL"]


def test_a_situation_needs_its_heading():
    g = guide(situations=full() + [EatingOutSituation(where=" ", choose=["Dal and rice"])])
    got = check(plan([g]))
    assert [f.field for f in got if f.severity == "CRITICAL"] == ["where"]


# ── comprehensive enough that she does not ask about every dish ────────────


def test_a_thin_guide_is_refused_while_the_plan_is_being_written():
    thin = guide(situations=full()[:5])
    got = [f for f in check(plan([thin])) if f.field == "coverage"]
    assert "CRITICAL" in sev(got)
    assert "only 5 place(s)" in got[0].detail
    # On a published plan it is a prompt, never a failure.
    assert "CRITICAL" not in sev(check(plan([thin], status="published")))


def test_missing_cuisines_are_named_for_the_coach_to_add_or_wave_through():
    most = guide(situations=[s for s in full() if s.where not in ("Italian and continental", "Drinks")])
    got = check(plan([most]))
    assert sev(got) == ["WARNING"]
    assert "Italian or continental" in got[0].detail and "drinks" in got[0].detail
    assert "North Indian" not in got[0].detail


def test_a_card_can_be_found_by_its_keywords_as_well_as_its_heading():
    cards = [s for s in full() if s.where != "South Indian"]
    cards.append(EatingOutSituation(where="Breakfast places", keywords=["dosa", "idli"], choose=["Idli with sambar"]))
    assert check(plan([guide(situations=cards)])) == []


def test_a_declared_allergy_is_never_something_to_choose():
    g = guide(situations=full(card("At a restaurant", choose=["Mushroom soup to start"])))
    got = check(plan([g]), client(known_allergies=["Mushrooms, yeast"]))
    assert sev(got) == ["CRITICAL"]
    assert "allergy" in got[0].detail and "mushroom" in got[0].detail
    # Naming it under skip is the point of a skip line.
    ok = guide(situations=full(card("At a restaurant", skip=["Anything with mushrooms"])))
    assert check(plan([ok]), client(known_allergies=["Mushrooms, yeast"])) == []


def test_a_food_the_client_avoids_is_flagged_but_not_refused():
    g = guide(situations=full(card("At a restaurant", choose=["Dal with rice"])))
    got = check(plan([g]), client(foods_to_avoid="Brinjal, Rice, Wheat"))
    assert sev(got) == ["WARNING"]
    assert "'rice'" in got[0].detail
    # 'price' and 'licorice' are not rice.
    fine = guide(situations=full(card("At a restaurant", choose=["The set meal at a fair price"])))
    assert check(plan([fine]), client(foods_to_avoid="Rice")) == []


def test_leaving_a_food_out_is_not_recommending_it():
    g = guide(situations=full(card("At a restaurant", choose=["A bean bowl, without the rice", "Take the dal and leave the rice"])))
    assert check(plan([g]), client(foods_to_avoid="Rice")) == []


def test_a_vegetarians_guide_must_say_no_to_meat_somewhere():
    # No skip line names meat: "can I have the butter chicken" would find
    # nothing in the guide and wait for the coach.
    got = check(plan([guide()]), client(dietary_preference="vegetarian"))
    assert sev(got) == ["WARNING"] and "names meat or fish" in got[0].detail
    named = guide(situations=full(card("At a restaurant", skip=["Chicken, mutton and fish — your plan has no meat"])))
    assert check(plan([named]), client(dietary_preference="vegetarian")) == []
    # Someone who eats meat needs no such line.
    assert check(plan([guide()]), client(dietary_preference="non-vegetarian")) == []


def test_a_client_who_reported_no_allergies_raises_nothing():
    assert check(plan([guide()]), client(known_allergies=["none"])) == []


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
    g = guide(situations=full(card("At a restaurant", choose=["Grilled chicken with vegetables"])))
    got = check(plan([g]), client(dietary_preference="vegetarian"))
    crit = [f for f in got if f.severity == "CRITICAL"]
    assert len(crit) == 1 and "chicken" in crit[0].detail
    # The same line is fine for someone who eats it.
    assert check(plan([g]), client(dietary_preference="non-vegetarian")) == []


def test_meat_in_the_rules_or_the_fallback_line_is_caught_too():
    veg = client(dietary_preference="vegetarian")
    assert "CRITICAL" in sev(check(plan([guide(rules=["Fish or eggs over anything fried"])]), veg))
    assert "CRITICAL" in sev(check(plan([guide(not_on_list="Have the tandoori chicken instead.")]), veg))


def test_naming_meat_as_something_to_skip_is_not_a_finding():
    g = guide(situations=full(card("At a restaurant", choose=["Dal and rice"], skip=["Chicken, mutton and fish"])))
    assert check(plan([g]), client(dietary_preference="vegetarian")) == []


def test_a_client_with_a_milk_allergy_is_never_told_to_choose_paneer():
    g = guide(situations=full(card("At a restaurant", choose=["Paneer tikka and a salad"])))
    allergic = client(known_allergies=["Milk"])
    got = check(plan([g]), allergic)
    assert sev(got) == ["CRITICAL"]
    assert "dairy" in got[0].detail
    # No dairy reaction on the record: paneer is an ordinary choice.
    assert check(plan([g]), client()) == []


def test_lactose_intolerance_is_a_warning_not_a_refusal():
    g = guide(situations=full(card("At a restaurant", choose=["A glass of milk with the meal"])))
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
