"""Stage extracted candidates as YAML under data/staging/<batch_id>/.

Staging files are real, validated YAML in the same shape as canonical
data/ files — so the existing loaders and validator work on them without
modification, and reviewers can `cat` them to read.

Each batch carries a _meta.json with provenance: source id, model, doc
hash, timestamp.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ValidationError

from ..models import Claim, Mechanism, Source, Supplement, Symptom, Topic
from .types import ENTITY_TYPES, EntityType, ExtractionResult, IngestRequest


_MODEL_BY_ENTITY: dict[EntityType, type[BaseModel]] = {
    "supplements": Supplement,
    "topics": Topic,
    "mechanisms": Mechanism,
    "symptoms": Symptom,
    "claims": Claim,
    "sources": Source,
}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _doc_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def make_batch_id(req: IngestRequest, doc_text: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    return f"{ts}-{req.source_id}-{_doc_hash(doc_text)}"


def _make_source_yaml(req: IngestRequest, updated_by: str) -> dict[str, Any]:
    """Build a Source candidate from the IngestRequest's metadata."""
    out: dict[str, Any] = {
        "id": req.source_id,
        "title": req.source_title,
        "source_type": req.source_type,
        "quality": req.source_quality,
        "version": 1,
        "status": "active",
        "updated_at": _today().isoformat(),
        "updated_by": updated_by,
    }
    out.update(req.source_extra)  # url, doi, internal_path, authors, year, etc.
    return out


def _enrich_supplement(c: dict[str, Any], source_id: str, updated_by: str) -> dict[str, Any]:
    """Promote extractor-emitted fields into canonical YAML shape."""
    out = dict(c)
    out.setdefault("forms_available", [])
    out.setdefault("typical_dose_range", {})
    out.setdefault("timing_options", [])
    out.setdefault("take_with_food", "optional")
    out.setdefault("linked_to_topics", [])
    out.setdefault("linked_to_mechanisms", [])
    out.setdefault("linked_to_claims", [])
    out.setdefault("notes_for_coach", "")
    out.setdefault("notes_for_client", "")
    quote = out.pop("source_quote", None)
    location = out.pop("source_location", None)
    citation: dict[str, Any] = {"id": source_id}
    if location:
        citation["location"] = location
    if quote:
        citation["quote"] = quote
    out["sources"] = [citation]
    out.setdefault("version", 1)
    out.setdefault("status", "active")
    out["updated_at"] = _today().isoformat()
    out["updated_by"] = updated_by
    return out


def _enrich_topic(c: dict[str, Any], source_id: str, updated_by: str) -> dict[str, Any]:
    out = dict(c)
    for key in ("aliases", "common_symptoms", "red_flags", "related_topics", "key_mechanisms"):
        out.setdefault(key, [])
    out.setdefault("coaching_scope_notes", "")
    out.setdefault("clinician_scope_notes", "")
    quote = out.pop("source_quote", None)
    location = out.pop("source_location", None)
    citation: dict[str, Any] = {"id": source_id}
    if location:
        citation["location"] = location
    if quote:
        citation["quote"] = quote
    out["sources"] = [citation]
    out.setdefault("version", 1)
    out.setdefault("status", "active")
    out["updated_at"] = _today().isoformat()
    out["updated_by"] = updated_by
    return out


def _enrich_claim(c: dict[str, Any], source_id: str, updated_by: str) -> dict[str, Any]:
    out = dict(c)
    out.setdefault("coaching_translation", "")
    out.setdefault("out_of_scope_notes", "")
    for key in ("caveats", "linked_to_topics", "linked_to_mechanisms", "linked_to_supplements"):
        out.setdefault(key, [])
    quote = out.pop("source_quote", None)
    location = out.pop("source_location", None)
    citation: dict[str, Any] = {"id": source_id}
    if location:
        citation["location"] = location
    if quote:
        citation["quote"] = quote
    out["sources"] = [citation]
    out.setdefault("version", 1)
    out.setdefault("status", "active")
    out["updated_at"] = _today().isoformat()
    out["updated_by"] = updated_by
    return out


