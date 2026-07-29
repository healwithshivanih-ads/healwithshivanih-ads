"""Near-duplicate detection for the catalogue.

Why this exists
---------------
One cleanup session (2026-07-28/29) found FIVE duplicate pairs that had been
sitting in the catalogue unnoticed:

    coq10 / coenzyme-q10 / coenzyme-q10-diabetes
    mitochondrial-health-nutrients / mitochondrial-health-nutrition
    type-2-diabetes / type-2-diabetes-mellitus

Every one of them had the same shape: same concept, two slugs, and OVERLAPPING
ALIASES — so `_resolve_index` (which is last-wins by load order) silently picked
a winner nobody chose. Cleanup is unbounded work; prevention is not. The ingest
pipeline creates near-duplicates faster than anyone reads the catalogue, so the
only durable fix is a check that runs before they accumulate.

What it flags, strongest signal first
-------------------------------------
1. SHARED_ALIAS     two entities of the same kind claim the same alias. This is
                    the smoking gun — it is what made all five pairs ambiguous,
                    and it is never intentional.
2. SAME_DISPLAY     two entities of the same kind render the same display_name.
                    A coach reading the UI cannot tell them apart.
3. ALIAS_IS_SLUG    one entity's alias is another's canonical slug (same kind).
                    The validator already errors on this; repeated here so a
                    single command gives the whole duplicate picture.
4. NEAR_SLUG        high token overlap between two slugs of the same kind. The
                    weakest signal and the only one that guesses, so it is
                    reported last and never on its own evidence.

Deliberately NOT flagged: entities of DIFFERENT kinds sharing a name. A topic
and a symptom called "histamine-intolerance" is a legitimate, documented pattern
in this catalogue (the clinical area vs the felt experience).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from itertools import combinations

from .validator import Loaded


# Entity kinds worth checking. Claims are excluded: they are statements, not
# concepts, so two claims saying similar things is normal and expected.
_KINDS = ("topics", "mechanisms", "symptoms", "supplements", "protocols",
          "home_remedies", "cooking_adjustments", "lab_tests")

# Qualifier words that legitimately distinguish two entries. `vitamin-d` vs
# `vitamin-d-deficiency` is a real distinction, so a pair whose only difference
# is one of these is NOT a duplicate.
_DISTINGUISHING = {
    "deficiency", "excess", "toxicity", "prevention", "recovery", "risk",
    "male", "female", "paediatric", "pediatric", "acute", "chronic",
    "primary", "secondary", "type", "low", "high", "fast", "slow",
}


@dataclass
class DuplicateFinding:
    kind: str            # "SHARED_ALIAS" | "SAME_DISPLAY" | "ALIAS_IS_SLUG" | "NEAR_SLUG"
    entity_kind: str     # topics / mechanisms / ...
    slugs: list[str]
    detail: str
    severity: str = "WARNING"    # SHARED_ALIAS + ALIAS_IS_SLUG are CRITICAL
    evidence: list[str] = field(default_factory=list)

    def render(self) -> str:
        return (f"[{self.severity:8s}] {self.kind:13s} {self.entity_kind}: "
                f"{' + '.join(self.slugs)} — {self.detail}")


def _canon(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s or "").lower()).strip("-")


def _tokens(s: str) -> set[str]:
    return {t for t in _canon(s).split("-") if len(t) > 2}


def _entities(loaded: Loaded, kind: str) -> list:
    return list(getattr(loaded, kind, []) or [])


def find_duplicates(loaded: Loaded, near_threshold: float = 0.6
                    ) -> list[DuplicateFinding]:
    """Scan the catalogue for near-duplicate entities.

    `near_threshold` controls only the weakest (NEAR_SLUG) check. The three
    strong checks are exact and take no threshold.
    """
    out: list[DuplicateFinding] = []

    for kind in _KINDS:
        ents = _entities(loaded, kind)
        if not ents:
            continue

        slugs = {getattr(e, "slug", None) or getattr(e, "id", None): e for e in ents}
        slugs.pop(None, None)

        # ---- 1. two entities claiming the same alias -------------------------
        # NOTE: owners must be a SET. An entity often lists two spellings that
        # normalise to the same string ("Anti-Müllerian Hormone" and
        # "anti-mullerian-hormone"), which counted the entity against itself and
        # produced 600 findings of the form "X + X" on the first run.
        alias_owners: dict[str, set[str]] = {}
        for slug, e in slugs.items():
            for a in (getattr(e, "aliases", None) or []):
                alias_owners.setdefault(_canon(a), set()).add(slug)
        tok_cache = {s: _tokens(s) | _tokens(getattr(e, "display_name", ""))
                     for s, e in slugs.items()}
        for alias, owners in sorted(alias_owners.items()):
            if len(owners) <= 1:
                continue
            ow = sorted(owners)
            # Two readings, and the fix differs, so say which one this is:
            #  - the entities look alike  -> they are probably ONE concept, merge
            #  - they look nothing alike  -> the alias is simply wrong on one of
            #    them. `tg-antibodies` and `triglycerides` both claiming "tg" is
            #    this case, and it silently mis-resolves lab data.
            pairs = [len(tok_cache[a] & tok_cache[b]) / len(tok_cache[a] | tok_cache[b])
                     for a, b in combinations(ow, 2)
                     if tok_cache[a] and tok_cache[b]]
            alike = bool(pairs) and max(pairs) >= 0.4
            if alike:
                detail = (f"all claim the alias {alias!r} AND look like the same "
                          f"concept — probably one entity split in two. Merge, "
                          f"keeping the retired slug as an alias.")
            else:
                detail = (f"all claim the alias {alias!r} but are NOT the same "
                          f"concept — the alias is wrong on at least one of them "
                          f"and will mis-resolve. Remove it from the wrong owner.")
            out.append(DuplicateFinding(
                "SHARED_ALIAS", kind, ow, detail,
                severity="CRITICAL" if alike else "WARNING", evidence=[alias]))

        # ---- 2. same display_name -------------------------------------------
        by_display: dict[str, list[str]] = {}
        for slug, e in slugs.items():
            d = _canon(getattr(e, "display_name", "") or "")
            if d:
                by_display.setdefault(d, []).append(slug)
        for disp, owners in sorted(by_display.items()):
            if len(owners) > 1:
                out.append(DuplicateFinding(
                    "SAME_DISPLAY", kind, sorted(owners),
                    (f"render identically as {disp.replace('-', ' ')!r} — "
                     f"indistinguishable to a coach reading the UI."),
                    evidence=[disp]))

        # ---- 3. an alias that IS another entity's canonical slug -------------
        for slug, e in slugs.items():
            for a in (getattr(e, "aliases", None) or []):
                ca = _canon(a)
                if ca in slugs and ca != slug:
                    out.append(DuplicateFinding(
                        "ALIAS_IS_SLUG", kind, sorted([slug, ca]),
                        (f"{slug!r} lists {ca!r} as an alias, but {ca!r} is a "
                         f"canonical entity in its own right."),
                        severity="CRITICAL", evidence=[ca]))

        # ---- 4. near-identical slugs (weakest, reported last) ----------------
        toks = {s: _tokens(s) | _tokens(getattr(e, "display_name", ""))
                for s, e in slugs.items()}
        already = {tuple(sorted(f.slugs)) for f in out if f.entity_kind == kind}
        for a, b in combinations(sorted(slugs), 2):
            ta, tb = toks[a], toks[b]
            if not ta or not tb:
                continue
            j = len(ta & tb) / len(ta | tb)
            if j < near_threshold:
                continue
            # a qualifier word is a real distinction, not a duplicate
            if (ta ^ tb) & _DISTINGUISHING:
                continue
            if tuple(sorted([a, b])) in already:
                continue
            out.append(DuplicateFinding(
                "NEAR_SLUG", kind, [a, b],
                f"slugs overlap {j:.0%} and differ by no distinguishing qualifier.",
                evidence=[f"{j:.2f}"]))

    # Collapse by (check, kind, entity-set). One duplicate PAIR typically shares
    # several aliases — chronic-inflammation/systemic-inflammation share four —
    # and reporting it once per alias turns a 30-item worklist into a wall of
    # 145. Report the pair once, with every shared alias as evidence.
    merged: dict[tuple, DuplicateFinding] = {}
    for f in out:
        key = (f.kind, f.entity_kind, tuple(f.slugs))
        if key in merged:
            for ev in f.evidence:
                if ev not in merged[key].evidence:
                    merged[key].evidence.append(ev)
            if f.severity == "CRITICAL":
                merged[key].severity = "CRITICAL"
        else:
            merged[key] = f
    out = list(merged.values())
    for f in out:
        if f.kind == "SHARED_ALIAS" and len(f.evidence) > 1:
            f.detail = f.detail.replace(
                f"the alias {f.evidence[0]!r}",
                f"{len(f.evidence)} shared aliases ({', '.join(repr(e) for e in f.evidence[:4])}"
                + (", ...)" if len(f.evidence) > 4 else ")"))

    order = {"SHARED_ALIAS": 0, "ALIAS_IS_SLUG": 1, "SAME_DISPLAY": 2, "NEAR_SLUG": 3}
    out.sort(key=lambda f: (order[f.kind], -len(f.evidence), f.entity_kind, f.slugs))
    return out
