"""One answer to "where is this person in their journey".

Python mirror of ``fm-database-web/src/lib/fmdb/lifecycle.ts``. Keep the two in
lockstep — ``lifecycle.test.ts`` runs the same fixtures through both and fails
on any divergence.

States, in order of precedence (first match wins)::

    archived     out of every list
    maintenance  hands-free paid tier
    active       a programme plan in flight (or between phases with a successor)
    ending       active + inside the renewal window with no decision
    onboarding   paid, nothing started yet
    lapsed       programme ended, nothing followed
    prospect     never paid for a programme

Works on plain dicts (raw YAML), not Pydantic models, so the nightly sweep can
stamp every record without a load → dump round-trip that would reformat PHI.
"""
from __future__ import annotations

import re
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

import yaml

#: Mirrors ENDED_GRACE_DAYS / RENEWAL_GRACE_DAYS / OVERDUE_TAIL_DAYS.
ENDED_GRACE_DAYS = 14
#: Mirrors ENDING_LOOKAHEAD_DAYS / LOOKAHEAD_DAYS.
ENDING_LOOKAHEAD_DAYS = 15
PROSPECT_FOLLOWUP_DAYS = 30
LAPSED_WINBACK_DAYS = 56

MEAL_PLAN_DEFAULT_DELAY_DAYS = 3
TRAVEL_EXTENSION_CAP_DAYS = 14
WEIGHT_LOSS_REENTRY_BUFFER_DAYS = 6

STATES = ("archived", "maintenance", "active", "ending", "onboarding", "lapsed", "prospect")
IN_CARE = frozenset({"active", "ending", "maintenance", "onboarding"})

_PUBLISHED = {"published"}
_PIPELINE = {"draft", "drafts", "ready", "ready_to_publish"}
_EXTENDING_CONTEXTS = {"travel", "illness"}
_EXTENDING_MODES = {"maintenance", "skip"}


def _ymd(v: Any) -> Optional[date]:
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        s = v.strip()[:10]
        try:
            return date.fromisoformat(s)
        except ValueError:
            return None
    return None


