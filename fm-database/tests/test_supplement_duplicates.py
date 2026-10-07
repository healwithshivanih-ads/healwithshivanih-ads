"""Supplement duplicates: the merge, the references, and the three ways they
were being created.

21 supplement pairs were merged in 2026-10 (ginger/ginger-root,
chromium/chromium-picolinate, ...). Each test below fails if one of the fixes
behind that is undone.
"""
from pathlib import Path
from types import SimpleNamespace

import yaml

from fmdb.duplicates import _tokens, find_duplicates
from fmdb.supplement_merge import (
    _minimal_text_rewrite,
    merge_supplement_records,
)

DATA = Path(__file__).resolve().parent.parent / "data"

# retired slug -> survivor (the 2026-10 merge)
MERGED = {
    "biotin-b7": "biotin", "chromium-picolinate": "chromium",
    "copper-gluconate": "copper", "diamine-oxidase-enzyme": "dao-enzyme",
    "dhea-s": "dhea", "ginger-root": "ginger", "hibiscus-tea": "hibiscus",
    "plant-sterols-stanols": "plant-sterols", "vitamin-a-retinol": "vitamin-a",
    "vitamin-e-mixed-tocopherols": "vitamin-e", "b-complex-vitamins": "b-complex",
    "active-b-vitamins": "methylated-b-complex",
    "probiotics-lactobacillus-bifidobacterium": "probiotics",
    "anti-ace-peptides-bonito": "bonito-peptides", "nmn": "nad-precursor",
    "omega-3": "fish-oil-epa-dha", "folate": "methylfolate",
    "folate-folic-acid": "folic-acid", "protein-whey-isolate": "whey-protein",
    "electrolyte-supplement": "electrolytes", "turmeric-curcumin": "curcumin",
}


# ---------------------------------------------------------------------------
# The merge keeps everything
# ---------------------------------------------------------------------------

def _supp(slug, **kw):
    base = {"slug": slug, "display_name": slug, "category": "herb",
            "forms_available": ["capsule"], "timing_options": ["morning"],
            "typical_dose_range": {}, "evidence_tier": "fm_specific_thin",
            "sources": [{"id": "s1"}]}
    base.update(kw)
    return base


def test_merge_keeps_the_members_safety_data():
    """The old cleanup merge kept only aliases + sources and DELETED the
    member's contraindications and interactions. That must never recur."""
    canonical = _supp("ginger", contraindications={"conditions": ["gallstones"]})
    member = _supp(
        "ginger-root",
        contraindications={"medications": ["warfarin — bleeding risk"]},
        interactions={"with_medications": [
            {"medication": "nifedipine", "type": "monitor", "reason": "additive"}]},
        linked_to_symptoms=["nausea"],
        notes_for_coach="Use fresh root in tea.",
    )
    out = merge_supplement_records(canonical, member, today="2026-10-07")
    assert out["contraindications"]["conditions"] == ["gallstones"]
    assert out["contraindications"]["medications"] == ["warfarin — bleeding risk"]
    assert out["interactions"]["with_medications"][0]["medication"] == "nifedipine"
    assert out["linked_to_symptoms"] == ["nausea"]
    assert "Use fresh root in tea." in out["notes_for_coach"]
    assert "ginger-root" in out["aliases"]


def test_merge_takes_the_most_cautious_safety_and_the_stronger_tier():
    a = _supp("a", pregnancy_safety="likely_safe", evidence_tier="fm_specific_thin")
    b = _supp("b", pregnancy_safety="contraindicated", evidence_tier="strong")
    out = merge_supplement_records(a, b)
    assert out["pregnancy_safety"] == "contraindicated"
    assert out["evidence_tier"] == "strong"
    # `unknown` means "not filled in" — it must not override a real value
    c = merge_supplement_records(_supp("c", pregnancy_safety="caution"),
                                 _supp("d", pregnancy_safety="unknown"))
    assert c["pregnancy_safety"] == "caution"


def test_merge_never_silently_widens_a_shared_dose_range():
    a = _supp("a", typical_dose_range={"capsule": {"min": 100, "max": 200, "unit": "mg"}})
    b = _supp("b", typical_dose_range={"capsule": {"min": 500, "max": 900, "unit": "mg"},
                                       "powder": {"min": 1, "max": 2, "unit": "g"}})
    out = merge_supplement_records(a, b)
    assert out["typical_dose_range"]["capsule"] == {"min": 100, "max": 200, "unit": "mg"}
    assert out["typical_dose_range"]["powder"] == {"min": 1, "max": 2, "unit": "g"}
    assert "500–900 mg" in out["notes_for_coach"]


# ---------------------------------------------------------------------------
# The real catalogue after the merge
# ---------------------------------------------------------------------------

def test_every_retired_slug_is_gone_and_resolves_as_an_alias():
    """Published plans still name the retired slugs; they must resolve."""
    for retired, survivor in MERGED.items():
        assert not (DATA / "supplements" / f"{retired}.yaml").exists(), retired
        d = yaml.safe_load((DATA / "supplements" / f"{survivor}.yaml").read_text())
        assert retired in (d.get("aliases") or []), f"{retired} not aliased on {survivor}"


