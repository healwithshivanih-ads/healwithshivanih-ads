#!/usr/bin/env python3
"""Save a new Source entity to the catalogue.

Reads JSON from stdin:
{
  "id": str,           # lowercase hyphenated, e.g. "dr-xyz-book-2023"
  "title": str,
  "source_type": str,  # internal_skill | peer_reviewed_paper | textbook |
                       #   clinical_guideline | expert_consensus | book |
                       #   website | llm_synthesis | other
  "quality": str,      # high | moderate | low
  "authors": [str],    # optional
  "year": int | null,  # optional
  "publisher": str,    # optional
  "url": str,          # optional
  "doi": str,          # optional
  "notes": str         # optional
}

Writes JSON to stdout:
{ "ok": bool, "id": str | null, "already_existed": bool, "error": str | null }
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

_real_stdout = sys.stdout
sys.stdout = sys.stderr


def _emit(result: dict) -> int:
    sys.stdout = _real_stdout
    json.dump(result, sys.stdout)
    sys.stdout.flush()
    return 0 if result.get("ok") else 1


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        return _emit({"ok": False, "error": f"invalid JSON: {e}"})

    source_id = (payload.get("id") or "").strip()
    title = (payload.get("title") or "").strip()
    source_type = (payload.get("source_type") or "").strip()
    quality = (payload.get("quality") or "").strip()

    if not source_id:
        return _emit({"ok": False, "error": "id is required"})
    if not title:
        return _emit({"ok": False, "error": "title is required"})
    if not source_type:
        return _emit({"ok": False, "error": "source_type is required"})
    if not quality:
        return _emit({"ok": False, "error": "quality is required"})

    try:
        from fmdb.models import Source
        from fmdb.enums import SourceType, SourceQuality, EntityStatus
    except ImportError as e:
        return _emit({"ok": False, "error": f"fmdb import failed: {e}"})

    data_dir = FMDB_ROOT / "data" / "sources"
    dest = data_dir / f"{source_id}.yaml"

    if dest.exists():
        return _emit({"ok": False, "already_existed": True,
                      "error": f"Source '{source_id}' already exists. Choose a different ID."})

    try:
        st = SourceType(source_type)
    except ValueError:
        return _emit({"ok": False, "error": f"invalid source_type: {source_type!r}"})
    try:
        sq = SourceQuality(quality)
    except ValueError:
        return _emit({"ok": False, "error": f"invalid quality: {quality!r}"})

    authors = [str(a) for a in (payload.get("authors") or [])]
    year = payload.get("year")
    if year is not None:
        try:
            year = int(year)
        except (TypeError, ValueError):
            year = None

    try:
        source = Source(
            id=source_id,
            title=title,
            source_type=st,
            quality=sq,
            authors=authors,
            year=year,
            publisher=payload.get("publisher") or None,
            url=payload.get("url") or None,
            doi=payload.get("doi") or None,
            notes=payload.get("notes") or "",
            updated_at=date.today(),
            updated_by="shivani",
        )
    except Exception as e:
        return _emit({"ok": False, "error": f"validation failed: {e}"})

    try:
        import yaml as _yaml  # type: ignore
        data_dir.mkdir(parents=True, exist_ok=True)
        doc = source.model_dump(mode="json")
        doc["updated_at"] = date.today().isoformat()
        dest.write_text(_yaml.dump(doc, default_flow_style=False, allow_unicode=True, sort_keys=False))
    except Exception as e:
        return _emit({"ok": False, "error": f"write failed: {e}"})

    return _emit({"ok": True, "id": source_id, "already_existed": False, "error": None})


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        _emit({"ok": False, "error": f"unhandled exception: {type(e).__name__}: {e}"})
        sys.exit(1)
