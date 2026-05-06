#!/usr/bin/env python3
"""Thin shim that converts a curated MindMap to Mermaid mindmap source.

Reads JSON from stdin:
{ "slug": str, "dry_run": bool }

Writes JSON to stdout:
{ "ok": bool, "mermaid": str | null, "error": str | null }
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
sys.path.insert(0, str(FMDB_ROOT))


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, default=str)
    return 0 if payload.get("ok") else 1


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        return _emit({"ok": False, "mermaid": None, "error": f"invalid JSON on stdin: {e}"})

    slug = payload.get("slug") or ""
    dry_run = bool(payload.get("dry_run"))
    if not slug:
        return _emit({"ok": False, "mermaid": None, "error": "slug is required"})

    if dry_run:
        return _emit({
            "ok": True,
            "mermaid": "mindmap\n  root((Dry run))\n    Sample child\n",
            "error": None,
        })

    _load_dotenv()

    try:
        from fmdb.loader import load_mindmap
        from fmdb.assess.mindmap import curated_to_mermaid
        mm = load_mindmap(FMDB_ROOT / "data", slug)
        text = curated_to_mermaid(mm)
        return _emit({"ok": True, "mermaid": text, "error": None})
    except FileNotFoundError as e:
        return _emit({"ok": False, "mermaid": None, "error": f"mindmap not found: {slug} ({e})"})
    except Exception as e:  # noqa: BLE001
        return _emit({"ok": False, "mermaid": None, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    sys.exit(main())
