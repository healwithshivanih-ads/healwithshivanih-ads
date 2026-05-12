#!/usr/bin/env python3
"""Reclassify, merge, or delete a single catalogue entity.

Reads JSON from stdin:
{
  "action":      "move" | "merge" | "delete",
  "source_kind": str,            # e.g. "topics"
  "source_slug": str,            # e.g. "antigravity-exercise-for-blood-sugar"
  # for "move":
  "target_kind": str | null,     # e.g. "protocols" — required for move; new entity created if needed
  "create_stub": bool,           # required for move if target slug doesn't exist
  # for "merge":
  "merge_into_kind": str | null, # e.g. "topics" — required for merge
  "merge_into_slug": str | null, # canonical slug to merge into; source becomes alias
  "dry_run":     bool,
}

Writes JSON to stdout:
{
  "ok": bool,
  "summary": {
    "action":           str,
    "source":           "<kind>/<slug>",
    "target":           "<kind>/<slug>" | null,
    "aliases_added":    [str],
    "files_deleted":    [str],
    "warnings":         [str]
  },
  "needs_stub":   bool | None,
  "target_kind":  str | None,
  "target_slug":  str | None,
  "error":        str | None
}
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date as _date
from pathlib import Path

import yaml


def _catalogue_root() -> Path:
    p = os.environ.get("FMDB_CATALOGUE_DIR")
    if p:
        return Path(p).expanduser()
    return Path(__file__).resolve().parent.parent.parent / "fm-database" / "data"


# Kinds that support aliases (and therefore safe merge targets).
_KIND_DIRS = {
    "topics", "mechanisms", "symptoms", "supplements", "protocols",
    "titration_protocols", "lab_panels", "lab_tests", "claims", "sources",
    "cooking_adjustments", "home_remedies", "mindmaps", "drug_depletions",
}
_KINDS_WITH_ALIASES = {
    "topics", "mechanisms", "symptoms", "supplements", "protocols",
}


def _load_yaml(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return yaml.safe_load(path.read_text()) or {}
    except Exception:
        return None


def _save_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, sort_keys=False, allow_unicode=True))


def _build_stub(target_kind: str, slug: str, source_data: dict) -> dict:
    """Minimal valid stub built from the source entity's display_name + summary."""
    today = _date.today().isoformat()
    updated_by = os.environ.get("FMDB_USER") or "shivani"
    display = source_data.get("display_name") or slug.replace("-", " ").title()
    summary = (source_data.get("summary") or source_data.get("description") or "").strip() \
        or f"Auto-created via reclassify from {source_data.get('slug', slug)}."

    base = {
        "slug": slug,
        "display_name": display,
        "summary": summary,
        "evidence_tier": source_data.get("evidence_tier") or "fm_specific_thin",
        "updated_at": today,
        "updated_by": updated_by,
        "version": 1,
        "status": "active",
        "notes_for_coach": "Stub created via Catalogue Reclassify — flesh out kind-specific fields before relying on this entry.",
    }
    if target_kind == "protocols":
        base.update({
            "category": "other",
            "phases": [],
            "indications": [],
            "contraindications": [],
        })
    elif target_kind == "mechanisms":
        base.update({"category": "other"})
    elif target_kind == "symptoms":
        # symptoms use `description`, not `summary`
        base.pop("summary", None)
        base["description"] = summary
        base.update({"category": "other", "severity": "common"})
    elif target_kind == "supplements":
        base.update({
            "category": "other",
            "forms_available": [],
            "typical_dose_range": {},
            "timing_options": [],
        })
    return base


def _emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, default=str)
    return 0 if payload.get("ok") else 1


