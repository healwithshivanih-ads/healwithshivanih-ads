"""The safety invariants of the exercise layer, as failable tests.

Exercise differs from every other catalogue entity in one way that matters: for
some clients the right answer is not "less of this" but "none of this". Loaded
spinal flexion for someone with vertebral osteoporosis is a fracture risk, not a
trade-off, and progression for someone with post-exertional malaise is the harm
itself. So the validator carries real ERRORS, and this file proves each one
fires — a safety rule that cannot fail is decoration.

Run: python -m tests.test_exercise_safety
"""

from datetime import date

from fmdb.enums import (
    ExerciseCautionSeverity,
    ExerciseIntensityTier,
    ExerciseModality,
)
from fmdb.models import Exercise, ExerciseCaution, ExerciseLevel
from fmdb.validator import Loaded, validate_loaded

BASE = dict(updated_at=date(2026, 8, 4), updated_by="test")
LEVEL = ExerciseLevel(level="A", prescription="10 repetitions, holding a chair")


def _ex(slug: str, **kw) -> Exercise:
    kw.setdefault("display_name", slug.replace("-", " ").title())
    kw.setdefault("modality", ExerciseModality.strength)
    return Exercise(slug=slug, **kw, **BASE)


def _errors(*exercises):
    errs, _ = validate_loaded(Loaded(exercises=list(exercises)))
    return [e for e in errs if "exercise" in e]


# ── the ladder must have a direction ─────────────────────────────────────────

def test_self_referencing_harder_variant_is_rejected():
    """Otherwise the coach clicks 'harder' and gets the same exercise back."""
    bad = _ex("wall-push-up", harder_variant="wall-push-up")
    assert any("points at itself" in e for e in _errors(bad)), _errors(bad)


def test_self_referencing_easier_variant_is_rejected():
    bad = _ex("goblet-squat", easier_variant="goblet-squat")
    assert any("points at itself" in e for e in _errors(bad)), _errors(bad)


def test_same_slug_both_directions_is_rejected():
    bad = _ex("step-up", easier_variant="sit-to-stand", harder_variant="sit-to-stand")
    assert any("no direction" in e for e in _errors(bad)), _errors(bad)


def test_a_normal_ladder_passes():
    a = _ex("chair-sit-to-stand", harder_variant="sit-to-stand")
    b = _ex("sit-to-stand", easier_variant="chair-sit-to-stand")
    assert not _errors(a, b)


# ── a caution must be actionable ─────────────────────────────────────────────

def test_caution_without_modification_is_rejected():
    """'Be careful' is not guidance. An unactionable caution trains the coach
    to skim, which costs her the ones that matter."""
    bad = _ex("deep-squat", cautions=[ExerciseCaution(
        condition="osteoarthritis",
        severity=ExerciseCautionSeverity.caution,
        reason="Loaded knee flexion can flare an arthritic knee.",
        modification="",
    )])
    assert any("no modification" in e for e in _errors(bad)), _errors(bad)


def test_caution_with_modification_passes():
    good = _ex("deep-squat", cautions=[ExerciseCaution(
        condition="osteoarthritis",
        severity=ExerciseCautionSeverity.caution,
        reason="Loaded knee flexion can flare an arthritic knee.",
        modification="Reduce depth to a pain-free range; raise the seat height.",
    )])
    assert not _errors(good)


def test_block_needs_no_modification():
    """A block says don't. There is nothing to modify — that is the point of
    having two severities rather than one."""
    good = _ex("sit-up", cautions=[ExerciseCaution(
        condition="osteoporosis",
        severity=ExerciseCautionSeverity.block,
        reason="Loaded spinal flexion carries vertebral fracture risk.",
    )])
    assert not _errors(good)


def test_caution_without_reason_is_rejected():
    bad = _ex("jump", cautions=[ExerciseCaution(
        condition="osteoporosis",
        severity=ExerciseCautionSeverity.block,
        reason="   ",
    )])
    assert any("no reason" in e for e in _errors(bad)), _errors(bad)


# ── pacing is not a difficulty setting ───────────────────────────────────────

