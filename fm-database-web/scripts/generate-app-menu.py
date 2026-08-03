#!/usr/bin/env python3
"""Generate the client's menu DIRECTLY as structured plan.app_menu — no letter.

Letters are retired as a data layer (coach decision 2026-06-12): only the
welcome email (the tab-by-tab app guide) is still sent; menus live on the published plan and the
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
  - plan.nutrition.custom_remedies ← condition-matched morning rituals appended
    idempotently (ghee water, soaked raisins, chia, methi, figs — gated per
    client; see morning_rituals.py). Additive only: never overwrites or
    duplicates existing / coach-authored entries. (coach directive 2026-07-12)
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
sys.path.insert(0, str(Path(__file__).resolve().parent))  # scripts dir

from meal_foods import relevant_meal_foods  # noqa: E402
from menu_hygiene import scrub_menu_days  # noqa: E402
from model_output import usable_dicts  # noqa: E402
from morning_rituals import ensure_morning_rituals  # noqa: E402

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
                                                        "'Moong dal (1 bowl) + jowar roti (2) + lauki sabzi (1 cup)'. "
                                                        "Every component is a DISH the client eats — never a raw "
                                                        "tempering spice (garlic, ginger, turmeric, cumin, mustard "
                                                        "seeds, hing, black pepper, etc.) listed as its own "
                                                        "component; those belong inside the dish's recipe. Join "
                                                        "components ONLY with ' + ' — never 'then:', '—', or any "
                                                        "other narrative connector. The FIRST component is shown as "
                                                        "the meal's title in the app, so it must be the actual "
                                                        "headline dish, not a spice or garnish."
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
components — nothing else. Never write "then:", "—", or any other
narrative connector inside a dish string, and never list a raw
tempering spice (garlic, ginger, turmeric, cumin, mustard seeds, hing,
black pepper, etc.) as its own component — those belong inside the
dish's recipe, not spelled out at the meal level. The FIRST component
becomes the meal's title in the app, so it must always be the actual
headline dish. No markdown, no emoji markers, no calorie counts in the
dish text. Vary dishes across the days and between the two weeks.
"""


