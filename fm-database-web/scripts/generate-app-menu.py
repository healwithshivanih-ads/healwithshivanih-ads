#!/usr/bin/env python3
"""Generate the client's menu DIRECTLY as structured plan.app_menu — no letter.

Letters are retired as a data layer (coach decision 2026-06-12): only the
worded welcome letter is still sent; menus live on the published plan and the
client app renders them natively. This script reuses the meal-plan letter's
entire constraint engine (dosha food rules, exclusions, seasonality, calorie
targets, protein floors — everything in _build_prompt_meal_plan) but forces
structured tool output instead of letter prose.

stdin:  {
  "client_id": str,
  "plan_slug": str,
  "weeks": [1, 2],            # which rotation weeks to (re)generate; default [1, 2]
  "weight_loss": {...} | null,
  "coach_notes": str,
  "dry_run": bool             # build prompt + write path with a stub menu, no API
}
stdout: {"ok": bool, "weeks": N, "dishes": N, "day1_anchored": "YYYY-MM-DD"|null, "error": str|null}

Side effects on the PUBLISHED plan YAML:
  - plan.app_menu  ← {is_sample, synced_from: "ai_generated", synced_at, weeks[]}
    (weeks NOT in the requested list are preserved — fortnight regeneration
    replaces only the weeks asked for)
  - plan.meal_plan_started_on ← today (IST) IF unset — Day 1 anchors on the
    first menu going live in the app (coach decision 2026-06-12, replaces the
    old "first meal-plan letter send" anchor). Once set it is IMMUTABLE.
  - plan.amendments  ← audit entry
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR") or Path.home() / "fm-plans")
sys.path.insert(0, str(FMDB_ROOT))

SLOTS = ["Breakfast", "Mid-morning", "Lunch", "Evening snack", "Dinner"]
IST = timezone(timedelta(hours=5, minutes=30))


def _step(msg: str) -> None:
    print(f"[generate-app-menu] {msg}", file=sys.stderr, flush=True)


def _load_letter_module():
    """importlib-load render-client-letter.py (hyphenated filename)."""
    p = Path(__file__).resolve().parent / "render-client-letter.py"
    spec = importlib.util.spec_from_file_location("render_client_letter", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


_TOOL = {
    "name": "record_app_menu",
    "description": "Record the structured weekly menu for the client's app.",
    "input_schema": {
        "type": "object",
        "properties": {
            "weeks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "week": {"type": "integer"},
                        "days": {
                            "type": "array",
                            "minItems": 7,
                            "maxItems": 7,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "slots": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "slot": {"type": "string", "enum": SLOTS},
                                                "dish": {
                                                    "type": "string",
                                                    "description": (
                                                        "Components joined with ' + ', each with an explicit "
                                                        "household portion in brackets, e.g. "
                                                        "'Moong dal (1 bowl) + jowar roti (2) + lauki sabzi (1 cup)'."
                                                    ),
                                                },
                                            },
                                            "required": ["slot", "dish"],
                                        },
                                    }
                                },
                                "required": ["slots"],
                            },
                        },
                    },
                    "required": ["week", "days"],
                },
            }
        },
        "required": ["weeks"],
    },
}

_OVERRIDE = """

══════════════════════════════════════════════════════════════════
OUTPUT FORMAT OVERRIDE — READ THIS LAST, IT WINS
══════════════════════════════════════════════════════════════════
IGNORE every instruction above about writing a letter: no greeting, no
markdown, no prose, no recipes appendix, no week tables. All the FOOD
RULES above (dietary preference, foods to avoid, non-negotiables, dosha
guidance, seasonality, calorie/protein targets, dish variety) still
apply in full — they govern WHAT you put in each slot.

Call the record_app_menu tool exactly once with weeks {weeks_list}.
Each week has EXACTLY 7 days (Monday..Sunday). Each day uses these
slots in order: Breakfast, Mid-morning, Lunch, Evening snack, Dinner.

