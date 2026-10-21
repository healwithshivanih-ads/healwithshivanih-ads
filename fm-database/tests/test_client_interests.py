"""Client.interests + marketing opt-out (2026-10-21).

The coach app writes these from TypeScript (lib/fmdb/interests.ts). Python must
load them in both shapes js-yaml and PyYAML produce, and keep them on a
round-trip — a field that silently vanished on the next Python save would make
the coach's dismissed concerns come back.
"""
from datetime import date, datetime

import yaml

from fmdb.plan.models import Client, InterestSignal


def _base() -> dict:
    now = datetime(2026, 10, 21, 10, 0, 0)
    return {
        "client_id": "cl-test",
        "intake_date": "2026-10-21",
        "sex": "other",
        "created_at": now,
        "updated_at": now,
        "updated_by": "test",
    }


def test_interests_load_from_ts_written_yaml():
    doc = _base()
    doc["interests"] = [
        {"concern": "gut", "source": "booking_form", "at": "2026-10-01", "detail": "Bloating"},
        {"concern": "thyroid", "source": "coach", "at": date(2026, 10, 2), "dismissed": True},
    ]
    doc["marketing_opt_out"] = True
    c = Client(**doc)
    assert [i.concern for i in c.interests] == ["gut", "thyroid"]
    assert c.interests[0].at == date(2026, 10, 1)
    assert c.interests[1].dismissed is True
    assert c.marketing_opt_out is True


def test_interests_survive_a_python_round_trip():
    doc = _base()
    doc["interests"] = [{"concern": "gut", "source": "booking_form", "at": "2026-10-01", "detail": "Bloating"}]
    c = Client(**doc)
    again = Client(**yaml.safe_load(yaml.safe_dump(c.model_dump(mode="json"))))
    assert again.interests[0].detail == "Bloating"
    assert again.interests[0].concern == "gut"


def test_defaults_leave_old_records_unchanged():
    c = Client(**_base())
    assert c.interests == []
    assert c.marketing_opt_out is False
    assert InterestSignal(concern="gut").dismissed is False
