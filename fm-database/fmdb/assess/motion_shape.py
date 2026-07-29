"""Derive a somatic practice's motion shape from its step data.

The shape decides which player renders the practice in the client app. It is
NOT set by the extractor: a shape guessed per-entry, before the library exists,
cannot be checked against anything. A four-shape guess taken from 13 entries was
already wrong at 87 and wrong again at 123. Deriving it from the whole corpus is
what produced the seven the library actually needs.

Classification uses only objective facts the extractor recorded:
  * `timed`      — is this a session at all, or a protocol applied to an activity
  * step actions — the bare movement verbs
  * (bilaterality and repeated rounds are MODIFIERS, not shapes)

`rest` and `observe` are filler verbs that appear in almost every practice and
carry no motion information, so they are excluded before classifying.

Order matters: travel is tested before breath because a practice can both rock
and breathe, and the travel is what has to be drawn.
"""

from __future__ import annotations

from typing import Any, Iterable

from ..enums import MotionShape

#: verbs that carry no motion information
FILLER = {"rest", "observe", ""}

_TRAVEL = {"circle", "sway", "rock", "tap", "swing", "track"}
_BREATH = {"expand", "shrink", "inhale", "exhale"}
_LOAD = {"press", "hold", "squeeze", "tense"}
_RELEASE = {"release", "drop", "soften", "discharge", "let go"}
_CONTACT = {"massage", "stroke", "touch", "cradle"}


def _actions(steps: Iterable[dict[str, Any]]) -> set[str]:
    return {(s.get("action") or "").strip().lower() for s in (steps or [])} - FILLER


def classify(practice: dict[str, Any]) -> MotionShape:
    """Return the MotionShape for a practice dict (or model dump)."""
    if practice.get("timed", True) is False:
        return MotionShape.checklist

    a = _actions(practice.get("steps") or [])
    if a & _TRAVEL:
        return MotionShape.continuous_travel
    if a & _BREATH:
        return MotionShape.breath_excursion

    load, release = bool(a & _LOAD), bool(a & _RELEASE)
    if load and release:
        return MotionShape.load_release
    if load or (a & _CONTACT):
        return MotionShape.sustained_pressure
    if release:
        return MotionShape.release
    return MotionShape.still


#: How each shape is rendered. Kept here so the app and the catalogue agree on
#: the vocabulary, and so an unhandled shape is a visible gap rather than a
#: silent fallback.
RENDERER_NOTES: dict[MotionShape, str] = {
    MotionShape.breath_excursion:
        "Existing BreathOverlay. Orb scales on a cosine ease; hold phases already supported.",
    MotionShape.continuous_travel:
        "A point tracing a path with a fading trail. The trail sets the pace without words.",
    MotionShape.load_release:
        "Charge meter fills under effort, tightens at peak, snaps empty on release with a ripple.",
    MotionShape.sustained_pressure:
        "Charge meter fills and HOLDS — no release event. Distinct ending from load_release.",
    MotionShape.release:
        "Decay only. A held form loosens, drifts down and settles. No effort phase.",
    MotionShape.still:
        "Near-motionless ambient glow. No countdown — a timer works against these practices.",
    MotionShape.checklist:
        "No player. Ordered steps that tick off; applied to an activity, not a session.",
}
