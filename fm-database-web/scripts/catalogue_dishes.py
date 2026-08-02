"""Shared: catalogue recipe dish names for the menu generators' vocabulary nudge.

The weekly-menu + app-menu generators invent free-text dish names, which then
fail to resolve to a library recipe (only ~55% of live-menu cooked dishes
matched, 2026-07-12) — so the AI recipe writer had to fill the gap, and that is
the least reliable surface. Feeding the generators the catalogue's own dish
titles and telling them to reuse those exact names makes dishes resolve by
construction, which is the real fix (see recipe-catalogue-gaps analysis). Read
at generation time, so it automatically reflects catalogue growth.

`catalogue_dish_names(diet_pref)` returns the catalogue recipe titles, dropping
clear meat/fish dishes for a vegetarian client so the list doesn't steer a veg
menu toward non-veg names (the absolute diet rule still applies downstream).
Pure stdlib + pyyaml; no API.
"""
from __future__ import annotations

import functools
import glob
import re
from pathlib import Path

import yaml

_FMDB = Path(__file__).resolve().parent.parent.parent / "fm-database"
# leading space on " meat"/" lamb" avoids matching inside unrelated words
_MEAT = ("chicken", "fish", "mutton", "prawn", "seafood", "crab", " meat", " lamb")


@functools.lru_cache(maxsize=1)
def _all_titles() -> tuple[str, ...]:
    out: list[str] = []
    for f in glob.glob(str(_FMDB / "data" / "_recipes" / "*.yaml")):
        try:
            r = yaml.safe_load(open(f)) or {}
        except Exception:
            continue
        if isinstance(r, list):
            r = r[0] if r else {}
        nm = (r.get("name") or r.get("title") or "").strip()
        if nm:
            out.append(nm)
    return tuple(sorted(set(out)))


def catalogue_dish_names(diet_pref: str = "") -> list[str]:
    names = list(_all_titles())
    dp = (diet_pref or "").lower()
    is_nonveg = any(x in dp for x in ("non-veg", "nonveg", "non veg", "pescatar", "omnivore"))
    if not is_nonveg:
        names = [n for n in names if not any(w in n.lower() for w in _MEAT)]
    return names


# ── snapping a drafted dish name back onto its catalogue title ───────────────
#
# The vocabulary nudge above gets most of the way — 35 of 41 dish slots on a
# live menu (2026-08-02) named a catalogue recipe exactly. The stragglers are
# the model embellishing a title it was given:
#
#     "Clear vegetable broth"              → catalogue "Everyday Vegetable Broth"
#     "Tofu stir-fry with mixed vegetables"→ catalogue "Tofu-vegetable stir-fry"
#
# Each miss costs twice: the client's dish opens with no method (or an AI one),
# and the coach is then asked to promote an AI near-duplicate of a recipe she
# already owns. Snapping is deterministic and happens before anyone sees the
# menu.
#
# The rule is deliberately narrow: strip portions and DESCRIPTOR words from
# both sides, singularise, and require the remaining token sets to be EQUAL.
# Anything that names a different ingredient stays put —
# "Besan chilla with methi" does NOT snap to "Besan chilla", because methi is
# food, not a descriptor, and the two are genuinely different dishes. That case
# is answered by adding the variant to the catalogue, not by snapping.
_DESCRIPTORS = frozenset({
    "clear", "everyday", "simple", "quick", "easy", "fresh", "homemade",
    "mixed", "assorted", "light", "plain", "classic", "traditional", "basic",
    "warm", "hot", "cold", "soft", "style", "with", "and", "of", "the", "a",
    "in", "your", "our", "house", "special", "healthy", "wholesome", "some",
})


def _core_tokens(name: str) -> frozenset:
    """Comparable core of a dish name: no portion, no descriptors, singular."""
    s = (name or "").lower()
    s = re.sub(r"\([^)]*\)", " ", s)            # "(3/4 cup)"
    s = re.sub(r"[^a-z0-9]+", " ", s)           # hyphens, commas, slashes
    toks = []
    for t in s.split():
        if t in _DESCRIPTORS or t.isdigit():
            continue
        if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]                          # vegetables → vegetable
        toks.append(t)
    return frozenset(toks)


@functools.lru_cache(maxsize=1)
def _core_index() -> dict:
    """core-token-set → catalogue title. Ambiguous cores are dropped: if two
    recipes reduce to the same core we cannot know which was meant, and a
    wrong snap is worse than no snap."""
    idx: dict = {}
    dupes = set()
    for nm in _all_titles():
        core = _core_tokens(nm)
        if not core:
            continue
        if core in idx and idx[core] != nm:
            dupes.add(core)
        idx.setdefault(core, nm)
    for d in dupes:
        idx.pop(d, None)
    return idx


def snap_dish_to_catalogue(dish: str) -> str | None:
    """The catalogue title this drafted dish name meant, or None.

    Returns None when the dish already matches exactly (nothing to do), when
    nothing matches, or when the match would be ambiguous.
    """
    if not dish or not dish.strip():
        return None
    core = _core_tokens(dish)
    if not core:
        return None
    hit = _core_index().get(core)
    if not hit:
        return None
    # Already the catalogue's own wording (modulo portion) — leave it alone.
    if hit.lower() == re.sub(r"\([^)]*\)", "", dish).strip().lower():
        return None
    return hit


def catalogue_covers(dish: str) -> str | None:
    """The catalogue title serving this dish — exact core match or a snap.
    Used by the letter generator to skip writing a recipe the library has."""
    core = _core_tokens(dish)
    return _core_index().get(core) if core else None
