"""active_conditions dedup on intake submit, as failable tests.

Three clients were found on 2026-08-23 carrying the same diagnosis twice:

    cl-023 + nidhi-jain   "Diabetes"  alongside
                          "Type 2 diabetes / insulin resistance"
    cl-011                "Anxiety"   alongside
                          "Anxiety + Depression (on long-term SSRI + benzo, 20 yrs)"
                          plus two more entries keyed identically to the third

The D2 dedup (2026-05-23) keys on the exact canonical token SET, which catches
word-order variants and nothing else — subsets went straight through, and
identical keys already on disk were never revisited because the merge only
filtered INCOMING against existing.

The tests that matter most here are the ones guarding the DIRECTION of the
collapse. `_derive_conditions_from_intake` writes moderate-confidence findings
as "Suspected: …", so a rule of "keep the longer entry" would delete a
confirmed diagnosis in favour of a hedged restatement of it. nidhi-jain
carries a "Suspected: PCOS" today, so that is a live record, not a thought
experiment.

Run: python -m pytest tests/test_intake_condition_dedup.py   (from fm-database/)
"""

import importlib.util
from pathlib import Path

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


M = _load()


# ── the three real records ───────────────────────────────────────────────────

def test_cl023_diabetes_subset_collapses_into_the_specific_entry():
    kept, dropped = M._collapse_condition_subsets(
        ["Type 2 diabetes / insulin resistance", "Hypertension", "Diabetes", "Obesity"]
    )
    assert dropped == ["Diabetes"]
    assert kept == ["Type 2 diabetes / insulin resistance", "Hypertension", "Obesity"]


def test_cl011_four_anxiety_entries_collapse_to_the_richest_one():
    kept, dropped = M._collapse_condition_subsets([
        "Anxiety + Depression (on long-term SSRI + benzo, 20 yrs)",
        "Mood Swings",
        "Anxiety",
        "Depression / anxiety (on treatment)",
        "Anxiety/Depression (on treatment)",
    ])
    assert kept == ["Anxiety + Depression (on long-term SSRI + benzo, 20 yrs)", "Mood Swings"]
    assert len(dropped) == 3
    # The surviving entry is the one carrying the medication detail.
    assert "SSRI" in kept[0]


# ── direction: a hedge must never delete a confirmed diagnosis ───────────────

def test_suspected_variant_never_replaces_the_confirmed_diagnosis():
    """The certainty-downgrade trap. {pcos} is a proper subset of
    {pcos, suspected}, so a naive keep-the-longer rule deletes the confirmed
    PCOS. The extra token is a hedge, so the SHORTER entry must win."""
    kept, dropped = M._collapse_condition_subsets(["PCOS", "Suspected: PCOS"])
    assert kept == ["PCOS"]
    assert dropped == ["Suspected: PCOS"]


def test_suspected_survives_when_nothing_confirms_it():
    kept, dropped = M._collapse_condition_subsets(["Suspected: PCOS", "Hypertension"])
    assert dropped == []
    assert kept == ["Suspected: PCOS", "Hypertension"]


def test_confirmed_diagnosis_arriving_later_upgrades_the_hedged_one():
    kept, _ = M._collapse_condition_subsets(["Suspected: PCOS", "PCOS"])
    assert kept == ["PCOS"]


# ── things that must NOT collapse ────────────────────────────────────────────

def test_distinct_conditions_are_left_alone():
    entries = ["Hypertension", "Obesity", "Perimenopausal", "Restless legs"]
    kept, dropped = M._collapse_condition_subsets(entries)
    assert dropped == []
    assert kept == entries


def test_the_split_shape_applied_to_cl023_is_stable():
    """The record was repaired by splitting the compound entry into its two
    real catalogue topics. That shape must not now collapse into itself."""
    entries = ["Type 2 diabetes", "Insulin resistance", "Hypertension", "Obesity"]
    kept, dropped = M._collapse_condition_subsets(entries)
    assert dropped == []
    assert kept == entries


def test_entries_that_canonicalise_to_nothing_do_not_eat_the_list():
    """An empty token set is a subset of every other set."""
    kept, _ = M._collapse_condition_subsets(["(on treatment)", "Hypertension"])
    assert "Hypertension" in kept


# ── the merge wiring ─────────────────────────────────────────────────────────

def test_merge_collapses_the_union_so_a_dirty_record_self_heals():
    """Nothing new incoming, but the existing list is already dirty — the
    merge must still report changed=True so the caller persists the repair."""
    merged, changed = M._merge_lists(
        ["Type 2 diabetes / insulin resistance", "Diabetes"], [], semantic_dedup=True
    )
    assert changed is True
    assert merged == ["Type 2 diabetes / insulin resistance"]


def test_merge_rejects_a_subset_arriving_from_the_form():
    merged, _ = M._merge_lists(
        ["Type 2 diabetes / insulin resistance"], ["Diabetes"], semantic_dedup=True
    )
    assert merged == ["Type 2 diabetes / insulin resistance"]


def test_semantic_dedup_stays_off_for_other_list_fields():
    """Supplements must keep strict dedup — "vitamin D" and "vitamin D3" are
    different products and {vitamin, d} is a subset of {vitamin, d3}."""
    merged, _ = M._merge_lists(["vitamin D"], ["vitamin D3"], semantic_dedup=False)
    assert merged == ["vitamin D", "vitamin D3"]


# ── medical_history (wired 2026-08-23) ───────────────────────────────────────

def test_medical_history_is_wired_for_semantic_dedup():
    assert "medical_history" in M._SEMANTIC_DEDUP_FIELDS
    assert "active_conditions" in M._SEMANTIC_DEDUP_FIELDS


def test_medication_and_allergy_lists_keep_strict_dedup():
    """These hold products, not diagnoses. {vitamin,d} is a subset of
    {vitamin,d3} and collapsing it would delete a real item."""
    for field in ("current_medications", "current_supplements", "known_allergies", "goals"):
        assert field not in M._SEMANTIC_DEDUP_FIELDS


def test_resolved_stamp_survives_against_a_bare_restatement():
    """condition-status.ts appends "— resolved <Mon YYYY>" when a condition is
    retired. "resolved" is not a hedge token, so the stamped entry is the more
    specific one and must win — losing it would lose the resolution date."""
    kept, dropped = M._collapse_condition_subsets(
        ["Constipation", "Constipation — resolved Jul 2026"]
    )
    assert kept == ["Constipation — resolved Jul 2026"]
    assert dropped == ["Constipation"]


def test_repeat_events_in_different_years_stay_separate():
    entries = ["Dengue 2019", "Dengue 2021"]
    kept, dropped = M._collapse_condition_subsets(entries)
    assert dropped == []
    assert kept == entries


def test_a_bare_event_collapses_into_its_dated_occurrences():
    kept, _ = M._collapse_condition_subsets(["C-section", "C-section 2008", "C-section 2011"])
    assert kept == ["C-section 2008", "C-section 2011"]


def test_real_roster_medical_history_is_untouched():
    """Every medical_history entry on the roster today is distinct. If this
    ever fails, a real record is about to lose an entry — look before shipping."""
    entries = [
        "Perimenopause onset 2023",
        "PCOS diagnosed (prior)",
        "Recurrent COVID infections",
        "Glycomet — STOPPED (statin/BP/diabetes) [client-reported at intake]",
    ]
    kept, dropped = M._collapse_condition_subsets(entries)
    assert dropped == []
    assert kept == entries
