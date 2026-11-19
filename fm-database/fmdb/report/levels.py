"""Result levels for the body age report: A just outside, B clearly raised, C far out, D urgent.

Every number lives in cutoffs.yaml (same folder). This module only reads that file and applies it.
"" (empty) means the result is fine.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import yaml

ORDER = ["", "A", "B", "C", "D"]
CUTOFFS_PATH = Path(__file__).with_name("cutoffs.yaml")


def rank(level: str) -> int:
    return ORDER.index(level or "")


def worst(*levels: str) -> str:
    return max(levels, key=rank, default="") if levels else ""


@lru_cache(maxsize=4)
def load_cutoffs(path: Optional[str] = None) -> dict:
    data = yaml.safe_load(Path(path or CUTOFFS_PATH).read_text())
    if data.get("status") not in ("provisional", "approved"):
        raise ValueError("cutoffs.yaml: status must be 'provisional' or 'approved'")
    return data


def cutoffs_approved(path: Optional[str] = None) -> bool:
    return load_cutoffs(path)["status"] == "approved"


def _reaches(value: float, threshold: Any, low: bool) -> bool:
    """high: at or above the number (">x" strictly above). low: below it ("<=x" at or below)."""
    s = str(threshold).strip()
    if s.startswith(">"):
        return value > float(s[1:])
    if s.startswith("<="):
        return value <= float(s[2:])
    return value < float(s) if low else value >= float(s)


def _table(spec: Any, sex: Optional[str]) -> Optional[dict]:
    if not isinstance(spec, dict):
        return None
    if "M" in spec or "F" in spec:
        return spec.get(sex) if sex in ("M", "F") else None
    return spec


def _scan(value: float, spec: Any, sex: Optional[str], low: bool = False) -> str:
    table = _table(spec, sex)
    if not table:
        return ""
    out = ""
    for lv in ("A", "B", "C", "D"):
        if lv in table and _reaches(value, table[lv], low):
            out = lv
    return out


def level_for(
    key: str,
    value: Optional[float],
    *,
    lo: Optional[float] = None,
    hi: Optional[float] = None,
    sex: Optional[str] = None,
    cutoffs: Optional[dict] = None,
) -> str:
    """The level of one result. `lo` / `hi` are the laboratory's own printed range for it."""
    if value is None:
        return ""
    c = cutoffs or load_cutoffs()
    spec = (c.get("markers") or {}).get(key)
    above = hi is not None and value > hi
    below = lo is not None and value < lo
    if spec is None:
        fb = c.get("fallback_pct") or {}
        if above and hi:
            lv = _scan(100.0 * (value - hi) / hi, fb, sex)
        elif below and lo:
            lv = _scan(100.0 * (lo - value) / lo, fb, sex)
        else:
            lv = ""
    else:
        got = [_scan(value, spec.get("high"), sex), _scan(value, spec.get("low"), sex, low=True)]
        if hi:
            got.append(_scan(value / hi, spec.get("high_x"), sex))
            got.append(_scan(100.0 * (value - hi) / hi, spec.get("high_pct"), sex))
        lv = worst(*got)
        if not lv and (above or below):
            lv = "A"        # outside the laboratory's range but short of every listed line
    if key in (c.get("cap_at_A") or []) and rank(lv) > rank("A"):
        lv = "A"
    return lv


DOCTOR = "needs a doctor's attention as well"
CHECKUP = "worth mentioning at your next routine check-up"


def doctor_wording(level: str) -> str:
    """The words a level prints, or "" (A prints nothing; D is never printed, it is handled by phone)."""
    return {"B": CHECKUP, "C": DOCTOR, "D": DOCTOR}.get(level, "")
