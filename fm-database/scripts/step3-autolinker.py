#!/usr/bin/env python3
"""
Step 3 — auto-linker over the remaining pending-refs.

For every unresolved cross-reference in the catalogue:
  1. Look up the missing slug in the alias-index for its target kind.
  2. If it's already an alias of an existing canonical → rewrite refs.
  3. If it's a slug-form variant of an alias (lower/hyphen normalised)
     → rewrite refs to the canonical.
  4. Otherwise leave it — genuinely missing content, needs a real
     ingest or a manual stub decision.

Zero-risk: only rewrites references whose target is ALREADY known to
the catalogue under a different spelling. Doesn't invent content.

USAGE
─────
  .venv/bin/python scripts/step3-autolinker.py            # dry run
  .venv/bin/python scripts/step3-autolinker.py --apply    # commit
"""
from __future__ import annotations
import re, sys, yaml
from pathlib import Path
from collections import defaultdict

DATA = Path("data")
APPLY = "--apply" in sys.argv


def load(p): return yaml.safe_load(p.read_text()) or {}
def dump(d): return yaml.dump(d, sort_keys=False, default_flow_style=False, allow_unicode=True, width=120)


def build_alias_index() -> dict[str, dict[str, str]]:
    """For each entity dir, return {slug-or-alias-or-slugform: canonical_slug}.
    Same logic the validator uses for alias-aware resolution."""
    out: dict[str, dict[str, str]] = {}
    for kind in ("topics", "mechanisms", "symptoms", "supplements", "claims"):
        idx: dict[str, str] = {}
        for p in (DATA / kind).glob("*.yaml"):
            try:
                d = load(p)
            except Exception:
                continue
            slug = d.get("slug")
            if not slug:
                continue
            idx[slug] = slug
            for a in (d.get("aliases") or []):
                # Try both verbatim AND slug-form (lowercase + hyphenated)
                slug_form = re.sub(r"[^a-z0-9-]+", "-", str(a).lower()).strip("-")
                if a not in idx:
                    idx[str(a)] = slug
                if slug_form and slug_form not in idx:
                    idx[slug_form] = slug
        out[kind] = idx
    # Sources use `id` not `slug`
    idx: dict[str, str] = {}
    for p in (DATA / "sources").glob("*.yaml"):
        try:
            d = load(p)
        except Exception:
            continue
        sid = d.get("id")
        if not sid:
            continue
        idx[sid] = sid
        # case-insensitive normalisation for source ids — coach mistypes
        idx[sid.lower()] = sid
    out["sources"] = idx
    return out


REFERENCE_FIELDS = {
    "topics": [
        ("common_symptoms", "symptoms"), ("red_flags", "symptoms"),
        ("related_topics", "topics"), ("key_mechanisms", "mechanisms"),
        ("sources", "sources"),
    ],
    "mechanisms": [
        ("upstream_drivers", "mechanisms"), ("downstream_effects", "mechanisms"),
        ("related_mechanisms", "mechanisms"), ("linked_to_topics", "topics"),
        ("sources", "sources"),
    ],
    "symptoms": [
        ("linked_to_topics", "topics"), ("linked_to_mechanisms", "mechanisms"),
        ("sources", "sources"),
    ],
    "supplements": [
        ("linked_to_topics", "topics"), ("linked_to_mechanisms", "mechanisms"),
        ("linked_to_claims", "claims"), ("sources", "sources"),
    ],
    "claims": [
        ("linked_to_topics", "topics"), ("linked_to_mechanisms", "mechanisms"),
        ("linked_to_supplements", "supplements"), ("sources", "sources"),
    ],
}


