"""Detect clients whose plan ended and was never renewed, and lapse them.

The sibling of :mod:`fmdb.plan.prospects`. That module parks people who *never*
signed up; this one handles people who signed up, finished, and did not come
back.

The rule (coach's call, 2026-08-09): a signed-up client whose most recent plan
window ended **more than 14 days ago**, with **no successor plan of any kind**,
is marked ``engagement_status: lapsed``.

Three things this deliberately does NOT do
------------------------------------------

1. **It does not move anyone to a directory.** ``lapsed`` is a value, not a
   third population — see ``docs/CLIENT_VS_PROSPECT_SPEC.md`` section 5. The
   record stays in ``clients/``.
2. **It never touches ``app_token``.** Per spec section 6, a lapsed client keeps
   their app. The Lab Vault never locks and book-labs never locks: those are
   the client's own results, and taking them away for not renewing is both
   wrong and commercially backwards. Lapsing changes what the app *renders*,
   never what the client may see of their own data.
3. **It does not read "active today".** That predicate is the one real trap
   here, and it is why this module exists in this shape — see below.

THE SUCCESSOR RULE — why "no active plan" is the wrong question
---------------------------------------------------------------

A client between phases has no active plan *right now* and is not lapsed at
all. Measured on the live roster on 2026-08-09, this was not hypothetical:

    nidhi-plan-2  ended 2026-08-07   (2 days before the sweep)
    nidhi-plan-3  starts 2026-08-13  (4 days after it, already published)

A six-day gap that exists *because* she renewed. A rule keyed on "no active
plan" lapses her mid-gap and locks the Plan tab on the app in her pocket, four
days before her new phase opens.

So the predicate is **"is there a successor?"**, never "is one running today?".
Any plan in ``drafts/``, ``ready/`` or ``published/`` that starts in the future
— or is running now — suppresses lapsing. Drafts count on purpose: a draft is
the coach mid-way through writing the next phase, which is the strongest
possible signal that this person has not gone anywhere.

``test_renewals.py`` pins Nidhi's exact shape as a regression test.
"""

from __future__ import annotations

import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import yaml

__all__ = [
    "RENEWAL_GRACE_DAYS",
    "SIGNED_UP",
    "LAPSED",
    "PLAN_BUCKETS",
    "SUCCESSOR_BUCKETS",
    "PlanWindow",
    "plan_windows",
    "renewal_state",
    "sweep",
    "reactivate",
]

#: Days after a plan window ends, with no successor, before lapsing.
RENEWAL_GRACE_DAYS = 14

SIGNED_UP = "signed_up"
LAPSED = "lapsed"

#: Buckets holding a live (non-retired) plan. ``superseded`` and ``revoked`` are
#: excluded: a superseded plan's successor is counted in its own right, and a
#: revoked plan was explicitly withdrawn.
SUCCESSOR_BUCKETS = ("drafts", "ready", "published")
PLAN_BUCKETS = SUCCESSOR_BUCKETS + ("superseded", "revoked")

_DEFAULT_PLAN_WEEKS = 12
_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def _as_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    m = _DATE_RE.search(str(value).strip())
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


class PlanWindow:
    """One plan's effective start and end, and which bucket it sits in."""

    __slots__ = ("bucket", "slug", "start", "end")

    def __init__(self, bucket: str, slug: str, start: date, weeks: int) -> None:
        self.bucket = bucket
        self.slug = slug
        self.start = start
        self.end = start + timedelta(weeks=weeks)

    def is_active_on(self, day: date) -> bool:
        return self.start <= day < self.end

    def starts_after(self, day: date) -> bool:
        return self.start > day

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<PlanWindow {self.slug} {self.bucket} {self.start}..{self.end}>"