def _do_move(root: Path, source_kind: str, source_slug: str, target_kind: str,
             create_stub: bool, dry_run: bool) -> dict:
    """Move source entity to target kind. If target doesn't exist, optionally create a stub
    seeded from the source's display_name + summary. The source YAML is then deleted, with
    the source slug added as an alias on the target so existing references keep resolving.
    """
    src_path = root / source_kind / f"{source_slug}.yaml"
    src_data = _load_yaml(src_path)
    if src_data is None:
        return {"ok": False, "error": f"source not found: {source_kind}/{source_slug}"}

    if target_kind not in _KIND_DIRS:
        return {"ok": False, "error": f"unknown target kind: {target_kind}"}
    if target_kind == source_kind:
        return {"ok": False, "error": "target kind must differ from source kind"}

    tgt_path = root / target_kind / f"{source_slug}.yaml"
    tgt_data = _load_yaml(tgt_path)

    if tgt_data is None:
        if not create_stub:
            return {
                "ok": False,
                "needs_stub": True,
                "target_kind": target_kind,
                "target_slug": source_slug,
                "error": (
                    f"No {target_kind}/{source_slug} exists. Confirm to create a stub from "
                    f"the source's display_name + summary."
                ),
            }
        tgt_data = _build_stub(target_kind, source_slug, src_data)

    # Union aliases from source into target (target supports aliases for the alias-aware kinds).
    aliases_added: list[str] = []
    if target_kind in _KINDS_WITH_ALIASES:
        existing = list(tgt_data.get("aliases") or [])
        existing_set = set(existing)
        for a in src_data.get("aliases") or []:
            if a and a not in existing_set:
                existing.append(a)
                existing_set.add(a)
                aliases_added.append(a)
        # Add the source slug itself so old refs to <source_kind>/<source_slug> still resolve
        # if the validator's alias index spans kinds (it does for topics/mechanisms/symptoms).
        if source_slug not in existing_set:
            existing.append(source_slug)
            aliases_added.append(source_slug)
        tgt_data["aliases"] = existing

    # Union source citations (best-effort dedup by id)
    if isinstance(src_data.get("sources"), list):
        existing_src = list(tgt_data.get("sources") or [])
        seen_ids = {(s.get("id") if isinstance(s, dict) else None) for s in existing_src}
        for s in src_data["sources"]:
            sid = s.get("id") if isinstance(s, dict) else None
            if sid and sid not in seen_ids:
                existing_src.append(s)
                seen_ids.add(sid)
        if existing_src:
            tgt_data["sources"] = existing_src

    if not dry_run:
        _save_yaml(tgt_path, tgt_data)
        if src_path.exists():
            src_path.unlink()

    return {
        "ok": True,
        "summary": {
            "action": "move",
            "source": f"{source_kind}/{source_slug}",
            "target": f"{target_kind}/{source_slug}",
            "aliases_added": aliases_added,
            "files_deleted": [str(src_path)] if not dry_run else [],
            "warnings": [],
        },
    }


