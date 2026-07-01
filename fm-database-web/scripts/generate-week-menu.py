#!/usr/bin/env python3
"""Auto-draft NEXT WEEK's menu for a client — feedback-integrated, structured.

The weekly replacement for fortnightly meal-plan letters (coach decision
2026-06-12): one Sonnet call reads the plan (tiers, pattern, current menu),
the client (preferences, avoid-list), and EVERYTHING that happened since
last week — check-ins, poll replies, quick notes, coach dish-edits
(amendments), MSQ movement, travel flags — and returns a structured week
(days × slots) plus a one-line client-voiced change_note.

The draft lands on plan.app_menu_pending for coach review in the studio;
nothing reaches the client until Approve.

Reads JSON from stdin:
  { "client_id": str, "plan_slug": str, "target_week": int, "dry_run": bool }

Writes JSON to stdout:
  { "ok": bool, "week": int, "change_note": str, "usage": {...}, "error": str }
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
sys.path.insert(0, str(SCRIPTS_DIR))

from atomic_write import write_text_atomic  # noqa: E402
from meal_foods import relevant_meal_foods  # noqa: E402


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# Weekly auto-draft menus run on Haiku — the coach approves every draft in the
# studio before any client sees it, and the harder downstream siblings (grocery,
# week-recipes) already run on Haiku over these same dishes. Sonnet was ~4x the
# cost on the only recurring per-client-per-week AI cron. Override per-run with
# FMDB_WEEK_MENU_MODEL=claude-sonnet-4-6 if a richer draft is ever wanted.
MODEL = os.environ.get("FMDB_WEEK_MENU_MODEL", "claude-haiku-4-5")

_TOOL = {
    "name": "record_week_menu",
    "description": "Record next week's menu and the client-voiced change note.",
    "input_schema": {
        "type": "object",
        "properties": {
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
                                    "slot": {"type": "string"},
                                    "dish": {
                                        "type": "string",
                                        "description": (
                                            "The meal, with an explicit household portion on EVERY component, "
                                            "written 'Component (qty) + Component (qty)'. "
                                            "e.g. 'Masoor dal (1 bowl) + jowar bhakri (2) + ridge gourd sabzi (1 cup)'."
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
            "change_note": {
                "type": "string",
                "description": "ONE warm sentence to the client: what changed this week and why, anchored in THEIR feedback. Empty string if nothing notable changed.",
            },
        },
        "required": ["days", "change_note"],
    },
}

SYSTEM = """You are drafting NEXT WEEK's menu for a functional-medicine client in India, as their coach Shivani would.

HARD RULES:
1. Stay strictly inside the plan's food framework: dishes built from the EAT-FREELY list; SOMETIMES items at most twice in the week; NEVER use anything on the LEAVE-OUT list or the client's avoid list. Respect the dietary preference absolutely.
2. Keep the same slot structure as the current menu (same slot names, same number of slots per day).
3. VARIATION, not novelty: rotate and vary the current menu's dishes; you may introduce 2-4 new dishes that fit the framework, but the week should feel familiar. Keep preparation simple — everyday Indian home cooking, no exotic ingredients.
4. FEEDBACK IS LAW: if the client or coach signalled anything (rushed mornings, disliked a dish, digestive reaction, travel), adjust the menu accordingly and say so in the change_note. Coach dish-edits in the amendment log are strong preference signals — keep those changes.
5. If a TRAVEL window overlaps this week, make those days restaurant-survivable (simple, widely available dishes) and note it.
6. change_note speaks TO the client, warmly, ≤30 words, no clinical jargon, no lab values. Example: "Swapped your breakfasts to 5-minute options since mornings have been rushed — and kept the khichdi dinners you loved."
7. Repeat dishes across the week where natural (Indian households batch-cook) — 4-5 distinct breakfasts is better than 7.
8. PORTIONS ARE EXPLICIT — every component of every dish carries a clear single-serving household quantity in brackets: "(1 bowl)", "(2)", "(1 cup)", "(small bowl)", "(30 g)", "(1 tbsp)". Write each dish as "Component (qty) + Component (qty)". This lets the app show portions on every meal and estimate calories. Use realistic one-person portions (this plan is weight-aware) — never leave a component without a quantity.
9. THERAPEUTIC FOODS ARE MEALS, NOT REMEDIES — when a CONDITION-APPROPRIATE THERAPEUTIC FOODS list is provided, weave those foods into the week as REAL DISHES in the slot where they fit (e.g. a kitchari dinner, a glass of spiced buttermilk with lunch, an Agni-reset light dinner). They are part of this client's protocol and the menu is where she receives them — do not list them separately. Keep them occasional and natural (1-3 times across the week, not daily), and always with explicit portions."""


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env).expanduser().resolve() if env else Path.home() / "fm-plans"


