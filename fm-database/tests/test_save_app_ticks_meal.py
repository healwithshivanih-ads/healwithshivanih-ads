"""Meal ticks reach the client's saved record.

The new client-app front lets a client tick a MEAL. The tick passes three
filters on its way to disk (the phone's type, the API route's allow-list, and
this script's KINDS); a kind missing from any one is dropped without an error.
This pins the last of the three by running the real script against a
throwaway plans folder.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

_SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "fm-database-web" / "scripts" / "save-app-ticks.py"
)


def _run(tmp_path: Path, payload: dict) -> dict:
    env = {**os.environ, "FMDB_PLANS_DIR": str(tmp_path)}
    out = subprocess.run(
        [sys.executable, str(_SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    return json.loads(out.stdout)


def _rows(tmp_path: Path) -> list[dict]:
    log = tmp_path / "clients" / "cl-test" / "_daily_ticks.jsonl"
    return [json.loads(line) for line in log.read_text().splitlines() if line.strip()]


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _client(tmp_path: Path) -> None:
    (tmp_path / "clients" / "cl-test").mkdir(parents=True)


def test_a_meal_tick_is_saved_with_its_time(tmp_path):
    _client(tmp_path)
    res = _run(tmp_path, {
        "client_id": "cl-test",
        "date": _today(),
        "items": [
            {"kind": "meal", "id": "m-lunch", "name": "Palak moong dal", "done": True, "at": "1:10 pm"},
            {"kind": "meal", "id": "m-dinner", "name": "Moong khichdi", "done": False, "at": None},
            {"kind": "supplement", "id": "s-d3", "name": "Vitamin D3", "done": True, "at": "1:12 pm"},
            {"kind": "practice", "id": "p1", "name": "Wind-down", "done": True, "at": "9:40 pm"},
        ],
    })
    assert res == {"ok": True}
    (row,) = _rows(tmp_path)
    by_id = {i["id"]: i for i in row["items"]}
    assert by_id["m-lunch"] == {"kind": "meal", "id": "m-lunch", "name": "Palak moong dal", "done": True, "at": "1:10 pm"}
    assert by_id["m-dinner"]["done"] is False and by_id["m-dinner"]["at"] is None
    # A practice keeps its time too: every tick in the record has one.
    assert by_id["p1"]["at"] == "9:40 pm"
    assert row["done"] == 3 and row["total"] == 4


def test_an_unknown_kind_is_still_refused(tmp_path):
    _client(tmp_path)
    res = _run(tmp_path, {
        "client_id": "cl-test",
        "date": _today(),
        "items": [
            {"kind": "snackbar", "id": "x", "name": "X", "done": True},
            {"kind": "meal", "id": "m-lunch", "name": "Lunch", "done": True},
        ],
    })
    assert res == {"ok": True}
    (row,) = _rows(tmp_path)
    assert [i["kind"] for i in row["items"]] == ["meal"]


def test_a_later_post_for_the_same_day_replaces_the_row(tmp_path):
    # Undo must be recorded as faithfully as Done: one row per day, newest wins.
    _client(tmp_path)
    item = {"kind": "meal", "id": "m-lunch", "name": "Lunch", "at": "1:10 pm"}
    _run(tmp_path, {"client_id": "cl-test", "date": _today(), "items": [{**item, "done": True}]})
    _run(tmp_path, {"client_id": "cl-test", "date": _today(), "items": [{**item, "done": False, "at": None}]})
    (row,) = _rows(tmp_path)
    assert row["items"][0]["done"] is False and row["done"] == 0
