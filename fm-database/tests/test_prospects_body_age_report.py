"""A body age report buyer is not parked while the session price in their report is still open.

The report's PDF and email carry a personal pay link and a last date. Parking moves the record to prospects/,
which drops it off the public server and kills that link."""
from datetime import date

import yaml

from fmdb.plan import prospects

TODAY = date(2027, 2, 1)


def _person(root, cid, **extra):
    d = root / "clients" / cid
    (d / "sessions").mkdir(parents=True)
    rec = {"client_id": cid, "display_name": cid, "intake_date": "2027-01-03", "created_at": "2027-01-03T00:00:00Z",
           "engagement_status": "pending", **extra}
    (d / "client.yaml").write_text(yaml.safe_dump(rec))


def test_buyer_inside_the_window_is_kept_and_parked_after_it(tmp_path):
    _person(tmp_path, "cl-801", body_age_reports=[{"report_no": "BA-1", "credit_until": "2027-02-01"}])    # last day
    _person(tmp_path, "cl-802", body_age_reports=[{"report_no": "BA-2", "credit_until": "2027-01-31"}])    # a day over
    _person(tmp_path, "cl-803", body_age_report_kind="deeper", body_age_report_date="2027-01-20")           # fields only
    _person(tmp_path, "cl-804")                                                                             # no report
    out = prospects.sweep(tmp_path, today=TODAY, apply=True)
    kept = {r["client_id"]: r["reason"] for r in out["kept"]}
    assert "cl-801" in kept and "body age report" in kept["cl-801"]
    assert "cl-803" in kept and "2027-02-03" in kept["cl-803"]
    assert (tmp_path / "clients" / "cl-801").is_dir() and (tmp_path / "clients" / "cl-803").is_dir()
    assert (tmp_path / "prospects" / "cl-802").is_dir() and (tmp_path / "prospects" / "cl-804").is_dir()


def test_the_window_matches_the_price_rule():
    # foundation-orders.ts::BODY_AGE_CREDIT_DAYS; change both together.
    assert prospects.BODY_AGE_CREDIT_DAYS == 14
