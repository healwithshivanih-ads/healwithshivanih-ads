"""Merge one supplement into another without losing anything.

Why this exists
---------------
The catalogue-cleanup merge (`apply-cleanup.py::_merge_into_canonical`) only
unioned aliases and sources, then deleted the member file. For a supplement
that silently dropped the member's contraindications, drug interactions,
links, claims and coach notes — so merging `ginger-root` into `ginger` would
have thrown away any caution that lived only on `ginger-root`.

This module merges the full record, conservatively:

  * every list (links, contraindications, interactions, forms, timings, ...) is
    UNIONED, order-preserving;
  * a dose range for a form only the member has is carried over; a clashing
    range for a shared form keeps the canonical's and records the member's in
    the coach notes, so nothing is silently widened;
  * pregnancy / lactation safety takes the MOST CAUTIOUS known value
    (`unknown` means "not filled in", so it never overrides a real value);
  * evidence_tier keeps the STRONGER tier (same no-downgrade rule as the
    ingest smart-merge);
  * the member's slug and aliases become aliases on the canonical, so every
    existing plan, session and catalogue reference keeps resolving.

`rewrite_supplement_refs` then points the catalogue's own supplement
references (claims, protocols, mind maps, somatic maps, titrations) at the
canonical slug, de-duplicating any list that now names it twice.
"""
from __future__ import annotations

import copy
import json
from datetime import date
from pathlib import Path
from typing import Any

import yaml

_SAFETY_RANK = {"safe": 0, "likely_safe": 1, "caution": 2, "contraindicated": 3}
_TIER_RANK = {"strong": 3, "plausible_emerging": 2, "fm_specific_thin": 1,
              "confirm_with_clinician": 0}
_FOOD_RANK = {"optional": 0, "required": 1, "avoid": 1}

# Scalar fields where the canonical's value wins and the member's is dropped.
_KEEP_CANONICAL = {"slug", "display_name", "category", "status", "version",
                   "updated_at", "updated_by", "virya", "vipaka"}


def _key(x: Any) -> str:
    return json.dumps(x, sort_keys=True, ensure_ascii=False)


def _union(a: list | None, b: list | None) -> list:
    out, seen = [], set()
    for x in list(a or []) + list(b or []):
        k = _key(x)
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out


def _cautious(a: str | None, b: str | None) -> str:
    known = [v for v in (a, b) if v and v != "unknown"]
    if not known:
        return a or b or "unknown"
    return max(known, key=lambda v: _SAFETY_RANK.get(v, 0))


def _append_para(text: str | None, para: str) -> str:
    text = (text or "").rstrip()
    para = para.strip()
    if not para or para in text:
        return text
    return f"{text}\n\n{para}" if text else para


