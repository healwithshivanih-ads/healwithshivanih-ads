"""Shared drug-catalogue alias matcher.

Every surface that reads `drug_depletions/*.yaml` (assess suggester, intake
handler, letter renderer, and the two TypeScript Server Actions via
`src/lib/fmdb/drug-match.ts`) resolves a free-text medication string to a
catalogue entry the same way. That logic used to be copy-pasted per caller,
and the copies drifted.

THE BUG THIS EXISTS TO PREVENT — a plain `alias in text` test has no word
boundary, so a SHORT alias matches inside an unrelated word:

    'pan'  (Pan-40, pantoprazole)  matched 'recheck thyroid panel', 'Panadol'
    'arb'  (ARB antihypertensives) matched 'carbamazepine'
    'asa'  (aspirin)               matched 'fluticasone nasal spray'
    'ltra' (montelukast)           matched 'Ultracet'

A false PPI match implies GERD, pulls in B12/magnesium depletion advice, and
changes protocol cautions — the letter renderer binds `protocol_cautions` as
HARD RULES, so a phantom match reaches the client. Longest-alias-wins hides
this whenever a real drug name also matches, which is why it survived: it only
bites on a short or free-text medication entry that has nothing longer to beat.

THE RULE — aliases shorter than `BOUNDARY_MAX_LEN` must match on a letter
boundary; longer ones keep plain substring matching so multi-word brand
strings ("Pan-D 40", "metformin xr") still resolve. The boundary is LETTERS
only, not `\\b`: digits and punctuation must be allowed to terminate an alias
or "Pan-40" and "Pan40" would stop matching the PPI entry they name.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

# Aliases at or above this length keep plain substring matching. Below it, a
# letter boundary is required. 5 keeps every real short abbreviation in the
# catalogue ('pan', 'arb', 'asa', 'ppi', 'ocp', 't4', 'ssri', 'hctz', …)
# boundary-guarded while leaving brand strings like 'pan-d' / 'telma' alone.
BOUNDARY_MAX_LEN = 5

# Shorter than this and a medication string is junk, not a drug name. Mirrors
# the floor already enforced by the intake shim and the TS callers (see the
# Archana cl-007 phantom-match incident, 2026-05-23).
MIN_MED_TEXT_LEN = 3

_BOUNDARY_CACHE: dict[str, re.Pattern[str]] = {}


def _boundary_pattern(alias: str) -> re.Pattern[str]:
    pat = _BOUNDARY_CACHE.get(alias)
    if pat is None:
        # Letters only on either side. `\b` would also treat digits as word
        # characters and break 'Pan-40' / 'Pan40' → proton-pump-inhibitors.
        pat = re.compile(r"(?<![a-z])" + re.escape(alias) + r"(?![a-z])")
        _BOUNDARY_CACHE[alias] = pat
    return pat


def alias_matches(alias: str, med_text_lower: str) -> bool:
    """True if `alias` occurs in the (already lowercased) medication string.

    Short aliases require a letter boundary; long ones match as substrings.
    """
    a = (alias or "").strip().lower()
    if not a or not med_text_lower:
        return False
    if len(a) < BOUNDARY_MAX_LEN:
        return _boundary_pattern(a).search(med_text_lower) is not None
    return a in med_text_lower


def drug_aliases(drug: dict[str, Any]) -> list[str]:
    """Name + every alias for one catalogue record, lowercased and deduped."""
    raw = [drug.get("drug_name") or ""] + list(drug.get("drug_aliases") or [])
    out: list[str] = []
    for a in raw:
        a = str(a or "").strip().lower()
        if a and a not in out:
            out.append(a)
    return out


def match_drug(
    med_text: str,
    drugs: Iterable[dict[str, Any]],
    *,
    min_len: int = MIN_MED_TEXT_LEN,
) -> Optional[dict[str, Any]]:
    """Resolve one medication string to a catalogue record, or None.

    Longest alias wins, so 'metformin xr' picks a more specific entry over a
    shorter alias that also matches.
    """
    text = (med_text or "").strip().lower()
    if len(text) < min_len:
        return None
    best: Optional[tuple[int, dict[str, Any]]] = None
    for d in drugs:
        for a in drug_aliases(d):
            if alias_matches(a, text) and (best is None or len(a) > best[0]):
                best = (len(a), d)
    return best[1] if best else None


def match_drug_with_alias(
    med_text: str,
    drugs: Iterable[dict[str, Any]],
    *,
    min_len: int = MIN_MED_TEXT_LEN,
) -> Optional[tuple[dict[str, Any], str]]:
    """`match_drug`, but also returns WHICH alias caused the match."""
    text = (med_text or "").strip().lower()
    if len(text) < min_len:
        return None
    best: Optional[tuple[int, dict[str, Any], str]] = None
    for d in drugs:
        for a in drug_aliases(d):
            if alias_matches(a, text) and (best is None or len(a) > best[0]):
                best = (len(a), d, a)
    return (best[1], best[2]) if best else None
