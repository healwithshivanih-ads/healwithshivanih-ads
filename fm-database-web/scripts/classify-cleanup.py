#!/usr/bin/env python3
"""Pre-classify the remaining cleanup groups into triage buckets so the
coach can rip through them in the /catalogue/cleanup UI without having
to re-read every reason text from scratch.

Buckets:
  - auto         : high-confidence merge. All members share semantic core,
                   canonical exists as the target kind, reason language is
                   unambiguous ("same", "identical", "interchangeable",
                   "all describe").
  - coach_eye    : merge plausible but needs human judgement — kind move
                   (topic_is_*), or members semantically differ enough
                   that the coach should glance at each member's YAML.
  - dismiss      : Haiku self-contradicted (reason says "keep as topic"
                   while kind says topic_is_*), or empty canonical.

Writes the bucket back onto each group as `triage_bucket: <name>` so the
UI / coach can sort. Also writes a human-readable summary to
`fm-database/data/_cleanup/triage.md` with one line per group, grouped
by bucket. Both files are gitignored — local triage aid only.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

REPO = Path("/Users/shivani/code/healwithshivanih-ads")
PLAN = REPO / "fm-database/data/_cleanup/latest_plan.yaml"
DATA = REPO / "fm-database/data"
TRIAGE = REPO / "fm-database/data/_cleanup/triage.md"


_DISMISS_REASON_PATTERNS = [
    re.compile(r"keep as topic", re.I),
    re.compile(r"is\s+actually\s+a\s+\w+\s+rather\s+than", re.I),
    re.compile(r"should\s+remain", re.I),
]

_HIGH_CONFIDENCE_REASON_PATTERNS = [
    re.compile(r"\bidentical\b", re.I),
    re.compile(r"\binterchangeabl(e|y)\b", re.I),
    re.compile(r"\bsame\s+(condition|topic|concept|framework|term)\b", re.I),
    re.compile(r"all\s+(three|four|five|describe|are)\b", re.I),
    re.compile(r"both\s+describe\b", re.I),
]


def _target_dir(kind: str) -> Path:
    return DATA / {
        "topic":     "topics",
        "protocol":  "protocols",
        "mechanism": "mechanisms",
        "symptom":   "symptoms",
    }.get(kind, "topics")


def _slug_exists(kind: str, slug: str) -> bool:
    return (_target_dir(kind) / f"{slug}.yaml").exists()


def _shared_prefix_words(members: list[str]) -> int:
    """How many words at the START of each slug are identical across all members."""
    if not members:
        return 0
    splits = [m.split("-") for m in members]
    n = min(len(s) for s in splits)
    common = 0
    for i in range(n):
        if all(s[i] == splits[0][i] for s in splits):
            common += 1
        else:
            break
    return common


def classify(group: dict) -> tuple[str, str]:
    """Return (bucket, one_line_rationale)."""
    kind = group["kind"]
    canonical = (group.get("canonical") or "").strip()
    members = group.get("members") or []
    reason = group.get("reason") or ""

    # --- DISMISS rules ----------------------------------------------------
    if not canonical:
        return "dismiss", "empty canonical — Haiku couldn't pick a target"

    for pat in _DISMISS_REASON_PATTERNS:
        if pat.search(reason):
            return "dismiss", f"reason text contradicts kind ({kind})"

    if kind == "duplicate_topics" and len(members) < 2:
        return "dismiss", "<2 members — nothing to merge"

    # --- AUTO rules -------------------------------------------------------
    if kind == "duplicate_topics":
        # Canonical must exist as a topic/protocol/mechanism/symptom YAML.
        canonical_exists = (
            _slug_exists("topic", canonical)
            or _slug_exists("protocol", canonical)
            or _slug_exists("mechanism", canonical)
            or _slug_exists("symptom", canonical)
        )
        if not canonical_exists:
            return "coach_eye", f"canonical {canonical!r} not present in any catalogue kind"

        # All members exist as topics.
        non_canonical_members = [m for m in members if m != canonical]
        all_present = all(_slug_exists("topic", m) for m in non_canonical_members)
        if not all_present:
            missing = [m for m in non_canonical_members if not _slug_exists("topic", m)]
            return "coach_eye", f"missing topic files: {', '.join(missing)}"

        # Strong reason language + ≥1 word shared prefix → auto.
        has_strong_lang = any(p.search(reason) for p in _HIGH_CONFIDENCE_REASON_PATTERNS)
        shared = _shared_prefix_words(members) if len(members) <= 4 else 0
        if has_strong_lang and shared >= 1:
            return "auto", f"strong reason + {shared}-word shared prefix · {len(members)} members"

        if has_strong_lang:
            return "auto", f"strong reason language · {len(members)} members"

        if shared >= 2:
            return "auto", f"{shared}-word shared prefix · {len(members)} members"

        return "coach_eye", "duplicate_topics — review reason text"

    if kind in ("topic_is_protocol", "topic_is_mechanism", "topic_is_symptom"):
        target_kind = kind.split("_")[-1]
        if not _slug_exists(target_kind, canonical):
            return "coach_eye", f"target {target_kind} {canonical!r} doesn't exist — stub needed"
        return "coach_eye", f"{kind} — judgement call: is {members[0]!r} truly a {target_kind}?"

    return "coach_eye", f"unknown kind: {kind}"


def main() -> int:
    plan = yaml.safe_load(PLAN.read_text())
    groups = plan["groups"]

    buckets: dict[str, list[tuple[dict, str]]] = {"auto": [], "coach_eye": [], "dismiss": []}
    for g in groups:
        bucket, rationale = classify(g)
        g["triage_bucket"] = bucket
        g["triage_note"] = rationale
        buckets[bucket].append((g, rationale))

    # Write enriched plan back
    PLAN.write_text(yaml.dump(plan, sort_keys=False, allow_unicode=True))

    # Human-readable triage.md
    md = ["# Cleanup triage — auto-classified", ""]
    md.append(f"Generated from {len(groups)} remaining groups.")
    md.append("")
    md.append(f"- **auto** ({len(buckets['auto'])}) — high confidence, safe to bulk-apply")
    md.append(f"- **coach_eye** ({len(buckets['coach_eye'])}) — review member YAMLs before apply")
    md.append(f"- **dismiss** ({len(buckets['dismiss'])}) — Haiku flagged inconsistency")
    md.append("")
    for bucket in ("auto", "coach_eye", "dismiss"):
        md.append(f"## {bucket} ({len(buckets[bucket])})")
        md.append("")
        for g, rationale in buckets[bucket]:
            kind = g["kind"]
            canonical = g.get("canonical") or "∅"
            members = ", ".join(g["members"])
            md.append(f"- `{g['id']}` **{canonical}** ({kind})")
            md.append(f"  - members: {members}")
            md.append(f"  - triage: _{rationale}_")
            md.append("")
    TRIAGE.write_text("\n".join(md))

    print(f"auto:      {len(buckets['auto'])}")
    print(f"coach_eye: {len(buckets['coach_eye'])}")
    print(f"dismiss:   {len(buckets['dismiss'])}")
    print()
    print(f"wrote {TRIAGE.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    main()
