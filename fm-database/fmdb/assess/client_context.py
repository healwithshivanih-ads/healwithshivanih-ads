"""Client facts the lab engine needs for its computed indices.

`compute_ratios` stays a pure function over lab values. The liver and
insulin-resistance scores (FIB-4, HSI, FLI, LAP, TyG-BMI, TyG-WC) also need
age, sex, BMI, waist and a diabetes flag. This module reads them from a client
record the caller already holds, so `compute_ratios` itself never opens a file.

Measurements live in three stores that do not sync (see the memory note on the
three weight stores and `src/lib/fmdb/measurements.ts::latestMeasurements`):

  - `health_snapshots[].measurements`  (client app, labs, intake)
  - `measurements_log[]`               (the coach's "Log entry" + check-ins)
  - flat `measurements`                (intake bio block, `measured_on` optional)

Each field is resolved on its own: the latest DATED value across the three
stores wins (the coach log beats a snapshot on the same date, as in the TS
reader). Only when no dated value exists does it fall back to the undated flat
block and then the v2.3 top-level intake fields (`height_cm`, `weight_now_kg`,
`waist_cm`, and their imperial twins) — the same fallback `assess.py` uses for
its prompt. An inch value typed into a cm field is rescued: a waist of 20-55
or a height of 48-90 is read as inches (x 2.54) — no adult has a 34 cm waist
or a 67 cm height, and both are inside the range people quote in inches. The
result says so (`waist_from_inches` / `height_from_inches`) so the card can
show it. Anything still outside the sane bounds in `measurements.ts` is ignored.

Pure and deterministic: no API, no I/O.
"""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from typing import Any

# Mirrors MEASUREMENT_BOUNDS in fm-database-web/src/lib/fmdb/measurements.ts.
_BOUNDS = {
    "height_cm": (90.0, 230.0),
    "weight_kg": (20.0, 350.0),
    "waist_cm": (40.0, 200.0),
}


def _as_dict(client: Any) -> dict:
    if client is None:
        return {}
    if isinstance(client, dict):
        return client
    if hasattr(client, "model_dump"):
        try:
            return client.model_dump(mode="json")
        except Exception:
            return {}
    return {}


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip()) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


# A cm field holding an inch value: (low, high) of the inch reading to rescue.
_INCH_RESCUE = {
    "waist_cm": (20.0, 55.0),
    "height_cm": (48.0, 90.0),
}


def _sane(field: str, v: Any) -> float | None:
    """Bounds check only — for values already converted to metric."""
    n = _num(v)
    if n is None:
        return None
    lo, hi = _BOUNDS[field]
    return n if lo <= n <= hi else None


def _sane_cm(field: str, v: Any) -> tuple[float | None, bool]:
    """(value in the field's unit, converted from inches?) or (None, False)."""
    n = _num(v)
    if n is None:
        return None, False
    rescue = _INCH_RESCUE.get(field)
    if rescue and rescue[0] <= n < rescue[1]:
        n, converted = round(n * 2.54, 1), True
    else:
        converted = False
    lo, hi = _BOUNDS[field]
    return (n, converted) if lo <= n <= hi else (None, False)


def _iso(d: Any) -> str | None:
    if not d:
        return None
    s = str(d)[:10]
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


def _latest_field(c: dict, field: str) -> tuple[float | None, str | None, bool]:
    """(value, ISO date or None, converted from inches?) — the latest dated
    value, else the undated fallback."""
    # (date, rank, value, converted): rank breaks same-date ties, log > snapshot > flat.
    dated: list[tuple[str, int, float, bool]] = []
    for snap in c.get("health_snapshots") or []:
        if not isinstance(snap, dict):
            continue
        d = _iso(snap.get("date"))
        v, conv = _sane_cm(field, (snap.get("measurements") or {}).get(field))
        if d and v is not None:
            dated.append((d, 1, v, conv))
    for e in c.get("measurements_log") or []:
        if not isinstance(e, dict):
            continue
        d = _iso(e.get("date"))
        v, conv = _sane_cm(field, e.get(field))
        if d and v is not None:
            dated.append((d, 2, v, conv))
    flat = c.get("measurements") or {}
    if not isinstance(flat, dict):
        flat = {}
    flat_v, flat_conv = _sane_cm(field, flat.get(field))
    flat_d = _iso(flat.get("measured_on"))
    if flat_v is not None and flat_d:
        dated.append((flat_d, 0, flat_v, flat_conv))
    if dated:
        d, _, v, conv = max(dated)
        return v, d, conv

    if flat_v is not None:
        return flat_v, None, flat_conv
    # v2.3 top-level intake fields, metric first, then the imperial twin.
    conv = False
    if field == "height_cm":
        v, conv = _sane_cm(field, c.get("height_cm"))
        if v is None:
            ft, inch = _num(c.get("height_ft")), _num(c.get("height_in"))
            if ft or inch:
                v = _sane(field, (ft or 0) * 30.48 + (inch or 0) * 2.54)
    elif field == "weight_kg":
        v = _sane(field, c.get("weight_now_kg"))
        if v is None:
            lb = _num(c.get("weight_now_lb"))
            v = _sane(field, lb * 0.45359237) if lb else None
    else:  # waist_cm
        v, conv = _sane_cm(field, c.get("waist_cm"))
        if v is None:
            inch = _num(c.get("waist_in"))
            v = _sane(field, inch * 2.54) if inch else None
    return v, None, conv


