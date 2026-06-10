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

# ── Size caps — keep the assessment subgraph focused so prompts stay small
# and cheap. Broad conditions (e.g. hypothyroidism + insulin-resistance) can
# otherwise match many hundreds of claims, ballooning the prompt to ~800K
# tokens (~$3/assessment). Items are ranked core-first (linked to a SELECTED
# topic/symptom) then by evidence tier, so caps drop the least-relevant tail.
MAX_CLAIMS = 80
MAX_CANDIDATE_SYMPTOMS = 30
MAX_SUPPLEMENTS = 50
MAX_TOPICS = 60
MAX_MECHANISMS = 60

_TIER_RANK = {
    "strong": 0,
    "plausible_emerging": 1,
    "fm_specific_thin": 2,
    "confirm_with_clinician": 3,
}


def _tier_rank(ev) -> int:
    try:
        return _TIER_RANK.get(ev.value, 5)
    except AttributeError:
        return _TIER_RANK.get(str(ev), 5)


def build_subgraph(
    cat: Loaded,
    *,
    symptom_slugs: list[str],
    topic_slugs: list[str],
    extra_topic_hops: int = 1,
    ayurveda: bool = False,
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

    # When the client is on the Ayurveda track, seed the dosha framework topics
    # so the model sees the constitution / agni / dinacharya scaffolding (and
    # the trait→dosha mapping baked into their summaries) even if the coach
    # didn't pick them. Only those that actually exist in the catalogue.
    if ayurveda:
        _all_topic_slugs = {t.slug for t in cat.topics}
        for _ds in (
            "ayurvedic-elemental-design-doshas",
            "agni-digestive-fire",
            "ayurvedic-circadian-clock",
        ):
            if _ds in _all_topic_slugs:
                topic_set.add(_ds)

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

    # Capture the CORE topic set (explicitly selected + symptom-linked) before
    # any related-topic expansion — used to rank claims/supplements/symptoms so
    # the size caps keep the most relevant items.
    core_topic_set = set(topic_set)

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
    # Core mechanisms (pre related-mechanism expansion) for ranking.
    core_mech_set = set(mech_set)

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
    # Rank core-first (touches a selected/symptom-linked topic or mechanism),
    # then by evidence tier, then slug for determinism; cap to MAX_CLAIMS.
    relevant_claims.sort(key=lambda c: (
        0 if (set(c.linked_to_topics) & core_topic_set or set(c.linked_to_mechanisms) & core_mech_set) else 1,
        _tier_rank(c.evidence_tier),
        c.slug,
    ))
    relevant_claims = relevant_claims[:MAX_CLAIMS]

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
    relevant_supplements.sort(key=lambda s: (
        0 if (set(s.linked_to_topics) & core_topic_set or set(s.linked_to_mechanisms) & core_mech_set) else 1,
        _tier_rank(s.evidence_tier),
        s.slug,
    ))
    relevant_supplements = relevant_supplements[:MAX_SUPPLEMENTS]

    # Cooking adjustments + home remedies linked to selected topics or mechanisms
    relevant_cooking = [
        ca for ca in cat.cooking_adjustments
        if set(ca.linked_to_topics) & topic_set or set(ca.linked_to_mechanisms) & mech_set
    ]
    relevant_remedies = [
        hr for hr in cat.home_remedies
        if set(hr.linked_to_topics) & topic_set or set(hr.linked_to_mechanisms) & mech_set
    ]
    # Ayurveda track: the linked-by-clinical-topic set is too thin for a
    # dosha-appropriate palette (most remedies link to clinical topics like
    # 'asthma', not to dosha). Widen to EVERY dosha-tagged remedy so the model
    # can pick by the client's vikruti. Slim representation keeps tokens sane.
    if ayurveda:
        _have = {hr.slug for hr in relevant_remedies}
        for hr in cat.home_remedies:
            if hr.slug in _have:
                continue
            if hr.balances_dosha or hr.aggravates_dosha:
                relevant_remedies.append(hr)
    # Protocols linked to selected topics, mechanisms, or symptoms — these
    # are the structured FM playbooks (5R, AIP, weight-loss reset, etc.)
    # that the AI may recommend as a spine for the plan.
    relevant_protocols = [
        pr for pr in cat.protocols
        if (
            set(pr.linked_to_topics) & topic_set
            or set(pr.linked_to_mechanisms) & mech_set
            or set(pr.linked_to_symptoms) & sym_set
        )
    ]

    # All symptoms whose linked_to_topics intersect our topics — the model
    # may want to surface symptoms the coach didn't pick that fit the picture
    candidate_symptoms = []
    for s in cat.symptoms:
        if s.slug in sym_set:
            continue
        if set(s.linked_to_topics) & topic_set or set(s.linked_to_mechanisms) & mech_set:
            candidate_symptoms.append(s)
    # Rank core-linked + red-flag first; cap to MAX_CANDIDATE_SYMPTOMS.
    candidate_symptoms.sort(key=lambda s: (
        0 if (set(s.linked_to_topics) & core_topic_set or set(s.linked_to_mechanisms) & core_mech_set) else 1,
        0 if getattr(s.severity, "value", str(s.severity)) == "red_flag" else 1,
        s.slug,
    ))
    candidate_symptoms = candidate_symptoms[:MAX_CANDIDATE_SYMPTOMS]

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
            # Ayurvedic energetics — present on dosha-tagged supplements; lets the
            # suggester pick dosha-appropriate supplements the same way it does
            # remedies. Omitted (empty) for untagged supplements.
            "balances_dosha": [d.value for d in getattr(s, "balances_dosha", []) or []],
            "aggravates_dosha": [d.value for d in getattr(s, "aggravates_dosha", []) or []],
            "virya": (getattr(s, "virya", None).value if getattr(s, "virya", None) else ""),
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
            "route": hr.route.value,   # internal (eaten/drunk) | external (applied to the body)
            "balances_dosha": [d.value for d in hr.balances_dosha],
            "aggravates_dosha": [d.value for d in hr.aggravates_dosha],
            "evidence_tier": hr.evidence_tier.value,
        }

    def _pr(pr):
        return {
            "slug": pr.slug,
            "display_name": pr.display_name,
            "category": pr.category.value,
            "summary": pr.summary[:400],
            "indications": pr.indications[:10],
            "contraindications": pr.contraindications[:6],
            "typical_duration_weeks": pr.typical_duration_weeks,
            "phases": [
                {"name": ph.name, "weeks": ph.weeks, "summary": ph.summary[:200]}
                for ph in pr.phases[:6]
            ],
            "supplements_typically_used": pr.supplements_typically_used,
            "expected_outcomes": pr.expected_outcomes[:6],
            "cautions": pr.cautions[:5],
            "linked_to_topics": pr.linked_to_topics,
            "linked_to_symptoms": pr.linked_to_symptoms,
            "evidence_tier": pr.evidence_tier.value,
            "notes_for_coach": pr.notes_for_coach[:300],
        }

    ordered_topics = sorted(
        (t for t in topic_set if t in topic_by_slug),
        key=lambda ts: (0 if ts in core_topic_set else 1, ts),
    )[:MAX_TOPICS]
    ordered_mechs = sorted(
        (m for m in mech_set if m in mech_by_slug),
        key=lambda ms: (0 if ms in core_mech_set else 1, ms),
    )[:MAX_MECHANISMS]

    return {
        "selected_symptoms": [_s(s) for s in selected_symptoms],
        "candidate_symptoms": [_s(s) for s in candidate_symptoms],
        "topics": [_t(topic_by_slug[t]) for t in ordered_topics],
        "mechanisms": [_m(mech_by_slug[m]) for m in ordered_mechs],
        "claims": [_c(c) for c in relevant_claims],
        "supplements": [_supp(s) for s in relevant_supplements],
        "cooking_adjustments": [_ca(ca) for ca in relevant_cooking],
        "home_remedies": [_hr(hr) for hr in relevant_remedies],
        "protocols": [_pr(pr) for pr in relevant_protocols],
    }
