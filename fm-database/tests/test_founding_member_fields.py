"""Sequoya "Founding 20" client fields load, and the private rate never
reaches the Fly projection.

Run: python -m pytest tests/test_founding_member_fields.py   (from fm-database/)
"""

import importlib.util
from datetime import date
from pathlib import Path

import yaml

from fmdb.plan.models import Client

_BASE = {
    "intake_date": "2027-01-01",
    "sex": "F",
    "created_at": "2027-01-01T00:00:00Z",
    "updated_at": "2027-01-01T00:00:00Z",
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
    return set(mod._APP_CLIENT_KEYS)


def test_founder_fields_load():
    doc = yaml.safe_load(
        """
client_id: cl-999
founding_member: true
founding_joined_on: 2027-01-03
founding_splus_rate_inr: 150000
founding_gift:
  recipient_client_id: cl-998
  issued_on: 2027-01-05
  expires_on: 2027-04-30
"""
    )
    c = Client(**_BASE, **doc)
    assert c.founding_member is True
    assert c.founding_joined_on == date(2027, 1, 3)
    assert c.founding_splus_rate_inr == 150000
    assert c.founding_gift is not None
    assert c.founding_gift.recipient_client_id == "cl-998"
    assert c.founding_gift.expires_on == date(2027, 4, 30)


def test_recipient_fields_load():
    doc = yaml.safe_load(
        """
client_id: cl-998
gifted_foundation_session:
  gifted_by: cl-999
  gifted_by_name: Priya
  issued_on: 2027-01-05
  expires_on: 2027-04-30
  call_1_on: 2027-01-10
  call_2_on: 2027-01-20
  joined_on: null
"""
    )
    c = Client(**_BASE, **doc)
    g = c.gifted_foundation_session
    assert g is not None and g.gifted_by == "cl-999"
    assert g.call_2_on == date(2027, 1, 20)
    assert g.joined_on is None


def test_defaults_leave_existing_clients_unchanged():
    c = Client(client_id="cl-1", **_BASE)
    assert c.founding_member is False
    assert c.founding_gift is None and c.gifted_foundation_session is None


def test_private_rate_is_not_projected_to_fly():
    keys = _staging_keys()
    assert "founding_member" in keys, "the app's founding mark needs this on Fly"
    assert "gifted_foundation_session" in keys, "the gift page + pay route read this on Fly"
    assert "founding_splus_rate_inr" not in keys, "the locked Sequoya+ rate is PRIVATE"
    assert "founding_gift" not in keys


def test_prospects_sweep_keeps_an_open_gift_recipient(tmp_path):
    from fmdb.plan.prospects import sweep

    def person(cid, extra):
        d = tmp_path / "clients" / cid
        d.mkdir(parents=True)
        doc = {"client_id": cid, "display_name": cid, "engagement_status": "pending",
               "intake_date": "2027-01-01", "created_at": "2027-01-01"}
        doc.update(extra)
        (d / "client.yaml").write_text(yaml.safe_dump(doc))

    gift = {"gifted_by": "cl-999", "issued_on": "2027-01-05", "expires_on": "2027-04-30"}
    person("cl-gift", {"gifted_foundation_session": gift})
    person("cl-cold", {})
    report = sweep(tmp_path, today=date(2027, 3, 1), apply=False)
    would = {m["client_id"] for m in report["would_move"]}
    assert "cl-cold" in would
    assert "cl-gift" not in would
    # After expiry, the gift no longer shelters them.
    report = sweep(tmp_path, today=date(2027, 5, 2), apply=False)
    assert "cl-gift" in {m["client_id"] for m in report["would_move"]}
