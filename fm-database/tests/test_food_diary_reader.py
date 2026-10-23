"""Food diary phase 2 — the photo reader and the summary writer, as failable tests.

- Unread photos are found by the same fold as food-diary.ts (deleted and
  already-read photos are skipped).
- FM_API_OK off → no call, nothing written, photos stay queued (not lost).
- A low-confidence / not-food answer is stored as unreadable (→ the coach);
  a confident one as readable with balance words only.
- The confidence bar matches the TypeScript one.
- The summary writer keeps ONE session per diary and updates it in place.

Run: python -m pytest tests/test_food_diary_reader.py   (from fm-database/)
"""

import importlib.util
import io
import json
import re
import sys
from pathlib import Path

import yaml

WEB = Path(__file__).resolve().parents[2] / "fm-database-web"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), WEB / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.path.insert(0, str(WEB / "scripts"))
    spec.loader.exec_module(mod)
    return mod


def _client(tmp_path: Path) -> Path:
    person = tmp_path / "clients" / "cl-1"
    (person / "files" / "diary").mkdir(parents=True)
    (person / "client.yaml").write_text(yaml.safe_dump({"client_id": "cl-1", "dietary_preference": "Vegetarian"}))
    (person / "files" / "diary" / "a.jpg").write_bytes(b"\xff\xd8\xff")
    (person / "files" / "diary" / "b.jpg").write_bytes(b"\xff\xd8\xff")
    lines = [
        {"op": "add", "diary_id": "fd-1", "ts": "2026-10-23T03:00:00Z", "entry_id": "a", "date": "2026-10-23",
         "time": "08:30", "band": "morning", "photo": "a.jpg", "note": "homemade"},
        {"op": "add", "diary_id": "fd-1", "ts": "2026-10-23T07:00:00Z", "entry_id": "b", "date": "2026-10-23",
         "time": "13:00", "band": "midday", "photo": "b.jpg", "note": ""},
        {"op": "add", "diary_id": "fd-1", "ts": "2026-10-23T08:00:00Z", "entry_id": "c", "date": "2026-10-23",
         "time": "14:00", "band": "midday", "photo": "c.jpg", "note": ""},
        {"op": "delete", "diary_id": "fd-1", "ts": "2026-10-23T09:00:00Z", "entry_id": "c"},
    ]
    (person / "_food_diary.fly.jsonl").write_text("".join(json.dumps(l) + "\n" for l in lines))
    (person / "_food_diary.mac.jsonl").write_text(
        json.dumps({"op": "read", "diary_id": "fd-1", "ts": "2026-10-23T10:00:00Z", "entry_id": "b",
                    "reading": {"readable": True}}) + "\n"
    )
    return person


def _run(mod, monkeypatch, payload: dict) -> dict:
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(payload)))
    out = io.StringIO()
    monkeypatch.setattr(sys, "stdout", out)
    assert mod.main() == 0
    return json.loads(out.getvalue())


def test_unread_skips_deleted_and_already_read(tmp_path):
    mod = _load("read-diary-photos")
    person = _client(tmp_path)
    unread = mod.unread_entries(mod.read_lines(person), "fd-1")
    assert [e["entry_id"] for e in unread] == ["a"]


def test_not_authorized_makes_no_call_and_writes_nothing(tmp_path, monkeypatch):
    mod = _load("read-diary-photos")
    person = _client(tmp_path)
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    monkeypatch.delenv("FM_API_OK", raising=False)
    before = (person / "_food_diary.mac.jsonl").read_text()
    res = _run(mod, monkeypatch, {"clients": [{"client_id": "cl-1", "diary_id": "fd-1"}]})
    assert res["api_blocked"] is True and res["queued"] == 1 and res["read"] == 0
    assert (person / "_food_diary.mac.jsonl").read_text() == before, "a blocked run must not write"
    # Still queued for the next authorized run — not lost.
    assert [e["entry_id"] for e in mod.unread_entries(mod.read_lines(person), "fd-1")] == ["a"]