def _normalised_weeks(menu_weeks) -> list[dict]:
    """Validate + normalise the model's `weeks` into app_menu week records.

    Raises ValueError with a coach-readable message; main() turns that into the
    ok:false payload.

    The posture here is STRICTER than the recipe pack, and it is the existing
    `len(days) != 7` bail that sets it: the client EATS from this menu, so a
    week or a day going missing without anyone noticing is worse than no menu.
    A malformed week or day is therefore FATAL and named — not skipped —
    because skipping one would ship a menu that looks complete and isn't.

    Slots are the one exception, and only because the surrounding code already
    treats them as droppable (it filters out any slot with a blank dish). A junk
    slot costs one meal from a day the client can still read, so it is skipped
    and reported like every other malformed element.

    Note `days` is length-checked before the element check on purpose — a bare
    7-character string would otherwise pass `len(days) == 7` and fall into the
    comprehension one character at a time.
    """
    if not isinstance(menu_weeks, list):
        raise ValueError(
            f"model returned {type(menu_weeks).__name__} for 'weeks' (expected list): "
            f"{str(menu_weeks)[:120]}"
        )
    norm_weeks = []
    for w in menu_weeks:
        if not isinstance(w, dict):
            raise ValueError(
                f"model returned {type(w).__name__} where a week object belongs: {str(w)[:120]}"
            )
        days = w.get("days") or []
        if len(days) != 7:
            raise ValueError(f"week {w.get('week')} returned {len(days)} days (need 7)")
        bad_day = next((d for d in days if not isinstance(d, dict)), None)
        if bad_day is not None:
            raise ValueError(
                f"week {w.get('week')}: model returned {type(bad_day).__name__} where a day "
                f"object belongs: {str(bad_day)[:120]}"
            )
        norm_days = [
            {"slots": [
                {"slot": s.get("slot", ""), "dish": str(s.get("dish", "")).strip()}
                for s in usable_dicts(d.get("slots"), f"app-menu week {w.get('week')}", "slot")
                if str(s.get("dish", "")).strip()
            ]}
            for d in days
        ]
        # A capsule is not a meal — it is already on the supplement schedule,
        # and counting it as a dish double-tells the client and skews the
        # menu's nutrient tally. See scripts/menu_hygiene.py.
        for note in scrub_menu_days(norm_days):
            print(f"[app-menu] week {w.get('week')}: supplement dose removed — {note}", file=sys.stderr)
        norm_weeks.append({
            "week": int(w.get("week") or 0),
            "day_dates": None,
            "days": norm_days,
        })
    return norm_weeks


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

    # Condition-appropriate therapeutic foods to weave in AS DISHES — the
    # kitchen_remedy / vegetable_juice foods (kitchari, buttermilk, …) the app
    # no longer surfaces as standalone remedies on a detailed plan (coach
    # directive 2026-06-15). The menu is where the client receives them.
    mfoods = relevant_meal_foods(plan, client)
    if mfoods:
        prompt += (
            "\n\nCONDITION-APPROPRIATE THERAPEUTIC FOODS — weave these into the "
            "weeks as REAL DISHES in the slot where they fit (e.g. a kitchari "
            "dinner, a glass of spiced buttermilk with lunch, an Agni-reset "
            "light dinner). They are part of this client's protocol and the menu "
            "is where she receives them — do not list them separately. Keep them "
            "occasional and natural (a few times across the fortnight, not "
            "daily), each with an explicit portion. ONLY genuine foods eaten as a "
            "dish qualify — NEVER put a medicinal tea, tonic, kashayam, kadha, "
            "churan or single-herb decoction into a meal slot; those are remedies, "
            "not meal components:\n"
            + "\n".join(f"- {f['name']} — {f['why']}" for f in mfoods)
        )

    # The negative half of the same question. `relevant_meal_foods` above says
    # what this client's conditions call FOR; this says what they call for care
    # with — and it is preparation + frequency guidance, never a ban list, so
    # it composes with the grain-rotation rules instead of overriding them.
    try:
        from food_cautions import live_cautions, prompt_block
        _cautions = prompt_block(live_cautions(client, plan))
    except Exception:
        _cautions = ""
    if _cautions:
        prompt += (
            "\n\nFOOD CAUTIONS FOR THIS CLIENT'S CONDITIONS — these foods are NOT "
            "banned and must NOT be stripped from the menu; most are genuinely "
            "good for this client in other ways. You have exactly two levers. "
            "(a) PREPARATION: where a line says \"Always COOKED, never raw\", that "
            "food may appear only in a cooked dish — never in a raw salad or "
            "kachumber; use a lightly-steamed version or a different vegetable. "
            "(b) FREQUENCY: a cautioned food is OCCASIONAL — at most 2-3 times "
            "across the whole fortnight, and never the default base of the menu. "
            "If a cautioned grain is used for rotation, other grains must carry "
            "the rest of the weeks. The client's framework, diet and avoid rules "
            "still outrank this. NEVER name the condition, the mechanism, or the "
            "word \"caution\" to the client:\n" + _cautions
        )

    if dry_run:
        menu_weeks = [
            {"week": w, "days": [{"slots": [{"slot": s, "dish": f"[dry-run dish w{w}d{d}]"} for s in SLOTS]} for d in range(7)]}
            for w in weeks_wanted
        ]
        usage = None
    else:
        _step("calling Sonnet (menu composition, ~1-2 min)")
        import anthropic

        from _api_guard import require_api_authorized  # cost guard C
        require_api_authorized("generate-app-menu.py")
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
    try:
        norm_weeks = _normalised_weeks(menu_weeks)
    except ValueError as e:
        json.dump({"ok": False, "error": str(e)}, sys.stdout)
        return 1
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

    # Condition-matched morning rituals (ghee water, soaked raisins, chia, methi,
    # figs) appended idempotently to nutrition.custom_remedies — additive only,
    # never overwrites coach hand-adds, never duplicates, and menu regen never
    # touches custom_remedies again after this. (coach directive 2026-07-12)
    added_rituals = ensure_morning_rituals(doc, client)

    amendments = doc.get("amendments") or []
    amendments.append({
        "at": datetime.now(timezone.utc).isoformat(),
        "by": "coach",
        "field": "app_menu",
        "summary": f"Menu weeks {sorted(w['week'] for w in norm_weeks)} generated for the app (no letter)."
        + (f" Day 1 anchored: {day1}." if day1 else ""),
    })
    if added_rituals:
        amendments.append({
            "at": datetime.now(timezone.utc).isoformat(),
            "by": "coach",
            "field": "nutrition.custom_remedies",
            "summary": "Auto-added condition-matched morning ritual(s): " + ", ".join(added_rituals) + ".",
        })
        doc["app_content_updated_at"] = datetime.now(timezone.utc).isoformat()
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
