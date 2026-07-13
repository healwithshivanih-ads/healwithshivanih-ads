#!/usr/bin/env python3
"""Promote an AI-generated (recipe-pack) recipe straight into the catalogue.

The coach's Plan tab flags dishes served by an AI-generated recipe and offers
"Add to catalogue". That recipe is a pack shape ({title, ingredients[str],
method[str]}) with no inbox candidate — so this is a thin sibling of
approve-recipe-candidate.py that takes the recipe INLINE, derives diet +
allergens, computes deterministic nutrients, and writes
fm-database/data/_recipes/<slug>.yaml.

Reads JSON from stdin:
  { "name": str, "ingredients": [str], "steps": [str],
    "meal_type": [str]?, "diet": [str]?, "client_diet": str?, "force": bool? }
Writes JSON to stdout:
  { "ok": true, "slug": str, "warnings": [str] }
  { "ok": false, "needs_confirm": true, "warnings": [str] }   # re-call with force
  { "ok": false, "error": str }
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
RECIPES_DIR = FMDB_ROOT / "data" / "_recipes"

try:
    from nutrients_lib import NutrientTable, apply_to_recipe, compute_recipe_nutrients
except Exception:  # pragma: no cover
    NutrientTable = None  # type: ignore

MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack", "side", "drink", "salad", "soup", "condiment"}

MEAT_RE = re.compile(r"\b(chicken|mutton|lamb|beef|pork|fish|prawn|shrimp|crab|seafood|meat|keema|kheema|bacon|ham|turkey|liver)\b", re.I)
EGG_RE = re.compile(r"\begg(s|y)?\b|omelette|omelet|bhurji|shakshuka|frittata", re.I)
_ALLERGEN_RULES = (
    ("dairy", r"\b(milk|curd|dahi|yogurt|yoghurt|paneer|cheese|cream|butter|khoya|malai)\b"),
    ("gluten", r"\b(wheat|atta|maida|suji|rava|semolina|dalia|seitan|barley|bread|pasta)\b"),
    ("nuts", r"\b(almond|cashew|walnut|pistachio|hazelnut|pecan)\b"),
    ("peanut", r"\b(peanut|groundnut|moongphali)\b"),
    ("sesame", r"\b(sesame|til|tahini)\b"),
    ("soy", r"\b(soy|soya|tofu|tempeh|edamame)\b"),
    ("egg", r"\begg(s|y)?\b|omelette|bhurji|shakshuka"),
    ("fish", r"\b(fish|prawn|shrimp|crab|seafood|anchovy)\b"),
)


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}))
    raise SystemExit(0)


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "recipe"


def _unique_slug(base: str) -> str:
    slug, n = base, 2
    while (RECIPES_DIR / f"{slug}.yaml").exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


def _name_tokens(name: str) -> set[str]:
    return {t for t in re.sub(r"[^a-z0-9 ]", " ", (name or "").lower()).split() if len(t) >= 4}


def _similar_existing(name: str) -> str | None:
    want = _name_tokens(name)
    if not want:
        return None
    for p in RECIPES_DIR.glob("*.yaml"):
        if p.name.startswith("_"):
            continue
        try:
            other = yaml.safe_load(p.read_text()) or {}
        except Exception:
            continue
        toks = _name_tokens(str(other.get("name") or ""))
        if toks and len(want & toks) / max(len(want | toks), 1) >= 0.75:
            return p.stem
    return None


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception as e:  # noqa: BLE001
        _fail(f"bad JSON: {e}")
    name = str(payload.get("name") or "").strip()
    ingredients = [str(x).strip() for x in (payload.get("ingredients") or []) if str(x).strip()]
    steps = [str(x).strip() for x in (payload.get("steps") or []) if str(x).strip()]
    force = bool(payload.get("force"))
    if not name or not ingredients or not steps:
        _fail("name, ingredients and steps are all required")

    # duplicate guard (coach can force)
    dup = _similar_existing(name)
    if dup and not force:
        print(json.dumps({"ok": False, "needs_confirm": True,
                          "warnings": [f"A similar recipe already exists: {dup}. Add anyway?"]}))
        return 0

    warnings: list[str] = []
    ing_text = " ".join(ingredients).lower()

    # diet: explicit → else derive from ingredients + client diet
    diet = [str(x).lower() for x in (payload.get("diet") or []) if str(x).strip()]
    if not diet:
        if MEAT_RE.search(ing_text):
            diet = ["non_vegetarian"]
        elif EGG_RE.search(ing_text):
            diet = ["eggetarian"]
        else:
            diet = ["vegetarian"]
        cd = str(payload.get("client_diet") or "").lower()
        if "vegan" in cd and diet == ["vegetarian"] and not re.search(r"\b(milk|curd|dahi|paneer|ghee|cheese|honey)\b", ing_text):
            diet = ["vegetarian", "vegan"]
    # safety: a veg/vegan recipe must never carry meat/egg
    if MEAT_RE.search(ing_text) and "non_vegetarian" not in diet:
        diet = ["non_vegetarian"]
        warnings.append("meat/fish detected — diet set to non_vegetarian")

    allergens = sorted({a for a, rx in _ALLERGEN_RULES if re.search(rx, ing_text)})
    # ghee alone is NOT dairy (library convention)
    if "dairy" in allergens and not re.search(r"\b(milk|curd|dahi|yogurt|yoghurt|paneer|cheese|cream|khoya|malai)\b", ing_text):
        allergens.remove("dairy")

    meal_type = [m for m in (payload.get("meal_type") or []) if m in MEAL_TYPES] or ["lunch", "dinner"]

    slug = _unique_slug(_slugify(name))
    record = {
        "slug": slug,
        "name": name,
        "meal_type": meal_type,
        "diet": diet,
        "region": "Indian",
        "seasons": ["all"],
        "balances_dosha": [],
        "aggravates_dosha": [],
        "rasa": [],
        "main_ingredients": ingredients[:12],
        "contains_allergens": allergens,
        # flat pack strings kept as the item line; the nutrient engine parses
        # embedded qty/unit. Coach can refine quantities after promoting.
        "ingredients": [{"item": ing, "qty": "", "unit": ""} for ing in ingredients],
        "steps": steps,
        "servings": "2",
        "one_line": f"{name} — a simple, home-style Indian recipe.",
        "attribution": {"author": "Shivani Hari", "source_id": "shivani-hari-original"},
        "image": {
            "file": f"images/web/{slug}.jpg",
            "credit": "web reference (auto-sourced)",
            "source_url": "",
            "rights_status": "none",
            "note": "promoted from an AI-generated recipe — source a licensed/original photo before external use",
        },
        "sources": [{"id": "shivani-hari-original", "location": name}],
        "version": 1,
        "status": "active",
        "updated_at": date.today().isoformat(),
        "updated_by": "Shivani",
        "provenance": "promoted_from_ai_pack",
    }

    if NutrientTable is not None:
        try:
            table = NutrientTable()
            result = compute_recipe_nutrients(record, table)
            apply_to_recipe(record, result)
            if result.get("coverage_pct", 100) < 70:
                warnings.append(f"nutrient coverage {result['coverage_pct']:.0f}% — refine ingredient quantities")
        except Exception as e:  # noqa: BLE001
            warnings.append(f"nutrient computation skipped: {e}")

    (RECIPES_DIR / f"{slug}.yaml").write_text(
        yaml.safe_dump(record, sort_keys=False, allow_unicode=True)
    )
    print(json.dumps({"ok": True, "slug": slug, "warnings": warnings}))
    return 0


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"promote crashed: {type(e).__name__}: {e}"}))
