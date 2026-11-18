"""A marker rebuild must not lose or corrupt what the coach already has.

Found on the in-care rebuild of 18 Nov 2026: a same-day HbA1c of 5.8 % read as
a haemoglobin of 5.8 g/dL, RBC folate 448 replaced a deficient serum folate of
3.9, nine hand-entered markers vanished, and 152 written interpretations were
replaced by the engine's generic line.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import yaml

from fmdb.assess.lab_ratios import compute_ratios
from fmdb.assess.marker_merge import merge_markers

D = "2026-07-06"


def _by_name(markers):
    return {m["marker_name"]: m for m in markers}


# ── pickers ────────────────────────────────────────────────────────────────

def test_hba1c_never_reads_as_haemoglobin():
    labs = [
        {"test_name": "HbA1c (Glycosylated Hemoglobin)", "value": "5.8", "unit": "%", "date_drawn": D},
        {"test_name": "Hemoglobin", "value": "12.2", "unit": "g/dL", "date_drawn": D},
    ]
    m = _by_name(compute_ratios(labs))
    assert m["Hemoglobin"]["value"] == 12.2
    assert m["HbA1c"]["value"] == 5.8


def test_hba1c_alone_gives_no_haemoglobin():
    labs = [{"test_name": "Hb A1c", "value": "6.1", "unit": "%", "date_drawn": D}]
    assert "Hemoglobin" not in _by_name(compute_ratios(labs))


def test_mch_and_mchc_are_not_haemoglobin():
    labs = [
        {"test_name": "Mean Corpuscular Hemoglobin (MCH)", "value": "29", "date_drawn": D},
        {"test_name": "Mean Corpuscular Hemoglobin Concentration", "value": "33", "date_drawn": D},
    ]
    assert "Hemoglobin" not in _by_name(compute_ratios(labs))


def test_plain_hb_spellings_still_read():
    for name in ("Hemoglobin", "Haemoglobin", "Hb", "HGB"):
        m = _by_name(compute_ratios([{"test_name": name, "value": "13.1", "date_drawn": D}]))
        assert m["Hemoglobin"]["value"] == 13.1, name


def test_rbc_folate_is_not_serum_folate():
    labs = [
        {"test_name": "Folate", "value": "3.9", "date_drawn": "2026-07-01"},
        {"test_name": "RBC folate", "value": "448.4", "date_drawn": "2026-08-10"},
    ]
    m = _by_name(compute_ratios(labs))
    assert m["Folate"]["value"] == 3.9
    assert m["Folate"]["flag"] != "optimal"
    # RBC folate is not consumed by the serum picker, so it passes through.
    assert any("rbc folate" in n.lower() for n in m)


def test_haemolysate_folate_is_not_serum_folate():
    labs = [{"test_name": "Hemolysate folate", "value": "512", "date_drawn": D}]
    assert "Folate" not in _by_name(compute_ratios(labs))


def test_folic_acid_still_reads_as_folate():
    m = _by_name(compute_ratios([{"test_name": "Folic Acid", "value": "7.8", "date_drawn": D}]))
    assert m["Folate"]["value"] == 7.8


# ── merge ──────────────────────────────────────────────────────────────────

def _mk(name, value, text="engine text", computed=False, panel="Thyroid"):
    return {"marker_name": name, "value": value, "unit": "", "reference_range": "",
            "flag": "optimal", "fm_interpretation": text, "panel": panel, "computed": computed}


def test_hand_entered_marker_survives_a_rebuild():
    old = [_mk("RBC folate", 448.4, "hand-written: confirms true deficiency", panel="Key Nutrients")]
    new = [_mk("Folate", 3.9, panel="Key Nutrients")]
    out = _by_name(merge_markers(old, new))
    assert set(out) == {"Folate", "RBC folate"}
    assert out["RBC folate"]["fm_interpretation"].startswith("hand-written")


def test_unchanged_value_keeps_its_written_text():
    old = [_mk("TSH", 2.1, "coach wrote this")]
    new = [_mk("TSH", 2.1, "TSH 2.1: FM optimal")]
    assert merge_markers(old, new)[0]["fm_interpretation"] == "coach wrote this"


def test_changed_value_gets_fresh_text():
    old = [_mk("TSH", 2.1, "coach wrote this")]
    new = [_mk("TSH", 4.6, "TSH 4.6: raised")]
    out = merge_markers(old, new)
    assert len(out) == 1
    assert out[0]["value"] == 4.6
    assert out[0]["fm_interpretation"] == "TSH 4.6: raised"


def test_other_spelling_with_same_value_is_one_marker():
    old = [_mk("Anti-TPO antibodies", 11.6, "negative: closes the gap")]
    new = [_mk("TPO antibodies", 11.6)]
    out = merge_markers(old, new)
    assert [m["marker_name"] for m in out] == ["TPO antibodies"]
    assert out[0]["fm_interpretation"] == "negative: closes the gap"


def test_shared_word_but_different_value_stays_separate():
    old = [_mk("Anti-thyroglobulin antibodies", 1.2)]
    new = [_mk("Thyroglobulin", 18.0)]
    assert len(merge_markers(old, new)) == 2


def test_stale_computed_marker_is_dropped():
    old = [_mk("LH/FSH ratio", 2.4, computed=True)]
    new = [_mk("TSH", 2.0)]
    assert [m["marker_name"] for m in merge_markers(old, new)] == ["TSH"]


def test_exact_name_wins_over_a_looser_match():
    old = [_mk("Free T3", 3.1, "ft3 text"), _mk("Total T3", 3.1, "tt3 text")]
    new = [_mk("Total T3", 3.1)]
    out = _by_name(merge_markers(old, new))
    assert out["Total T3"]["fm_interpretation"] == "tt3 text"
    assert "Free T3" in out


def test_empty_inputs():
    assert merge_markers(None, None) == []
    assert merge_markers([_mk("TSH", 2)], []) == [_mk("TSH", 2)]


# ── the rebuild script end to end ──────────────────────────────────────────

def test_recompute_script_keeps_hand_markers(tmp_path):
    root = tmp_path / "plans"
    cdir = root / "clients" / "cl-test"
    cdir.mkdir(parents=True)
    client = {
        "client_id": "cl-test",
        "lab_markers": [_mk("Anti-TPO antibodies", 11.6, "hand: negative"),
                        _mk("Hemoglobin", 12.2, "hand: fine", panel="Iron & Blood")],
        "health_snapshots": [{"date": D, "lab_values": [
            {"test_name": "HbA1c (Glycosylated Hemoglobin)", "value": "5.8", "unit": "%"},
            {"test_name": "Hemoglobin", "value": "12.2", "unit": "g/dL"},
        ]}],
    }
    (cdir / "client.yaml").write_text(yaml.safe_dump(client), encoding="utf-8")
    script = Path(__file__).resolve().parents[2] / "fm-database-web" / "scripts" / "recompute-lab-markers.py"
    r = subprocess.run(
        [sys.executable, str(script)], input=json.dumps({"client_id": "cl-test"}),
        capture_output=True, text=True, env={**os.environ, "FMDB_PLANS_DIR": str(root)}, timeout=60,
    )
    assert json.loads(r.stdout)["ok"], r.stderr
    out = _by_name(yaml.safe_load((cdir / "client.yaml").read_text())["lab_markers"])
    assert out["Anti-TPO antibodies"]["fm_interpretation"] == "hand: negative"
    assert out["Hemoglobin"]["value"] == 12.2
    assert out["Hemoglobin"]["fm_interpretation"] == "hand: fine"
    assert out["HbA1c"]["value"] == 5.8
