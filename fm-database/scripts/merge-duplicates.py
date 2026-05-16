#!/usr/bin/env python3
"""
Merge duplicate catalogue entries — alias the dropped slug onto canonical,
union-merge interesting fields (sources, linked_to_*, aliases), and
rewrite every cross-reference in the rest of the catalogue.

USAGE
─────
Edit the PAIRS list below. Each entry:
  ("entity", "canonical-slug", "drop-slug")

Run from fm-database/ root:
  .venv/bin/python scripts/merge-duplicates.py            # dry run
  .venv/bin/python scripts/merge-duplicates.py --apply    # commit changes

The dry run prints every file it would touch + a unified diff preview of
non-trivial rewrites. Run with --apply only after eyeballing the plan.
"""
from __future__ import annotations
import sys
import yaml
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# (entity_dir, canonical_slug, drop_slug)
# Canonical is the one we keep; drop becomes an alias on canonical.
PAIRS: list[tuple[str, str, str]] = [
    ("supplements", "rauwolfia-serpentina", "rauwolfia-serpentine"),     # typo
    ("supplements", "l-methylfolate", "methylfolate"),                   # the more specific name wins
    ("symptoms",    "mood-changes-and-anxiety", "mood-changes-anxiety"),  # better English
    ("mechanisms",  "phase-2-conjugation", "phase-ii-conjugation"),       # arabic numerals are house style
    ("mechanisms",  "phase-3-elimination", "phase-iii-elimination"),
    ("topics",      "medication-nutrient-interactions", "medicine-nutrient-interactions"),
]

# Reference fields per entity — where slugs of OTHER entities live and
# need to be rewritten when we merge a duplicate. Cross-kind fields are
# only rewritten when the drop slug is of the matching kind.
REFERENCE_FIELDS: dict[str, list[tuple[str, str]]] = {
    # entity_dir → list of (field_path, target_kind)
    # field_path uses dotted notation for nested lists.
    "topics": [
        ("common_symptoms", "symptoms"),
        ("red_flags", "symptoms"),
        ("related_topics", "topics"),
        ("key_mechanisms", "mechanisms"),
    ],
    "mechanisms": [
        ("upstream_drivers", "mechanisms"),
        ("downstream_effects", "mechanisms"),
        ("related_mechanisms", "mechanisms"),
        ("linked_to_topics", "topics"),
    ],
    "symptoms": [
        ("linked_to_topics", "topics"),
        ("linked_to_mechanisms", "mechanisms"),
    ],
    "supplements": [
        ("linked_to_topics", "topics"),
        ("linked_to_mechanisms", "mechanisms"),
        ("linked_to_claims", "claims"),
    ],
    "claims": [
        ("linked_to_topics", "topics"),
        ("linked_to_mechanisms", "mechanisms"),
        ("linked_to_supplements", "supplements"),
    ],
}


def load_yaml(p: Path) -> dict:
    return yaml.safe_load(p.read_text()) or {}


def dump_yaml(data: dict) -> str:
    return yaml.dump(data, sort_keys=False, default_flow_style=False, allow_unicode=True, width=120)


def add_alias(canonical_data: dict, drop_slug: str) -> bool:
    """Append drop_slug to canonical's aliases if not present. Returns True if changed."""
    aliases = canonical_data.get("aliases") or []
    if drop_slug in aliases:
        return False
    aliases.append(drop_slug)
    canonical_data["aliases"] = aliases
    return True


def union_sources(canonical: dict, dropped: dict) -> bool:
    """Union-merge sources by `id`. Returns True if any added."""
    can_srcs = canonical.get("sources") or []
    drop_srcs = dropped.get("sources") or []
    existing_ids = {s.get("id") for s in can_srcs if isinstance(s, dict)}
    added = False
    for s in drop_srcs:
        if isinstance(s, dict) and s.get("id") not in existing_ids:
            can_srcs.append(s)
            existing_ids.add(s.get("id"))
            added = True
    if added:
        canonical["sources"] = can_srcs
    return added


def union_list(canonical: dict, dropped: dict, field: str) -> bool:
    """Append unique strings from dropped[field] into canonical[field]."""
    can_list = canonical.get(field) or []
    drop_list = dropped.get(field) or []
    if not isinstance(can_list, list) or not isinstance(drop_list, list):
        return False
    added = False
    for x in drop_list:
        if x not in can_list:
            can_list.append(x)
            added = True
    if added:
        canonical[field] = can_list
    return added


