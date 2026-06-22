#!/usr/bin/env python3
"""AI plan-rework assessor.

Given a client + their active plan + a recent triggering event (new check-in,
quick note, lab snapshot, functional test, genetic report), asks Haiku to
estimate whether the plan should be revised. Returns a structured output
with benefit_pct, rationale, and suggested changes.

Reads JSON from stdin:
{
  "client_id":     str,
  "triggered_by":  "check_in" | "quick_note" | "functional_test" |
                   "lab_snapshot" | "genetic_report",
  "event_summary": str,            # short description of what just happened
  "dry_run":       bool            # skip API call, return canned output
}

Writes JSON to stdout:
{
  "ok":          bool,
  "suggestion":  {
    "generated_at":      "2026-05-10T...",
    "triggered_by":      str,
    "benefit_pct":       0-100,
    "confidence":        "low" | "medium" | "high",
    "rationale":         str,
    "suggested_changes": [
      {
        "op":           "add"|"remove"|"escalate"|"deescalate"|"swap",
        "target_kind":  "supplement"|"topic"|"practice"|"lab_order"|"education",
        "target_slug":  str | null,
        "description":  str,
        "reason":       str
      }
    ]
  } | null,
  "error":       str | null
}

Saves the suggestion to the client's YAML at client.rework_suggestion (overwrites
any prior suggestion).
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml


def _load_env() -> None:
    """Source ANTHROPIC_API_KEY from fm-database/.env if not in environment."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    candidates = [
        Path(__file__).resolve().parent.parent.parent / "fm-database" / ".env",
        Path(__file__).resolve().parent.parent / "fm-database" / ".env",
    ]
    for p in candidates:
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):]
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


def _plans_root() -> Path:
    p = os.environ.get("FMDB_PLANS_DIR")
    if p:
        return Path(p).expanduser()
    return Path.home() / "fm-plans"


def _load_client(client_id: str) -> dict | None:
    f = _plans_root() / "clients" / client_id / "client.yaml"
    if not f.exists():
        return None
    return yaml.safe_load(f.read_text()) or {}


def _save_client(client_id: str, data: dict) -> None:
    f = _plans_root() / "clients" / client_id / "client.yaml"
    f.write_text(yaml.dump(data, sort_keys=False, allow_unicode=True))


def _find_active_plan(client_id: str) -> dict | None:
    """Return the most recent published plan for this client, else most recent draft."""
    root = _plans_root()
    for bucket in ("published", "ready", "drafts"):
        d = root / bucket
        if not d.exists():
            continue
        candidates = []
        for f in d.glob("*.yaml"):
            try:
                data = yaml.safe_load(f.read_text()) or {}
                if data.get("client_id") == client_id:
                    candidates.append((f.stat().st_mtime, data))
            except Exception:
                continue
        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            return candidates[0][1]
    return None


def _recent_sessions(client_id: str, limit: int = 5) -> list[dict]:
    d = _plans_root() / "clients" / client_id / "sessions"
    if not d.exists():
        return []
    files = sorted(d.glob("*.yaml"), key=lambda f: f.stat().st_mtime, reverse=True)[:limit]
    out = []
    for f in files:
        try:
            data = yaml.safe_load(f.read_text()) or {}
            out.append(data)
        except Exception:
            continue
    return out