def _enrich_symptom(c: dict[str, Any], source_id: str, updated_by: str) -> dict[str, Any]:
    out = dict(c)
    for key in ("aliases", "linked_to_topics", "linked_to_mechanisms"):
        out.setdefault(key, [])
    out.setdefault("severity", "common")
    out.setdefault("when_to_refer", "")
    quote = out.pop("source_quote", None)
    location = out.pop("source_location", None)
    citation: dict[str, Any] = {"id": source_id}
    if location:
        citation["location"] = location
    if quote:
        citation["quote"] = quote
    out["sources"] = [citation]
    out.setdefault("version", 1)
    out.setdefault("status", "active")
    out["updated_at"] = _today().isoformat()
    out["updated_by"] = updated_by
    return out


def _enrich_mechanism(c: dict[str, Any], source_id: str, updated_by: str) -> dict[str, Any]:
    out = dict(c)
    for key in ("aliases", "upstream_drivers", "downstream_effects",
                "related_mechanisms", "linked_to_topics"):
        out.setdefault(key, [])
    quote = out.pop("source_quote", None)
    location = out.pop("source_location", None)
    citation: dict[str, Any] = {"id": source_id}
    if location:
        citation["location"] = location
    if quote:
        citation["quote"] = quote
    out["sources"] = [citation]
    out.setdefault("version", 1)
    out.setdefault("status", "active")
    out["updated_at"] = _today().isoformat()
    out["updated_by"] = updated_by
    return out


_ENRICHERS = {
    "supplements": _enrich_supplement,
    "topics": _enrich_topic,
    "mechanisms": _enrich_mechanism,
    "symptoms": _enrich_symptom,
    "claims": _enrich_claim,
}


def _slug_field(entity: EntityType) -> str:
    return "id" if entity == "sources" else "slug"


def _canonical_exists(data_dir: Path, entity: EntityType, slug: str) -> bool:
    return (data_dir / entity / f"{slug}.yaml").exists()


def stage(
    req: IngestRequest,
    result: ExtractionResult,
    *,
    data_dir: Path,
    batch_id: str,
    updated_by: str,
    doc_text: str,
) -> dict[str, Any]:
    """Write a batch under data/staging/<batch_id>/.

    Returns a manifest dict (also persisted as _meta.json) summarizing what
    was staged, what failed validation, and what conflicts with canonical.
    """
    batch_dir = data_dir / "staging" / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] = {
        "batch_id": batch_id,
        "source_id": req.source_id,
        "source_title": req.source_title,
        "source_type": req.source_type,
        "doc_hash": _doc_hash(doc_text),
        "doc_chars": len(doc_text),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": updated_by,
        "usage": result.usage,
        "entries": [],  # one per file written or skipped
    }

    # Source first — auto-registered from the IngestRequest metadata.
    src_payload = _make_source_yaml(req, updated_by)
    _write_or_record(
        batch_dir, data_dir, "sources", src_payload, manifest, slug_field="id"
    )

    # Then topics / mechanisms / claims / supplements from the extractor.
    # Order matters: topics + mechanisms first so that claims/supplements that
    # link to them resolve cleanly when the validator simulates the post-state.
    by_type = result.by_type()
    for entity in ("topics", "mechanisms", "symptoms", "claims", "supplements"):
        for raw in by_type.get(entity, []):
            slug = raw.get("slug")
            if not slug:
                manifest["entries"].append({
                    "entity": entity, "slug": None, "status": "rejected",
                    "reason": "missing slug",
                })
                continue
            payload = _ENRICHERS[entity](raw, req.source_id, updated_by)
            _write_or_record(
                batch_dir, data_dir, entity, payload, manifest, slug_field="slug"
            )

    (batch_dir / "_meta.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def _write_or_record(
    batch_dir: Path,
    data_dir: Path,
    entity: EntityType,
    payload: dict[str, Any],
    manifest: dict[str, Any],
    *,
    slug_field: str,
) -> None:
    slug = payload[slug_field]
    model = _MODEL_BY_ENTITY[entity]
    try:
        model(**payload)
    except ValidationError as e:
        manifest["entries"].append({
            "entity": entity, "slug": slug, "status": "rejected",
            "reason": f"pydantic validation failed: {e.error_count()} errors",
            "errors": str(e),
        })
        return

    target_dir = batch_dir / entity
    target_dir.mkdir(parents=True, exist_ok=True)
    out_path = target_dir / f"{slug}.yaml"
    out_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True))

    status = "conflict" if _canonical_exists(data_dir, entity, slug) else "new"
    manifest["entries"].append({
        "entity": entity, "slug": slug, "status": status,
        "path": str(out_path.relative_to(data_dir)),
    })


