"""Catalogue Additions Backlog.

When the AI suggests something useful that isn't in the catalogue yet
(or the coach manually flags an addition during plan authoring), capture
it here. Lives at `data/_backlog.yaml` (gitignored). Items can be
reviewed and either promoted to actual catalogue entries (via the
ingest pipeline or hand-authoring) or rejected.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml


_BACKLOG_PATH_NAME = "_backlog.yaml"


def _backlog_path(data_dir: Path) -> Path:
    return data_dir / _BACKLOG_PATH_NAME


def _load(data_dir: Path) -> list[dict[str, Any]]:
    p = _backlog_path(data_dir)
    if not p.exists():
        return []
    raw = yaml.safe_load(p.read_text()) or []
    return raw if isinstance(raw, list) else []


def _save(data_dir: Path, items: list[dict[str, Any]]) -> None:
    p = _backlog_path(data_dir)
    p.write_text(yaml.safe_dump(items, sort_keys=False, allow_unicode=True))


def add(
    data_dir: Path,
    *,
    kind: str,                          # topic | mechanism | symptom | supplement | claim | cooking_adjustment | home_remedy
    name: str,
    why: str = "",
    suggested_by: str = "",             # "ai" | coach name
    source_session_id: Optional[str] = None,
    source_client_id: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Append a new backlog item. Deduplicates by (kind, name) — if a
    matching open item exists, just adds a reference to this session."""
    items = _load(data_dir)
    now = datetime.now(timezone.utc).isoformat()

    # Check for existing open item with same kind + name
    for it in items:
        if (it.get("status") == "open"
                and it.get("kind") == kind
                and it.get("name", "").lower() == name.lower()):
            # add a reference to this session
            refs = it.setdefault("session_refs", [])
            if source_session_id:
                refs.append({"session_id": source_session_id, "client_id": source_client_id, "at": now})
            it["last_seen_at"] = now
            it["seen_count"] = int(it.get("seen_count", 1)) + 1
            _save(data_dir, items)
            return it

    new_item = {
        "id": uuid.uuid4().hex[:10],
        "kind": kind,
        "name": name,
        "why": why,
        "status": "open",                  # open | added | rejected
        "suggested_by": suggested_by or "ai",
        "created_at": now,
        "last_seen_at": now,
        "seen_count": 1,
        "session_refs": (
            [{"session_id": source_session_id, "client_id": source_client_id, "at": now}]
            if source_session_id else []
        ),
    }
    if extra:
        new_item["extra"] = extra
    items.append(new_item)
    _save(data_dir, items)
    return new_item


def list_items(data_dir: Path, status: Optional[str] = None) -> list[dict[str, Any]]:
    items = _load(data_dir)
    if status:
        items = [it for it in items if it.get("status") == status]
    return sorted(items, key=lambda x: x.get("seen_count", 0), reverse=True)


def update_status(data_dir: Path, item_id: str, status: str, note: str = "") -> Optional[dict[str, Any]]:
    """Mark a backlog item as `added` (promoted to catalogue) or `rejected`."""
    items = _load(data_dir)
    for it in items:
        if it.get("id") == item_id:
            it["status"] = status
            it["status_changed_at"] = datetime.now(timezone.utc).isoformat()
            if note:
                it["status_note"] = note
            _save(data_dir, items)
            return it
    return None


def delete(data_dir: Path, item_id: str) -> bool:
    items = _load(data_dir)
    new_items = [it for it in items if it.get("id") != item_id]
    if len(new_items) != len(items):
        _save(data_dir, new_items)
        return True
    return False