def test_dry_run_appends_one_read_line_to_the_mac_file(tmp_path, monkeypatch):
    mod = _load("read-diary-photos")
    person = _client(tmp_path)
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    res = _run(mod, monkeypatch, {"clients": [{"client_id": "cl-1", "diary_id": "fd-1"}], "dry_run": True})
    assert res["read"] == 1 and res["queued"] == 0
    last = json.loads((person / "_food_diary.mac.jsonl").read_text().strip().splitlines()[-1])
    assert last["op"] == "read" and last["entry_id"] == "a"
    assert set(last["reading"]["balance"]) == {"protein", "veg", "carbs"}
    assert mod.unread_entries(mod.read_lines(person), "fd-1") == []


def test_low_confidence_or_not_food_is_unreadable():
    mod = _load("read-diary-photos")
    good = {"is_food_or_drink": True, "readable": True, "confidence": 0.8,
            "dishes": [{"name": "poha", "count": 1, "size": "regular"}],
            "balance": {"protein": "none", "veg": "light", "carbs": "heavy"}, "reason": ""}
    r = mod.normalise_reading(good)
    assert r["readable"] is True and r["balance"]["carbs"] == "heavy"
    assert mod.normalise_reading({**good, "confidence": 0.3})["readable"] is False
    nf = mod.normalise_reading({**good, "is_food_or_drink": False, "reason": ""})
    assert nf["readable"] is False and nf["reason"] == "not food" and nf["dishes"] == []
    assert "balance" not in nf, "an unreadable plate must not carry marks to the client"
    # Junk is clamped, not trusted.
    odd = mod.normalise_reading({**good, "dishes": [{"name": "dal", "count": 40, "size": "huge"}, "x"],
                                 "balance": {"protein": "lots", "veg": "present", "carbs": "heavy"}})
    assert odd["dishes"] == [{"name": "dal", "count": 6, "size": "regular"}]
    assert "balance" not in odd, "no valid protein word → no marks at all"
    partial = mod.normalise_reading({**good, "balance": {"protein": "present", "veg": "lots", "carbs": "heavy"}})
    assert partial["balance"] == {"protein": "present", "carbs": "heavy"}


def test_confidence_bar_matches_typescript():
    mod = _load("read-diary-photos")
    ts = (WEB / "src" / "lib" / "fmdb" / "food-diary.ts").read_text()
    m = re.search(r"DIARY_READ_MIN_CONFIDENCE = ([0-9.]+)", ts)
    assert m and float(m.group(1)) == mod.MIN_CONFIDENCE


def test_reader_goes_through_the_cost_guard():
    src = (WEB / "scripts" / "read-diary-photos.py").read_text()
    assert "build_client" in src and "api_authorized" in src
    assert "Anthropic(" not in src, "build the client through anthropic_client.build_client only"


def test_summary_is_one_session_per_diary_updated_in_place(tmp_path, monkeypatch):
    mod = _load("save-food-diary-summary")
    (tmp_path / "clients" / "cl-1").mkdir(parents=True)
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    first = _run(mod, monkeypatch, {"client_id": "cl-1", "summary": {"diary_id": "fd-1", "days": 3, "line": "~38 g"}})
    second = _run(mod, monkeypatch, {"client_id": "cl-1", "summary": {"diary_id": "fd-1", "days": 3, "line": "~42 g"}})
    assert first["updated"] is False and second["updated"] is True
    assert first["session_id"] == second["session_id"]
    files = list((tmp_path / "clients" / "cl-1" / "sessions").glob("*-app-fooddiary.yaml"))
    assert len(files) == 1
    d = yaml.safe_load(files[0].read_text())
    assert d["food_diary_summary"]["line"] == "~42 g"
    assert "[source: app_food_diary]" in d["presenting_complaints"]
    from fmdb.plan.models import Session

    Session(**d)  # the record loads like any other session


def test_assess_reads_the_summary(tmp_path):
    mod = _load("assess")
    (tmp_path / "clients" / "cl-1" / "sessions").mkdir(parents=True)
    from datetime import date

    (tmp_path / "clients" / "cl-1" / "sessions" / f"{date.today()}-001-app-fooddiary.yaml").write_text(
        yaml.safe_dump({"date": str(date.today()), "food_diary_summary": {"diary_id": "fd-1", "line": "~38 g", "days": 3}})
    )
    got = mod._load_food_diary_summary(tmp_path, "cl-1")
    assert got and got["summary"] == "~38 g"
