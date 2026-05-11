#!/usr/bin/env python3
"""Catalogue duplicate analyzer.

Scans every topic in fm-database/data/topics/ and (with Haiku) groups them by:

  1. duplicate_topics    — same clinical concept, different slugs
  2. topic_is_protocol   — should be in protocols/, not topics/
  3. topic_is_mechanism  — should be in mechanisms/, not topics/
  4. topic_is_symptom    — should be in symptoms/, not topics/

Outputs a structured cleanup plan that the /catalogue/cleanup UI then lets
the coach review + apply one group at a time.

Reads JSON from stdin:
{
  "dry_run": bool,
  "limit":   int | null    # cap on number of topics analysed (for testing)
}

Writes JSON to stdout:
{
  "ok": bool,
  "plan": {
    "generated_at": ISO-datetime,
    "topic_count":  int,
    "groups": [
      {
        "id":        str,                   # stable hash for tracking dismissals
        "kind":      "duplicate_topics" | "topic_is_protocol" | "topic_is_mechanism" | "topic_is_symptom",
        "canonical": str,                   # slug to keep (or target protocol/mechanism/symptom slug)
        "members":   [str],                 # other slugs (to merge in / move out)
        "reason":    str                    # one-sentence rationale
      }
    ]
  },
  "error": str | null
}
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml


def _load_env() -> None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    candidates = [
        Path(__file__).resolve().parent.parent.parent / "fm-database" / ".env",
        Path(__file__).resolve().parent.parent / "fm-database" / ".env",
    ]
    for p in candidates:
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):]
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


def _catalogue_root() -> Path:
    p = os.environ.get("FMDB_CATALOGUE_DIR")
    if p:
        return Path(p).expanduser()
    # Default: ../fm-database/data relative to this shim
    return Path(__file__).resolve().parent.parent.parent / "fm-database" / "data"


def _load_entity_summaries(dir_path: Path, max_summary: int = 200) -> list[dict]:
    out: list[dict] = []
    if not dir_path.exists():
        return out
    for f in sorted(dir_path.glob("*.yaml")):
        try:
            data = yaml.safe_load(f.read_text()) or {}
            out.append({
                "slug": data.get("slug", f.stem),
                "display_name": data.get("display_name", ""),
                "aliases": data.get("aliases") or [],
                "summary": (data.get("summary") or "")[:max_summary],
            })
        except Exception:
            continue
    return out


def _hash_group(kind: str, canonical: str, members: list[str]) -> str:
    h = hashlib.sha256()
    h.update(kind.encode())
    h.update(canonical.encode())
    for m in sorted(members):
        h.update(m.encode())
    return h.hexdigest()[:12]


_TOOL_SCHEMA = {
    "name": "catalogue_cleanup_plan",
    "description": "Produce a cleanup plan for the topics catalogue: duplicates to merge + topics that should be other entity kinds.",
    "input_schema": {
        "type": "object",
        "properties": {
            "groups": {
                "type": "array",
                "description": "Each group is one cleanup action.",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["duplicate_topics", "topic_is_protocol", "topic_is_mechanism", "topic_is_symptom"],
                            "description": (
                                "duplicate_topics: members are different slugs for the SAME clinical concept; "
                                "merge into canonical. "
                                "topic_is_protocol: this topic is really a structured 4-12 week healing "
                                "path with phases (5R, AIP, Whole30, Low-FODMAP, elimination diet, "
                                "metabolic reset, adrenal recovery, liver detox phases, anti-inflammatory "
                                "reset, mitochondrial support, blood sugar regulation, cycle sync). "
                                "Move to protocols/. "
                                "topic_is_mechanism: this is a physiology / driver (e.g. 'gut barrier "
                                "dysfunction', 'HPA axis activation'), not an area of clinical knowledge. "
                                "Move to mechanisms/. "
                                "topic_is_symptom: this is a client-experienced complaint (e.g. 'morning "
                                "fatigue', 'post-prandial bloating'), not an area of clinical knowledge. "
                                "Move to symptoms/."
                            ),
                        },
                        "canonical": {
                            "type": "string",
                            "description": (
                                "For duplicate_topics: the slug that should remain (keep the one with the "
                                "richest data, the cleanest name, or the most uses). For topic_is_protocol/"
                                "mechanism/symptom: the slug in the TARGET kind that this topic maps to "
                                "(if an existing protocol/mechanism/symptom already covers it). Use empty "
                                "string '' if no existing target — coach will create one."
                            ),
                        },
                        "members": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "For duplicate_topics: ALL topic slugs in the duplicate group, INCLUDING "
                                "the canonical. For topic_is_X: the topic slugs to remove from topics/."
                            ),
                            "minItems": 1,
                        },
                        "reason": {
                            "type": "string",
                            "description": "One-sentence rationale.",
                        },
                    },
                    "required": ["kind", "canonical", "members", "reason"],
                },
            },
        },
        "required": ["groups"],
    },
}


_SYSTEM = """You are auditing a functional medicine catalogue. Each Topic is \
supposed to be a CLINICAL AREA / CONDITION (e.g. Hashimoto's thyroiditis, PCOS, \
insulin resistance, perimenopause, anxiety, leaky gut as a condition).

Topics should NOT be:
- Healing protocols (5R, AIP, Whole30, Low-FODMAP, elimination diet, metabolic \
  reset, adrenal recovery, liver detox phases, anti-inflammatory reset, \
  mitochondrial support, blood sugar regulation, cycle sync) → these go in protocols/.
- Physiological mechanisms / drivers (HPA axis dysregulation, gut barrier \
  dysfunction, mitochondrial dysfunction, leaky gut AS A MECHANISM) → mechanisms/.
- Client-experienced symptoms (bloating, brain fog, joint pain) → symptoms/.

Your job:
1. Find DUPLICATES — multiple topic slugs covering the same clinical concept. \
   Group them. Pick the canonical (cleanest name, richest summary, most aliases). \
   Don't be too aggressive — only merge if the concepts are TRULY the same. \
   Hashimoto's and Hypothyroidism are CLOSE but DIFFERENT — keep separate.

2. Find MISCATEGORISED topics:
   - topic_is_protocol: the title or summary describes a structured healing path \
     with phases, weeks, foods to remove, supplements to add. Map to the existing \
     protocol slug from the EXISTING PROTOCOLS list if there's a match; otherwise \
     leave canonical empty (''').
   - topic_is_mechanism: describes a physiology/pathway/driver. Map to existing \
     mechanism slug if you can identify one; else canonical='' (coach will create).
   - topic_is_symptom: describes a felt experience. Map to existing symptom if any.

