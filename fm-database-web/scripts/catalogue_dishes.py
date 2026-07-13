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
