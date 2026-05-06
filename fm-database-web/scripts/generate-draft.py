#!/usr/bin/env python3
"""Generate a draft Plan YAML from a Session's AI suggestions + coach picks.

Reads JSON from stdin:
{
  "client_id": str,
  "session_id": str,
  "picks": { "<key>": bool, ... }    # checkbox state from the UI
}

Writes JSON to stdout:
{ "ok": bool, "slug": str | null, "path": str | null, "error": str | null }
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
sys.path.insert(0, str(FMDB_ROOT))


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id = payload.get("client_id") or ""
    session_id = payload.get("session_id") or ""
    picks: dict = payload.get("picks") or {}
    if not client_id or not session_id:
        json.dump({"ok": False, "error": "client_id and session_id are required"}, sys.stdout)
        return 2

    from fmdb.plan import storage as plan_storage
    from fmdb.plan.models import (
        Plan, HypothesizedDriver, PracticeItem, NutritionPlan, EducationModule,
        SupplementItem, LabOrderItem, ReferralItem, CatalogueSnapshot,
    )

    root = plan_storage.plans_root()
    try:
        client = plan_storage.load_client(root, client_id)
    except FileNotFoundError as e:
        json.dump({"ok": False, "error": f"client not found: {e}"}, sys.stdout)
        return 2
    try:
        sess = plan_storage.load_session(root, client_id, session_id)
    except FileNotFoundError as e:
        json.dump({"ok": False, "error": f"session not found: {e}"}, sys.stdout)
        return 2

    suggestions = sess.ai_analysis or {}
    free_text_notes = sess.presenting_complaints or ""

    now = datetime.now(timezone.utc)
    today = date.today()
    base_slug = f"{client.client_id}-{today.isoformat()}-assess"
    slug = base_slug
    n = 1
    while True:
        try:
            plan_storage.find_plan_path(root, slug)
            n += 1
            slug = f"{base_slug}-{n}"
        except FileNotFoundError:
            break

    plan = Plan(
        slug=slug,
        client_id=client.client_id,
        plan_period_start=today,
        plan_period_weeks=8,
        plan_period_recheck_date=today + timedelta(weeks=8),
        catalogue_snapshot=CatalogueSnapshot(snapshot_date=today),
        created_at=now,
        updated_at=now,
        updated_by="shivani",
    )

    for d in suggestions.get("likely_drivers", []) or []:
        if picks.get(f"driver_{d.get('mechanism_slug')}", True):
            plan.hypothesized_drivers.append(HypothesizedDriver(
                mechanism=d.get("mechanism_slug", ""),
                reasoning=d.get("reasoning", ""),
            ))

    for t in suggestions.get("topics_in_play", []) or []:
        role = t.get("role", "primary")
        slug_t = t.get("topic_slug", "")
        if not slug_t:
            continue
        if picks.get(f"topic_{slug_t}_{role}", True):
            if role == "contributing":
                plan.contributing_topics.append(slug_t)
            else:
                plan.primary_topics.append(slug_t)

    for i, ls in enumerate(suggestions.get("lifestyle_suggestions", []) or []):
        if picks.get(f"lifestyle_{i}_{ls.get('name', '')}", True):
            plan.lifestyle_practices.append(PracticeItem(
                name=ls.get("name", ""),
                cadence=ls.get("cadence", "daily"),
                details=ls.get("details", ""),
            ))

    nut = suggestions.get("nutrition_suggestions") or {}
    if nut and picks.get("nutrition_block", True):
        plan.nutrition = NutritionPlan(
            pattern=nut.get("pattern", ""),
            add=nut.get("add", []) or [],
            reduce=nut.get("reduce", []) or [],
            meal_timing=nut.get("meal_timing", ""),
            cooking_adjustments=nut.get("cooking_adjustment_slugs", []) or [],
            home_remedies=nut.get("home_remedy_slugs", []) or [],
        )

    for sp in suggestions.get("supplement_suggestions", []) or []:
        slug_s = sp.get("supplement_slug", "")
        if not slug_s:
            continue
        if picks.get(f"supp_{slug_s}", True):
            plan.supplement_protocol.append(SupplementItem(
                supplement_slug=slug_s,
                form=sp.get("form", "") or "",
                dose=sp.get("dose", "") or "",
                timing=sp.get("timing", "") or "",
                duration_weeks=sp.get("duration_weeks"),
                coach_rationale=(sp.get("rationale", "") or "") + (
                    f"\n\n[evidence-tier note] {sp['evidence_tier_caveat']}"
                    if sp.get("evidence_tier_caveat") else ""
                ),
            ))

    for i, lf in enumerate(suggestions.get("lab_followups", []) or []):
        if picks.get(f"lab_{i}_{lf.get('test', '')}", True):
            plan.lab_orders.append(LabOrderItem(
                test=lf.get("test", ""),
                reason=lf.get("reason", ""),
            ))

    for i, r in enumerate(suggestions.get("referral_triggers", []) or []):
        if picks.get(f"ref_{i}", True):
            plan.referrals.append(ReferralItem(
                to=r.get("to", ""),
                reason=r.get("reason", ""),
                urgency=r.get("urgency", "routine"),
            ))

    for i, ed in enumerate(suggestions.get("education_framings", []) or []):
        if picks.get(f"edu_{i}_{ed.get('target_slug', '')}", True):
            plan.education.append(EducationModule(
                target_kind=ed.get("target_kind", "topic"),
                target_slug=ed.get("target_slug", ""),
                client_facing_summary=ed.get("client_facing_summary", ""),
            ))

    if suggestions.get("synthesis_notes") or free_text_notes:
        plan.notes_for_coach = (
            (f"Free-text intake: {free_text_notes}\n\n" if free_text_notes else "")
            + (f"AI synthesis notes: {suggestions['synthesis_notes']}"
               if suggestions.get("synthesis_notes") else "")
        )

    path = plan_storage.write_plan(root, plan)

    # Mirror Streamlit: stamp the session with the generated plan slug.
    sess.generated_plan_slug = slug
    plan_storage.update_session(root, sess)

    json.dump({"ok": True, "slug": slug, "path": str(path), "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
