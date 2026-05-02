"""Build mind-map trees from the catalogue.

Given any entity (topic, symptom, mechanism, supplement, claim,
cooking_adjustment, home_remedy), walk the catalogue's cross-links
and produce a nested tree suitable for rendering as a mermaid mindmap.

The tree is grouped by relationship type to mimic the vitaone visual
pattern (root → category branches → atoms).
"""

from __future__ import annotations

import re
from typing import Any

from ..validator import Loaded


# Type aliases for clarity
Tree = dict[str, Any]   # {label, kind, slug, children: [Tree, ...]}


def _safe_label(s: str) -> str:
    """Mermaid mindmap labels can't contain certain chars. Strip safely."""
    if not s:
        return "?"
    # Mermaid is finicky about parens, brackets, quotes, colons in labels.
    cleaned = re.sub(r"[(){}\[\]\"'`:|;,]", " ", s)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "?"


def _node(label: str, kind: str = "", slug: str = "", children: list[Tree] | None = None) -> Tree:
    return {
        "label": label,
        "kind": kind,
        "slug": slug,
        "children": children or [],
    }


def _topic_neighbors(cat: Loaded, slug: str) -> Tree | None:
    by_slug = {t.slug: t for t in cat.topics}
    t = by_slug.get(slug)
    if not t:
        return None
    children = []

    if t.related_topics:
        children.append(_node(
            "Related topics", "group", "",
            [_node(rel, "topic", rel) for rel in t.related_topics],
        ))
    if t.key_mechanisms:
        children.append(_node(
            "Key mechanisms", "group", "",
            [_node(m, "mechanism", m) for m in t.key_mechanisms],
        ))
    if t.common_symptoms:
        children.append(_node(
            "Common symptoms", "group", "",
            [_node(s, "symptom", s) for s in t.common_symptoms[:12]],
        ))
    # claims that link to this topic
    linked_claims = [c.slug for c in cat.claims if slug in c.linked_to_topics][:10]
    if linked_claims:
        children.append(_node(
            "Claims", "group", "",
            [_node(c, "claim", c) for c in linked_claims],
        ))
    # supplements linked
    linked_supps = [s.slug for s in cat.supplements if slug in s.linked_to_topics][:10]
    if linked_supps:
        children.append(_node(
            "Supplements", "group", "",
            [_node(s, "supplement", s) for s in linked_supps],
        ))
    # cooking adjustments
    linked_ca = [ca.slug for ca in cat.cooking_adjustments if slug in ca.linked_to_topics][:8]
    if linked_ca:
        children.append(_node(
            "Cooking adjustments", "group", "",
            [_node(ca, "cooking_adjustment", ca) for ca in linked_ca],
        ))
    linked_hr = [hr.slug for hr in cat.home_remedies if slug in hr.linked_to_topics][:8]
    if linked_hr:
        children.append(_node(
            "Home remedies", "group", "",
            [_node(hr, "home_remedy", hr) for hr in linked_hr],
        ))
    if t.red_flags:
        children.append(_node(
            "Red flags", "group", "",
            [_node(rf[:60], "redflag", "") for rf in t.red_flags[:6]],
        ))
    return _node(t.display_name, "topic", slug, children)


def _mechanism_neighbors(cat: Loaded, slug: str) -> Tree | None:
    by_slug = {m.slug: m for m in cat.mechanisms}
    m = by_slug.get(slug)
    if not m:
        return None
    children = []
    if m.upstream_drivers:
        children.append(_node(
            "Upstream drivers", "group", "",
            [_node(d[:60], "driver", "") for d in m.upstream_drivers[:8]],
        ))
    if m.downstream_effects:
        children.append(_node(
            "Downstream effects", "group", "",
            [_node(d[:60], "effect", "") for d in m.downstream_effects[:8]],
        ))
    if m.related_mechanisms:
        children.append(_node(
            "Related mechanisms", "group", "",
            [_node(rm, "mechanism", rm) for rm in m.related_mechanisms],
        ))
    if m.linked_to_topics:
        children.append(_node(
            "Linked topics", "group", "",
            [_node(t, "topic", t) for t in m.linked_to_topics],
        ))
    # Reverse: supplements that target this mechanism
    targeting_supps = [s.slug for s in cat.supplements if slug in s.linked_to_mechanisms][:8]
    if targeting_supps:
        children.append(_node(
            "Supplements targeting", "group", "",
            [_node(s, "supplement", s) for s in targeting_supps],
        ))
    return _node(m.display_name, "mechanism", slug, children)


def _symptom_neighbors(cat: Loaded, slug: str) -> Tree | None:
    by_slug = {s.slug: s for s in cat.symptoms}
    s = by_slug.get(slug)
    if not s:
        return None
    children = []
    if s.linked_to_topics:
        children.append(_node(
            "Linked topics", "group", "",
            [_node(t, "topic", t) for t in s.linked_to_topics],
        ))
    if s.linked_to_mechanisms:
        children.append(_node(
            "Linked mechanisms", "group", "",
            [_node(m, "mechanism", m) for m in s.linked_to_mechanisms],
        ))
    if s.aliases:
        children.append(_node(
            "Also called", "group", "",
            [_node(a, "alias", "") for a in s.aliases[:8]],
        ))
    if s.when_to_refer:
        children.append(_node(
            "When to refer", "group", "",
            [_node(s.when_to_refer[:80], "redflag", "")],
        ))
    return _node(s.display_name, "symptom", slug, children)


