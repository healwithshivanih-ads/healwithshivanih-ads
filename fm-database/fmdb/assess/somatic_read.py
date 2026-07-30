"""The chief-complaint read: what the catalogue says about what the client
actually came in for.

WHY THIS AND NOT CONVERGENCE. Convergence ("what do these seven symptoms
share?") only clears its own null model about one time in three, because the
commonest themes — fear in 58% of maps, anger 54%, holding-on 49% — can never
show lift. The most clinically obvious pattern is the one that test is blindest
to.

The chief-complaint read asks a smaller and far more answerable question: for
the thing this client most wants fixed, what does the source say? One map, no
statistics, no threshold — and it fires for every client whose main issue is in
the book. It is what a coach would actually look up.

Matching is alias-aware and tolerant of how conditions are really written in
client.yaml — "Hypertension — ON TREATMENT (previously unreported) — Telma 40"
has to resolve to `hypertension`. A naive slugify finds 2 of Hariharan's maps
where this finds 8.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable

from .somatic_themes import SomaticTheme, THEME_LABELS, classify_root

#: Words that carry no clinical meaning when matching a condition string.
_NOISE = {
    "suspected", "confirmed", "possible", "probable", "mild", "moderate", "severe",
    "chronic", "acute", "on", "off", "treatment", "previously", "unreported",
    "and", "or", "the", "a", "of", "with", "in", "at", "to", "for", "non", "now",
    "history", "past", "current", "ongoing", "recurrent", "grade", "type",
}


def _phrases(condition: str) -> list[str]:
    """Candidate lookup keys from one free-text condition, longest first.

    Real entries look like "Hypertension — ON TREATMENT (previously unreported)
    — Telma 40 twice daily" or "Type 2 diabetes — HbA1c 6.6% (progressed…)".
    The clinical name is almost always the head, before the first dash, comma,
    colon or bracket.
    """
    head = re.split(r"[—–\-(,:;/]", str(condition))[0]
    head = re.sub(r"\s+", " ", head).strip().lower()
    if not head:
        return []
    words = [w for w in re.findall(r"[a-z0-9']+", head) if w not in _NOISE]
    out: list[str] = []
    if words:
        # BOTH joins, every time. Catalogue aliases are written the way a
        # clinician types them — "underactive thyroid", with a space — while
        # slugs are hyphenated. Emitting only the hyphenated form made 3,130
        # multi-word aliases unreachable, so "Underactive thyroid (subclinical)"
        # matched nothing even though `thyroid-dysfunction` carries exactly that
        # alias. Cheap to ask for both; the resolver ignores what it lacks.
        def _both(ws: list[str]) -> list[str]:
            return ["-".join(ws), " ".join(ws)] if len(ws) > 1 else ["-".join(ws)]

        out.extend(_both(words))                         # full head
        for n in (3, 2):                                 # leading n-grams
            if len(words) > n:
                out.extend(_both(words[:n]))
        if len(words) > 1:
            out.append(words[-1])                        # trailing noun
        out.append(words[0])
    # de-dup, keep order, drop 1-2 char keys which match noisily
    seen, keys = set(), []
    for k in out:
        if len(k) > 2 and k not in seen:
            seen.add(k)
            keys.append(k)
    return keys


@dataclass
class ChiefRead:
    """One matched condition and what the catalogue says about it."""
    condition: str                  # as the coach wrote it
    target_slug: str
    map_slug: str
    display_name: str
    sensitivity: str
    gated: bool                     # coach_only_note set — never auto-surface
    roots: list[tuple[str, str]] = field(default_factory=list)   # (pattern, note)
    themes: list[SomaticTheme] = field(default_factory=list)
    reframe: str = ""
    inquiry_question: str = ""
    somatic_practice: str = ""
    differential_note: str = ""

    @property
    def client_safe(self) -> bool:
        """Safe to surface unsupervised at the client's `full` depth."""
        return self.sensitivity == "general" and not self.gated

    @property
    def theme_labels(self) -> list[str]:
        return [THEME_LABELS[t][0] for t in self.themes]


def read_chief_complaints(
    client: dict[str, Any],
    maps: Iterable[dict[str, Any]],
    resolve: Any,
    limit: int | None = None,
) -> list[ChiefRead]:
    """Map a client's stated conditions onto catalogue somatic maps.

    `resolve(slug) -> canonical slug` is the alias-aware resolver built from the
    live catalogue (symptoms first, then topics) — passed in so this module
    stays free of loader imports and is trivially testable.

    Ordered as the coach wrote the conditions: the first-listed condition is
    almost always the presenting one.
    """
    by_target: dict[str, dict[str, Any]] = {}
    for m in maps:
        by_target.setdefault(resolve(str(m.get("target_slug", ""))), m)

    out: list[ChiefRead] = []
    seen: set[str] = set()
    for cond in (client.get("active_conditions") or []):
        for key in _phrases(str(cond)):
            canon = resolve(key)
            m = by_target.get(canon)
            if not m or m["slug"] in seen:
                continue
            seen.add(m["slug"])
            roots = [
                (str(r.get("pattern", "")), str(r.get("note", "")))
                for r in (m.get("emotional_roots") or [])
            ]
            themes: list[SomaticTheme] = []
            for p, n in roots:
                for t in classify_root(p, n):
                    if t not in themes:
                        themes.append(t)
            out.append(
                ChiefRead(
                    condition=str(cond),
                    target_slug=canon,
                    map_slug=m["slug"],
                    display_name=str(m.get("display_name", "")),
                    sensitivity=str(m.get("sensitivity", "sensitive")),
                    gated=bool(str(m.get("coach_only_note", "")).strip()),
                    roots=roots,
                    themes=themes,
                    reframe=str(m.get("reframe", "")),
                    inquiry_question=str(m.get("inquiry_question", "")),
                    somatic_practice=str(m.get("somatic_practice", "")),
                    differential_note=str(m.get("differential_note", "")),
                )
            )
            break  # first phrase that resolves wins; don't double-match a condition
        if limit and len(out) >= limit:
            break
    return out
