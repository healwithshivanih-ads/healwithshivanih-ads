"""Expired plans cost nothing: every paid script must ask before it spends."""

import re
import sys
from pathlib import Path

import pytest
import yaml

SCRIPTS = Path(__file__).resolve().parents[2] / "fm-database-web" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from _api_guard import client_is_expired, refuse_if_expired  # noqa: E402

# Paid, but never about one client's care. A new entry needs a reason here.
NOT_CLIENT_SCOPED = {
    "_api_guard.py": "the guard itself",
    "anthropic_client.py": "builds the client",
    "analyze-catalogue-duplicates.py": "catalogue",
    "batch-draft-recipe-candidates.py": "recipe library",
    "catalogue-chat.py": "catalogue",
    "coach-knowledge-check.py": "catalogue",
    "extract-client-from-transcript.py": "creates a new client",
    "generate-info-pack.py": "catalogue",
    "generate-recipe.py": "recipe library",
    "parse-recipe-candidate.py": "recipe library",
    "plan-notes-semantic-diff.py": "compares a draft, which means the client is not expired",
    "recipe-image-from-url.py": "recipe library",
    "render-topic-brief.py": "catalogue",
    "source-recipe-images.py": "recipe library",
}
PAID = re.compile(r"require_api_authorized|build_client\(|synthesize\(|ai_check_plan\(|anthropic\.Anthropic\(")
GUARD = re.compile(r"refuse_if_expired\(|client_is_expired\(")


def test_every_paid_script_asks_before_it_spends():
    missed = [
        p.name
        for p in sorted(SCRIPTS.glob("*.py"))
        if PAID.search(p.read_text(encoding="utf-8"))
        and p.name not in NOT_CLIENT_SCOPED
        and not GUARD.search(p.read_text(encoding="utf-8"))
    ]
    assert missed == [], f"paid scripts with no expired-client guard: {missed}"


def write_client(root, cid="cl-1", **fields):
    person = root / "clients" / cid
    person.mkdir(parents=True)
    (person / "client.yaml").write_text(
        yaml.safe_dump({"client_id": cid, "intake_date": "2026-01-01", **fields})
    )


def write_plan(root, bucket, slug, **fields):
    folder = root / bucket
    folder.mkdir(exist_ok=True)
    (folder / f"{slug}.yaml").write_text(yaml.safe_dump({"slug": slug, "client_id": "cl-1", **fields}))


ENDED = dict(
    plan_period_start="2026-01-01",
    meal_plan_started_on="2026-01-01",
    plan_period_weeks=12,
    status="published",
)


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    return tmp_path


def test_lapsed_client_is_expired(root):
    write_client(root, engagement_status="lapsed", lapsed_on="2026-05-01")
    write_plan(root, "published", "p-cl-1-v1", **ENDED)
    assert client_is_expired("cl-1")


def test_a_client_in_care_never_touches_the_plans(root):
    write_client(root, engagement_status="signed_up")
    (root / "published").mkdir()
    (root / "published" / "broken-cl-1.yaml").write_text("{ not: yaml: at all")
    assert not client_is_expired("cl-1")


def test_a_new_plan_in_draft_is_the_way_back(root):
    write_client(root, engagement_status="lapsed", lapsed_on="2026-05-01")
    write_plan(root, "published", "p-cl-1-v1", **ENDED)
    write_plan(root, "drafts", "p2-cl-1", status="draft")
    assert not client_is_expired("cl-1")


def test_a_renewed_decision_is_the_way_back(root):
    write_client(root, engagement_status="lapsed", lapsed_on="2026-05-01")
    write_plan(root, "published", "p-cl-1-v1", **ENDED)
    (root / "_renewal_decisions.yaml").write_text(yaml.safe_dump({"p-cl-1-v1": {"decision": "renewed"}}))
    assert not client_is_expired("cl-1")


def test_archived_is_expired(root):
    write_client(root, archived=True)
    assert client_is_expired("cl-1")


def test_unknown_client_fails_open(root):
    assert not client_is_expired("cl-nobody")
    assert not client_is_expired("")


def test_refusal_is_clean_json_the_callers_can_read(root, capsys):
    write_client(root, engagement_status="lapsed", lapsed_on="2026-05-01")
    write_plan(root, "published", "p-cl-1-v1", **ENDED)
    with pytest.raises(SystemExit) as stop:
        refuse_if_expired("cl-1", "generate-week-menu.py")
    assert stop.value.code == 0
    out = capsys.readouterr().out
    assert '"ok": false' in out and '"expired_client": true' in out
