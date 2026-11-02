"""A supplement's contraindications are tested against the real client record.

Both halves of the failure are pinned here. The miss: exact string equality meant
"Active peptic or gastric ulcer, gastritis or erosive oesophagitis — ..." never met
"GERD / acid reflux", and "Shell cal 500, omez 20, restil 0.25" never met
"omeprazole", so these checks fired zero times across the live roster. The false
alarm: every guard below came from a real record that fired wrongly in measurement
before the rule existed. A check that cries wolf gets ignored.
"""

from datetime import date, datetime
from pathlib import Path

import pytest

from fmdb.drug_match import match_drug, match_drugs
from fmdb.plan.checker import check_plan
from fmdb.plan.client_fit import MIN_ANSWER_CHARS, fit_requirements
from fmdb.plan.models import CatalogueSnapshot, Client, ClientFitItem, Plan, SupplementItem
from fmdb.plan.supplement_clash import (
    active_medications,
    already_spaced,
    concepts_in_contraindication,
    condition_clashes,
    drug_records,
    fold,
    load_concepts,
    medication_hit,
)
from fmdb.validator import load_all

DATA = Path(__file__).resolve().parents[1] / "data"
GOOD = "A real, specific sentence about this one client."
assert len(GOOD) >= MIN_ANSWER_CHARS


@pytest.fixture(scope="module")
def cat():
    return load_all(DATA)


@pytest.fixture(scope="module")
def drugs(cat):
    return drug_records(cat)


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


def plan(slug, status="draft", **over):
    now = datetime(2026, 1, 1)
    base = dict(
        slug="p",
        client_id="cl-t",
        plan_period_start=date(2026, 1, 1),
        plan_period_weeks=12,
        plan_period_recheck_date=date(2026, 3, 26),
        primary_topics=[],
        status=status,
        version=1,
        created_at=now,
        updated_at=now,
        updated_by="test",
        catalogue_snapshot=CatalogueSnapshot(snapshot_date=date(2026, 1, 1)),
        supplement_protocol=[SupplementItem(supplement_slug=slug)],
    )
    return Plan(**{**base, **over})


def clash_findings(findings):
    return [f for f in findings if f.field == "contraindications"]


def hits(text, **over):
    return condition_clashes([text], client(**over), load_concepts())


# ---------- the miss the old exact match could never catch ----------


def test_gerd_meets_betaine_hcl_on_the_real_catalogue(cat):
    found = clash_findings(
        check_plan(plan("betaine-hcl"), client(active_conditions=["GERD / acid reflux"]), cat)
    )
    assert [f.severity for f in found] == ["CRITICAL"]
    assert "gerd / acid reflux" in found[0].detail


def test_one_comma_joined_string_is_every_drug_in_it(cat):
    meds = active_medications(
        client(current_medications=["Shell cal 500, omez 20, restil 0.25, melatonin 3mg"])
    )
    assert meds == ["shell cal 500", "omez 20", "restil 0.25", "melatonin 3mg"]


def test_a_brand_on_the_record_reaches_the_generic_in_the_catalogue(drugs):
    term = "omeprazole"
    hit = medication_hit(term, ["omez 20"], drugs, [term])
    assert hit and hit["med"] == "omez 20"


def test_interaction_fires_through_check_plan_on_a_joined_string(cat):
    slug = next(
        s.slug for s in cat.supplements
        if any(
            m.medication == "levothyroxine" and m.type.value == "space_by_hours"
            for m in s.interactions.with_medications
        )
    )
    found = [
        f for f in check_plan(
            plan(slug), client(current_medications=["Thyronorm 50, Shelcal 500"]), cat
        )
        if f.field == "interactions.with_medications"
    ]
    assert len(found) == 1 and found[0].severity == "WARNING"


