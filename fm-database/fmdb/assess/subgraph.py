"""Build a focused catalogue subgraph for AI assessment.

Given selected symptoms + topics, walk the graph (symptom → topic +
mechanism, topic → mechanism + claim + supplement, mechanism → related
mechanisms) and return ONLY the entities that are relevant. This keeps
the prompt token count down and prevents the model from inventing slugs
that don't exist.
"""

from __future__ import annotations

from dataclasses import dataclass, field
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
# Home remedies were the one uncapped entity — the Ayurveda ingest grew them to
# ~190 records that match common topics/mechanisms, ballooning the subgraph by
# ~50K tokens (~1/3 of it). Cap clinical remedies core-first; allow a bounded
# extra dosha palette only when the client is on the Ayurveda track.
MAX_HOME_REMEDIES = 20
MAX_HOME_REMEDIES_AYURVEDA_EXTRA = 30
# Tissue salts (Schüssler / biochemic) are only included when the client is on
# the schussler_salts module. The 12 core cell salts are broad-spectrum
# workhorses, so include them all + any Bio-Combinations that match the
# client's selected symptoms/topics, capped.
MAX_TISSUE_SALTS = 24

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


@dataclass
class AssessmentScope:
    """The topic + mechanism scope a selection of symptoms/topics opens up.

    This is the SINGLE source of truth for "what does picking these
    symptoms/topics make reachable". Both callers go through
    `assessment_scope()`:
      - `build_subgraph()` seeds its bundle from it (live assess path);
      - `find_orphans(demand=...)` unions it across real sessions to compute
        the practical-reachability frontier.
    Keeping both on one function means the reachability check can never
    silently drift from what the assessment actually retrieves.
    """
    topic_set: set[str]          # final topic scope (selected + expanded)
    mech_set: set[str]           # final mechanism scope (canonical, expanded)
    core_topic_set: set[str]     # pre-expansion topics (used for ranking)
    core_mech_set: set[str]      # pre-expansion mechanisms (used for ranking)
    selected_symptoms: list = field(default_factory=list)  # resolved Symptom objects
    sym_set: set[str] = field(default_factory=set)         # raw selected symptom slugs