def plan_windows(root: Path, client_id: str) -> list[PlanWindow]:
    """Every datable plan window for one client, across all buckets.

    The effective start mirrors ``Plan.effective_meal_plan_start`` — the coach's
    asserted ``meal_plan_started_on`` wins over the scheduled
    ``plan_period_start``, because that is the date the client actually began.
    A plan with neither is skipped: it has no window, so it can neither prove
    nor disprove a renewal.
    """
    out: list[PlanWindow] = []
    for bucket in PLAN_BUCKETS:
        bucket_dir = root / bucket
        if not bucket_dir.is_dir():
            continue
        for f in sorted(bucket_dir.glob("*.yaml")):
            try:
                p = yaml.safe_load(f.read_text()) or {}
            except Exception as e:  # pragma: no cover - defensive
                print(f"WARN: skipping {f}: {e}", file=sys.stderr)
                continue
            if p.get("client_id") != client_id:
                continue
            start = _as_date(p.get("meal_plan_started_on")) or _as_date(
                p.get("plan_period_start")
            )
            if start is None:
                continue
            try:
                weeks = int(p.get("plan_period_weeks") or _DEFAULT_PLAN_WEEKS)
            except (TypeError, ValueError):
                weeks = _DEFAULT_PLAN_WEEKS
            out.append(PlanWindow(bucket, str(p.get("slug") or f.stem), start, weeks))
    return out


def renewal_state(
    windows: list[PlanWindow],
    today: date,
    grace_days: int = RENEWAL_GRACE_DAYS,
) -> dict[str, Any]:
    """Classify one client's renewal position.

    Returns ``state`` as one of:

    ``no_plan``        never had a datable plan — not this sweep's business
    ``active``         a published plan is running today
    ``awaiting_start`` a successor exists and starts in the future  <- Nidhi
    ``in_pipeline``    a draft or ready successor exists (coach mid-renewal)
    ``renewal_due``    window ended, no successor, still inside grace
    ``lapsed``         window ended, no successor, past grace
    """
    # A revoked plan was explicitly withdrawn, so it counts for nothing — not as
    # a successor, and not as evidence of care delivered. Leaving it in the
    # end-date maximum let a revoked plan dated in the future make a genuinely
    # lapsed client read as "active", which is how this line came to exist.
    windows = [w for w in windows if w.bucket != "revoked"]
    if not windows:
        return {"state": "no_plan", "days_since_end": None, "latest_end": None}

    live = [w for w in windows if w.bucket in SUCCESSOR_BUCKETS]

    if any(w.bucket == "published" and w.is_active_on(today) for w in live):
        return {"state": "active", "days_since_end": None, "latest_end": None}

    # A successor that has not started yet. This is the Nidhi case and the whole
    # reason this function does not ask "is a plan active today".
    future = [w for w in live if w.starts_after(today)]
    if future:
        nxt = min(future, key=lambda w: w.start)
        return {
            "state": "awaiting_start",
            "days_since_end": None,
            "latest_end": None,
            "next_slug": nxt.slug,
            "next_start": nxt.start.isoformat(),
        }

    # Coach is actively writing the next phase.
    pipeline = [w for w in live if w.bucket in ("drafts", "ready")]
    if pipeline:
        return {
            "state": "in_pipeline",
            "days_since_end": None,
            "latest_end": None,
            "next_slug": pipeline[0].slug,
        }

    latest_end = max(w.end for w in windows)
    days_since_end = (today - latest_end).days
    if days_since_end < 0:
        # Only non-published windows lie ahead; treat as still running.
        return {"state": "active", "days_since_end": days_since_end, "latest_end": latest_end.isoformat()}

    state = LAPSED if days_since_end >= grace_days else "renewal_due"
    return {
        "state": state,
        "days_since_end": days_since_end,
        "latest_end": latest_end.isoformat(),
    }


