"""Renewal sweep — the successor rule, and the case that made it necessary.

The regression this file exists for: on 2026-08-09 Nidhi Jain had plan-2 ended
two days earlier and plan-3 published starting four days later. A sweep keyed on
"is a plan active today" lapses her mid-gap and locks the Plan tab on her live
app. `test_nidhi_between_phases_is_never_lapsed` reproduces that exact shape.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fmdb.plan.renewals import (  # noqa: E402
    LAPSED,
    RENEWAL_GRACE_DAYS,
    SIGNED_UP,
    plan_windows,
    reactivate,
    renewal_state,
    sweep,
)

TODAY = date(2026, 8, 9)


def _plan(root: Path, bucket: str, slug: str, client_id: str, start: str, weeks: int = 12):
    d = root / bucket
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{slug}.yaml").write_text(
        yaml.safe_dump(
            {
                "slug": slug,
                "client_id": client_id,
                "plan_period_start": start,
                "meal_plan_started_on": start,
                "plan_period_weeks": weeks,
            },
            sort_keys=False,
        )
    )


def _client(root: Path, cid: str, engagement: str = SIGNED_UP, name: str = "Test"):
    d = root / "clients" / cid
    d.mkdir(parents=True, exist_ok=True)
    (d / "client.yaml").write_text(
        yaml.safe_dump(
            {
                "client_id": cid,
                "display_name": name,
                "engagement_status": engagement,
                "app_token": "tok-do-not-touch",
                "sex": "F",
                "intake_date": "2026-01-01",
            },
            sort_keys=False,
        )
    )
    return d / "client.yaml"


# --------------------------------------------------------------------------
# The regression case
# --------------------------------------------------------------------------


def test_nidhi_between_phases_is_never_lapsed(tmp_path):
    """Plan ended 2 days ago, successor starts in 4 — she renewed, she stays."""
    _client(tmp_path, "nidhi-jain", name="Nidhi Jain")
    _plan(tmp_path, "superseded", "nidhi-plan-2", "nidhi-jain", "2026-05-15")
    _plan(tmp_path, "published", "nidhi-plan-3", "nidhi-jain", "2026-08-13")

    state = renewal_state(plan_windows(tmp_path, "nidhi-jain"), TODAY)
    assert state["state"] == "awaiting_start"
    assert state["next_slug"] == "nidhi-plan-3"

    report = sweep(tmp_path, today=TODAY, apply=True)
    assert report["lapsed"] == []
    body = yaml.safe_load((tmp_path / "clients/nidhi-jain/client.yaml").read_text())
    assert body["engagement_status"] == SIGNED_UP


def test_a_naive_active_today_rule_would_have_caught_her(tmp_path):
    """Guards the intent: on this date no plan IS running, yet she is not lapsed."""
    _plan(tmp_path, "superseded", "nidhi-plan-2", "nidhi-jain", "2026-05-15")
    _plan(tmp_path, "published", "nidhi-plan-3", "nidhi-jain", "2026-08-13")
    windows = plan_windows(tmp_path, "nidhi-jain")
    assert not any(w.is_active_on(TODAY) for w in windows), "no plan runs today"
    assert renewal_state(windows, TODAY)["state"] != LAPSED


# --------------------------------------------------------------------------
# The rule itself
# --------------------------------------------------------------------------


def test_ended_past_grace_with_no_successor_lapses(tmp_path):
    cy = _client(tmp_path, "cl-006", name="Geetika")
    _plan(tmp_path, "published", "geetika-plan-2", "cl-006", "2026-05-01")  # ended 24 Jul
    report = sweep(tmp_path, today=TODAY, apply=True)
    assert [r["client_id"] for r in report["lapsed"]] == ["cl-006"]
    body = yaml.safe_load(cy.read_text())
    assert body["engagement_status"] == LAPSED
    assert body["lapsed_on"] == "2026-08-09"


def test_inside_grace_is_due_not_lapsed(tmp_path):
    cy = _client(tmp_path, "cl-004")
    _plan(tmp_path, "published", "p", "cl-004", "2026-05-12")  # ended 4 Aug, 5 days
    report = sweep(tmp_path, today=TODAY, apply=True)
    assert report["lapsed"] == []
    assert [r["client_id"] for r in report["renewal_due"]] == ["cl-004"]
    assert yaml.safe_load(cy.read_text())["engagement_status"] == SIGNED_UP


def test_grace_boundary_is_inclusive(tmp_path):
    _client(tmp_path, "edge")
    end_exactly_grace_ago = date(2026, 8, 9) - __import__("datetime").timedelta(days=RENEWAL_GRACE_DAYS)
    start = end_exactly_grace_ago - __import__("datetime").timedelta(weeks=12)
    _plan(tmp_path, "published", "p", "edge", start.isoformat())
    assert renewal_state(plan_windows(tmp_path, "edge"), TODAY)["state"] == LAPSED


def test_a_draft_successor_suppresses_lapsing(tmp_path):
    """A draft next phase means the coach is mid-renewal — do not lapse."""
    _client(tmp_path, "cl-017")
    _plan(tmp_path, "published", "p1", "cl-017", "2026-04-01")  # long ended
    _plan(tmp_path, "drafts", "p2", "cl-017", "2026-09-01")
    assert renewal_state(plan_windows(tmp_path, "cl-017"), TODAY)["state"] != LAPSED


def test_revoked_and_superseded_alone_do_not_count_as_successors(tmp_path):
    _client(tmp_path, "cl-x")
    _plan(tmp_path, "superseded", "old", "cl-x", "2026-01-01")
    _plan(tmp_path, "revoked", "dead", "cl-x", "2026-09-01")
    assert renewal_state(plan_windows(tmp_path, "cl-x"), TODAY)["state"] == LAPSED


# --------------------------------------------------------------------------
# Safety properties
# --------------------------------------------------------------------------


def test_sweep_never_touches_app_token(tmp_path):
    """Spec section 6: a lapsed client keeps their app and their Lab Vault."""
    cy = _client(tmp_path, "cl-006")
    _plan(tmp_path, "published", "p", "cl-006", "2026-04-01")
    sweep(tmp_path, today=TODAY, apply=True)
    assert yaml.safe_load(cy.read_text())["app_token"] == "tok-do-not-touch"


def test_dry_run_writes_nothing(tmp_path):
    cy = _client(tmp_path, "cl-006")
    _plan(tmp_path, "published", "p", "cl-006", "2026-04-01")
    before = cy.read_text()
    report = sweep(tmp_path, today=TODAY, apply=False)
    assert len(report["lapsed"]) == 1
    assert cy.read_text() == before


def test_sweep_is_idempotent(tmp_path):
    cy = _client(tmp_path, "cl-006")
    _plan(tmp_path, "published", "p", "cl-006", "2026-04-01")
    sweep(tmp_path, today=TODAY, apply=True)
    first = cy.read_text()
    second_report = sweep(tmp_path, today=TODAY, apply=True)
    assert second_report["lapsed"] == []
    assert cy.read_text() == first


def test_lapsed_client_with_a_new_plan_self_heals(tmp_path):
    cy = _client(tmp_path, "cl-006", engagement=LAPSED)
    _plan(tmp_path, "published", "old", "cl-006", "2026-04-01")
    _plan(tmp_path, "published", "new", "cl-006", "2026-09-01")
    report = sweep(tmp_path, today=TODAY, apply=True)
    assert [r["client_id"] for r in report["restored"]] == ["cl-006"]
    body = yaml.safe_load(cy.read_text())
    assert body["engagement_status"] == SIGNED_UP
    assert body.get("lapsed_on") is None


def test_reactivate_clears_the_lapse(tmp_path):
    cy = _client(tmp_path, "cl-006", engagement=LAPSED)
    assert reactivate(tmp_path, "cl-006")["ok"] is True
    body = yaml.safe_load(cy.read_text())
    assert body["engagement_status"] == SIGNED_UP
    assert body.get("lapsed_on") is None


def test_non_signed_up_people_are_ignored(tmp_path):
    """Prospects are prospects.py's job, not this sweep's."""
    cy = _client(tmp_path, "cl-023", engagement="pending")
    _plan(tmp_path, "published", "p", "cl-023", "2026-01-01")
    report = sweep(tmp_path, today=TODAY, apply=True)
    assert report["lapsed"] == []
    assert yaml.safe_load(cy.read_text())["engagement_status"] == "pending"


def test_client_with_no_datable_plan_is_left_alone(tmp_path):
    _client(tmp_path, "cl-024")
    report = sweep(tmp_path, today=TODAY, apply=True)
    assert report["lapsed"] == []
    assert [k["state"] for k in report["kept"]] == ["no_plan"]


def test_surgical_write_preserves_every_other_field(tmp_path):
    cy = _client(tmp_path, "cl-006")
    cy.write_text(cy.read_text() + "odd_value: '15_30'\nnested:\n  keep: yes\n")
    _plan(tmp_path, "published", "p", "cl-006", "2026-04-01")
    sweep(tmp_path, today=TODAY, apply=True)
    text = cy.read_text()
    assert "odd_value: '15_30'" in text, "underscore-int scalar must survive verbatim"
    assert "  keep: yes" in text


@pytest.mark.parametrize("weeks,expected", [(12, LAPSED), (52, "active")])
def test_plan_length_is_respected(tmp_path, weeks, expected):
    _client(tmp_path, "cl-p")
    _plan(tmp_path, "published", "p", "cl-p", "2026-01-01", weeks=weeks)
    assert renewal_state(plan_windows(tmp_path, "cl-p"), TODAY)["state"] == expected
