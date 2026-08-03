"""Allergy resolution — the difference between "none" and "never asked".

Python mirror of ``fm-database-web/src/lib/fmdb/allergies.ts``. Keep the two in
lockstep: the TS side serves the client app and the meal-photo check, this side
serves the assessment gate, the letter generators and recipe selection, and a
client must not be allergy-screened on one surface and not the other.

``Client.known_allergies`` was read by ten consumers as though a populated list
meant allergies and an empty one meant none. Measured on the live roster
2026-08-03: 1 record of 21 was non-empty, and its value was ``['None']``. So
every consumer was asserting a negative nobody had established — including two
safety checks (``author_gate._check_allergies``'s HARD block and
``recipe_select.is_safe``'s allergen join), both of which were passing
everything by construction.

The field already carries three states; the code was collapsing them into two:

    declared — real allergens. Absolute: never suggest, never serve.
    none     — the client was ASKED and said no. A real negative screen.
    unknown  — empty because the question was never answered. NOT none, and
               never to be rendered as one.

WHY THIS IS NOT MERGED INTO ``foods_to_avoid``: that field is prose written for
a human and holds "Onion, Garlic" (a Jain preference), "Brinjal, Rice, Wheat"
(a protocol phase) and "Brinjal (used to get itchy tongue as a kid)" (an oral
allergy) in the same shape. Severity is not mechanically recoverable from it.
An allergy is *never*; a coach's exclusion is *for now*.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

# Values a human writes to mean "I have none". Matched WHOLE, after lowering
# and stripping punctuation — never as a substring, or "none of the nuts"
# would register as a negative screen.
_NONE_SENTINELS = {
    "none",
    "nil",
    "no",
    "na",
    "nka",
    "nkda",
    "no allergies",
    "none known",
    "no known allergies",
    "no known drug allergies",
    "not known",
    "nothing",
    "no allergy",
    "denies",
}

#: Written when a client affirms they have none. Any of ``_NONE_SENTINELS``
#: reads back the same way, so a hand-typed "nil" from the coach also works.
NO_KNOWN_ALLERGIES = "No known allergies"

_PUNCT = re.compile(r"[^a-z ]+")
_WS = re.compile(r"\s+")


def _is_none_sentinel(raw: str) -> bool:
    s = _WS.sub(" ", _PUNCT.sub(" ", raw.lower())).strip()
    # Both forms: punctuation becomes a space, so "N/A" normalises to "n a" and
    # only matches once the spaces are also collapsed. "no known allergies"
    # needs the spaced form. Checking both covers each without a second list.
    return s in _NONE_SENTINELS or s.replace(" ", "") in _NONE_SENTINELS


def resolve_allergies(client: Optional[dict]) -> tuple[str, list[str]]:
    """Return ``(status, items)`` where status is declared | none | unknown.

    Reads ``known_allergies`` and falls back to ``allergies``. Both names exist
    in this codebase — ``updateClientProfile`` takes ``allergies`` as its input
    key and writes whichever key the file already has — and while all 21 live
    records currently use ``known_allergies``, a record created down the other
    branch would be missed by a single-name read.

    ``items`` is empty for BOTH none and unknown, so callers must branch on
    ``status``; testing ``if items:`` is the bug this module replaces.
    """
    client = client or {}

    def _seq(v: Any) -> Iterable:
        return v if isinstance(v, (list, tuple)) else ()

    raw = list(_seq(client.get("known_allergies"))) + list(_seq(client.get("allergies")))
    entries = [str(x).strip() for x in raw if str(x).strip()]
    if not entries:
        return "unknown", []

    items = [e for e in entries if not _is_none_sentinel(e)]
    # Every entry was a sentinel → asked, answered no. If a real allergen sits
    # alongside a "none", the allergen wins: ["none", "penicillin"] is a
    # data-entry artefact, not a tie to break in favour of safety-off.
    if not items:
        return "none", []
    return "declared", items


def allergy_prompt_line(client: Optional[dict]) -> str:
    """One line of allergy context for an AI prompt.

    ``unknown`` says so out loud rather than being omitted — an absent line
    reads to a model exactly like a cleared one, which is the failure this
    module exists to stop. This replaces the old
    ``'Allergies: none known'`` fallback, which asserted a screen that had
    never happened.
    """
    status, items = resolve_allergies(client)
    if status == "declared":
        return (
            "Allergies (ABSOLUTE — never suggest or serve these, at any dose): "
            + ", ".join(items)
        )
    if status == "none":
        return "Allergies: the client was asked and reported none."
    return (
        "Allergies: NOT RECORDED — nobody has asked. Absence here is not "
        "clearance; do not treat this client as allergy-free."
    )