def list_batches(data_dir: Path) -> list[dict[str, Any]]:
    staging = data_dir / "staging"
    if not staging.exists():
        return []
    out = []
    for batch_dir in sorted(staging.iterdir()):
        meta = batch_dir / "_meta.json"
        if not meta.exists():
            continue
        out.append(json.loads(meta.read_text()))
    return out


def load_batch(data_dir: Path, batch_id: str) -> dict[str, Any]:
    meta = data_dir / "staging" / batch_id / "_meta.json"
    if not meta.exists():
        raise FileNotFoundError(f"batch not found: {batch_id}")
    return json.loads(meta.read_text())


def _smart_merge(canonical: dict, staged: dict, *, slug_field: str) -> dict:
    """Conservative merge for --update.

    - Lists: union, deduplicating (preserving canonical order, then appending new).
      Citation-style lists (sources, interactions) are deduped by their primary key
      (`id`/`slug`/`food_slug`/`medication`).
    - Dicts (typical_dose_range): canonical wins per-key unless staged has a non-empty value.
    - Scalars: prefer staged when non-empty/truthy; else keep canonical.
    - Lifecycle: version = canonical.version + 1; updated_at/updated_by from staged.

    The result is always a SUPERSET of canonical fields — nothing is silently dropped.
    """
    out = dict(canonical)

    # primary keys for citation-style list-of-dicts elements
    list_keys = {
        "sources": "id",
        "with_supplements": "slug",
        "with_foods": "food_slug",
        "with_medications": "medication",
    }

    def _merge_list(c_list, s_list, dedup_key=None):
        seen = set()
        merged = []
        for item in (c_list or []) + (s_list or []):
            if dedup_key and isinstance(item, dict):
                k = item.get(dedup_key)
            else:
                k = repr(item) if isinstance(item, (dict, list)) else item
            if k in seen:
                continue
            seen.add(k)
            merged.append(item)
        return merged

    for k, s_val in staged.items():
        if k in (slug_field, "version", "updated_at", "updated_by"):
            continue  # handled below

        c_val = out.get(k)

        if isinstance(c_val, list) or isinstance(s_val, list):
            dedup = list_keys.get(k)
            out[k] = _merge_list(c_val or [], s_val or [], dedup_key=dedup)
        elif isinstance(c_val, dict) and isinstance(s_val, dict):
            # Recursive shallow merge of dict-of-dicts (e.g. typical_dose_range).
            merged: dict = dict(c_val)
            for sk, sv in s_val.items():
                merged[sk] = sv if sv else merged.get(sk, sv)
            out[k] = merged
        else:
            # Scalar: take staged if it's non-empty / truthy, else keep canonical.
            if s_val not in (None, "", [], {}):
                out[k] = s_val

    # interactions is nested
    if isinstance(canonical.get("interactions"), dict) and isinstance(staged.get("interactions"), dict):
        merged_int: dict = {}
        for sub in ("with_supplements", "with_foods", "with_medications"):
            merged_int[sub] = _merge_list(
                canonical["interactions"].get(sub, []),
                staged["interactions"].get(sub, []),
                dedup_key=list_keys.get(sub),
            )
        out["interactions"] = merged_int

    # Lifecycle fields
    out["version"] = int(canonical.get("version", 1)) + 1
    out["updated_at"] = staged.get("updated_at", canonical.get("updated_at"))
    out["updated_by"] = staged.get("updated_by", canonical.get("updated_by"))
    return out