3. Leave TRUE topics alone — don't include them in any group.

Be conservative. Only flag what's CLEARLY off. When in doubt, leave it. The coach \
will review every group and can dismiss any.

Output groups should be COMPLETE — list ALL slugs in each duplicate cluster (not \
just two). Don't fragment one cluster into multiple groups."""


def main() -> int:
    _load_env()

    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 1

    dry_run = bool(payload.get("dry_run", False))
    limit = payload.get("limit")

    root = _catalogue_root()
    topics = _load_entity_summaries(root / "topics")
    protocols = _load_entity_summaries(root / "protocols", max_summary=120)
    mechanisms = [{"slug": e["slug"], "display_name": e["display_name"]} for e in _load_entity_summaries(root / "mechanisms", max_summary=0)]
    symptoms = [{"slug": e["slug"], "display_name": e["display_name"]} for e in _load_entity_summaries(root / "symptoms", max_summary=0)]

    if limit:
        topics = topics[: int(limit)]

    if dry_run:
        plan = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "topic_count": len(topics),
            "groups": [],
        }
        json.dump({"ok": True, "plan": plan}, sys.stdout)
        return 0

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 1

    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    # Build context. Topics are the bulk; protocols/mechanisms/symptoms are
    # passed as reference lists so the model can map miscategorisations.
    ctx_lines: list[str] = []
    ctx_lines.append("# EXISTING PROTOCOLS (target kind for topic_is_protocol)")
    for p in protocols:
        aliases = ", ".join(p["aliases"][:3]) if p["aliases"] else ""
        ctx_lines.append(f"- {p['slug']} · {p['display_name']}" + (f" · aliases: {aliases}" if aliases else ""))
    ctx_lines.append("")
    ctx_lines.append("# EXISTING MECHANISMS (slug + display only — target kind for topic_is_mechanism)")
    for m in mechanisms[:200]:  # cap context
        ctx_lines.append(f"- {m['slug']} · {m['display_name']}")
    if len(mechanisms) > 200:
        ctx_lines.append(f"- ... + {len(mechanisms) - 200} more (omitted)")
    ctx_lines.append("")
    ctx_lines.append("# EXISTING SYMPTOMS (slug + display only — target kind for topic_is_symptom)")
    for s in symptoms[:200]:
        ctx_lines.append(f"- {s['slug']} · {s['display_name']}")
    if len(symptoms) > 200:
        ctx_lines.append(f"- ... + {len(symptoms) - 200} more (omitted)")
    ctx_lines.append("")
    ctx_lines.append(f"# TOPICS TO AUDIT ({len(topics)} total)")
    ctx_lines.append("")
    for t in topics:
        aliases = ", ".join(t["aliases"][:4]) if t["aliases"] else ""
        summary = t["summary"].replace("\n", " ")
        ctx_lines.append(
            f"- {t['slug']} · {t['display_name']}"
            + (f"\n    aliases: {aliases}" if aliases else "")
            + (f"\n    summary: {summary}" if summary else "")
        )

    context = "\n".join(ctx_lines)

    aclient = Anthropic(api_key=api_key)
    try:
        with aclient.messages.stream(
            model="claude-haiku-4-5",
            max_tokens=8192,
            system=_SYSTEM,
            tools=[_TOOL_SCHEMA],
            tool_choice={"type": "tool", "name": "catalogue_cleanup_plan"},
            messages=[{"role": "user", "content": context}],
        ) as stream:
            resp = stream.get_final_message()
    except Exception as e:
        json.dump({"ok": False, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    tool_input = None
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use":
            tool_input = block.input
            break

    if not tool_input:
        json.dump({"ok": False, "error": "model did not return tool_use block"}, sys.stdout)
        return 1

    raw_groups = tool_input.get("groups") or []
    enriched: list[dict] = []
    for g in raw_groups:
        kind = g.get("kind")
        canonical = (g.get("canonical") or "").strip()
        members = g.get("members") or []
        if not kind or not isinstance(members, list) or not members:
            continue
        # Defensive de-dup of members
        members = list(dict.fromkeys(m for m in members if isinstance(m, str) and m))
        if not members:
            continue
        enriched.append({
            "id": _hash_group(kind, canonical, members),
            "kind": kind,
            "canonical": canonical,
            "members": members,
            "reason": g.get("reason", ""),
        })

    plan = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "topic_count": len(topics),
        "groups": enriched,
    }

    # Persist plan to the catalogue-cleanup state file alongside the catalogue.
    state_dir = root / "_cleanup"
    state_dir.mkdir(exist_ok=True)
    (state_dir / "latest_plan.yaml").write_text(yaml.dump(plan, sort_keys=False, allow_unicode=True))

    json.dump({"ok": True, "plan": plan}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
