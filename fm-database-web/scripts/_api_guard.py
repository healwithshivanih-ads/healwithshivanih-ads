#!/usr/bin/env python3
"""Authorization gate for Anthropic-spending shims (cost guard C, 2026-06-19).

Problem: when the coach asks the assistant to do work *in chat* (chat-ingest),
the assistant can "conveniently" shell out to an API-spending shim instead of
authoring by hand — silently burning credits the coach didn't ask to spend.

Fix: a spending shim must be explicitly authorized. The Next.js app (PM2 prod
AND `npm run dev`) carries FM_API_OK=1 in its process env (set in `.env.local`,
loaded by both Next and ecosystem.config.js), and every dashboard runner uses
`execFile`, which inherits `process.env` — so real button-presses are
authorized automatically. An ad-hoc shell / chat-ingest invocation does NOT
have FM_API_OK set, so the call is refused before any spend.

So: dashboard = spends (the coach chose it). Chat = $0 by default; to spend
deliberately, prepend `FM_API_OK=1` to the command (the explicit decision).

Usage (call right before the Anthropic request, after any dry-run early-out):

    from _api_guard import require_api_authorized
    require_api_authorized("assess.py")   # prints {ok:false} + exits if unset
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def api_authorized() -> bool:
    return os.environ.get("FM_API_OK") == "1"


def require_api_authorized(script: str) -> None:
    """Refuse (print JSON to stdout + exit) unless FM_API_OK=1 is set."""
    if api_authorized():
        return
    json.dump(
        {
            "ok": False,
            "api_blocked": True,
            "error": (
                f"{script}: refusing to spend Anthropic credits from an "
                "unauthorized context. Dashboard/dev runs carry FM_API_OK=1 "
                "automatically; ad-hoc/chat-ingest runs do not. Do this work "
                "via chat-ingest ($0), or prepend FM_API_OK=1 to deliberately "
                "authorize the spend."
            ),
        },
        sys.stdout,
    )
    sys.stdout.flush()
    sys.exit(0)  # stdout already carries a valid {ok:false}; exit clean so runners parse it


# ---------------------------------------------------------------------------
# Expired plans cost nothing.
#
# A lapsed client's plan sits in published/ forever and nothing about the file
# says it is over, so every paid path has to ask. Called right after a shim reads
# its client_id; tests/test_expired_spend_guard.py fails if a paid script skips it.
#
# The way back is the lifecycle's own: a successor plan in draft, or a "renewed"
# decision, moves the client out of `lapsed` and this stops refusing.
# ---------------------------------------------------------------------------

EXPIRED_STATES = frozenset({"lapsed", "archived"})


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env).expanduser() if env else Path.home() / "fm-plans"


def client_is_expired(client_id: str) -> bool:
    """True when the one lifecycle resolver says this client's care is over.

    Fails OPEN: a guard must not break a run for a client it cannot read."""
    if not client_id:
        return False
    try:
        import yaml

        root = _plans_root()
        person = next(
            (d for d in (root / "clients" / client_id, root / "prospects" / client_id)
             if (d / "client.yaml").exists()),
            None,
        )
        if person is None:
            return False
        client = yaml.safe_load((person / "client.yaml").read_text(encoding="utf-8")) or {}
        # Every in-care client leaves here without any plan being parsed.
        if client.get("engagement_status") != "lapsed" and client.get("archived") is not True:
            return False

        fmdb_root = Path(__file__).resolve().parent.parent.parent / "fm-database"
        sys.path.insert(0, str(fmdb_root))
        from datetime import date

        from fmdb.plan.lifecycle import PLAN_BUCKET_DIRS, load_decisions, resolve_lifecycle

        plans = []
        for folder, bucket in PLAN_BUCKET_DIRS.items():
            for f in sorted((root / folder).glob(f"*{client_id}*.yaml")):
                plan = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
                if isinstance(plan, dict) and plan.get("client_id") == client_id:
                    plans.append({**plan, "_bucket": bucket})
        client.setdefault("client_id", client_id)
        state = resolve_lifecycle(client, plans, date.today(), load_decisions(root))["state"]
        return state in EXPIRED_STATES
    except Exception as e:
        print(f"[_api_guard] could not read lifecycle for {client_id}: {e}", file=sys.stderr)
        return False


def refuse_if_expired(client_id: str, script: str) -> None:
    """Refuse (print JSON to stdout + exit) when this client's care is over."""
    if not client_is_expired(client_id):
        return
    json.dump(
        {
            "ok": False,
            "expired_client": True,
            "error": (
                f"{client_id}'s plan has ended, so {script} will not spend on it. "
                "If they are coming back, draft their new plan or mark the renewal "
                "as renewed first."
            ),
        },
        sys.stdout,
    )
    sys.stdout.flush()
    sys.exit(0)