def merge_supplement_records(canonical: dict, member: dict, *,
                             display_name: str | None = None,
                             today: str | None = None,
                             updated_by: str = "shivani") -> dict:
    """Return a new canonical record with `member` folded in. Pure function."""
    c = copy.deepcopy(canonical)
    m = member
    m_slug = m.get("slug", "")
    m_name = m.get("display_name") or m_slug

    for k, mv in m.items():
        if k in _KEEP_CANONICAL or k in ("aliases", "sources", "typical_dose_range",
                                         "contraindications", "interactions",
                                         "notes_for_coach", "notes_for_client",
                                         "pregnancy_safety", "lactation_safety",
                                         "pregnancy_safety_note", "evidence_tier",
                                         "take_with_food"):
            continue
        cv = c.get(k)
        if isinstance(mv, list):
            c[k] = _union(cv, mv)
        elif cv in (None, "", [], {}):
            c[k] = mv

    # aliases: member slug + member aliases (never the canonical's own slug)
    al = _union(c.get("aliases"), [m_slug] + list(m.get("aliases") or []))
    c["aliases"] = [a for a in al if a != c.get("slug")]

    # sources: de-dup by id, keep first occurrence's quote/location
    seen, srcs = set(), []
    for s in list(c.get("sources") or []) + list(m.get("sources") or []):
        sid = s.get("id") if isinstance(s, dict) else s
        if sid in seen:
            continue
        seen.add(sid)
        srcs.append(s)
    c["sources"] = srcs

    # nested list containers
    for field, subs in (("contraindications", ("conditions", "medications", "life_stages")),
                        ("interactions", ("with_supplements", "with_foods", "with_medications"))):
        cc, mm = dict(c.get(field) or {}), dict(m.get(field) or {})
        if cc or mm:
            c[field] = {s: _union(cc.get(s), mm.get(s)) for s in subs}

    # dose ranges
    notes = c.get("notes_for_coach") or ""
    dr = dict(c.get("typical_dose_range") or {})
    for form, rng in (m.get("typical_dose_range") or {}).items():
        if form not in dr:
            dr[form] = rng
        elif _key(dr[form]) != _key(rng):
            notes = _append_para(
                notes,
                f"Dose note merged from {m_name}: {form} "
                f"{rng.get('min')}–{rng.get('max')} {rng.get('unit')} "
                f"(this entry keeps {dr[form].get('min')}–{dr[form].get('max')} "
                f"{dr[form].get('unit')}).")
    if dr:
        c["typical_dose_range"] = dr

    # notes
    mnote = (m.get("notes_for_coach") or "").strip()
    if mnote and mnote not in notes:
        notes = _append_para(notes, f"Merged from {m_name}: {mnote}")
    if notes:
        c["notes_for_coach"] = notes
    if not (c.get("notes_for_client") or "").strip() and m.get("notes_for_client"):
        c["notes_for_client"] = m["notes_for_client"]

    # safety: most cautious known value wins
    for f in ("pregnancy_safety", "lactation_safety"):
        if c.get(f) or m.get(f):
            c[f] = _cautious(c.get(f), m.get(f))
    pn = _append_para(c.get("pregnancy_safety_note"), m.get("pregnancy_safety_note") or "")
    if pn:
        c["pregnancy_safety_note"] = pn

    # evidence tier: keep the stronger
    tiers = [t for t in (c.get("evidence_tier"), m.get("evidence_tier")) if t]
    if tiers:
        c["evidence_tier"] = max(tiers, key=lambda t: _TIER_RANK.get(t, -1))

    # take_with_food: a firm instruction (required / avoid) beats optional
    tw = [t for t in (c.get("take_with_food"), m.get("take_with_food")) if t]
    if tw:
        c["take_with_food"] = max(tw, key=lambda t: _FOOD_RANK.get(t, 0))

    if display_name:
        c["display_name"] = display_name
    c["version"] = int(c.get("version") or 1) + 1
    c["updated_at"] = today or date.today().isoformat()
    c["updated_by"] = updated_by
    return c


# ---------------------------------------------------------------------------
# Catalogue references
# ---------------------------------------------------------------------------

def _rewrite_list(lst: list, mapping: dict[str, str]) -> tuple[list, bool]:
    out, changed = [], False
    for x in lst:
        if isinstance(x, str) and x in mapping:
            x, changed = mapping[x], True
        if x not in out:
            out.append(x)
        else:
            changed = True
    return out, changed


def _walk_mindmap(nodes: list, mapping: dict[str, str]) -> bool:
    changed = False
    for n in nodes or []:
        if isinstance(n, dict):
            if n.get("linked_kind") == "supplement" and n.get("linked_slug") in mapping:
                n["linked_slug"] = mapping[n["linked_slug"]]
                changed = True
            changed |= _walk_mindmap(n.get("children") or [], mapping)
    return changed