def _weight_progress_summary(client: dict) -> str | None:
    """Compact text summary of weight-loss progress for the rework prompt —
    a Python twin of src/lib/fmdb/weight-progress.ts (assessWeightProgress).
    Returns None when there's no usable weight-loss goal. Never raises.

    Unions weigh-ins across health_snapshots (client-app + lab),
    measurements_log (coach), and the flat measurements object so a
    self-logging client's data isn't missed.
    """
    try:
        from datetime import date as _date

        goal = client.get("weight_loss") or {}
        if not isinstance(goal, dict) or goal.get("enabled") is False:
            return None
        start_kg = goal.get("starting_weight_kg")
        goal_kg = goal.get("goal_kg")
        start_raw = goal.get("starting_date")
        if not (isinstance(start_kg, (int, float)) and start_kg > 0
                and isinstance(goal_kg, (int, float)) and goal_kg > 0 and start_raw):
            return None

        def _pd(v):
            if not v:
                return None
            try:
                return _date.fromisoformat(str(v)[:10])
            except Exception:
                return None

        start_d = _pd(start_raw)
        if not start_d:
            return None

        # Committed weekly rate (goal_kg over the goal window), else pace tag.
        target_d = _pd(goal.get("goal_target_date"))
        if target_d and (target_d - start_d).days >= 7:
            expected_weekly = goal_kg / ((target_d - start_d).days / 7)
        else:
            expected_weekly = {"slow": 0.25, "moderate": 0.5, "faster": 0.75}.get(
                goal.get("pace") or "moderate", 0.5)

        # Union weight readings, one per date.
        readings: dict[str, float] = {}
        for snap in client.get("health_snapshots") or []:
            d = _pd((snap or {}).get("date"))
            kg = ((snap or {}).get("measurements") or {}).get("weight_kg")
            if d and isinstance(kg, (int, float)) and 20 <= kg <= 400:
                readings[d.isoformat()] = float(kg)
        for e in client.get("measurements_log") or []:
            d = _pd((e or {}).get("date"))
            kg = (e or {}).get("weight_kg")
            if d and isinstance(kg, (int, float)) and 20 <= kg <= 400:
                readings[d.isoformat()] = float(kg)  # coach log wins same-date tie
        flat = client.get("measurements") or {}
        fkg = flat.get("weight_kg")
        if isinstance(fkg, (int, float)) and 20 <= fkg <= 400:
            fd = _pd(flat.get("measured_on")) or _date.today()
            readings.setdefault(fd.isoformat(), float(fkg))

        series = sorted(
            ((d, kg) for d, kg in readings.items() if d >= start_d.isoformat()),
            key=lambda x: x[0],
        )
        if not series:
            return (f"# WEIGHT-LOSS PROGRESS\n- Goal: lose {goal_kg} kg from "
                    f"{start_kg} kg (~{round(expected_weekly, 2)} kg/wk expected).\n"
                    f"- No weigh-ins logged since starting — progress unverifiable; "
                    f"ask the client to weigh in.\n")

        latest_d_str, latest_kg = series[-1]
        latest_d = _date.fromisoformat(latest_d_str)
        weeks = max((latest_d - start_d).days / 7, 0)
        actual_loss = round(start_kg - latest_kg, 1)
        expected_loss = round(expected_weekly * weeks, 1)
        actual_weekly = round((start_kg - latest_kg) / weeks, 2) if weeks > 0 else 0
        stale_days = (_date.today() - latest_d).days

        if weeks < 2:
            verdict = "too early to judge pace"
        elif latest_kg > start_kg + 0.3:
            verdict = "REGAINING — weight is above the starting point"
        elif expected_loss > 0 and actual_loss < 0.5 * expected_loss:
            verdict = "BEHIND PACE — losing far less than the prescribed deficit predicts"
        elif expected_loss > 0 and actual_loss > 1.3 * expected_loss:
            verdict = "ahead of pace"
        else:
            verdict = "roughly on track"

        lines = ["# WEIGHT-LOSS PROGRESS"]
        lines.append(f"- Goal: lose {goal_kg} kg from {start_kg} kg "
                     f"(~{round(expected_weekly, 2)} kg/wk expected).")
        lines.append(f"- {start_kg} kg → {latest_kg} kg over ~{round(weeks, 1)} weeks "
                     f"(lost {actual_loss} of ~{expected_loss} kg expected by now).")
        lines.append(f"- Actual ~{actual_weekly} kg/wk vs ~{round(expected_weekly, 2)} kg/wk plan.")
        if stale_days > 14:
            lines.append(f"- ⚠ Last weigh-in {stale_days} days ago — data may be stale.")
        lines.append(f"- Verdict: {verdict}.")
        if "BEHIND" in verdict or "REGAIN" in verdict:
            lines.append(
                "- If behind/regaining, do NOT just deepen the calorie deficit: check "
                "whether weight-loss-resistance drivers are unaddressed (under-optimised "
                "thyroid / TSH > 2.5, insulin resistance, high cortisol or poor sleep, "
                "perimenopause, or weight-gain medications such as SSRIs / beta-blockers / "
                "steroids), and whether protein + resistance training are protecting lean "
                "mass. Recompute the target off OBSERVED loss rather than the predicted TDEE.")
        lines.append("")
        return "\n".join(lines)
    except Exception:
        return None