def _iso(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None


# ── plan timing (port of plan-timing.ts, the parts lifecycle needs) ──────────


def effective_meal_plan_start(plan: dict) -> Optional[date]:
    asserted = _ymd(plan.get("meal_plan_started_on"))
    if asserted:
        return asserted
    start = _ymd(plan.get("plan_period_start"))
    if not start:
        return None
    return start + timedelta(days=MEAL_PLAN_DEFAULT_DELAY_DAYS)


def _pausing(o: dict) -> bool:
    if not isinstance(o, dict) or o.get("cancelled"):
        return False
    ctx = o.get("context")
    if ctx not in _EXTENDING_CONTEXTS:
        return False
    return (o.get("mode") or "maintenance") in _EXTENDING_MODES


def _overlap_days(a0: date, a1: date, b0: date, b1: date) -> int:
    start = max(a0, b0)
    end = min(a1, b1)
    if end < start:
        return 0
    return (end - start).days + 1


def travel_extension_days(overrides: Any, ws: Optional[date], we: Optional[date]) -> int:
    if not overrides or not ws or not we or we < ws:
        return 0
    days = 0
    for o in overrides:
        if not _pausing(o):
            continue
        f, t = _ymd(o.get("date_from")), _ymd(o.get("date_to"))
        if not f or not t or t < f:
            continue
        days += _overlap_days(f, t, ws, we)
    return min(days, TRAVEL_EXTENSION_CAP_DAYS)


def _latest_travel_return(overrides: Any, ws: Optional[date], we: Optional[date]) -> Optional[date]:
    if not overrides or not ws or not we:
        return None
    latest: Optional[date] = None
    for o in overrides:
        if not _pausing(o):
            continue
        f, t = _ymd(o.get("date_from")), _ymd(o.get("date_to"))
        if not f or not t or t < f:
            continue
        if _overlap_days(f, t, ws, we) == 0:
            continue
        if latest is None or t > latest:
            latest = t
    return latest


def effective_recheck_date(plan: dict, overrides: Any = None, weight_loss_enabled: bool = False) -> Optional[date]:
    start = effective_meal_plan_start(plan)
    try:
        weeks = int(plan.get("plan_period_weeks") or 0)
    except (TypeError, ValueError):
        weeks = 0
    if not start or not weeks:
        return None
    base = start + timedelta(days=weeks * 7)
    ext = travel_extension_days(overrides, start, base)
    recheck = base + timedelta(days=ext)
    if weight_loss_enabled:
        ret = _latest_travel_return(overrides, start, recheck)
        if ret:
            buffered = ret + timedelta(days=WEIGHT_LOSS_REENTRY_BUFFER_DAYS)
            if buffered > recheck:
                recheck = buffered
    return recheck


def has_plan_started(plan: dict, today: date) -> bool:
    start = effective_meal_plan_start(plan)
    if not start:
        return True
    return start <= today


# ── the resolver ──────────────────────────────────────────────────────────────


def _bucket(p: dict) -> str:
    return str(p.get("_bucket") or p.get("status") or "").lower()


def _decision_of(d: Any) -> Optional[str]:
    if not d:
        return None
    if isinstance(d, str):
        return d
    if isinstance(d, dict) and isinstance(d.get("decision"), str):
        return d["decision"]
    return None


def resolve_lifecycle(
    client: dict,
    plans: list[dict],
    today: date,
    decisions: Optional[dict] = None,
) -> dict:
    """Mirror of resolveLifecycle(); returns the same keys as the TS ``Lifecycle``."""
    decisions = decisions or {}
    raw_eng = client.get("engagement_status")
    engagement = raw_eng.strip().lower() if isinstance(raw_eng, str) else ""
    declined = engagement == "declined"
    opted_out = client.get("marketing_opt_out") is True
    base: dict[str, Any] = {
        "planSlug": None,
        "planEndsOn": None,
        "daysSinceEnd": None,
        "declined": declined,
        "optedOut": opted_out,
        "engagement": engagement,
    }
    first_touch = _ymd(client.get("intake_date")) or _ymd(client.get("created_at"))

    if client.get("archived") is True:
        return {**base, "state": "archived", "since": _iso(_ymd(client.get("archived_at"))), "reason": "archived"}

    wl = client.get("weight_loss") if isinstance(client.get("weight_loss"), dict) else {}
    overrides = wl.get("week_overrides") if wl else None
    wl_enabled = bool(wl.get("enabled") is True) if wl else False

    cid = client.get("client_id")
    mine = [p for p in plans if not p.get("client_id") or p.get("client_id") == cid]
    published = [p for p in mine if _bucket(p) in _PUBLISHED]
    pipeline = [p for p in mine if _bucket(p) in _PIPELINE]

    dated: list[tuple[dict, date, Optional[date]]] = []
    for p in published:
        start = effective_meal_plan_start(p)
        if not start:
            continue
        dated.append((p, start, effective_recheck_date(p, overrides, wl_enabled)))
    dated.sort(key=lambda t: t[1], reverse=True)

    maintenance_plans = [d for d in dated if d[0].get("is_maintenance") is True]
    programme_plans = [d for d in dated if d[0].get("is_maintenance") is not True]

    paid_through = _ymd(client.get("maintenance_paid_through"))
    live_maintenance = next(
        (d for d in maintenance_plans if has_plan_started(d[0], today) and (d[2] is None or d[2] >= today)),
        None,
    )
    if (paid_through and paid_through >= today) or live_maintenance:
        m = live_maintenance or (maintenance_plans[0] if maintenance_plans else None)
        return {
            **base,
            "state": "maintenance",
            "since": _iso(m[1]) if m else None,
            "planSlug": m[0].get("slug") if m else None,
            "planEndsOn": _iso(paid_through) if paid_through else (_iso(m[2]) if m else None),
            "daysSinceEnd": None,
            "reason": (
                f"maintenance, paid through {paid_through.isoformat()}"
                if paid_through
                else f"maintenance plan {m[0].get('slug', '') if m else ''} live"
            ),
        }

    if programme_plans:
        plan, start, end = programme_plans[0]
        slug = str(plan.get("slug") or "")
        started = has_plan_started(plan, today)
        days_since_end = (today - end).days if end else None
        decision = _decision_of(decisions.get(slug))
        successor = pipeline[0] if pipeline else None
        pb = {**base, "planSlug": slug, "planEndsOn": _iso(end), "daysSinceEnd": days_since_end}

        if not started:
            return {**pb, "state": "onboarding", "since": _iso(first_touch), "reason": f"plan {slug} starts {start.isoformat()}"}

        if end is None or days_since_end is None:
            return {**pb, "state": "active", "since": start.isoformat(), "reason": f"plan {slug} running (end not datable)"}

        if days_since_end <= ENDED_GRACE_DAYS:
            in_window = days_since_end >= -ENDING_LOOKAHEAD_DAYS
            if in_window and not decision and not successor:
                if days_since_end < 0:
                    n = -days_since_end
                    reason = f"plan ends in {n} day{'' if n == 1 else 's'} — renewal decision due"
                else:
                    reason = f"plan ended {days_since_end} day{'' if days_since_end == 1 else 's'} ago — renewal decision due"
                return {
                    **pb,
                    "state": "ending",
                    "since": (end - timedelta(days=ENDING_LOOKAHEAD_DAYS)).isoformat(),
                    "reason": reason,
                }
            if days_since_end < 0:
                reason = f"plan {slug} running, ends {end.isoformat()}"
            elif successor:
                reason = f"between phases — successor {successor.get('slug')} in {_bucket(successor)}"
            else:
                reason = f"plan ended {end.isoformat()}, decision: {decision}"
            return {**pb, "state": "active", "since": start.isoformat(), "reason": reason}

        if successor or decision == "renewed":
            reason = (
                f"between phases — successor {successor.get('slug')} in {_bucket(successor)}"
                if successor
                else "renewed — successor plan not yet drafted"
            )
            return {**pb, "state": "active", "since": start.isoformat(), "reason": reason}
        if engagement == "signed_up" and decision == "deferred":
            return {**pb, "state": "active", "since": start.isoformat(), "reason": f"plan ended {end.isoformat()}, renewal deferred"}
        lapsed_on = _ymd(client.get("lapsed_on")) or (end + timedelta(days=ENDED_GRACE_DAYS))
        return {
            **pb,
            "state": "lapsed",
            "since": lapsed_on.isoformat(),
            "reason": f"plan ended {end.isoformat()}, decision: {decision}" if decision else f"plan ended {end.isoformat()}, nothing followed",
        }

    if maintenance_plans:
        plan, start, end = maintenance_plans[0]
        lapsed_on = _ymd(client.get("lapsed_on")) or end
        return {
            **base,
            "state": "lapsed",
            "since": _iso(lapsed_on),
            "planSlug": plan.get("slug"),
            "planEndsOn": _iso(end),
            "daysSinceEnd": (today - end).days if end else None,
            "reason": f"maintenance lapsed — paid through {paid_through.isoformat()}" if paid_through else "maintenance plan ended",
        }

    if engagement == "signed_up":
        draft = pipeline[0] if pipeline else None
        return {
            **base,
            "state": "onboarding",
            "since": _iso(first_touch),
            "planSlug": draft.get("slug") if draft else None,
            "reason": f"signed up — plan {draft.get('slug')} in {_bucket(draft)}" if draft else "signed up — no plan yet",
        }

    if engagement == "lapsed":
        return {**base, "state": "lapsed", "since": _iso(_ymd(client.get("lapsed_on"))), "reason": "marked lapsed"}

    if declined:
        reason = "declined the programme"
    elif engagement:
        reason = f"engagement_status {engagement}"
    else:
        reason = "no sign-up on record"
    return {**base, "state": "prospect", "since": _iso(first_touch), "reason": reason}


# ── disk helpers (for the sweep and the report shim) ──────────────────────────

PLAN_BUCKET_DIRS = {
    "drafts": "draft",
    "ready": "ready_to_publish",
    "published": "published",
    "superseded": "superseded",
    "revoked": "revoked",
}


def load_all_plans(root: Path) -> list[dict]:
    """Every plan across buckets, with ``_bucket`` set the way loader.ts does."""
    out: list[dict] = []
    for folder, bucket in PLAN_BUCKET_DIRS.items():
        d = root / folder
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.yaml")):
            try:
                p = yaml.safe_load(f.read_text()) or {}
            except Exception as e:  # pragma: no cover - defensive
                print(f"WARN: skipping {f}: {e}", file=sys.stderr)
                continue
            if not isinstance(p, dict):
                continue
            p = dict(p)
            p["_bucket"] = bucket
            p.setdefault("slug", f.stem)
            out.append(p)
    return out


def load_decisions(root: Path) -> dict:
    f = root / "_renewal_decisions.yaml"
    if not f.exists():
        return {}
    try:
        doc = yaml.safe_load(f.read_text()) or {}
    except Exception:
        return {}
    return doc if isinstance(doc, dict) else {}


def resolve_all(root: Path, today: date) -> dict[str, dict]:
    """client_id → lifecycle for every record in clients/ (prospects/ excluded,
    the way loadAllClients() excludes them)."""
    plans = load_all_plans(root)
    by_client: dict[str, list[dict]] = {}
    for p in plans:
        cid = p.get("client_id")
        if cid:
            by_client.setdefault(str(cid), []).append(p)
    decisions = load_decisions(root)
    out: dict[str, dict] = {}
    clients_dir = root / "clients"
    if not clients_dir.is_dir():
        return out
    for d in sorted(clients_dir.iterdir()):
        f = d / "client.yaml"
        if not f.exists():
            continue
        try:
            c = yaml.safe_load(f.read_text()) or {}
        except Exception as e:  # pragma: no cover - defensive
            print(f"WARN: skipping {f}: {e}", file=sys.stderr)
            continue
        if not isinstance(c, dict):
            continue
        cid = str(c.get("client_id") or d.name)
        c.setdefault("client_id", cid)
        out[cid] = resolve_lifecycle(c, by_client.get(cid, []), today, decisions)
    return out


# ── nightly stamp (called by the renewal sweep) ────────────────────────────────

#: States on entry to which a hand-set follow-up date is stale by definition.
_CLEAR_NEXT_CONTACT_STATES = frozenset({"lapsed", "maintenance", "archived"})

_LINE_RE = {
    "lifecycle": re.compile(r"^lifecycle:.*\n?", re.M),
    "lifecycle_since": re.compile(r"^lifecycle_since:.*\n?", re.M),
    "next_contact_date": re.compile(r"^next_contact_date:.*\n?", re.M),
}


def _set_line(text: str, key: str, value: Optional[str]) -> str:
    """Replace/append one top-level scalar line; drop it when value is None.

    Surgical, like renewals._set_engagement: a yaml round-trip would reformat
    the whole PHI record (and re-quote 15_30-style scalars). Appends go at the
    end of the document so nothing above moves.
    """
    text = _LINE_RE[key].sub("", text)
    if value is None:
        return text
    return text.rstrip("\n") + f"\n{key}: '{value}'\n"


def stamp_lifecycles(root: Path, today: date, apply: bool = False) -> dict:
    """Write ``lifecycle`` + ``lifecycle_since`` on every clients/ record, and
    clear ``next_contact_date`` for anyone who is lapsed / maintenance /
    archived (a hand-set follow-up date on someone who left is how "Follow-up
    overdue 77d" sat on the dashboard for a maintenance client).

    Only lines that would actually change are rewritten. Returns a report.
    """
    states = resolve_all(root, today)
    changed: list[dict] = []
    cleared: list[dict] = []
    errors: list[dict] = []
    for cid, lc in states.items():
        cyaml = root / "clients" / cid / "client.yaml"
        try:
            text = cyaml.read_text()
        except OSError as e:  # pragma: no cover - defensive
            errors.append({"client_id": cid, "error": f"{type(e).__name__}: {e}"})
            continue
        doc = yaml.safe_load(text) or {}
        if not isinstance(doc, dict):
            continue
        new = text
        if str(doc.get("lifecycle") or "") != lc["state"] or str(doc.get("lifecycle_since") or "") != str(lc.get("since") or ""):
            new = _set_line(new, "lifecycle", lc["state"])
            new = _set_line(new, "lifecycle_since", lc.get("since"))
            changed.append({"client_id": cid, "from": doc.get("lifecycle"), "to": lc["state"]})
        if lc["state"] in _CLEAR_NEXT_CONTACT_STATES and doc.get("next_contact_date"):
            new = _set_line(new, "next_contact_date", None)
            cleared.append({"client_id": cid, "state": lc["state"], "was": str(doc.get("next_contact_date"))})
        if apply and new != text:
            try:
                cyaml.write_text(new)
            except OSError as e:  # pragma: no cover - defensive
                errors.append({"client_id": cid, "error": f"{type(e).__name__}: {e}"})
    return {"ok": True, "applied": apply, "stamped": changed, "next_contact_cleared": cleared, "errors": errors}
