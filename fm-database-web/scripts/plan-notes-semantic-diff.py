#!/usr/bin/env python3
"""Semantic comparison of `notes_for_coach` between an active plan and a
draft plan. Goes beyond character-count diffing — Haiku reads both notes
and reports what (if anything) materially changed in the clinical
reasoning.

Reads JSON from stdin:
{
  "active_slug": str,
  "draft_slug":  str,
  "active_notes": str,
  "draft_notes":  str,
  "dry_run": bool   (optional — returns mock without API call)
}

Writes JSON to stdout:
{
  "ok": bool,
  "change_type": "none" | "consolidation" | "escalation" | "pivot" | "cleanup" | "unclear",
  "change_summary": str,           # 2–4 sentences in clinical English
  "specific_changes": list[str],   # bullet-form material changes
  "publish_recommendation": "publish_now" | "review_with_client" | "discuss_first" | "discard_draft",
  "severity_hint": "low" | "medium" | "high",
  "error": str | null,
  "usage": { ... }                 # token telemetry
}

CHANGE TYPE TAXONOMY:
- consolidation    Notes refine / clarify existing approach. No new direction.
                   Typical: "Phase 2 adjustments — maintain protocol, conservative titration"
- escalation       Notes add intensity / new interventions / new urgency.
                   Typical: "Add 3rd strength session", "Begin DAO supplementation"
- pivot            Notes reflect a genuine change of direction.
                   Typical: "Switch from gut-first to thyroid-first approach"
- cleanup          Minor rewording / typo fix / formatting only.
                   Typical: no clinical content change at all
- none             No meaningful difference (e.g. only whitespace).
- unclear          Cannot determine — coach should review manually.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"


def _load_env() -> None:
    """Load .env from fm-database root so ANTHROPIC_API_KEY is available."""
    env_path = FMDB_ROOT / ".env"
    if not env_path.exists():
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(env_path, override=True)
    except ImportError:
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            line = line.removeprefix("export ").strip()
            if "=" in line:
                k, _, v = line.partition("=")
                v = v.strip().strip('"').strip("'")
                os.environ.setdefault(k.strip(), v)


def _dry_run_result(active_slug: str, draft_slug: str) -> dict:
    return {
        "ok": True,
        "change_type": "consolidation",
        "change_summary": (
            f"[DRY-RUN] Draft {draft_slug} appears to consolidate the existing "
            f"protocol from {active_slug} without introducing new direction. "
            f"This is a mock response — set dry_run=false for the real comparison."
        ),
        "specific_changes": [
            "[DRY-RUN] No real diff performed.",
        ],
        "publish_recommendation": "review_with_client",
        "severity_hint": "low",
        "error": None,
        "usage": {"input_tokens": 0, "output_tokens": 0, "model": "dry-run"},
    }


SYSTEM_PROMPT = """You are an evidence-aware functional medicine assistant
helping a coach decide whether a draft plan is materially different from
the currently active plan.

You will receive two `notes_for_coach` blocks — the rationale and clinical
reasoning attached to two plan versions for the same client. Your job is
to determine if the draft represents a meaningful clinical change.

Return your analysis via the provided tool. Do not include prose outside
the tool call.

Be specific. Avoid platitudes like "the draft refines the approach" —
quote or paraphrase the actual changes.

CHANGE-TYPE GUIDANCE:
- consolidation: notes refine existing approach without new direction
  (e.g. "Phase 2: maintain protocol, conservative titration of X")
- escalation:    new interventions, increased intensity, new urgency,
                 added referrals, dose increases
- pivot:         genuine change of clinical direction
                 (e.g. swap of root-cause hypothesis, switch of priority)
- cleanup:       minor rewording / formatting only — no clinical change
- none:          truly identical reasoning
- unclear:       cannot determine — coach must review manually

