"""`coach_priority: high` — the coach's "put this on clients' menus" flag.

Three surfaces read it (recipe_select.py scoring, the weekly menu drafter's
rule 18 via catalogue_dishes.py, and recipe-picker.ts). These tests pin the
Python half: the boost, who gets the larger push, who gets none, and the caps
that stop a shortlist turning into a list of nothing but priority dishes.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "fm-database-web" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import catalogue_dishes  # noqa: E402
import recipe_select as R  # noqa: E402
from recipe_schema import check_recipe  # noqa: E402


def _recipe(slug: str, priority: bool, meal=("lunch",)) -> dict:
    r = {"slug": slug, "name": slug.replace("-", " "), "meal_type": list(meal),
         "diet": ["vegetarian", "vegan"], "seasons": ["all"], "one_line": "x",
         "ingredients": [{"item": "moong sprouts", "qty": "1", "unit": "cup"}]}
    if priority:
        r["coach_priority"] = "high"
    return r


def _library() -> list[dict]:
    """30 priority + 30 ordinary recipes, spread evenly over the meal types."""
    return ([_recipe(f"p{i}", True, meal=(R.MEAL_TYPES[i % 6],)) for i in range(30)]
            + [_recipe(f"n{i}", False, meal=(R.MEAL_TYPES[i % 6],)) for i in range(30)])


def test_boost_is_larger_for_vegetarian_leaning_clients():
    r = _recipe("a", True)
    base = R.COACH_PRIORITY_BOOST
    assert R.coach_priority_boost(r, "Non-vegetarian") == base
    assert R.coach_priority_boost(r, "") == base
    for dp in ("Vegetarian", "vegan", "Eggetarian"):
        assert R.coach_priority_boost(r, dp) == base + R.COACH_PRIORITY_VEG_BONUS


def test_non_vegetarian_is_not_read_as_vegetarian():
    # "non-vegetarian" contains "veg" — the trap diet_ok already steps around
    assert R.veg_leaning("Non-vegetarian") is False
    assert R.veg_leaning("non veg") is False
    assert R.veg_leaning("Vegetarian") is True


def test_jain_clients_get_the_push_but_only_for_dishes_they_can_eat():
    # coach decision 2026-11-20: Jain clients are included, as vegetarian-leaning
    assert (R.coach_priority_boost(_recipe("a", True), "Vegetarian Jain")
            == R.COACH_PRIORITY_BOOST + R.COACH_PRIORITY_VEG_BONUS)
    jain = catalogue_dishes.priority_dish_names("Vegetarian Jain")
    everyone = catalogue_dishes.priority_dish_names("Vegetarian")
    assert jain, "a Jain client should be offered some priority dishes"
    assert set(jain) < set(everyone)
    # the drafter is told to PREFER this list, so nothing on it may carry
    # onion, garlic or a root vegetable
    by_name = {r["name"]: r for r in R.load_recipes()}
    for name in jain:
        assert R.diet_ok(by_name[name], "vegetarian jain"), name
    assert "Tadka moong with coconut" not in jain      # has onion


def test_unflagged_recipe_gets_nothing():
    assert R.coach_priority_boost(_recipe("a", False), "Vegetarian") == 0.0


@pytest.mark.parametrize("dp,share", [
    ("Vegetarian", R.COACH_PRIORITY_TOTAL_SHARE_VEG),
    ("Non-vegetarian", R.COACH_PRIORITY_TOTAL_SHARE_OTHER),
])
def test_priority_dishes_cannot_take_over_the_shortlist(dp, share):
    import math
    recipes = _library()
    chosen = R.select_recipes(recipes, {"dietary_preference": dp}, {}, total=20)
    prio = [r for _s, r in chosen if R.is_coach_priority(r)]
    assert len(chosen) == 20
    assert 1 <= len(prio) <= math.ceil(20 * share)
    # ...and they do rank first: the top of the shortlist is a priority dish
    assert R.is_coach_priority(chosen[0][1])


def test_vegetarian_clients_see_more_priority_dishes_than_others():
    recipes = _library()
    count = lambda dp: sum(  # noqa: E731
        R.is_coach_priority(r)
        for _s, r in R.select_recipes(recipes, {"dietary_preference": dp}, {}, total=20))
    assert count("Vegetarian") > count("Non-vegetarian")


def test_schema_rejects_a_misspelt_priority():
    good = _recipe("a", True)
    errs, _ = check_recipe(good, "a.yaml")
    assert not errs
    bad = dict(good, coach_priority="hi")
    errs, _ = check_recipe(bad, "a.yaml")
    assert any("coach_priority" in e for e in errs)


def test_the_library_has_priority_dishes_and_the_drafter_can_see_them():
    names = catalogue_dishes.priority_dish_names("Vegetarian")
    assert len(names) >= 50
    # every priority title is also in the drafter's catalogue list (rule 13
    # tells it to name dishes from that list, so a priority title outside it
    # would be a name it is told to prefer and forbidden to use)
    assert set(names) <= set(catalogue_dishes.catalogue_dish_names("Vegetarian"))
    # the sprouting METHODS are how-tos, not dishes to push onto menus
    assert not any(n.lower().startswith("home-sprouted") for n in names)
