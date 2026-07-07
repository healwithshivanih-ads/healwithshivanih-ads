#!/usr/bin/env python3
"""Batch-draft recipe candidates into the recipe inbox for coach review.

Coverage-gap filler (v0.76): the coach names the dishes she wants (e.g. the
P0 vitamin-D / B12 sets from the coverage report), Sonnet drafts each one as
a complete library-schema recipe, and every draft lands in
~/fm-plans/_recipe_inbox/ as a status:"parsed" candidate — the SAME review
surface as WhatsApp forwards. Nothing touches the library until the coach
approves each at /recipes (approve-recipe-candidate.py gates still apply:
dedup, no-porridge, diet consistency, allergens, nutrients).

Reads JSON from stdin:
  {
    "dishes": [
      { "name": str, "gap": str, "meal_type": [str], "diet_note": str,
        "seasons": [str], "intent": str }
    ],
    "batch_size": int?,   # dishes per Sonnet call (default 4)
    "dry_run": bool?
  }
Writes JSON to stdout:
  { "ok": true, "written": int, "failed": [names], "by_gap": {gap: n} }
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))
INBOX_DIR = PLANS_ROOT / "_recipe_inbox"
MODEL = "claude-sonnet-4-6"

sys.path.insert(0, str(FMDB_ROOT))
sys.path.insert(0, str(SCRIPTS_DIR))


def _load_env() -> None:
    env = FMDB_ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


RECIPE_PROPS = {
    "name": {"type": "string"},
    "meal_type": {"type": "array", "items": {"type": "string", "enum": [
        "breakfast", "lunch", "dinner", "snack", "side", "drink", "salad", "soup", "condiment"]}},
    "diet": {"type": "array", "items": {"type": "string", "enum": [
        "vegetarian", "vegan", "jain", "eggetarian", "non_vegetarian",
        "gluten_free", "dairy_free", "nut_free"]}},
    "region": {"type": "string"},
    "seasons": {"type": "array", "items": {"type": "string", "enum": [
        "spring", "summer", "monsoon", "autumn", "winter", "all"]}},
    "balances_dosha": {"type": "array", "items": {"type": "string", "enum": ["vata", "pitta", "kapha"]}},
    "aggravates_dosha": {"type": "array", "items": {"type": "string", "enum": ["vata", "pitta", "kapha"]}},
    "rasa": {"type": "array", "items": {"type": "string", "enum": [
        "sweet", "sour", "salty", "pungent", "bitter", "astringent"]}},
    "main_ingredients": {"type": "array", "items": {"type": "string"}},
    "contains_allergens": {"type": "array", "items": {"type": "string", "enum": [
        "dairy", "gluten", "nuts", "peanut", "soy", "egg", "shellfish", "sesame", "mustard"]}},
    "ingredients": {"type": "array", "items": {"type": "object", "properties": {
        "item": {"type": "string"}, "qty": {"type": "string"}, "unit": {"type": "string"}},
        "required": ["item", "qty", "unit"]}},
    "steps": {"type": "array", "items": {"type": "string"}},
    "servings": {"type": "string"},
    "prep_time_min": {"type": "integer"},
    "cook_time_min": {"type": "integer"},
    "one_line": {"type": "string"},
    "headnote": {"type": "string"},
    "parse_notes": {"type": "string"},
}

TOOL = {
    "name": "record_recipes",
    "description": "Record the drafted recipes.",
    "input_schema": {
        "type": "object",
        "properties": {"recipes": {"type": "array", "items": {
            "type": "object", "properties": RECIPE_PROPS,
            "required": ["name", "meal_type", "diet", "seasons", "main_ingredients",
                         "contains_allergens", "ingredients", "steps", "servings", "one_line"],
        }}},
        "required": ["recipes"],
    },
}

SYSTEM = """You draft recipes for an Indian functional-medicine coach's curated library.
Everyday Indian home cooking — realistic, simple, no exotic ingredients beyond what the
dish itself calls for. Rules:
1. Ingredients carry real single-recipe quantities (tsp/tbsp/cup/g/whole conventions).
2. Steps are concise home-kitchen instructions in your own words (4-7 steps).
3. diet[] derived strictly from the ingredients (vegetarian/vegan/eggetarian/
   non_vegetarian + gluten_free/dairy_free/nut_free when true). jain ONLY if no
   onion/garlic/root vegetables.
4. contains_allergens conservative: dairy (milk/paneer/curd — NOT ghee), gluten, nuts,
   peanut, soy, egg, shellfish, sesame, mustard (dijon-style only, not tempering seeds).