def approve(
    data_dir: Path,
    batch_id: str,
    *,
    only: tuple[str, str] | None = None,
    update: bool = False,
    overwrite: bool = False,
) -> tuple[list[str], list[str], list]:
    """Promote staged file(s) to canonical data/ — ATOMICALLY.

    Pre-flight: read current canonical, parse the about-to-promote files,
    overlay them in memory, run the validator. If the simulated post-state
    has any errors, abort without touching disk. Warnings are non-blocking.

    only=(entity, slug) restricts approval to a single file.
    update=True allows overwriting an existing canonical file (and bumps version).

    Returns (promoted_paths, errors, warnings).
    """
    from ..validator import load_all, overlay, validate_loaded

    manifest = load_batch(data_dir, batch_id)
    batch_dir = data_dir / "staging" / batch_id

    # ---- Pass 1: collect candidate (src, dst, payload, parsed_model) tuples
    # without touching disk. Detect "would-conflict-without-update" up front.
    plan: list[dict] = []
    abort_errors: list[str] = []

    for entry in manifest["entries"]:
        if entry["status"] == "rejected":
            continue
        entity, slug = entry["entity"], entry["slug"]
        if only and only != (entity, slug):
            continue
        src = batch_dir / entity / f"{slug}.yaml"
        if not src.exists():
            abort_errors.append(f"{entity}/{slug}: staged file missing")
            continue
        dst_dir = data_dir / entity
        dst = dst_dir / f"{slug}.yaml"
        if dst.exists() and not (update or overwrite):
            abort_errors.append(
                f"{entity}/{slug}: canonical already exists; pass --update (smart-merge) "
                f"or --overwrite (replace)"
            )
            continue

        payload = yaml.safe_load(src.read_text())
        if dst.exists() and not overwrite:
            # --update: smart-merge with canonical (default safe behavior)
            existing = yaml.safe_load(dst.read_text())
            slug_field = _slug_field(entity)
            payload = _smart_merge(existing, payload, slug_field=slug_field)
        elif dst.exists() and overwrite:
            # --overwrite: replace canonical, but at least bump version
            existing = yaml.safe_load(dst.read_text())
            payload["version"] = int(existing.get("version", 1)) + 1

        try:
            model = _MODEL_BY_ENTITY[entity]
            parsed = model(**payload)
        except Exception as e:
            abort_errors.append(f"{entity}/{slug}: would fail Pydantic on promote: {e}")
            continue

        plan.append({
            "entity": entity, "slug": slug,
            "src": src, "dst": dst, "dst_dir": dst_dir,
            "payload": payload, "parsed": parsed,
        })

    if abort_errors:
        return [], abort_errors, []

    # ---- Pass 2: build simulated post-state and validate
    loaded = load_all(data_dir)
    overlay_kwargs: dict[str, list] = {
        "sources": [], "topics": [], "mechanisms": [], "symptoms": [], "claims": [], "supplements": [],
    }
    for item in plan:
        overlay_kwargs[item["entity"]].append(item["parsed"])
    simulated = overlay(loaded, **overlay_kwargs)
    errors, warnings = validate_loaded(simulated)

    if errors:
        # Don't touch disk. Surface what would have broken.
        return [], [
            "approval aborted: post-state would have errors",
            *(f"  - {e}" for e in errors),
        ], warnings

    # ---- Pass 3: commit. All-or-nothing — if a write fails we revert prior moves.
    promoted: list[str] = []
    backups: list[tuple[Path, str | None]] = []  # (dst, original_text or None)
    try:
        for item in plan:
            item["dst_dir"].mkdir(parents=True, exist_ok=True)
            backups.append((
                item["dst"],
                item["dst"].read_text() if item["dst"].exists() else None,
            ))
            item["dst"].write_text(
                yaml.safe_dump(item["payload"], sort_keys=False, allow_unicode=True)
            )
        # Only delete sources if all writes succeeded.
        for item in plan:
            item["src"].unlink()
            promoted.append(str(item["dst"].relative_to(data_dir)))
    except Exception as commit_err:
        # Roll back any writes we did.
        for dst, original in backups:
            if original is None:
                dst.unlink(missing_ok=True)
            else:
                dst.write_text(original)
        return [], [f"commit failed mid-flight, rolled back: {commit_err}"], warnings

    return promoted, [], warnings


def reject(
    data_dir: Path,
    batch_id: str,
    *,
    only: tuple[str, str] | None = None,
) -> list[str]:
    """Delete staged file(s)."""
    manifest = load_batch(data_dir, batch_id)
    batch_dir = data_dir / "staging" / batch_id
    removed: list[str] = []
    for entry in manifest["entries"]:
        if entry["status"] == "rejected":
            continue
        entity, slug = entry["entity"], entry["slug"]
        if only and only != (entity, slug):
            continue
        f = batch_dir / entity / f"{slug}.yaml"
        if f.exists():
            f.unlink()
            removed.append(f"{entity}/{slug}")
    if not only and not any((batch_dir / e).exists() and any((batch_dir / e).iterdir()) for e in ENTITY_TYPES):
        # whole batch fully cleared — nuke the dir
        for sub in batch_dir.iterdir():
            if sub.is_dir():
                sub.rmdir() if not any(sub.iterdir()) else None
        # leave _meta.json so we have a record; or remove it too:
        (batch_dir / "_meta.json").unlink(missing_ok=True)
        try:
            batch_dir.rmdir()
        except OSError:
            pass
    return removed
