"""The Python allergy resolver, and its parity with the TypeScript mirror.

An empty `known_allergies` list used to read as "no allergies known" to every
consumer. Measured on the live roster 2026-08-03: 1 record of 21 was non-empty,
and its value was `['None']`. Two of the consumers are safety checks —
`author_gate._check_allergies`'s HARD allergen block and `recipe_select.is_safe`'s
allergen join — and both were passing everything by construction.

The TS side (`fm-database-web/src/lib/fmdb/allergies.ts`) serves the client app
and the meal-photo check; this side serves the assessment gate, the letter
generators and recipe selection. A client must not be allergy-screened on one
surface and not the other, so the cases below are duplicated in
`allergies.test.ts` — if you change one, change both.

Run: python -m tests.test_allergy_resolution
"""

from fmdb.plan.allergies import (
    NO_KNOWN_ALLERGIES,
    allergy_prompt_line,
    resolve_allergies,
)


def test_unknown_when_nobody_asked():
    for client in ({}, {"known_allergies": []}, {"known_allergies": None}, None):
        status, items = resolve_allergies(client)
        assert status == "unknown", f"{client!r} -> {status}"
        assert items == []


def test_none_when_client_answered_none():
    for value in (
        "None",          # cl-008's real value on the roster
        "none",
        "NIL",
        "N/A",
        "no known allergies",
        "NKDA",
        "Nothing",
        NO_KNOWN_ALLERGIES,
    ):
        status, items = resolve_allergies({"known_allergies": [value]})
        assert status == "none", f"{value!r} -> {status}"
        assert items == []


def test_declared_for_real_allergens():
    status, items = resolve_allergies({"known_allergies": ["Peanuts", "shellfish"]})
    assert status == "declared"
    assert items == ["Peanuts", "shellfish"]


def test_real_allergen_wins_over_stray_sentinel():
    """["none", "penicillin"] is a data-entry artefact, not a tie to break in
    favour of safety-off."""
    status, items = resolve_allergies({"known_allergies": ["none", "penicillin"]})
    assert status == "declared"
    assert items == ["penicillin"]


def test_sentinel_never_matches_as_substring():
    for value in ("none of the nuts", "walnut"):
        assert resolve_allergies({"known_allergies": [value]})[0] == "declared", value


def test_reads_the_second_field_name():
    """updateClientProfile takes `allergies` as its input key and writes
    whichever key the file already has, so a record can exist down either
    branch. All 21 live records use known_allergies; a single-name read would
    still miss a future one."""
    assert resolve_allergies({"allergies": ["latex"]})[1] == ["latex"]


def test_items_empty_for_none_and_unknown_alike():
    """The invariant that stops `if items:` reintroducing the original bug."""
    assert resolve_allergies({"known_allergies": ["None"]})[1] == []
    assert resolve_allergies({})[1] == []


def test_non_list_values_do_not_crash():
    for junk in ("peanut", 42, {"a": 1}):
        assert resolve_allergies({"known_allergies": junk})[0] == "unknown", junk


def test_prompt_line_never_claims_an_unmade_screen():
    line = allergy_prompt_line({})
    assert "NOT RECORDED" in line
    # The fallback this replaced was literally "Allergies: none known".
    assert "none known" not in line.lower()


def test_prompt_line_distinguishes_answered_none_from_unasked():
    asked = allergy_prompt_line({"known_allergies": ["None"]})
    unasked = allergy_prompt_line({})
    assert asked != unasked
    assert "asked" in asked


def test_prompt_line_always_emits_something():
    """Silence in a prompt reads to a model exactly like clearance."""
    for client in ({}, {"known_allergies": ["None"]}, {"known_allergies": ["peanut"]}):
        assert allergy_prompt_line(client).strip()


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
