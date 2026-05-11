#!/usr/bin/env python3
"""Peek at the AI assess subgraph WITHOUT running the model.

Given symptom slugs + topic slugs, return how many entities of each kind
the subgraph contains. Lets the UI show a readiness panel BEFORE the coach
clicks Analyze — if the subgraph is too thin, the AI won't have anything
to work with and the call will fail (or hallucinate, or lecture about
catalogue gaps). Cheap to run — no API call.

Input JSON (stdin):
{
  "symptoms": ["fatigue", "brain-fog", ...],
  "topics":   ["hashimoto-thyroiditis", ...]
}

Output JSON (stdout):
{
  "ok": true,
  "counts": {
    "topics": int,
    "mechanisms": int,
    "symptoms": int,
    "supplements": int,
    "claims": int,
    "cooking_adjustments": int,
    "home_remedies": int,
    "protocols": int
  },
  "matched_symptoms_in_catalogue": int,
  "matched_topics_in_catalogue":   int,
  "unmatched_symptoms":            ["..."],
  "unmatched_topics":              ["..."],
  "verdict": "rich" | "moderate" | "thin" | "empty"
}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _resolve_fmdb_root() -> Path:
    p = Path(__file__).resolve().parent.parent.parent / "fm-database"
    return p


def main() -> int:
    fmdb_root = _resolve_fmdb_root()
    sys.path.insert(0, str(fmdb_root))

    try:
        from fmdb.assess.subgraph import build_subgraph
        from fmdb.validator import load_all, overlay
    except ImportError as e:
        json.dump({"ok": False, "error": f"could not import fmdb: {e}"}, sys.stdout)
        return 1

    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 1

    symptoms: list[str] = payload.get("symptoms") or []
    topics: list[str] = payload.get("topics") or []

    cat = overlay(load_all(fmdb_root / "data"))

    # Which selected slugs actually exist in the catalogue (alias-aware via
    # the validator's alias index — same logic build_subgraph uses).
    symptom_by_slug = {s.slug: s for s in cat.symptoms}
    sym_alias = {}
    for s in cat.symptoms:
        sym_alias[s.slug] = s.slug
        for a in (s.aliases or []):
            sym_alias[a] = s.slug
    topic_by_slug = {t.slug: t for t in cat.topics}
    topic_alias = {}
    for t in cat.topics:
        topic_alias[t.slug] = t.slug
        for a in (t.aliases or []):
            topic_alias[a] = t.slug

    matched_symptoms = []
    unmatched_symptoms = []
    for s in symptoms:
        if s in sym_alias:
            matched_symptoms.append(sym_alias[s])
        else:
            unmatched_symptoms.append(s)

    matched_topics = []
    unmatched_topics = []
    for t in topics:
        if t in topic_alias:
            matched_topics.append(topic_alias[t])
        else:
            unmatched_topics.append(t)

    sg = build_subgraph(
        cat,
        symptom_slugs=matched_symptoms,
        topic_slugs=matched_topics,
    )

    counts = {
        "topics": len(sg.get("topics") or []),
        "mechanisms": len(sg.get("mechanisms") or []),
        "symptoms": len(sg.get("symptoms") or []),
        "supplements": len(sg.get("supplements") or []),
        "claims": len(sg.get("claims") or []),
        "cooking_adjustments": len(sg.get("cooking_adjustments") or []),
        "home_remedies": len(sg.get("home_remedies") or []),
        "protocols": len(sg.get("protocols") or []),
    }

    # Verdict heuristic — the AI needs at least a few mechanisms and a
    # handful of supplements to put together a real recommendation.
    total_useful = counts["mechanisms"] + counts["supplements"] + counts["protocols"]
    if total_useful == 0:
        verdict = "empty"
    elif counts["mechanisms"] < 3 or counts["supplements"] < 5:
        verdict = "thin"
    elif counts["mechanisms"] < 8 and counts["supplements"] < 15:
        verdict = "moderate"
    else:
        verdict = "rich"

    json.dump({
        "ok": True,
        "counts": counts,
        "matched_symptoms_in_catalogue": len(matched_symptoms),
        "matched_topics_in_catalogue": len(matched_topics),
        "unmatched_symptoms": unmatched_symptoms,
        "unmatched_topics": unmatched_topics,
        "verdict": verdict,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