def _build_context(client: dict, plan: dict | None, sessions: list[dict],
                   event_summary: str, triggered_by: str) -> str:
    """Build the prompt context for Haiku — keep it compact (~3-5K tokens)."""
    lines = []
    lines.append("# CLIENT")
    lines.append(f"- ID: {client.get('client_id')}")
    lines.append(f"- Name: {client.get('display_name', '?')}")
    lines.append(f"- Sex: {client.get('sex', '?')}")
    lines.append(f"- Age band: {client.get('age_band', '?')}")
    lines.append(f"- Active conditions: {', '.join(client.get('active_conditions', []) or []) or '—'}")
    lines.append(f"- Medical history: {', '.join(client.get('medical_history', []) or []) or '—'}")
    lines.append(f"- Medications: {', '.join(client.get('current_medications', []) or []) or '—'}")
    lines.append(f"- Allergies: {', '.join(client.get('known_allergies', []) or []) or '—'}")
    lines.append(f"- Goals: {', '.join(client.get('goals', []) or []) or '—'}")
    lines.append("")

    # AI-summarised intake insights (v0.72). One Haiku call after intake
    # submit produces this map — patterns + red flags + top hypotheses +
    # what coach should verify in session. Flows into the rework AI here
    # so the rework hypothesis lands in the right clinical frame.
    insights = client.get("intake_insights")
    if insights and isinstance(insights, dict):
        lines.append("# INTAKE INSIGHTS (AI-summarised at submit)")
        patterns = insights.get("patterns") or []
        if patterns:
            lines.append("Patterns:")
            for p in patterns:
                lines.append(f"- {p}")
        red_flags = insights.get("red_flags") or []
        if red_flags:
            lines.append("Red flags (protocol-gating):")
            for r in red_flags:
                lines.append(f"- ⚠ {r}")
        hyps = insights.get("top_hypotheses") or []
        if hyps:
            lines.append("Top FM hypotheses:")
            for h in hyps:
                if isinstance(h, dict):
                    conf = h.get("confidence")
                    conf_str = f" ({int(conf * 100)}%)" if isinstance(conf, (int, float)) else ""
                    lines.append(f"- {h.get('driver','?')}{conf_str} — {h.get('reasoning','')}")
        coach_notes = (insights.get("coach_notes_for_ai") or "").strip()
        if coach_notes:
            lines.append(f"Coach correction / addition: {coach_notes}")
        lines.append("")

    if plan:
        lines.append("# CURRENT ACTIVE PLAN")
        lines.append(f"- Slug: {plan.get('slug')}")
        lines.append(f"- Status: {plan.get('status')}")
        lines.append(f"- Plan period: {plan.get('plan_period_weeks', 12)} weeks")
        topics = plan.get("topics_in_plan") or plan.get("topics") or []
        if topics:
            lines.append(f"- Topics: {', '.join(topics if isinstance(topics, list) else [str(t) for t in topics])}")
        symptoms = plan.get("symptoms_addressed") or []
        if symptoms:
            lines.append(f"- Symptoms addressed: {', '.join(symptoms)}")
        supps = plan.get("supplement_protocol") or []
        if supps:
            lines.append("- Supplements:")
            for s in supps[:15]:
                if isinstance(s, dict):
                    lines.append(f"  - {s.get('supplement_slug', s.get('name', '?'))}: {s.get('dose', '')} {s.get('timing', '')}".rstrip())
        lifestyle = plan.get("lifestyle_practices") or []
        if lifestyle:
            lines.append(f"- Lifestyle practices: {len(lifestyle)} items")
        protocols = plan.get("attached_protocols") or []
        if protocols:
            lines.append(f"- Attached protocols: {', '.join(protocols)}")
    else:
        lines.append("# CURRENT ACTIVE PLAN")
        lines.append("(none — client has no active plan)")
    lines.append("")

    # Weight-loss progress (#2) — make the rework AI weight-aware so a stall
    # or regain actually shapes the suggestion instead of being invisible.
    wp = _weight_progress_summary(client)
    if wp:
        lines.append(wp)

    # Surface every lab the client already has values for so the AI doesn't
    # propose redundant orders. This block is the upstream fix for the
    # apply-time dedup we added in 086808e — better to never suggest it
    # in the first place than to silently drop at apply.
    on_file: dict[str, list[tuple[str, str, str]]] = {}  # name → [(date, value, unit)]
    for snap in client.get("health_snapshots") or []:
        date = (snap or {}).get("date", "")
        for lv in (snap or {}).get("lab_values") or []:
            name = ((lv or {}).get("test_name") or "").strip()
            if not name:
                continue
            value = (lv or {}).get("value")
            unit = (lv or {}).get("unit") or ""
            on_file.setdefault(name, []).append((date, str(value) if value is not None else "?", unit))
    if on_file:
        lines.append(f"# LABS ALREADY ON FILE ({len(on_file)} markers)")
        lines.append(
            "Do NOT propose lab_order for any of these markers — the client "
            "already has results. Reference the value in your rationale if "
            "relevant. Only propose new labs that aren't listed here."
        )
        for name, entries in sorted(on_file.items()):
            # Most recent value (entries are in insertion order; sort by date desc)
            entries_sorted = sorted(entries, key=lambda e: e[0], reverse=True)
            date, value, unit = entries_sorted[0]
            lines.append(f"- {name}: {value} {unit}".rstrip() + f"  ({date})")
        lines.append("")

    # IFM timeline — antecedents/triggers/mediators chronologically.
    # Surfaces upstream drivers (toxic exposures, surgeries, big life
    # stress) the rework AI should consider before just chasing the
    # symptom du jour. Fed into the AI sanity check too (ai_check.py).
    timeline = client.get("timeline_events") or []
    if timeline:
        lines.append(f"# IFM TIMELINE ({len(timeline)} events)")
        lines.append(
            "Antecedents / triggers / mediators in the client's history. "
            "If the current plan ignores an upstream driver flagged here, "
            "raise it in your rationale and propose follow_up_action."
        )
        # Sort by year/date for chronology; events without dates trail.
        def _sort_key(ev: dict) -> tuple:
            y = ev.get("year") or 9999
            d = ev.get("date") or ""
            return (y, d)
        for ev in sorted(timeline, key=_sort_key):
            when = ev.get("date") or (str(ev.get("year")) if ev.get("year") else "?")
            cat = ev.get("category", "life_event")
            lines.append(f"- {when} [{cat}] {ev.get('event', '')}")
        lines.append("")

    # Coach-authored timeline / ATM notes from plan.notes_for_coach.
    # The assess pipeline writes a "## IFM Timeline (AI-classified)" section
    # into notes when the suggester returned ifm_timeline. Surface it here
    # so the rework AI sees the upstream synthesis it (or a prior turn) made.
    notes = (plan or {}).get("notes_for_coach") or ""
    if "## IFM Timeline" in notes or "## ATM" in notes:
        # Pull the relevant block — everything from the first IFM/ATM heading
        # to the next top-level heading or end.
        idx = notes.find("## IFM Timeline")
        if idx < 0:
            idx = notes.find("## ATM")
        if idx >= 0:
            tail = notes[idx:]
            # Stop at next ## that isn't a sub-heading of the same block
            next_idx = tail.find("\n## ", 4)
            block = tail if next_idx < 0 else tail[:next_idx]
            lines.append("# COACH/AI ATM SYNTHESIS (from plan notes)")
            lines.append(block.strip())
            lines.append("")

    lines.append("# TRIGGERING EVENT")
    lines.append(f"- Type: {triggered_by}")
    lines.append(f"- Summary: {event_summary}")
    lines.append("")

    if sessions:
        lines.append(f"# RECENT SESSIONS (last {len(sessions)})")
        # Strip the audit tag prefixes ([session_type:…] [source:…]
        # [template:…] [type:…]) AND the webhook envelope
        # ("WhatsApp message from <name>...") so the AI sees the body the
        # client actually wrote, not provenance metadata.
        import re as _re
        _TAG_PREFIX = _re.compile(r"^(\s*\[[^\]]+\]\s*)+", _re.MULTILINE)
        _WA_ENVELOPE = _re.compile(
            r"^WhatsApp message from [^\n]+\n+Received:[^\n]+\n+",
            _re.IGNORECASE,
        )
        for s in sessions[:5]:
            complaints = s.get("presenting_complaints", "") or ""
            stype = "?"
            channel = ""
            if complaints.startswith("[session_type:"):
                end = complaints.find("]")
                if end > 0:
                    stype = complaints[len("[session_type:"):end].strip()
            if "[source: whatsapp_webhook]" in complaints:
                channel = " · CLIENT WHATSAPP"
            elif "[source: whatsapp_outbound]" in complaints:
                channel = " · coach WhatsApp out"

            # Body extraction: prefer coach_notes (set by hand-typed
            # forms); fall back to the stripped presenting_complaints
            # (set by webhook). Webhook sessions almost always have
            # empty coach_notes — that was the bug.
            coach_notes = (s.get("coach_notes") or "").strip()
            body = coach_notes
            if not body:
                body = _TAG_PREFIX.sub("", complaints)
                body = _WA_ENVELOPE.sub("", body).strip()
            body = body[:400]
            if body:
                lines.append(f"- {s.get('date', '?')} {stype}{channel}: {body}")
            else:
                lines.append(f"- {s.get('date', '?')} {stype}{channel}: (no body)")

    return "\n".join(lines)