5. balances/aggravates dosha + rasa: fill when clearly inferable, else empty arrays.
6. NEVER a porridge-style dish (no grain-cooked-soft-in-milk preparations).
7. one_line + headnote: warm, plain, no hype. The headnote may carry the nutritional
   intent in food language (e.g. "mushrooms sun-dried gills-up for 20 minutes give a
   real vitamin-D lift") — never clinical jargon.
8. Honour each dish's stated NUTRITIONAL INTENT by emphasising the right ingredients
   at meaningful (but realistic) quantities.
9. parse_notes: one line noting this is an AI-drafted gap-filler for coach review."""


def main() -> int:
    _load_env()
    payload = json.loads(sys.stdin.read() or "{}")
    dishes = payload.get("dishes") or []
    if not dishes:
        print(json.dumps({"ok": False, "error": "no dishes"}))
        return 0
    batch_size = int(payload.get("batch_size") or 4)
    dry_run = bool(payload.get("dry_run"))

    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    written, failed = 0, []
    by_gap: dict[str, int] = {}

    from anthropic_client import build_client

    client = None if dry_run else build_client()

    for i in range(0, len(dishes), batch_size):
        batch = dishes[i: i + batch_size]
        brief = "\n\n".join(
            f"### {d['name']}\n- gap set: {d['gap']}\n- meal_type: {', '.join(d.get('meal_type') or [])}\n"
            f"- diet: {d.get('diet_note') or 'vegetarian'}\n- seasons: {', '.join(d.get('seasons') or ['all'])}\n"
            f"- NUTRITIONAL INTENT: {d.get('intent') or ''}"
            for d in batch
        )
        user = (
            f"Draft these {len(batch)} recipes, one record per dish, in the order given. "
            f"Use each dish's stated seasons and honour its nutritional intent.\n\n{brief}"
        )
        if dry_run:
            drafts = [{"name": d["name"], "meal_type": d.get("meal_type") or ["lunch"],
                       "diet": ["vegetarian"], "seasons": d.get("seasons") or ["all"],
                       "main_ingredients": ["x"], "contains_allergens": [],
                       "ingredients": [{"item": "x", "qty": "1", "unit": "cup"}],
                       "steps": ["Cook."], "servings": "2", "one_line": "dry run"}
                      for d in batch]
        else:
            try:
                resp = client.messages.create(
                    model=MODEL, max_tokens=8192, system=SYSTEM,
                    messages=[{"role": "user", "content": user}],
                    tools=[TOOL], tool_choice={"type": "tool", "name": "record_recipes"},
                )
                drafts = []
                for block in resp.content:
                    if block.type == "tool_use" and block.name == "record_recipes":
                        drafts = list(block.input.get("recipes") or [])
                try:
                    from fmdb.usage import log_usage  # type: ignore
                    log_usage(None, "batch-draft-recipe-candidates", MODEL, resp.usage,
                              notes=f"batch of {len(batch)}")
                except Exception:
                    pass
            except Exception as e:  # noqa: BLE001
                failed.extend(d["name"] for d in batch)
                print(f"batch failed: {e}", file=sys.stderr)
                continue

        by_name = { (d.get("name") or "").strip().lower(): d for d in drafts }
        for spec in batch:
            draft = by_name.get(spec["name"].strip().lower()) or (drafts.pop(0) if drafts else None)
            if not draft or not draft.get("ingredients"):
                failed.append(spec["name"])
                continue
            cid = f"rc-{datetime.now(timezone.utc).date().isoformat()}-{uuid.uuid4().hex[:8]}"
            candidate = {
                "id": cid,
                "received_at": datetime.now(timezone.utc).isoformat(),
                "source": "ai_batch",
                "from_phone": None,
                "from_name": None,
                "text": f"AI gap-fill draft ({spec['gap']}): {spec['name']} — {spec.get('intent','')}",
                "source_url": None,
                "media_file": None,
                "media_mime": None,
                "status": "parsed",
                "gap": spec["gap"],
                "parsed": draft,
                "parsed_at": datetime.now(timezone.utc).isoformat(),
                "parse_model": MODEL,
            }
            (INBOX_DIR / f"{cid}.yaml").write_text(
                yaml.safe_dump(candidate, sort_keys=False, allow_unicode=True))
            written += 1
            by_gap[spec["gap"]] = by_gap.get(spec["gap"], 0) + 1

    print(json.dumps({"ok": True, "written": written, "failed": failed, "by_gap": by_gap}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
