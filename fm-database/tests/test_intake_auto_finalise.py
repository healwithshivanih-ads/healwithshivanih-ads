"""Auto-lock a submitted intake once the coach has acted on it (2026-10-21).

A submitted intake stays open for re-edits until the coach presses Lock; in
practice she moved on to the assessment and plan and never pressed it, so 12
clients sat "submitted, not finalised" for months. Saving an assessment or
publishing a plan now locks it. A client who never submitted is left alone.

Run: .venv/bin/python -m pytest tests/test_intake_auto_finalise.py  (from fm-database/)
"""

import importlib.util
import sys
from pathlib import Path

import yaml

_SCRIPTS = Path(__file__).resolve().parents[2] / "fm-database-web" / "scripts"


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, _SCRIPTS / filename)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _client(root: Path, cid: str, **fields) -> Path:
    d = root / "clients" / cid
    d.mkdir(parents=True)
    p = d / "client.yaml"
    p.write_text(yaml.safe_dump({"client_id": cid, **fields}))
    return p


def _setup(tmp_path, monkeypatch):
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    monkeypatch.delenv("FMDB_STAGING_DIR", raising=False)
    # As when run for real: a script's own dir is on sys.path (atomic_write).
    monkeypatch.syspath_prepend(str(_SCRIPTS))
    return _load("intake_token_action", "intake-token-action.py")


def test_locks_a_submitted_unfinalised_intake(tmp_path, monkeypatch):
    mod = _setup(tmp_path, monkeypatch)
    p = _client(
        tmp_path, "cl-906",
        intake_token="tok", intake_token_expires_at="2026-10-17T00:00:00+00:00",
        intake_submitted_at="2026-09-21T07:35:04+00:00",
        intake_last_submitted_at="2026-09-21T07:35:04+00:00",
        intake_finalised_at=None,
    )
    assert mod.auto_finalise_after("cl-906", "assessment") == {
        "finalised": True, "reason": "assessment",
    }
    data = yaml.safe_load(p.read_text())
    assert data["intake_finalised_at"]
    assert data["intake_token"] is None
    assert data["intake_submitted_at"] == "2026-09-21T07:35:04+00:00"  # history kept


def test_last_submitted_stamp_alone_counts_as_submitted(tmp_path, monkeypatch):
    mod = _setup(tmp_path, monkeypatch)
    _client(tmp_path, "cl-a", intake_token="tok", intake_last_submitted_at="2026-09-01T00:00:00+00:00")
    assert mod.auto_finalise_after("cl-a", "plan_publish")["finalised"] is True


def test_leaves_a_never_submitted_form_open(tmp_path, monkeypatch):
    mod = _setup(tmp_path, monkeypatch)
    p = _client(tmp_path, "cl-b", intake_token="tok", intake_submitted_at=None)
    assert mod.auto_finalise_after("cl-b", "assessment") == {
        "finalised": False, "reason": "not_submitted",
    }
    assert yaml.safe_load(p.read_text())["intake_token"] == "tok"


def test_already_finalised_is_untouched(tmp_path, monkeypatch):
    mod = _setup(tmp_path, monkeypatch)
    p = _client(
        tmp_path, "cl-c",
        intake_submitted_at="2026-05-01T00:00:00Z", intake_finalised_at="2026-05-05T00:00:00Z",
    )
    before = p.read_text()
    assert mod.auto_finalise_after("cl-c", "assessment")["reason"] == "already_finalised"
    assert p.read_text() == before


def test_missing_client_never_raises(tmp_path, monkeypatch):
    mod = _setup(tmp_path, monkeypatch)
    out = mod.auto_finalise_after("cl-nope", "assessment")
    assert out["finalised"] is False


def test_wrapper_used_by_assess_and_plan_lifecycle(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    sys.modules.pop("intake_autofinalise", None)
    import intake_autofinalise  # noqa: E402 — what assess.py / plan-lifecycle.py import

    _client(tmp_path, "cl-d", intake_token="tok", intake_submitted_at="2026-09-01T00:00:00Z")
    assert intake_autofinalise.auto_finalise_after("cl-d", "assessment")["finalised"] is True