_TOOL_SCHEMA = {
    "name": "rework_assessment",
    "description": "Assess whether the current plan should be revised given the triggering event.",
    "input_schema": {
        "type": "object",
        "properties": {
            "benefit_pct": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": (
                    "Estimated improvement (0-100) the client would see from a "
                    "revised plan vs continuing the current one. 0-30 = no rework "
                    "needed; 30-60 = minor adjustments; 60-80 = significant rework "
                    "warranted; 80-100 = current plan misses the mark."
                ),
            },
            "confidence": {
                "type": "string",
                "enum": ["low", "medium", "high"],
                "description": "How confident you are in this assessment.",
            },
            "rationale": {
                "type": "string",
                "description": (
                    "2-3 sentence explanation. Be specific — name the new finding, "
                    "name what the current plan is missing, name the proposed shift."
                ),
            },
            "suggested_changes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "op": {"type": "string", "enum": ["add", "remove", "escalate", "deescalate", "swap"]},
                        "target_kind": {"type": "string", "enum": ["supplement", "topic", "practice", "lab_order", "education"]},
                        "target_slug": {"type": ["string", "null"]},
                        "description": {"type": "string"},
                        "reason": {"type": "string"},
                        "intake_evidence": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Short coach-readable phrases citing the intake observations "
                                "that justify THIS change. Pull from `INTAKE INSIGHTS` block "
                                "(patterns / red_flags / hypotheses / coach corrections) AND "
                                "any structured intake field (medications, COVID history, "
                                "bowel pattern, etc.) that drove this revision. Format each "
                                "entry as the observation plus a parenthetical tag of the "
                                "source field, e.g. 'PPI use 3+ years (acid_suppressants)', "
                                "'Wakes at 3am (wake_time_pattern)', 'Coach correction: "
                                "client stopped GLP-1 (coach_notes_for_ai)'. Empty list when "
                                "the revision came from the triggering event alone with no "
                                "intake contribution. Most-decisive observation first; up to "
                                "4 items per change. Coach reads these inline as a 💡 audit "
                                "chip on the rework suggestion."
                            ),
                        },
                    },
                    "required": ["op", "target_kind", "description", "reason"],
                },
            },
        },
        "required": ["benefit_pct", "confidence", "rationale", "suggested_changes"],
    },
}


