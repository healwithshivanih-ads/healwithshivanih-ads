"""Propose `Claim.linked_to_symptoms` links by reading claim statements.

Claims arrive from ingest already filed under topics/mechanisms/supplements,
but `linked_to_symptoms` (added 2026-08-02) starts empty on every one of
them. This module fills it deterministically — $0, no API call — by looking
for symptom names and aliases inside the claim's own `statement`.

The bar is deliberately PRECISION, not recall. A wrong link puts irrelevant
evidence in front of the coach mid-assessment, which is worse than a missing
link — a missing one just leaves things as they are today. So:

  - only the `statement` is read (the assertion itself). `rationale` and
    `coaching_translation` mention things in passing far more often.
  - terms shorter than MIN_TERM_LEN are dropped wholesale. "gas", "fear",
    "runs", "spots" and "wired" are all real symptom aliases and all of them
    match ordinary prose constantly.
  - a term owned by more than one symptom is skipped, not guessed at. Those
    are near-duplicate symptoms (`bloating` vs `abdominal-bloating`) and
    picking one arbitrarily would scatter evidence across both.
  - BLOCKED_TERMS below removes the remainder, each with its reason. This
    list was built by reading real match context, not by intuition —
    re-read the context before adding or removing an entry.

Run `fmdb claim-symptom-link` for a dry run; add `--apply` to write.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# A symptom term must be at least this long to be trusted at all.
MIN_TERM_LEN = 7

# Most links any single claim may receive. Keeps one sprawling claim from
# dragging a dozen loosely-related symptoms into the assessment bundle;
# longest (most specific) matches win.
MAX_LINKS_PER_CLAIM = 4

# Terms that clear every mechanical filter and are still wrong. Each was
# checked against its real occurrences in the catalogue before being added.
BLOCKED_TERMS: dict[str, str] = {
    # ordinary English that happens to be a symptom alias
    "pressure": "alias of `stress`, but ~all real hits are 'blood pressure'",
    "avoidance": "alias of `avoidance-behaviour`; hits mean avoiding a food/toxin",
    "depleted": "alias of `burnout`; hits are 'glycogen/nutrients depleted'",
    "isolation": "alias of `social-isolation`; hits are 'in isolation'",
    "isolated": "alias of `social-isolation`; hits are 'isolated compound/case'",
    "stressed": "alias of `low-mood-anxiety`; hits are 'stressed population'",
    "tightness": "alias of `tension`; hits are chest tightness (cardiac/anxiety)",
    # real clinical words pointing at the WRONG symptom
    "redness": "alias of `skin-rash`; real hits are joint/vulvar redness",
    "weakness": "alias of `lethargy`; real hits are neuro/muscle weakness",
    "hyperactivity": "alias of `anxiety`; real hits are ADHD/autism hyperactivity",
    "schizophrenia": "alias of `depression-symptoms`; a distinct diagnosis",
    "dementia risk": "alias of `poor-concentration`; a prognosis, not the symptom",
}


@dataclass
class LinkProposal:
    claim_slug: str
    symptom_slug: str
    matched_term: str


@dataclass
class LinkReport:
    proposals: list[LinkProposal] = field(default_factory=list)
    claims_matched: int = 0
    claims_total: int = 0
    terms_used: int = 0
    terms_ambiguous: int = 0
    dropped_over_cap: int = 0

    def by_claim(self) -> dict[str, list[LinkProposal]]:
        out: dict[str, list[LinkProposal]] = {}
        for p in self.proposals:
            out.setdefault(p.claim_slug, []).append(p)
        return out


def build_term_index(cat: Any) -> tuple[dict[str, str], int]:
    """Map a lowercased symptom term -> canonical symptom slug.

    Returns (index, n_ambiguous_terms_skipped).
    """
    owners: dict[str, set[str]] = {}
    for sym in cat.symptoms:
        for term in [sym.display_name, *sym.aliases]:
            t = " ".join(str(term).strip().lower().split())
            if len(t) < MIN_TERM_LEN or t in BLOCKED_TERMS:
                continue
            owners.setdefault(t, set()).add(sym.slug)
    index = {t: next(iter(o)) for t, o in owners.items() if len(o) == 1}
    return index, sum(1 for o in owners.values() if len(o) > 1)


def propose_links(cat: Any) -> LinkReport:
    """Scan every claim statement and propose symptom links. Pure — writes nothing."""
    index, n_ambiguous = build_term_index(cat)
    report = LinkReport(
        claims_total=len(cat.claims),
        terms_used=len(index),
        terms_ambiguous=n_ambiguous,
    )
    if not index:
        return report

    # Longest-first alternation so "hand numbness" wins over "numbness".
    ordered = sorted(index, key=len, reverse=True)
    pattern = re.compile(r"\b(?:" + "|".join(re.escape(t) for t in ordered) + r")\b")

    for claim in cat.claims:
        already = set(claim.linked_to_symptoms or [])
        # symptom_slug -> longest term that matched it
        hits: dict[str, str] = {}
        for m in pattern.finditer(claim.statement.lower()):
            term = m.group(0)
            slug = index.get(term)
            if not slug or slug in already:
                continue
            if len(term) > len(hits.get(slug, "")):
                hits[slug] = term
        if not hits:
            continue
        # Most specific (longest matched term) first, then slug for determinism.
        ranked = sorted(hits.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        if len(ranked) > MAX_LINKS_PER_CLAIM:
            report.dropped_over_cap += len(ranked) - MAX_LINKS_PER_CLAIM
            ranked = ranked[:MAX_LINKS_PER_CLAIM]
        report.claims_matched += 1
        for slug, term in ranked:
            report.proposals.append(LinkProposal(claim.slug, slug, term))
    return report


def _render_block(slugs: list[str]) -> str:
    lines = ["linked_to_symptoms:"]
    lines += [f"- {s}" for s in slugs]
    return "\n".join(lines) + "\n"


def apply_links(data_dir: Path, report: LinkReport) -> tuple[int, list[str]]:
    """Write proposals into the claim YAMLs. Returns (files_written, errors).

    Deliberately a surgical text insert, not a YAML round-trip: PyYAML
    re-wraps every long string it re-emits, which would rewrite ~85% of the
    corpus with pure noise and bury the real change. The new block goes in
    immediately above the top-level `sources:` line, which every claim file
    has (a claim with no sources is a validator ERROR).
    """
    written = 0
    errors: list[str] = []
    for claim_slug, props in report.by_claim().items():
        path = data_dir / "claims" / f"{claim_slug}.yaml"
        if not path.exists():
            errors.append(f"{claim_slug}: file not found at {path}")
            continue
        text = path.read_text()
        if re.search(r"^linked_to_symptoms:", text, re.M):
            errors.append(f"{claim_slug}: already has linked_to_symptoms — skipped")
            continue
        anchor = re.search(r"^sources:", text, re.M)
        if not anchor:
            errors.append(f"{claim_slug}: no top-level 'sources:' anchor — skipped")
            continue
        block = _render_block([p.symptom_slug for p in props])
        path.write_text(text[: anchor.start()] + block + text[anchor.start():])
        written += 1
    return written, errors