def assessment_scope(
    cat: Loaded,
    *,
    symptom_slugs: list[str],
    topic_slugs: list[str],
    extra_topic_hops: int = 1,
    ayurveda: bool = False,
) -> AssessmentScope:
    """Compute the topic/mechanism scope that an assessment with these
    selections reaches — the same walk `build_subgraph` uses to seed itself.

    A suggestible entity (supplement / cooking_adjustment / home_remedy /
    protocol) can only surface if its links intersect `topic_set` or
    `mech_set` here. `find_orphans(demand=...)` unions this across every real
    session to answer "is this entity reachable by any assessment we've
    actually run", which catches the case a static link check misses:
    linked to a real topic that no client is ever tagged with.
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

    return AssessmentScope(
        topic_set=topic_set,
        mech_set=mech_set,
        core_topic_set=core_topic_set,
        core_mech_set=core_mech_set,
        selected_symptoms=selected_symptoms,
        sym_set=sym_set,
    )


def build_subgraph(
    cat: Loaded,
    *,
    symptom_slugs: list[str],
    topic_slugs: list[str],
    extra_topic_hops: int = 1,
    ayurveda: bool = False,
    schussler: bool = False,
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
    # ----- start sets (shared scope walk — see assessment_scope) -----
    scope = assessment_scope(
        cat,
        symptom_slugs=symptom_slugs,
        topic_slugs=topic_slugs,
        extra_topic_hops=extra_topic_hops,
        ayurveda=ayurveda,
    )
    topic_set = scope.topic_set
    mech_set = scope.mech_set
    core_topic_set = scope.core_topic_set
    core_mech_set = scope.core_mech_set
    selected_symptoms = scope.selected_symptoms
    sym_set = scope.sym_set
    # Lookup dicts re-derived here — still needed when materialising the bundle
    # (ranking/hydrating topics + mechanisms further down).
    topic_by_slug = {t.slug: t for t in cat.topics}
    mech_by_slug = {m.slug: m for m in cat.mechanisms}

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
    # Rank core-first (linked to a SELECTED topic/mechanism), then by evidence
    # tier, then slug for determinism, and cap — keeps the most relevant tail.
    relevant_remedies.sort(key=lambda hr: (
        0 if (set(hr.linked_to_topics) & core_topic_set
              or set(hr.linked_to_mechanisms) & core_mech_set) else 1,
        _tier_rank(hr.evidence_tier),
        hr.slug,
    ))
    _in_scope_remedies = relevant_remedies  # full ranked in-scope list (pre-cap)
    relevant_remedies = relevant_remedies[:MAX_HOME_REMEDIES]
    # Coach-featured remedies bypass the cap: a pinned remedy force-included
    # when it matches the client's CORE TOPICS (directly selected, or linked
    # from a selected symptom) but ranked below the cap. This is the honest fix
    # for the "thin-evidence tea crowded out for every client" case
    # (`HomeRemedy.featured` / `fmdb orphans --demand`) — the coach's clinical
    # override, not an evidence-tier lie. Gating on core TOPICS (not expanded
    # scope, and not shared mechanisms) is deliberate: expansion + broad shared
    # mechanisms like cortisol-elevation would fire a sleep tea into a bloating
    # plan. A topic-core match means the remedy targets what the client actually
    # presented with. (A remedy that only links to a mechanism won't fire — link
    # it to the presentation topic to pin it precisely.)
    _have = {hr.slug for hr in relevant_remedies}
    relevant_remedies += [
        hr for hr in _in_scope_remedies
        if getattr(hr, "featured", False) and hr.slug not in _have
        and set(hr.linked_to_topics) & core_topic_set
    ]
    # Ayurveda track: the linked-by-clinical-topic set is too thin for a
    # dosha-appropriate palette (most remedies link to clinical topics like
    # 'asthma', not to dosha). Widen to dosha-tagged remedies so the model can
    # pick by the client's vikruti — but bounded so it can't re-balloon.
    if ayurveda:
        _have = {hr.slug for hr in relevant_remedies}
        dosha_extra = [
            hr for hr in cat.home_remedies
            if hr.slug not in _have and (hr.balances_dosha or hr.aggravates_dosha)
        ]
        dosha_extra.sort(key=lambda hr: (_tier_rank(hr.evidence_tier), hr.slug))
        relevant_remedies += dosha_extra[:MAX_HOME_REMEDIES_AYURVEDA_EXTRA]
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

    # Tissue salts (Schüssler / biochemic) — ONLY when the client is on the
    # schussler_salts module. Always include the 12 core cell salts (broad
    # workhorses the model picks from by matching their indications/keynotes),
    # plus any Bio-Combinations / supplementary salts whose linked_to_symptoms
    # or linked_to_topics intersect the client's selection. Core-first, capped.
    relevant_tissue_salts: list = []
    if schussler:
        def _is_core_salt(ts) -> bool:
            return getattr(ts.category, "value", str(ts.category)) == "core_cell_salt"
        for ts in getattr(cat, "tissue_salts", []) or []:
            if (
                _is_core_salt(ts)
                or (set(ts.linked_to_symptoms) & sym_set)
                or (set(ts.linked_to_topics) & topic_set)
            ):
                relevant_tissue_salts.append(ts)
        relevant_tissue_salts.sort(key=lambda ts: (
            0 if _is_core_salt(ts) else 1,
            ts.salt_number if ts.salt_number is not None else 999,
            ts.slug,
        ))
        relevant_tissue_salts = relevant_tissue_salts[:MAX_TISSUE_SALTS]

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
            # Combination-product consolidation — slugs of the individual
            # compounds this single entry replaces in one pill. Non-empty only
            # on combo entries (e.g. methylated-b-complex). Lets the suggester
            # collapse several single-compound suggestions into one combo for
            # adherence (see system-prompt COMBINATION PRODUCTS rule).
            "consolidates": getattr(s, "consolidates", []) or [],
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

    def _ts(ts):
        return {
            "slug": ts.slug,
            "display_name": ts.display_name,
            "category": getattr(ts.category, "value", str(ts.category)),
            "salt_number": ts.salt_number,
            "key_indications": ts.key_indications,
            "tissue_affinity": ts.tissue_affinity,
            "combines_with": ts.combines_with,
            "typical_use": ts.typical_use[:200] if ts.typical_use else "",
            "cautions": ts.cautions[:3],
            # notes_for_coach carries the Boericke & Dewey keynotes — the richest
            # matching signal for "which salt fits this client's picture".
            "notes_for_coach": ts.notes_for_coach[:500] if ts.notes_for_coach else "",
            "evidence_tier": getattr(ts.evidence_tier, "value", str(ts.evidence_tier)),
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
        "tissue_salts": [_ts(ts) for ts in relevant_tissue_salts],
    }


# The suggestible-intervention kinds a coach authors and expects the assess AI
# to surface. Coverage is measured for these; drivers/claims are context, not
# recommendations, so they're excluded.
DEMAND_KINDS = ("supplements", "cooking_adjustments", "home_remedies", "protocols")


@dataclass
class DemandCoverage:
    """How often each suggestible entity actually survives into a REAL subgraph.

    Built by replaying the true `build_subgraph` (caps and all) over every real
    session's selections and counting membership. Coverage 0 = the coach
    authored + linked it, but given the clients actually seen it never enters
    any assessment's candidate set — invisible in practice. This is stricter
    and more honest than a union-of-scope frontier: it accounts for the 20-item
    home-remedy cap and the claim-mediated supplement route.
    """
    n_sessions: int                        # real sessions with a selection
    by_kind: dict[str, "Counter"]          # bundle-key -> Counter(slug -> #sessions)
    scope_frontier: set[str]               # every topic ∪ mechanism any real
                                           # assessment reached (uncapped). Used to
                                           # split coverage-0 entities into
                                           # retrieval-dead (never a candidate) vs
                                           # cap/tier casualty (candidate, capped out).

    def reachable(self, kind: str) -> set[str]:
        """Slugs that made it into >=1 real session's subgraph, for a bundle key."""
        return {slug for slug, n in self.by_kind.get(kind, {}).items() if n > 0}

    def count(self, kind: str, slug: str) -> int:
        return self.by_kind.get(kind, {}).get(slug, 0)


