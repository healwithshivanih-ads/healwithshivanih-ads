#!/usr/bin/env python3
"""Thin shim wrapping fmdb.plan.checker.check_plan for the Next.js UI.

Reads JSON from stdin:
{ "slug": str }

Writes JSON to stdout:
{
  "ok": bool,
  "slug": str,
  "findings": [
    {"severity": "CRITICAL"|"WARNING"|"INFO",
     "section": str, "field": str, "detail": str, "target": str,
     "ack_id": str}
  ],
  "counts": {"CRITICAL": int, "WARNING": int, "INFO": int},
  "error": str | null
}

Secondary action — pre-flight ONE proposed practice name against the remedies
a plan already assigns, BEFORE it is written:

{ "action": "practice_restates_remedy", "slug": str, "name": str }
  → { "ok": true, "restates": str | null, "remedy_name": str | null }

This exists because quick-edit mutates a PUBLISHED plan in place and never
re-runs check_plan, so without it the everyday "add a practice" path is the
one route that can still prescribe a remedy twice. It calls the same
`practice_restates_remedy` the checker and apply-rework use — matching that
drifted between the three would defeat the point.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON on stdin: {e}"}, sys.stdout)
        return 2

    slug = payload.get("slug") or ""
    if not slug:
        json.dump({"ok": False, "error": "slug is required"}, sys.stdout)
        return 2

    from fmdb.validator import load_all
    from fmdb.plan import storage as plan_storage
    from fmdb.plan.checker import check_plan

    data_dir = FMDB_ROOT / "data"
    cat = load_all(data_dir)
    root = plan_storage.plans_root()

    try:
        plan = plan_storage.load_plan(root, slug)
    except FileNotFoundError as e:
        json.dump({"ok": False, "error": f"plan not found: {slug} ({e})"}, sys.stdout)
        return 2

    if payload.get("action") == "practice_restates_remedy":
        from fmdb.plan.checker import practice_restates_remedy
        from fmdb.validator import _resolve_index

        name = (payload.get("name") or "").strip()
        remedy_slugs = list(plan.nutrition.home_remedies)
        if plan.ayurveda:
            remedy_slugs += list(plan.ayurveda.remedies)

        hr_idx = _resolve_index(cat.home_remedies)
        hr_by_slug = {h.slug: h for h in cat.home_remedies}
        hit, hit_name = None, None
        if name:
            for rslug in remedy_slugs:
                canonical = hr_idx.get(rslug)
                remedy = hr_by_slug.get(canonical) if canonical else None
                if practice_restates_remedy(name, rslug, remedy):
                    hit = rslug
                    hit_name = getattr(remedy, "display_name", None) or rslug
                    break

        json.dump({
            "ok": True, "slug": slug,
            "restates": hit, "remedy_name": hit_name, "error": None,
        }, sys.stdout)
        return 0

    client = None
    if plan.client_id:
        try:
            client = plan_storage.load_client(root, plan.client_id)
        except FileNotFoundError:
            client = None

    findings = check_plan(plan, client, cat)
    counts = {"CRITICAL": 0, "WARNING": 0, "INFO": 0}
    out = []
    for f in findings:
        counts[f.severity] += 1
        out.append({
            "severity": f.severity,
            "section": f.section,
            "field": f.field,
            "detail": f.detail,
            "target": f.target,
            "ack_id": f.ack_id,
        })

    json.dump({
        "ok": True,
        "slug": slug,
        "findings": out,
        "counts": counts,
        "error": None,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
