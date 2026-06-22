"""Shared Anthropic client builder — single source of truth for timeout +
retry config across every shim.

Audit Phase-1 H2 (2026-06-05): without an explicit read timeout, a stalled
connection hangs until the TS caller's SIGKILL and surfaces as an opaque
"exited null with no stdout". read=180s only trips on a genuine stall
(streaming sends bytes continuously; the non-streaming shims here all produce
small outputs that finish well under 180s). max_retries lets the SDK self-heal
transient 429/5xx/connection blips.

Use `build_client(api_key)` everywhere instead of `Anthropic(...)` directly so
the timeout config can never drift between shims.
"""

from __future__ import annotations

import os


def build_client(api_key=None):
    """Return an Anthropic client configured with a fail-fast read timeout +
    retries. `api_key` falls back to ANTHROPIC_API_KEY in the environment.

    Cost guard (C): building a client means a real spend is imminent, so we
    refuse here unless the invocation is authorized (FM_API_OK=1 — set by the
    app, absent in ad-hoc/chat shells). This single chokepoint gates every
    shim that builds its client through build_client(). See _api_guard.py."""
    import sys
    from _api_guard import require_api_authorized
    require_api_authorized(sys.argv[0].rsplit("/", 1)[-1] or "shim")

    from anthropic import Anthropic
    import httpx

    return Anthropic(
        api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"),
        timeout=httpx.Timeout(600.0, connect=15.0, read=180.0),
        max_retries=3,
    )
