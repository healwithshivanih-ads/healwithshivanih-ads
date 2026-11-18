"""Merge a fresh `compute_ratios` run into the markers a client already has.

`compute_ratios` rebuilds `lab_markers` from the snapshot lab values alone. Used
as a straight replacement it threw away two things the coach relies on (found on
the in-care rebuild of 18 Nov 2026):

  * markers typed in by hand, or authored in chat, that never came from an
    uploaded report (one client lost nine: TPO + thyroglobulin antibodies, RBC
    folate, holoTC, urine ACR ...);
  * the written interpretation on markers whose value had not changed (152
    across ten clients were replaced by the engine's generic line).

The rule here is "the value decides":

  1. Every rebuilt marker is kept. When the client already had the same marker
     (same name, or the same test under another spelling, with the same value),
     its interpretation is carried over: an unchanged value keeps the text the
     coach already wrote or read. A changed value gets the fresh engine text.
  2. An old marker no rebuilt marker covers is kept when it was not computed
     (hand-entered, or a lab passed through from an older report). A computed
     marker the engine no longer produces is dropped: its inputs are gone.

Pure: no I/O, no API.
"""
from __future__ import annotations

import re
from typing import Any

# Words too generic to tie two spellings of one test together.
_GENERIC = {
    "anti", "antibody", "antibodies", "ab", "serum", "blood", "total", "test",
    "level", "levels", "ratio", "count", "index", "plasma", "the", "and", "of",
    "with", "random", "fasting", "spot", "urine", "cholesterol",
}
# Spellings of one test that share no word.
_SYNONYM = {
    "folic": "folate",
    "holotc": "holotranscobalamin",
    "ppbs": "postprandial",
    "uacr": "acr",
    "microalbumin": "acr",
    "tgab": "thyroglobulin",
}


def _fold(name: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def _tokens(name: Any) -> set[str]:
    words = re.findall(r"[a-z0-9]+", str(name or "").lower().replace("post-prandial", "postprandial"))
    out = {_SYNONYM.get(w, w) for w in words}
    return {w for w in out if len(w) >= 3 and w not in _GENERIC}


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    try:
        return float(re.sub(r"[^0-9.\-]", "", str(v)))
    except (TypeError, ValueError):
        return None


def _same_value(a: Any, b: Any) -> bool:
    x, y = _num(a), _num(b)
    if x is None or y is None:
        return str(a).strip().lower() == str(b).strip().lower()
    return abs(x - y) <= max(abs(x), abs(y)) * 0.005 + 1e-9


def _covers(new: dict, old: dict) -> bool:
    """Is `new` the same test as `old`? Same folded name, or a shared
    distinctive word with the same value."""
    if _fold(new.get("marker_name")) == _fold(old.get("marker_name")):
        return True
    return bool(
        _tokens(new.get("marker_name")) & _tokens(old.get("marker_name"))
        and _same_value(new.get("value"), old.get("value"))
    )


def merge_markers(previous: list[dict] | None, rebuilt: list[dict] | None) -> list[dict]:
    """The rebuilt markers, with unchanged values keeping their old text, plus
    every old hand-entered marker the rebuild does not cover."""
    previous = [m for m in (previous or []) if isinstance(m, dict)]
    rebuilt = [m for m in (rebuilt or []) if isinstance(m, dict)]
    covered: set[int] = set()
    out: list[dict] = []
    for m in rebuilt:
        # Same spelling first, so a looser match never steals another marker.
        match = next((i for i, old in enumerate(previous) if i not in covered
                      and _fold(m.get("marker_name")) == _fold(old.get("marker_name"))), None)
        if match is None:
            match = next((i for i, old in enumerate(previous)
                          if i not in covered and _covers(m, old)), None)
        if match is not None:
            covered.add(match)
            old = previous[match]
            text = old.get("fm_interpretation")
            if text and _same_value(m.get("value"), old.get("value")) and text != m.get("fm_interpretation"):
                m = {**m, "fm_interpretation": text}
        out.append(m)
    for i, old in enumerate(previous):
        if i in covered or old.get("computed"):
            continue
        out.append(old)
    return out
