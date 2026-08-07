"""Group a movement session by body position, so the client gets up once.

THE PROBLEM THIS SOLVES IS PRACTICAL, NOT CLINICAL. A session that reads
sit-to-stand → floor bridge → heel raises → bird-dog is eight individually
good picks and an inconvenient half hour: the client is on the mat, up, down
again, up again, fetching a chair twice. Nobody says this out loud — they just
stop doing the session.

The model is asked to do this itself (rule 32 in the suggester prompt), and
this pass runs over its answer anyway, for the same reason the suitability gate
does: ordering guidance in prose is followed most of the time, and "most of the
time" is how a client ends up on the floor three separate times.

WHAT IS PRESERVED, because order IS the prescription:
  - the first pick stays first — that slot is the warm-up
  - a flexibility pick that was last stays last — that slot is the cool-down
  - inside a position band, the coach's (or model's) relative order is untouched
  - bands run in the order they first appear, so "balance before strength"
    and "upright before floor" survive if that is what was asked for

`any_position` entries (pacing, the cool-down sequence, floor-get-up) travel
with whatever they were next to — they fit anywhere, so making them force a
band change would be inventing a transition that does not exist.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

#: Positions that need the client on the floor. Getting down and up again is the
#: transition worth avoiding — which is why `seated` is its own band rather than
#: being lumped in with either side.
_FLOOR = {"lying_supine", "lying_prone", "side_lying", "four_point"}
_CHAIR = {"seated"}
_UPRIGHT = {"standing", "walking"}


def position_band(position: str) -> str | None:
    """The band a position belongs to, or None for `any_position`/unknown."""
    if position in _FLOOR:
        return "floor"
    if position in _CHAIR:
        return "chair"
    if position in _UPRIGHT:
        return "upright"
    return None


def _meta_index(entries: Iterable[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    out: dict[str, Mapping[str, Any]] = {}
    for e in entries:
        slug = e.get("slug")
        if isinstance(slug, str) and slug:
            out[slug] = e
    return out


def group_by_position(
    picks: list[Any],
    entries: Iterable[Mapping[str, Any]],
    *,
    slug_of=lambda p: getattr(p, "exercise", None) or (p.get("exercise") if isinstance(p, dict) else None),
) -> list[Any]:
    """Return `picks` reordered so each position band is contiguous.

    Pure and total: an unknown slug, a missing catalogue entry or a session too
    short to have a middle all come back as the input list, unchanged. This runs
    on the path that produces a real prescription, so it must never be the reason
    an exercise disappears.
    """
    if len(picks) < 4:
        # Three or fewer is at most one transition to save, and the risk of
        # second-guessing a deliberate order outweighs it.
        return list(picks)

    meta = _meta_index(entries)

    def band_of(p: Any) -> str | None:
        slug = slug_of(p)
        entry = meta.get(slug) if isinstance(slug, str) else None
        return position_band(str((entry or {}).get("position") or ""))

    def modality_of(p: Any) -> str:
        slug = slug_of(p)
        entry = meta.get(slug) if isinstance(slug, str) else None
        return str((entry or {}).get("modality") or "")

    head = picks[0]
    # A flexibility pick in the final slot is the cool-down. Pinning it costs
    # nothing when it is not (it is already last) and protects the one case where
    # regrouping would otherwise pull a stretch into the middle of the work.
    has_cooldown = modality_of(picks[-1]) == "flexibility"
    middle = picks[1:-1] if has_cooldown else picks[1:]
    tail = [picks[-1]] if has_cooldown else []

    if len(middle) < 2:
        return list(picks)

    # Resolve `any_position` by inheritance: previous neighbour first (it is
    # already where the client is), then the next one, then the head's band.
    bands: list[str | None] = [band_of(p) for p in middle]
    fallback = band_of(head) or "upright"
    resolved: list[str] = []
    for i, b in enumerate(bands):
        if b is not None:
            resolved.append(b)
            continue
        prev = resolved[i - 1] if i > 0 else None
        nxt = next((x for x in bands[i + 1 :] if x is not None), None)
        resolved.append(prev or nxt or fallback)

    order: list[str] = []
    for b in resolved:
        if b not in order:
            order.append(b)

    # The pinned ends anchor the band order, or grouping creates the transition
    # it exists to remove: a standing warm-up followed by the floor block and
    # then the standing work puts the client on the mat and back up for nothing.
    head_band = band_of(head)
    if head_band in order:
        order.remove(head_band)
        order.insert(0, head_band)
    tail_band = band_of(tail[0]) if tail else None
    if tail_band in order:
        order.remove(tail_band)
        order.append(tail_band)

    grouped: list[Any] = []
    for b in order:
        grouped.extend(p for p, pb in zip(middle, resolved) if pb == b)

    return [head, *grouped, *tail]


def position_transitions(
    picks: list[Any],
    entries: Iterable[Mapping[str, Any]],
    *,
    slug_of=lambda p: getattr(p, "exercise", None) or (p.get("exercise") if isinstance(p, dict) else None),
) -> int:
    """How many times this session changes the client's base position.

    Used by the tests to assert the pass actually improves things, and available
    to any surface that wants to say "this session gets you up and down 5 times".
    """
    meta = _meta_index(entries)
    seq: list[str] = []
    for p in picks:
        slug = slug_of(p)
        entry = meta.get(slug) if isinstance(slug, str) else None
        b = position_band(str((entry or {}).get("position") or ""))
        if b is None:
            continue
        if not seq or seq[-1] != b:
            seq.append(b)
    return max(0, len(seq) - 1)
