#!/usr/bin/env python3
"""Client-facing meal-plan start-date confirmation: token lifecycle + confirm.

Companion to scripts/intake-token-action.py but for the Plan, not the Client.
The coach clicks "Get client confirm link" on the plan editor; we generate a
tokenised /start/<token> URL the client opens to confirm (or change) the day
they're actually starting the meal plan. Confirming sets
`plan.meal_plan_started_on`, which the dashboard / calendar / recheck-date
helpers in lib/fmdb/plan-timing.ts all key off.

Reads JSON from stdin:
{
  "action": "generate" | "lookup" | "confirm" | "revoke",
  ...action-specific fields
}

Actions:

  generate {plan_slug, ttl_days?}
    → Fresh URL-safe token written to plan.start_confirmation_token +
      start_confirmation_expires_at. Replaces any existing un-confirmed token.
      Returns: {ok, token, expires_at, url_path}

  lookup {token}
    → Scan all plan YAMLs under ~/fm-plans/{drafts,ready,published,
      superseded,revoked} for a token match. Refuses if expired or already
      used. Returns: {ok, plan_slug, client_id, display_name,
      plan_period_start, plan_period_weeks, current_meal_plan_started_on,
      default_meal_plan_start}

  confirm {token, date}
    → Sets plan.meal_plan_started_on = date, plan.start_confirmation_used_at
      = now, clears plan.start_confirmation_token. Returns:
      {ok, plan_slug, client_id, confirmed_date}

  revoke {plan_slug}
    → Coach-side cancellation. Clears start_confirmation_token +
      start_confirmation_expires_at. Returns: {ok}

Writes JSON to stdout:
  {ok: bool, ...action-specific fields, error?: str}

Plans live bucket-routed at ~/fm-plans/{drafts,ready,published,superseded,
revoked}/. lookup scans all 5; writes go back to the SAME file the plan was
loaded from. Uses yaml.safe_dump directly (NOT Pydantic round-trip) so this
shim stays robust against the brittle 3.9 / Pydantic v2 interactions noted
in the intake-token-action shim.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional, Tuple

import yaml  # type: ignore

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

# Plans live in one of these buckets. Order matters for nothing — we scan all.
PLAN_BUCKETS = ("drafts", "ready", "published", "superseded", "revoked")


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_yaml(p: Path) -> dict:
    with p.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _write_yaml(p: Path, data: dict) -> None:
    data["updated_at"] = _now_iso()
    data["updated_by"] = data.get("updated_by") or "start-date-link"
    with p.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)


def _find_plan_by_slug(plan_slug: str) -> Optional[Tuple[Path, dict]]:
    """Find a plan file by slug across all buckets. Plans in non-draft buckets
    use versioned filenames like <slug>-v3.yaml; drafts use just <slug>.yaml.
    We match by reading and comparing the YAML `slug` field — robust to either
    naming convention."""
    root = _plans_root()
    for bucket in PLAN_BUCKETS:
        bdir = root / bucket
        if not bdir.exists():
            continue
        # Cheap filename pre-filter, fall back to content scan for versioned
        # files (<slug>-vN.yaml).
        candidates = list(bdir.glob(f"{plan_slug}.yaml")) + list(bdir.glob(f"{plan_slug}-v*.yaml"))
        for yml in candidates:
            try:
                data = _read_yaml(yml)
            except Exception:
                continue
            if data.get("slug") == plan_slug:
                return yml, data
    return None


def _find_plan_by_token(token: str) -> Optional[Tuple[Path, dict]]:
    """Scan every plan YAML across all buckets, return the one whose
    start_confirmation_token matches."""
    root = _plans_root()
    for bucket in PLAN_BUCKETS:
        bdir = root / bucket
        if not bdir.exists():
            continue
        for yml in bdir.glob("*.yaml"):
            try:
                data = _read_yaml(yml)
            except Exception:
                continue
            if data.get("start_confirmation_token") == token:
                return yml, data
    return None


def _ymd(d: Any) -> Optional[str]:
    """Coerce a date-ish value (date / datetime / str / None) to YYYY-MM-DD."""
    if d is None:
        return None
    if isinstance(d, str):
        return d[:10] if d else None
    try:
        return d.strftime("%Y-%m-%d")  # date / datetime both work
    except Exception:
        return str(d)[:10] if str(d) else None


def _load_client_display_name(client_id: str) -> str:
    p = _plans_root() / "clients" / client_id / "client.yaml"
    if not p.exists():
        return ""
    try:
        d = _read_yaml(p)
    except Exception:
        return ""
    return d.get("display_name") or ""


# ── action: generate ─────────────────────────────────────────────────────────

def action_generate(payload: dict) -> dict:
    plan_slug = (payload.get("plan_slug") or "").strip()
    if not plan_slug:
        return {"ok": False, "error": "plan_slug required"}
    ttl_days = int(payload.get("ttl_days") or 14)

    hit = _find_plan_by_slug(plan_slug)
    if hit is None:
        return {"ok": False, "error": f"plan not found: {plan_slug}"}
    yml_path, data = hit

    token = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    data["start_confirmation_token"] = token
    data["start_confirmation_expires_at"] = expires.isoformat()
    # Generating a fresh link clears any prior "used" marker so the coach can
    # re-issue if the client wants to change their start date later.
    data["start_confirmation_used_at"] = None
    _write_yaml(yml_path, data)

    return {
        "ok": True,
        "token": token,
        "expires_at": expires.isoformat(),
        "url_path": f"/start/{token}",
    }


# ── action: lookup ───────────────────────────────────────────────────────────

def action_lookup(payload: dict) -> dict:
    token = (payload.get("token") or "").strip()
    if not token:
        return {"ok": False, "error": "token required"}
    hit = _find_plan_by_token(token)
    if hit is None:
        return {
            "ok": False,
            "error": "invalid_or_expired",
            "message": "Link not found or already used.",
        }
    yml_path, data = hit

    if data.get("start_confirmation_used_at"):
        return {
            "ok": False,
            "error": "already_used",
            "message": "You've already confirmed your start date. Tap the coach if you'd like to change it.",
        }

    expires_iso = data.get("start_confirmation_expires_at")
    if expires_iso:
        try:
            exp = datetime.fromisoformat(str(expires_iso))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > exp:
                return {
                    "ok": False,
                    "error": "expired",
                    "message": "Link expired. Tap the coach for a fresh one.",
                }
        except Exception:
            pass

    plan_period_start = _ymd(data.get("plan_period_start"))
    plan_period_weeks = data.get("plan_period_weeks")
    current_meal_plan_started_on = _ymd(data.get("meal_plan_started_on"))

    # Default meal-plan start = plan_period_start + 3 days (mirrors
    # MEAL_PLAN_DEFAULT_DELAY_DAYS on the Plan Pydantic model). This is the
    # date the form pre-fills as the suggested confirmation date.
    default_meal_plan_start: Optional[str] = None
    if plan_period_start:
        try:
            anchor = datetime.strptime(plan_period_start, "%Y-%m-%d").date()
            default_meal_plan_start = (anchor + timedelta(days=3)).strftime("%Y-%m-%d")
        except Exception:
            default_meal_plan_start = plan_period_start

    client_id = data.get("client_id") or ""
    display_name = _load_client_display_name(client_id) if client_id else ""

    return {
        "ok": True,
        "plan_slug": data.get("slug"),
        "client_id": client_id,
        "display_name": display_name,
        "plan_period_start": plan_period_start,
        "plan_period_weeks": plan_period_weeks,
        "current_meal_plan_started_on": current_meal_plan_started_on,
        "default_meal_plan_start": default_meal_plan_start,
    }


# ── action: confirm ──────────────────────────────────────────────────────────

def action_confirm(payload: dict) -> dict:
    token = (payload.get("token") or "").strip()
    date_str = (payload.get("date") or "").strip()
    if not token:
        return {"ok": False, "error": "token required"}
    if not date_str:
        return {"ok": False, "error": "date required"}
    # Validate format
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return {"ok": False, "error": "date must be YYYY-MM-DD"}

    hit = _find_plan_by_token(token)
    if hit is None:
        return {"ok": False, "error": "invalid_or_expired"}
    yml_path, data = hit
    if data.get("start_confirmation_used_at"):
        return {"ok": False, "error": "already_used"}

    data["meal_plan_started_on"] = date_str
    data["start_confirmation_used_at"] = _now_iso()
    data["start_confirmation_token"] = None
    _write_yaml(yml_path, data)

    return {
        "ok": True,
        "plan_slug": data.get("slug"),
        "client_id": data.get("client_id") or "",
        "confirmed_date": date_str,
    }


# ── action: revoke ───────────────────────────────────────────────────────────

def action_revoke(payload: dict) -> dict:
    plan_slug = (payload.get("plan_slug") or "").strip()
    if not plan_slug:
        return {"ok": False, "error": "plan_slug required"}
    hit = _find_plan_by_slug(plan_slug)
    if hit is None:
        return {"ok": False, "error": f"plan not found: {plan_slug}"}
    yml_path, data = hit
    data["start_confirmation_token"] = None
    data["start_confirmation_expires_at"] = None
    _write_yaml(yml_path, data)
    return {"ok": True}


# ── action: apply_inbound ────────────────────────────────────────────────────
# Used by the WhatsApp webhook AFTER parseInboundStartDateIntent recognises
# a `✅ START: …` or `📦 supplements arrived` button-reply. No token —
# we trust the matched client + the plan slug parsed from the inline
# `[plan: <slug>]` tag the button bakes in. If no slug present, picks the
# most recent published plan for the client.
#
# Payload:
#   client_id: str (required)
#   kind: "meal_start_date" | "supplements_arrived" (required)
#   date: YYYY-MM-DD (required)
#   plan_slug: str (optional — extracted from "[plan: …]" tag in the WA message)
#
# Returns: { ok, plan_slug, field_updated, previous_value, new_value } or error.

def action_apply_inbound(payload: dict) -> dict:
    client_id = (payload.get("client_id") or "").strip()
    kind = (payload.get("kind") or "").strip()
    date_str = (payload.get("date") or "").strip()
    plan_slug = (payload.get("plan_slug") or "").strip()

    if not client_id:
        return {"ok": False, "error": "client_id required"}
    if kind not in ("meal_start_date", "supplements_arrived"):
        return {"ok": False, "error": f"unknown kind: {kind!r}"}
    if not date_str:
        return {"ok": False, "error": "date required"}
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return {"ok": False, "error": "date must be YYYY-MM-DD"}

    # Locate the plan: explicit slug wins; else the latest published plan
    # for this client (most likely target — the letter was just sent).
    hit = None
    if plan_slug:
        hit = _find_plan_by_slug(plan_slug)
    if hit is None:
        # Walk published/ then ready/ then drafts/ for plans owned by this client.
        root = _plans_root()
        for bucket in ("published", "ready", "drafts"):
            bdir = root / bucket
            if not bdir.exists():
                continue
            best: Optional[Tuple[Path, dict]] = None
            best_mtime = -1.0
            for p in bdir.glob("*.yaml"):
                try:
                    d = _read_yaml(p)
                except Exception:
                    continue
                if d.get("client_id") != client_id:
                    continue
                mt = p.stat().st_mtime
                if mt > best_mtime:
                    best = (p, d)
                    best_mtime = mt
            if best is not None:
                hit = best
                break
    if hit is None:
        return {"ok": False, "error": f"no plan found for client {client_id!r}"}

    yml_path, data = hit
    field = "meal_plan_started_on" if kind == "meal_start_date" else "supplements_started_on"
    previous = data.get(field)
    data[field] = date_str
    # When meal start gets confirmed via the button, also retire any
    # outstanding /start/<token> tokenised link so it can't be re-used.
    if kind == "meal_start_date":
        data["start_confirmation_used_at"] = _now_iso()
        data["start_confirmation_token"] = None
    _write_yaml(yml_path, data)

    return {
        "ok": True,
        "plan_slug": data.get("slug"),
        "field_updated": field,
        "previous_value": previous,
        "new_value": date_str,
    }


# ── dispatcher ───────────────────────────────────────────────────────────────

ACTIONS = {
    "generate": action_generate,
    "lookup": action_lookup,
    "confirm": action_confirm,
    "revoke": action_revoke,
    "apply_inbound": action_apply_inbound,
}


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2
    action = (payload.get("action") or "").strip()
    fn = ACTIONS.get(action)
    if fn is None:
        json.dump(
            {"ok": False, "error": f"unknown action: {action!r}; expected one of {list(ACTIONS)}"},
            sys.stdout,
        )
        return 2
    try:
        out = fn(payload)
    except Exception as e:
        json.dump({"ok": False, "error": f"{type(e).__name__}: {e}"}, sys.stdout)
        return 1
    json.dump(out, sys.stdout)
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
