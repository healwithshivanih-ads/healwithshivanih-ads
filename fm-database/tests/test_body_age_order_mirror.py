"""Body age report orders are placed and paid on the public server and worked on the coach's Mac.

The copy from the public server's folder to the Mac's must bring a new order and a payment across, and must
never overwrite an order the coach has already started working."""
import importlib.util
from pathlib import Path

import yaml

_STAGING = Path(__file__).resolve().parents[2] / "fm-database-web" / "scripts" / "app-staging-action.py"


def _mod():
    spec = importlib.util.spec_from_file_location("app_staging_action", _STAGING)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _put(root: Path, name: str, **doc) -> Path:
    d = root / "body-age-orders"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{name}.yaml"
    f.write_text(yaml.safe_dump({"order_id": name, "kind": "body_age_report", **doc}))
    return f


def _status(root: Path, name: str):
    return yaml.safe_load((root / "body-age-orders" / f"{name}.yaml").read_text())


def test_new_orders_and_payments_come_across_and_worked_orders_are_left_alone(tmp_path):
    mod = _mod()
    auth, stag = tmp_path / "auth", tmp_path / "stag"
    auth.mkdir()
    _put(stag, "ba-20270105-aaaaaaaa", status="paid")                       # new to the Mac
    _put(stag, "ba-20270105-bbbbbbbb", status="paid", razorpay_payment_id="pay_1")
    _put(auth, "ba-20270105-bbbbbbbb", status="pending")                    # Mac saw it before it was paid
    _put(stag, "ba-20270105-cccccccc", status="paid")
    _put(auth, "ba-20270105-cccccccc", status="booked", client_ids=["cl-950"], booked_for="2027-01-08")
    _put(stag, "ba-20270105-dddddddd", status="pending")
    _put(auth, "ba-20270105-dddddddd", status="pending", note="mac copy")
    (stag / "body-age-orders" / "notes.txt").write_text("not an order")

    out = {"errors": []}
    mod._mirror_body_age_orders(yaml, auth, stag, out)

    assert out["errors"] == []
    assert out["body_age_orders_mirrored"] == 2
    assert _status(auth, "ba-20270105-aaaaaaaa")["status"] == "paid"
    assert _status(auth, "ba-20270105-bbbbbbbb")["razorpay_payment_id"] == "pay_1"
    worked = _status(auth, "ba-20270105-cccccccc")
    assert worked["status"] == "booked" and worked["client_ids"] == ["cl-950"]      # never overwritten
    assert _status(auth, "ba-20270105-dddddddd")["note"] == "mac copy"
    assert not (auth / "body-age-orders" / "notes.txt").exists()

    again = {"errors": []}
    mod._mirror_body_age_orders(yaml, auth, stag, again)
    assert "body_age_orders_mirrored" not in again                                   # nothing left to bring


def test_no_orders_folder_is_not_an_error(tmp_path):
    out = {"errors": []}
    _mod()._mirror_body_age_orders(yaml, tmp_path / "auth", tmp_path / "stag", out)
    assert out == {"errors": []}


def test_refresh_runs_the_order_mirror():
    src = _STAGING.read_text()
    refresh = src[src.index("def _refresh("):]
    assert "_mirror_body_age_orders(yaml, auth, stag, out)" in refresh[:400]
