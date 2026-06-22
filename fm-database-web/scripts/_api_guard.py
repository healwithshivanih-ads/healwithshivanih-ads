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
