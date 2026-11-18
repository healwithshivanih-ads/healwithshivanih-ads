"""The script that puts an eating-out guide on a plan.

Run for real against a throwaway plans folder. What it must hold to:
a published plan is amended and nothing else on it changes; a guide that
would tell this client to choose a food they do not eat is refused and
nothing is written.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import yaml

from fmdb.plan import storage
from fmdb.plan.models import CatalogueSnapshot, Client, Plan

_SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "fm-database-web" / "scripts" / "set-eating-out-guide.py"
)

GUIDE = {
    "rules": ["Start with the vegetables"],
    "situations": [
        {
            "where": "At a restaurant",
            "choose": ["Dal, sabzi, and rice or jowar roti"],
            "skip": ["Naan and cream gravies"],
        }
    ],
    "not_on_list": "Choose the plainest cooked dish and tell your coach afterwards.",
}


def _seed(root: Path, status: str = "published", **client_over) -> Path:
    storage.ensure_layout(root)
    storage.write_client(root, Client(**{
        "client_id": "cl-test",
        "display_name": "T",
        "intake_date": date(2026, 1, 1),
        "sex": "F",
        "created_at": datetime(2026, 1, 1),
        "updated_at": datetime(2026, 1, 1),
        "updated_by": "test",
        **client_over,
    }))
    return storage.write_plan(root, Plan(
        slug="p-test",
        client_id="cl-test",
        status=status,
        version=1,
        plan_period_start=date(2026, 1, 1),
        plan_period_weeks=12,
        plan_period_recheck_date=date(2026, 3, 26),
        catalogue_snapshot=CatalogueSnapshot(snapshot_date=date(2026, 1, 1)),
        notes_for_coach="keep me",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        updated_by="test",
    ))


def _run(root: Path, payload: dict) -> dict:
    out = subprocess.run(
        [sys.executable, str(_SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={**os.environ, "FMDB_PLANS_DIR": str(root)},
        timeout=60,
    )
    # Every shim prints JSON on stdout and nothing else.
    return json.loads(out.stdout)


def test_a_published_plan_is_amended_and_nothing_else_changes(tmp_path):
    path = _seed(tmp_path)
    before = yaml.safe_load(path.read_text())
    got = _run(tmp_path, {"plan_slug": "p-test", "guides": [GUIDE], "by": "coach"})
    assert got["ok"] and got["written"] and got["amended"], got
    after = yaml.safe_load(path.read_text())

    assert after["eating_out"][0]["situations"][0]["where"] == "At a restaurant"
    assert after["amendments"][-1]["field"] == "eating_out"
    assert after["amendments"][-1]["summary"] == "Eating-out guide added"
    assert after["status"] == "published"
    untouched = set(before) - {"eating_out", "amendments", "app_content_updated_at"}
    for key in untouched:
        assert after[key] == before[key], key
    # …and it still loads as a plan, with the guide on it.
    plan = storage.load_plan(tmp_path, "p-test")
    assert plan.eating_out[0].rules == ["Start with the vegetables"]
    assert plan.eating_out[0].from_week is None  # the whole plan


def test_replacing_a_guide_says_so_in_the_log(tmp_path):
    path = _seed(tmp_path)
    _run(tmp_path, {"plan_slug": "p-test", "guides": [GUIDE]})
    _run(tmp_path, {"plan_slug": "p-test", "guides": [{**GUIDE, "rules": ["Soups first"]}]})
    doc = yaml.safe_load(path.read_text())
    assert [a["summary"] for a in doc["amendments"]] == ["Eating-out guide added", "Eating-out guide replaced"]
    assert doc["eating_out"][0]["rules"] == ["Soups first"]


def test_a_draft_gets_the_guide_with_no_amendment(tmp_path):
    path = _seed(tmp_path, status="draft")
    got = _run(tmp_path, {"plan_slug": "p-test", "guides": [GUIDE]})
    assert got["ok"] and got["written"] and not got["amended"]
    doc = yaml.safe_load(path.read_text())
    assert doc["eating_out"] and not doc.get("amendments")


def test_meat_for_a_vegetarian_is_refused_and_nothing_is_written(tmp_path):
    path = _seed(tmp_path, dietary_preference="vegetarian")
    before = path.read_text()
    bad = {**GUIDE, "situations": [{"where": "At a restaurant", "choose": ["Grilled chicken and salad"]}]}
    got = _run(tmp_path, {"plan_slug": "p-test", "guides": [bad]})
    assert got["ok"] is False and got["written"] is False
    assert any(f["severity"] == "CRITICAL" and "chicken" in f["detail"] for f in got["findings"])
    assert path.read_text() == before


def test_a_published_plans_guide_meets_the_bar_of_a_new_one(tmp_path):
    # On a published plan the checker would only WARN about a guide with
    # nothing to choose. The script screens it as a plan being written.
    path = _seed(tmp_path)
    before = path.read_text()
    got = _run(tmp_path, {"plan_slug": "p-test", "guides": [{"rules": ["x"], "situations": []}]})
    assert got["ok"] is False
    assert path.read_text() == before


def test_dry_run_checks_and_writes_nothing(tmp_path):
    path = _seed(tmp_path)
    before = path.read_text()
    got = _run(tmp_path, {"plan_slug": "p-test", "guides": [GUIDE], "dry_run": True})
    assert got["ok"] and got["written"] is False
    assert path.read_text() == before


def test_a_misspelt_key_is_refused(tmp_path):
    _seed(tmp_path)
    got = _run(tmp_path, {"plan_slug": "p-test", "guides": [{**GUIDE, "ruls": ["x"]}]})
    assert got["ok"] is False and "shape" in got["error"]


def test_an_unknown_plan_is_a_clean_answer(tmp_path):
    storage.ensure_layout(tmp_path)
    got = _run(tmp_path, {"plan_slug": "nope", "guides": [GUIDE]})
    assert got["ok"] is False and "could not load the plan" in got["error"]