def _rewrite_record(kind: str, d: dict, mapping: dict[str, str]) -> bool:
    changed = False
    if kind == "claims" and d.get("linked_to_supplements"):
        d["linked_to_supplements"], ch = _rewrite_list(d["linked_to_supplements"], mapping)
        changed |= ch
    elif kind == "protocols" and d.get("supplements_typically_used"):
        d["supplements_typically_used"], ch = _rewrite_list(d["supplements_typically_used"], mapping)
        changed |= ch
    elif kind == "titration_protocols" and d.get("supplement_slug") in mapping:
        d["supplement_slug"] = mapping[d["supplement_slug"]]
        changed = True
    elif kind == "mindmaps":
        changed |= _walk_mindmap(d.get("tree") or [], mapping)
    elif kind == "somatic_maps":
        ac = d.get("also_consider")
        if isinstance(ac, dict) and ac.get("supplements"):
            ac["supplements"], ch = _rewrite_list(ac["supplements"], mapping)
            changed |= ch
    return changed


REF_KINDS = ("claims", "protocols", "titration_protocols", "mindmaps", "somatic_maps")


def _norm(x: Any) -> Any:
    """Order-insensitive view: a reference list is a set, not a sequence."""
    if isinstance(x, dict):
        return {k: _norm(v) for k, v in x.items()}
    if isinstance(x, list):
        items = [_norm(v) for v in x]
        try:
            return sorted(items, key=_key)
        except TypeError:
            return items
    return x


def _minimal_text_rewrite(kind: str, text: str, mapping: dict[str, str]) -> str | None:
    """Edit only the lines holding a retired slug; None if that can't
    reproduce the structured rewrite exactly (caller falls back to a dump).

    Each candidate line is either renamed, or dropped when the survivor is
    already in the same list. A rename is only kept if it moves the document
    toward the structured result — that is what stops `linked_slug: dhea-s`
    on a LAB-TEST mind-map node (dhea-s is also a lab marker) from being
    rewritten along with the supplement nodes.
    """
    import re

    expected = yaml.safe_load(text) or {}
    _rewrite_record(kind, expected, mapping)
    alt = "|".join(re.escape(k) for k in sorted(mapping, key=len, reverse=True))
    pat = re.compile(rf"^(\s*-\s+|\s*linked_slug:\s+|supplement_slug:\s+)({alt})(\s*)$")

    def ok(candidate: str) -> bool:
        d = yaml.safe_load(candidate) or {}
        has_dupes = _rewrite_record(kind, copy.deepcopy(d), {})
        _rewrite_record(kind, d, mapping)
        return not has_dupes and _norm(d) == _norm(expected)

    lines = text.split("\n")
    i = 0
    while i < len(lines):
        m = pat.match(lines[i])
        if m:
            renamed = f"{m.group(1)}{mapping[m.group(2)]}{m.group(3)}"
            if ok("\n".join(lines[:i] + [renamed] + lines[i + 1:])):
                lines[i] = renamed
            elif ok("\n".join(lines[:i] + lines[i + 1:])):
                del lines[i]  # survivor already in this list — drop the duplicate
                continue
        i += 1
    out = "\n".join(lines)
    return out if _norm(yaml.safe_load(out) or {}) == _norm(expected) else None


def rewrite_supplement_refs(data_dir: Path, mapping: dict[str, str],
                            dry_run: bool = False) -> list[str]:
    """Point catalogue supplement references at canonical slugs.

    Only fields that are KNOWN to hold supplement slugs are touched: `omega-3`
    is also a recipe `rich_in` nutrient tag and `dhea-s` is also a lab-test
    slug, so a blind string replace would corrupt those. Edits are line-level
    so a review diff shows the slug swap, not a reformatted file.
    """
    touched = []
    for kind in REF_KINDS:
        for p in sorted((data_dir / kind).glob("*.yaml")):
            text = p.read_text()
            if not any(s in text for s in mapping):
                continue
            d = yaml.safe_load(text) or {}
            if not _rewrite_record(kind, d, mapping):
                continue
            touched.append(str(p.relative_to(data_dir)))
            if dry_run:
                continue
            new = _minimal_text_rewrite(kind, text, mapping)
            p.write_text(new if new is not None
                         else yaml.safe_dump(d, sort_keys=False, allow_unicode=True, width=88))
    return touched
