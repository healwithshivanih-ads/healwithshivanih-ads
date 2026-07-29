"""Park people who never signed up, so they stop counting as clients.

Everyone the coach talks to gets a record under ``clients/<id>/`` — including
people who only ever had a discovery chat. Every roster count, scan and cron
then treats them as active, which skews the numbers and burns API credits and
cron cycles on people who are not, and may never be, clients.

The rule (coach's call, 2026-07-29): a person who has **not** signed up and has
been **quiet for 15 days** is parked in ``prospects/<id>/``. The 15-day grace
means a fresh lead you're actively chasing still shows up on the roster; only
leads that have actually gone cold get moved out.

Parking is a *move, not a delete* — and `storage.client_dir()` resolves either
location, so a parked record stays fully readable by id. If they later sign up,
:func:`restore` moves them straight back.

The quiet clock deliberately ignores ``updated_at``: background jobs bump that
field, which would keep a long-dead lead looking fresh forever. It uses only
signals that mean a human actually engaged.
"""

from __future__ import annotations

import re
import shutil
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

import yaml

__all__ = [
    "PROSPECT_QUIET_DAYS",
    "SIGNED_UP",
    "is_parked",
    "last_touch",
    "quiet_days",
    "sweep",
    "restore",
    "list_prospects",
]

#: Days of silence after which a non-signed-up person is parked.
PROSPECT_QUIET_DAYS = 15

#: The one engagement_status that means "this is a real client".
SIGNED_UP = "signed_up"

_DATE_IN_NAME = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def _as_date(value: Any) -> Optional[date]:
    """Best-effort coerce a YAML scalar to a date. Returns None if unusable."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    m = _DATE_IN_NAME.search(text)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _newest_session_date(person_dir: Path) -> Optional[date]:
    """Newest session date for a person, read from the session filenames.

    Session files are named ``<client_id>-YYYY-MM-DD-NNN.yaml``, so the date is
    available without opening (and YAML-parsing) every file.
    """
    sessions = person_dir / "sessions"
    if not sessions.is_dir():
        return None
    best: Optional[date] = None
    for f in sessions.iterdir():
        if f.suffix != ".yaml":
            continue
        d = _as_date(f.name)
        if d and (best is None or d > best):
            best = d
    return best


def last_touch(person_dir: Path, data: dict) -> Optional[date]:
    """The most recent date a human actually engaged with this person.

    Considers intake date, record creation, and the newest session. Ignores
    ``updated_at`` on purpose — automated jobs bump it.
    """
    candidates = [
        _as_date(data.get("intake_date")),
        _as_date(data.get("created_at")),
        _newest_session_date(person_dir),
    ]
    real = [c for c in candidates if c is not None]
    return max(real) if real else None


def quiet_days(person_dir: Path, data: dict, today: date) -> Optional[int]:
    """Days since the last human touch, or None if we can't tell."""
    touched = last_touch(person_dir, data)
    if touched is None:
        return None
    return (today - touched).days


def is_parked(root: Path, client_id: str) -> bool:
    return (root / "prospects" / client_id).is_dir()


def _read_client_yaml(person_dir: Path) -> Optional[dict]:
    cyaml = person_dir / "client.yaml"
    if not cyaml.exists():
        return None
    try:
        return yaml.safe_load(cyaml.read_text()) or {}
    except Exception as e:  # pragma: no cover - defensive
        print(f"WARN: skipping {cyaml}: {e}", file=sys.stderr)
        return None


def _engagement(data: dict) -> str:
    return str(data.get("engagement_status") or "pending").strip().lower()


