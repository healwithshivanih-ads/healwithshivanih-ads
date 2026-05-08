#!/usr/bin/env python3
"""Pre-stage catalogue check for a coach observation.

Reads JSON from stdin:
  { "text": str }

Writes JSON to stdout:
  {
    "ok": bool,
    "related": [
      {
        "kind": str,           # "topics" | "mechanisms" | "symptoms" | "claims" | "supplements"
        "slug": str,
        "display_name": str,
        "summary": str,        # short excerpt shown in UI
        "relation": str,       # "supports" | "conflicts" | "overlaps" | "referenced"
        "relation_note": str,  # one sentence: why this entry is relevant
        "notes_for_coach": str # existing coach notes on this entity, if any
      },
      ...
    ],
    "assessment": str,         # 2-3 sentence overall assessment
    "is_new_ground": bool,     # True if observation adds genuinely new info
    "error": str | null
  }

Approach:
  1. Python keyword extraction from the observation text (no AI, fast).
  2. Search catalogue YAML files for those keywords.
  3. Load up to 15 most relevant entries.
  4. One Haiku call to assess how each relates to the observation.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore


# Catalogue subdirs to search (in priority order)
CATALOGUE_KINDS = [
    ("topics",       "summary"),
    ("mechanisms",   "summary"),
    ("symptoms",     "description"),
    ("claims",       "statement"),
    ("supplements",  "notes"),
]

# Common English stopwords — not worth searching for
_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "have", "will", "can",
    "are", "was", "were", "been", "being", "has", "had", "not", "but", "they",
    "their", "there", "when", "what", "which", "also", "any", "all", "some",
    "than", "then", "into", "its", "your", "our", "his", "her", "she", "him",
    "may", "even", "just", "more", "much", "such", "very", "most", "those",
    "always", "often", "cases", "case", "check", "look", "should", "could",
    "would", "about", "does", "how", "why", "who", "see", "get", "make",
    "help", "first", "thing", "drink", "take", "especially",
}


def _extract_keywords(text: str) -> list[str]:
    """Extract meaningful keywords from free-form text."""
    # Lowercase and split on non-alphanumeric (keep hyphens between words)
    words = re.findall(r"[a-zA-Z][a-zA-Z'-]*[a-zA-Z]|[a-zA-Z]{3,}", text.lower())
    keywords = []
    seen = set()
    for w in words:
        w = w.strip("'-")
        if len(w) >= 4 and w not in _STOPWORDS and w not in seen:
            keywords.append(w)
            seen.add(w)
    # Also add hyphenated compound forms common in medicine
    hyphenated = re.findall(r"[a-z]+-[a-z]+(?:-[a-z]+)?", text.lower())
    for h in hyphenated:
        if h not in seen and len(h) >= 5:
            keywords.append(h)
            seen.add(h)
    return keywords[:20]  # cap to keep search tractable


def _score_file(path: Path, keywords: list[str]) -> float:
    """Return a relevance score for a YAML file based on keyword hits."""
    try:
        content = path.read_text(encoding="utf-8").lower()
    except Exception:
        return 0.0
    score = 0.0
    for kw in keywords:
        count = content.count(kw)
        if count > 0:
            # Slug matches worth more than body matches
            slug_bonus = 2.0 if kw in path.stem else 0.0
            score += min(count, 5) * (1.0 + slug_bonus)
    return score


def _load_entity(path: Path, kind: str, summary_field: str) -> dict | None:
    """Load a YAML file and return a compact entity dict."""
    if yaml is None:
        return None
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return None
    slug = data.get("slug") or data.get("id") or path.stem
    display_name = data.get("display_name") or slug
    summary_raw = (
        data.get(summary_field)
        or data.get("statement")
        or data.get("summary")
        or data.get("description")
        or data.get("notes")
        or ""
    )
    # Trim long summaries
    summary = str(summary_raw)[:300] if summary_raw else ""
    notes_for_coach = str(data.get("notes_for_coach") or "")[:200]
    coaching_translation = str(data.get("coaching_translation") or "")[:200]
    return {
        "kind": kind,
        "slug": slug,
        "display_name": display_name,
        "summary": summary,
        "notes_for_coach": notes_for_coach,
        "coaching_translation": coaching_translation,
        "evidence_tier": data.get("evidence_tier") or "",
        "aliases": data.get("aliases") or [],
    }


def _search_catalogue(keywords: list[str], max_results: int = 15) -> list[dict]:
    """Score and rank all catalogue YAML files, return top matches."""
    catalogue_root = FMDB_ROOT / "data"
    scored: list[tuple[float, Path, str, str]] = []  # (score, path, kind, summary_field)

    for kind, summary_field in CATALOGUE_KINDS:
        kind_dir = catalogue_root / kind
        if not kind_dir.is_dir():
            continue
        for yaml_path in kind_dir.glob("*.yaml"):
            if yaml_path.name.startswith("_"):
                continue
            score = _score_file(yaml_path, keywords)
            if score > 0:
                scored.append((score, yaml_path, kind, summary_field))

    scored.sort(key=lambda x: -x[0])
    results = []
    for _, path, kind, sf in scored[:max_results]:
        entity = _load_entity(path, kind, sf)
        if entity:
            results.append(entity)
    return results


def _haiku_assess(observation: str, candidates: list[dict]) -> dict:
    """Call Claude Haiku to assess how each candidate relates to the observation."""
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    # Build a compact catalogue excerpt for Haiku
    catalogue_block = ""
    for i, c in enumerate(candidates, 1):
        catalogue_block += (
            f"\n[{i}] {c['kind']}/{c['slug']} — {c['display_name']}"
            f"\n    Summary: {c['summary'][:200]}"
        )
        if c.get("coaching_translation"):
            catalogue_block += f"\n    Coaching: {c['coaching_translation'][:150]}"
        if c.get("notes_for_coach"):
            catalogue_block += f"\n    Existing coach note: {c['notes_for_coach'][:150]}"
        if c.get("evidence_tier"):
            catalogue_block += f"\n    Tier: {c['evidence_tier']}"
        catalogue_block += "\n"

    prompt = f"""A functional medicine coach has typed this clinical observation:

