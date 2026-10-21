"""Lock a client's submitted intake once the coach has acted on it.

Thin importable wrapper so `assess.py` and `plan-lifecycle.py` can reach
`auto_finalise_after` in the hyphen-named `intake-token-action.py` (not
importable by name). The rule itself lives there, next to `action_finalise`.

Never raises: an assessment or a publish must not fail because the intake
could not be locked.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent / "intake-token-action.py"
_mod = None


def _load():
    global _mod
    if _mod is None:
        spec = importlib.util.spec_from_file_location("intake_token_action", _SCRIPT)
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
        _mod = mod
    return _mod


def auto_finalise_after(client_id: str, trigger: str) -> dict:
    try:
        out = _load().auto_finalise_after(client_id, trigger)
    except Exception as e:  # noqa: BLE001
        out = {"finalised": False, "reason": f"unavailable: {type(e).__name__}: {e}"}
    # Expected skips are quiet; a genuine failure is logged (stderr only —
    # stdout is the calling shim's JSON).
    if not out.get("finalised") and out.get("reason") not in (
        "already_finalised", "not_submitted",
    ):
        print(
            f"[intake-autofinalise] {client_id} after {trigger}: {out.get('reason')}",
            file=sys.stderr,
        )
    return out
