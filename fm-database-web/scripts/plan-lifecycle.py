#!/usr/bin/env python3
"""Thin shim wrapping fmdb.plan.transitions for the Next.js UI.

Reads JSON from stdin:
{
  "action": "submit" | "publish" | "revoke" | "supersede" | "diff",
  "slug": str,                # plan slug (for submit/publish/revoke; new slug for supersede; slug A for diff)
  "by": str,                  # actor (defaults to FMDB_USER or "coach")
  "reason": str,              # optional except revoke (required)
  "slug_b": str,              # for diff only — second slug
  "dry_run": bool             # if true, return synthetic ok response
}

Writes JSON to stdout:
{
  "ok": bool,
  "error": str | null,
  "plan": {...} | null,        # plan model_dump for submit/publish/revoke/supersede
  "written_path": str | null,  # for publish + supersede
  "git_sha": str | null,       # for publish
  "diff": str | null           # for diff
}

RuntimeError + ValueError from the Python layer are caught and surfaced as
{ok:false, error:<msg>} so the UI can render them. Any other exception is
also caught — the shim never crashes silently.
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
        return _emit({"ok": False, "error": f"invalid JSON on stdin: {e}"})

    action = payload.get("action") or ""
    slug = payload.get("slug") or ""
    by = payload.get("by") or os.environ.get("FMDB_USER") or "coach"
    reason = payload.get("reason") or ""
    slug_b = payload.get("slug_b") or ""
    dry_run = bool(payload.get("dry_run"))

    if not action:
        return _emit({"ok": False, "error": "action is required"})
    if not slug:
        return _emit({"ok": False, "error": "slug is required"})

    _load_dotenv()

    if dry_run:
        return _emit({
            "ok": True,
            "error": None,
            "plan": {"slug": slug, "status": "draft", "version": 0},
            "written_path": None,
            "git_sha": None,
            "diff": "--- a\n+++ b\n@@\n[dry-run]\n" if action == "diff" else None,
        })

    from fmdb.plan import transitions as plan_transitions
    from fmdb.plan import storage as plan_storage

    data_dir = FMDB_ROOT / "data"
    root = plan_storage.plans_root()

    try:
        if action == "submit":
            plan, _findings = plan_transitions.submit_plan(
                root, slug, by=by, catalogue_dir=data_dir, reason=reason
            )
            return _emit({
                "ok": True, "error": None,
                "plan": plan.model_dump(mode="json"),
                "written_path": None, "git_sha": None, "diff": None,
            })

        if action == "publish":
            plan, written, sha = plan_transitions.publish_plan(
                root, slug, by=by, catalogue_dir=data_dir, reason=reason
            )
            return _emit({
                "ok": True, "error": None,
                "plan": plan.model_dump(mode="json"),
                "written_path": str(written),
                "git_sha": sha,
                "diff": None,
            })

        if action == "revoke":
            if not reason or not reason.strip():
                return _emit({"ok": False, "error": "revoke requires a non-empty reason"})
            plan, written = plan_transitions.revoke_plan(root, slug, by=by, reason=reason)
            return _emit({
                "ok": True, "error": None,
                "plan": plan.model_dump(mode="json"),
                "written_path": str(written),
                "git_sha": None, "diff": None,
            })

        if action == "supersede":
            new_plan, _old_plan, written = plan_transitions.supersede_plan(
                root, slug, by=by, catalogue_dir=data_dir, reason=reason
            )
            return _emit({
                "ok": True, "error": None,
                "plan": new_plan.model_dump(mode="json"),
                "written_path": str(written),
                "git_sha": None, "diff": None,
            })

        if action == "diff":
            if not slug_b:
                return _emit({"ok": False, "error": "diff requires slug_b"})
            text = plan_transitions.diff_plans(root, slug, slug_b)
            return _emit({
                "ok": True, "error": None,
                "plan": None, "written_path": None, "git_sha": None,
                "diff": text,
            })

        return _emit({"ok": False, "error": f"unknown action: {action!r}"})

    except (RuntimeError, ValueError, FileNotFoundError) as e:
        return _emit({"ok": False, "error": f"{type(e).__name__}: {e}"})
    except Exception as e:  # noqa: BLE001
        return _emit({"ok": False, "error": f"unexpected {type(e).__name__}: {e}"})


if __name__ == "__main__":
    sys.exit(main())
