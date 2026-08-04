"""Screen the exercise catalogue against one client record.

The catalogue knows what a movement demands. The client record knows what a
body can take. This module is the join, and it exists because doing that join
by hand is where a coach makes the mistake nobody notices: not choosing a
dangerous exercise, but forgetting that a client with sixteen tagged pain
regions has knees in the list.

FOUR VERDICTS, in descending precedence:

    blocked  — a `block`-severity caution matches the record. Not a ranking
               penalty. The exercise does not get offered.
    caution  — a `caution`-severity caution matches. Offered WITH its
               modification attached; the modification is the point.
    watch    — nothing in the entry matches, but something about this client
               says look twice: a tagged pain region the exercise loads, or a
               balance demand high for their age.
    clear    — nothing fired.

WHY `watch` IS SEPARATE FROM `caution`. A caution is authored knowledge — the
entry says what to do. A watch is derived from the client's own record and has
no authored modification behind it, so presenting the two the same way would
imply guidance that does not exist. The coach decides what a watch means.

Everything here is a NUDGE TO THE COACH, never an automatic edit to a plan.
The one-way door stays hers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from .contra_screen import _blob  # shared so the negation guard cannot diverge

# ── how the intake body map maps onto the exercise regions ───────────────────
# The intake map is per-side (`knee_left`); exercise entries are side-agnostic
# (`knee`) because an entry cannot know which of a client's knees hurts. Strip
# the side, then fold the map's finer regions onto the coarser exercise set.
_SIDE_SUFFIXES = ("_left", "_right")
_REGION_FOLD = {
    "neck_front": "neck", "neck_back": "neck", "head_back": "neck",
    "scapula": "upper_back",
    "arm": "shoulder",          # the map's "arm" is the upper arm
    "hand": "wrist_hand",
    "upper_abdomen": "abdomen", "lower_abdomen": "abdomen",
    "pelvis": "sacrum_pelvis", "sacrum": "sacrum_pelvis",
    "buttock": "hip",
    "shin": "ankle_foot", "foot": "ankle_foot", "achilles": "ankle_foot",
}
#: Regions on the body map that no exercise entry loads. Folding these onto
#: something would invent an overlap; dropping them is correct.
_REGION_IGNORE = {"head", "face", "jaw"}

#: Client fields that describe what a body can currently take. Passed to
#: `_blob`, which strips negations so "no history of falls" is not read as a
#: falls history.
_SCREEN_FIELDS = (
    "active_conditions", "medical_history", "current_medications", "medications",
    "known_allergies", "notes", "reported_triggers",
    # `weight_loss` is a dict; _blob flattens it to "key value" pairs, which is
    # how `exercise_limitations` and `exercise_current` reach the screen. It is
    # the ONE field explicitly about what a client cannot do, and leaving it out
    # meant a limitation recorded only there ("knee pain (left)") was invisible.
    # The first roster run hid this: the client it would have mattered for also
    # had his condition in active_conditions, so the screen looked right.
    "weight_loss",
)


def fold_pain_regions(pain_locations: Iterable[str]) -> set[str]:
    """Intake body-map slugs → side-agnostic exercise regions."""
    out: set[str] = set()
    for raw in pain_locations or []:
        p = str(raw).strip().lower()
        for suf in _SIDE_SUFFIXES:
            if p.endswith(suf):
                p = p[: -len(suf)]
                break
        if p in _REGION_IGNORE:
            continue
        out.add(_REGION_FOLD.get(p, p))
    return out


@dataclass
class ScreenNote:
    """One reason an exercise is not simply `clear`."""
    kind: str          # "block" | "caution" | "pain" | "age"
    label: str         # the condition or region that fired
    detail: str        # coach-facing explanation
    modification: str = ""


@dataclass
class ExerciseVerdict:
    slug: str
    display_name: str
    client_name: str
    modality: str
    verdict: str                       # blocked | caution | watch | clear
    notes: list[ScreenNote] = field(default_factory=list)
    start_level: Optional[str] = None  # the level label to begin at
    start_reason: str = ""

    @property
    def offerable(self) -> bool:
        return self.verdict != "blocked"


def _age_of(client: dict[str, Any]) -> Optional[int]:
    """Best-effort age. Mirrors Client.estimated_age(): exact if present, else
    the midpoint of the age band."""
    for key in ("estimated_age", "age"):
        v = client.get(key)
        if isinstance(v, int) and v > 0:
            return v
    band = str(client.get("age_band") or "").replace("–", "-").strip()
    if not band:
        return None
    parts = [p for p in band.split("-") if p.strip().isdigit()]
    if len(parts) == 2:
        return (int(parts[0]) + int(parts[1])) // 2
    if len(parts) == 1:
        return int(parts[0])
    return None


def _pick_start_level(exercise: dict[str, Any], supported: bool) -> tuple[Optional[str], str]:
    """Which level to begin at.

    `supported` means something in the screen says keep a hand on something —
    age, a falls signal, an osteoporosis caution. In that case start at the
    first level that names any support, which is how the Otago programme itself
    progresses: supported first, unsupported once recovery strategies are
    confirmed. Otherwise start at the first (easiest) level.
    """
    levels = exercise.get("levels") or []
    if not levels:
        return None, ""
    if supported:
        for lv in levels:
            sup = str(lv.get("support") or "").strip().lower()
            if sup and sup != "none":
                return str(lv.get("level")), "start supported"
    return str(levels[0].get("level")), "start at the easiest level"


def screen_exercise(exercise: dict[str, Any], client: dict[str, Any]) -> ExerciseVerdict:
    """Screen ONE exercise against ONE client record."""
    blob, _asked = _blob(client, _SCREEN_FIELDS)
    pain = fold_pain_regions(client.get("pain_locations") or [])
    age = _age_of(client)

    notes: list[ScreenNote] = []
    blocked = False
    cautioned = False
    supported = False

    for c in exercise.get("cautions") or []:
        terms = [c.get("condition", "")] + list(c.get("condition_aliases") or [])
        if not _any_term_matches(terms, blob):
            continue
        sev = str(c.get("severity") or "caution")
        if sev == "block":
            blocked = True
            notes.append(ScreenNote("block", c.get("condition", ""), c.get("reason", "")))
        else:
            cautioned = True
            supported = True
            notes.append(ScreenNote("caution", c.get("condition", ""),
                                    c.get("reason", ""), c.get("modification", "")))

    # Pain overlap — derived from the client's own body map, no authored
    # modification behind it, so it is a `watch` rather than a caution.
    overlap = sorted(pain & {str(r) for r in (exercise.get("joint_stress") or [])})
    if overlap:
        notes.append(ScreenNote(
            "pain", ", ".join(r.replace("_", " ") for r in overlap),
            "This client has tagged pain in a region the exercise loads. Confirm it is "
            "comfortable before prescribing, and work in a pain-free range.",
        ))

    # Age vs balance demand. The Otago trials found the over-80s benefit MOST
    # from balance work and are also the group a fall costs most, so this is a
    # "start supported" signal, never a reason to withhold.
    demand = int(exercise.get("balance_demand") or 0)
    if age is not None and demand >= 2 and age >= 75:
        supported = True
        notes.append(ScreenNote(
            "age", f"age ~{age}, balance demand {demand}/3",
            "The over-75s gain the most from balance work and can least afford a fall. "
            "Keep support until recovery strategies are confirmed.",
        ))

    verdict = "blocked" if blocked else "caution" if cautioned else "watch" if notes else "clear"
    start_level, start_reason = (None, "") if blocked else _pick_start_level(exercise, supported)

    return ExerciseVerdict(
        slug=exercise.get("slug", "?"),
        display_name=exercise.get("display_name", ""),
        client_name=(exercise.get("client_name") or "").strip() or exercise.get("display_name", ""),
        modality=str(exercise.get("modality") or ""),
        verdict=verdict,
        notes=notes,
        start_level=start_level,
        start_reason=start_reason,
    )


def _any_term_matches(terms: Iterable[str], blob: str) -> bool:
    """Separator-insensitive substring match — mirrors ExerciseCaution.matches().

    Kept here rather than importing the Pydantic method so this module can screen
    plain dicts straight off disk without a model round-trip, which is what the
    shim does.
    """
    import re

    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

    hay = norm(blob)
    if not hay:
        return False
    return any(t in hay for t in (norm(x) for x in terms) if t)


_VERDICT_ORDER = {"blocked": 0, "caution": 1, "watch": 2, "clear": 3}


def screen_all(exercises: list[dict[str, Any]], client: dict[str, Any]) -> list[ExerciseVerdict]:
    """Screen the whole catalogue, most-restricted first.

    Blocked entries sort to the top deliberately: the coach should see what is
    off the table before she sees what is on it.
    """
    out = [screen_exercise(e, client) for e in exercises]
    out.sort(key=lambda v: (_VERDICT_ORDER.get(v.verdict, 9), v.modality, v.slug))
    return out


def summarise(verdicts: list[ExerciseVerdict]) -> dict[str, int]:
    counts = {"blocked": 0, "caution": 0, "watch": 0, "clear": 0}
    for v in verdicts:
        counts[v.verdict] = counts.get(v.verdict, 0) + 1
    return counts
