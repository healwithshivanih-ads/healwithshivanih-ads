"""Result levels for the body age report: A just outside, B clearly raised, C far out, D see a doctor soon.

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


def level_and_side(
    key: str,
    value: Optional[float],
    *,
    lo: Optional[float] = None,
    hi: Optional[float] = None,
    sex: Optional[str] = None,
    cutoffs: Optional[dict] = None,
    unit: Optional[str] = None,
) -> tuple[str, str]:
    """(level, side) of one result. side is "high", "low" or "" and says which way the result is off.

    `lo` / `hi` are the laboratory's own printed range for it. `unit` is the laboratory's unit: a `fallback_plus`
    line that names a unit is applied only when the two agree (see plus_unit_ok)."""
    if value is None:
        return "", ""
    c = cutoffs or load_cutoffs()
    spec = (c.get("markers") or {}).get(key)
    above = hi is not None and value > hi
    below = lo is not None and value < lo
    up = down = ""
    if spec is None:
        fb = c.get("fallback_pct") or {}
        if above and hi:
            up = _scan(100.0 * (value - hi) / hi, fb, sex)
        elif below and lo:
            down = _scan(100.0 * (lo - value) / lo, fb, sex)
        plus = (c.get("fallback_plus") or {}).get(key)
        if plus and plus_unit_ok(key, unit, c):
            up = worst(up, _scan(value, plus.get("high"), sex))
            down = worst(down, _scan(value, plus.get("low"), sex, low=True))
    else:
        up, down = _scan(value, spec.get("high"), sex), _scan(value, spec.get("low"), sex, low=True)
        if hi:
            up = worst(up, _scan(value / hi, spec.get("high_x"), sex), _scan(100.0 * (value - hi) / hi, spec.get("high_pct"), sex))
        if not up and above:
            up = "A"        # outside the laboratory's range but short of every listed line
        if not down and below:
            down = "A"
    lv, side = (up, "high") if rank(up) >= rank(down) else (down, "low")
    if not lv:
        return "", ""
    if key in (c.get("cap_at_A") or []) and rank(lv) > rank("A"):
        lv = "A"
    if key in (c.get("cap_at_B") or []) and rank(lv) > rank("B"):
        lv = "B"
    if key in (c.get("inside_range_max_A") or []) and rank(lv) > rank("A") and lo is not None and hi is not None and not above and not below:
        lv = "A"        # inside the range the laboratory printed beside it
    if key in (c.get("inside_range_none") or []) and lo is not None and hi is not None and not above and not below:
        return "", ""
    return lv, side


def plus_unit_ok(key: str, unit: Optional[str], cutoffs: Optional[dict] = None) -> bool:
    """False when this marker's listed lines are written for a unit the laboratory did not use."""
    want = (((cutoffs or load_cutoffs()).get("fallback_plus") or {}).get(key) or {}).get("unit")
    return not want or want in str(unit or "").lower().replace(" ", "")


def level_for(key: str, value: Optional[float], **kw: Any) -> str:
    """The level of one result (see level_and_side)."""
    return level_and_side(key, value, **kw)[0]


DOCTOR = "needs a doctor's attention"            # Shivani, 19 Nov 2026: no "as well"; followed by "Please speak to your doctor."
CHECKUP = "worth mentioning at your next routine check-up"


def doctor_wording(level: str) -> str:
    """The words a level prints, or "" (A prints nothing; D prints the far-out words with "soon", see findings.LINE_D)."""
    return {"B": CHECKUP, "C": DOCTOR, "D": DOCTOR}.get(level, "")
