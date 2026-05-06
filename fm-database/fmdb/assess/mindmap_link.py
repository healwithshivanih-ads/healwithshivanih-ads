"""Cross-link MindMap node labels to catalogue entities and mine unlinked
nodes for the catalogue backlog.

Two responsibilities:

1. ``link_mindmap_nodes(mindmap, cat)`` walks a hand-curated MindMap tree
   and resolves each node's label against the catalogue's alias-aware
   slug index. Nodes that already carry both ``linked_kind`` and
   ``linked_slug`` are left alone (coach may have hand-authored them).

2. ``mine_unlinked(mindmap, cat)`` returns the leaf-ish nodes that did NOT
   resolve — these are candidate catalogue additions worth surfacing in the
   backlog. A simple heuristic guesses the kind (symptom / mechanism /
   supplement / topic) from ancestor labels.

Resolution policy (intentionally conservative — false positives are worse
than misses):
  - exact slug match
  - alias match (via the same alias index the validator uses)
  - slugified label (lowercase, whitespace → '-')
No fuzzy matching beyond that.

Kind priority when a label resolves under multiple kinds: topic >
mechanism > symptom > supplement > claim. First match wins.
"""

from __future__ import annotations

import re
from typing import Any

from ..models import MindMap, MindMapNode
from ..validator import Loaded, _resolve_index


# Kinds and their resolution order.
_KIND_PRIORITY = ("topic", "mechanism", "symptom", "supplement", "claim")


def _slugify(label: str) -> str:
    s = label.strip().lower()
    s = re.sub(r"\s+", "-", s)
    return s


def _build_indexes(cat: Loaded) -> dict[str, dict[str, str]]:
    """Per-kind {slug-or-alias → canonical-slug} indexes.

    Topics, mechanisms, symptoms carry aliases (validator's _resolve_index
    handles those). Supplements and claims are slug-only — build the index
    by hand so the lookup API is uniform.
    """
    return {
        "topic": _resolve_index(cat.topics),
        "mechanism": _resolve_index(cat.mechanisms),
        "symptom": _resolve_index(cat.symptoms),
        "supplement": {s.slug: s.slug for s in cat.supplements},
        "claim": {c.slug: c.slug for c in cat.claims},
    }


def _resolve_label(label: str, indexes: dict[str, dict[str, str]]) -> tuple[str, str] | None:
    """Try to resolve ``label`` against the catalogue. Returns
    ``(kind, canonical_slug)`` on hit, ``None`` on miss."""
    candidates = [label, label.strip(), label.strip().lower(), _slugify(label)]
    seen: set[str] = set()
    deduped: list[str] = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            deduped.append(c)

    for kind in _KIND_PRIORITY:
        idx = indexes[kind]
        for cand in deduped:
            if cand in idx:
                return kind, idx[cand]
    return None


def link_mindmap_nodes(mindmap: MindMap, cat: Loaded) -> tuple[MindMap, dict[str, Any]]:
    """Walk the recursive tree and fill in linked_kind / linked_slug where
    a node's label resolves against the catalogue. Mutates the MindMap.

    Returns the same MindMap plus a stats dict.
    """
    indexes = _build_indexes(cat)
    stats: dict[str, Any] = {
        "linked": 0,
        "already_linked": 0,
        "unlinked": 0,
        "total_nodes": 0,
        "by_kind": {k: 0 for k in _KIND_PRIORITY},
        "newly_linked_samples": [],   # up to 25 (label, kind, slug) tuples
    }

    def _walk(node: MindMapNode) -> None:
        stats["total_nodes"] += 1
        if node.linked_kind and node.linked_slug:
            stats["already_linked"] += 1
        else:
            hit = _resolve_label(node.label, indexes)
            if hit:
                kind, slug = hit
                node.linked_kind = kind
                node.linked_slug = slug
                stats["linked"] += 1
                stats["by_kind"][kind] += 1
                if len(stats["newly_linked_samples"]) < 25:
                    stats["newly_linked_samples"].append((node.label, kind, slug))
            else:
                stats["unlinked"] += 1
        for child in node.children:
            _walk(child)

    for branch in mindmap.tree:
        _walk(branch)

    return mindmap, stats


# ---------------------------------------------------------------------------
# Track B — mining unlinked nodes for the backlog
# ---------------------------------------------------------------------------


_GUESS_RULES = [
    # (substring, kind) — first hit in the parent chain wins
    ("symptom", "symptom"),
    ("sign", "symptom"),
    ("mechanism", "mechanism"),
    ("driver", "mechanism"),
    ("trigger", "mechanism"),
    ("root cause", "mechanism"),
    ("pathway", "mechanism"),
    ("supplement", "supplement"),
    ("nutrient", "supplement"),
    ("vitamin", "supplement"),
    ("herb", "supplement"),
    ("topic", "topic"),
    ("pattern", "topic"),
    ("condition", "topic"),
]


def _guess_kind(parent_chain: list[str]) -> str | None:
    """Walk parents from nearest to root, looking for a kind hint."""
    for label in reversed(parent_chain):
        low = label.lower()
        for needle, kind in _GUESS_RULES:
            if needle in low:
                return kind
    return None


def mine_unlinked(mindmap: MindMap, cat: Loaded) -> list[dict[str, Any]]:
    """Return candidate catalogue additions from unlinked nodes.

    Skips:
      - root-level branches (depth 0) — usually category labels
      - top-level branches' direct children (depth 1) — also usually
        category labels like "Symptoms" / "Root Causes" / "Treatment"
      - nodes that resolve to the catalogue (linked_kind+slug already set)

    Each returned dict: ``{label, depth, parent_label, mindmap_slug,
    guessed_kind}``.
    """
    indexes = _build_indexes(cat)
    out: list[dict[str, Any]] = []

    def _walk(node: MindMapNode, depth: int, parent_chain: list[str]) -> None:
        # Only mine depth >= 2 — roots and top-level branches are buckets.
        if depth >= 2:
            already_linked = bool(node.linked_kind and node.linked_slug)
            resolves = _resolve_label(node.label, indexes) is not None
            if not already_linked and not resolves:
                out.append({
                    "label": node.label,
                    "depth": depth,
                    "parent_label": parent_chain[-1] if parent_chain else "",
                    "mindmap_slug": mindmap.slug,
                    "guessed_kind": _guess_kind(parent_chain),
                })
        for child in node.children:
            _walk(child, depth + 1, parent_chain + [node.label])

    for branch in mindmap.tree:
        _walk(branch, depth=0, parent_chain=[])

    return out
