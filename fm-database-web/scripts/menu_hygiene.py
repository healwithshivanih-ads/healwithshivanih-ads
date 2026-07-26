"""Shared: keep supplement DOSES out of the client's meal slots.

A menu slot is food. A capsule is not. When the weekly drafter emitted
"Warm milk (½ cup) + magnesium glycinate (1 capsule)" as a Bedtime dish, the
client saw her magnesium twice — once on the supplement schedule where it
belongs and once as something to eat — and the menu's protein/fibre/kcal tally
counted a capsule as a food. The AI keeps reproducing it because it reads last
week's menu for continuity, so a prompt rule alone never converges; this is the
deterministic pass that does.

`strip_supplement_doses(dish)` removes those components and returns what
remains, so the rest of the slot ("Warm milk (½ cup)") survives intact.

WHAT COUNTS AS A SUPPLEMENT, and why the test is deliberately narrow: the
catalogue's 413 supplements include a great many things people genuinely eat —
amla, methi, turmeric, ginger, cardamom, karela, saffron, garlic. Matching a
catalogue name alone would delete real food off real menus. So a component is
removed only when its name IS a catalogue supplement (whole-title match, never
a substring — "Karela sabzi" is not karela) AND one of:

  * it is presented as a DOSE — "(1 capsule)", "(2 tablets)", "(500 mg)"; or
  * it is a vitamin / mineral / amino-acid, which are never a dish under any
    portion ("Iron (1 tsp)" is not food, "Amla (1 tsp)" is).

Herbs, probiotics, fatty acids and the "other" bucket stay dose-gated, because
that is exactly where the food-shaped entries live.

Pure stdlib + pyyaml; no API. Read at generation time so it tracks the
catalogue automatically.
"""
from __future__ import annotations

import functools
import glob
import re
from pathlib import Path

import yaml

_FMDB = Path(__file__).resolve().parent.parent.parent / "fm-database"

# Categories whose members are never a dish, whatever portion is written next
# to them. Herb/probiotic/fatty_acid/other are excluded on purpose — that is
# where amla, methi, turmeric, ghee-adjacent and curd-adjacent entries sit.
_NEVER_FOOD_CATEGORIES = {"vitamin", "mineral", "amino_acid"}

# Pharmaceutical presentation. "scoop" is deliberately absent: a whey or
# protein scoop is a real drink component in these plans.
_DOSE_FORM = (
    r"capsules?|caps|tablets?|tabs|softgels?|gel\s?caps?|gummies|gummy|"
    r"lozenges?|sachets?|pills?|drops"
)
_DOSE_FORM_RE = re.compile(rf"\b(?:{_DOSE_FORM})\b", re.IGNORECASE)
# A pharmaceutical strength — "500 mg", "5000 IU", "20 billion CFU". Household
# food quantities (g, ml, cup, bowl) are not strengths and must not match.
_STRENGTH_RE = re.compile(
    r"\d+\s*(?:mg|mcg|µg|ug|iu|billion\s+cfu|cfu)\b", re.IGNORECASE
)
_PORTION_RE = re.compile(r"\([^)]*\)")
# Tokens that carry no identity once the name is isolated: the dose form, the
# strength units, bare numbers, and the count/format words around them.
_NAME_NOISE = {
    "capsule", "capsules", "cap", "caps", "tablet", "tablets", "tab", "tabs",
    "softgel", "softgels", "gummy", "gummies", "lozenge", "lozenges",
    "sachet", "sachets", "pill", "pills", "drop", "drops",
    "mg", "mcg", "ug", "iu", "cfu", "billion",
}


def _norm(text: str) -> str:
    """Lowercase word-sequence form — the only key both sides are compared on."""
    text = text.replace("-", " ").replace("_", " ").lower()
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


@functools.lru_cache(maxsize=1)
def _vocab() -> tuple[frozenset[str], frozenset[str]]:
    """(every supplement name, names whose category is never a dish)."""
    every: set[str] = set()
    never_food: set[str] = set()
    for f in glob.glob(str(_FMDB / "data" / "supplements" / "*.yaml")):
        try:
            d = yaml.safe_load(open(f)) or {}
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        names = [d.get("slug") or Path(f).stem, d.get("display_name") or ""]
        names += list(d.get("aliases") or [])
        keys = {_norm(str(n)) for n in names if str(n or "").strip()}
        keys.discard("")
        every |= keys
        if d.get("category") in _NEVER_FOOD_CATEGORIES:
            never_food |= keys
    return frozenset(every), frozenset(never_food)


def _name_key(component: str) -> str:
    """The component's bare name: portions removed, dose noise removed."""
    words = _norm(_PORTION_RE.sub(" ", component)).split()
    return " ".join(w for w in words if w not in _NAME_NOISE and not w.isdigit())


def is_supplement_dose(component: str) -> bool:
    """True when this dish component is a supplement dose, not a food."""
    key = _name_key(component)
    if not key:
        return False
    every, never_food = _vocab()
    if key not in every:
        return False
    if key in never_food:
        return True
    return bool(_DOSE_FORM_RE.search(component) or _STRENGTH_RE.search(component))


def strip_supplement_doses(dish: str) -> tuple[str, list[str]]:
    """Drop supplement-dose components from a dish cell.

    Returns (cleaned_dish, removed_components). Splits on " + " only — the
    separator the generators are instructed to use — so a sequenced or
    parenthesised cell is left structurally alone.
    """
    parts = [p.strip() for p in str(dish or "").split(" + ")]
    kept = [p for p in parts if p and not is_supplement_dose(p)]
    removed = [p for p in parts if p and is_supplement_dose(p)]
    return " + ".join(kept), removed


def scrub_menu_days(days: list[dict]) -> list[str]:
    """Strip supplement doses across a week's days, IN PLACE.

    Slots left with nothing to eat are dropped entirely — an empty dish would
    render as a blank meal card. Returns one note per removal for the log.
    """
    notes: list[str] = []
    for day_no, day in enumerate(days or [], 1):
        if not isinstance(day, dict):
            continue
        kept_slots = []
        for slot in day.get("slots") or []:
            if not isinstance(slot, dict):
                continue
            cleaned, removed = strip_supplement_doses(str(slot.get("dish") or ""))
            for r in removed:
                notes.append(f"day {day_no} {slot.get('slot') or '?'}: dropped {r!r}")
            if not cleaned:
                continue
            slot["dish"] = cleaned
            kept_slots.append(slot)
        day["slots"] = kept_slots
    return notes
