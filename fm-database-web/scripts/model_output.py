"""Tolerate malformed elements in a model's tool-call output.

The model is asked for a list of objects and mostly returns one. Occasionally it
emits a bare string, a null, or a list where an object belongs — and every
consumer that then does `el.get(...)` or `el["k"] = v` raises, losing the WHOLE
batch to one bad sibling. That is how cl-006 lost its recipe pack on 2026-08-02:
one string among 43 good recipes, an AttributeError out of main(), and the cron
logged only "produced no output".

Before this module every call site re-invented a partial guard, and each one
defended a different layer: batch-draft-recipe-candidates.py had an isinstance
check protecting `_normalize_lists` but left the `by_name` comprehension on the
very next line unguarded; analyze-catalogue-duplicates.py filtered `members` by
type but never checked the group object holding them. `usable_dicts` is the one
place that knowledge now lives.

The posture is the one fmdb/ingest/staging.py has always used for this bug
class: record-and-skip, don't abort. It ALWAYS warns on stderr, naming the type
and a truncated sample, because a silent skip in a cron log is indistinguishable
from the model simply not returning that item.

What to do when NOTHING survives is deliberately the caller's decision, not this
module's — it depends on what the client experiences if the artifact is quietly
incomplete. A recipe pack missing one dish is fine; a grocery list missing a
whole week is worse than no list, because the client shops from it.
"""

from __future__ import annotations

import sys
from typing import Any

_SAMPLE_CHARS = 120


def _sample(value: Any, limit: int = _SAMPLE_CHARS) -> str:
    """A short, single-line rendering of what the model actually produced."""
    text = str(value).replace("\n", " ")
    return text if len(text) <= limit else text[:limit] + "…"


def usable_dicts(
    raw: Any,
    label: str,
    field: str = "entry",
    *,
    stream=None,
) -> list[dict]:
    """Return only the well-formed dict elements of `raw`, warning about the rest.

    `raw` not being a list at all is handled too, and matters more than it
    looks: a bare string is iterable, so a caller that skipped this check would
    walk it CHARACTER BY CHARACTER — quietly producing 14 junk entries instead
    of the crash it was trying to avoid.

    `label` prefixes the stderr line (use the artifact, e.g. "recipes",
    "grocery", "cleanup"), `field` names what the list was meant to hold so a
    script with two such lists stays readable in a cron log.
    """
    out = stream if stream is not None else sys.stderr

    if not isinstance(raw, list):
        if raw is None:
            return []  # an absent list is a normal empty, not a malformation
        print(
            f"[{label}] model returned {type(raw).__name__} for '{field}' "
            f"(expected list) — skipped: {_sample(raw)}",
            file=out,
        )
        return []

    good: list[dict] = []
    for el in raw:
        if isinstance(el, dict):
            good.append(el)
            continue
        print(
            f"[{label}] skipping malformed {field} — model emitted "
            f"{type(el).__name__} (expected object): {_sample(el)}",
            file=out,
        )
    return good
