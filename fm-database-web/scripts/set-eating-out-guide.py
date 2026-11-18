#!/usr/bin/env python3
"""Put a client's eating-out guide on their plan.

The guide is written by the coach (or in chat, at $0) — this script never
calls a model. It checks the guide and writes it:

  - a plan still being written (draft / ready_to_publish): sets `eating_out`.
  - a PUBLISHED plan: sets `eating_out` and appends one line to `amendments`,
    the plan's own log of post-publish changes. Nothing else on the plan is
    touched, so the published baseline stays what it was.

Every guide is held to the bar of a plan being written, whatever the plan's
status: it needs a place with something to choose, weeks that fit the plan,
and no line telling the client to choose a food outside their diet or their
dairy status (fmdb/plan/checker.py `_check_eating_out`). Anything CRITICAL
and nothing is written.

Reads JSON from stdin:
{
  "plan_slug": str,
  "guides": [ { "label": str?, "from_week": int?, "to_week": int?,
                "rules": [str], "situations": [ { "where": str,
                "keywords": [str]?, "choose": [str], "skip": [str]?,
                "note": str? } ], "not_on_list": str? } ],
  "by": str?,          # who wrote it, for the amendment line (default "coach")
  "dry_run": bool?     # check only, write nothing
}

Writes JSON to stdout:
{ "ok": bool, "plan_slug": str, "status": str, "written": bool,
  "amended": bool, "guides": int, "findings": [ {severity, field, detail} ],
  "error": str? }
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))


def _out(payload: dict, code: int = 0) -> int:
    json.dump(payload, sys.stdout)
    return code


def _tidy(guide: dict) -> dict:
    """Drop what was left empty, so the YAML reads as the coach wrote it."""
    out = {k: v for k, v in guide.items() if v not in (None, "", [])}
    out["situations"] = [{k: v for k, v in s.items() if v not in (None, "", [])} for s in guide.get("situations", [])]
    return out


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        return _out({"ok": False, "error": f"invalid JSON: {e}"}, 2)

    slug = (payload.get("plan_slug") or "").strip()
    if not slug or not isinstance(payload.get("guides"), list) or not payload["guides"]:
        return _out({"ok": False, "error": "plan_slug and a non-empty guides list are required"}, 2)

    import yaml  # type: ignore
    from pydantic import ValidationError

    from atomic_write import write_text_atomic
    from fmdb.plan import storage
    from fmdb.plan.checker import Finding, _check_eating_out
    from fmdb.plan.models import EatingOutGuide

    try:
        guides = [EatingOutGuide(**g) for g in payload["guides"]]
    except (ValidationError, TypeError) as e:
        return _out({"ok": False, "plan_slug": slug, "error": f"the guide does not have the right shape: {str(e)[:600]}"})

    root = storage.plans_root()
    try:
        path = storage.find_plan_path(root, slug)
        plan = storage.load_plan(root, slug)
    except Exception as e:  # noqa: BLE001 — a missing or unreadable plan is the answer
        return _out({"ok": False, "plan_slug": slug, "error": f"could not load the plan: {str(e)[:300]}"})

    try:
        client = storage.load_client(root, plan.client_id)
    except Exception:  # noqa: BLE001 — without the client the diet and dairy screens cannot run
        return _out({"ok": False, "plan_slug": slug, "error": f"could not load client {plan.client_id}; the guide cannot be screened against their diet"})

    status = str(getattr(plan.status, "value", plan.status))
    # Screened as a plan being written, so a published plan's guide meets the
    # same bar as a new one.
    probe = plan.model_copy(update={"eating_out": guides, "status": "draft"})
    found: list[Finding] = []
    _check_eating_out(probe, client, found)
    findings = [{"severity": f.severity, "field": f.field, "detail": f.detail} for f in found]
    blocked = any(f.severity == "CRITICAL" for f in found)
    base = {"plan_slug": slug, "status": status, "guides": len(guides), "findings": findings}
    if blocked:
        return _out({"ok": False, "written": False, "amended": False, **base, "error": "the guide has CRITICAL findings; nothing was written"})
    if payload.get("dry_run"):
        return _out({"ok": True, "written": False, "amended": False, **base})

    doc = yaml.safe_load(path.read_text()) or {}
    had = bool(doc.get("eating_out"))
    doc["eating_out"] = [_tidy(g.model_dump()) for g in guides]
    amended = status not in ("draft", "ready_to_publish")
    if amended:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        log = doc.get("amendments") if isinstance(doc.get("amendments"), list) else []
        log.append({
            "at": now,
            "by": (payload.get("by") or "coach").strip() or "coach",
            "field": "eating_out",
            "summary": ("Eating-out guide replaced" if had else "Eating-out guide added"),
        })
        doc["amendments"] = log
        doc["app_content_updated_at"] = now
    write_text_atomic(path, yaml.safe_dump(doc, sort_keys=False, width=100, allow_unicode=True))
    return _out({"ok": True, "written": True, "amended": amended, **base})


if __name__ == "__main__":
    raise SystemExit(main())
