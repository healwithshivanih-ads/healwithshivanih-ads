"""Food diary (docs/FOOD_DIARY_PLAN.md) — the Python halves, as failable tests.

1. `food_diary` survives the Mac→Fly allowlist AND is on the Pydantic model
   (extra="forbid" — a key the model doesn't know crashes every shim), and the
   coach's private `focus` note is stripped from the staged copy.
2. The staging mirror carries `_food_diary.*.jsonl` + `files/diary/*.jpg`
   Fly → Mac, sends only the Mac's own file the other way, and never deletes.

Run: python -m pytest tests/test_food_diary_staging.py   (from fm-database/)
"""

import importlib.util
from datetime import date
from pathlib import Path

import yaml

from fmdb.plan.models import Client

_STAGING = (
    Path(__file__).resolve().parents[2]
    / "fm-database-web" / "scripts" / "app-staging-action.py"
)

_BASE = {
    "intake_date": "2026-10-01",
    "sex": "F",
    "created_at": "2026-10-01T00:00:00Z",
    "updated_at": "2026-10-01T00:00:00Z",
    "updated_by": "test",
}

# What startFoodDiaryAction writes (js-yaml quotes date-shaped strings).
_DIARY_YAML = """
food_diary:
  id: fd-2026-10-23-a1b2c3
  start: '2026-10-23'
  days: 3
  status: active
  started_at: '2026-10-23T05:30:00.000Z'
  focus: protein
"""


def _mod():
    spec = importlib.util.spec_from_file_location("app_staging_action", _STAGING)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_food_diary_is_on_the_allowlist_and_the_model():
    assert "food_diary" in _mod()._APP_CLIENT_KEYS, (
        "food_diary missing from _APP_CLIENT_KEYS — a diary started on the Mac "
        "would never open in the app on Fly"
    )
    assert "food_diary" in Client.model_fields


def test_client_loads_the_diary_as_the_coach_ui_writes_it():
    c = Client(client_id="cl-1", **_BASE, **yaml.safe_load(_DIARY_YAML))
    assert c.food_diary is not None
    assert c.food_diary.start == date(2026, 10, 23)
    assert c.food_diary.days == 3
    assert c.food_diary.status == "active"


def test_existing_clients_load_without_a_diary():
    assert Client(client_id="cl-1", **_BASE).food_diary is None


def test_staged_client_yaml_keeps_the_diary_but_drops_focus(tmp_path):
    mod = _mod()
    auth = tmp_path / "auth"
    stag = tmp_path / "stag"
    person = auth / "clients" / "cl-1"
    person.mkdir(parents=True)
    doc = {"client_id": "cl-1", "app_token": "x" * 32, **yaml.safe_load(_DIARY_YAML)}
    (person / "client.yaml").write_text(yaml.safe_dump(doc))
    # plan_slug "" = the plan-less (discovery) path: stages client.yaml only.
    res = mod._stage_one(yaml, auth, stag, "cl-1", "")
    assert res["ok"], res
    staged = yaml.safe_load((stag / "clients" / "cl-1" / "client.yaml").read_text())
    assert staged["food_diary"]["id"] == "fd-2026-10-23-a1b2c3"
    assert staged["food_diary"]["days"] == 3
    assert "focus" not in staged["food_diary"], "the coach's own note reached the public box"


def test_mirror_carries_fly_to_mac_and_never_deletes(tmp_path):
    mod = _mod()
    sdir = tmp_path / "stag" / "clients" / "cl-1"
    auth = tmp_path / "auth" / "clients" / "cl-1"
    (sdir / "files" / "diary").mkdir(parents=True)
    (auth / "files" / "diary").mkdir(parents=True)

    (sdir / "_food_diary.fly.jsonl").write_text('{"op":"add"}\n')
    (sdir / "files" / "diary" / "a.jpg").write_bytes(b"jpg-a")
    # Already on the Mac and NOT on Fly any more (e.g. swept there): must stay.
    (auth / "files" / "diary" / "old.jpg").write_bytes(b"jpg-old")
    # The coach's corrections, Mac-owned.
    (auth / "_food_diary.mac.jsonl").write_text('{"op":"label"}\n')
    # A stale, SHORTER Mac file on Fly must never be copied back over it.
    (sdir / "_food_diary.mac.jsonl").write_text("")

    copied, errors = mod._mirror_food_diary(sdir, auth)
    assert errors == []
    assert (auth / "_food_diary.fly.jsonl").read_text() == '{"op":"add"}\n'
    assert (auth / "files" / "diary" / "a.jpg").read_bytes() == b"jpg-a"
    assert (auth / "files" / "diary" / "old.jpg").exists(), "the mirror deleted a photo"
    assert (auth / "_food_diary.mac.jsonl").read_text() == '{"op":"label"}\n'
    # Mac → Fly: the coach's file goes out so /m on Fly shows her corrections.
    assert (sdir / "_food_diary.mac.jsonl").read_text() == '{"op":"label"}\n'
    assert copied == 3

    # Second run is a no-op.
    assert mod._mirror_food_diary(sdir, auth) == (0, [])


def test_refresh_calls_the_diary_mirror():
    """The mirror only matters if _refresh runs it for every staged client."""
    src = _STAGING.read_text()
    refresh = src[src.index("def _refresh("):]
    assert "_mirror_food_diary(sdir, auth_person)" in refresh
