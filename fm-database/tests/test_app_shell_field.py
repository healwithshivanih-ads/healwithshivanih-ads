"""The per-client switch for the new client-app front (`app_shell`).

Two halves, and both must hold or the switch silently does nothing:

1. The client model declares the field, so a record carrying it loads, and a
   record WITHOUT it loads exactly as before (unset → today's app).
2. `app-staging-action.py` projects it to Fly. The client app is served from
   Fly; a key missing from `_APP_CLIENT_KEYS` stays on the Mac and the client
   keeps today's app with no error anywhere.

The rule for who actually sees the new front lives in TypeScript
(`fm-database-web/src/lib/fmdb/app-shell.ts`, tested in `app-shell.test.ts`).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import yaml

from fmdb.plan.models import Client

_BASE = {
    "intake_date": "2026-11-01",
    "age_band": "40-45",
    "sex": "F",
    "created_at": "2026-11-01",
    "updated_at": "2026-11-01",
    "updated_by": "test",
}

_STAGING = (
    Path(__file__).resolve().parents[2]
    / "fm-database-web" / "scripts" / "app-staging-action.py"
)


def _staging_keys():
    spec = importlib.util.spec_from_file_location("app_staging_action", _STAGING)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod._APP_CLIENT_KEYS


def test_field_is_declared_on_the_model():
    assert "app_shell" in Client.model_fields, (
        "app_shell must be a declared field: an undeclared key only survives as "
        "an extra, and nothing documents what it means"
    )


def test_a_switched_on_record_loads():
    doc = yaml.safe_load("client_id: cl-999\napp_shell: v2\n")
    c = Client(**_BASE, **doc)
    assert c.app_shell == "v2"


def test_a_record_without_the_field_loads_exactly_as_before():
    c = Client(client_id="cl-1", **_BASE)
    assert c.app_shell is None
    # Unset must stay unset on a write-back: a load → dump round-trip that
    # invented a value would switch nobody on (only "v2" does), but it would
    # add a key to every client record the coach never set.
    dumped = c.model_dump(exclude_none=True)
    assert "app_shell" not in dumped


def test_the_value_survives_a_round_trip():
    c = Client(client_id="cl-999", app_shell="v2", **_BASE)
    again = Client(**c.model_dump())
    assert again.app_shell == "v2"


def test_an_unknown_value_does_not_break_the_load():
    # A plain string on purpose: a typo must read as "today's app" (the
    # TypeScript side accepts only the exact "v2"), never crash a client load.
    c = Client(client_id="cl-999", app_shell="v9", **_BASE)
    assert c.app_shell == "v9"


def test_the_switch_is_projected_to_fly():
    keys = _staging_keys()
    assert "app_shell" in keys, (
        "app_shell missing from _APP_CLIENT_KEYS — the switch set on the Mac "
        "would never reach Fly, and the client would stay on today's app"
    )
    assert len(keys) == len(set(keys)), "duplicate key in _APP_CLIENT_KEYS"
