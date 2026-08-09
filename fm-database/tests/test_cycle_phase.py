"""Cycle-phase awareness — the deterministic layer, pinned.

The feature this protects: a menstruating client's plan adjusts to her cycle
(food, movement, fasting rules) from the canonical Vitti call + claims
(avoid-intermittent-fasting-for-menstruating-women,
cycle-aligned-exercise-by-phase, luteal-phase-needs-more-calories-and-slow-carbs).

What must never silently regress:
- cycle_context(on_date=...) phase windows — the vocabulary every tag,
  checker rule and TS chip keys on (drift = tags that never fire),
- the stale-LMP guard (the modulo happily wraps a months-old date into a
  plausible cycle day — confidence must drop),
- the fasting token scan (negation-aware; 'breakfast' must not fire),
- _check_cycle_phase gating (pregnant clients skip; low confidence skips the
  exercise arm; findings are WARNING so publishes never hard-block),
- gate_prescription's phase flag (total: malformed data must never empty a
  prescription) and current_cycle_phase's high-confidence-only contract.

Run: python -m tests.test_cycle_phase
"""

from datetime import date, timedelta

from fmdb.enums import CyclePhase
from fmdb.plan.checker import _fasting_hits
from fmdb.plan.exercise_screen import (
    current_cycle_phase,
    gate_prescription,
)
from fmdb.plan.models import Client


def _client(**kw) -> Client:
    base = dict(
        client_id="test-cycle", name="T", sex="F", age_band="35-44",
        intake_date=date(2026, 1, 1), created_at=date(2026, 1, 1),
        updated_at=date(2026, 1, 1), updated_by="test",
    )
    base.update(kw)
    return Client(**base)


def _menstruating(lmp_days_ago: int, **kw) -> Client:
    return _client(
        cycle_status="menstruating",
        last_menstrual_period=date.today() - timedelta(days=lmp_days_ago),
        cycle_length_days=kw.pop("cycle_length_days", 28),
        **kw,
    )


# ---------------------------------------------------------------- phases ----

def test_phase_windows_28_day_cycle():
    """The exact day→phase mapping every tag and rule keys on."""
    c = _client(
        cycle_status="menstruating",
        last_menstrual_period=date(2026, 7, 1),
        cycle_length_days=28,
    )
    expected = {
        1: "menstrual", 5: "menstrual",
        6: "follicular", 12: "follicular",
        13: "ovulatory", 15: "ovulatory",
        16: "early_luteal", 21: "early_luteal",
        22: "late_luteal", 28: "late_luteal",
    }
    for day, phase in expected.items():
        on = date(2026, 7, 1) + timedelta(days=day - 1)
        ctx = c.cycle_context(on_date=on)
        assert ctx["phase"] == phase, f"day {day}: {ctx['phase']} != {phase}"
        assert ctx["cycle_day"] == day


def test_phase_vocabulary_matches_enum():
    """CyclePhase enum values must be exactly what cycle_context emits —
    string drift makes every tag silently dead."""
    c = _client(
        cycle_status="menstruating",
        last_menstrual_period=date(2026, 7, 1),
        cycle_length_days=28,
    )
    emitted = {
        c.cycle_context(on_date=date(2026, 7, 1) + timedelta(days=d))["phase"]
        for d in range(28)
    }
    assert emitted == {p.value for p in CyclePhase}


def test_stale_lmp_drops_confidence():
    ctx = _menstruating(90).cycle_context()
    assert ctx["confidence"] == "low"
    assert "days old" in ctx["note"]
    assert ctx["days_since_lmp"] == 90


def test_fresh_lmp_high_confidence():
    ctx = _menstruating(10).cycle_context()
    assert ctx["confidence"] == "high"
    assert ctx["phase"] == "follicular"


# ------------------------------------------------------- fasting scanner ----

def test_fasting_hits_and_negation():
    assert _fasting_hits("intermittent fasting 3x/week")
    assert _fasting_hits("14h overnight fast (7pm-9am)")
    assert _fasting_hits("fast for 16 hours on rest days")
    assert _fasting_hits("fasted cardio before breakfast")
    assert _fasting_hits("16:8 eating window")
    # negated / innocent — must NOT fire
    assert not _fasting_hits("no intermittent fasting during this plan")
    assert not _fasting_hits("12h overnight fast — NOT extended fasting")
    assert not _fasting_hits("break your fast with warm water")
    assert not _fasting_hits("breakfast at 8am, lunch at 1pm")


# ------------------------------------------------------------- checker ------