def build_demand_coverage(
    cat: Loaded,
    selections,
    *,
    ayurveda: bool = False,
) -> DemandCoverage:
    """Replay the real `build_subgraph` over historical selections and count
    per-entity membership. `selections` is an iterable of
    (symptom_slugs, topic_slugs) — one per real session; empty ones are skipped.

    `ayurveda=False` measures the DEFAULT path every client gets. Dosha-tagged
    remedies gain an extra route only for Ayurveda-track clients — noted, not
    silently counted, so the default-path coverage stays honest.
    """
    from collections import Counter

    by_kind: dict[str, Counter] = {k: Counter() for k in DEMAND_KINDS}
    scope_frontier: set[str] = set()
    n = 0
    for symptom_slugs, topic_slugs in selections:
        symptom_slugs = list(symptom_slugs or [])
        topic_slugs = list(topic_slugs or [])
        if not symptom_slugs and not topic_slugs:
            continue
        n += 1
        # Uncapped candidate scope (why an entity IS/ISN'T a candidate) ...
        sc = assessment_scope(
            cat, symptom_slugs=symptom_slugs, topic_slugs=topic_slugs, ayurveda=ayurveda,
        )
        scope_frontier |= sc.topic_set | sc.mech_set
        # ... vs post-cap membership (whether it actually surfaces).
        bundle = build_subgraph(
            cat, symptom_slugs=symptom_slugs, topic_slugs=topic_slugs, ayurveda=ayurveda,
        )
        for k in DEMAND_KINDS:
            for e in bundle.get(k, []):
                if isinstance(e, dict) and e.get("slug"):
                    by_kind[k][e["slug"]] += 1
    return DemandCoverage(n_sessions=n, by_kind=by_kind, scope_frontier=scope_frontier)
