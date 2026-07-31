"""The bug this module exists to prevent, as a failing-if-broken test.

Hariharan (cl-005) was prescribed hibiscus tea and brahmi tea TWICE — once as
`nutrition.home_remedies` catalogue slugs and once as freeform
`lifestyle_practices` entries. The client app renders those two fields through
unrelated pipelines, so both teas showed up as separate mandatory "Daily
practice" checkboxes on Today, while the Plan tab correctly presented one of
them as a "Swap option". The client was told to drink both.

Three authoring paths can each reach these two fields without consulting the
other (assess suggester, plan-chat, hand-edited YAML), so the deterministic
check is the shared gate. These tests pin the matcher's behaviour — especially
the alias and reverse-direction cases, which are the ones that silently miss.

Run: python -m tests.test_remedy_practice_duplication
"""

from fmdb.plan.checker import practice_restates_remedy


class _Remedy:
    """Minimal stand-in for a catalogue HomeRemedy record."""

    def __init__(self, display_name="", aliases=None):
        self.display_name = display_name
        self.aliases = aliases or []


HIBISCUS = _Remedy(
    display_name="Hibiscus Tea (Gudhal / Jaswand)",
    aliases=["gudhal-tea", "jaswand-tea", "roselle-tea"],
)
CCF = _Remedy(
    display_name="Cumin-Coriander-Fennel Tea",
    aliases=["ccf-tea", "ccf-water"],
)
GHEE_MILK = _Remedy(
    display_name="Warm Ghee-Milk at Bedtime for Constipation",
    aliases=["ghrita-dugdha-constipation", "bedtime-milk-ghee"],
)


def test_the_original_bug_is_caught():
    """Hariharan's two teas, exactly as authored."""
    assert practice_restates_remedy(
        "Hibiscus tea (gudhal/jaswand) — 1-2 cups daily", "hibiscus-tea", HIBISCUS
    )
    assert practice_restates_remedy(
        "Brahmi tea — evening, before dinner", "brahmi-tea", _Remedy("Brahmi Tea")
    )


def test_abbreviation_matches_only_via_alias():
    """The coach types "CCF tea"; the slug is `cumin-coriander-fennel-tea`.

    Only the catalogue alias connects them — a plain slug/display-name compare
    misses this, and it is live on two clients (cl-005, cl-013).
    """
    assert practice_restates_remedy(
        "CCF tea between meals for gut symptoms",
        "cumin-coriander-fennel-tea",
        CCF,
    )
    # Without the aliases the match must fail — proving the alias is doing the
    # work, so nobody "simplifies" the name-form list later.
    assert not practice_restates_remedy(
        "CCF tea between meals for gut symptoms",
        "cumin-coriander-fennel-tea",
        _Remedy("Cumin-Coriander-Fennel Tea"),
    )


def test_practice_shorter_than_catalogue_name_still_matches():
    """Reverse direction: the practice is a trimmed restatement of a longer
    catalogue name. Forward-only substring matching misses this (cl-016)."""
    assert practice_restates_remedy(
        "Warm ghee-milk at bedtime", "ghee-milk-bedtime-constipation", GHEE_MILK
    )


def test_unrelated_practices_are_left_alone():
    """The rule must not fire on ordinary practices, or the coach learns to
    ignore it."""
    for name in (
        "Morning sunlight — 10-20 minutes before 9 AM",
        "Abhyanga — warm sesame oil self-massage before shower",
        "Consistent sleep schedule — 10:30 PM lights out",
        "Daily 20-30 minute walk — gentle to moderate pace",
        "Gratitude journaling — 3 things, handwritten",
    ):
        assert not practice_restates_remedy(name, "hibiscus-tea", HIBISCUS), name
        assert not practice_restates_remedy(name, "cumin-coriander-fennel-tea", CCF), name


def test_generic_words_alone_never_match():
    """"Warm water on waking" must not bind to every tea/water remedy — a
    remedy has to be identified by a distinctive word, not filler."""
    assert not practice_restates_remedy(
        "Warm water first thing on waking", "hibiscus-tea", HIBISCUS
    )
    assert not practice_restates_remedy(
        "Drink warm water through the day", "cumin-coriander-fennel-tea", CCF
    )


def test_a_generic_alias_cannot_match_everything():
    """A remedy carrying a filler-only alias ("herbal tea") must not start
    matching every practice that mentions tea."""
    junk = _Remedy(display_name="Some Tea", aliases=["herbal-tea", "the-tea"])
    assert not practice_restates_remedy(
        "Tea with milk — after food, not before", "some-tea", junk
    )


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