def test_a_drug_inside_a_combination_brand_is_found(drugs):
    both = {d["slug"] for d in match_drugs("tazloc am (telmisartan + amlodipine)", drugs)}
    assert {"ace-inhibitors-arbs", "calcium-channel-blockers"} <= both
    # match_drug keeps only one of the two, which is why it cannot do this job.
    assert match_drug("tazloc am (telmisartan + amlodipine)", drugs)["slug"] in both


def test_an_allergy_is_read_from_known_allergies():
    got = hits("Fish or shellfish allergy — use algae-based oil", known_allergies=["Prawns, dust"])
    assert [h["concept"] for h in got] == ["shellfish-allergy"]


# ---------- published plans are not re-gated; the coach can always answer ----------


def test_published_plan_never_gets_a_critical(cat):
    who = client(active_conditions=["GERD / acid reflux"])
    found = clash_findings(check_plan(plan("betaine-hcl", status="published"), who, cat))
    assert [f.severity for f in found] == ["WARNING"]


def _spacing_slug(cat):
    return next(
        s.slug for s in cat.supplements
        if any(
            m.medication == "levothyroxine" and m.type.value == "space_by_hours"
            for m in s.interactions.with_medications
        )
    )


def test_a_lapsed_clients_old_plan_raises_nothing(cat):
    # Their plan sits in published/ forever and nobody is taking it.
    gone = client(
        engagement_status="lapsed",
        active_conditions=["GERD / acid reflux"],
        current_medications=["Thyronorm 50"],
    )
    for slug in ("betaine-hcl", _spacing_slug(cat)):
        found = check_plan(plan(slug, status="published"), gone, cat)
        assert [
            f for f in found
            if f.field in ("contraindications", "interactions.with_medications")
        ] == []


def test_a_returning_lapsed_client_is_still_tested_on_a_new_draft(cat):
    back = client(engagement_status="lapsed", active_conditions=["GERD / acid reflux"])
    assert [f.severity for f in clash_findings(check_plan(plan("betaine-hcl"), back, cat))] == [
        "CRITICAL"
    ]


def test_a_hit_is_a_row_in_the_panel_and_an_answer_clears_it(cat):
    who = client(active_conditions=["GERD / acid reflux"])
    p = plan("betaine-hcl")
    need = fit_requirements(p, who, {}, lambda *_: None, catalogue=cat)
    assert need[0]["item"] == "betaine-hcl" and need[0]["flags"]

    p.client_fit = [ClientFitItem(item="betaine-hcl", client_evidence=GOOD, risk_check=GOOD)]
    assert clash_findings(check_plan(p, who, cat)) == []


def test_soft_hit_warns_on_a_draft_and_never_blocks(cat):
    who = client(active_conditions=["Suspected: GERD"])
    found = clash_findings(check_plan(plan("betaine-hcl"), who, cat))
    assert found and {f.severity for f in found} == {"WARNING"}


def test_a_soft_flag_does_not_excuse_the_row_a_protocol_owes(cat):
    who = client(active_conditions=["Suspected: Graves disease"])
    p = plan("ashwagandha", attached_protocols=["5r-gut-protocol"])
    fields = [f.field for f in check_plan(p, who, cat) if f.severity == "CRITICAL"]
    assert "supplement" in fields


# ---------- the label on a record entry is what counts ----------


@pytest.mark.parametrize("entry", [
    "Hypothyroidism — do not trial betaine HCl until H. pylori and ulcer are excluded",
    "Ulcerative colitis",
    "Stress reactive eye pain (ulcer ruled out)",
])
def test_narrative_and_near_words_are_not_an_ulcer(entry):
    assert hits("Active peptic ulcer", active_conditions=[entry]) == []


def test_a_label_survives_an_initial_in_it():
    got = hits("Untreated H. pylori infection", active_conditions=["Possible H. pylori — coating"])
    assert got and got[0]["soft"]


def test_prediabetes_is_not_diabetes():
    for entry in ("Prediabetes (HbA1c 6.20%)", "Pre-diabetes — HbA1c 5.9%"):
        assert hits("type 2 diabetes", active_conditions=[entry]) == []


