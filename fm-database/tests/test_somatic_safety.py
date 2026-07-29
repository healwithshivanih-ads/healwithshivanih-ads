"""The safety invariants of the mind-body layer, as failable tests.

The whole risk of this layer is one failure mode: an ASSOCIATION between an
emotion and a symptom being read by a client as a CAUSE — "my grief gave me
fibroids". Three rules in the validator guard against it, and this file proves
each one actually fires, because a safety rule that cannot fail is decoration.

Run: python -m tests.test_somatic_safety
"""

from datetime import date

from fmdb.enums import SomaticCategory, SomaticTargetKind
from fmdb.models import SomaticMap, SomaticPractice, SomaticStep
from fmdb.validator import Loaded, validate_loaded

BASE = dict(updated_at=date(2026, 7, 28), updated_by="test")
MAP_BASE = dict(
    target_kind=SomaticTargetKind.symptom,
    target_slug="anxiety",
    **BASE,
)


def _errors(*, maps=(), practices=()):
    errs, _ = validate_loaded(Loaded(somatic_maps=list(maps), somatic_practices=list(practices)))
    return [e for e in errs if "somatic" in e]


def test_differential_note_is_required():
    """Without it, an association reads as a cause. This is the core guard."""
    bad = SomaticMap(slug="no-diff", display_name="x", differential_note="", **MAP_BASE)
    errs = _errors(maps=[bad])
    assert any("differential_note" in e for e in errs), errs


def test_differential_note_present_passes():
    good = SomaticMap(slug="has-diff", display_name="x",
                      differential_note="Exclude structural causes first.", **MAP_BASE)
    assert not _errors(maps=[good])


def test_whitespace_only_differential_note_is_rejected():
    """A space is not a differential."""
    bad = SomaticMap(slug="ws-diff", display_name="x", differential_note="   \n  ", **MAP_BASE)
    assert any("differential_note" in e for e in _errors(maps=[bad]))


def test_coach_only_note_forbids_general_sensitivity():
    """Contradictory gate: 'never auto-surface' alongside 'safe for anyone'."""
    bad = SomaticMap(slug="contra", display_name="x", differential_note="Exclude X.",
                     sensitivity="general", coach_only_note="Never surface — names a bereavement.",
                     **MAP_BASE)
    errs = _errors(maps=[bad])
    assert any("coach_only_note" in e for e in errs), errs


def test_coach_only_note_with_sensitive_is_allowed():
    good = SomaticMap(slug="ok", display_name="x", differential_note="Exclude X.",
                      sensitivity="sensitive", coach_only_note="Session material only.",
                      **MAP_BASE)
    assert not _errors(maps=[good])


def test_timed_practice_must_have_steps():
    """A timed practice with no steps cannot be rendered — it is a dead card."""
    bad = SomaticPractice(slug="empty", display_name="x", category=SomaticCategory.breath,
                          timed=True, steps=[], **BASE)
    assert any("no steps" in e for e in _errors(practices=[bad]))


def test_behavioural_protocol_may_have_no_steps():
    """timed=False is the legitimate escape hatch for 'how to eat a meal'."""
    ok = SomaticPractice(slug="behav", display_name="x", category=SomaticCategory.behavioural,
                         timed=False, steps=[], **BASE)
    assert not _errors(practices=[ok])


def test_sensitivity_defaults_are_not_permissive():
    """A map that says nothing about sensitivity must not default to 'general'
    at the point it matters. The model default is general, so the ENRICHER is
    what fails closed — assert that, since staged data is what reaches disk."""
    from fmdb.ingest.staging import _ENRICHERS
    out = _ENRICHERS["somatic_maps"]({"slug": "x", "display_name": "x"}, "src", "test")
    assert out["sensitivity"] == "sensitive", out["sensitivity"]


def test_practice_enricher_never_guesses_motion_shape():
    """Shape is derived downstream from the whole corpus, never per-entry."""
    from fmdb.ingest.staging import _ENRICHERS
    out = _ENRICHERS["somatic_practices"](
        {"slug": "x", "display_name": "x", "motion_shape": "hold-release"}, "src", "test")
    # None, not "": motion_shape is a typed enum now, and "" is not a valid value.
    assert out["motion_shape"] is None, "extractor must not be able to set motion_shape"


if __name__ == "__main__":
    import sys
    import traceback

    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception:
            failures += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
