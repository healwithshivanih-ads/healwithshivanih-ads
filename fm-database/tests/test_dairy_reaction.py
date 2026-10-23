"""Milk-protein allergy vs lactose intolerance (2026-10-23), as failable tests.

Three halves:
  1. the intake allowlist (`_DAIRY_SCALAR_FIELDS` / `_DAIRY_LIST_FIELDS` in
     intake-token-action.py) matches the Pydantic Client model and the key sets
     in fmdb.plan.dairy — a field missing from the allowlist is SILENTLY
     dropped at submit, the failure mode this form has hit before;
  2. the derivation (curd / paneer / ghee + symptoms → type);
  3. the consumers' behaviour — recipe filter, prompt line, allergen list.

Run: python -m pytest tests/test_dairy_reaction.py   (from fm-database/)
"""

import importlib.util
import sys
from pathlib import Path

from fmdb.plan import dairy
from fmdb.plan.models import Client

_WEB = Path(__file__).resolve().parents[2] / "fm-database-web"
_SCRIPT = _WEB / "scripts" / "intake-token-action.py"


def _load():
    spec = importlib.util.spec_from_file_location("intake_token_action", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


# ── 1. allowlist ↔ model ↔ key sets ─────────────────────────────────────────

def test_allowlist_covers_every_raw_answer_and_the_model_has_them():
    mod = _load()
    allowed = set(mod._DAIRY_SCALAR_FIELDS) | set(mod._DAIRY_LIST_FIELDS)
    assert allowed == set(dairy.RAW_FIELDS), "intake allowlist drifted from fmdb.plan.dairy.RAW_FIELDS"
    model = set(Client.model_fields)
    for f in (*dairy.RAW_FIELDS, "dairy_reaction_type", "dairy_reaction_source"):
        assert f in model, f"Client model is missing {f} (extra='forbid' → load fails)"


def test_the_derived_type_is_not_client_writable():
    mod = _load()
    every_allowlisted = (
        set(mod._SCALAR_FIELDS) | set(mod._LIST_FIELDS) | set(mod._INTAKE_LIST_FIELDS)
        | set(mod._DAIRY_SCALAR_FIELDS) | set(mod._DAIRY_LIST_FIELDS)
    )
    assert "dairy_reaction_type" not in every_allowlisted
    assert "dairy_reaction_source" not in every_allowlisted


def test_allowlist_value_sets_are_the_dairy_module_keys():
    mod = _load()
    assert mod._DAIRY_LIST_FIELDS["dairy_reaction_symptoms"] == dairy.SYMPTOM_KEYS
    assert mod._DAIRY_SCALAR_FIELDS["dairy_reaction_timing"] == dairy.TIMING_KEYS
    for f in ("tolerates_curd", "tolerates_paneer", "tolerates_ghee"):
        assert mod._DAIRY_SCALAR_FIELDS[f] == dairy.TOLERANCE_KEYS


def test_apply_writes_answers_derives_type_and_validates_as_client():
    mod = _load()
    data = {"client_id": "cl-x", "known_allergies": ["Milk"],
            "intake_date": "2026-01-01", "created_at": "2026-01-01",
            "updated_at": "2026-01-01", "updated_by": "test", "sex": "F"}
    changed = mod._apply_dairy_answers(data, {
        "dairy_reaction_symptoms": ["loose_stools", "bloating_gas", "made_up"],
        "dairy_reaction_timing": "within_2_hours",
        "tolerates_curd": "yes", "tolerates_paneer": "yes", "tolerates_ghee": "bogus",
    })
    assert data["dairy_reaction_symptoms"] == ["bloating_gas", "loose_stools"]
    assert "tolerates_ghee" not in data
    assert data["dairy_reaction_type"] == "lactose_intolerance"
    assert data["dairy_reaction_source"] == "intake"
    assert "dairy_reaction_type" in changed
    Client(**data)   # round-trips under extra="forbid"


def test_blank_resubmit_clears_answers_and_type():
    mod = _load()
    data = {"dairy_reaction_symptoms": ["hives_rash"], "tolerates_curd": "no",
            "dairy_reaction_type": "milk_protein_allergy", "dairy_reaction_source": "intake"}
    mod._apply_dairy_answers(data, {f: ([] if f == "dairy_reaction_symptoms" else "")
                                    for f in dairy.RAW_FIELDS})
    assert not any(k.startswith(("dairy_", "tolerates_")) for k in data)


def test_coach_set_type_survives_a_resubmit():
    mod = _load()
    data = {"dairy_reaction_type": "lactose_intolerance", "dairy_reaction_source": "coach"}
    mod._apply_dairy_answers(data, {"dairy_reaction_symptoms": ["hives_rash"]})
    assert data["dairy_reaction_type"] == "lactose_intolerance"
    assert data["dairy_reaction_symptoms"] == ["hives_rash"]


def test_a_payload_without_the_section_changes_nothing():
    mod = _load()
    data = {"dairy_reaction_type": "unsure", "dairy_reaction_source": "intake"}
    assert mod._apply_dairy_answers(data, {"sex": "F"}) == []
    assert data["dairy_reaction_type"] == "unsure"


# ── 2. derivation ───────────────────────────────────────────────────────────

D = dairy.derive_dairy_reaction_type


def test_nothing_answered_is_none():
    assert D([], "", "", "", "") is None
    assert D(None) is None


def test_any_allergy_sign_wins_even_if_curd_is_fine():
    assert D(["bloating_gas", "hives_rash"], None, "yes", "yes", "yes") == "milk_protein_allergy"
    assert D(["wheezing_breathless"]) == "milk_protein_allergy"


def test_gut_only_and_curd_fine_is_lactose_intolerance():
    assert D(["bloating_gas", "loose_stools"], "within_2_hours", "yes", "unsure", "yes") == "lactose_intolerance"
    assert D(["stomach_cramps"], None, "no", "yes", None) == "lactose_intolerance"   # curd carries lactose, paneer barely


def test_reacting_to_curd_and_paneer_or_ghee_is_a_protein_reaction():
    assert D(["bloating_gas"], None, "no", "no", "yes") == "milk_protein_allergy"
    assert D(["bloating_gas"], None, "yes", "yes", "no") == "milk_protein_allergy"


def test_gut_only_with_no_tolerance_evidence_is_unsure():
    assert D(["bloating_gas"], "within_2_hours", "unsure", "unsure", "unsure") == "unsure"
    assert D(["bloating_gas"], None, "yes", "no", None) == "unsure"   # contradictory


# ── 3. consumers ────────────────────────────────────────────────────────────

LACTOSE = {"known_allergies": ["Milk"], "dairy_reaction_type": "lactose_intolerance"}
ALLERGY = {"known_allergies": ["Milk"], "dairy_reaction_type": "milk_protein_allergy"}
ALLERGY_GHEE_OK = {**ALLERGY, "tolerates_ghee": "yes"}
CL906_SHAPE = {"known_allergies": ["Milk"], "foods_to_avoid": "Milk & mushroom causes allergy"}


def test_resolve_infers_unsure_from_a_dairy_word_with_no_type():
    d = dairy.resolve_dairy(CL906_SHAPE)
    assert d == {"kind": "unsure", "source": "inferred", "ghee_ok": True}
    assert dairy.resolve_dairy({"foods_to_avoid": "coconut milk is fine; brinjal"}) is None
    assert dairy.resolve_dairy({"known_allergies": ["Peanuts"]}) is None


def test_allergen_list_drops_milk_for_lactose_and_adds_dairy_tag_for_allergy():
    assert dairy.allergen_items_for_matching(["Milk", "Peanuts"], dairy.resolve_dairy(LACTOSE)) == ["Peanuts"]
    assert "dairy" in dairy.allergen_items_for_matching(["Milk"], dairy.resolve_dairy(ALLERGY))


def test_recipe_filter_lactose_keeps_curd_paneer_ghee_drops_milk():
    d = dairy.resolve_dairy(LACTOSE)
    tagged = {"contains_allergens": ["dairy"]}
    assert dairy.recipe_dairy_ok(tagged, "paneer, tomato, ghee", d)
    assert dairy.recipe_dairy_ok(tagged, "curd, cucumber", d)
    assert dairy.recipe_dairy_ok(tagged, "lactose-free milk, oats", d)
    assert not dairy.recipe_dairy_ok(tagged, "full-fat milk, rice, jaggery", d)
    assert not dairy.recipe_dairy_ok(tagged, "khoa, sugar", d)


def test_recipe_filter_allergy_drops_all_milk_protein_and_ghee_unless_ok():
    d = dairy.resolve_dairy(ALLERGY)
    assert not dairy.recipe_dairy_ok({"contains_allergens": ["dairy"]}, "spinach", d)
    assert not dairy.recipe_dairy_ok({}, "lactose-free milk", d)
    assert not dairy.recipe_dairy_ok({}, "moong dal, 1 tsp ghee", d)
    assert dairy.recipe_dairy_ok({}, "moong dal, coconut milk, peanut butter", d)
    assert dairy.recipe_dairy_ok({}, "moong dal, 1 tsp ghee", dairy.resolve_dairy(ALLERGY_GHEE_OK))


def test_prompt_line_says_whey_isolate_ok_only_for_lactose():
    assert "whey ISOLATE are fine" in dairy.dairy_prompt_line(LACTOSE)
    assert "ABSOLUTE" in dairy.dairy_prompt_line(ALLERGY)
    assert "lactose-free" in dairy.dairy_prompt_line(ALLERGY)
    assert "never asked" in dairy.dairy_prompt_line(CL906_SHAPE)
    assert dairy.dairy_prompt_line({"known_allergies": ["Peanuts"]}) == ""


def test_allergy_prompt_line_carries_the_dairy_distinction():
    from fmdb.plan.allergies import allergy_prompt_line
    lac = allergy_prompt_line(LACTOSE)
    assert "Milk" not in lac.split("Dairy:")[0], "lactose-intolerant milk must leave the ABSOLUTE list"
    assert "LACTOSE INTOLERANCE" in lac
    assert "MILK-PROTEIN ALLERGY" in allergy_prompt_line(ALLERGY)


def test_recipe_select_serves_paneer_to_lactose_and_not_to_allergy():
    sys.path.insert(0, str(_WEB / "scripts"))
    import recipe_select as rs
    paneer = {"slug": "palak-paneer", "name": "Palak paneer", "diet": ["vegetarian"],
              "contains_allergens": ["dairy"], "meal_type": ["lunch"],
              "ingredients": [{"item": "paneer"}, {"item": "spinach"}]}
    kheer = {"slug": "kheer", "name": "Kheer", "diet": ["vegetarian"],
             "contains_allergens": ["dairy"], "meal_type": ["snack"],
             "ingredients": [{"item": "full-fat milk"}, {"item": "rice"}]}
    def picked(client):
        return {r["slug"] for _, r in rs.select_recipes([paneer, kheer], client, {})}
    assert picked(LACTOSE) == {"palak-paneer"}
    assert picked(ALLERGY) == set()
    assert picked(CL906_SHAPE) == set(), "an un-typed milk allergy must exclude dairy, not ignore it"
    assert picked({"known_allergies": ["Peanuts"]}) == {"palak-paneer", "kheer"}


# ── author gate: whey vs the dairy type ─────────────────────────────────────

def _gate(client, slugs):
    from fmdb.assess.author_gate import GateReport, _check_allergies
    rep = GateReport()
    _check_allergies(rep, {"supplement_suggestions": [{"supplement_slug": s} for s in slugs]},
                     None, client)
    return {f.target for f in rep.hard_failures}


def test_gate_blocks_whey_for_allergy_and_unsure_not_for_lactose():
    slugs = ["protein-whey-isolate", "milk-thistle", "magnesium-glycinate"]
    assert _gate(ALLERGY, slugs) == {"protein-whey-isolate"}
    assert _gate(CL906_SHAPE, slugs) == {"protein-whey-isolate"}
    assert _gate(LACTOSE, slugs) == set()


def test_gate_still_blocks_a_non_dairy_allergen_for_a_lactose_client():
    client = {**LACTOSE, "known_allergies": ["Milk", "Fish"]}
    assert _gate(client, ["fish-oil-epa-dha", "protein-whey-isolate"]) == {"fish-oil-epa-dha"}