"{observation}"

Here are the {len(candidates)} most relevant entries already in the catalogue:
{catalogue_block}

For EACH entry above, assess its relationship to the coach's observation.
Return a JSON object with this exact shape:
{{
  "related": [
    {{
      "kind": "...",
      "slug": "...",
      "relation": "supports" | "conflicts" | "overlaps" | "referenced",
      "relation_note": "One sentence explaining the relationship."
    }}
    // ... one object per catalogue entry that is genuinely relevant (omit irrelevant ones)
  ],
  "assessment": "2-3 sentences: what this observation adds, what's already covered, any conflicts.",
  "is_new_ground": true | false
}}

Definitions:
- "supports": observation aligns with / reinforces this catalogue entry
- "conflicts": observation contradicts or complicates this catalogue entry
- "overlaps": observation covers the same clinical area but from a different angle
- "referenced": observation explicitly mentions or implies this entity

Only include entries that are genuinely relevant (score > 0 relevance). Omit noise.
Return ONLY valid JSON. No markdown. No commentary."""

    resp = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = resp.content[0].text.strip()
    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


def emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, default=str)
    return 0 if payload.get("ok") else 1


def main() -> int:
    # Load .env — use python-dotenv (already in fmdb venv) so quoting/export/multiline
    # are all handled correctly, same as the rest of the fmdb stack.
    try:
        from dotenv import load_dotenv
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except ImportError:
        # Fallback: bare-minimum manual parse
        env_path = FMDB_ROOT / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                line = line.strip().lstrip("export ").strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

    raw = sys.stdin.read().strip()
    try:
        inp = json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        return emit({"ok": False, "error": f"JSON parse: {e}"})

    text = (inp.get("text") or "").strip()
    if not text:
        return emit({"ok": False, "error": "text is required"})

    if yaml is None:
        return emit({"ok": False, "error": "pyyaml not installed in venv"})

    # 1. Extract keywords
    keywords = _extract_keywords(text)
    if not keywords:
        return emit({
            "ok": True,
            "related": [],
            "assessment": "No searchable keywords found — observation appears to be entirely new ground.",
            "is_new_ground": True,
        })

    # 2. Search catalogue
    candidates = _search_catalogue(keywords, max_results=15)
    if not candidates:
        return emit({
            "ok": True,
            "related": [],
            "assessment": "No matching catalogue entries found. This appears to be new ground.",
            "is_new_ground": True,
        })

    # 3. Haiku assessment
    try:
        haiku_result = _haiku_assess(text, candidates)
    except Exception as e:
        return emit({"ok": False, "error": f"Haiku assessment failed: {e}"})

    # 4. Merge Haiku relation data back with full candidate metadata
    haiku_by_slug: dict[str, dict] = {
        r["slug"]: r for r in haiku_result.get("related", [])
    }
    related_out = []
    for c in candidates:
        slug = c["slug"]
        hr = haiku_by_slug.get(slug)
        if hr:
            related_out.append({
                "kind": c["kind"],
                "slug": slug,
                "display_name": c["display_name"],
                "summary": c["summary"],
                "notes_for_coach": c["notes_for_coach"],
                "evidence_tier": c["evidence_tier"],
                "relation": hr.get("relation", "overlaps"),
                "relation_note": hr.get("relation_note", ""),
            })

    return emit({
        "ok": True,
        "related": related_out,
        "assessment": haiku_result.get("assessment", ""),
        "is_new_ground": haiku_result.get("is_new_ground", len(related_out) == 0),
    })


if __name__ == "__main__":
    sys.exit(main())