def main() -> int:
    idx = build_alias_index()

    # Stats
    rewrites_by_target: dict[tuple[str, str, str], int] = defaultdict(int)
    files_touched: set[Path] = set()
    unresolved: dict[str, set[str]] = defaultdict(set)

    for entity_dir, fields in REFERENCE_FIELDS.items():
        for p in (DATA / entity_dir).glob("*.yaml"):
            try:
                data = load(p)
            except Exception:
                continue
            touched = False
            self_slug = data.get("slug") or data.get("id")
            for field, target_kind in fields:
                vals = data.get(field)
                if not isinstance(vals, list):
                    continue
                target_idx = idx.get(target_kind, {})

                if target_kind == "sources":
                    # list of dicts; rewrite `id`
                    for c in vals:
                        if not isinstance(c, dict):
                            continue
                        old_id = c.get("id")
                        if not old_id or old_id in target_idx and target_idx[old_id] == old_id:
                            # already canonical
                            continue
                        # case-insensitive recovery
                        if old_id in target_idx:
                            new_id = target_idx[old_id]
                            if new_id != old_id:
                                c["id"] = new_id
                                rewrites_by_target[(entity_dir, "sources", old_id)] += 1
                                touched = True
                        elif old_id.lower() in target_idx:
                            new_id = target_idx[old_id.lower()]
                            c["id"] = new_id
                            rewrites_by_target[(entity_dir, "sources", old_id)] += 1
                            touched = True
                        else:
                            unresolved["sources"].add(old_id)
                else:
                    new_vals: list[str] = []
                    seen = set()
                    for v in vals:
                        if not isinstance(v, str):
                            new_vals.append(v)
                            continue
                        if v == self_slug:
                            # self-reference — silently drop
                            touched = True
                            continue
                        if v in target_idx and target_idx[v] == v:
                            # already canonical
                            if v not in seen:
                                new_vals.append(v); seen.add(v)
                            continue
                        if v in target_idx:
                            canon = target_idx[v]
                            if canon != v:
                                rewrites_by_target[(entity_dir, target_kind, v)] += 1
                                touched = True
                                # Self-ref guard: if the alias resolved
                                # back to this entity itself, drop it.
                                if canon != self_slug and canon not in seen:
                                    new_vals.append(canon); seen.add(canon)
                                continue
                        # Try slug-form normalisation
                        slug_form = re.sub(r"[^a-z0-9-]+", "-", v.lower()).strip("-")
                        if slug_form != v and slug_form in target_idx:
                            canon = target_idx[slug_form]
                            rewrites_by_target[(entity_dir, target_kind, v)] += 1
                            touched = True
                            if canon != self_slug and canon not in seen:
                                new_vals.append(canon); seen.add(canon)
                            continue
                        # Unresolvable — keep as-is, record for stats
                        unresolved[target_kind].add(v)
                        if v not in seen:
                            new_vals.append(v); seen.add(v)
                    data[field] = new_vals

            if touched:
                if APPLY:
                    p.write_text(dump(data))
                files_touched.add(p)

    print("=" * 76)
    print(f"STEP 3 AUTO-LINKER — {'APPLY' if APPLY else 'DRY RUN'}")
    print("=" * 76)
    total_rewrites = sum(rewrites_by_target.values())
    print(f"\nFiles touched: {len(files_touched)}")
    print(f"Total ref rewrites: {total_rewrites}")
    print(f"\nTop alias resolutions:")
    sorted_rewrites = sorted(rewrites_by_target.items(), key=lambda kv: -kv[1])
    for (kind, target_kind, old), n in sorted_rewrites[:25]:
        canon = idx[target_kind].get(old) or idx[target_kind].get(old.lower())
        print(f"  ×{n:3d}  {target_kind} {old!r} → {canon!r}")
    if len(sorted_rewrites) > 25:
        print(f"  … +{len(sorted_rewrites) - 25} more unique slugs rewritten")
    print(f"\nStill unresolved by kind:")
    for k, s in unresolved.items():
        print(f"  {k}: {len(s)} unique slugs")
    if not APPLY:
        print("\nDry run only. Re-run with --apply to commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
