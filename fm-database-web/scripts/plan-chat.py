#!/usr/bin/env python3
"""
plan-chat.py — AI chat to modify a structured plan.

stdin:  JSON {
  plan_slug, client_id, message, history: [{role, content}],
  plan_data: {...plan YAML...},
  client_data: {...client YAML...}
}
stdout: JSON { ok, reply, patch, error }

patch is a partial plan update (complete replacement arrays).
If patch is empty ({}) no plan changes are needed for this turn.
"""

import sys
import json
import os
from pathlib import Path

# Resolve fm-database root and add to path
SCRIPT_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPT_DIR.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

from dotenv import load_dotenv
load_dotenv(FMDB_ROOT / ".env", override=True)

import anthropic

SYSTEM_PROMPT = """You are a functional medicine coaching assistant helping a coach modify a client's structured care plan through conversation.

You have access to the full plan and client profile. When the coach asks for changes:
1. Make the requested modification thoughtfully
2. Return the updated field(s) as a patch (complete replacement arrays — never partial)
3. Give a brief, friendly confirmation reply

PLAN STRUCTURE (reference only — only patch fields that need changing):
- primary_topics: list of topic slugs
- contributing_topics: list of topic slugs
- presenting_symptoms: list of symptom slugs
- hypothesized_drivers: list of {mechanism: str, reasoning: str}
- supplement_protocol: list of {supplement_slug, form?, dose?, timing?, take_with_food?, duration_weeks?, titration?, coach_rationale?}
- lifestyle_practices: list of {name, cadence, details?}
- nutrition: {pattern?, meal_timing?, cooking_adjustments?: [], home_remedies?: [], add?: [], reduce?: []}
- education: list of {target_kind, target_slug, client_facing_summary?}
- lab_orders: list of {test, reason?}
- referrals: list of {to, reason, urgency: routine|soon|urgent|emergency}
- tracking: {habits?: [{name, cadence}], symptoms_to_monitor?: [], recheck_questions?: []}
- notes_for_coach: string

RULES:
- Always include the COMPLETE updated array when changing a list field (not just the new item)
- Keep existing entries unless the coach explicitly asks to remove them
- Use valid supplement slugs from the catalogue when possible; if unsure, use descriptive name
- For lab orders, use clear test names the coach will recognise
- Never hallucinate dosing you're not confident about — mark as "TBD" and note it
- The patch should ONLY contain fields that actually changed
- If the request is conversational (no plan change needed), return patch: {}
- Be concise in your reply — 1-3 sentences max
"""

def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON input: {e}"}))
        sys.exit(0)

    message = data.get("message", "")
    history = data.get("history", [])
    plan_data = data.get("plan_data", {})
    client_data = data.get("client_data", {})

    if not message:
        print(json.dumps({"ok": False, "error": "No message provided"}))
        sys.exit(0)

    # Build context block
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

    # Slim down plan for context (remove large raw fields)
    plan_context = {k: v for k, v in plan_data.items()
                    if k not in ("_bucket", "_file", "status_history", "ai_sanity_check", "raw_yaml")}

    context_block = f"""CURRENT PLAN:
{json.dumps(plan_context, indent=2, ensure_ascii=False)}

CLIENT PROFILE:
{json.dumps(client_summary, indent=2, ensure_ascii=False)}"""

    tool_schema = {
        "name": "update_plan",
        "description": "Apply the requested changes to the plan and provide a reply to the coach.",
        "input_schema": {
            "type": "object",
            "required": ["reply", "patch"],
            "properties": {
                "reply": {
                    "type": "string",
                    "description": "Short conversational reply to the coach (1-3 sentences)."
                },
                "patch": {
                    "type": "object",
                    "description": "Fields to update in the plan. Only include fields that actually changed. Use COMPLETE replacement arrays, not partial additions.",
                    "properties": {
                        "primary_topics": {"type": "array", "items": {"type": "string"}},
                        "contributing_topics": {"type": "array", "items": {"type": "string"}},
                        "presenting_symptoms": {"type": "array", "items": {"type": "string"}},
                        "hypothesized_drivers": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "mechanism": {"type": "string"},
                                    "reasoning": {"type": "string"}
                                }
                            }
                        },
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
                                "cooking_adjustments": {"type": "array", "items": {"type": "string"}},
                                "home_remedies": {"type": "array", "items": {"type": "string"}},
                                "add": {"type": "array", "items": {"type": "string"}},
                                "reduce": {"type": "array", "items": {"type": "string"}}
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
                        "referrals": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "to": {"type": "string"},
                                    "reason": {"type": "string"},
                                    "urgency": {"type": "string", "enum": ["routine", "soon", "urgent", "emergency"]}
                                },
                                "required": ["to", "reason", "urgency"]
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
                        "notes_for_coach": {"type": "string"}
                    }
                }
            }
        }
    }

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print(json.dumps({"ok": False, "error": "ANTHROPIC_API_KEY not set"}))
        sys.exit(0)

    client = anthropic.Anthropic(api_key=api_key)

    # Build messages: context as first user turn, then history, then current message
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": context_block,
                    "cache_control": {"type": "ephemeral"}
                },
                {
                    "type": "text",
                    "text": f"\n\nCoach request: {message}"
                }
            ]
        }
    ]

    # If there's history, restructure: context in system, history in messages
    if history:
        # Use simpler message structure with history
        messages = []
        for turn in history:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": message})

        # Prepend context as first user/assistant exchange
        messages = [
            {"role": "user", "content": f"[Context]\n{context_block}"},
            {"role": "assistant", "content": "Understood. I have the plan and client context. How can I help modify the plan?"},
        ] + messages

    try:
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=4096,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"}
                }
            ],
            tools=[tool_schema],
            tool_choice={"type": "tool", "name": "update_plan"},
            messages=messages,
        )

        # Extract tool use result
        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        if not tool_use:
            print(json.dumps({"ok": False, "error": "No tool use in response"}))
            sys.exit(0)

        result = tool_use.input
        reply = result.get("reply", "Done.")
        patch = result.get("patch", {})

        print(json.dumps({
            "ok": True,
            "reply": reply,
            "patch": patch,
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
