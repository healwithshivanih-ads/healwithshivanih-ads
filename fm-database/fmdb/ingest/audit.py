"""Append-only JSONL audit log for ingest/approve/reject events."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _audit_path(data_dir: Path) -> Path:
    return data_dir / "_audit.jsonl"


def append(data_dir: Path, event: str, **fields: Any) -> None:
    rec = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        **fields,
    }
    path = _audit_path(data_dir)
    with path.open("a") as f:
        f.write(json.dumps(rec) + "\n")


def tail(data_dir: Path, n: int = 20) -> list[dict[str, Any]]:
    path = _audit_path(data_dir)
    if not path.exists():
        return []
    lines = path.read_text().splitlines()[-n:]
    return [json.loads(line) for line in lines if line.strip()]
