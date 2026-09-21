"""The ritual engine's medication/allergy gate, pinned as a capability.

WHAT CHANGED (2026-09-21). `ritual_avoid` on a daily-ritual HomeRemedy was
matched against a haystack built from topics + active_conditions + goals ONLY.
Medications and allergies were not in it, so a `ritual_avoid` token naming a
drug or an allergen could never fire — the engine was structurally blind to
the client's drug list when auto-appending a ritual to their plan.

That mattered concretely: `soaked-methi-water` has always declared, in its
free-text `contraindications`, "on glucose-lowering medication (additive
effect — monitor for lows)". The engine does not read that field, and could
not have acted on it anyway.

WHAT THIS FILE DOES *NOT* ASSERT. Whether any particular remedy should be
gated on any particular drug is a CLINICAL decision and belongs to the coach,
not to a test. Methi specifically is deliberately NOT gated — the coach's call
on 2026-09-21, reasoning recorded in soaked-methi-water.yaml: a teaspoon of
soaked fenugreek is a food dose, not the therapeutic dose the additive-
hypoglycaemia caution is written about.

So these tests pin the MECHANISM against a synthetic ritual, not the policy
against a real one. They keep working whatever the coach later decides to gate,
and they fail if someone removes the medication axis again.

Run: python -m pytest tests/test_ritual_medication_gate.py
"""

import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent.parent / "fm-database-web" / "scripts"
sys.path.insert(0, str(_SCRIPTS))

import morning_rituals  # noqa: E402
from morning_rituals import _select_rituals  # noqa: E402


def _synthetic_ritual(**over):
    r = {
        "slug": "test-only-ritual",
        "display_name": "Test Only Ritual",
        "category": "infused_water",
        "route": "internal",
        "daily_ritual": True,
        "ritual_priority": 1,
        "indications": ["insulin-resistance", "type-2-diabetes"],
        "ritual_avoid": [],
        "preparation": "n/a",
        "typical_dose": "n/a",
    }
    r.update(over)
    return r


def _run(monkeypatch, ritual, client):
    monkeypatch.setattr(morning_rituals, "_load_daily_rituals", lambda: [ritual])
    return [r["slug"] for r in _select_rituals({}, client, max_n=5)]


_CLIENT = {
    "sex": "F",
    "active_conditions": ["Type 2 diabetes", "Insulin resistance"],
    "goals": ["Get blood sugar down"],
}


def test_ritual_is_offered_when_nothing_excludes_it(monkeypatch):
    """Guard the guard — if the synthetic ritual stops matching at all, every
    negative assertion below would pass vacuously."""
    client = dict(_CLIENT, current_medications=["Telma 40"])
    assert _run(monkeypatch, _synthetic_ritual(), client) == ["test-only-ritual"]


def test_ritual_avoid_can_gate_on_a_medication(monkeypatch):
    """The capability this change exists to provide."""
    client = dict(_CLIENT, current_medications=["Berberine 500 mg twice daily with meals"])
    got = _run(monkeypatch, _synthetic_ritual(ritual_avoid=["berberine"]), client)
    assert got == [], (
        "a ritual_avoid token naming a drug did not fire against the client's "
        "medication list — the medication axis of the exclusion haystack is gone"
    )


def test_ritual_avoid_can_gate_on_an_allergy(monkeypatch):
    client = dict(_CLIENT, known_allergies=["peanut", "sesame"])
    got = _run(monkeypatch, _synthetic_ritual(ritual_avoid=["sesame"]), client)
    assert got == []


def test_both_medication_field_spellings_are_read(monkeypatch):
    """Client records use `medications` OR `current_medications` depending on
    vintage. Reading only one silently half-works."""
    for field in ("medications", "current_medications"):
        client = dict(_CLIENT, **{field: ["metformin 500"]})
        got = _run(monkeypatch, _synthetic_ritual(ritual_avoid=["metformin"]), client)
        assert got == [], f"medication field {field!r} is not being read"


def test_medications_do_not_feed_relevance(monkeypatch):
    """Medications must stay OUT of the relevance haystack. Med strings name
    conditions ("Janumet ... for type 2 diabetes"), so counting them as
    relevance would manufacture indication matches and RAISE a ritual's score
    for an already-medicated client — the opposite of what is wanted."""
    client = {
        "sex": "F",
        "active_conditions": [],
        "goals": [],
        "current_medications": ["Janumet 50/500 for type 2 diabetes and insulin resistance"],
    }
    got = _run(monkeypatch, _synthetic_ritual(), client)
    assert got == [], (
        f"ritual {got} matched a client whose only text is a medication string — "
        "medications have leaked into the RELEVANCE haystack"
    )


def test_a_drug_token_must_not_match_the_condition_text(monkeypatch):
    """The false positive found while building this. A bare `insulin` token
    substring-matches 'insulin resistance' in a client's CONDITIONS, which
    withheld a ritual from 5 of 13 live clients — all insulin-resistant, none
    on a diabetes drug, i.e. exactly the people it was indicated for.

    This is a property of the token, not the engine: the engine matches loosely
    on purpose. The lesson is pinned here so the next person writing drug
    tokens names products, not drug-class words that double as condition words.
    """
    client = dict(_CLIENT, current_medications=["Vitamin D3"])
    assert _run(monkeypatch, _synthetic_ritual(ritual_avoid=["insulin"]), client) == [], (
        "expected the over-broad token to (wrongly) fire — if this ever stops "
        "being true the engine's matching changed and the guidance above is stale"
    )
    assert _run(monkeypatch, _synthetic_ritual(ritual_avoid=["insulin glargine"]), client) == [
        "test-only-ritual"
    ], "a product-specific token wrongly fired on 'insulin resistance' condition text"
