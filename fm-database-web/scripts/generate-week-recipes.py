#!/usr/bin/env python3
"""Generate a recipe pack for a client's CURRENT app menu (weekly cadence).

Reads JSON from stdin:
  {
    "client_id": "cl-006",
    "plan_slug": "geetika-plan-1-2026-05-09-cl-006",
    "weeks": [{"week": 5, "days": [{"dow":"Mon","slots":[{"slot":"Lunch","dish":"..."}]}]}],
    "dietary_preference": "Non-vegetarian",
    "foods_to_avoid": "tomato",
    "dry_run": false
  }

Writes JSON to stdout: { ok, path, count, usage, error }

One Haiku call (tool-use) returns concise Indian home recipes for every
DISTINCT COOKABLE main dish on the menu. Rendered to
meal-plans/<plan_slug>-recipes.md in the exact `### ✦ Title / **Ingredients:**
/ **Method:**` shape the app's parseRecipes() reads. Mirrors
generate-grocery-list.py: menu is the source of truth, model never invents
dishes off-menu, dietary preference + avoid-list are absolute.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
sys.path.insert(0, str(SCRIPTS_DIR))

from atomic_write import write_text_atomic  # noqa: E402


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


MODEL = "claude-haiku-4-5"

# Recipes are generated in batches of this many distinct dishes so the output
# can never overflow the 8192-token cap (a whole multi-week menu in one call
# truncated and saved nothing — the bug this fixes). Mirrors the per-week
# batching in the grocery sibling, with a recursive retry-smaller on top.
DISHES_PER_CALL = 12

_TOOL = {
    "name": "record_recipes",
    "description": "Record the home recipes for the menu's cookable dishes.",
    "input_schema": {
        "type": "object",
        "properties": {
            "recipes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Dish name, Title Case"},
                        "serves": {"type": "string", "description": "e.g. '1' or '1-2'"},
                        "time": {"type": "string", "description": "e.g. '20 min'"},
                        "ingredients": {"type": "array", "items": {"type": "string"}},
                        "method": {"type": "array", "items": {"type": "string"}},
                        "tip": {"type": "string"},
                    },
                    "required": ["title", "ingredients", "method"],
                },
            }
        },
        "required": ["recipes"],
    },
}

SYSTEM = """You are writing simple, authentic Indian home recipes for a functional-medicine client, grounded strictly in their prescribed weekly menu.

