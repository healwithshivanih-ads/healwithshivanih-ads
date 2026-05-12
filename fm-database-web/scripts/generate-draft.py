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


def _plans_root() -> Path:
    """Mirror plan_storage.plans_root() so the brand-map loader (which
    runs before we touch plan_storage) can find ~/fm-plans without
    requiring an early import."""
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _load_brand_map(supplements_dir: Path) -> dict[str, str]:
    """Build the AI-slug → preferred-brand-slug remap.

    Two layers:
      1. Coach-editable override at ~/fm-plans/supplement_brand_map.yaml
         (highest precedence). Format: { generic_slug: vitaone_slug }.
      2. Auto-detect from the catalogue: any supplement whose slug starts
         with `vitaone-` is treated as a brand variant; we try to find the
         generic counterpart by stripping the prefix and also by adding
         common qualifier prefixes the AI uses (`vitamin-`, `mineral-`).

    Coach uses VitaOne products with referral code vita13720sh, so
    surfacing the brand-prefixed slug on the plan keeps the live
    supplement protocol aligned with what gets ordered. Without this,
    every fresh AI synthesis emits generic slugs like `magnesium-glycinate`
    and the plan loses its brand pinning.
    """
    try:
        import yaml  # type: ignore
    except ImportError:
        return {}

    out: dict[str, str] = {}

    # ── Layer 1 · coach override ──────────────────────────────────────
    override_path = _plans_root() / "supplement_brand_map.yaml"
    if override_path.exists():
        try:
            raw = yaml.safe_load(override_path.read_text(encoding="utf-8")) or {}
            if isinstance(raw, dict):
                for k, v in raw.items():
                    if isinstance(k, str) and isinstance(v, str):
                        out[k.strip()] = v.strip()
        except Exception:
            # Bad YAML — ignore the override rather than failing draft gen.
            pass

    # ── Layer 2 · catalogue auto-detect ───────────────────────────────
    # Walk fm-database/data/supplements/ for vitaone-* slugs, build pairs.
    if supplements_dir.exists():
        try:
            catalog_slugs = {p.stem for p in supplements_dir.glob("*.yaml")}
        except Exception:
            catalog_slugs = set()
        BRAND_PREFIX = "vitaone-"
        # Common AI qualifier prefixes the catalog might NOT have on the
        # generic side. E.g. AI emits `vitamin-d3` but catalog has
        # `vitamin-d3` AND `vitaone-d3` — we want the map.
        QUALIFIER_PREFIXES = ["", "vitamin-", "vit-"]
        for slug in catalog_slugs:
            if not slug.startswith(BRAND_PREFIX):
                continue
            core = slug[len(BRAND_PREFIX):]
            for qp in QUALIFIER_PREFIXES:
                candidate = f"{qp}{core}"
                if candidate in catalog_slugs and candidate not in out:
                    out[candidate] = slug
    return out


