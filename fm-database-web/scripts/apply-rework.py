#!/usr/bin/env python3
"""Apply a stored `rework_suggestion` (from client.yaml) to a new draft plan.

Two modes:
  * If the client has an active plan (published > ready_to_publish > draft, most
    recent first), the new plan is a SUCCESSOR draft cloning the old one then
    layering in the suggested changes.
  * Otherwise, a minimal first-time draft is created seeded only from the
    rework_suggestion + client context (conditions, goals).

In both cases:
  * `suggested_changes` are applied:
      - add/escalate supplement     → append/update `supplement_protocol[]`
      - remove/deescalate supplement→ filter `supplement_protocol[]`
      - add topic                   → append to `contributing_topics[]`
      - add lab_order               → append to `lab_orders[]`
      - add education               → append to `education[]`
      - add practice                → append to `lifestyle_practices[]`
  * Original AI rework rationale + estimated benefit are prepended to
    `notes_for_coach` so the coach can audit the basis.
  * `status` = draft, `version` = 0 (so publishing bumps to 1).

Reads JSON from stdin:
{
  "client_id":   str,
  "new_slug":    str | null,        # optional override; auto-derived if null
  "phase_weeks": int | null,        # plan period for a fresh first-time draft
}

Writes JSON to stdout:
{
  "ok":             bool,
  "slug":           str | null,
  "successor":      bool,           # true = cloned an existing plan
  "applied_count":  int,            # how many suggested_changes were applied
  "error":          str | null
}
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def _emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, default=str)
    return 0 if payload.get("ok") else 1


def _slug_from_name(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "client"


def _ai_suggested_protocol_slugs(client_id: str, max_top: int = 2) -> list[str]:
    """Read the most recent assess-class session for this client and pull
    out the AI's `suggested_protocols` (ranked, top-N).

    Coach feedback 2026-05-19: the rework flow's ReworkSuggestion schema
    has no `protocol` target_kind, so the rework AI doesn't recommend a
    protocol when generating a new draft from a check-in trigger. But
    the assess flow DOES — its suggestions live on session.ai_analysis.
    This bridges the two: when a rework draft is built (especially the
    no-parent / first-time branch which used to set
    attached_protocols=[]), pre-attach the top assess-time protocol
    suggestions so the coach lands in the plan editor with something
    pre-populated to review.

    Returns an empty list if no recent session has suggestions, or if
    no protocol scored above the AI's 50% fit threshold.
    """
    try:
        import yaml as _yaml
        # plan_storage.plans_root() resolves to ~/fm-plans (override via
        # FMDB_PLANS_DIR env). Use the same accessor the rest of this
        # script uses to avoid drift.
        from fmdb.plan import storage as _plan_storage
        sessions_dir = _plan_storage.plans_root() / "clients" / client_id / "sessions"
        if not sessions_dir.exists():
            return []
        # Sort newest-first by filename — sessions use ISO-prefix names.
        files = sorted(sessions_dir.glob("*.yaml"), reverse=True)
        for f in files:
            try:
                data = _yaml.safe_load(f.read_text()) or {}
            except Exception:
                continue
            ai = data.get("ai_analysis") or {}
            # `suggested_protocols` lives directly under ai_analysis,
            # not nested in a `.suggestions` sub-object — verified
            # against real session YAMLs 2026-05-19.
            protocols = ai.get("suggested_protocols") or []
            if not protocols:
                continue
            # Already sorted top-N by the suggester; defensive sort by
            # fit_percent desc in case the wire format changed.
            ranked = sorted(
                [p for p in protocols if isinstance(p, dict)],
                key=lambda p: float(p.get("fit_percent") or 0),
                reverse=True,
            )
            slugs = [
                str(p.get("protocol_slug") or "").strip()
                for p in ranked[:max_top]
                if p.get("protocol_slug")
            ]
            if slugs:
                return slugs
        return []
    except Exception:
        return []


def _active_plan(plans, client_id: str):
    """Return the most recent active plan for `client_id`, by status preference."""
    rank = {"published": 3, "ready_to_publish": 2, "draft": 1}
    candidates = [p for p in plans if (p.client_id == client_id) and (p.status.value in rank)]
    if not candidates:
        return None
    candidates.sort(
        key=lambda p: (rank.get(p.status.value, 0), p.created_at),
        reverse=True,
    )
    return candidates[0]


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        return _emit({"ok": False, "error": f"invalid JSON on stdin: {e}"})

    client_id = (payload.get("client_id") or "").strip()
    new_slug_override = (payload.get("new_slug") or "").strip()
    phase_weeks = int(payload.get("phase_weeks") or 12)

    if not client_id:
        return _emit({"ok": False, "error": "client_id is required"})

    from fmdb.plan import storage as plan_storage
    from fmdb.plan.models import (
        Plan, PlanStatus, HypothesizedDriver, PracticeItem, NutritionPlan,
        EducationModule, SupplementItem, LabOrderItem, CatalogueSnapshot,
    )

    root = plan_storage.plans_root()
    try:
        client = plan_storage.load_client(root, client_id)
    except FileNotFoundError as e:
        return _emit({"ok": False, "error": f"client not found: {e}"})

    # Pull the rework suggestion off the raw YAML — it's stored on the client
    # but not in the strict Pydantic Client model.
    import yaml
    client_yaml = plan_storage.client_path(root, client_id)
    raw = yaml.safe_load(client_yaml.read_text()) or {}
    rework = raw.get("rework_suggestion") or {}
    if not rework or not rework.get("suggested_changes"):
        return _emit({
            "ok": False,
            "error": "no rework_suggestion on this client — generate one first via the rework assessor",
        })

    # Build a set of lab-marker names the client already has values for in
    # health_snapshots. Used downstream to skip redundant lab_order
    # suggestions — coach hit this when a rework proposed "Order Vitamin D"
    # despite a value being on file 5 days ago.
    _existing_labs: set[str] = set()
    for snap in raw.get("health_snapshots") or []:
        for lv in (snap or {}).get("lab_values") or []:
            name = (lv or {}).get("test_name")
            if isinstance(name, str) and name.strip():
                _existing_labs.add(name.strip().lower())

    def _client_already_has_lab(query_text: str) -> str | None:
        """If the proposed lab-order test text references a marker that's
        already on file, return the matched marker name. Else None."""
        q = (query_text or "").lower()
        for n in _existing_labs:
            # Use 3+ char match to avoid the "if" / "MMA" false-positive trap.
            if len(n) >= 4 and n in q:
                return n
        # Also catch common label variants
        for marker, aliases in {
            "25-oh vitamin d": ("25-oh vitamin d", "vitamin d (25-oh)",
                                 "vitamin-d 25-oh", "vit d", "vitamin d total"),
            "ferritin":        ("ferritin",),
            "hba1c":           ("hba1c", "haemoglobin a1c"),
            "tsh":             ("tsh",),
        }.items():
            if any(a in n for n in _existing_labs for a in aliases) and \
               any(a in q for a in aliases):
                return marker
        return None

    changes = rework.get("suggested_changes") or []
    rationale = rework.get("rationale") or ""
    benefit_pct = rework.get("benefit_pct") or 0
    confidence = rework.get("confidence") or "medium"
    triggered_by = rework.get("triggered_by") or "report"

    now = datetime.now(timezone.utc)
    today = date.today()

    # ---- decide successor vs fresh ----
    try:
        all_plans = plan_storage.list_plans(root)
    except Exception:
        all_plans = []
    parent = _active_plan(all_plans, client_id)

    # Build the new slug
    first_name = (client.display_name or client.client_id or "client").split()[0]
    fns = _slug_from_name(first_name)
    plan_num = sum(1 for p in all_plans if p.client_id == client_id) + 1
    default_slug = f"{fns}-rework-{plan_num}-{today.isoformat()}-{client.client_id}"
    new_slug = new_slug_override or default_slug
    # Dedup
    n = 1
    base_slug = new_slug
    while True:
        try:
            plan_storage.find_plan_path(root, new_slug)
            n += 1
            new_slug = f"{base_slug}-{n}"
        except FileNotFoundError:
            break

    # ---- start from parent (successor) or build minimal ----
    if parent is not None:
        # Clone parent fields
        plan = Plan(
            slug=new_slug,
            client_id=client_id,
            plan_period_start=today,
            plan_period_weeks=parent.plan_period_weeks,
            plan_period_recheck_date=today + timedelta(weeks=parent.plan_period_weeks),
            primary_topics=list(parent.primary_topics),
            contributing_topics=list(parent.contributing_topics),
            presenting_symptoms=list(parent.presenting_symptoms),
            hypothesized_drivers=[HypothesizedDriver(**d.model_dump()) for d in parent.hypothesized_drivers],
            lifestyle_practices=[PracticeItem(**p.model_dump()) for p in parent.lifestyle_practices],
            nutrition=NutritionPlan(**parent.nutrition.model_dump()),
            education=[EducationModule(**e.model_dump()) for e in parent.education],
            supplement_protocol=[SupplementItem(**s.model_dump()) for s in parent.supplement_protocol],
            lab_orders=[LabOrderItem(**l.model_dump()) for l in parent.lab_orders],
            referrals=list(parent.referrals),
            tracking=parent.tracking.model_copy(deep=True),
            attached_resources=list(parent.attached_resources),
            # Carry parent's attached protocols. If the assess AI has
            # since suggested a DIFFERENT top protocol (e.g. check-in
            # revealed a gut issue not in parent's protocol), surface
            # that as a notes-for-coach hint without auto-replacing —
            # the coach decides whether to swap the protocol manually.
            attached_protocols=list(parent.attached_protocols),
            status=PlanStatus.draft,
            status_history=[],
            catalogue_snapshot=CatalogueSnapshot(snapshot_date=today),
            notes_for_coach=parent.notes_for_coach or "",
            version=0,
            created_at=now,
            updated_at=now,
            updated_by=raw.get("display_name") or "shivani",
            supersedes=parent.slug,
        )
        is_successor = True
        # Surface AI's latest protocol recommendations as a notes hint
        # if they differ from what's already attached. Doesn't auto-swap
        # — coach decides whether to replace.
        try:
            ai_top = _ai_suggested_protocol_slugs(client_id)
            parent_set = set(parent.attached_protocols or [])
            new_picks = [s for s in ai_top if s not in parent_set]
            if new_picks:
                hint = (
                    "\n\n🧭 AI also suggests these protocols based on recent data: "
                    + ", ".join(new_picks)
                    + ". Review and swap into `attached_protocols` if appropriate."
                )
                plan.notes_for_coach = (plan.notes_for_coach or "") + hint
        except Exception:
            pass
    else:
        # Build a minimal first-time draft scaffolded from the client's
        # active conditions + the rework supplements/topics/labs.
        plan = Plan(
            slug=new_slug,
            client_id=client_id,
            plan_period_start=today,
            plan_period_weeks=phase_weeks,
            plan_period_recheck_date=today + timedelta(weeks=phase_weeks),
            primary_topics=[],
            contributing_topics=[],
            presenting_symptoms=[],
            hypothesized_drivers=[],
            lifestyle_practices=[],
            nutrition=NutritionPlan(),
            education=[],
            supplement_protocol=[],
            lab_orders=[],
            referrals=[],
            tracking={"habits": [], "symptoms_to_monitor": [], "recheck_questions": []},
            attached_resources=[],
            # First-time rework draft — there's no parent plan to
            # inherit protocols from. Pull the AI's top suggested
            # protocols from the most recent assess session so the new
            # draft lands with something pre-attached rather than an
            # empty `attached_protocols: []` (coach bug 2026-05-19:
            # "AI is not suggesting which protocol to use for the plan").
            attached_protocols=_ai_suggested_protocol_slugs(client_id),
            status=PlanStatus.draft,
            status_history=[],
            catalogue_snapshot=CatalogueSnapshot(snapshot_date=today),
            notes_for_coach="",
            version=0,
            created_at=now,
            updated_at=now,
            updated_by=raw.get("display_name") or "shivani",
            supersedes=None,
        )
        is_successor = False

    # ---- apply suggested_changes ----
    applied = 0
    applied_log: list[str] = []   # one human-readable line per applied change

    _op_emoji = {
        "add": "+",
        "escalate": "↑",
        "deescalate": "↓",
        "remove": "-",
        "swap": "⇄",
    }
    def _record(op_: str, kind_: str, slug_or_desc: str, note: str = "") -> None:
        symbol = _op_emoji.get(op_, "·")
        label = slug_or_desc or "(no slug)"
        line = f"  {symbol} {kind_} {label}"
        if note:
            # First line of note only, kept short
            head = note.splitlines()[0].strip()
            if head and head != label:
                line += f" — {head[:90]}"
        applied_log.append(line)

    def _merge_evidence(existing: list[str], incoming: list[str]) -> list[str]:
        """Union of existing + incoming intake_evidence, dedup case-insensitive,
        preserve order. Used when a rework change targets an existing plan
        item — we keep the original citations and append any new ones the
        rework AI surfaced."""
        seen = {e.strip().lower() for e in (existing or [])}
        out = list(existing or [])
        for e in incoming or []:
            e2 = e.strip()
            if e2 and e2.lower() not in seen:
                out.append(e2)
                seen.add(e2.lower())
        return out

    for c in changes:
        op = (c.get("op") or "").strip()
        kind = (c.get("target_kind") or "").strip()
        slug = (c.get("target_slug") or "").strip() or None
        description = (c.get("description") or "").strip()
        reason = (c.get("reason") or "").strip()
        # v0.72: intake_evidence — short coach-readable phrases the rework AI
        # populated to cite the intake observations that justified this change.
        # Propagated onto the target Plan sub-model so the coach sees the
        # audit chip inline on the SupplementItem / PracticeItem / LabOrderItem.
        change_evidence = c.get("intake_evidence") or []
        if not isinstance(change_evidence, list):
            change_evidence = []
        change_evidence = [str(e).strip() for e in change_evidence if str(e).strip()]
        if not op or not kind:
            continue

        if kind == "supplement":
            if op in ("add",):
                if not slug:
                    # No slug — still capture as a coach-facing note inside the supplement protocol
                    plan.supplement_protocol.append(SupplementItem(
                        supplement_slug=_slug_from_name(description[:60] or "supplement-tbd"),
                        coach_rationale=f"[rework] {description}\n{reason}".strip(),
                        intake_evidence=change_evidence,
                    ))
                    applied += 1
                    _record(op, kind, description[:60] or "(no slug)", reason)
                    continue
                existing = next((s for s in plan.supplement_protocol if s.supplement_slug == slug), None)
                if existing is None:
                    plan.supplement_protocol.append(SupplementItem(
                        supplement_slug=slug,
                        coach_rationale=f"[rework] {description}\n{reason}".strip(),
                        intake_evidence=change_evidence,
                    ))
                    applied += 1
                    _record(op, kind, slug, description)
                else:
                    existing.coach_rationale = (
                        existing.coach_rationale + f"\n[rework] {description}\n{reason}"
                    ).strip()
                    existing.intake_evidence = _merge_evidence(
                        existing.intake_evidence, change_evidence
                    )
                    applied += 1
                    _record(op, kind, slug + " (already present — rationale enriched)", description)
            elif op == "escalate":
                # If already present, append rework note; else add
                existing = next((s for s in plan.supplement_protocol if s.supplement_slug == slug), None) if slug else None
                if existing is not None:
                    existing.coach_rationale = (
                        existing.coach_rationale + f"\n[rework — escalate] {description}\n{reason}"
                    ).strip()
                    existing.intake_evidence = _merge_evidence(
                        existing.intake_evidence, change_evidence
                    )
                    applied += 1
                    _record(op, kind, slug, description)
                elif slug:
                    plan.supplement_protocol.append(SupplementItem(
                        supplement_slug=slug,
                        coach_rationale=f"[rework — escalate] {description}\n{reason}".strip(),
                        intake_evidence=change_evidence,
                    ))
                    applied += 1
                    _record(op, kind, slug, description)
            elif op in ("remove", "deescalate"):
                if slug:
                    before = len(plan.supplement_protocol)
                    plan.supplement_protocol = [
                        s for s in plan.supplement_protocol if s.supplement_slug != slug
                    ]
                    if len(plan.supplement_protocol) < before:
                        applied += 1
                        _record(op, kind, slug, description)
            elif op == "swap":
                if slug:
                    existing = next((s for s in plan.supplement_protocol if s.supplement_slug == slug), None)
                    if existing is not None:
                        existing.coach_rationale = (
                            existing.coach_rationale + f"\n[rework — swap] {description}\n{reason}"
                        ).strip()
                        existing.intake_evidence = _merge_evidence(
                            existing.intake_evidence, change_evidence
                        )
                        applied += 1
                        _record(op, kind, slug, description)

        elif kind == "topic":
            if op == "add" and slug:
                if slug not in plan.primary_topics and slug not in plan.contributing_topics:
                    plan.contributing_topics.append(slug)
                    applied += 1
                    _record(op, kind, slug, description)
            elif op == "add" and not slug:
                # Topic without slug → push into education as a teach-this item
                plan.education.append(EducationModule(
                    target_kind="topic",
                    target_slug="(coach-to-fill)",
                    client_facing_summary=f"{description}\n{reason}".strip(),
                ))
                applied += 1
                _record(op, "education", description[:80] or "(no slug)", reason)

        elif kind == "lab_order":
            test = description or slug or "(lab order — coach to specify)"
            # Dedup #1: same test text already in plan.lab_orders (case-
            # insensitive). Prevents the same rework from re-adding the
            # same order across multiple apply runs.
            test_lower = test.strip().lower()
            if any(
                (existing_lab.test or "").strip().lower() == test_lower
                for existing_lab in plan.lab_orders
            ):
                _record(op, kind, test[:80] + " (skipped — already in plan)", "")
                continue
            # Dedup #2: marker already on file in client.health_snapshots.
            # Skip — the client doesn't need to re-test something we just
            # received results for.
            on_file = _client_already_has_lab(test)
            if on_file:
                _record(op, kind,
                        test[:80] + f" (skipped — {on_file} already on file)",
                        "")
                continue
            plan.lab_orders.append(LabOrderItem(
                test=test,
                reason=reason or rationale[:200],
                intake_evidence=change_evidence,
            ))
            applied += 1
            _record(op, kind, test[:80], reason)

        elif kind == "education":
            # EducationModule doesn't carry intake_evidence today (deferred per
            # design doc — less clinical weight). Embed the citations in the
            # client_facing_summary as a parenthetical so they're not lost.
            evidence_suffix = (
                f"\n\n(Intake evidence: {'; '.join(change_evidence)})"
                if change_evidence else ""
            )
            plan.education.append(EducationModule(
                target_kind="topic",
                target_slug=slug or "(coach-to-fill)",
                client_facing_summary=(
                    f"{description}\n{reason}".strip() + evidence_suffix
                ),
            ))
            applied += 1
            _record(op, kind, slug or description[:80] or "(no slug)", description if slug else "")

        elif kind == "practice":
            plan.lifestyle_practices.append(PracticeItem(
                name=description[:80] or (slug or "practice"),
                cadence="daily",
                details=reason,
                intake_evidence=change_evidence,
            ))
            applied += 1
            _record(op, kind, description[:80] or slug or "(no name)", reason)

    # ---- prepend rework rationale + itemized change log to coach notes ----
    change_log_section = ""
    if applied_log:
        change_log_section = (
            f"\nChanges applied ({applied}):\n"
            + "\n".join(applied_log)
            + "\n"
        )
    rework_block = (
        f"[AI Rework — {benefit_pct}% benefit · {confidence} confidence · "
        f"triggered by {triggered_by} · {today.isoformat()}]\n"
        f"RATIONALE: {rationale}\n"
        f"{change_log_section}"
    )
    plan.notes_for_coach = (
        rework_block + ("\n---\n\n" + plan.notes_for_coach if plan.notes_for_coach else "")
    )

    try:
        plan_storage.write_plan(root, plan)
    except Exception as e:
        return _emit({"ok": False, "error": f"failed to write plan: {type(e).__name__}: {e}"})

    return _emit({
        "ok": True,
        "slug": new_slug,
        "successor": is_successor,
        "applied_count": applied,
        "parent_slug": parent.slug if parent else None,
        "error": None,
    })


if __name__ == "__main__":
    sys.exit(main())