def _read_yaml(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        return yaml.safe_load(path.read_text()) or {}
    except Exception as e:  # pragma: no cover - defensive
        print(f"WARN: skipping {path}: {e}", file=sys.stderr)
        return None


def _set_engagement(cyaml: Path, status: str, lapsed_on: Optional[date]) -> None:
    """Rewrite only the engagement lines, leaving the rest byte-for-byte intact.

    A full ``yaml.safe_load`` -> ``safe_dump`` round-trip would reformat a
    ~60-field PHI record, reorder keys and re-quote scalars — including the
    underscore-integer hazard that bites ``15_30``-style values. A surgical line
    edit cannot do any of that.
    """
    text = cyaml.read_text()
    if re.search(r"^engagement_status:.*$", text, re.M):
        text = re.sub(r"^engagement_status:.*$", f"engagement_status: {status}", text, count=1, flags=re.M)
    else:
        text = text.rstrip("\n") + f"\nengagement_status: {status}\n"

    text = re.sub(r"^lapsed_on:.*\n?", "", text, flags=re.M)
    if lapsed_on is not None:
        text = text.rstrip("\n") + f"\nlapsed_on: '{lapsed_on.isoformat()}'\n"
    cyaml.write_text(text)


def sweep(
    root: Path,
    today: Optional[date] = None,
    apply: bool = False,
    grace_days: int = RENEWAL_GRACE_DAYS,
) -> dict[str, Any]:
    """Lapse every signed-up client past grace with no successor.

    Dry-run by default. Idempotent, and self-healing in both directions: a
    lapsed client who gains a successor plan is restored to ``signed_up``
    automatically, so a renewal never needs the coach to remember to un-lapse.
    """
    today = today or date.today()
    clients_root = root / "clients"
    lapsed: list[dict] = []
    restored: list[dict] = []
    due: list[dict] = []
    kept: list[dict] = []
    errors: list[dict] = []

    if not clients_root.is_dir():
        return {
            "ok": True,
            "applied": apply,
            "grace_days": grace_days,
            "today": today.isoformat(),
            "lapsed": lapsed,
            "restored": restored,
            "renewal_due": due,
            "kept": kept,
            "errors": errors,
        }

    for person_dir in sorted(clients_root.iterdir()):
        if not person_dir.is_dir():
            continue
        cid = person_dir.name
        cyaml = person_dir / "client.yaml"
        data = _read_yaml(cyaml)
        if data is None:
            continue
        engagement = str(data.get("engagement_status") or "").strip().lower()
        if engagement not in (SIGNED_UP, LAPSED):
            continue

        name = str(data.get("display_name") or cid)
        windows = plan_windows(root, str(data.get("client_id") or cid))
        info = renewal_state(windows, today, grace_days)
        entry = {"client_id": cid, "display_name": name, **info}

        # Self-heal: a lapsed client who has a plan again is a client again.
        if engagement == LAPSED and info["state"] in ("active", "awaiting_start", "in_pipeline"):
            restored.append(entry)
            if apply:
                try:
                    _set_engagement(cyaml, SIGNED_UP, None)
                except Exception as e:  # pragma: no cover - defensive
                    errors.append({**entry, "error": f"{type(e).__name__}: {e}"})
            continue

        if engagement == LAPSED:
            kept.append({**entry, "reason": "already lapsed"})
            continue

        if info["state"] == LAPSED:
            lapsed.append(entry)
            if apply:
                try:
                    _set_engagement(cyaml, LAPSED, today)
                except Exception as e:  # pragma: no cover - defensive
                    errors.append({**entry, "error": f"{type(e).__name__}: {e}"})
        elif info["state"] == "renewal_due":
            due.append(entry)
        else:
            kept.append({**entry, "reason": info["state"]})

    return {
        "ok": True,
        "applied": apply,
        "grace_days": grace_days,
        "today": today.isoformat(),
        "lapsed": lapsed,
        "restored": restored,
        "renewal_due": due,
        "kept": kept,
        "errors": errors,
    }


def reactivate(root: Path, client_id: str) -> dict[str, Any]:
    """Undo a lapse for one client. Always available to the coach."""
    for population in ("clients", "prospects"):
        cyaml = root / population / client_id / "client.yaml"
        if cyaml.exists():
            _set_engagement(cyaml, SIGNED_UP, None)
            return {"ok": True, "client_id": client_id, "engagement_status": SIGNED_UP}
    return {"ok": False, "error": f"no record for {client_id}"}