def test_no_catalogue_reference_still_names_a_retired_slug():
    for p in (DATA / "claims").glob("*.yaml"):
        d = yaml.safe_load(p.read_text()) or {}
        assert not set(d.get("linked_to_supplements") or []) & set(MERGED), p.name
    for p in (DATA / "protocols").glob("*.yaml"):
        d = yaml.safe_load(p.read_text()) or {}
        assert not set(d.get("supplements_typically_used") or []) & set(MERGED), p.name


def test_reference_rewrite_leaves_a_lab_test_node_alone():
    """`dhea-s` is a retired supplement slug AND a lab-test slug. A mind-map
    node pointing at the LAB TEST must not be repointed at the supplement."""
    text = (
        "slug: m\ntree:\n"
        "- label: DHEA-S level\n  children: []\n  linked_kind: lab_test\n  linked_slug: dhea-s\n"
        "- label: DHEA supplement\n  children: []\n  linked_kind: supplement\n  linked_slug: dhea-s\n"
    )
    out = _minimal_text_rewrite("mindmaps", text, {"dhea-s": "dhea"})
    tree = yaml.safe_load(out)["tree"]
    assert tree[0]["linked_slug"] == "dhea-s"
    assert tree[1]["linked_slug"] == "dhea"


def test_reference_rewrite_drops_a_duplicate_instead_of_doubling_it():
    text = "slug: c\nlinked_to_supplements:\n- folate\n- folic-acid\n- methylfolate\n"
    out = _minimal_text_rewrite("claims", text, {"folate": "methylfolate"})
    assert sorted(yaml.safe_load(out)["linked_to_supplements"]) == ["folic-acid", "methylfolate"]


# ---------------------------------------------------------------------------
# Prevention 1: ingest staging recognises an existing supplement
# ---------------------------------------------------------------------------

def test_staging_redirects_a_new_name_onto_the_existing_supplement(tmp_path):
    from fmdb.ingest.staging import _redirect_to_existing

    (tmp_path / "supplements").mkdir()
    (tmp_path / "supplements" / "chromium.yaml").write_text(
        yaml.safe_dump(_supp("chromium", display_name="Chromium")))
    manifest: dict = {}
    payload = _supp("chromium-picolinate", display_name="Chromium (Picolinate)")
    _redirect_to_existing(tmp_path, "supplements", payload, manifest, {})
    assert payload["slug"] == "chromium"
    assert "chromium-picolinate" in payload["aliases"]
    assert payload["display_name"] == "Chromium"  # smart-merge must not rename it
    assert manifest["redirected"] == [
        {"entity": "supplements", "from": "chromium-picolinate", "to": "chromium"}]


def test_staging_leaves_a_genuinely_new_supplement_alone(tmp_path):
    from fmdb.ingest.staging import _redirect_to_existing

    (tmp_path / "supplements").mkdir()
    (tmp_path / "supplements" / "chromium.yaml").write_text(
        yaml.safe_dump(_supp("chromium", display_name="Chromium")))
    payload = _supp("selenium", display_name="Selenium")
    _redirect_to_existing(tmp_path, "supplements", payload, {}, {})
    assert payload["slug"] == "selenium"


# ---------------------------------------------------------------------------
# Prevention 2: the extractor is told what already exists
# ---------------------------------------------------------------------------

def test_extractor_sees_the_existing_supplements_and_may_alias_them():
    from fmdb.ingest.extractor import _TOOL_INPUT_SCHEMA, _existing_supplements_block

    block = _existing_supplements_block()
    assert block and "chromium | Chromium" in block[0]["text"]
    props = _TOOL_INPUT_SCHEMA["properties"]["supplements"]["items"]["properties"]
    assert "aliases" in props


def test_chat_ingest_briefing_no_longer_forbids_supplement_aliases():
    """The briefing said supplements have no aliases, so every new name for an
    existing supplement became a new file."""
    briefing = (DATA.parent.parent / "fm-database-web" / "src" / "lib"
                / "catalogue-ingest-briefing.ts").read_text()
    assert "Supplements and claims do NOT support aliases" not in briefing
    assert "ONE SUBSTANCE = ONE SUPPLEMENT" in briefing


# ---------------------------------------------------------------------------
# Prevention 3: the duplicate detector
# ---------------------------------------------------------------------------

def _loaded(*supps):
    ents = [SimpleNamespace(slug=s, display_name=s.replace("-", " "), aliases=[])
            for s in supps]
    return SimpleNamespace(supplements=ents)


def test_vitamin_letters_are_not_one_token():
    """Dropping short tokens made vitamin-a/-c/-d3 '100% overlap' — noise that
    got baselined along with the real duplicates."""
    assert _tokens("vitamin-a") != _tokens("vitamin-c")
    kinds = {(f.kind, tuple(f.slugs)) for f in find_duplicates(_loaded("vitamin-a", "vitamin-c"))}
    assert not kinds


def test_base_name_plus_form_word_is_flagged():
    found = find_duplicates(_loaded("ginger", "ginger-root", "selenium"))
    assert [(f.kind, f.slugs) for f in found] == [("FORM_VARIANT", ["ginger", "ginger-root"])]