def _supplement_neighbors(cat: Loaded, slug: str) -> Tree | None:
    by_slug = {s.slug: s for s in cat.supplements}
    s = by_slug.get(slug)
    if not s:
        return None
    children = []
    if s.linked_to_topics:
        children.append(_node(
            "Linked topics", "group", "",
            [_node(t, "topic", t) for t in s.linked_to_topics],
        ))
    if s.linked_to_mechanisms:
        children.append(_node(
            "Linked mechanisms", "group", "",
            [_node(m, "mechanism", m) for m in s.linked_to_mechanisms],
        ))
    if s.linked_to_claims:
        children.append(_node(
            "Linked claims", "group", "",
            [_node(c, "claim", c) for c in s.linked_to_claims[:6]],
        ))
    if s.contraindications.conditions:
        children.append(_node(
            "Contraindications", "group", "",
            [_node(c, "warning", "") for c in s.contraindications.conditions],
        ))
    if s.interactions.with_supplements:
        children.append(_node(
            "Interacts with", "group", "",
            [_node(i.slug, "supplement", i.slug) for i in s.interactions.with_supplements[:6]],
        ))
    return _node(s.display_name, "supplement", slug, children)


def _claim_neighbors(cat: Loaded, slug: str) -> Tree | None:
    by_slug = {c.slug: c for c in cat.claims}
    c = by_slug.get(slug)
    if not c:
        return None
    children = []
    children.append(_node(
        f"Evidence: {c.evidence_tier.value}", "tier", "",
    ))
    if c.linked_to_topics:
        children.append(_node(
            "Linked topics", "group", "",
            [_node(t, "topic", t) for t in c.linked_to_topics],
        ))
    if c.linked_to_supplements:
        children.append(_node(
            "Linked supplements", "group", "",
            [_node(s, "supplement", s) for s in c.linked_to_supplements],
        ))
    if c.linked_to_mechanisms:
        children.append(_node(
            "Linked mechanisms", "group", "",
            [_node(m, "mechanism", m) for m in c.linked_to_mechanisms],
        ))
    return _node(c.statement[:50], "claim", slug, children)


def build_tree(cat: Loaded, kind: str, slug: str) -> Tree | None:
    """Return a 2-level tree (root + grouped children) rooted at the entity."""
    if kind == "topic":
        return _topic_neighbors(cat, slug)
    if kind == "mechanism":
        return _mechanism_neighbors(cat, slug)
    if kind == "symptom":
        return _symptom_neighbors(cat, slug)
    if kind == "supplement":
        return _supplement_neighbors(cat, slug)
    if kind == "claim":
        return _claim_neighbors(cat, slug)
    return None


# ---------------------------------------------------------------------------
# Mermaid mindmap renderer
# ---------------------------------------------------------------------------


_KIND_SHAPE = {
    # mermaid mindmap shapes — root special syntax done elsewhere
    "topic":              ("[", "]"),       # square
    "mechanism":          ("(", ")"),       # rounded
    "symptom":            ("(", ")"),       # rounded
    "supplement":         ("[", "]"),       # square
    "claim":              ("[", "]"),
    "cooking_adjustment": ("[", "]"),
    "home_remedy":        ("[", "]"),
    "group":              ("", ""),         # plain (heading)
    "alias":              ("(", ")"),
    "redflag":            ("[", "]"),
    "warning":            ("[", "]"),
    "driver":             ("(", ")"),
    "effect":             ("(", ")"),
    "tier":               ("[", "]"),
}


def to_mermaid(tree: Tree) -> str:
    """Convert tree dict to mermaid mindmap source."""
    lines = ["mindmap"]
    # Root uses (( )) double-paren syntax for circle
    root_label = _safe_label(tree["label"])
    lines.append(f"  root(({root_label}))")
    for child in tree["children"]:
        _render_node(child, indent=2, lines=lines)
    return "\n".join(lines)


def _render_node(node: Tree, indent: int, lines: list[str]) -> None:
    pad = "  " * (indent + 1)
    label = _safe_label(node["label"])
    open_c, close_c = _KIND_SHAPE.get(node["kind"], ("", ""))
    if open_c:
        lines.append(f"{pad}{open_c}{label}{close_c}")
    else:
        lines.append(f"{pad}{label}")
    for child in node["children"]:
        _render_node(child, indent=indent + 1, lines=lines)


# ---------------------------------------------------------------------------
# Render a hand-curated MindMap (recursive arbitrary-depth tree of MindMapNodes)
# ---------------------------------------------------------------------------


def curated_to_mermaid(mm) -> str:
    """Convert a `MindMap` Pydantic instance to mermaid mindmap source."""
    lines = ["mindmap"]
    root_label = _safe_label(mm.display_name)
    lines.append(f"  root(({root_label}))")
    for branch in mm.tree:
        _render_curated_node(branch, indent=2, lines=lines)
    return "\n".join(lines)


def _render_curated_node(node, indent: int, lines: list[str]) -> None:
    """Render a MindMapNode (Pydantic instance, not the dict-based Tree)."""
    pad = "  " * (indent + 1)
    label = _safe_label(node.label)
    # Top-level branches & internal nodes get plain labels;
    # nodes with linked_kind/slug get a shape that hints at type
    shape_open, shape_close = _KIND_SHAPE.get(getattr(node, "linked_kind", None) or "", ("", ""))
    if shape_open:
        lines.append(f"{pad}{shape_open}{label}{shape_close}")
    else:
        lines.append(f"{pad}{label}")
    for child in node.children:
        _render_curated_node(child, indent=indent + 1, lines=lines)