def _age(c: dict, today: date) -> tuple[int | None, str | None]:
    dob = _iso(c.get("date_of_birth"))
    if dob:
        b = date.fromisoformat(dob)
        age = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
        return (age, "dob") if 0 < age < 120 else (None, None)
    band = str(c.get("age_band") or "").replace("–", "-").strip()
    try:
        parts = band.split("-")
        if len(parts) == 2:
            return (int(parts[0]) + int(parts[1])) // 2, "age_band"
        if band:
            return int(band), "age_band"
    except ValueError:
        pass
    return None, None


def _diabetes_record(c: dict) -> str | None:
    """The firm active-condition label that names diabetes, read through the one
    condition matcher (`supplement_clash` + `_condition_terms.yaml`), so
    "prediabetes" or "? diabetes" never counts. None if there is none."""
    try:
        from fmdb.plan.supplement_clash import (
            _any_term, _record_entries, fold, load_concepts,
        )
    except Exception:
        return None
    concept = next((k for k in load_concepts() if k.get("id") == "diabetes"), None)
    if not concept:
        return None
    rec = SimpleNamespace(
        active_conditions=[str(x) for x in (c.get("active_conditions") or [])],
        medical_history=[],
    )
    terms = concept.get("client") or concept.get("contra")
    for label, firm in _record_entries(rec, concept):
        entry = fold(label)
        if firm and _any_term(entry, terms) and not _any_term(entry, concept.get("client_not")):
            return label
    return None


def _latest_pretest(c: dict) -> tuple[dict | None, str | None]:
    """(pretest block, its draw date) for the LATEST lab draw on file.

    Pre-test answers (illness, paracetamol, exercise, biotin, ...) describe one
    draw; an older draw's answers never carry to a newer one. So find the
    latest dated snapshot that holds lab values and return its `pretest` — or
    None when that draw has no answers (same-date snapshots are merged: a CBC
    and a biochemistry report from one morning share the answers)."""
    latest: str | None = None
    for snap in c.get("health_snapshots") or []:
        if isinstance(snap, dict) and snap.get("lab_values"):
            d = _iso(snap.get("date"))
            if d and (latest is None or d > latest):
                latest = d
    if latest is None:
        return None, None
    for snap in c.get("health_snapshots") or []:
        if (isinstance(snap, dict) and _iso(snap.get("date")) == latest
                and isinstance(snap.get("pretest"), dict)):
            return dict(snap["pretest"]), latest
    return None, latest


def lab_client_context(client: Any, today: date | None = None) -> dict:
    """The client facts `compute_ratios` uses for its derived indices.

    Accepts a raw client.yaml dict or a `Client` model. Every key is present;
    a fact the record does not hold is None, and the indices that need it are
    simply not computed.
    """
    c = _as_dict(client)
    today = today or date.today()
    age, age_source = _age(c, today)
    sex_raw = str(c.get("sex") or "").strip().upper()
    sex = sex_raw[0] if sex_raw[:1] in ("F", "M") else None
    height, _height_d, height_in = _latest_field(c, "height_cm")
    weight, weight_d, _ = _latest_field(c, "weight_kg")
    waist, waist_d, waist_in = _latest_field(c, "waist_cm")
    bmi = round(weight / (height / 100) ** 2, 1) if (height and weight) else None
    dm = _diabetes_record(c)
    pretest, pretest_date = _latest_pretest(c)
    return {
        "age": age,
        "age_source": age_source,
        "sex": sex,
        "height_cm": height,
        "height_from_inches": height_in,
        "weight_kg": weight,
        "weight_date": weight_d,
        "bmi": bmi,
        "waist_cm": waist,
        "waist_date": waist_d,
        "waist_from_inches": waist_in,
        "diabetes": dm is not None,
        "diabetes_record": dm,
        # Pre-test answers for the latest lab draw (see fmdb/assess/lab_confounders.py)
        "pretest": pretest,
        "pretest_date": pretest_date if pretest else None,
    }
