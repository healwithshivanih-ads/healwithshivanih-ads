"""Per-client AI API spend tracker.

Every Anthropic API call writes one line to a per-client JSONL file:
  ~/fm-plans/clients/<client_id>/_api_usage.jsonl

Calls without a client_id (catalogue cleanup, etc.) go to:
  ~/fm-plans/_api_usage_unattributed.jsonl

The client Overview UI reads + aggregates these for MIS / pricing
purposes — coach can see at a glance "this client has cost ₹147 in
AI calls across 12 sessions" to inform service pricing.

USAGE (from any shim that calls Anthropic):
    from fmdb.usage import log_usage
    # ... after `resp = stream.get_final_message()` ...
    log_usage(
        client_id=client_id,
        script="render-client-letter.py",
        model="claude-sonnet-4-6",
        usage=resp.usage,
        notes=f"letter_type={letter_type}",
    )

`usage` can be the SDK's `Usage` object OR a plain dict — both work.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Anthropic published pricing (USD per million tokens) as of model release.
# Cache pricing: write = 1.25× input rate; read = 0.10× input rate.
# Keep in sync with https://docs.anthropic.com/en/docs/about-claude/pricing
PRICING_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-opus-4-7":    (15.0, 75.0),
    "claude-opus-4-6":    (15.0, 75.0),
    "claude-opus-4-5":    (15.0, 75.0),
    "claude-sonnet-4-7":  (3.0, 15.0),
    "claude-sonnet-4-6":  (3.0, 15.0),
    "claude-sonnet-4-5":  (3.0, 15.0),
    "claude-haiku-4-5":   (1.0, 5.0),
    # Legacy aliases
    "claude-3-5-sonnet": (3.0, 15.0),
    "claude-3-5-haiku":  (0.80, 4.0),
}

USD_TO_INR = float(os.environ.get("FMDB_USD_TO_INR", "85"))  # rough; override via env


def _pricing_for(model: str | None) -> tuple[float, float]:
    """Return (input_rate, output_rate) per million tokens. Falls back to
    Sonnet pricing on unknown models so we don't silently zero out a real
    cost (better an over-estimate than a miss)."""
    if not model:
        return (3.0, 15.0)
    if model in PRICING_USD_PER_MTOK:
        return PRICING_USD_PER_MTOK[model]
    lower = model.lower()
    if "haiku" in lower: return (1.0, 5.0)
    if "opus" in lower:  return (15.0, 75.0)
    return (3.0, 15.0)  # sonnet default


def compute_cost_usd(
    model: str | None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_input_tokens: int = 0,
    cache_creation_input_tokens: int = 0,
) -> float:
    """Compute total USD cost for one API call given the usage breakdown."""
    in_rate, out_rate = _pricing_for(model)
    in_per_tok = in_rate / 1_000_000
    out_per_tok = out_rate / 1_000_000
    cache_write_per_tok = in_per_tok * 1.25
    cache_read_per_tok = in_per_tok * 0.10
    return (
        (input_tokens or 0) * in_per_tok
        + (output_tokens or 0) * out_per_tok
        + (cache_read_input_tokens or 0) * cache_read_per_tok
        + (cache_creation_input_tokens or 0) * cache_write_per_tok
    )


def _extract_usage_fields(usage: Any) -> dict[str, int]:
    """Pull the four token counts from either an SDK Usage object or a dict.
    Returns zeros for any missing field so cost math is well-defined."""
    if usage is None:
        return {"input_tokens": 0, "output_tokens": 0,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    def _g(key: str) -> int:
        if isinstance(usage, dict):
            v = usage.get(key)
        else:
            v = getattr(usage, key, None)
        try:
            return int(v) if v is not None else 0
        except (TypeError, ValueError):
            return 0
    return {
        "input_tokens": _g("input_tokens"),
        "output_tokens": _g("output_tokens"),
        "cache_read_input_tokens": _g("cache_read_input_tokens"),
        "cache_creation_input_tokens": _g("cache_creation_input_tokens"),
    }


def _plans_root() -> Path:
    """Where ~/fm-plans/ lives. Honours FMDB_PLANS_DIR override."""
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / "fm-plans"


def log_usage(
    *,
    client_id: str | None,
    script: str,
    model: str | None,
    usage: Any,
    notes: str = "",
) -> dict:
    """Append one usage record to the per-client JSONL. Returns the entry
    written so callers can also surface it in their response payload.

    Never raises — usage logging is best-effort. If the file can't be
    written, we silently swallow the error (the API call has already
    succeeded; we don't want logging to break the user's flow).
    """
    fields = _extract_usage_fields(usage)
    cost_usd = compute_cost_usd(model, **fields)
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "client_id": client_id or "",
        "script": script,
        "model": model or "",
        **fields,
        "cost_usd": round(cost_usd, 6),
        "cost_inr": round(cost_usd * USD_TO_INR, 4),
    }
    if notes:
        entry["notes"] = notes[:200]

    plans = _plans_root()
    if client_id:
        path = plans / "clients" / client_id / "_api_usage.jsonl"
    else:
        path = plans / "_api_usage_unattributed.jsonl"

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        # Best-effort: never fail the caller because logging hit an IO error.
        pass

    return entry