PUBLISH RECOMMENDATION GUIDANCE:
- publish_now:        cleanup or minor consolidation; safe to publish
- review_with_client: any escalation or supplement-level change
- discuss_first:      pivot, contraindication risk, or unclear
- discard_draft:      no meaningful change AND no structural diff
"""


def _call_haiku(active_notes: str, draft_notes: str) -> dict:
    """Call Haiku via Anthropic SDK with tool-use for structured output."""
    try:
        from anthropic import Anthropic
    except ImportError:
        return {
            "ok": False,
            "error": "anthropic SDK not installed in fm-database/.venv",
        }

    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"ok": False, "error": "ANTHROPIC_API_KEY not set"}

    client = Anthropic()

    tool = {
        "name": "report_diff",
        "description": "Report the semantic diff between two plan notes.",
        "input_schema": {
            "type": "object",
            "required": [
                "change_type",
                "change_summary",
                "specific_changes",
                "publish_recommendation",
                "severity_hint",
            ],
            "properties": {
                "change_type": {
                    "type": "string",
                    "enum": [
                        "none",
                        "consolidation",
                        "escalation",
                        "pivot",
                        "cleanup",
                        "unclear",
                    ],
                },
                "change_summary": {
                    "type": "string",
                    "description": "2–4 sentence summary in clinical English.",
                },
                "specific_changes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Bullet list of concrete material changes "
                    "(e.g. 'selenium replaced with Brazil nuts as food source').",
                },
                "publish_recommendation": {
                    "type": "string",
                    "enum": [
                        "publish_now",
                        "review_with_client",
                        "discuss_first",
                        "discard_draft",
                    ],
                },
                "severity_hint": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                },
            },
        },
    }

    user_msg = (
        "ACTIVE PLAN NOTES (current published version):\n"
        "---\n"
        f"{active_notes.strip() or '(empty)'}\n"
        "---\n\n"
        "DRAFT PLAN NOTES (unpublished candidate):\n"
        "---\n"
        f"{draft_notes.strip() or '(empty)'}\n"
        "---\n\n"
        "Use the report_diff tool to report your analysis."
    )

    try:
        with client.messages.stream(
            model=os.environ.get("FMDB_DIFF_MODEL", "claude-haiku-4-5"),
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=[tool],
            tool_choice={"type": "tool", "name": "report_diff"},
            messages=[{"role": "user", "content": user_msg}],
        ) as stream:
            final = stream.get_final_message()
    except Exception as exc:
        return {"ok": False, "error": f"Anthropic API error: {exc}"}

    tool_input: dict | None = None
    for block in final.content:
        if getattr(block, "type", None) == "tool_use":
            tool_input = block.input  # type: ignore[attr-defined]
            break

    if tool_input is None:
        return {
            "ok": False,
            "error": "Model did not return a tool_use block (stop_reason="
            f"{getattr(final, 'stop_reason', '?')}).",
        }

    usage = getattr(final, "usage", None)
    return {
        "ok": True,
        "change_type": tool_input.get("change_type", "unclear"),
        "change_summary": tool_input.get("change_summary", ""),
        "specific_changes": tool_input.get("specific_changes", []),
        "publish_recommendation": tool_input.get(
            "publish_recommendation", "review_with_client"
        ),
        "severity_hint": tool_input.get("severity_hint", "medium"),
        "error": None,
        "usage": {
            "input_tokens": getattr(usage, "input_tokens", 0) if usage else 0,
            "output_tokens": getattr(usage, "output_tokens", 0) if usage else 0,
            "model": getattr(final, "model", "?"),
        },
    }


def main() -> int:
    _load_env()
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        json.dump({"ok": False, "error": f"bad stdin JSON: {exc}"}, sys.stdout)
        return 1

    active_slug = payload.get("active_slug", "")
    draft_slug = payload.get("draft_slug", "")
    active_notes = payload.get("active_notes", "")
    draft_notes = payload.get("draft_notes", "")
    dry_run = bool(payload.get("dry_run", False))

    # Cheap path — if notes are byte-identical, return none/cleanup without API
    if active_notes.strip() == draft_notes.strip():
        json.dump(
            {
                "ok": True,
                "change_type": "none",
                "change_summary": "Coach notes are identical between versions.",
                "specific_changes": [],
                "publish_recommendation": "discard_draft",
                "severity_hint": "low",
                "error": None,
                "usage": {"input_tokens": 0, "output_tokens": 0, "model": "no-call"},
            },
            sys.stdout,
        )
        return 0

    if dry_run:
        json.dump(_dry_run_result(active_slug, draft_slug), sys.stdout)
        return 0

    result = _call_haiku(active_notes, draft_notes)
    json.dump(result, sys.stdout)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
