#!/usr/bin/env python3
"""Thin shim wrapping fmdb.plan.render for the Next.js UI.

Reads JSON from stdin:
{ "slug": str, "format": "markdown" | "html" }

Writes JSON to stdout:
{ "ok": bool, "content": str | null, "error": str | null }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
sys.path.insert(0, str(FMDB_ROOT))


def _emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, default=str)
    return 0 if payload.get("ok") else 1


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        return _emit({"ok": False, "error": f"invalid JSON on stdin: {e}"})

    slug = payload.get("slug") or ""
    fmt = (payload.get("format") or "markdown").lower()
    if not slug:
        return _emit({"ok": False, "error": "slug is required"})
    if fmt not in ("markdown", "html"):
        return _emit({"ok": False, "error": f"invalid format: {fmt!r}"})

    from fmdb.validator import load_all
    from fmdb.plan import storage as plan_storage
    from fmdb.plan import render as plan_render
    from fmdb.resources import storage as resources_storage

    data_dir = FMDB_ROOT / "data"
    root = plan_storage.plans_root()

    try:
        plan = plan_storage.load_plan(root, slug)
    except FileNotFoundError as e:
        return _emit({"ok": False, "error": f"plan not found: {slug} ({e})"})

    client = None
    if plan.client_id:
        try:
            client = plan_storage.load_client(root, plan.client_id)
        except FileNotFoundError:
            client = None

    cat = load_all(data_dir)

    attached = []
    if getattr(plan, "attached_resources", None):
        try:
            res_root = resources_storage.resources_root()
            for rs in plan.attached_resources:
                try:
                    attached.append(resources_storage.load_resource(res_root, rs))
                except FileNotFoundError:
                    pass
        except Exception:
            pass

    try:
        if fmt == "html":
            content = plan_render.render_html(plan, client, cat, resources=attached)
        else:
            content = plan_render.render_markdown(plan, client, cat, resources=attached)
    except Exception as e:  # noqa: BLE001
        return _emit({"ok": False, "error": f"render failed: {type(e).__name__}: {e}"})

    return _emit({"ok": True, "error": None, "content": content})


if __name__ == "__main__":
    sys.exit(main())
