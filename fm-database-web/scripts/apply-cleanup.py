#!/usr/bin/env python3
"""Apply one cleanup group from the analyzer's plan.

For duplicate_topics:
  - Union all aliases from members into the canonical Topic
  - Add each non-canonical slug as an alias on canonical (so any existing
    Plan / catalogue reference to the deleted slug still resolves via the
    alias-aware validator)
  - Delete the non-canonical YAML files

For topic_is_protocol / topic_is_mechanism / topic_is_symptom:
  - If `canonical` references an EXISTING slug in the target kind:
      - Add each member slug + member aliases to that target's aliases
      - Delete each member's topic YAML
  - If `canonical` is empty:
      - Refuse — coach must first create the target entity
        (we don't auto-stub protocols/mechanisms/symptoms — those need
         richer per-kind fields than we can guess at)

Reads JSON from stdin:
{
  "group": {
    "id":        str,
    "kind":      "duplicate_topics" | "topic_is_protocol" | "topic_is_mechanism" | "topic_is_symptom",
    "canonical": str,
    "members":   [str],
    "reason":    str
  },
  "dry_run": bool
}

Writes JSON to stdout:
{
  "ok": bool,
  "summary": {
    "canonical_slug":   str,
    "aliases_added":    [str],
    "files_deleted":    [str],
    "warnings":         [str]
  },
  "error": str | null
}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import yaml


def _catalogue_root() -> Path:
    p = os.environ.get("FMDB_CATALOGUE_DIR")
    if p:
        return Path(p).expanduser()
    return Path(__file__).resolve().parent.parent.parent / "fm-database" / "data"


_KIND_DIR = {
    "topic":      "topics",
    "protocol":   "protocols",
    "mechanism":  "mechanisms",
    "symptom":    "symptoms",
}


def _load_yaml(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return yaml.safe_load(path.read_text()) or {}
    except Exception:
        return None


def _save_yaml(path: Path, data: dict) -> None:
    path.write_text(yaml.dump(data, sort_keys=False, allow_unicode=True))


def _merge_into_canonical(
    canonical_path: Path,
    canonical_data: dict,
    members_to_absorb: list[tuple[Path, dict, str]],  # (path, data, slug)
    dry_run: bool,
) -> dict:
    """Union aliases + add member slugs as aliases on the canonical."""
    summary = {
        "canonical_slug": canonical_data.get("slug", ""),
        "aliases_added": [],
        "files_deleted": [],
        "warnings": [],
    }
    existing_aliases = set(canonical_data.get("aliases") or [])
    new_aliases = list(existing_aliases)

    for member_path, member_data, member_slug in members_to_absorb:
        # Skip self
        if member_slug == canonical_data.get("slug"):
            continue
        # Add the member's slug itself as an alias so old refs still resolve
        if member_slug not in existing_aliases:
            new_aliases.append(member_slug)
            summary["aliases_added"].append(member_slug)
            existing_aliases.add(member_slug)
        # Union member's aliases
        for alias in member_data.get("aliases") or []:
            if alias not in existing_aliases:
                new_aliases.append(alias)
                summary["aliases_added"].append(alias)
                existing_aliases.add(alias)
        # Union sources (de-dup by source id)
        canonical_sources = canonical_data.get("sources") or []
        seen_source_ids = {
            (s.get("id") if isinstance(s, dict) else None)
            for s in canonical_sources
        }
        for src in member_data.get("sources") or []:
            sid = src.get("id") if isinstance(src, dict) else None
            if sid and sid not in seen_source_ids:
                canonical_sources.append(src)
                seen_source_ids.add(sid)
        canonical_data["sources"] = canonical_sources
        summary["files_deleted"].append(str(member_path))

    canonical_data["aliases"] = new_aliases

    if not dry_run:
        _save_yaml(canonical_path, canonical_data)
        for member_path, _, _ in members_to_absorb:
            if member_path != canonical_path and member_path.exists():
                member_path.unlink()
    return summary


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 1

    group = payload.get("group") or {}
    dry_run = bool(payload.get("dry_run", False))

    kind = group.get("kind")
    canonical = (group.get("canonical") or "").strip()
    members = group.get("members") or []

    if not kind or not isinstance(members, list) or not members:
        json.dump({"ok": False, "error": "group missing kind or members"}, sys.stdout)
        return 1

    root = _catalogue_root()

    if kind == "duplicate_topics":
        if not canonical:
            json.dump({"ok": False, "error": "duplicate_topics requires a canonical slug"}, sys.stdout)
            return 1
        # Auto-route: if the canonical isn't a Topic but IS a Protocol/Mechanism/
        # Symptom, treat this as a topic_is_X move instead. Common case: Haiku
        # picks protocols/5r-gut-protocol as the canonical for three duplicate
        # 5R *topics*.
        if not (root / "topics" / f"{canonical}.yaml").exists():
            for alt_kind, alt_dir in (("protocol", "protocols"), ("mechanism", "mechanisms"), ("symptom", "symptoms")):
                if (root / alt_dir / f"{canonical}.yaml").exists():
                    kind = f"topic_is_{alt_kind}"
                    # Drop the canonical from members (it's not a topic slug to remove)
                    members = [m for m in members if m != canonical]
                    break
            else:
                json.dump({
                    "ok": False,
                    "error": (
                        f"canonical slug not found in any catalogue: {canonical}. "
                        f"Either pick a slug that exists, or change the group kind."
                    ),
                }, sys.stdout)
                return 1

    if kind == "duplicate_topics":
        if canonical not in members:
            # Coach may have edited; include it
            members = [canonical] + members
        canonical_path = root / "topics" / f"{canonical}.yaml"
        canonical_data = _load_yaml(canonical_path)
        if canonical_data is None:
            json.dump({"ok": False, "error": f"canonical topic not found: {canonical}"}, sys.stdout)
            return 1
        members_to_absorb = []
        for m in members:
            if m == canonical:
                continue
            mp = root / "topics" / f"{m}.yaml"
            md = _load_yaml(mp)
            if md is None:
                continue  # Already gone — skip silently
            members_to_absorb.append((mp, md, m))
        summary = _merge_into_canonical(canonical_path, canonical_data, members_to_absorb, dry_run)
        json.dump({"ok": True, "summary": summary}, sys.stdout)
        return 0

    if kind in ("topic_is_protocol", "topic_is_mechanism", "topic_is_symptom"):
        target_kind = {
            "topic_is_protocol":  "protocol",
            "topic_is_mechanism": "mechanism",
            "topic_is_symptom":   "symptom",
        }[kind]
        target_dir = _KIND_DIR[target_kind]
        if not canonical:
            json.dump({
                "ok": False,
                "error": (
                    f"{kind} group has no target {target_kind} slug — please create "
                    f"the {target_kind} entity first, then re-run cleanup."
                ),
            }, sys.stdout)
            return 1
        canonical_path = root / target_dir / f"{canonical}.yaml"
        canonical_data = _load_yaml(canonical_path)
        if canonical_data is None:
            if not bool(payload.get("create_stub", False)):
                json.dump({
                    "ok": False,
                    "needs_stub": True,
                    "target_kind": target_kind,
                    "target_slug": canonical,
                    "error": (
                        f"target {target_kind} not found: {canonical}. "
                        f"Re-apply with create_stub=true to create a minimal {target_kind} "
                        f"stub from the first topic's data, then merge."
                    ),
                }, sys.stdout)
                return 1
            # Build a stub from the first available member topic
            from datetime import date as _date
            first_data = None
            for m in members:
                d = _load_yaml(root / "topics" / f"{m}.yaml")
                if d is not None:
                    first_data = d
                    break
            if first_data is None:
                json.dump({
                    "ok": False,
                    "error": f"cannot create stub — no member topics readable",
                }, sys.stdout)
                return 1
            stub_display = first_data.get("display_name") or canonical.replace("-", " ").title()
            stub_summary = (first_data.get("summary") or "").strip() or f"Auto-created from cleanup merge of {len(members)} topic(s)."
            today = _date.today().isoformat()
            updated_by = os.environ.get("FMDB_USER") or "shivani"
            if target_kind == "protocol":
                canonical_data = {
                    "slug": canonical,
                    "display_name": stub_display,
                    "category": "other",
                    "summary": stub_summary,
                    "evidence_tier": "fm_specific_thin",
                    "updated_at": today,
                    "updated_by": updated_by,
                    "version": 1,
                    "status": "active",
                    "notes_for_coach": "Stub created via /catalogue/cleanup — flesh out phases, indications, foods, supplements before using in a plan.",
                }
            elif target_kind == "mechanism":
                canonical_data = {
                    "slug": canonical,
                    "display_name": stub_display,
                    "category": "other",
                    "summary": stub_summary,
                    "evidence_tier": "fm_specific_thin",
                    "updated_at": today,
                    "updated_by": updated_by,
                    "version": 1,
                    "status": "active",
                    "notes_for_coach": "Stub created via /catalogue/cleanup — confirm category + add upstream/downstream links.",
                }
            else:  # symptom
                canonical_data = {
                    "slug": canonical,
                    "display_name": stub_display,
                    "category": "other",
                    "severity": "common",
                    "description": stub_summary,
                    "updated_at": today,
                    "updated_by": updated_by,
                    "version": 1,
                    "status": "active",
                    "notes_for_coach": "Stub created via /catalogue/cleanup — confirm category + severity.",
                }
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            if not dry_run:
                _save_yaml(canonical_path, canonical_data)
        # Members are topic slugs to remove. Add their slugs + aliases to the
        # target entity (if the target supports aliases — protocols + mechanisms
        # + symptoms all do).
        members_to_absorb = []
        for m in members:
            mp = root / "topics" / f"{m}.yaml"
            md = _load_yaml(mp)
            if md is None:
                continue
            members_to_absorb.append((mp, md, m))
        summary = _merge_into_canonical(canonical_path, canonical_data, members_to_absorb, dry_run)
        json.dump({"ok": True, "summary": summary}, sys.stdout)
        return 0

    json.dump({"ok": False, "error": f"unknown kind: {kind}"}, sys.stdout)
    return 1


if __name__ == "__main__":
    sys.exit(main())