Dish strings: short, concrete, client-readable, with an EXPLICIT
single-serving portion on EVERY component — written
"Component (qty) + Component (qty)". e.g.
"Moong dal chilla (2) + mint chutney (2 tbsp)" or
"Lauki sabzi (1 cup) + toor dal (1 bowl) + jowar roti (2)".
Use realistic one-person home portions (this plan is weight-aware);
never leave a component without a quantity — the app shows portions on
every meal and estimates calories from them. Use " + " between
components. No markdown, no emoji markers, no calorie counts in the
dish text. Vary dishes across the days and between the two weeks.
"""


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id = payload.get("client_id", "")
    plan_slug = payload.get("plan_slug", "")
    weeks_wanted = payload.get("weeks") or [1, 2]
    weight_loss = payload.get("weight_loss") if isinstance(payload.get("weight_loss"), dict) else {}
    coach_notes = (payload.get("coach_notes") or "").strip()
    dry_run = bool(payload.get("dry_run"))

    _step("loading letter engine")
    rcl = _load_letter_module()
    rcl._load_dotenv()

    plan = rcl._load_plan(plan_slug)
    if not plan:
        json.dump({"ok": False, "error": f"plan not found: {plan_slug}"}, sys.stdout)
        return 1
    client = rcl._load_client(client_id) or {}

    published = sorted((PLANS_ROOT / "published").glob(f"{plan_slug}-v*.yaml"), reverse=True)
    if not published:
        json.dump({"ok": False, "error": f"{plan_slug} has no published file — publish the plan first"}, sys.stdout)
        return 1
    plan_file = published[0]

    _step("building prompt")
    prompt = rcl._build_prompt_meal_plan(plan, client, weight_loss, coach_notes)
    prompt += _OVERRIDE.replace("{weeks_list}", json.dumps(weeks_wanted))

    if dry_run:
        menu_weeks = [
            {"week": w, "days": [{"slots": [{"slot": s, "dish": f"[dry-run dish w{w}d{d}]"} for s in SLOTS]} for d in range(7)]}
            for w in weeks_wanted
        ]
        usage = None
    else:
        _step("calling Sonnet (menu composition, ~1-2 min)")
        import anthropic

        api_client = anthropic.Anthropic()
        model = os.environ.get("FMDB_LETTER_MODEL", "claude-sonnet-4-6")
        with api_client.messages.stream(
            model=model,
            max_tokens=16000,
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "record_app_menu"},
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for _ in stream.text_stream:
                pass
            msg = stream.get_final_message()
        tool_use = next((b for b in msg.content if b.type == "tool_use"), None)
        if not tool_use:
            json.dump({"ok": False, "error": "model returned no tool call"}, sys.stdout)
            return 1
        menu_weeks = (tool_use.input or {}).get("weeks") or []
        usage = msg.usage
        try:
            from fmdb.usage import log_usage

            log_usage(client_id, "generate-app-menu.py", model, usage, notes=f"app menu {plan_slug} weeks {weeks_wanted}")
        except Exception:
            pass

    # validate + normalise
    norm_weeks = []
    for w in menu_weeks:
        days = w.get("days") or []
        if len(days) != 7:
            json.dump({"ok": False, "error": f"week {w.get('week')} returned {len(days)} days (need 7)"}, sys.stdout)
            return 1
        norm_weeks.append({
            "week": int(w.get("week") or 0),
            "day_dates": None,
            "days": [
                {"slots": [{"slot": s.get("slot", ""), "dish": str(s.get("dish", "")).strip()} for s in (d.get("slots") or []) if str(s.get("dish", "")).strip()]}
                for d in days
            ],
        })
    if not norm_weeks:
        json.dump({"ok": False, "error": "no weeks in model output"}, sys.stdout)
        return 1

    if dry_run:
        dishes = sum(len(d["slots"]) for w in norm_weeks for d in w["days"])
        json.dump({"ok": True, "dry_run": True, "weeks": len(norm_weeks), "dishes": dishes, "day1_anchored": None, "error": None}, sys.stdout)
        return 0

    _step("writing app_menu into published plan")
    doc = yaml.safe_load(plan_file.read_text()) or {}
    existing = doc.get("app_menu") or {}
    kept = [w for w in (existing.get("weeks") or []) if w.get("week") not in {w2["week"] for w2 in norm_weeks}]
    all_weeks = sorted(kept + norm_weeks, key=lambda w: w.get("week") or 0)
    doc["app_menu"] = {
        "is_sample": len(all_weeks) == 1,
        "synced_from": "ai_generated",
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "weeks": all_weeks,
    }

    # Day 1 anchor: first menu going live IS the protocol start (if unset).
    day1 = None
    if not doc.get("meal_plan_started_on"):
        day1 = datetime.now(IST).date().isoformat()
        doc["meal_plan_started_on"] = day1

    amendments = doc.get("amendments") or []
    amendments.append({
        "at": datetime.now(timezone.utc).isoformat(),
        "by": "coach",
        "field": "app_menu",
        "summary": f"Menu weeks {sorted(w['week'] for w in norm_weeks)} generated for the app (no letter)."
        + (f" Day 1 anchored: {day1}." if day1 else ""),
    })
    doc["amendments"] = amendments

    tmp = plan_file.with_suffix(f".tmp-{os.getpid()}")
    tmp.write_text(yaml.dump(doc, sort_keys=False, width=100, allow_unicode=True))
    tmp.rename(plan_file)

    dishes = sum(len(d["slots"]) for w in norm_weeks for d in w["days"])
    json.dump({
        "ok": True,
        "weeks": len(norm_weeks),
        "dishes": dishes,
        "day1_anchored": day1,
        "error": None,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
