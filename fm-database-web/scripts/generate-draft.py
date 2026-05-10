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
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
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
    plan_brief: dict = payload.get("plan_brief") or {}
    resolved_template: dict = plan_brief.get("resolved_template") or {}
    if not client_id or not session_id:
        json.dump({"ok": False, "error": "client_id and session_id are required"}, sys.stdout)
        return 2

    from fmdb.plan import storage as plan_storage
    from fmdb.plan.models import (
        Plan, HypothesizedDriver, PracticeItem, NutritionPlan, EducationModule,
        SupplementItem, LabOrderItem, ReferralItem, CatalogueSnapshot, TrackingHabit,
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

    # Build a human-readable slug: e.g. dhanishta-plan-1-2026-05-05-cl-005
    display = (client.display_name or client.client_id or "client").split()[0]
    first_name_slug = re.sub(r"[^a-z0-9]+", "-", display.lower()).strip("-")
    # Count existing plans for this client to derive plan number
    try:
        all_plans = plan_storage.list_plans(root)
        client_plan_count = sum(
            1 for p in all_plans if (p.client_id or "") == client_id
        )
    except Exception:
        client_plan_count = 0
    plan_num = client_plan_count + 1
    base_slug = f"{first_name_slug}-plan-{plan_num}-{today.isoformat()}-{client.client_id}"

    # Dedup: if this exact slug already exists, append -2, -3, …
    slug = base_slug
    n = 1
    while True:
        try:
            plan_storage.find_plan_path(root, slug)
            n += 1
            slug = f"{base_slug}-{n}"
        except FileNotFoundError:
            break

    plan_weeks = int(plan_brief.get("plan_period_weeks") or 8)
    plan = Plan(
        slug=slug,
        client_id=client.client_id,
        plan_period_start=today,
        plan_period_weeks=plan_weeks,
        plan_period_recheck_date=today + timedelta(weeks=plan_weeks),
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

    # ── Attach AI-suggested protocols (radio-selected by coach) ──────────────
    # Picks key format: `protocol_<slug>` is True when the coach selected
    # that protocol via the radio in the SuggestionsView. Drives meal/
    # supplement/exercise/lifestyle letter generation downstream.
    for ps in suggestions.get("suggested_protocols", []) or []:
        slug = ps.get("protocol_slug", "")
        if slug and picks.get(f"protocol_{slug}"):
            if slug not in plan.attached_protocols:
                plan.attached_protocols.append(slug)

    # ── Apply protocol template (merged on top of AI suggestions) ─────────────
    # resolved_template is the full ProtocolTemplate object serialized from TS.
    if resolved_template:
        # Merge primary/contributing topics from template (dedup)
        for t in resolved_template.get("primary_topics", []) or []:
            if t and t not in plan.primary_topics:
                plan.primary_topics.append(t)
        for t in resolved_template.get("contributing_topics", []) or []:
            if t and t not in plan.contributing_topics and t not in plan.primary_topics:
                plan.contributing_topics.append(t)

        # Merge template supplements (add those not already in plan by slug)
        existing_supp_slugs = {s.supplement_slug for s in plan.supplement_protocol}
        for sp in resolved_template.get("supplements", []) or []:
            sl = sp.get("supplement_slug", "")
            if sl and sl not in existing_supp_slugs:
                plan.supplement_protocol.append(SupplementItem(
                    supplement_slug=sl,
                    form="",
                    dose=sp.get("dose_display", "") or "",
                    timing=sp.get("timing", "") or "",
                    coach_rationale=sp.get("coach_rationale", "") or "",
                ))
                existing_supp_slugs.add(sl)

        # Merge nutrition (union of add/reduce lists, set pattern if not already set)
        if not plan.nutrition:
            plan.nutrition = NutritionPlan()
        if resolved_template.get("nutrition_pattern") and not plan.nutrition.pattern:
            plan.nutrition.pattern = resolved_template["nutrition_pattern"]
        for item in resolved_template.get("nutrition_add", []) or []:
            if item and item not in plan.nutrition.add:
                plan.nutrition.add.append(item)
        for item in resolved_template.get("nutrition_reduce", []) or []:
            if item and item not in plan.nutrition.reduce:
                plan.nutrition.reduce.append(item)

        # Merge lifestyle practices (by name, dedup)
        existing_practice_names = {p.name for p in plan.lifestyle_practices}
        for lp in resolved_template.get("lifestyle_practices", []) or []:
            nm = lp.get("name", "")
            if nm and nm not in existing_practice_names:
                plan.lifestyle_practices.append(PracticeItem(
                    name=nm,
                    cadence=lp.get("cadence", "daily"),
                    details=lp.get("details", "") or "",
                ))
                existing_practice_names.add(nm)

        # Merge lab orders (by test name, dedup)
        existing_tests = {lo.test for lo in plan.lab_orders}
        for lo in resolved_template.get("lab_orders", []) or []:
            tst = lo.get("test", "")
            if tst and tst not in existing_tests:
                plan.lab_orders.append(LabOrderItem(
                    test=tst,
                    reason=lo.get("reason", "") or "",
                ))
                existing_tests.add(tst)

        # Merge tracking habits (by name, dedup)
        existing_habit_names = {h.name for h in plan.tracking.habits}
        for th in resolved_template.get("tracking_habits", []) or []:
            nm = th.get("name", "")
            if nm and nm not in existing_habit_names:
                plan.tracking.habits.append(TrackingHabit(
                    name=nm,
                    cadence=th.get("cadence", "daily"),
                ))
                existing_habit_names.add(nm)

        # Merge tracking symptoms (dedup)
        for ts in resolved_template.get("tracking_symptoms", []) or []:
            if ts and ts not in plan.tracking.symptoms_to_monitor:
                plan.tracking.symptoms_to_monitor.append(ts)

    # ── Notes for coach ────────────────────────────────────────────────────────
    notes_parts = []
    if plan_brief.get("root_cause_hypothesis"):
        notes_parts.append(f"🧬 Root cause hypothesis:\n{plan_brief['root_cause_hypothesis']}")
    if plan_brief.get("coaching_notes"):
        notes_parts.append(f"📝 Coaching notes:\n{plan_brief['coaching_notes']}")
    if resolved_template:
        notes_parts.append(
            f"📋 Protocol template applied: {resolved_template.get('display_name', resolved_template.get('id', ''))}"
        )
    if free_text_notes:
        notes_parts.append(f"Free-text intake: {free_text_notes}")
    if suggestions.get("synthesis_notes"):
        notes_parts.append(f"AI synthesis notes: {suggestions['synthesis_notes']}")

    # IFM Timeline insights — group AI-classified events by ATM bucket
    ifm_timeline = suggestions.get("ifm_timeline", []) or []
    if ifm_timeline:
        atm_buckets: dict[str, list[str]] = {
            "antecedent": [], "trigger": [], "mediator": [], "resolution": [],
        }
        for ev in ifm_timeline:
            atm = (ev.get("atm") or "").lower()
            if atm not in atm_buckets:
                continue
            year = ev.get("year")
            age = ev.get("age_at_event")
            label_parts = []
            if year is not None:
                label_parts.append(str(year))
            if age is not None:
                label_parts.append(f"age {age}")
            prefix = f"[{' · '.join(label_parts)}] " if label_parts else ""
            line = f"- {prefix}{ev.get('event', '')}"
            drivers = ev.get("linked_driver_slugs") or []
            if drivers:
                line += f"  → {', '.join(drivers)}"
            atm_buckets[atm].append(line)

        timeline_section = ["📅 IFM Timeline (AI-classified):"]
        for label, key in [
            ("Antecedents (predisposing)", "antecedent"),
            ("Triggers (initiated)", "trigger"),
            ("Mediators (perpetuating)", "mediator"),
            ("Resolution / what helped", "resolution"),
        ]:
            if atm_buckets[key]:
                timeline_section.append(f"\n{label}:")
                timeline_section.extend(atm_buckets[key])
        if len(timeline_section) > 1:
            notes_parts.append("\n".join(timeline_section))

    if notes_parts:
        plan.notes_for_coach = "\n\n".join(notes_parts)

    path = plan_storage.write_plan(root, plan)

    # Mirror Streamlit: stamp the session with the generated plan slug.
    sess.generated_plan_slug = slug
    plan_storage.update_session(root, sess)

    json.dump({"ok": True, "slug": slug, "path": str(path), "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
