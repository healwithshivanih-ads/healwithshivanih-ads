#!/usr/bin/env python3
"""
generate-follow-up.py — AI-generate a phase-2 follow-up plan from a published plan.

stdin:  JSON {
  old_plan_data: {...},
  client_data: {...},
  new_slug: str,
  check_in_notes: str,      # extracted from old plan.notes_for_coach
  phase_weeks: str,         # e.g. "3-8" — what phase this new plan covers
}
stdout: JSON { ok, plan_patch, error }

plan_patch is a partial plan dict (ready to merge onto the cloned old plan).
"""

import sys
import json
import os
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPT_DIR.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

from dotenv import load_dotenv
load_dotenv(FMDB_ROOT / ".env", override=True)

import anthropic

SYSTEM_PROMPT_NEXT_PHASE = """You are a functional medicine coaching assistant helping a coach create the NEXT-PHASE plan for a client whose current protocol is ending. The client is continuing active care — the new plan progresses the protocol based on how they responded.

You will receive:
- The previous plan (phase 1)
- The client profile
- Check-in notes (how the client responded to phase 1)
- The phase range for the new plan (e.g. "weeks 3–8")

Your job is to return an ADJUSTED plan for the next phase. Rules:

ADJUSTMENTS TO MAKE:
1. Supplements: graduate doses if well-tolerated (e.g. titrate up), remove anything causing issues, add new supplements now the foundation is set
2. Lifestyle: progress difficulty where client succeeded, simplify where they struggled
3. Nutrition: refine based on what was practical vs difficult for this client
4. Labs: include only tests that make sense NOW (based on previous results if mentioned in check-in)
5. Education: update topics to match the new phase focus
6. Tracking: adjust to what matters at this stage
7. Notes for coach: summarise what you changed and why, referencing check-in data
8. Plan period: update start date to today, keep same week count unless specified

KEEP UNCHANGED:
- Primary/contributing topics (these don't change between phases)
- Presenting symptoms (same client, same issues)
- Hypothesized drivers (unless check-in reveals something new)
- Referrals (unless resolved or new ones needed)

FORMAT:
Return ONLY the fields that need to change vs the old plan.
The plan will be cloned from the previous version, so omit anything that stays the same.
"""


SYSTEM_PROMPT_MAINTENANCE = """You are a functional medicine coaching assistant helping a coach create a MAINTENANCE plan. The client has FINISHED their active protocol — symptoms are largely resolved, key habits are established, and they're transitioning to lighter ongoing care.

You will receive:
- The previous plan (the protocol that just finished)
- The client profile
- Check-in notes (how the client responded across the protocol)

Your job is to return a MAINTENANCE plan tuned for the post-protocol phase. Rules:

CORE PRINCIPLE: lighter touch. The client has done the work; the maintenance plan is the durable framework they live on long-term. Strip aggression, keep anchors.

ADJUSTMENTS TO MAKE:
1. Supplements:
   - KEEP only the foundational ones the client should stay on long-term
     (e.g. vitamin D, magnesium glycinate at lower dose, omega-3, B12 if
     vegetarian — depending on bloodwork). Aim for 2–4 supplements total.
   - REMOVE anything that was symptom-targeted (gut-healing protocols,
     adrenal recovery formulas, anti-inflammatory loading doses, etc.).
     These were corrective, not maintenance.
   - Titrate DOWN where appropriate (e.g. magnesium 600mg → 200mg).
   - Add a single "as-needed" supplement for flare situations (e.g.
     adaptogen for stress weeks, digestive enzymes for travel).
2. Lifestyle: keep the 3–5 habits the client demonstrably internalised.
   Drop the ones they struggled with or only did during active care.
   Add ONE "challenge" if the client is ready (e.g. cold exposure,
   strength training progression).
3. Nutrition: simplify to a 1-sentence pattern + 2–3 non-negotiables.
   Remove the active-care eliminations unless still clinically required.
4. Labs: minimal yearly check-in panel (TSH/fT3/fT4, ferritin, vitamin D,
   B12, HbA1c, lipid panel, hsCRP) PLUS any client-specific markers that
   were elevated and now need long-term monitoring (Lp(a), MMA,
   antibodies if Hashimoto's, etc.). Drop the diagnostic deep-dive labs.
5. Education: shift to self-management topics — "how to recognise a
   flare", "when to come back", "annual reassessment cadence".
6. Tracking: lighter cadence. Monthly self-check-in journal entry,
   quarterly coach touchpoint, annual deep retest. Symptoms-to-monitor
   shrinks to the 2–3 that were the original presenting concerns.
7. Notes for coach: summarise what was removed, why, and what flare-
   triggers should prompt a return to active care.
8. Plan period: extend to 26 weeks (6 months). Recheck date = 6 months out.

KEEP UNCHANGED:
- Primary/contributing topics (still relevant for context)
- Presenting symptoms (history, even if resolved)
- Hypothesized drivers (history)
- Referrals (only if still active/relevant)

FORMAT:
Return ONLY the fields that need to change vs the old plan.
The plan will be cloned from the previous version, so omit anything that stays the same.
"""