_SYSTEM = """You are an FM-trained clinical advisor reviewing whether a client's \
current plan should be revised in light of a new event (lab result, symptom report, \
or test finding).

Your job is to be honest about the magnitude of the change needed. Do NOT inflate \
benefit_pct to suggest rework when the new info is already addressed by the current \
plan. Do NOT recommend rework when the change is minor and can be handled in a \
check-in note.

Score guidance:
- 0-30%: No rework needed. Current plan covers it; mention in check-in.
- 30-60%: Minor adjustments. Add 1-2 supplements / tweak doses / add a lab.
- 60-80%: Significant rework. New driver discovered that current plan misses; \
  needs new topics / supplements / phases.
- 80-100%: Current plan misses the mark entirely. Rebuild around the new finding.

Rationale must be specific:
  ✗ "New finding suggests plan adjustments may help"
  ✓ "GI-MAP shows H. pylori (++) and elevated zonulin. Current plan focuses on \
     adrenal recovery but doesn't address gut infection — needs a 4-6 week \
     antimicrobial phase (mastic gum + matula) before resuming adrenal support."

Suggested changes must use real catalogue slugs when possible (e.g. supplement \
slug 'mastic-gum' not 'mastic gum'). Use null for target_slug when proposing \
something not in the catalogue.

Lab-order rule: ONLY propose lab_order for markers NOT already in the \
'LABS ALREADY ON FILE' block. If a marker is on file, reference its value \
in your rationale instead — never re-order it. If you're unsure whether a \
client has had a marker tested, default to not proposing it (apply-time \
dedup will skip it anyway, but you waste tokens).

INTAKE-EVIDENCE TRACEABILITY (v0.72): populate `intake_evidence` on every \
suggested_change WHEN an intake observation justified or strengthens the \
change. Pull from:
  - the INTAKE INSIGHTS block at the top of the prompt (patterns, red flags,
    top FM hypotheses, coach corrections)
  - the COACH/AI ATM SYNTHESIS block if present
  - the IFM TIMELINE block
  - any specific medication / lab / symptom field surfaced elsewhere in the
    context

Format each entry as ONE short coach-readable phrase naming the observation
in plain English with a parenthetical source tag. Examples:
  "PPI use 3+ years (acid_suppressants)"
  "On Ozempic 0.5mg weekly (glp1_medications)"
  "3 antibiotic courses last year (antibiotics_last_12mo)"
  "Wakes consistently at 3am (wake_time_pattern)"
  "Coach correction: client stopped GLP-1 (coach_notes_for_ai)"

If a change came solely from the triggering event (e.g. new lab finding)
and no intake observation reinforced it, use an empty list `[]`. Don't
fabricate citations. Coach corrections in `coach_notes_for_ai` OVERRIDE
AI inferences from raw fields — if the coach said something contradicts
the intake form, treat the coach's note as ground truth and cite it."""


