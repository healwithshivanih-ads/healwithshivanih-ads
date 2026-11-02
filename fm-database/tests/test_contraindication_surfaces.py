"""One answer on every surface that tests a supplement against a client.

check_plan moved onto supplement_clash.py first. The author gate, the supplement
check widget and the plan editor banner each kept a weaker comparison of their own,
so the same client could pass one door and fail the next: an exact-string miss at
the gate, or a substring hit on "pan" in "thyroid panel". These tests pin that all
three now ask the shared matcher, and keep what each surface MEANS by severity.
"""

import importlib.util
import re
from datetime import date, datetime
from pathlib import Path

import pytest

from fmdb.assess.author_gate import validate
from fmdb.plan.checker import check_plan
from fmdb.plan.client_fit import catalogue_flags, fit_requirements
from fmdb.plan.models import CatalogueSnapshot, Client, Plan, SupplementItem
from fmdb.validator import load_all, overlay

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "fm-database" / "data"
GATE = ROOT / "fm-database" / "fmdb" / "assess" / "author_gate.py"
WIDGET = ROOT / "fm-database-web" / "scripts" / "check-supplement-for-client.py"

CLASH_CODES = {
    "contraindicated_condition",
    "contraindicated_medication",
    "contraindication_to_check",
    "medication_interaction",
}


@pytest.fixture(scope="module")
def cat():
    return overlay(load_all(DATA))


@pytest.fixture(scope="module")
def widget():
    spec = importlib.util.spec_from_file_location("check_supplement_for_client", WIDGET)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def client(**over):
    base = dict(
        client_id="cl-t",
        display_name="T",
        intake_date=date(2026, 1, 1),
        sex="F",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        updated_by="test",
    )
    return Client(**{**base, **over})


def gate(cat, slug, who, change="continue"):
    report = validate(
        {"supplement_suggestions": [{"supplement_slug": slug, "continue_or_change": change}]},
        cat=cat,
        client=who.model_dump(),
    )
    return (
        [f for f in report.hard_failures if f.code in CLASH_CODES],
        [f for f in report.warnings if f.code in CLASH_CODES],
    )


def supp(cat, slug):
    return next(s for s in cat.supplements if s.slug == slug)


def remedy(cat, slug):
    return next(h for h in cat.home_remedies if h.slug == slug)


GERD = {"active_conditions": ["GERD / acid reflux"]}
SUSPECTED = {"active_conditions": ["Suspected: GERD"]}
HISTORY = {"medical_history": ["GERD, 2019"]}


# ---------- the author gate ----------


def test_gate_meets_the_record_the_exact_string_never_did(cat):
    hard, _ = gate(cat, "betaine-hcl", client(**GERD))
    assert [f.code for f in hard] == ["contraindicated_condition"]
    assert "gerd / acid reflux" in hard[0].message


@pytest.mark.parametrize("record", [SUSPECTED, HISTORY])
def test_gate_never_refuses_on_a_soft_hit(cat, record):
    # HARD refuses the save and the chat path has no override.
    hard, warned = gate(cat, "betaine-hcl", client(**record))
    assert hard == []
    assert [f.code for f in warned] == ["contraindication_to_check"]


def test_gate_refuses_a_named_drug_and_asks_about_an_unnamed_one(cat):
    # v0.91: an unnamed "blood thinner" could be either record, so it is asked.
    # check_plan can gate it because the coach has a row to answer. The gate has none.
    named, _ = gate(cat, "vitaone-d3", client(current_medications=["Acitrom 2 mg"]))
    assert [f.code for f in named] == ["contraindicated_medication"]

    hard, warned = gate(cat, "vitaone-d3", client(current_medications=["blood thinner"]))
    assert hard == []
    assert [f.code for f in warned] == ["contraindicated_medication"]
    assert "which drug" in warned[0].message


def test_gate_does_not_refuse_taking_it_off(cat):
    # "stop" is the right answer to a clash. Widening the match must not block it.
    assert gate(cat, "betaine-hcl", client(**GERD), change="stop") == ([], [])


@pytest.mark.parametrize("meds", [
    ["recheck thyroid panel"],              # "pan" is Pan-40, not a panel
    ["Acitrom 2 mg - stopped"],             # a drug no longer taken
    ["Acitrom eye drops"],                  # not swallowed
])
def test_gate_keeps_the_false_alarms_out(cat, meds):
    assert gate(cat, "vitaone-d3", client(current_medications=meds)) == ([], [])


def test_gate_still_reads_the_older_medications_key(cat):
    who = client().model_dump()
    who["medications"] = ["Acitrom 2 mg"]
    report = validate(
        {"supplement_suggestions": [{"supplement_slug": "vitaone-d3"}]}, cat=cat, client=who
    )
    assert [f.code for f in report.hard_failures] == ["contraindicated_medication"]


# ---------- the supplement check widget ----------


def test_widget_says_avoid_only_on_a_firm_hit(cat, widget):
    firm = widget.clash_cautions(supp(cat, "betaine-hcl"), "supplement", client(**GERD), cat)
    assert [c["severity"] for c in firm] == ["avoid"]
    soft = widget.clash_cautions(supp(cat, "betaine-hcl"), "supplement", client(**SUSPECTED), cat)
    assert [c["severity"] for c in soft] == ["caution"]