def rewrite_refs_in_file(p: Path, drop_slug: str, canonical_slug: str, target_kind: str) -> bool:
    """Rewrite occurrences of drop_slug → canonical_slug in this file.
    Only touches fields where the target kind matches. Returns True if changed.
    """
    entity_dir = p.parent.name
    fields = REFERENCE_FIELDS.get(entity_dir, [])
    data = load_yaml(p)
    changed = False
    for field_name, field_target_kind in fields:
        if field_target_kind != target_kind:
            continue
        vals = data.get(field_name)
        if not isinstance(vals, list):
            continue
        new_vals = []
        seen = set()
        for v in vals:
            if v == drop_slug:
                v = canonical_slug
                changed = True
            if v not in seen:
                new_vals.append(v)
                seen.add(v)
        data[field_name] = new_vals
    if changed:
        p.write_text(dump_yaml(data))
    return changed


def main() -> int:
    apply = "--apply" in sys.argv
    print("=" * 72)
    print(f"MERGE DUPLICATES — {'APPLY' if apply else 'DRY RUN'}")
    print("=" * 72)

    total_ref_rewrites = 0
    for entity_dir, canon_slug, drop_slug in PAIRS:
        canon_path = DATA / entity_dir / f"{canon_slug}.yaml"
        drop_path = DATA / entity_dir / f"{drop_slug}.yaml"
        print(f"\n── {entity_dir}: {drop_slug} → {canon_slug} ──")
        if not canon_path.exists():
            print(f"  ✗ skip — canonical not found: {canon_path.relative_to(ROOT)}")
            continue
        if not drop_path.exists():
            print(f"  ⚠ skip — drop not found (already merged?): {drop_path.relative_to(ROOT)}")
            continue

        canon = load_yaml(canon_path)
        dropped = load_yaml(drop_path)

        changes = []
        if add_alias(canon, drop_slug):
            changes.append(f"alias '{drop_slug}' added")
        # Also propagate any aliases the dropped entry had (some duplicates
        # were the variant alias of yet another spelling)
        for a in (dropped.get("aliases") or []):
            if a != canon_slug and a not in (canon.get("aliases") or []):
                canon.setdefault("aliases", []).append(a)
                changes.append(f"alias '{a}' carried over")
        if union_sources(canon, dropped):
            changes.append("sources merged")
        # Best-effort field unions — only the simple string-list fields.
        for f in ("linked_to_topics", "linked_to_mechanisms",
                  "linked_to_supplements", "linked_to_claims",
                  "common_symptoms", "red_flags", "related_topics",
                  "key_mechanisms", "upstream_drivers", "downstream_effects",
                  "related_mechanisms"):
            if union_list(canon, dropped, f):
                changes.append(f"{f} union-merged")
        print(f"  canonical:   {canon_path.relative_to(ROOT)}")
        print(f"  changes:     {', '.join(changes) if changes else '(none — alias only)'}")
        print(f"  drop file:   {drop_path.relative_to(ROOT)}  (delete)")

        # Walk the whole catalogue rewriting refs
        ref_count = 0
        for yaml_path in DATA.glob("*/*.yaml"):
            # Skip the dropped file itself — it's about to be deleted
            if yaml_path == drop_path:
                continue
            if apply:
                if rewrite_refs_in_file(yaml_path, drop_slug, canon_slug, entity_dir):
                    ref_count += 1
            else:
                # Dry-run: simulate without writing
                data = load_yaml(yaml_path)
                fields = REFERENCE_FIELDS.get(yaml_path.parent.name, [])
                hit = False
                for f, kind in fields:
                    if kind != entity_dir: continue
                    if drop_slug in (data.get(f) or []):
                        hit = True
                if hit:
                    ref_count += 1
        print(f"  refs to rewrite in {ref_count} other file(s)")
        total_ref_rewrites += ref_count

        if apply:
            canon_path.write_text(dump_yaml(canon))
            drop_path.unlink()

    print(f"\n{'=' * 72}")
    print(f"SUMMARY — {len(PAIRS)} pairs, {total_ref_rewrites} cross-ref rewrites")
    print("=" * 72)
    if not apply:
        print("\nDry run only. Re-run with --apply to commit changes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