def _do_merge(root: Path, source_kind: str, source_slug: str,
              merge_into_kind: str, merge_into_slug: str, dry_run: bool) -> dict:
    """Merge source entity into an existing canonical entity. The source slug + its aliases
    become aliases on the canonical, then the source YAML is deleted."""
    src_path = root / source_kind / f"{source_slug}.yaml"
    src_data = _load_yaml(src_path)
    if src_data is None:
        return {"ok": False, "error": f"source not found: {source_kind}/{source_slug}"}

    if merge_into_kind not in _KIND_DIRS:
        return {"ok": False, "error": f"unknown merge_into_kind: {merge_into_kind}"}
    if merge_into_kind not in _KINDS_WITH_ALIASES:
        return {"ok": False, "error": f"{merge_into_kind} does not support aliases — cannot merge into"}
    if not merge_into_slug:
        return {"ok": False, "error": "merge_into_slug is required"}
    if merge_into_kind == source_kind and merge_into_slug == source_slug:
        return {"ok": False, "error": "cannot merge an entity into itself"}

    tgt_path = root / merge_into_kind / f"{merge_into_slug}.yaml"
    tgt_data = _load_yaml(tgt_path)
    if tgt_data is None:
        return {"ok": False, "error": f"merge target not found: {merge_into_kind}/{merge_into_slug}"}

    existing = list(tgt_data.get("aliases") or [])
    existing_set = set(existing)
    aliases_added: list[str] = []

    if source_slug not in existing_set:
        existing.append(source_slug)
        existing_set.add(source_slug)
        aliases_added.append(source_slug)

    for a in src_data.get("aliases") or []:
        if a and a not in existing_set:
            existing.append(a)
            existing_set.add(a)
            aliases_added.append(a)

    tgt_data["aliases"] = existing

    # Union source citations
    if isinstance(src_data.get("sources"), list):
        existing_src = list(tgt_data.get("sources") or [])
        seen_ids = {(s.get("id") if isinstance(s, dict) else None) for s in existing_src}
        for s in src_data["sources"]:
            sid = s.get("id") if isinstance(s, dict) else None
            if sid and sid not in seen_ids:
                existing_src.append(s)
                seen_ids.add(sid)
        if existing_src:
            tgt_data["sources"] = existing_src

    if not dry_run:
        _save_yaml(tgt_path, tgt_data)
        if src_path.exists():
            src_path.unlink()

    return {
        "ok": True,
        "summary": {
            "action": "merge",
            "source": f"{source_kind}/{source_slug}",
            "target": f"{merge_into_kind}/{merge_into_slug}",
            "aliases_added": aliases_added,
            "files_deleted": [str(src_path)] if not dry_run else [],
            "warnings": [],
        },
    }


def _do_delete(root: Path, source_kind: str, source_slug: str, dry_run: bool) -> dict:
    """Hard-delete the source YAML. Existing cross-references become non-blocking warnings."""
    src_path = root / source_kind / f"{source_slug}.yaml"
    if not src_path.exists():
        return {"ok": False, "error": f"source not found: {source_kind}/{source_slug}"}

    if not dry_run:
        src_path.unlink()

    return {
        "ok": True,
        "summary": {
            "action": "delete",
            "source": f"{source_kind}/{source_slug}",
            "target": None,
            "aliases_added": [],
            "files_deleted": [str(src_path)] if not dry_run else [],
            "warnings": [
                "References elsewhere in the catalogue (if any) become unresolved warnings, "
                "not errors. Use the catalogue chat or the Reclassify panel to clean them up."
            ],
        },
    }


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        return _emit({"ok": False, "error": f"invalid JSON on stdin: {e}"})

    action = (payload.get("action") or "").strip()
    source_kind = (payload.get("source_kind") or "").strip()
    source_slug = (payload.get("source_slug") or "").strip()
    dry_run = bool(payload.get("dry_run", False))

    if not source_kind or not source_slug:
        return _emit({"ok": False, "error": "source_kind and source_slug are required"})
    if source_kind not in _KIND_DIRS:
        return _emit({"ok": False, "error": f"unknown source kind: {source_kind}"})

    root = _catalogue_root()

    if action == "move":
        target_kind = (payload.get("target_kind") or "").strip()
        if not target_kind:
            return _emit({"ok": False, "error": "target_kind is required for action=move"})
        result = _do_move(
            root, source_kind, source_slug,
            target_kind, bool(payload.get("create_stub", False)), dry_run,
        )
    elif action == "merge":
        merge_into_kind = (payload.get("merge_into_kind") or "").strip()
        merge_into_slug = (payload.get("merge_into_slug") or "").strip()
        if not merge_into_kind or not merge_into_slug:
            return _emit({"ok": False, "error": "merge_into_kind and merge_into_slug are required for action=merge"})
        result = _do_merge(root, source_kind, source_slug, merge_into_kind, merge_into_slug, dry_run)
    elif action == "delete":
        result = _do_delete(root, source_kind, source_slug, dry_run)
    else:
        return _emit({"ok": False, "error": f"unknown action: {action!r} (expected move|merge|delete)"})

    return _emit(result)


if __name__ == "__main__":
    sys.exit(main())