def _published_file(plan_slug: str) -> Path | None:
    d = _plans_root() / "published"
    cands = sorted(d.glob(f"{plan_slug}-v*.yaml"), reverse=True)
    return cands[0] if cands else None


def _recent_feedback(client_id: str, days: int = 14) -> list[str]:
    """Compact feedback lines from the last N days of sessions."""
    out: list[str] = []
    sess_dir = _plans_root() / "clients" / client_id / "sessions"
    if not sess_dir.exists():
        return out
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    for f in sorted(sess_dir.glob("*.yaml"), reverse=True)[:40]:
        try:
            s = yaml.safe_load(f.read_text()) or {}
        except Exception:
            continue
        date = str(s.get("date") or "")
        if date < cutoff:
            continue
        ci = s.get("checkin_response") or {}
        if ci:
            line = f"[{date} check-in] rating {ci.get('rating')}/5"
            if ci.get("feel"):
                line += f"; says: {str(ci['feel'])[:200]}"
            if ci.get("concerns"):
                line += f"; concerns: {str(ci['concerns'])[:200]}"
            out.append(line)
        pr = s.get("poll_response") or {}
        if pr and not ci:
            out.append(f"[{date} poll] {pr.get('dim')}={pr.get('score')} ({str(pr.get('raw_text'))[:80]})")
        msq = s.get("msq_response") or {}
        if msq:
            out.append(f"[{date} MSQ] total {msq.get('total')} ({msq.get('band')})")
        tr = s.get("travel_response") or {}
        if tr:
            if tr.get("cancelled"):
                out.append(f"[travel] cancelled on {date} — client is back home")
            else:
                out.append(f"[travel] {tr.get('from')} to {tr.get('to')} — {tr.get('context')}")
        pc = str(s.get("presenting_complaints") or "")
        if "quick_note" in pc or "[source: client" in pc:
            body = pc.split("\n\n", 1)[-1][:250]
            if body:
                out.append(f"[{date} note] {body}")
    return out[:15]