def test_widget_asks_about_an_unnamed_blood_thinner(cat, widget):
    named = client(current_medications=["Acitrom 2 mg"])
    unnamed = client(current_medications=["blood thinner"])
    d3 = supp(cat, "vitaone-d3")
    assert [c["severity"] for c in widget.clash_cautions(d3, "supplement", named, cat)] == ["avoid"]
    asked = widget.clash_cautions(d3, "supplement", unnamed, cat)
    assert [c["severity"] for c in asked] == ["caution"]
    assert not asked[0]["detail"].startswith("Contraindicated")


def test_widget_substring_false_alarm_is_gone(cat, widget):
    # bidirectional substring read the client's "Pan" inside any longer word
    who = client(current_medications=["recheck thyroid panel"])
    assert widget.clash_cautions(supp(cat, "vitaone-d3"), "supplement", who, cat) == []


def test_widget_meets_a_home_remedy_drug_named_only_in_brackets(cat, widget):
    # cl-019's shape: the line names dienogest only inside its brackets.
    who = client(current_medications=["Dinogest 2 mg"])
    for slug in ("ashokarishta", "seed-cycling"):
        got = widget.clash_cautions(remedy(cat, slug), "home_remedy", who, cat)
        assert got and {c["severity"] for c in got} == {"caution"}, slug


def test_widget_asks_an_unnamed_blood_thinner_about_aspirin(cat, widget):
    # cl-023: "blood thinner" and nothing more; the tea line names aspirin.
    who = client(current_medications=["blood thinner"])
    tea = remedy(cat, "ginger-cinnamon-lemongrass-cold-tea")
    assert widget.clash_cautions(tea, "home_remedy", who, cat)


def test_widget_a_home_remedy_never_says_avoid(cat, widget):
    who = client(active_conditions=["Type 2 diabetes", "GERD"], current_medications=["Omez 20"])
    for h in cat.home_remedies:
        assert {c["severity"] for c in widget.clash_cautions(h, "home_remedy", who, cat)} <= {"caution"}


def test_home_remedy_vocabulary_reads_the_right_illness(cat, widget):
    t2 = client(active_conditions=["Type 2 diabetes"])
    hits = [
        c["detail"] for h in cat.home_remedies
        for c in widget.clash_cautions(h, "home_remedy", t2, cat)
    ]
    assert any("diabetes" in d for d in hits)
    assert not any("gestational diabetes" in d or "type 1 diabetes" in d for d in hits)

    endo = client(active_conditions=["Endometriosis"])
    shatavari = remedy(cat, "shatavari-kalpa-lactation-tonic")
    assert widget.clash_cautions(shatavari, "home_remedy", endo, cat)


# ---------- one answer ----------


@pytest.mark.parametrize("slug,record", [
    ("betaine-hcl", GERD),
    ("betaine-hcl", SUSPECTED),
    ("betaine-hcl", HISTORY),
    ("vitaone-d3", {"current_medications": ["Acitrom 2 mg"]}),
    ("vitaone-d3", {"current_medications": ["Acitrom eye drops"]}),
    ("ashwagandha", {"active_conditions": ["Suspected: Graves disease"]}),
])
def test_all_three_surfaces_agree(cat, widget, slug, record):
    who = client(**record)
    entry = supp(cat, slug)
    flags = catalogue_flags(entry, who, cat)
    firm = sum(1 for f in flags if not f["soft"])

    hard, warned = gate(cat, slug, who)
    assert len(hard) == firm
    assert len(warned) == len(flags) - firm

    cautions = widget.clash_cautions(entry, "supplement", who, cat)
    assert sum(c["severity"] == "avoid" for c in cautions) == firm
    assert len(cautions) == len(flags)


def test_the_editor_banner_contract_with_check_plan(cat):
    # open-contraindications.ts joins these two on `<slug>:<flag id>` and reads
    # `field`. Change either side and the banner goes quietly empty.
    now = datetime(2026, 1, 1)
    plan = Plan(
        slug="p",
        client_id="cl-t",
        plan_period_start=date(2026, 1, 1),
        plan_period_weeks=12,
        plan_period_recheck_date=date(2026, 3, 26),
        primary_topics=[],
        status="draft",
        version=1,
        created_at=now,
        updated_at=now,
        updated_by="test",
        catalogue_snapshot=CatalogueSnapshot(snapshot_date=date(2026, 1, 1)),
        supplement_protocol=[SupplementItem(supplement_slug="betaine-hcl")],
    )
    who = client(**GERD)
    need = fit_requirements(plan, who, {}, lambda *_: None, catalogue=cat)[0]
    flag = next(f for f in need["flags"] if f.get("field") == "contraindications")
    assert "soft" in flag
    targets = {
        f.target for f in check_plan(plan, who, cat) if f.section == "client_fit"
    }
    assert f"{need['item']}:{flag['id']}" in targets


# ---------- going back to a private comparison fails here ----------


@pytest.mark.parametrize("source,banned", [
    (GATE, r"_norm\(cond\) in conds"),
    (GATE, r"cname in m\b"),
    (GATE, r"med_name in m\b"),
    (WIDGET, r"def _hits\b"),
    (WIDGET, r"\bin hl\b"),
])
def test_no_surface_compares_for_itself(source, banned):
    assert re.search(banned, source.read_text()) is None
