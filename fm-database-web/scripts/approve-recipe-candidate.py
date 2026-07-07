#!/usr/bin/env python3
"""Promote a reviewed recipe-inbox candidate into the recipe library.

Runs the quality gates the library depends on, then writes
fm-database/data/_recipes/<slug>.yaml and marks the candidate approved:

  1. required fields + enum validation (mirrors validate-recipes.py)
  2. duplicate check — name-token similarity against every existing recipe
     (warn + require force; slug collisions get a -2 suffix automatically)
  3. no-porridge guard — standing rule: porridge-type breakfasts are banned
     from client menus, so a porridge recipe needs an explicit force
  4. diet consistency — meat/egg/dairy in the ingredient list strips
     vegetarian/vegan/jain claims; corrections applied and reported
  5. allergen derivation — union of AI-claimed + ingredient-derived
     (dairy/gluten/nuts/peanut/egg/shellfish/soy/sesame; ghee is NOT dairy
     per library convention)
  6. deterministic nutrients — nutrients_per_serving + rich_in via
     nutrients_lib; kcal fields set with kcal_basis "ingredient_table_v1"

Reads JSON from stdin:
  { "candidate_id": "rc-...", "recipe": {...edited draft...}, "force": bool? }
Writes JSON to stdout:
  { "ok": true,  "slug": str, "warnings": [str], "nutrients": {...} }
  { "ok": false, "needs_confirm": true, "warnings": [str] }   # re-call with force
  { "ok": false, "error": str }
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
RECIPES_DIR = FMDB_ROOT / "data" / "_recipes"
PLANS_ROOT = Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))
INBOX_DIR = PLANS_ROOT / "_recipe_inbox"

from nutrients_lib import NutrientTable, compute_recipe_nutrients  # noqa: E402

MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack", "side", "drink", "salad", "soup", "condiment"}
DIETS = {"vegetarian", "vegan", "jain", "eggetarian", "non_vegetarian", "gluten_free", "dairy_free", "nut_free"}
DOSHAS = {"vata", "pitta", "kapha"}
SEASONS = {"spring", "summer", "monsoon", "autumn", "winter", "all"}
RASAS = {"sweet", "sour", "salty", "pungent", "bitter", "astringent"}
ALLERGENS = {"dairy", "gluten", "nuts", "peanut", "soy", "egg", "shellfish", "sesame", "mustard"}

# ingredient keyword -> allergen (ghee deliberately absent — library convention)
ALLERGEN_KEYWORDS = {
    "dairy": ["milk", "paneer", "yogurt", "curd", "cheese", "cream", "butter", "chhena", "khoya"],
    "gluten": ["wheat", "atta", "maida", "barley", "bulgur", "rye", "semolina", "rava", "sooji", "seitan"],
    "nuts": ["almond", "cashew", "walnut", "pistachio", "pecan", "hazelnut", "macadamia"],
    "peanut": ["peanut", "groundnut"],
    "egg": ["egg"],
    "shellfish": ["prawn", "shrimp", "crab", "lobster"],
    "soy": ["soy", "tofu", "tamari", "edamame", "miso"],
    "sesame": ["sesame", "tahini", "til "],
}
MEAT_WORDS = ["chicken", "mutton", "lamb", "fish", "prawn", "shrimp", "crab", "meat", "beef", "pork", "keema"]
ROOT_WORDS = ["onion", "garlic", "potato", "carrot", "beet", "radish", "ginger", "turnip", "yam"]
DAIRY_VEGAN_WORDS = ["milk ", "paneer", "yogurt", "curd", "cheese", "cream", "ghee", "butter", "honey"]

STOPWORDS = {"and", "with", "the", "a", "of", "in", "style", "easy", "quick", "simple", "healthy"}


def _fail(msg: str) -> None:
    json.dump({"ok": False, "error": msg}, sys.stdout)
    sys.exit(0)


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "recipe"


def _unique_slug(base: str) -> str:
    slug, n = base, 2
    while (RECIPES_DIR / f"{slug}.yaml").exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


def _name_tokens(name: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", str(name).lower()) if len(t) > 2 and t not in STOPWORDS}


def _similar_existing(name: str) -> list[str]:
    """Existing recipe names whose token sets overlap heavily with this one."""
    mine = _name_tokens(name)
    if not mine:
        return []
    hits = []
    for p in RECIPES_DIR.glob("*.yaml"):
        try:
            other = yaml.safe_load(p.read_text()) or {}
        except Exception:
            continue
        theirs = _name_tokens(other.get("name", ""))
        if not theirs:
            continue
        overlap = len(mine & theirs)
        if overlap and (overlap / min(len(mine), len(theirs))) >= 0.75:
            hits.append(f"{other.get('name')} ({p.stem})")
    return hits


def _ingredient_text(recipe: dict) -> str:
    parts = []
    for ing in recipe.get("ingredients") or []:
        if isinstance(ing, dict):
            parts.append(str(ing.get("item", "")))
    parts.extend(str(x) for x in recipe.get("main_ingredients") or [])
    return " ".join(parts).lower()


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        _fail("invalid JSON on stdin")

    cid = str(payload.get("candidate_id", ""))
    if not re.fullmatch(r"rc-[a-z0-9\-]+", cid):
        _fail(f"bad candidate_id: {cid!r}")
    cpath = INBOX_DIR / f"{cid}.yaml"
    if not cpath.exists():
        _fail(f"candidate not found: {cid}")
    candidate = yaml.safe_load(cpath.read_text()) or {}

    recipe = payload.get("recipe")
    if not isinstance(recipe, dict):
        _fail("missing recipe payload")
    force = bool(payload.get("force"))

    warnings: list[str] = []
    blockers: list[str] = []

    # ── 1. required + enums ────────────────────────────────────────────────
    name = str(recipe.get("name") or "").strip()
    if not name:
        _fail("recipe needs a name")
    if not recipe.get("ingredients"):
        _fail("recipe needs at least one ingredient")
    if not recipe.get("steps"):
        _fail("recipe needs at least one step")
    if not recipe.get("one_line"):
        recipe["one_line"] = name

    def _clean_enum(field: str, allowed: set[str]) -> list[str]:
        vals = [str(v).strip().lower() for v in (recipe.get(field) or [])]
        bad = [v for v in vals if v not in allowed]
        if bad:
            warnings.append(f"dropped invalid {field}: {', '.join(bad)}")
        return [v for v in vals if v in allowed]

    recipe["meal_type"] = _clean_enum("meal_type", MEAL_TYPES) or ["snack"]
    recipe["diet"] = _clean_enum("diet", DIETS)
    recipe["seasons"] = _clean_enum("seasons", SEASONS) or ["all"]
    recipe["balances_dosha"] = _clean_enum("balances_dosha", DOSHAS)
    recipe["aggravates_dosha"] = _clean_enum("aggravates_dosha", DOSHAS)
    recipe["rasa"] = _clean_enum("rasa", RASAS)
    recipe["contains_allergens"] = _clean_enum("contains_allergens", ALLERGENS)

    ing_text = _ingredient_text(recipe)

    # ── 2. duplicates ──────────────────────────────────────────────────────
    similar = _similar_existing(name)
    if similar:
        blockers.append("looks like a duplicate of: " + "; ".join(similar[:4]))

    # ── 3. no-porridge guard ───────────────────────────────────────────────
    if "porridge" in name.lower() or "porridge" in ing_text:
        blockers.append("porridge-type recipe — porridge breakfasts are banned from client menus (standing rule)")

    # ── 4. diet consistency ────────────────────────────────────────────────
    diet = set(recipe["diet"])
    has_meat = any(w in ing_text for w in MEAT_WORDS)
    has_egg = "egg" in ing_text
    has_dairy_or_animal = any(w in ing_text for w in DAIRY_VEGAN_WORDS)
    has_roots = any(w in ing_text for w in ROOT_WORDS)
    if has_meat:
        for claim in ("vegetarian", "vegan", "jain", "eggetarian"):
            if claim in diet:
                diet.discard(claim)
                warnings.append(f"removed '{claim}' — ingredient list contains meat/fish")
        diet.add("non_vegetarian")
    elif has_egg:
        for claim in ("vegetarian", "vegan", "jain"):
            if claim in diet:
                diet.discard(claim)
                warnings.append(f"removed '{claim}' — contains egg")
        diet.add("eggetarian")
    if "vegan" in diet and has_dairy_or_animal:
        diet.discard("vegan")
        warnings.append("removed 'vegan' — contains dairy/ghee/honey")
    if "jain" in diet and has_roots:
        diet.discard("jain")
        warnings.append("removed 'jain' — contains onion/garlic/root vegetables")
    recipe["diet"] = sorted(diet)

    # ── 5. allergen derivation ─────────────────────────────────────────────
    derived = set(recipe["contains_allergens"])
    for allergen, words in ALLERGEN_KEYWORDS.items():
        if any(w in ing_text for w in words) and allergen not in derived:
            derived.add(allergen)
            warnings.append(f"added allergen '{allergen}' from ingredient list")
    recipe["contains_allergens"] = sorted(derived)

    if blockers and not force:
        json.dump(
            {"ok": False, "needs_confirm": True, "warnings": blockers + warnings},
            sys.stdout,
        )
        return 0
    warnings = blockers + warnings if blockers else warnings

    # ── 6. nutrients ───────────────────────────────────────────────────────
    nutrients = None
    try:
        table = NutrientTable()
        result = compute_recipe_nutrients(recipe, table)
        nutrients = result
    except Exception as e:  # table missing shouldn't block an approval
        warnings.append(f"nutrient computation skipped: {e}")

    # ── build the library record in README field order ─────────────────────
    slug = _unique_slug(_slugify(name))
    attribution_author = str(recipe.get("attribution_author") or "").strip()
    source_url = candidate.get("source_url")

    record: dict = {
        "slug": slug,
        "name": name,
        "meal_type": recipe["meal_type"],
        "diet": recipe["diet"],
        "region": recipe.get("region") or "Indian",
        "seasons": recipe["seasons"],
        "balances_dosha": recipe["balances_dosha"],
        "aggravates_dosha": recipe["aggravates_dosha"],
        "rasa": recipe["rasa"],
        "main_ingredients": [str(x).lower() for x in (recipe.get("main_ingredients") or [])],
        "contains_allergens": recipe["contains_allergens"],
        "ingredients": recipe["ingredients"],
        "steps": recipe["steps"],
        "servings": str(recipe.get("servings") or "2"),
        "prep_time_min": int(recipe.get("prep_time_min") or 10),
        "cook_time_min": int(recipe.get("cook_time_min") or 15),
        "one_line": recipe["one_line"],
    }
    if recipe.get("headnote"):
        record["headnote"] = recipe["headnote"]
    record["attribution"] = {
        "author": attribution_author or "unknown",
        "source_id": "recipe-inbox",
        **({"source_url": source_url} if source_url else {}),
    }
    if recipe.get("parse_notes"):
        record["parse_notes"] = recipe["parse_notes"]

    if nutrients:
        ps = nutrients["per_serving"]
        record["approx_kcal_per_serving"] = int(round(ps["kcal"]))
        record["kcal_is_estimate"] = True
        record["protein_g"] = ps["protein_g"]
        record["kcal_per_serving"] = int(round(ps["kcal"]))
        record["kcal_basis"] = "ingredient_table_v1"
        record["nutrients_per_serving"] = ps
        record["nutrient_coverage_pct"] = nutrients["coverage_pct"]
        record["rich_in"] = nutrients["rich_in"]
        record["nutrient_basis"] = "ingredient_table_v1"
        record["nutrients_computed_at"] = date.today().isoformat()

    record["version"] = 1
    record["status"] = "active"
    record["updated_at"] = date.today().isoformat()
    record["updated_by"] = "Shivani (recipe inbox)"

    RECIPES_DIR.mkdir(parents=True, exist_ok=True)
    (RECIPES_DIR / f"{slug}.yaml").write_text(
        yaml.safe_dump(record, sort_keys=False, allow_unicode=True)
    )

    candidate["status"] = "approved"
    candidate["approved_slug"] = slug
    candidate["approved_at"] = datetime.now(timezone.utc).isoformat()
    cpath.write_text(yaml.safe_dump(candidate, sort_keys=False, allow_unicode=True))

    json.dump(
        {
            "ok": True,
            "slug": slug,
            "warnings": warnings,
            "nutrients": (nutrients or {}).get("per_serving"),
            "rich_in": (nutrients or {}).get("rich_in", []),
            "coverage_pct": (nutrients or {}).get("coverage_pct"),
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