def _minimal_plan(**kw):
    from fmdb.plan.models import Plan

    base = dict(
        slug="test-cycle-plan", client_id="test-cycle",
        plan_period_start=date(2026, 8, 1), plan_period_weeks=12,
        plan_period_recheck_date=date(2026, 10, 24),
        catalogue_snapshot={"snapshot_date": date(2026, 8, 1)},
        created_at=date(2026, 8, 1),
        updated_at=date(2026, 8, 1), updated_by="test",
    )
    base.update(kw)
    return Plan(**base)


def _run_check(plan, client):
    from fmdb.plan.checker import _check_cycle_phase

    findings = []

    class _EmptyCatalogue:
        exercises = []

    _check_cycle_phase(plan, client, _EmptyCatalogue(), findings)
    return findings


def test_checker_flags_fasting_for_menstruating_client():
    plan = _minimal_plan()
    plan.nutrition.pattern = "Use intermittent fasting on weekdays"
    findings = _run_check(plan, _menstruating(10))
    assert any(
        f.severity == "WARNING" and "menstruating" in f.detail for f in findings
    )


def test_checker_silent_for_postmenopausal_client():
    plan = _minimal_plan()
    plan.nutrition.pattern = "Use intermittent fasting on weekdays"
    c = _client(cycle_status="postmenopausal")
    assert _run_check(plan, c) == []


def test_checker_skips_pregnant_client_entirely():
    """A stale 'menstruating' status must not phase-check a pregnant client."""
    plan = _minimal_plan()
    plan.nutrition.pattern = "Use intermittent fasting on weekdays"
    c = _menstruating(10, pregnancy_status="pregnant_second_trimester")
    assert _run_check(plan, c) == []


def test_checker_flags_weight_loss_protocol_attach():
    plan = _minimal_plan(attached_protocols=["weight-loss-metabolic-reset"])
    findings = _run_check(plan, _menstruating(10))
    assert any(f.target == "weight-loss-metabolic-reset" for f in findings)
    assert all(f.severity == "WARNING" for f in findings)


def test_checker_never_critical():
    """Phase findings are time-varying — they must never hard-block publish."""
    plan = _minimal_plan(attached_protocols=["weight-loss-metabolic-reset"])
    plan.nutrition.pattern = "16:8 window + fasted workouts"
    findings = _run_check(plan, _menstruating(24))
    assert findings
    assert all(f.severity != "CRITICAL" for f in findings)


# --------------------------------------------------- gate + phase helper ----

def test_current_cycle_phase_contract():
    assert current_cycle_phase({}) is None
    d = _menstruating(24).model_dump()
    assert current_cycle_phase(d) == "late_luteal"
    # low-confidence paths → None
    assert current_cycle_phase(_menstruating(90).model_dump()) is None
    assert current_cycle_phase(
        _menstruating(10, cycle_regularity="irregular").model_dump()
    ) is None
    assert current_cycle_phase(
        _client(cycle_status="postmenopausal").model_dump()
    ) is None
    assert current_cycle_phase(
        _menstruating(10, pregnancy_status="pregnant_first_trimester").model_dump()
    ) is None


_HIIT = {
    "slug": "test-hiit", "modality": "cardiovascular",
    "intensity_tier": "advanced", "impact": "high",
    "cycle_phases_avoid": ["early_luteal", "late_luteal"],
    "levels": [], "cautions": [],
}
_WALK = {
    "slug": "test-walk", "modality": "cardiovascular",
    "intensity_tier": "beginner", "impact": "low",
    "levels": [], "cautions": [],
}


def test_gate_flags_avoid_phase_pick_without_dropping_it():
    result = gate_prescription(
        [{"exercise": "test-hiit"}, {"exercise": "test-walk"}],
        [_HIIT, _WALK],
        {},
        cycle_phase="late_luteal",
    )
    kept = {k["exercise"] for k in result.kept}
    assert kept == {"test-hiit", "test-walk"}          # flag, never drop
    assert [s for s, _ in result.phase_flagged] == ["test-hiit"]


def test_gate_no_phase_no_flags():
    result = gate_prescription(
        [{"exercise": "test-hiit"}], [_HIIT, _WALK], {}, cycle_phase=None
    )
    assert result.phase_flagged == []
    assert len(result.kept) == 1


def test_gate_total_on_malformed_tags():
    """A malformed avoid list must never crash (both call sites fail closed —
    a crash here silently empties every exercise prescription)."""
    broken = dict(_HIIT, cycle_phases_avoid={"bad": "shape"})
    result = gate_prescription(
        [{"exercise": "test-hiit"}], [broken, _WALK], {},
        cycle_phase="late_luteal",
    )
    assert len(result.kept) == 1
    assert result.phase_flagged == []


if __name__ == "__main__":
    import sys

    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok    {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL  {name}: {e}")
    sys.exit(1 if failures else 0)