def _apply_brand_map(slug: str, brand_map: dict[str, str]) -> str:
    """Map AI-emitted supplement slug to the preferred brand variant
    when one exists. Falls through unchanged otherwise."""
    if not slug or not brand_map:
        return slug
    return brand_map.get(slug, slug)


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

    # Brand-map: AI emits generic slugs (`magnesium-glycinate`); coach uses
    # VitaOne products on plans (vita13720sh referral). Build the map once
    # per draft and apply in every supplement append below.
    brand_map = _load_brand_map(FMDB_ROOT / "data" / "supplements")

    # Catalogue load (alias-aware indices) — used below to validate that
    # slugs the AI dropped into topic-shaped fields actually exist as topics.
    # If the AI emitted a mechanism slug as a "topic_in_play" (e.g.
    # `leaky-gut`, which lives in mechanisms/), drop it from topics and
    # surface it as a hypothesized driver instead. This avoids
    # `plan-check` CRITICAL: references unknown topic 'leaky-gut'.
    try:
        from fmdb.validator import load_all, overlay, _resolve_index
        _cat = overlay(load_all(FMDB_ROOT / "data"))
        _topic_idx = _resolve_index(_cat.topics)
        _mech_idx = _resolve_index(_cat.mechanisms)
        _sym_idx = _resolve_index(_cat.symptoms)
        _supp_slugs = {s.slug for s in _cat.supplements}
    except Exception:
        _topic_idx = {}
        _mech_idx = {}
        _sym_idx = {}
        _supp_slugs = set()

    def _is_topic(slug: str) -> bool:
        return bool(slug) and slug in _topic_idx
    def _is_mechanism(slug: str) -> bool:
        return bool(slug) and slug in _mech_idx

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

    # Track drivers so we don't double-add when a "topic" slug is really a mechanism.
    _driver_slugs_seen: set[str] = set()

    for d in suggestions.get("likely_drivers", []) or []:
        slug_d = d.get("mechanism_slug") or ""
        if picks.get(f"driver_{slug_d}", True):
            plan.hypothesized_drivers.append(HypothesizedDriver(
                mechanism=slug_d,
                reasoning=d.get("reasoning", ""),
            ))
            if slug_d:
                _driver_slugs_seen.add(slug_d)

    for t in suggestions.get("topics_in_play", []) or []:
        role = t.get("role", "primary")
        slug_t = t.get("topic_slug", "")
        if not slug_t:
            continue
        if not picks.get(f"topic_{slug_t}_{role}", True):
            continue
        # Guard against the AI emitting a mechanism slug in topic position
        # (e.g. `leaky-gut`). plan-check rejects unknown topics as CRITICAL,
        # blocking the draft from leaving the editor.
        if _is_topic(slug_t):
            if role == "contributing":
                plan.contributing_topics.append(slug_t)
            else:
                plan.primary_topics.append(slug_t)
        elif _is_mechanism(slug_t):
            # Slug is a mechanism — route to hypothesized_drivers if not already there.
            if slug_t not in _driver_slugs_seen:
                plan.hypothesized_drivers.append(HypothesizedDriver(
                    mechanism=slug_t,
                    reasoning=(t.get("rationale") or t.get("reasoning") or
                               f"Surfaced by AI as a {role} clinical area; routed to drivers because "
                               f"'{slug_t}' lives in the mechanisms catalogue, not topics."),
                ))
                _driver_slugs_seen.add(slug_t)
        # else: slug doesn't resolve anywhere — silently drop (catalogue-additions-suggested
        # already captures these for backlog triage).

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
            # Remap generic → VitaOne brand variant when one exists.
            mapped_slug = _apply_brand_map(slug_s, brand_map)
            plan.supplement_protocol.append(SupplementItem(
                supplement_slug=mapped_slug,
                form=sp.get("form", "") or "",
                dose=sp.get("dose", "") or "",
                timing=sp.get("timing", "") or "",
                duration_weeks=sp.get("duration_weeks"),
                titration=sp.get("titration", "") or "",
                coach_rationale=(sp.get("rationale", "") or "") + (
                    f"\n\n[evidence-tier note] {sp['evidence_tier_caveat']}"
                    if sp.get("evidence_tier_caveat") else ""
                ),
            ))

    for i, lf in enumerate(suggestions.get("lab_followups", []) or []):
        if picks.get(f"lab_{i}_{lf.get('test', '')}", True):
            kind = lf.get("kind") or None
            due = lf.get("due_in_weeks")
            plan.lab_orders.append(LabOrderItem(
                test=lf.get("test", ""),
                reason=lf.get("reason", ""),
                kind=kind if kind in ("new", "repeat") else None,
                due_in_weeks=int(due) if isinstance(due, (int, float)) and due else None,
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
        # Merge primary/contributing topics from template (dedup + catalogue guard)
        for t in resolved_template.get("primary_topics", []) or []:
            if t and _is_topic(t) and t not in plan.primary_topics:
                plan.primary_topics.append(t)
        for t in resolved_template.get("contributing_topics", []) or []:
            if t and _is_topic(t) and t not in plan.contributing_topics and t not in plan.primary_topics:
                plan.contributing_topics.append(t)

        # Merge template supplements (add those not already in plan by slug).
        # Brand-map applies here too — template can carry generic slugs.
        existing_supp_slugs = {s.supplement_slug for s in plan.supplement_protocol}
        for sp in resolved_template.get("supplements", []) or []:
            sl = sp.get("supplement_slug", "")
            sl = _apply_brand_map(sl, brand_map)
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
