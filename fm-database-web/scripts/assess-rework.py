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

    lines.append("# TRIGGERING EVENT")
    lines.append(f"- Type: {triggered_by}")
    lines.append(f"- Summary: {event_summary}")
    lines.append("")

    if sessions:
        lines.append(f"# RECENT SESSIONS (last {len(sessions)})")
        for s in sessions[:5]:
            stype = "?"
            if s.get("presenting_complaints", "").startswith("[session_type:"):
                end = s["presenting_complaints"].find("]")
                if end > 0:
                    stype = s["presenting_complaints"][len("[session_type:"):end].strip()
            lines.append(f"- {s.get('date', '?')} {stype}: {s.get('coach_notes', '')[:200]}")

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
dedup will skip it anyway, but you waste tokens)."""


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
