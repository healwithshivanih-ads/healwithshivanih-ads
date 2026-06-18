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


_PRACTICE_FILLERS = {
    "the", "a", "an", "or", "and", "of", "to", "per", "every", "after", "before",
    "min", "mins", "minute", "minutes", "x", "daily", "nightly", "times", "time",
    "week", "weekly", "day", "with", "your", "for", "on",
}


def _practice_tokens(name: str) -> set:
    """Meaningful content words of a practice name (drops parentheticals, a
    trailing '— rationale', punctuation and filler words)."""
    import re
    s = (name or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[—–-]\s.*$", " ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return {t for t in s.split() if len(t) > 1 and t not in _PRACTICE_FILLERS}


def _dedupe_practices(practices):
    """Remove practices that re-state another. A practice is redundant when its
    meaningful tokens are a SUBSET of another's (keep the more specific one) or
    an exact token match (keep the first). Conservative — needs >=2 meaningful
    tokens to be eligible, so distinct practices are never collapsed. Returns
    (kept, dropped)."""
    toks = [(_practice_tokens(getattr(p, "name", "") or ""), p) for p in practices]
    kept, dropped = [], []
    for i, (ti, pi) in enumerate(toks):
        if len(ti) < 2:
            kept.append(pi)
            continue
        redundant = False
        for j, (tj, pj) in enumerate(toks):
            if i == j:
                continue
            if ti <= tj and (len(tj) > len(ti) or (len(tj) == len(ti) and j < i)):
                redundant = True
                break
        (dropped if redundant else kept).append(pi)
    return kept, dropped


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
        AyurvedaSection, TissueSaltsSection, TissueSaltItem,
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
        _hr_idx = _resolve_index(_cat.home_remedies)
        _ts_idx = _resolve_index(getattr(_cat, "tissue_salts", []) or [])
    except Exception:
        _topic_idx = {}
        _mech_idx = {}
        _sym_idx = {}
        _supp_slugs = set()
        _hr_idx = {}
        _ts_idx = {}

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

    # Default plan period = 12 weeks (matches the coach's standard
    # protocol length). Was 8 historically — flipped 2026-05-19 because
    # virtually every plan was extended to 12 anyway, and 8 produced
    # misleading week counts in the new Communicate panel's fortnight
    # track. Coach can still override per-client via the assess form's
    # plan-period picker.
    plan_weeks = int(plan_brief.get("plan_period_weeks") or 12)

    # Auto-link supersedes when this client already has a published plan
    # (B7 from dry-run audit 2026-05-19). Without this, week-12 recheck
    # plans become orphan parallel published plans because coach has to
    # remember to wire `supersedes` by hand. Picks the newest published
    # plan for this client (by updated_at desc).
    previous_published_slug: str | None = None
    try:
        published = [
            p for p in all_plans
            if (p.client_id or "") == client_id
            and (getattr(p, "status", None) and str(p.status).lower() == "published")
        ]
        if published:
            # Newest first by updated_at; fall back to slug if missing.
            published.sort(
                key=lambda p: (getattr(p, "updated_at", None) or now, p.slug),
                reverse=True,
            )
            previous_published_slug = published[0].slug
    except Exception:
        previous_published_slug = None

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
        supersedes=previous_published_slug,
    )

    # Carry the symptoms the coach actually selected during the analyse
    # session into plan.presenting_symptoms. Without this every fresh draft
    # tripped the "no presenting_symptoms — was this captured at intake?"
    # INFO finding on plan-check, which was misleading: the symptoms WERE
    # captured (on the session), they just weren't being copied across.
    # Filter to catalogue-valid slugs so the xref check stays clean.
    if getattr(sess, "selected_symptoms", None):
        valid_sym_slugs = {s.slug for s in _cat.symptoms}
        plan.presenting_symptoms = [
            s for s in sess.selected_symptoms if s in valid_sym_slugs
        ]

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

    # ── Ayurveda layer ────────────────────────────────────────────────────
    # Only when the client is on the Ayurveda track AND the suggester emitted
    # the block. The constitution read is staged onto the client (coach
    # confirms prakruti via the editor — we never auto-write the constitution
    # string); the section becomes the draft Plan.ayurveda. Remedy slugs are
    # validated + canonicalised against the catalogue so plan-check stays clean.
    _ayur = suggestions.get("ayurveda") if isinstance(suggestions.get("ayurveda"), dict) else None
    if _ayur and getattr(client, "ayurveda_enabled", False) and picks.get("ayurveda_block", True):
        sec = _ayur.get("section") or {}
        _resolved_remedies: list[str] = []
        for rslug in (sec.get("remedy_slugs") or []):
            canon = _hr_idx.get(rslug)
            if canon and canon not in _resolved_remedies:
                _resolved_remedies.append(canon)   # drop unknown slugs silently
        _dina = [
            PracticeItem(
                name=str(d.get("name") or "").strip(),
                cadence=str(d.get("cadence") or "").strip(),
                details=str(d.get("details") or "").strip(),
            )
            for d in (sec.get("dinacharya") or [])
            if isinstance(d, dict) and (d.get("name") or "").strip()
        ]
        plan.ayurveda = AyurvedaSection(
            current_imbalance=sec.get("current_imbalance") or _ayur.get("vikruti_label") or "",
            balancing_focus=sec.get("balancing_focus") or "",
            dietary_guidance=sec.get("dietary_guidance") or "",
            dinacharya=_dina,
            remedies=_resolved_remedies,
            seasonal_note=sec.get("seasonal_note") or "",
            coach_notes=_ayur.get("dual_root_cause_note") or "",
        )
        # Stage the constitution read on the client (overwrites prior read).
        # vikruti_doshas drives the plan-checker remedy-mismatch flag.
        client.ayurveda_assessment = {
            "assessed_at": now.isoformat(),
            "model": (sess.api_usage or {}).get("model") or "",
            "assessment_method": _ayur.get("assessment_method") or "self_assessment+intake",
            "vata_score": _ayur.get("vata_score"),
            "pitta_score": _ayur.get("pitta_score"),
            "kapha_score": _ayur.get("kapha_score"),
            "prakruti_label": _ayur.get("prakruti_label") or "",
            "prakruti_confidence": _ayur.get("prakruti_confidence") or "pending_quiz",
            "vikruti_label": _ayur.get("vikruti_label") or "",
            "vikruti_doshas": [str(d).lower() for d in (_ayur.get("vikruti_doshas") or [])],
            "agni_state": _ayur.get("agni_state") or "",
            "ama_present": bool(_ayur.get("ama_present")),
            "ama_note": _ayur.get("ama_note") or "",
            "confidence": _ayur.get("prakruti_confidence") or "",
            "evidence": _ayur.get("evidence") or [],
            "dual_root_cause_note": _ayur.get("dual_root_cause_note") or "",
            "advisory": _ayur.get("advisory") or "",
        }
        try:
            plan_storage.write_client(root, client)
        except Exception:
            pass  # never block plan generation on the client write

    # ── Tissue-salts (Schüssler) layer ────────────────────────────────────
    # Only when the client is on the schussler_salts module AND the suggester
    # emitted the block. Salt slugs are validated / canonicalised against the
    # tissue_salt catalogue so plan-check + letter stay clean — unknown or
    # duplicate slugs are dropped silently (the suggester is subgraph-bound,
    # so this is rare). The section becomes the draft Plan.tissue_salts.
    _tsalt = suggestions.get("tissue_salts") if isinstance(suggestions.get("tissue_salts"), dict) else None
    _schussler_on = "schussler_salts" in (getattr(client, "plan_modules", None) or [])
    if _tsalt and _schussler_on and picks.get("tissue_salts_block", True):
        _resolved_salts: list = []
        _seen_salt: set = set()
        for it in (_tsalt.get("salts") or []):
            if not isinstance(it, dict):
                continue
            canon = _ts_idx.get(str(it.get("salt_slug") or "").strip())
            if not canon or canon in _seen_salt:
                continue  # drop unknown / duplicate slugs silently
            _seen_salt.add(canon)
            _resolved_salts.append(TissueSaltItem(
                salt_slug=canon,
                reason=str(it.get("reason") or "").strip(),
                intake_evidence=[
                    str(e).strip() for e in (it.get("intake_evidence") or []) if str(e).strip()
                ],
            ))
        if _resolved_salts:
            plan.tissue_salts = TissueSaltsSection(
                overview=str(_tsalt.get("overview") or "").strip(),
                salts=_resolved_salts,
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
                start_week=sp.get("start_week") or 1,
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

    # Deterministic fallback — if the synthesiser emitted no education_framings,
    # seed the Education section from the plan's own primary topics + drivers so
    # every draft ships with client teaching points (coach edits/trims). No API.
    if not plan.education:
        try:
            _topic_by_slug = {t.slug: t for t in _cat.topics}
            _mech_by_slug = {m.slug: m for m in _cat.mechanisms}
            for ts in plan.primary_topics:
                if len(plan.education) >= 5:
                    break
                t = _topic_by_slug.get(ts)
                if t:
                    plan.education.append(EducationModule(
                        target_kind="topic", target_slug=ts,
                        client_facing_summary=(t.summary or "")[:400],
                    ))
            for drv in plan.hypothesized_drivers:
                if len(plan.education) >= 5:
                    break
                m = _mech_by_slug.get(drv.mechanism)
                if m:
                    plan.education.append(EducationModule(
                        target_kind="mechanism", target_slug=m.slug,
                        client_facing_summary=(m.summary or "")[:400],
                    ))
        except Exception:
            pass

    # ── Attach AI-suggested protocols (radio-selected by coach) ──────────────
    # Picks key format: `protocol_<slug>` is True when the coach selected
    # that protocol via the radio in the SuggestionsView. Drives meal/
    # supplement/exercise/lifestyle letter generation downstream.
    #
    # IMPORTANT: this loop used to bind `slug` directly, which silently
    # shadowed the outer plan-slug variable. The shadowed value then
    # leaked into `sess.generated_plan_slug = slug` ~150 lines below,
    # so the session would record a Protocol catalogue slug
    # (e.g. "5r-gut-protocol") as if it were the generated Plan slug —
    # and clicking "Open generated plan" from the v2 sessions browser
    # 404'd because no Plan exists at that slug. Renamed to proto_slug
    # to make the scope explicit.
    for ps in suggestions.get("suggested_protocols", []) or []:
        proto_slug = ps.get("protocol_slug", "")
        if proto_slug and picks.get(f"protocol_{proto_slug}"):
            if proto_slug not in plan.attached_protocols:
                plan.attached_protocols.append(proto_slug)

    # Coach-forced attachments from the assess-page protocol picker
    # ("🏥 FM healing programs" → catalogue: prefix). actions.ts pushes
    # the bare slug list into plan_brief.force_attach_protocols. Add
    # them whether or not the AI's suggested_protocols mentioned them,
    # so the coach's manual pick always wins.
    for proto_slug in plan_brief.get("force_attach_protocols", []) or []:
        if isinstance(proto_slug, str) and proto_slug and proto_slug not in plan.attached_protocols:
            plan.attached_protocols.append(proto_slug)

    # ── Merge attached Protocol catalogue content into the plan ────────────────
    # When a coach attaches a Protocol (e.g. 5R Gut, AIP, Whole30), the
    # catalogue entry contains supplements_typically_used, foods_to_emphasise,
    # foods_to_remove, phases, etc. — the structured "how to actually run
    # this protocol" data. Without this merge the attached_protocols field
    # was just a label; the plan body had only what the AI proposed from
    # the general subgraph, and protocol-specific staples didn't make it in.
    #
    # Coach's rule: AI suggestions take precedence (already in the plan).
    # Protocol content fills in any gaps. Dedup by slug / string match.
    try:
        import yaml as _yaml  # type: ignore
        proto_dir = FMDB_ROOT / "data" / "protocols"
        if not plan.nutrition:
            plan.nutrition = NutritionPlan()
        existing_supp_slugs = {s.supplement_slug for s in plan.supplement_protocol}
        existing_add = {x.lower() for x in plan.nutrition.add}
        existing_reduce = {x.lower() for x in plan.nutrition.reduce}
        notes_protocol_blocks: list[str] = []

        for ps_slug in plan.attached_protocols:
            proto_file = proto_dir / f"{ps_slug}.yaml"
            if not proto_file.exists():
                # Try aliased slug — Protocols don't have aliases on file,
                # but we accept the user's slug as-is.
                continue
            try:
                proto = _yaml.safe_load(proto_file.read_text()) or {}
            except Exception:
                continue

            # Supplements: append those not already present (brand-mapped).
            for sl in proto.get("supplements_typically_used", []) or []:
                if not isinstance(sl, str):
                    continue
                mapped = _apply_brand_map(sl, brand_map)
                if mapped and mapped not in existing_supp_slugs:
                    plan.supplement_protocol.append(SupplementItem(
                        supplement_slug=mapped,
                        form="",
                        dose="",
                        timing="",
                        coach_rationale=(
                            f"[from {proto.get('display_name', ps_slug)}] "
                            f"Typical {proto.get('category', 'protocol').replace('_', ' ')} supplement — "
                            f"set dose + timing during plan review."
                        ),
                    ))
                    existing_supp_slugs.add(mapped)

            # Foods to emphasise → nutrition.add (dedup case-insensitive)
            for food in proto.get("foods_to_emphasise", []) or []:
                if not isinstance(food, str) or not food.strip():
                    continue
                if food.strip().lower() not in existing_add:
                    plan.nutrition.add.append(food.strip())
                    existing_add.add(food.strip().lower())

            # Foods to remove → nutrition.reduce
            for food in proto.get("foods_to_remove", []) or []:
                if not isinstance(food, str) or not food.strip():
                    continue
                if food.strip().lower() not in existing_reduce:
                    plan.nutrition.reduce.append(food.strip())
                    existing_reduce.add(food.strip().lower())

            # Phase summary → notes_for_coach (compact, scannable, H2 markdown)
            phases = proto.get("phases", []) or []
            if phases:
                phase_lines = [f"## {proto.get('display_name', ps_slug)} phases"]
                for ph in phases:
                    if isinstance(ph, dict) and ph.get("name"):
                        phase_lines.append(f"- {ph['name']}: {ph.get('summary', '').strip().splitlines()[0] if ph.get('summary') else ''}")
                if len(phase_lines) > 1:
                    notes_protocol_blocks.append("\n".join(phase_lines))

            # Cautions → folded into the Coach reminders block (H2 markdown)
            cautions = proto.get("cautions", []) or []
            if cautions:
                do_not_lines = [f"## Coach reminders — {proto.get('display_name', ps_slug)} cautions"]
                for c in cautions:
                    if isinstance(c, str):
                        do_not_lines.append(f"- {c}")
                notes_protocol_blocks.append("\n".join(do_not_lines))

        # Stash protocol content for the notes_for_coach assembly block below.
        # It'll be appended at the same point as other note sections.
        _protocol_notes_blocks = notes_protocol_blocks
    except Exception:
        # Catalogue read failure shouldn't kill draft generation. Log and
        # continue with whatever the AI proposed.
        _protocol_notes_blocks = []

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
    # Assembled as structured markdown with H2 (`##`) headings so the plan
    # page renders subheadings + bullets instead of a wall of prose. The AI
    # synthesis_notes already arrives with H2 sections (see suggester.py
    # schema); we wrap the other contextual blobs in matching H2 headings.
    notes_parts = []
    if plan_brief.get("root_cause_hypothesis"):
        notes_parts.append(f"## Root cause hypothesis\n{plan_brief['root_cause_hypothesis']}")
    if plan_brief.get("coaching_notes"):
        notes_parts.append(f"## Coaching notes\n{plan_brief['coaching_notes']}")
    if resolved_template:
        notes_parts.append(
            f"## Protocol template applied\n- {resolved_template.get('display_name', resolved_template.get('id', ''))}"
        )
    if free_text_notes:
        notes_parts.append(f"## Free-text intake\n{free_text_notes}")
    if suggestions.get("synthesis_notes"):
        # The AI synthesis_notes is already structured into H2 markdown
        # sections per suggester.py system prompt (## Why this plan,
        # ## Key drivers identified, ## Why these supplements,
        # ## What to monitor, ## Coach reminders). Drop in as-is.
        notes_parts.append(suggestions["synthesis_notes"])

    # Protocol phase + caution notes (built above when attached_protocols
    # were merged from catalogue). Empty when no protocol attached.
    for block in _protocol_notes_blocks:
        notes_parts.append(block)

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

        timeline_section = ["## IFM Timeline (AI-classified)"]
        for label, key in [
            ("Antecedents (predisposing)", "antecedent"),
            ("Triggers (initiated)", "trigger"),
            ("Mediators (perpetuating)", "mediator"),
            ("Resolution / what helped", "resolution"),
        ]:
            if atm_buckets[key]:
                timeline_section.append(f"\n**{label}:**")
                timeline_section.extend(atm_buckets[key])
        if len(timeline_section) > 1:
            notes_parts.append("\n".join(timeline_section))

    if notes_parts:
        plan.notes_for_coach = "\n\n".join(notes_parts)

    # Auto-attach matching resources (deterministic, no API). Match the plan's
    # topics / mechanisms / supplements against each resource's related_* links;
    # attach client-shareable, active resources that overlap. No-op until the
    # resource library is populated — then plans self-attach handouts.
    try:
        import yaml as _yaml
        _res_root = Path(os.environ.get("FMDB_RESOURCES_DIR") or os.path.expanduser("~/fm-resources")) / "resources"
        if _res_root.is_dir():
            _ptopics = set(plan.primary_topics) | set(plan.contributing_topics)
            _pmechs = {d.mechanism for d in plan.hypothesized_drivers if d.mechanism}
            _psupps = {s.supplement_slug for s in plan.supplement_protocol}
            _seen = set(plan.attached_resources)
            for _rp in sorted(_res_root.glob("*.yaml")):
                if len(plan.attached_resources) >= 12:
                    break
                try:
                    _r = _yaml.safe_load(_rp.read_text()) or {}
                except Exception:
                    continue
                if _r.get("status", "active") != "active" or _r.get("audience") == "coach":
                    continue
                if (set(_r.get("related_topics") or []) & _ptopics
                        or set(_r.get("related_mechanisms") or []) & _pmechs
                        or set(_r.get("related_supplements") or []) & _psupps):
                    _slug = _r.get("slug")
                    if _slug and _slug not in _seen:
                        plan.attached_resources.append(_slug)
                        _seen.add(_slug)
    except Exception:
        pass

    # ── Protein top-up on the structured plan ─────────────────────────
    # Coach rule: vegetarians (who routinely under-eat protein), OR anyone
    # with a lab protein-gap signal, get a protein-powder item on the
    # supplement protocol — never when kidney disease / gout contraindicate
    # raising protein. Best-effort; never blocks plan generation.
    try:
        import protein_logic
        client_d = client.model_dump()
        plan_d = plan.model_dump()
        add, _reason = protein_logic.should_add_protein_supplement(client_d, plan_d)
        if add and not protein_logic.plan_has_protein(plan_d):
            f = protein_logic.build_protein_supplement_fields(client_d, plan_d)
            plan.supplement_protocol.append(SupplementItem(
                supplement_slug=f["supplement_slug"],
                form=f["form"],
                dose=f["dose"],
                timing=f["timing"],
                take_with_food=f.get("take_with_food", "") or "",
                duration_weeks=f.get("duration_weeks"),
                coach_rationale=f["coach_rationale"],
            ))
    except Exception:
        pass

    # Drop near-duplicate practices the AI sometimes emits as two separate
    # suggestions ("10-minute post-meal walk" + "10-min walk after every
    # meal"). Conservative: only removes a practice whose meaningful words are
    # a SUBSET of another's (a re-statement); keeps the more specific one.
    plan.lifestyle_practices, _dropped_practices = _dedupe_practices(plan.lifestyle_practices)
    if _dropped_practices:
        print(f"[generate-draft] dropped {len(_dropped_practices)} duplicate practice(s): "
              f"{[getattr(p, 'name', '') for p in _dropped_practices]}", file=sys.stderr)

    path = plan_storage.write_plan(root, plan)

    # Mirror Streamlit: stamp the session with the generated plan slug.
    sess.generated_plan_slug = slug
    plan_storage.update_session(root, sess)

    json.dump({"ok": True, "slug": slug, "path": str(path), "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
