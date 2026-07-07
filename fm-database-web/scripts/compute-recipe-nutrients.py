#!/usr/bin/env python3
"""Backfill / recompute deterministic macro+micro nutrients for the recipe library.

Reads fm-database/data/_ingredient_nutrients.yaml and, for every recipe in
fm-database/data/_recipes/, parses ingredient qty/unit into grams and writes:

  nutrients_per_serving  (kcal, protein_g, carbs_g, fat_g, fibre_g, iron_mg,
                          calcium_mg, magnesium_mg, zinc_mg, potassium_mg,
                          folate_ug, b12_ug, vit_d_ug, vit_c_mg, omega3_mg)
  nutrient_coverage_pct  share of estimated ingredient mass matched
  rich_in                per-serving badges (withheld when coverage < 70%)
  nutrient_basis / nutrients_computed_at

kcal_per_serving (basis ai_haiku) is NOT touched — this writes a parallel
table-derived figure and reports the ratio so drift is visible.

No AI calls, $0. Deterministic: same table + recipes -> same output.

Usage:
  compute-recipe-nutrients.py [--dry-run] [--limit N] [--only slug]
                              [--report-unmatched]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from nutrients_lib import (  # noqa: E402
    NutrientTable,
    apply_to_recipe,
    compute_recipe_nutrients,
)

FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
RECIPES_DIR = FMDB_ROOT / "data" / "_recipes"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", help="single recipe slug")
    ap.add_argument("--report-unmatched", action="store_true")
    args = ap.parse_args()

    table = NutrientTable()
    paths = sorted(RECIPES_DIR.glob("*.yaml"))
    if args.only:
        paths = [p for p in paths if p.stem == args.only]
    if args.limit:
        paths = paths[: args.limit]

    done = 0
    low_cov: list[tuple[str, float]] = []
    unmatched_all: dict[str, int] = {}
    ratio_buckets = {"<0.7": 0, "0.7-1.3": 0, ">1.3": 0, "n/a": 0}

    for p in paths:
        recipe = yaml.safe_load(p.read_text())
        if not isinstance(recipe, dict) or not recipe.get("ingredients"):
            continue
        result = compute_recipe_nutrients(recipe, table)
        for u in result["unmatched"]:
            unmatched_all[u] = unmatched_all.get(u, 0) + 1
        if result["coverage_pct"] < 70:
            low_cov.append((p.stem, result["coverage_pct"]))

        haiku_kcal = recipe.get("kcal_per_serving") or recipe.get("approx_kcal_per_serving")
        table_kcal = result["per_serving"]["kcal"]
        if haiku_kcal and table_kcal:
            r = table_kcal / float(haiku_kcal)
            ratio_buckets["<0.7" if r < 0.7 else (">1.3" if r > 1.3 else "0.7-1.3")] += 1
        else:
            ratio_buckets["n/a"] += 1

        if not args.dry_run:
            apply_to_recipe(recipe, result)
            p.write_text(yaml.safe_dump(recipe, sort_keys=False, allow_unicode=True))
        done += 1
        if args.only:
            print(yaml.safe_dump(result, sort_keys=False, allow_unicode=True))

    print(f"processed: {done} recipes{' (dry-run)' if args.dry_run else ''}")
    print(f"low coverage (<70%): {len(low_cov)}")
    for slug, cov in sorted(low_cov, key=lambda t: t[1])[:15]:
        print(f"  {cov:5.1f}%  {slug}")
    print(f"kcal vs ai_haiku ratio: {ratio_buckets}")
    if args.report_unmatched and unmatched_all:
        print("\nunmatched ingredient lines:")
        for item, c in sorted(unmatched_all.items(), key=lambda t: -t[1]):
            print(f"  {c:3d}  {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
