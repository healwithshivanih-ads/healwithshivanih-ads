#!/usr/bin/env python3
"""Standalone schema check for the Phase 0 recipe store (data/_recipes/*.yaml).
NOT part of `fmdb validate` (these aren't a first-class entity yet). Exits 1 on
any error. Run: python scripts/validate-recipes.py  (or npm run validate:recipes)

The vocabulary and the per-recipe checks live in recipe_schema.py so the write
paths enforce the same rules; this file is just the whole-library CLI.
"""
import os, sys, glob, yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recipe_schema import check_recipe  # noqa: E402


def _dir():
    env = os.environ.get("FMDB_RECIPES_DIR")
    if env: return env
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(here)), "fm-database", "data", "_recipes")


def main():
    directory = _dir()
    files = [f for f in sorted(glob.glob(os.path.join(directory, "*.yaml")))
             if not os.path.basename(f).startswith("_")]
    errs, warns = [], []
    for fp in files:
        name = os.path.basename(fp)
        try:
            d = yaml.safe_load(open(fp, encoding="utf-8"))
        except Exception as e:
            errs.append(f"{name}: YAML parse error: {e}"); continue
        if not isinstance(d, dict):
            errs.append(f"{name}: not a mapping"); continue
        e, w = check_recipe(d, name)
        errs.extend(e); warns.extend(w)
    print(f"checked {len(files)} recipe(s) in {directory}")
    for w in warns: print(f"  WARN  {w}")
    for e in errs: print(f"  ERROR {e}")
    print(f"\n{len(errs)} error(s), {len(warns)} warning(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