def main() -> None:
    _load_dotenv()
    payload = json.loads(sys.stdin.read() or "{}")
    client_id = payload.get("client_id") or ""
    plan_slug = payload.get("plan_slug") or ""
    target_week = int(payload.get("target_week") or 0)
    if not client_id or not plan_slug or target_week < 1:
        print(json.dumps({"ok": False, "error": "client_id, plan_slug, target_week required"}))
        return

    pf = _published_file(plan_slug)
    if not pf:
        print(json.dumps({"ok": False, "error": f"published plan not found: {plan_slug}"}))
        return
    plan = yaml.safe_load(pf.read_text()) or {}
    menu = plan.get("app_menu") or {}
    weeks = menu.get("weeks") or []
    if not weeks:
        print(json.dumps({"ok": False, "error": "plan has no app_menu yet — publish/migrate first"}))
        return

    client_yaml = _plans_root() / "clients" / client_id / "client.yaml"
    client = yaml.safe_load(client_yaml.read_text()) if client_yaml.exists() else {}

    nutrition = plan.get("nutrition") or {}
    # current menu rendered compactly for the prompt
    cur_lines: list[str] = []
    for w in weeks[-2:]:
        cur_lines.append(f"Week {w.get('week')}:")
        for di, d in enumerate(w.get("days") or []):
            slots = ", ".join(f"{s.get('slot')}: {s.get('dish')}" for s in (d.get("slots") or []))
            if slots:
                cur_lines.append(f"  Day {di + 1}: {slots}")

    # coach dish-edits = strong signals
    edits = [
        a.get("summary", "")
        for a in (plan.get("amendments") or [])
        if a.get("field") == "app_menu" and a.get("by") != "system"
    ][-6:]

    feedback = _recent_feedback(client_id)

    # Condition-appropriate therapeutic foods to weave in AS DISHES — these are
    # the kitchen_remedy / vegetable_juice foods (kitchari, buttermilk, …) that
    # the app no longer surfaces as standalone remedies on a detailed plan
    # (coach directive 2026-06-15). The menu is where the client receives them.
    mfoods = relevant_meal_foods(plan, client)
    mfood_lines = [f"- {f['name']} — {f['why']}" for f in mfoods]

    user = "\n".join(
        [
            f"CLIENT: dietary preference: {client.get('dietary_preference') or 'not stated'}; "
            f"avoid: {client.get('foods_to_avoid') or 'none listed'}; "
            f"non-negotiables (keep these): {client.get('non_negotiables') or 'none'}; "
            f"city: {client.get('city') or 'India'}",
            "",
            f"PLAN FRAMEWORK — pattern: {nutrition.get('pattern') or ''}",
            f"EAT FREELY: {', '.join(nutrition.get('add') or [])}",
            f"LEAVE OUT: {', '.join(nutrition.get('reduce') or [])}",
            f"Meal timing: {nutrition.get('meal_timing') or ''}",
            "",
            "CONDITION-APPROPRIATE THERAPEUTIC FOODS (weave these in as real dishes — rule 9):",
            *(mfood_lines or ["none for this client"]),
            "",
            "CURRENT MENU (vary from this):",
            *cur_lines,
            "",
            "COACH DISH-EDITS (keep these preferences):",
            *(edits or ["none"]),
            "",
            "CLIENT FEEDBACK SINCE LAST WEEK:",
            *(feedback or ["none recorded"]),
            "",
            f"Draft WEEK {target_week}.",
        ]
    )

    if payload.get("dry_run"):
        print(json.dumps({"ok": True, "week": target_week, "change_note": "(dry run)", "dry_run": True, "prompt_chars": len(user)}))
        return

    from anthropic_client import build_client  # noqa: E402

    client_api = build_client()
    try:
        resp = client_api.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM,
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "record_week_menu"},
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"API call failed: {e}"}))
        return

    if resp.stop_reason == "max_tokens":
        print(json.dumps({"ok": False, "error": "output truncated — not saved"}))
        return
    tool_input: dict[str, Any] | None = None
    for block in resp.content:
        if getattr(block, "type", "") == "tool_use":
            tool_input = block.input  # type: ignore[assignment]
            break
    if not tool_input or not tool_input.get("days"):
        print(json.dumps({"ok": False, "error": "model returned no menu"}))
        return

    # re-read the plan fresh (avoid clobbering concurrent panel edits)
    plan = yaml.safe_load(pf.read_text()) or {}
    plan["app_menu_pending"] = {
        "week": target_week,
        "days": tool_input["days"],
        "change_note": str(tool_input.get("change_note") or "").strip(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "inputs_summary": f"{len(feedback)} feedback signals, {len(edits)} coach edits",
    }
    write_text_atomic(pf, yaml.safe_dump(plan, sort_keys=False, width=100, allow_unicode=True))

    usage_entry = None
    try:
        from fmdb.usage import log_usage  # noqa: E402

        usage_entry = log_usage(
            client_id=client_id,
            script="generate-week-menu.py",
            model=MODEL,
            usage=resp.usage,
            notes=f"week {target_week} auto-draft for {plan_slug}",
        )
    except Exception:
        pass

    print(
        json.dumps(
            {
                "ok": True,
                "week": target_week,
                "change_note": plan["app_menu_pending"]["change_note"],
                "usage": usage_entry,
                "error": None,
            }
        )
    )


if __name__ == "__main__":
    # Top-level guard: any unhandled exception (build_client auth, a bad plan
    # write, etc.) must surface as clean JSON on stdout — never a bare traceback
    # that the caller sees only as "produced no output" (the silent cl-009
    # failure, 2026-06-29). Full traceback still goes to stderr for the log.
    try:
        main()
    except Exception as e:  # noqa: BLE001
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": f"generate-week-menu crashed: {type(e).__name__}: {e}"}))