HARD RULES:
1. Write a recipe for every DISTINCT COOKABLE main/side dish on the menu — curries, sabzis, dals, khichdis, cheelas, rotis, stews, omelettes/bhurji, poriyals, chutneys, soups. SKIP trivial no-cook items (plain nuts, a piece of fruit, plain curd, tea/coffee, protein shake, methi water, plain boiled eggs) — they need no recipe.
2. NEVER invent dishes that aren't on the menu. If a menu cell combines several dishes ("fish curry + green-bean poriyal + quinoa"), write a SEPARATE recipe for each cookable component.
3. Respect the dietary preference and the avoid-list ABSOLUTELY — if a dish says "no tomato", the recipe uses no tomato. Never introduce a forbidden ingredient.
4. Methods are concise home-cook steps (4-9 numbered steps), Indian kitchen technique + names (tadka, bhuno, dahi, jeera, haldi). Quantities for 1-2 servings.
5. Deduplicate: if the same dish recurs across days, write it ONCE.
6. Keep the whole set tight — typically 10-18 recipes. Sort alphabetically by title."""


def _collect_dishes(payload: dict[str, Any]) -> list[str]:
    seen: list[str] = []
    for wk in payload.get("weeks") or []:
        for day in wk.get("days") or []:
            for s in day.get("slots") or []:
                d = (s.get("dish") or "").strip()
                if d and d not in seen:
                    seen.append(d)
    return seen


def _build_user(payload: dict[str, Any], dishes: list[str]) -> str:
    lines: list[str] = []
    pref = payload.get("dietary_preference") or ""
    avoid = payload.get("foods_to_avoid") or ""
    if pref:
        lines.append(f"DIETARY PREFERENCE (absolute): {pref}")
    if avoid:
        lines.append(f"FOODS TO AVOID (never use): {avoid}")
    lines.append("\nMENU DISHES (write recipes for the cookable ones):")
    for d in dishes:
        lines.append(f"- {d}")
    return "\n".join(lines)


def _render_md(plan_slug: str, recipes: list[dict[str, Any]]) -> str:
    out = ["# Recipes", ""]
    for r in sorted(recipes, key=lambda x: (x.get("title") or "").lower()):
        title = (r.get("title") or "").strip()
        if not title:
            continue
        out.append(f"### ✦ {title}")
        serves = (r.get("serves") or "").strip()
        time = (r.get("time") or "").strip()
        if serves or time:
            out.append(f"**Serves:** {serves or '1'} | **Time:** {time or '—'}")
        out.append("")
        out.append("**Ingredients:**")
        for ing in r.get("ingredients") or []:
            out.append(f"- {str(ing).strip()}")
        out.append("")
        out.append("**Method:**")
        for i, step in enumerate(r.get("method") or [], 1):
            out.append(f"{i}. {str(step).strip()}")
        tip = (r.get("tip") or "").strip()
        if tip:
            out.append("")
            out.append(f"**Tip:** {tip}")
        out.append("")
    return "\n".join(out) + "\n"


def _recipes_for(client, payload, dishes):
    """Return (recipes, last_usage, truncated) for one batch of dishes.

    On a max_tokens stop with >1 dish, split the batch in half and recurse so a
    big batch can never lose output. A single dish that still truncates returns
    truncated=True (the caller fails loudly — we never save clipped work)."""
    resp = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        system=SYSTEM,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "record_recipes"},
        messages=[{"role": "user", "content": _build_user(payload, dishes)}],
    )
    if resp.stop_reason == "max_tokens":
        if len(dishes) <= 1:
            return [], resp.usage, True
        mid = len(dishes) // 2
        a_rec, a_use, a_tr = _recipes_for(client, payload, dishes[:mid])
        if a_tr:
            return a_rec, a_use, True
        b_rec, b_use, b_tr = _recipes_for(client, payload, dishes[mid:])
        return a_rec + b_rec, (b_use or a_use), b_tr
    tool_input = None
    for block in resp.content:
        if getattr(block, "type", "") == "tool_use" and getattr(block, "name", "") == "record_recipes":
            tool_input = block.input  # type: ignore[assignment]
            break
    return ((tool_input or {}).get("recipes") or []), resp.usage, False


def main() -> None:
    _load_dotenv()
    payload = json.loads(sys.stdin.read() or "{}")
    client_id = payload.get("client_id") or ""
    plan_slug = payload.get("plan_slug") or ""
    weeks = payload.get("weeks") or []
    if not client_id or not plan_slug or not weeks:
        print(json.dumps({"ok": False, "error": "client_id, plan_slug and weeks are required", "path": None, "count": 0, "usage": None}))
        return

    plans_root = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans")).expanduser()
    out_path = plans_root / "clients" / client_id / "meal-plans" / f"{plan_slug}-recipes.md"

    if not _collect_dishes(payload):
        print(json.dumps({"ok": False, "error": "no dishes on the menu (principle-based plan?)", "path": None, "count": 0, "usage": None}))
        return

    if payload.get("dry_run"):
        print(json.dumps({"ok": True, "path": str(out_path), "count": len(_collect_dishes(payload)), "usage": None, "error": None, "dry_run": True}))
        return

    from anthropic_client import build_client  # noqa: E402

    client = build_client()
    # Generate in batches of DISHES_PER_CALL distinct dishes so output can never
    # overflow the token cap. Accumulate + dedupe across batches, then ONE atomic
    # write at the end (the Fly-synced .md is never seen half-written).
    dishes = _collect_dishes(payload)
    all_recipes: list[dict[str, Any]] = []
    seen: set[str] = set()
    usage_entry = None
    for i in range(0, len(dishes), DISHES_PER_CALL):
        batch = dishes[i : i + DISHES_PER_CALL]
        try:
            recipes, usage, truncated = _recipes_for(client, payload, batch)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": f"API call failed: {e}", "path": None, "count": 0, "usage": None}))
            return
        if truncated:
            print(json.dumps({"ok": False, "error": "output truncated (max_tokens) on a single dish — not saved", "path": None, "count": 0, "usage": None}))
            return
        for r in recipes:
            key = (r.get("title") or "").strip().lower()
            if key and key not in seen:
                seen.add(key)
                all_recipes.append(r)
        try:
            from fmdb.usage import log_usage  # noqa: E402

            usage_entry = log_usage(
                client_id=client_id,
                script="generate-week-recipes.py",
                model=MODEL,
                usage=usage,
                notes=f"recipe pack batch for {plan_slug}",
            )
        except Exception:
            pass

    if not all_recipes:
        print(json.dumps({"ok": False, "error": "model returned no recipes", "path": None, "count": 0, "usage": None}))
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(out_path, _render_md(plan_slug, all_recipes))
    print(json.dumps({"ok": True, "path": str(out_path), "count": len(all_recipes), "usage": usage_entry, "error": None}))


if __name__ == "__main__":
    main()
