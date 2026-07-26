"""Single source of truth for what `prep_time_min` / `cook_time_min` mean.

`prep_time_min` is HANDS-ON minutes only. Passive waits — overnight soaking,
marinating, chilling, setting, fermenting, proving — belong in the ingredient
line or a step, never in the timer.

Why it matters: the client app renders `prep_time_min + cook_time_min` as one
"N min" chip on the recipe card (see `_recipeCard` in lib/fmdb/client-app.ts).
An 8-hour soak folded into prep turned a chickpea snack into "500 min" on a
live client's card (masala-roasted-chana, caught 2026-07-26).

The library sets its own ceiling: across 467 recipes the largest genuine
hands-on prep is 32 min, and all 74 soak-based recipes count hands-on time
only — overnight oats prep=5, rajma prep=10, chana masala prep=10.

Every path that writes a recipe YAML should run `check_times` (coach in the
loop — surface it and let them fix the number) or `normalise_prep_min`
(unattended — clamp to the default and warn).
"""
from __future__ import annotations

# ~2x the library's real hands-on max (32 min). Above this, the number is
# passive time that leaked into the field, not someone chopping for an hour.
MAX_HANDS_ON_PREP_MIN = 60
# A long braise or a from-dry legume simmer is real (herbed-hummus cooks for
# 120). Half a day is not.
MAX_COOK_MIN = 240

_PREP_MSG = (
    "prep_time_min={got} — that's passive time (soaking/marinating/chilling), "
    "not hands-on. The card shows prep+cook as one number, so this renders as "
    '"{total} min" to the client. Put the wait in the ingredient line or a '
    "step and set prep to the hands-on minutes (library max is ~30)."
)


def _int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def check_times(prep, cook) -> list[str]:
    """Problems with a recipe's timings, worst first. Empty list = fine."""
    p, c = _int(prep), _int(cook)
    out: list[str] = []
    if p > MAX_HANDS_ON_PREP_MIN:
        out.append(_PREP_MSG.format(got=p, total=p + c))
    if c > MAX_COOK_MIN:
        out.append(
            f"cook_time_min={c} — longer than any real cook time in the "
            f"library (max {MAX_COOK_MIN}); check it isn't a passive wait."
        )
    return out


def normalise_prep_min(value, default: int = 10) -> tuple[int, str | None]:
    """Clamp an unattended write. Returns (minutes, warning or None).

    Clamps to `default` rather than to the ceiling: once passive time is folded
    in, the real hands-on figure is unknowable, and the library default is a
    far better guess than 60.
    """
    p = _int(value)
    if p > MAX_HANDS_ON_PREP_MIN:
        return default, (
            f"prep_time_min {p} looked like passive soak/chill time — "
            f"reset to {default}; confirm the hands-on minutes"
        )
    return (p if p > 0 else default), None
