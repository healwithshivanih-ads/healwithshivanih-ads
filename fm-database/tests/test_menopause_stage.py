"""The menopause-stage derivation, as failable tests.

This value only changes EMPHASIS — the screen decides safety and runs regardless
— but it is derived from free text, and free-text derivations fail silently in
the direction of "found nothing". A client whose record says "Postmenopausal"
and who gets no bone emphasis is not an error anyone sees; it is just a session
that quietly looks like everyone else's. Hence these.

Run: python -m tests.test_menopause_stage
"""

from fmdb.assess.suggester import menopause_stage


def test_reads_the_shapes_the_roster_actually_uses():
    # Verbatim shapes from the live roster, which is the only reason to trust the
    # matcher at all — invented phrasings would prove nothing.
    assert menopause_stage({"active_conditions": ["Postmenopausal"]}) == "postmenopause"
    assert menopause_stage({"active_conditions": ["Perimenopause onset 2023"]}) == "perimenopause"
    assert menopause_stage({"active_conditions": ["Perimenopause"]}) == "perimenopause"


def test_post_wins_when_a_record_carries_both():
    # Records accumulate: a woman logged as perimenopausal in 2023 and
    # postmenopausal in 2026 has both words on file, and the later state is the
    # true one. Returning "perimenopause" there would under-call the bone agenda
    # for exactly the client who needs it most.
    assert menopause_stage(
        {"active_conditions": ["Perimenopause onset 2023", "Postmenopausal since 2026"]}
    ) == "postmenopause"


def test_reads_medical_history_not_just_active_conditions():
    # Surgical menopause is a past event, so it lands in medical_history rather
    # than active_conditions — and it is permanent.
    assert menopause_stage({"medical_history": ["Surgical menopause 2019"]}) == "postmenopause"
    assert menopause_stage(
        {"medical_history": ["Hysterectomy with oophorectomy 2020"]}
    ) == "postmenopause"


def test_accepts_a_bare_string_as_well_as_a_list():
    # The field is a list on every current record, but a plain string is a shape
    # the loader tolerates, and str is iterable — a naive implementation would
    # scan it character by character and match nothing.
    assert menopause_stage({"active_conditions": "Peri-menopausal symptoms"}) == "perimenopause"


def test_silent_when_there_is_nothing_to_read():
    assert menopause_stage({}) is None
    assert menopause_stage({"active_conditions": []}) is None
    assert menopause_stage({"active_conditions": ["Type 2 diabetes", "Hashimoto's"]}) is None
    assert menopause_stage({"active_conditions": None}) is None


def test_does_not_fire_on_unrelated_uses_of_the_word():
    # "Premenopausal" is the one word that must NOT read as the transition: it is
    # the record explicitly saying this client is not there yet, and substring
    # matching on "menopaus" alone would invert it.
    assert menopause_stage({"active_conditions": ["Premenopausal"]}) is None


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
