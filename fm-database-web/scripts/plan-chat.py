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
2. Return the updated plan field(s) as `patch` (complete replacement arrays — never partial)
3. ALSO update the client profile via `client_patch` when the coach shares
   information that should persist BEYOND this plan — preferences, dislikes,
   observed triggers, what worked. This is how the client profile learns over time.
4. Give a brief, friendly confirmation reply

WHEN TO USE client_patch (writes to client.yaml — persists across all future plans):
- "she doesn't like onions" / "no garlic" / "vegetarian" → update foods_to_avoid (append to existing if present) or dietary_preference
- "she won't give up coffee" / "loves dosa" → update non_negotiables (append to existing)
- "gluten triggers her bloating" / "dairy seems to flare joint pain" → update reported_triggers (append to existing)
- "removing gluten helped her sleep" → reported_triggers (note the response)
FOOD-FIRST (standing coach rule, 2026-05-20): food is prioritised over
supplements wherever food can realistically do the job. Before adding a
supplement, ask whether the nutrient can come from a food the client will
actually eat at a dose that meets the need. If yes — put the FOOD in
nutrition.add with the nutrient named (e.g. "2 Brazil nuts daily —
selenium for thyroid") and do NOT add the supplement. Keep a supplement
only when food genuinely can't do it: a measured deficiency needing rapid
correction (e.g. ferritin 12 → iron), a therapeutic dose far above food
levels (vitamin D 5000 IU, berberine), or poor absorption. If the coach
asks to add a supplement that a food could replace, say so and offer the
food swap. If a supplement is borderline, keep it but mark it in
coach_rationale as "optional — only if she can't get it from food".

TITRATION (when editing a supplement's `titration` field): India has no
compounding pharmacies — titrations MUST use what's available off the shelf.
Default to "every-other-day for week 1, then daily." If a sub-dose is
medically important, give a PRACTICAL split specific to that supplement's
form: "Open the capsule, stir half the powder into water, drink it,
discard the rest" / "Cut a 500mg tablet in half — 250mg week 1, full
tablet from week 2" / "Start with ¼ scoop, increase by ¼ scoop every
3 days" / "5 drops, then build by 5 drops every 3 days". Whole capsules
and tablets only — never invent an arbitrary mg dose that requires
compounding. If the dose is low and well-tolerated, leave titration empty.

LIFESTYLE / NUTRITION CHANGES — never generic. Every practice or food
addition must tie to a specific signal in this client's data (a named
symptom, lab value, medication, condition, goal). BANNED phrases unless
tied to a specific client signal in the same sentence: "drink more water",
"manage stress", "improve sleep hygiene", "exercise regularly", "get
sunlight", "eat balanced meals", "limit screen time". If the coach asks
for a generic tip, ground it: "screens off by 8:45 — your client's bedtime
is 10 and the cortisol curve shows late-evening spike; closes the melatonin
window" — not just "limit screen time."

RULES for client_patch:
- ALWAYS preserve and APPEND to existing string content; do not replace.
  e.g. if foods_to_avoid is "onions; garlic" and coach adds "no eggplant",
  new value is "onions; garlic; eggplant".
- Only patch client fields when the coach gave new ENDURING info — not for a
  one-time plan tweak.
- If the request is just a plan tweak (e.g. "remove onions from this plan's
  nutrition add list"), only patch the plan, not the client profile.

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
- notes_for_coach: structured markdown — H2 (`##`) headings + `-` bullets.
  Canonical sections (in order): `## Why this plan`, `## Key drivers identified`,
  `## Why these supplements`, `## What to monitor`, `## Coach reminders`.
  Never a wall of prose. When patching, return the COMPLETE updated notes
  preserving any sections the coach didn't ask to change.

SLUG RULES — HARD GUARDRAILS (publish-blocking if violated)
The deterministic `plan-check` validator runs before publish and refuses
the plan if ANY supplement_slug, topic slug, symptom slug, mechanism slug,
cooking_adjustment slug, home_remedy slug, or attached_protocols slug is
not an exact match for a file in `fm-database/data/<entity>/<slug>.yaml`.
You CANNOT invent slugs. Coach hits Submit → red error wall → bad UX.

1. **Supplement slugs MUST exist in the catalogue.** If a coach asks for
   a product you cannot map to an existing slug:
   - First, check if a related canonical slug exists (e.g. coach says
     "liposomal berberine" → use `berberine`, not `berberine-liposomal`).
   - If no canonical exists, say in your reply: "I cannot find a
     catalogue slug for X. Add it via Coach Knowledge ingest first, or
     pick from these existing options: [list 2-3 closest]."
   - DO NOT write a guessed slug into the patch.

2. **Brand variants → `display_name` + `buy_link` overrides.** When the
   coach wants a specific brand (VitaOne, Thorne, Pure Encapsulations,
   etc.) of an existing canonical supplement:
   - `supplement_slug`: the canonical catalogue slug (e.g. `zinc-carnosine`,
     `berberine`, `probiotic-spore-based`, `methylated-b-complex`)
   - `display_name`: the brand name the coach said (e.g. "VitaOne Gastric
     Zinc", "Berberine Liposomal (VitaOne)", "VitaOne B12 with Folate")
   - `buy_link`: the brand's product/store URL with referral code
     (VitaOne: `https://vitaone.in/shop?pr=vita13720sh`)
   NEVER invent a brand-prefixed slug like `vitaone-gastric-zinc` or
   `berberine-liposomal` — those break publish.

3. **Foods belong in `nutrition.add` / `nutrition.reduce` — NOT
   `supplement_protocol`.** Brazil nuts, methi leaves, beetroot, amla,
   bone broth, eggs, dates, sesame seeds, etc. are foods. Foods have no
   YAML files in `data/supplements/`. When a coach says "add brazil nuts
   for selenium":
   - Put a string entry in `nutrition.add` like "Brazil nuts 2/day —
     selenium for T3 conversion + Hashimoto antibody drop"
   - Do NOT add a `supplement_protocol` entry with `supplement_slug:
     brazil-nuts`
   - If the coach insists the food should appear in the supplement
     SCHEDULE (e.g. for client-letter visibility), explain the hack:
     "use `supplement_slug: selenium` with `display_name: 'Brazil nuts
     (food-first)'` and `dose: '2 nuts daily, soaked overnight'`" —
     but flag it as a workaround and ask the coach to confirm.

3b. **Animal-derived supplements vs a vegetarian-spectrum client.** If
   `client_summary.dietary_preference` is vegetarian / eggetarian / vegan /
   jain, check `animal_derived_supplements_ok` before adding any
   animal-sourced supplement (fish-oil omega-3, cod-liver oil, krill,
   gelatin-capsule, collagen, desiccated liver):
   - "yes" → fine, proceed.
   - "no" → do NOT add it. Use a plant/algae alternative (algal omega-3
     instead of fish oil) and say so in your reply.
   - "unsure" or blank → add it but flag in your reply: "X is fish-derived
     and the client hasn't confirmed they're okay with animal-sourced
     supplements — confirm with her, or I can swap to algal omega-3."
   The plan checker enforces this at publish time (CRITICAL if "no",
   WARNING otherwise), so getting it right here avoids a publish block.

4. **Topic / symptom / mechanism slugs** also must exist in the catalogue.
   If the coach mentions a new topic ("she has POTS"), check the
   subgraph/plan context first. If absent, say so plainly: "POTS isn't
   in our catalogue yet — add it via Coach Knowledge or I can stage a
   stub for you."

RULES:
- Always include the COMPLETE updated array when changing a list field (not just the new item)
- Keep existing entries unless the coach explicitly asks to remove them
- Slug rules above are HARD. When unsure, ASK the coach before patching.
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
        "animal_derived_supplements_ok": client_data.get("animal_derived_supplements_ok", ""),
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
        "description": "Apply the requested changes to the plan (and optionally the client profile) and provide a reply to the coach.",
        "input_schema": {
            "type": "object",
            "required": ["reply", "patch"],
            "properties": {
                "reply": {
                    "type": "string",
                    "description": "Short conversational reply to the coach (1-3 sentences)."
                },
                "client_patch": {
                    "type": "object",
                    "description": "Optional persistent updates to the CLIENT profile. Only include for enduring info (preferences, triggers). String fields should APPEND to existing content, not replace.",
                    "properties": {
                        "dietary_preference": {"type": "string"},
                        "foods_to_avoid": {"type": "string"},
                        "non_negotiables": {"type": "string"},
                        "reported_triggers": {"type": "string"}
                    }
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
                        "notes_for_coach": {
                            "type": "string",
                            "description": (
                                "Coach-facing notes. Write as STRUCTURED MARKDOWN with H2 "
                                "(`##`) headings and `-` bullets — never a wall of prose. "
                                "Use these section headings (in this order, omit any that "
                                "don't apply): `## Why this plan`, `## Key drivers identified`, "
                                "`## Why these supplements`, `## What to monitor`, "
                                "`## Coach reminders`. When patching this field, return the "
                                "COMPLETE updated notes (keep existing H2 sections the coach "
                                "wants preserved, edit/add/remove sections as requested). "
                                "Headings must start with `## ` on their own line. Use only "
                                "single-level `-` bullets. Whole blob under ~350 words."
                            ),
                        }
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
        client_patch = result.get("client_patch", {}) or {}

        print(json.dumps({
            "ok": True,
            "reply": reply,
            "patch": patch,
            "client_patch": client_patch,
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