def test_hypothyroid_is_not_hyperthyroid():
    assert hits("Hyperthyroidism or Graves' disease", active_conditions=["Hypothyroidism"]) == []


def test_kidney_stones_are_not_kidney_disease():
    assert hits("chronic-kidney-disease", active_conditions=["Kidney stones"]) == []


def test_non_iron_deficiency_is_not_iron_deficiency():
    text = "Thalassaemia trait or other non-iron-deficiency microcytosis (common in India)"
    assert concepts_in_contraindication(text, load_concepts())[0]["id"] == "thalassemia"
    assert hits(text, active_conditions=["Iron-deficiency anaemia"]) == []


def test_the_catalogue_tail_names_other_illnesses_in_passing():
    text = "Hypothyroidism — carnitine blocks entry (used therapeutically in hyperthyroidism)"
    assert hits(text, active_conditions=["Graves disease"]) == []


def test_hashimoto_without_hypothyroidism_on_an_iodine_line_is_specific():
    text = "Hashimoto's / autoimmune thyroiditis — supra-physiological iodine"
    assert hits(text, active_conditions=["Hypothyroidism"]) == []
    assert hits(text, active_conditions=["Hashimoto's thyroiditis"])


def test_a_mild_record_is_no_answer_to_a_severe_line():
    assert hits("severe_kidney_disease", active_conditions=["Mild CKD G3a — eGFR 59"]) == []
    assert hits("Kidney impairment — avoid long courses", active_conditions=["Mild CKD G3a"])


def test_resolved_history_is_silent_and_live_history_is_soft():
    text = "Hyperthyroidism — raises T3"
    stamped = ["Hyperthyroid episode c.2016 — resolved over ~3 months"]
    assert hits(text, medical_history=stamped) == []
    assert hits(text, medical_history=["Graves disease, 2019"])[0]["soft"]


def test_a_hedged_catalogue_line_is_a_question():
    for text in (
        "Uncontrolled hypertension — caffeine raises blood pressure",
        "gallstones — consult a physician before use (WHO Monographs Vol 1)",
    ):
        got = hits(text, active_conditions=["Hypertension", "Gallstones"])
        assert got and got[0]["soft"]


def test_no_allergy_is_not_an_allergy():
    assert hits("Fish allergy", active_conditions=["Fish allergy noted"]) == []


# ---------- medications: same class is not same drug ----------


def test_a_stopped_drug_is_not_a_clash():
    meds = active_medications(client(current_medications=[
        "Berberine 500 mg twice daily (SUPPLEMENT). Taken in place of Janumet.",
        "Glycomet — STOPPED",
        "Telma 40, Ecosprin (stopped)",
    ]))
    assert not any("janumet" in m or "glycomet" in m or "ecosprin" in m for m in meds)
    assert "telma 40" in meds


def test_an_eye_drop_is_not_swallowed():
    assert active_medications(client(current_medications=[
        "Azithral eye drops (azithromycin 1% ophthalmic) — July 2026 course.",
        "Lotepred eye drops (loteprednol 0.5%)",
    ])) == []


def test_amoxicillin_does_not_inherit_doxycyclines_chelation(drugs):
    named = ["ciprofloxacin", "doxycycline", "levofloxacin"]
    for term in named:
        assert medication_hit(term, ["amoxycilin for cold cough", "cefixime"], drugs, named) is None
    assert medication_hit("doxycycline", ["doxycycline 100 mg"], drugs, named)


def test_a_drug_specific_line_stays_with_that_drug(drugs):
    assert medication_hit("propranolol", ["betaloc 25"], drugs, ["propranolol"]) is None
    assert medication_hit("propranolol", ["ciplar 20 (propranolol 20 mg)"], drugs, ["propranolol"])


def test_a_class_wide_line_reaches_a_brand(drugs):
    named = ["atenolol", "metoprolol", "propranolol"]
    assert medication_hit("metoprolol", ["concor 5"], drugs, named)


