"""The bug this module exists to prevent, as a failing-if-broken test.

THE ALPHABETICAL CUT, SECOND OCCURRENCE. The supplement ranking in
`fmdb/assess/subgraph.py` was fixed once because its sort key
`(core?, tier, slug)` had degenerated: `core` matched nearly everything in a
realistic assessment, most entries shared an evidence tier, so the real cut
between "in the subgraph" and "invisible to the assessment" was made
ALPHABETICALLY by slug.

The home-remedy sort kept that exact key and degenerated the same way.
Measured on the live roster (12 active clients, 2026-09-21) BEFORE the fix:

    192 of 245 remedies never reached a single client (78%)
    182 of those were IN SCOPE and merely capped out
    the set that did surface ran a... -> j... and STOPPED DEAD

Not one remedy whose slug starts with k-z ever appeared for any client — no
triphala, no trikatu, no sesame-oil preparation, no moringa — despite 38 slugs
starting with 's' and 17 with 't'. After the fix, reach went 53 -> 90 remedies
and the surfacing set spanned a-y.

ONE ASSERTION DOES THE REAL WORK, DELIBERATELY. Three sharper-sounding
formulations were written and thrown away because they passed against the OLD
degenerate key — i.e. they were guards that did not guard:

  * "surfaced set != alphabetical prefix of in-scope candidates" — the core
    flag shifts the baseline, so overlap stayed low either way.
  * the same, restricted to the base list with ayurveda=False — same reason.
  * "some surfaced remedy sorts after a dropped one in the same band" and
    "some surfaced remedy has a worse evidence tier than a dropped one" —
    both already true under the old key, because tier is applied before slug
    and the band flag leaks.

`test_late_alphabet_remedies_can_surface` is the one that fails on the old key
and passes on the fix, verified in both directions. Do not add a replacement
for the discarded three without checking it actually fails against the old
sort — a decorative guard here is worse than none, because it reads as
coverage.

Run: python -m pytest tests/test_subgraph_remedy_ranking.py
"""

from pathlib import Path

from fmdb.assess.subgraph import (
    MAX_HOME_REMEDIES,
    assessment_scope,
    build_subgraph,
)
from fmdb.validator import load_all

_CAT = load_all(Path(__file__).resolve().parent.parent / "data")

# A broad, realistic multi-condition selection — the shape that made the old
# key degenerate. Narrow single-topic selections never exposed the bug.
_TOPICS = ["anxiety", "constipation", "hypertension"]


def _in_scope_slugs(topics, ayurveda=True):
    scope = assessment_scope(_CAT, symptom_slugs=[], topic_slugs=topics, ayurveda=ayurveda)
    return {
        hr.slug
        for hr in _CAT.home_remedies
        if set(hr.linked_to_topics) & scope.topic_set
        or set(hr.linked_to_mechanisms) & scope.mech_set
    }


def _surfaced_slugs(topics, ayurveda=True):
    sg = build_subgraph(_CAT, symptom_slugs=[], topic_slugs=topics, ayurveda=ayurveda)
    return {r["slug"] for r in sg.get("home_remedies", [])}


def test_cap_is_actually_binding_for_this_fixture():
    """Guard the guard: if the fixture stops over-subscribing the cap, the
    tests below become vacuous and would pass on a broken sort."""
    in_scope = _in_scope_slugs(_TOPICS)
    assert len(in_scope) > MAX_HOME_REMEDIES * 3, (
        f"fixture no longer stresses the cap ({len(in_scope)} in scope vs cap "
        f"{MAX_HOME_REMEDIES}) — pick a broader selection or this suite is vacuous"
    )


def test_late_alphabet_remedies_can_surface():
    """The most legible symptom of the old bug: nothing from the back half of
    the alphabet ever reached a client."""
    surfaced = _surfaced_slugs(_TOPICS)
    late = {s for s in surfaced if s[0] >= "m"}
    assert late, (
        "no remedy with a slug starting m-z surfaced for a broad, realistic "
        "selection. That was the exact signature of the alphabetical cut."
    )


def test_featured_remedy_bypasses_the_cap_on_a_core_topic():
    """`featured` is the coach's override for a thin-evidence remedy that is
    clinically right but ranks below the cap. It must still fire."""
    featured = [hr for hr in _CAT.home_remedies if getattr(hr, "featured", False)]
    assert featured, "no featured remedies — this test has nothing to prove"
    checked = 0
    for hr in featured:
        for topic in hr.linked_to_topics:
            if topic not in {t.slug for t in _CAT.topics}:
                continue
            surfaced = _surfaced_slugs([topic])
            assert hr.slug in surfaced, (
                f"featured remedy {hr.slug!r} did not surface even when its own "
                f"core topic {topic!r} was the entire selection"
            )
            checked += 1
            break
    assert checked, "no featured remedy had a resolvable topic to test against"
