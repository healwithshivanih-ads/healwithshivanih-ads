#!/usr/bin/env python3
"""Standalone schema check for the Phase 0 recipe store (data/_recipes/*.yaml).
NOT part of `fmdb validate` (these aren't a first-class entity yet). Exits 1 on
any error. Run: python scripts/validate-recipes.py
"""
import os, sys, glob, yaml

MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack", "side", "drink", "salad", "soup", "condiment"}
# non_vegetarian is in active use across the library AND the app's dietary
# filter keys on it (client-app.ts recipeDietLevel) — it MUST be valid here.
DIET = {"vegetarian", "vegan", "jain", "eggetarian", "non_vegetarian", "gluten_free", "dairy_free", "nut_free"}
DOSHAS = {"vata", "pitta", "kapha"}
# "all" = year-round; the established convention for season-agnostic recipes.
SEASONS = {"spring", "summer", "monsoon", "autumn", "winter", "all"}
RASA = {"sweet", "sour", "salty", "pungent", "bitter", "astringent"}
ALLERGENS = {"dairy", "gluten", "nuts", "peanut", "soy", "egg", "shellfish", "sesame", "mustard"}
REQUIRED = ("slug", "name", "meal_type", "one_line")

def _dir():
    env = os.environ.get("FMDB_RECIPES_DIR")
    if env: return env
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(here)), "fm-database", "data", "_recipes")

def check(d, fname, errs, warns):
    for k in REQUIRED:
        if not d.get(k):
            errs.append(f"{fname}: missing required '{k}'")
    slug = d.get("slug", "")
    if slug and (not all(c.isalnum() or c == "-" for c in slug) or not slug.islower()):
        errs.append(f"{fname}: bad slug {slug!r}")
    if slug and slug != os.path.splitext(fname)[0]:
        warns.append(f"{fname}: slug {slug!r} != filename")
    def sub(field, valid, hard=True):
        bad = set(str(x).lower() for x in (d.get(field) or [])) - valid
        if bad:
            (errs if hard else warns).append(f"{fname}: {field} has invalid {sorted(bad)} (allowed: {sorted(valid)})")
    sub("meal_type", MEAL_TYPES); sub("diet", DIET); sub("balances_dosha", DOSHAS)
    sub("aggravates_dosha", DOSHAS); sub("seasons", SEASONS); sub("rasa", RASA)
    sub("contains_allergens", ALLERGENS, hard=False)
    for k in ("approx_kcal_per_serving", "protein_g"):
        if d.get(k) is not None and not isinstance(d[k], (int, float)):
            errs.append(f"{fname}: {k} must be a number")
    if not (d.get("method") or "").strip() and not (d.get("steps") or []):
        warns.append(f"{fname}: no method/steps stored")
    img = d.get("image") or {}
    if isinstance(img, dict) and img.get("rights_status") not in (None, "", "none", "book_reference_uncleared", "web_reference_uncleared", "licensed", "original", "original_generated", "generated_reference"):
        errs.append(f"{fname}: image.rights_status invalid ({img.get('rights_status')!r})")

def main():
    directory = _dir()
    files = [f for f in sorted(glob.glob(os.path.join(directory, "*.yaml")))
             if not os.path.basename(f).startswith("_")]
    errs, warns = [], []
    for fp in files:
        try:
            d = yaml.safe_load(open(fp, encoding="utf-8"))
        except Exception as e:
            errs.append(f"{os.path.basename(fp)}: YAML parse error: {e}"); continue
        if not isinstance(d, dict):
            errs.append(f"{os.path.basename(fp)}: not a mapping"); continue
        check(d, os.path.basename(fp), errs, warns)
    print(f"checked {len(files)} recipe(s) in {directory}")
    for w in warns: print(f"  WARN  {w}")
    for e in errs: print(f"  ERROR {e}")
    print(f"\n{len(errs)} error(s), {len(warns)} warning(s)")
    return 1 if errs else 0

if __name__ == "__main__":
    sys.exit(main())
