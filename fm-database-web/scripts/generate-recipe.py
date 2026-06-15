#!/usr/bin/env python3
"""Generate ONE structured recipe with AI and add it to the shared library.

Plan-tab dish picker (2026-06-15): when the coach wants a dish that isn't in
fm-database/data/_recipes/, this shim has Sonnet author a full, diet-safe
recipe (ingredients, steps, kcal, times) and writes it to the library so the
dish links everywhere (method + accurate calories + grocery; photo follows
once sourced). "Generate on request" half of the picker's AI option.

Reads JSON from stdin:
  { "client_id": str, "dish_name": str, "slot": str?, "dry_run": bool? }

Writes JSON to stdout:
  { "ok": bool, "slug": str, "title": str, "kcal_per_serving": int|null,
    "error": str|null }
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
RECIPES_DIR = FMDB_ROOT / "data" / "_recipes"
sys.path.insert(0, str(FMDB_ROOT))
sys.path.insert(0, str(SCRIPTS_DIR))

MODEL = "claude-sonnet-4-6"


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


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env).expanduser().resolve() if env else Path.home() / "fm-plans"


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "recipe"


def _unique_slug(base: str) -> str:
    slug, n = base, 2
    while (RECIPES_DIR / f"{slug}.yaml").exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


_TOOL = {
    "name": "record_recipe",
    "description": "Record one structured Indian home recipe.",
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Clean dish name, title case, no portions."},
            "one_line": {"type": "string", "description": "One warm sentence describing the dish."},
            "diet": {
                "type": "array",
                "items": {"type": "string", "enum": ["vegan", "vegetarian", "eggetarian", "non_vegetarian", "gluten_free", "dairy_free"]},
            },
            "main_ingredients": {"type": "array", "items": {"type": "string"}},
            "ingredients": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "item": {"type": "string"},
                        "qty": {"type": "string"},
                        "unit": {"type": "string"},
                    },
                    "required": ["item"],
                },
            },
            "steps": {"type": "array", "items": {"type": "string"}, "minItems": 2},
            "servings": {"type": "integer"},
            "prep_time_min": {"type": "integer"},
            "cook_time_min": {"type": "integer"},
            "kcal_per_serving": {"type": "integer"},
            "balances_dosha": {"type": "array", "items": {"type": "string", "enum": ["vata", "pitta", "kapha"]}},
        },
        "required": ["name", "ingredients", "steps", "servings", "kcal_per_serving", "diet", "main_ingredients"],
    },
}


def _system(diet_pref: str) -> str:
    rules = [
        "You are Shivani, a functional-medicine coach in India, authoring a recipe for a client's plan.",
        "Write a simple, home-style recipe — real household cooking, no exotic ingredients, no restaurant elaboration. Default to everyday Indian home cooking UNLESS the request names a different cuisine or style, then honour that.",
        f"The client's dietary preference is: {diet_pref or 'not stated'}. RESPECT IT ABSOLUTELY:",
        "- vegetarian → no meat, fish, or egg.",
        "- eggetarian → vegetarian + eggs allowed.",
        "- vegan → no dairy (milk, ghee, curd, paneer), no honey.",
        "- jain → vegetarian AND no onion, garlic, potato, or any underground/root vegetable.",
        "- non-vegetarian → anything is fine.",
        "Portions and kcal_per_serving must be realistic for one person (weight-aware plans).",
        "Steps: 3-7 concise home-cooking steps. main_ingredients: the key components only.",
        "Set `diet` to the most restrictive labels the recipe genuinely satisfies (a plain dal is vegan + gluten_free).",
    ]
    return "\n".join(rules)


def main() -> None:
    _load_dotenv()
    payload = json.loads(sys.stdin.read() or "{}")
    client_id = (payload.get("client_id") or "").strip()
    dish_name = (payload.get("dish_name") or "").strip()
    slot = (payload.get("slot") or "").strip()
    cuisine = (payload.get("cuisine") or "").strip()
    note = (payload.get("note") or "").strip()
    if not dish_name:
        print(json.dumps({"ok": False, "error": "dish_name required"}))
        return

    client = {}
    cy = _plans_root() / "clients" / client_id / "client.yaml"
    if cy.exists():
        try:
            client = yaml.safe_load(cy.read_text()) or {}
        except Exception:
            client = {}
    diet_pref = str(client.get("dietary_preference") or "")
    avoid = client.get("foods_to_avoid") or []
    avoid_list = [str(a).strip() for a in avoid if str(a).strip()] if isinstance(avoid, list) else (
        [str(avoid).strip()] if str(avoid).strip() else []
    )

    user = f"Create a recipe for: {dish_name}"
    if cuisine:
        user += f"\nCuisine / style: {cuisine}"
    if slot:
        user += f"\nIt will be served as: {slot}"
    if note:
        user += f"\nCOACH INSTRUCTION (follow this closely): {note}"
    if avoid_list:
        user += f"\nNEVER use these — the client avoids them: {', '.join(avoid_list)}"
    conds = client.get("active_conditions") or []
    if isinstance(conds, list) and conds:
        user += f"\nClient context (keep it gentle on digestion where relevant): {', '.join(map(str, conds[:5]))}"

    if payload.get("dry_run"):
        print(json.dumps({"ok": True, "dry_run": True, "slug": _slugify(dish_name), "title": dish_name, "prompt_chars": len(user)}))
        return

    from anthropic_client import build_client  # noqa: E402

    api = build_client()
    try:
        resp = api.messages.create(
            model=MODEL,
            max_tokens=1500,
            system=_system(diet_pref),
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "record_recipe"},
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"API call failed: {e}"}))
        return

    if resp.stop_reason == "max_tokens":
        print(json.dumps({"ok": False, "error": "output truncated — not saved"}))
        return
    rec: dict[str, Any] | None = None
    for block in resp.content:
        if getattr(block, "type", "") == "tool_use":
            rec = block.input  # type: ignore[assignment]
            break
    if not rec or not rec.get("name") or not rec.get("steps"):
        print(json.dumps({"ok": False, "error": "model returned no recipe"}))
        return

    title = str(rec["name"]).strip()
    slug = _unique_slug(_slugify(title))
    ingredients = [
        {"item": str(i.get("item", "")).strip(), "qty": str(i.get("qty", "")).strip(), "unit": str(i.get("unit", "")).strip()}
        for i in (rec.get("ingredients") or [])
        if i.get("item")
    ]
    doc = {
        "slug": slug,
        "name": title,
        "meal_type": [slot.lower()] if slot else [],
        "diet": list(rec.get("diet") or []),
        "region": "Indian",
        "seasons": ["all"],
        "balances_dosha": list(rec.get("balances_dosha") or []),
        "aggravates_dosha": [],
        "main_ingredients": [str(m) for m in (rec.get("main_ingredients") or [])],
        "contains_allergens": [],
        "ingredients": ingredients,
        "steps": [str(s) for s in (rec.get("steps") or [])],
        "servings": str(rec.get("servings") or 2),
        "prep_time_min": int(rec.get("prep_time_min") or 0),
        "cook_time_min": int(rec.get("cook_time_min") or 0),
        "one_line": str(rec.get("one_line") or ""),
        "source": "ai_generated (coach dish picker)",
        "created": date.today().isoformat(),
        "status": "active",
        "kcal_per_serving": int(rec.get("kcal_per_serving") or 0),
    }

    RECIPES_DIR.mkdir(parents=True, exist_ok=True)
    (RECIPES_DIR / f"{slug}.yaml").write_text(
        yaml.safe_dump(doc, sort_keys=False, width=100, allow_unicode=True)
    )

    try:
        from fmdb.usage import log_usage  # noqa: E402

        log_usage(client_id=client_id, script="generate-recipe.py", model=MODEL, usage=resp.usage, notes=f"recipe {slug}")
    except Exception:
        pass

    print(json.dumps({"ok": True, "slug": slug, "title": title, "kcal_per_serving": doc["kcal_per_serving"], "error": None}))


if __name__ == "__main__":
    main()