def test_vitamin_k_reaches_an_unnamed_blood_thinner_but_not_clopidogrel(drugs):
    named = ["warfarin", "acenocoumarol"]
    assert medication_hit("warfarin", ["blood thinner"], drugs, named)
    assert medication_hit("warfarin", ["clopilet 75"], drugs, named) is None
    assert medication_hit("warfarin", ["acitrom 2 mg"], drugs, named)
    assert medication_hit("blood thinners", ["acitrom 2 mg"], drugs, ["blood thinners"])


def test_daily_aspirin_is_a_blood_thinner(drugs):
    # People call it one. An unnamed thinner meets a line naming aspirin, and a
    # client on Ecosprin meets a line about blood thinners.
    assert medication_hit("aspirin", ["blood thinner"], drugs, ["aspirin"])
    assert medication_hit("blood thinners", ["ecosprin 75"], drugs, ["blood thinners"])


@pytest.mark.parametrize("med", ["clopilet 75", "ecosprin 75", "xarelto 20"])
def test_k2_is_a_question_for_warfarin_only(cat, drugs, med):
    # The K2 line ends "... opposes the anticoagulant effect". That word sits in the
    # narrative, so it does not make the line about every blood thinner.
    k2 = next(s for s in cat.supplements if s.slug == "vitaone-d3")
    term = k2.contraindications.medications[0]
    assert "warfarin" in term
    assert medication_hit(term, [med], drugs, [term]) is None
    assert medication_hit(term, ["acitrom 2 mg"], drugs, [term])


def test_a_list_of_one_class_reports_once(cat, drugs):
    slug = next(
        s.slug for s in cat.supplements
        if {"telmisartan", "losartan"} <= {m.medication for m in s.interactions.with_medications}
    )
    found = [
        f for f in check_plan(plan(slug), client(current_medications=["Telma 40"]), cat)
        if f.field == "interactions.with_medications"
    ]
    assert len(found) == 1


def test_spacing_already_in_the_timing_line_needs_no_reminder():
    hit = {"term": "levothyroxine", "med": "thyronorm 60 mg", "group": "levothyroxine"}
    assert already_spaced("Early afternoon, 4 hours after your morning Thyronorm", hit)
    assert already_spaced("Keep clear of levothyroxine", hit)
    assert not already_spaced("Mid-morning", hit)


def test_a_client_with_no_record_is_silent(cat):
    assert clash_findings(check_plan(plan("betaine-hcl"), client(), cat)) == []
    assert clash_findings(check_plan(plan("betaine-hcl"), None, cat)) == []


# ---------- the vocabulary itself ----------


def test_concepts_are_well_formed():
    concepts = load_concepts()
    ids = [c["id"] for c in concepts]
    assert len(ids) == len(set(ids))
    for c in concepts:
        assert c.get("contra"), c["id"]
        for key in ("contra", "client", "contra_not", "client_not"):
            for term in c.get(key) or []:
                assert term == term.lower().strip(), term
                # A term written unfolded can never match folded text.
                assert fold(term) == term, f"{c['id']}: {term!r} folds to {fold(term)!r}"


def test_every_concept_is_used_by_the_catalogue(cat):
    concepts = load_concepts()
    texts = [t for s in cat.supplements for t in s.contraindications.conditions]
    texts += [t for h in cat.home_remedies for t in h.contraindications]
    used = {c["id"] for text in texts for c in concepts_in_contraindication(text, concepts)}
    assert {c["id"] for c in concepts} - used == set()


def test_coverage_does_not_quietly_fall(cat):
    # What stays unmapped is deliberate: surgery timing, pending blood tests, route
    # of use, smoking and alcohol. A catalogue growing past this needs vocabulary.
    concepts = load_concepts()
    texts = {t for s in cat.supplements for t in s.contraindications.conditions}
    mapped = sum(1 for t in texts if concepts_in_contraindication(t, concepts))
    assert mapped / len(texts) >= 0.78