def sweep(
    root: Path,
    today: Optional[date] = None,
    apply: bool = False,
    quiet_after_days: int = PROSPECT_QUIET_DAYS,
) -> dict[str, Any]:
    """Park every non-signed-up person who has been quiet long enough.

    Dry-run by default — pass ``apply=True`` to actually move directories.
    Idempotent: already-parked people are left alone, and a person who signs up
    is never touched.

    Returns a report dict: ``moved`` (or ``would_move`` on a dry run), plus
    ``kept`` explaining why each non-signed-up person was left in place.
    """
    today = today or date.today()
    clients_root = root / "clients"
    prospects_root = root / "prospects"
    moved: list[dict] = []
    restored: list[dict] = []
    kept: list[dict] = []
    errors: list[dict] = []

    # Self-correcting: anyone parked who has since signed up comes straight
    # back. The web app un-parks on the engagement flip too, but doing it here
    # as well means a missed flip (or a direct YAML edit) heals on its own
    # rather than leaving a real client stranded outside the roster.
    if prospects_root.is_dir():
        for person_dir in sorted(prospects_root.iterdir()):
            if not person_dir.is_dir():
                continue
            data = _read_client_yaml(person_dir)
            if data is None or _engagement(data) != SIGNED_UP:
                continue
            entry = {
                "client_id": person_dir.name,
                "display_name": str(data.get("display_name") or person_dir.name),
            }
            if not apply:
                restored.append(entry)
                continue
            try:
                restore(root, person_dir.name)
                restored.append(entry)
            except Exception as e:  # pragma: no cover - defensive
                errors.append({**entry, "error": f"{type(e).__name__}: {e}"})

    if not clients_root.is_dir():
        return {
            "ok": True,
            "applied": apply,
            "quiet_after_days": quiet_after_days,
            "moved" if apply else "would_move": [],
            "restored" if apply else "would_restore": restored,
            "kept": [],
            "errors": errors,
        }

    for person_dir in sorted(clients_root.iterdir()):
        if not person_dir.is_dir():
            continue
        cid = person_dir.name
        data = _read_client_yaml(person_dir)
        if data is None:
            continue

        status = _engagement(data)
        name = str(data.get("display_name") or cid)

        if status == SIGNED_UP:
            continue

        qd = quiet_days(person_dir, data, today)
        if qd is None:
            # No dateable signal at all — never guess, leave it for the coach.
            kept.append(
                {"client_id": cid, "display_name": name, "engagement_status": status,
                 "reason": "no dateable activity — left in place for review"}
            )
            continue

        if qd < quiet_after_days:
            kept.append(
                {"client_id": cid, "display_name": name, "engagement_status": status,
                 "quiet_days": qd,
                 "reason": f"still within the {quiet_after_days}-day grace window"}
            )
            continue

        entry = {
            "client_id": cid,
            "display_name": name,
            "engagement_status": status,
            "quiet_days": qd,
        }
        if not apply:
            moved.append(entry)
            continue

        dest = prospects_root / cid
        if dest.exists():
            errors.append({**entry, "error": f"prospects/{cid} already exists — not overwriting"})
            continue
        try:
            prospects_root.mkdir(parents=True, exist_ok=True)
            shutil.move(str(person_dir), str(dest))
            moved.append(entry)
        except Exception as e:  # pragma: no cover - defensive
            errors.append({**entry, "error": f"{type(e).__name__}: {e}"})

    return {
        "ok": True,
        "applied": apply,
        "quiet_after_days": quiet_after_days,
        "moved" if apply else "would_move": moved,
        "restored" if apply else "would_restore": restored,
        "kept": kept,
        "errors": errors,
    }


def restore(root: Path, client_id: str) -> Path:
    """Move a parked person back into ``clients/`` — they signed up.

    Idempotent: returns the existing active directory if they were never parked.
    """
    active = root / "clients" / client_id
    parked = root / "prospects" / client_id
    if active.exists():
        return active
    if not parked.exists():
        raise FileNotFoundError(f"no such person: {client_id}")
    active.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(parked), str(active))
    return active


def list_prospects(root: Path) -> list[dict]:
    """Summarise everyone currently parked, newest touch first."""
    prospects_root = root / "prospects"
    if not prospects_root.is_dir():
        return []
    out: list[dict] = []
    for person_dir in sorted(prospects_root.iterdir()):
        if not person_dir.is_dir():
            continue
        data = _read_client_yaml(person_dir)
        if data is None:
            continue
        touched = last_touch(person_dir, data)
        out.append(
            {
                "client_id": person_dir.name,
                "display_name": str(data.get("display_name") or person_dir.name),
                "engagement_status": _engagement(data),
                "last_touch": touched.isoformat() if touched else None,
                "has_app_token": bool(data.get("app_token")),
            }
        )
    out.sort(key=lambda r: (r["last_touch"] or ""), reverse=True)
    return out
