"""Build a focused catalogue subgraph for AI assessment.

Given selected symptoms + topics, walk the graph (symptom → topic +
mechanism, topic → mechanism + claim + supplement, mechanism → related
mechanisms) and return ONLY the entities that are relevant. This keeps
the prompt token count down and prevents the model from inventing slugs
that don't exist.
"""

from __future__ import annotations

from typing import Any

from ..validator import Loaded


def build_subgraph(
    cat: Loaded,
    *,
    symptom_slugs: list[str],
    topic_slugs: list[str],
    extra_topic_hops: int = 1,
) -> dict[str, Any]:
    """Return a JSON-serializable bundle of catalogue entities relevant
    to the selected symptoms and topics.

    Walk:
      symptom  → topics + mechanisms it links to
      topic    → topic.related_topics, topic.key_mechanisms, claims that
                 cite it, supplements that link to it, cooking adjustments
                 + home remedies that link to it
      mechanism → related_mechanisms, mechanism.linked_to_topics

    `extra_topic_hops` controls how aggressive the "related topics"
    expansion is. 1 hop = "topics directly related to your selection".
    """
    # ----- start sets -----
    sym_set = set(symptom_slugs)
    topic_set = set(topic_slugs)
    mech_set: set[str] = set()

    # Pull selected symptoms into the bundle and harvest their links
    sym_by_slug = {s.slug: s for s in cat.symptoms}
    selected_symptoms = []
    for slug in symptom_slugs:
        sym = sym_by_slug.get(slug)
        if sym:
            selected_symptoms.append(sym)
            for t in sym.linked_to_topics:
                topic_set.add(t)
            for m in sym.linked_to_mechanisms:
                mech_set.add(m)

    # Expand topics: add related_topics + key_mechanisms (one hop)
    topic_by_slug = {t.slug: t for t in cat.topics}
    for _ in range(extra_topic_hops):
        new_topics = set()
        for t_slug in topic_set:
            t = topic_by_slug.get(t_slug)
            if t:
                for rel in t.related_topics:
                    new_topics.add(rel)
                for m in t.key_mechanisms:
                    mech_set.add(m)
        topic_set |= new_topics

    # Mechanism resolution is alias-aware — find canonical for each
    mech_by_slug = {m.slug: m for m in cat.mechanisms}
    mech_alias_to_canonical: dict[str, str] = {}
    for m in cat.mechanisms:
        mech_alias_to_canonical[m.slug] = m.slug
        for a in m.aliases:
            mech_alias_to_canonical[a] = m.slug

    canonical_mech_set: set[str] = set()
    for m_slug in mech_set:
        canonical = mech_alias_to_canonical.get(m_slug, m_slug)
        if canonical in mech_by_slug:
            canonical_mech_set.add(canonical)
    mech_set = canonical_mech_set

    # Expand mechanisms: pull in related_mechanisms one hop
    new_mech: set[str] = set()
    for m_slug in mech_set:
        m = mech_by_slug.get(m_slug)
        if m:
            for rel in m.related_mechanisms:
                new_mech.add(rel)
            for t_slug in m.linked_to_topics:
                topic_set.add(t_slug)
    mech_set |= {m for m in new_mech if m in mech_by_slug}

    # Claims that link to selected topics OR mechanisms
    relevant_claims = []
    for c in cat.claims:
        if (set(c.linked_to_topics) & topic_set) or (set(c.linked_to_mechanisms) & mech_set):
            relevant_claims.append(c)

    # Supplements that link to selected topics OR mechanisms OR claims
    claim_set = {c.slug for c in relevant_claims}
    relevant_supplements = []
    for s in cat.supplements:
        if (
            set(s.linked_to_topics) & topic_set
            or set(s.linked_to_mechanisms) & mech_set
            or set(s.linked_to_claims) & claim_set
        ):
            relevant_supplements.append(s)

    # Cooking adjustments + home remedies linked to selected topics or mechanisms
    relevant_cooking = [
        ca for ca in cat.cooking_adjustments
        if set(ca.linked_to_topics) & topic_set or set(ca.linked_to_mechanisms) & mech_set
    ]
    relevant_remedies = [
        hr for hr in cat.home_remedies
        if set(hr.linked_to_topics) & topic_set or set(hr.linked_to_mechanisms) & mech_set
    ]

    # All symptoms whose linked_to_topics intersect our topics — the model
    # may want to surface symptoms the coach didn't pick that fit the picture
    candidate_symptoms = []
    for s in cat.symptoms:
        if s.slug in sym_set:
            continue
        if set(s.linked_to_topics) & topic_set or set(s.linked_to_mechanisms) & mech_set:
            candidate_symptoms.append(s)

    # ----- pack as compact dicts -----
    def _t(t):
        return {
            "slug": t.slug,
            "display_name": t.display_name,
            "aliases": t.aliases,
            "summary": t.summary[:300] if t.summary else "",
            "common_symptoms": t.common_symptoms,
            "red_flags": t.red_flags,
            "key_mechanisms": t.key_mechanisms,
            "related_topics": t.related_topics,
            "evidence_tier": t.evidence_tier.value,
            "coaching_scope_notes": t.coaching_scope_notes[:300],
        }

    def _m(m):
        return {
            "slug": m.slug,
            "display_name": m.display_name,
            "aliases": m.aliases,
            "category": m.category.value,
            "summary": m.summary[:300] if m.summary else "",
            "upstream_drivers": m.upstream_drivers,
            "downstream_effects": m.downstream_effects,
            "related_mechanisms": m.related_mechanisms,
            "evidence_tier": m.evidence_tier.value,
        }

    def _s(s):
        return {
            "slug": s.slug,
            "display_name": s.display_name,
            "aliases": s.aliases,
            "category": s.category.value,
            "severity": s.severity.value,
            "description": s.description[:200],
            "when_to_refer": s.when_to_refer[:200],
        }

    def _c(c):
        return {
            "slug": c.slug,
            "statement": c.statement[:300],
            "evidence_tier": c.evidence_tier.value,
            "coaching_translation": c.coaching_translation[:300],
            "out_of_scope_notes": c.out_of_scope_notes[:200],
            "linked_to_topics": c.linked_to_topics,
            "linked_to_supplements": c.linked_to_supplements,
        }

    def _supp(s):
        return {
            "slug": s.slug,
            "display_name": s.display_name,
            "category": s.category.value,
            "evidence_tier": s.evidence_tier.value,
            "forms_available": [f.value for f in s.forms_available],
            "typical_dose_range": {
                k: {"min": v.min, "max": v.max, "unit": v.unit.value}
                for k, v in s.typical_dose_range.items()
            },
            "timing_options": [t.value for t in s.timing_options],
            "take_with_food": s.take_with_food.value,
            "contraindications": s.contraindications.model_dump(mode="json"),
            "interactions": s.interactions.model_dump(mode="json"),
            "linked_to_topics": s.linked_to_topics,
            "notes_for_coach": s.notes_for_coach[:300],
        }

    def _ca(ca):
        return {
            "slug": ca.slug,
            "display_name": ca.display_name,
            "category": ca.category.value,
            "summary": ca.summary[:300],
            "benefits": ca.benefits,
            "swap_from": ca.swap_from,
            "how_to_use": ca.how_to_use[:300],
            "cautions": ca.cautions,
            "evidence_tier": ca.evidence_tier.value,
        }

    def _hr(hr):
        return {
            "slug": hr.slug,
            "display_name": hr.display_name,
            "category": hr.category.value,
            "summary": hr.summary[:300],
            "indications": hr.indications,
            "contraindications": hr.contraindications,
            "preparation": hr.preparation[:200],
            "typical_dose": hr.typical_dose[:150],
            "evidence_tier": hr.evidence_tier.value,
        }

    return {
        "selected_symptoms": [_s(s) for s in selected_symptoms],
        "candidate_symptoms": [_s(s) for s in candidate_symptoms],
        "topics": [_t(topic_by_slug[t]) for t in topic_set if t in topic_by_slug],
        "mechanisms": [_m(mech_by_slug[m]) for m in mech_set if m in mech_by_slug],
        "claims": [_c(c) for c in relevant_claims],
        "supplements": [_supp(s) for s in relevant_supplements],
        "cooking_adjustments": [_ca(ca) for ca in relevant_cooking],
        "home_remedies": [_hr(hr) for hr in relevant_remedies],
    }