def main() -> int:
    _load_env()

    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 1

    client_id = payload.get("client_id", "").strip()
    triggered_by = payload.get("triggered_by", "unknown")
    event_summary = (payload.get("event_summary") or "").strip()[:2000]
    dry_run = bool(payload.get("dry_run", False))

    if not client_id:
        json.dump({"ok": False, "error": "client_id required"}, sys.stdout)
        return 1

    client = _load_client(client_id)
    if not client:
        json.dump({"ok": False, "error": f"client {client_id} not found"}, sys.stdout)
        return 1

    plan = _find_active_plan(client_id)
    sessions = _recent_sessions(client_id, limit=5)

    if dry_run:
        suggestion = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "triggered_by": triggered_by,
            "benefit_pct": 35,
            "confidence": "low",
            "rationale": f"[dry-run] Would assess rework benefit for {triggered_by}: {event_summary[:80]}",
            "suggested_changes": [],
        }
        client["rework_suggestion"] = suggestion
        _save_client(client_id, client)
        json.dump({"ok": True, "suggestion": suggestion}, sys.stdout)
        return 0

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        json.dump({"ok": False, "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 1

    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    context = _build_context(client, plan, sessions, event_summary, triggered_by)

    from _api_guard import require_api_authorized  # cost guard C
    require_api_authorized("assess-rework.py")
    aclient = Anthropic(api_key=api_key)
    try:
        resp = aclient.messages.create(
            model="claude-haiku-4-5",
            max_tokens=2048,
            system=_SYSTEM,
            tools=[_TOOL_SCHEMA],
            tool_choice={"type": "tool", "name": "rework_assessment"},
            messages=[{"role": "user", "content": context}],
        )
    except Exception as e:
        json.dump({"ok": False, "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    tool_input = None
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use":
            tool_input = block.input
            break

    if not tool_input:
        json.dump({"ok": False, "error": "model did not return tool_use block"}, sys.stdout)
        return 1

    suggestion = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "triggered_by": triggered_by,
        "benefit_pct": int(tool_input.get("benefit_pct", 0)),
        "confidence": tool_input.get("confidence", "low"),
        "rationale": tool_input.get("rationale", ""),
        "suggested_changes": tool_input.get("suggested_changes") or [],
    }

    # Preserve dismissed_at / snoozed_until from prior suggestion ONLY if the
    # new benefit_pct is similar or lower (don't carry over dismissals across
    # bigger changes).
    prior = client.get("rework_suggestion") or {}
    prior_pct = prior.get("benefit_pct", 0)
    if prior.get("dismissed_at") and suggestion["benefit_pct"] <= prior_pct + 10:
        suggestion["dismissed_at"] = prior["dismissed_at"]
    if prior.get("snoozed_until") and suggestion["benefit_pct"] <= prior_pct + 10:
        suggestion["snoozed_until"] = prior["snoozed_until"]

    client["rework_suggestion"] = suggestion
    _save_client(client_id, client)

    json.dump({"ok": True, "suggestion": suggestion}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
