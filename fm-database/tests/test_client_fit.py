"""A protocol is a template: the plan must be tested against the client.

Shape of the failure these pin: Shweta (cl-906) was given digestive enzymes
because the 5R protocol lists them, with daily reflux on record and a mushroom
and yeast allergy against a mould-fermented product.
"""

from datetime import date, datetime

from fmdb.plan.checker import _resolve_product, check_plan
from fmdb.plan.client_fit import MIN_ANSWER_CHARS, fit_requirements, load_screens, screen_hits
from fmdb.plan.models import CatalogueSnapshot, Client, ClientFitItem, Plan, SupplementItem
from fmdb.validator import Loaded

SHWETA = dict(
    client_id="cl-t",
    display_name="T",
    intake_date=date(2026, 1, 1),
    sex="F",
    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
    updated_by="test",
    active_conditions=["GERD / acid reflux"],
    current_medications=["omez 20"],
    known_allergies=["Milk, mushrooms, tomatoes, yeast"],
)
LINKS = {
    "enzyme": {
        "source": "vitaone",
        "covers": ["digestive-enzymes"],
        "display_name": "Digestive Enzyme",
        "url": "https://vitaone.in/x",
        "ingredients": "DigeZyme multienzyme complex 150 mg",
    },
    "protein": {
        "source": "vitaone",
        "covers": ["plant-based-protein-powder"],
        "display_name": "Rebuild",
        "url": "https://vitaone.in/y",
        "ingredients": "Pea protein, DigeZyme digestive enzyme",
    },
}
GOOD = "A real, specific sentence about this one client."
assert len(GOOD) >= MIN_ANSWER_CHARS


def client(**over):
    return Client(**{**SHWETA, **over})


def plan(supplements=("digestive-enzymes",), protocols=("5r-gut-protocol",), status="draft", fit=()):
    return Plan(
        slug="p",
        client_id="cl-t",
        status=status,
        attached_protocols=list(protocols),
        supplement_protocol=[SupplementItem(supplement_slug=s) for s in supplements],
        client_fit=list(fit),
        plan_period_start=date(2026, 1, 1),
        plan_period_weeks=12,
        plan_period_recheck_date=date(2026, 3, 26),
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        updated_by="test",
        catalogue_snapshot=CatalogueSnapshot(git_sha="x", snapshot_date=date(2026, 1, 1)),
    )


def findings(p, c, monkeypatch):
    monkeypatch.setattr("fmdb.plan.checker._load_supplement_links", lambda: LINKS)
    return [f for f in check_plan(p, c, Loaded()) if f.section == "client_fit"]


def row(item, **over):
    return ClientFitItem(**{"item": item, "client_evidence": GOOD, "risk_check": GOOD, **over})


def test_untested_protocol_plan_cannot_leave_draft(monkeypatch):
    got = findings(plan(), client(), monkeypatch)
    assert {f.severity for f in got} == {"CRITICAL"}
    assert {f.target.split(":")[0] for f in got} == {"5r-gut-protocol", "digestive-enzymes"}


def test_answering_both_questions_clears_the_gate(monkeypatch):
    fit = [row("5r-gut-protocol"), row("digestive-enzymes")]
    assert findings(plan(fit=fit), client(), monkeypatch) == []


def test_a_placeholder_answer_does_not_count(monkeypatch):
    fit = [row("5r-gut-protocol"), row("digestive-enzymes", client_evidence="per protocol")]
    got = findings(plan(fit=fit), client(), monkeypatch)
    assert got and all(f.severity == "CRITICAL" for f in got)


def test_marked_drop_but_still_in_the_plan_is_refused(monkeypatch):
    fit = [row("5r-gut-protocol"), row("digestive-enzymes", decision="drop")]
    got = findings(plan(fit=fit), client(), monkeypatch)
    assert [f.field for f in got] == ["decision"]


def test_a_screen_reaches_a_plan_with_no_protocol(monkeypatch):
    got = findings(plan(protocols=()), client(), monkeypatch)
    assert got and all(f.field == "screen" for f in got)


def test_no_protocol_and_no_clash_asks_for_nothing(monkeypatch):
    calm = client(active_conditions=["Hypothyroidism"], current_medications=[], known_allergies=[])
    assert findings(plan(protocols=()), calm, monkeypatch) == []


def test_live_plans_warn_and_are_not_re_gated(monkeypatch):
    got = findings(plan(status="published"), client(), monkeypatch)
    assert got and {f.severity for f in got} == {"WARNING"}
    assert all(f.field == "screen" for f in got)


def test_a_lapsed_clients_old_plan_raises_nothing(monkeypatch):
    gone = client(engagement_status="lapsed")
    assert findings(plan(status="published"), gone, monkeypatch) == []


def test_lapsing_does_not_excuse_a_new_draft(monkeypatch):
    """A win-back plan is a new plan and is tested like any other."""
    gone = client(engagement_status="lapsed")
    assert findings(plan(), gone, monkeypatch)


def test_screens_read_the_real_product_not_the_plan_line():
    """The protein powder says nothing about enzymes on the plan."""
    need = fit_requirements(
        plan(supplements=("plant-based-protein-powder",), protocols=()),
        client(),
        LINKS,
        _resolve_product,
    )
    assert {f["id"] for f in need[0]["flags"]} == {
        "enzymes-reflux-or-irritated-stomach",
        "mould-fermented-enzymes-with-fungal-allergy",
    }


def test_term_matching_does_not_catch_lookalikes():
    screens = load_screens()
    panel = client(
        active_conditions=["Ulcerative colitis"],
        current_medications=["Annual thyroid panel"],
        known_allergies=[],
    )
    assert screen_hits("digestive-enzymes", "", panel, screens) == []