def system_prompt_for(intent: str) -> str:
    if intent == "maintenance":
        return SYSTEM_PROMPT_MAINTENANCE
    return SYSTEM_PROMPT_NEXT_PHASE

def extract_checkin_blocks(notes: str) -> str:
    """Extract check-in blocks from notes_for_coach."""
    if not notes:
        return ""
    lines = notes.split("\n")
    blocks = []
    in_block = False
    current = []
    for line in lines:
        if "📋 Check-in" in line or "Check-in" in line and "---" in notes:
            in_block = True
            current = [line]
        elif in_block:
            if line.strip() == "---" and current:
                blocks.append("\n".join(current))
                in_block = False
                current = []
            else:
                current.append(line)
    if current:
        blocks.append("\n".join(current))
    return "\n\n".join(blocks[-3:])  # Last 3 check-ins max


def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON input: {e}"}))
        sys.exit(0)

    old_plan = data.get("old_plan_data", {})
    client_data = data.get("client_data", {})
    new_slug = data.get("new_slug", "")
    phase_weeks = data.get("phase_weeks", "")
    check_in_notes = data.get("check_in_notes", "")

    # Also extract from old plan's notes_for_coach if not provided separately
    if not check_in_notes:
        check_in_notes = extract_checkin_blocks(old_plan.get("notes_for_coach", "") or "")

    client_summary = {
        "display_name": client_data.get("display_name", ""),
        "age_band": client_data.get("age_band", ""),
        "sex": client_data.get("sex", ""),
        "active_conditions": client_data.get("active_conditions", []),
        "current_medications": client_data.get("current_medications", client_data.get("medications", [])),
        "known_allergies": client_data.get("known_allergies", client_data.get("allergies", [])),
        "dietary_preference": client_data.get("dietary_preference", ""),
        "goals": client_data.get("goals", []),
    }

    # Strip noisy fields from old plan
    plan_keys_to_include = [
        "supplement_protocol", "lifestyle_practices", "nutrition",
        "education", "lab_orders", "referrals", "tracking",
        "primary_topics", "contributing_topics", "presenting_symptoms",
        "hypothesized_drivers", "notes_for_coach",
        "plan_period_start", "plan_period_weeks", "plan_period_recheck_date",
    ]
    old_plan_slim = {k: old_plan[k] for k in plan_keys_to_include if k in old_plan}

    import datetime
    today = datetime.date.today().isoformat()

    tool_schema = {
        "name": "generate_follow_up_plan",
        "description": "Generate the adjusted fields for the phase 2 follow-up plan.",
        "input_schema": {
            "type": "object",
            "required": ["plan_patch", "adjustment_summary"],
            "properties": {
                "adjustment_summary": {
                    "type": "string",
                    "description": "2-4 sentence summary of key changes made and why. Will be added to notes_for_coach."
                },
                "plan_patch": {
                    "type": "object",
                    "description": "Fields that changed vs the previous plan. Only include what's different.",
                    "properties": {
                        "supplement_protocol": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "supplement_slug": {"type": "string"},
                                    "form": {"type": "string"},
                                    "dose": {"type": "string"},
                                    "timing": {"type": "string"},
                                    "take_with_food": {"type": "string"},
                                    "duration_weeks": {"type": "number"},
                                    "titration": {"type": "string"},
                                    "coach_rationale": {"type": "string"}
                                },
                                "required": ["supplement_slug"]
                            }
                        },
                        "lifestyle_practices": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "cadence": {"type": "string"},
                                    "details": {"type": "string"}
                                },
                                "required": ["name", "cadence"]
                            }
                        },
                        "nutrition": {
                            "type": "object",
                            "properties": {
                                "pattern": {"type": "string"},
                                "meal_timing": {"type": "string"},
                                "add": {"type": "array", "items": {"type": "string"}},
                                "reduce": {"type": "array", "items": {"type": "string"}}
                            }
                        },
                        "lab_orders": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "test": {"type": "string"},
                                    "reason": {"type": "string"}
                                },
                                "required": ["test"]
                            }
                        },
                        "education": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "target_kind": {"type": "string"},
                                    "target_slug": {"type": "string"},
                                    "client_facing_summary": {"type": "string"}
                                },
                                "required": ["target_kind", "target_slug"]
                            }
                        },
                        "tracking": {
                            "type": "object",
                            "properties": {
                                "habits": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "cadence": {"type": "string"}
                                        }
                                    }
                                },
                                "symptoms_to_monitor": {"type": "array", "items": {"type": "string"}},
                                "recheck_questions": {"type": "array", "items": {"type": "string"}}
                            }
                        },
                        "plan_period_start": {"type": "string"},
                        "plan_period_weeks": {"type": "number"},
                        "plan_period_recheck_date": {"type": "string"}
                    }
                }
            }
        }
    }

    intent = (data.get("intent") or "next_phase").strip()
    if intent not in ("next_phase", "maintenance"):
        intent = "next_phase"

    if intent == "maintenance":
        phase_label = "maintenance graduation"
    else:
        phase_label = f"weeks {phase_weeks}" if phase_weeks else "next phase"
    checkin_block = f"\n\nCHECK-IN NOTES FROM PREVIOUS PLAN:\n{check_in_notes}" if check_in_notes else "\n\n(No check-in notes available — adjust based on standard phase progression)"

    user_message = f"""Please generate an adjusted follow-up plan for {phase_label}.

TODAY: {today}
NEW PLAN SLUG: {new_slug}

CLIENT PROFILE:
{json.dumps(client_summary, indent=2, ensure_ascii=False)}

PREVIOUS PLAN (phase 1):
{json.dumps(old_plan_slim, indent=2, ensure_ascii=False)}{checkin_block}

Generate the plan_patch with adjustments appropriate for {phase_label}. Keep what worked, adjust what didn't, progress the protocol."""

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print(json.dumps({"ok": False, "error": "ANTHROPIC_API_KEY not set"}))
        sys.exit(0)

    client = anthropic.Anthropic(api_key=api_key)

    try:
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=8192,
            system=[{"type": "text", "text": system_prompt_for(intent), "cache_control": {"type": "ephemeral"}}],
            tools=[tool_schema],
            tool_choice={"type": "tool", "name": "generate_follow_up_plan"},
            messages=[{"role": "user", "content": user_message}],
        )

        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        if not tool_use:
            print(json.dumps({"ok": False, "error": "No tool use in response"}))
            sys.exit(0)

        result = tool_use.input
        patch = result.get("plan_patch", {})
        summary = result.get("adjustment_summary", "")

        print(json.dumps({
            "ok": True,
            "plan_patch": patch,
            "adjustment_summary": summary,
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            }
        }))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(0)


if __name__ == "__main__":
    main()
