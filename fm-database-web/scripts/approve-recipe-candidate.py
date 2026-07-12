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
from good_for_lib import derive_good_for  # noqa: E402

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
    """Existing recipe names that are NEAR-IDENTICAL to this one.

    Uses Jaccard similarity (shared tokens / all distinct tokens) — symmetric,
    so a short existing name like 'Ghee' can't false-match 'Ghee Roasted
    Makhana' just because they share one word. Also requires ≥2 shared tokens
    so a single common food word (ghee / dal / sabzi) never flags on its own.
    """
    mine = _name_tokens(name)
    if not mine:
        return []
    hits = []
    for p in RECIPES_DIR.glob("*.yaml"):
        if p.name.startswith("_"):
            continue  # _candidates.yaml / _README etc. — not real recipes
        try:
            other = yaml.safe_load(p.read_text()) or {}
        except Exception:
            continue
        if not isinstance(other, dict):
            continue
        theirs = _name_tokens(other.get("name", ""))
        if not theirs:
            continue
        overlap = len(mine & theirs)
        jaccard = overlap / len(mine | theirs)
        # near-identical name: high overlap of the whole set. A 1-word name that
        # exactly equals a 1-word name is still caught (overlap==len==1 → j==1).
        exact_short = overlap >= 1 and mine == theirs
        if exact_short or (overlap >= 2 and jaccard >= 0.7):
            hits.append({
                "name": str(other.get("name") or p.stem),
                "slug": p.stem,
                "has_photo": bool((other.get("image") or {}).get("file")),
            })
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
        blockers.append(
            "looks like a duplicate of: "
            + "; ".join(f"{d['name']} ({d['slug']})" for d in similar[:4])
        )

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
            {
                "ok": False,
                "needs_confirm": True,
                "warnings": blockers + warnings,
                # structured so the UI can offer "use this photo on the existing
                # recipe" when the forward is a dup that brings a photo
                "duplicate_of": similar,
                "candidate_has_photo": bool(
                    candidate.get("image_url") or candidate.get("media_file")
                ),
            },
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

    # good_for condition tags — keep any coach-supplied list, else derive
    # deterministically from rich_in + ingredients + meal_type ($0, no API).
    # This is the salience lever that lets score_recipe up-rank the recipe for a
    # client whose plan/conditions match (see recipe_select.py score_recipe).
    coach_good_for = [str(t).strip() for t in (recipe.get("good_for") or []) if str(t).strip()]
    record["good_for"] = coach_good_for or derive_good_for(record)

    record["version"] = 1
    record["status"] = "active"
    record["updated_at"] = date.today().isoformat()
    record["updated_by"] = "Shivani (recipe inbox)"

    RECIPES_DIR.mkdir(parents=True, exist_ok=True)
    (RECIPES_DIR / f"{slug}.yaml").write_text(
        yaml.safe_dump(record, sort_keys=False, allow_unicode=True)
    )

    # Attach the source photo the coach forwarded (og:image or the forwarded
    # photo itself). Best-effort: the recipe is already saved, so an image
    # failure never blocks approval — the coach can add one later at /recipes.
    image_status = _attach_image(candidate, slug, warnings)

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
            "image": image_status,
        },
        sys.stdout,
    )
    return 0


# public/recipe-images/images/web/<slug>.jpg — where the app + coach UI read from
_WEB_IMG_DIR = SCRIPTS_DIR.parent / "public" / "recipe-images" / "images" / "web"


def _attach_image(candidate: dict, slug: str, warnings: list) -> dict | None:
    """Give the new recipe the source photo the coach forwarded, credited.

    - Forwarded photo: copy the media file into the web-image dir + write the
      recipe's image block (rights_status web_reference_uncleared).
    - Forwarded link: download the captured og:image via the existing
      recipe-image-from-url.py (--no-qc so it's free; it validates + resizes +
      writes the block, and its size check rejects favicons automatically).
    Best-effort — returns a status dict or None, never raises."""
    credit = str(candidate.get("image_credit") or "").strip()
    try:
        media_file = candidate.get("media_file")
        if media_file:
            src = INBOX_DIR / str(media_file)
            if not src.exists():
                return {"ok": False, "reason": "forwarded photo missing"}
            _WEB_IMG_DIR.mkdir(parents=True, exist_ok=True)
            import shutil

            # normalise to .jpg via sips if available; else copy as-is
            dst = _WEB_IMG_DIR / f"{slug}.jpg"
            if src.suffix.lower() in (".jpg", ".jpeg"):
                shutil.copyfile(src, dst)
            else:
                import subprocess

                r = subprocess.run(
                    ["sips", "-s", "format", "jpeg", str(src), "--out", str(dst)],
                    capture_output=True,
                )
                if r.returncode != 0:
                    shutil.copyfile(src, dst)  # fall back to raw copy
            _write_recipe_image_block(slug, f"images/web/{slug}.jpg",
                                      str(candidate.get("source_url") or ""),
                                      credit or "forwarded photo")
            return {"ok": True, "kind": "photo", "credit": credit or "forwarded photo"}

        img_url = candidate.get("image_url")
        if img_url:
            import subprocess

            args = [sys.executable,
                    str(SCRIPTS_DIR / "recipe-image-from-url.py"), slug, str(img_url),
                    "--no-qc"]
            if credit:
                args += ["--credit", credit]
            r = subprocess.run(args, capture_output=True, text=True, timeout=60)
            try:
                out = json.loads(r.stdout or "{}")
            except Exception:
                out = {"ok": False}
            if out.get("ok"):
                return {"ok": True, "kind": "link", "credit": credit, "url": img_url}
            warnings.append(f"couldn't attach the source photo ({out.get('error', 'download failed')}) — add one at /recipes")
            return {"ok": False, "reason": out.get("error", "download failed")}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": str(e)}
    return None


def _write_recipe_image_block(slug: str, rel_file: str, source_url: str, credit: str) -> None:
    """Mirror recipe-image-from-url.write_image_block for the local-photo path."""
    p = RECIPES_DIR / f"{slug}.yaml"
    txt = p.read_text()
    c = (credit or "forwarded photo").replace("'", "''")
    block = (
        "image:\n"
        f"  file: {rel_file}\n"
        f"  credit: '{c}'\n"
        + (f"  source_url: {source_url}\n" if source_url else "")
        + "  rights_status: web_reference_uncleared\n"
        "  note: forwarded photo; replace with licensed or original before any external use\n"
    )
    if re.search(r"^image:", txt, re.M):
        txt = re.sub(r"^image:\n(?:[ \t]+.*\n?)*", block, txt, count=1, flags=re.M)
    else:
        txt = txt.rstrip() + "\n" + block
    p.write_text(txt)


if __name__ == "__main__":
    raise SystemExit(main())