def test_pacing_exercise_may_not_define_levels():
    """The one rule that encodes nice-ng206-me-cfs-2021 structurally.

    Levels are a progression ladder. For a client with post-exertional malaise,
    walking UP that ladder is the harm the guideline exists to prevent — so a
    pacing entry must not offer one for any matcher to climb.
    """
    bad = _ex("energy-envelope-pacing", modality=ExerciseModality.pacing, levels=[LEVEL])
    assert any("must not define levels" in e for e in _errors(bad)), _errors(bad)


def test_pacing_without_levels_passes():
    good = _ex("energy-envelope-pacing", modality=ExerciseModality.pacing)
    assert not _errors(good)


def test_non_pacing_modalities_may_define_levels():
    good = _ex("one-leg-stand", modality=ExerciseModality.balance,
               intensity_tier=ExerciseIntensityTier.intermediate, levels=[LEVEL])
    assert not _errors(good)


# ── unresolved cross-refs stay warnings, not errors ──────────────────────────

def test_unresolved_variant_is_a_warning_not_an_error():
    """Consistent with the rest of the catalogue: forward references survive so
    a half-built ladder doesn't block the whole validate."""
    ex = _ex("heel-raise", harder_variant="single-leg-heel-raise")
    errs, warns = validate_loaded(Loaded(exercises=[ex]))
    assert not [e for e in errs if "exercise" in e]
    assert any(w.source_entity == "exercise" and w.field == "harder_variant" for w in warns), warns


# ── cautions must match the vocabulary records actually use ──────────────────

def test_caution_matches_via_alias():
    """The bug this exists for: the first screen run against the real roster
    blocked nobody, because the client the PEM block exists for has 'Long-COVID'
    in his conditions and no record anywhere says 'post-exertional malaise'."""
    c = ExerciseCaution(condition="post-exertional malaise",
                        condition_aliases=["long covid", "me/cfs"],
                        severity=ExerciseCautionSeverity.block,
                        reason="Progression provokes relapse.")
    assert c.matches("Long-COVID (fatigue, brain fog); Type 2 diabetes")
    assert c.matches("post-exertional malaise")
    assert not c.matches("Hypothyroidism; Suspected Hashimoto's")


def test_caution_matching_is_case_insensitive_and_survives_empty_text():
    c = ExerciseCaution(condition="Osteoporosis", condition_aliases=["teriparatide"],
                        severity=ExerciseCautionSeverity.block, reason="x")
    assert c.matches("on TERIPARATIDE 750 mcg daily")
    assert not c.matches("")
    assert not c.matches(None)


def test_shipped_catalogue_blocks_progressive_work_for_a_long_covid_record():
    """Data-level, not model-level: proves the entries ON DISK behave, so the
    fix cannot be lost the next time the tranche is regenerated."""
    import pathlib
    from fmdb.loader import load_exercises

    data = pathlib.Path(__file__).resolve().parent.parent / "data"
    exercises = load_exercises(data)
    if not exercises:
        return  # nothing shipped yet; nothing to assert
    record = "long-covid (fatigue, brain fog); cervical spondylotic radiculopathy"
    # A LADDER, not merely a dose. Single-level entries (the flexibility
    # warm-ups) are range-of-movement work inside the envelope — NG206 rules out
    # fixed incremental increases, not all movement, and a PEM client left with
    # literally nothing is a worse outcome than one left with gentle mobility.
    progressive = [e for e in exercises if len(e.levels) > 1]
    blocked = [e for e in progressive
               if any(c.severity == ExerciseCautionSeverity.block and c.matches(record)
                      for c in e.cautions)]
    assert progressive, "no progressive entries on disk to check"
    assert len(blocked) == len(progressive), (
        f"{len(progressive) - len(blocked)} progressive entries would still be offered to a "
        f"long-COVID record: {sorted(e.slug for e in progressive if e not in blocked)}"
    )
    # and pacing must survive the same screen, or the client is left with nothing
    pacing = [e for e in exercises if e.modality == ExerciseModality.pacing]
    assert pacing, "no pacing entry on disk — a blocked client would be left with nothing"
    assert not any(c.severity == ExerciseCautionSeverity.block and c.matches(record)
                   for e in pacing for c in e.cautions)


if __name__ == "__main__":
    passed = failed = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            passed += 1
            print(f"  ✓ {name}")
        except AssertionError as e:
            failed += 1
            print(f"  ✗ {name}\n      {e}")
    print(f"\n{passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)
