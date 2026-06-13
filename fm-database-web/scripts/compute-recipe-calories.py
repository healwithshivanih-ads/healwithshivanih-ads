#!/usr/bin/env python3
"""Compute kcal-per-serving for the recipe library (one-time / on-demand).

Meal letters are retired, so the app needs accurate per-recipe calories to
estimate whether a weight-loss client's menu is tracking the target. The
recipes already carry exact ingredient quantities + a serving count, so we
ask Haiku to read those and return a calorie figure — far more accurate
than estimating from free-text dish names.

Writes back onto each recipe YAML:
  kcal_per_serving: int
  kcal_total: int
  kcal_basis: "ai_haiku"           # so the deterministic engine knows not to override
  kcal_computed_at: ISO date

Idempotent: skips recipes that already have kcal_per_serving unless --force.

Usage:
  compute-recipe-calories.py [--limit N] [--force] [--batch 12] [--dry-run]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from datetime import date
from pathlib import Path

RECIPES_DIR = Path("/Users/shivani/code/healwithshivanih-ads/fm-database/data/_recipes")
FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
MODEL = "claude-haiku-4-5"


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


TOOL = {
    "name": "record_calories",
    "description": "Record the estimated calories for each recipe.",
    "input_schema": {
        "type": "object",
        "properties": {
            "recipes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "slug": {"type": "string"},
                        "kcal_total": {"type": "integer", "description": "calories for the WHOLE recipe (all servings)"},
                        "kcal_per_serving": {"type": "integer", "description": "kcal_total divided by the serving count"},
                    },
                    "required": ["slug", "kcal_total", "kcal_per_serving"],
                },
            }
        },
        "required": ["recipes"],
    },
}

SYSTEM = (
    "You are a nutrition assistant. For each recipe you are given its name, "
    "serving count, and ingredient list with exact quantities. Estimate the "
    "TOTAL calories of the whole recipe by summing each ingredient's calories "
    "(use standard food-composition values; Indian home cooking). Then divide "
    "by the serving count for kcal_per_serving. Be realistic — a single dal + "
    "roti meal serving is typically 300-500 kcal, not 1000. Return one entry "
    "per recipe via the record_calories tool. Output only the tool call."
)


def _recipe_payload(r: dict) -> dict:
    ings = []
    for i in r.get("ingredients") or []:
        if isinstance(i, dict):
            ings.append(" ".join(str(i.get(k) or "").strip() for k in ("qty", "unit", "item")).strip())
        elif isinstance(i, str):
            ings.append(i)
    return {
        "slug": r.get("slug") or "",
        "name": r.get("name") or "",
        "servings": r.get("servings") or 1,
        "ingredients": [x for x in ings if x],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch", type=int, default=12)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        import yaml  # type: ignore
    except ImportError as e:
        print(f"pyyaml: {e}", file=sys.stderr)
        return 1

    files = sorted(f for f in glob.glob(str(RECIPES_DIR / "*.yaml")) if not Path(f).name.startswith("_"))
    todo: list[tuple[str, dict]] = []
    for f in files:
        try:
            r = yaml.safe_load(Path(f).read_text()) or {}
        except yaml.YAMLError:
            continue
        if not isinstance(r, dict) or not r.get("ingredients"):
            continue
        if r.get("kcal_per_serving") and not args.force:
            continue
        todo.append((f, r))
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} recipes to price (of {len(files)} total)", file=sys.stderr)
    if not todo:
        print(json.dumps({"ok": True, "priced": 0}))
        return 0

    _load_env()
    try:
        import anthropic  # type: ignore
    except ImportError as e:
        print(f"anthropic sdk: {e}", file=sys.stderr)
        return 1
    client = anthropic.Anthropic()

    priced = 0
    today = date.today().isoformat()
    for start in range(0, len(todo), args.batch):
        batch = todo[start : start + args.batch]
        payload = [_recipe_payload(r) for _, r in batch]
        try:
            msg = client.messages.create(
                model=MODEL,
                max_tokens=2000,
                system=SYSTEM,
                tools=[TOOL],
                tool_choice={"type": "tool", "name": "record_calories"},
                messages=[{"role": "user", "content": json.dumps({"recipes": payload})}],
            )
        except Exception as e:  # noqa: BLE001
            print(f"  batch {start} failed: {e}", file=sys.stderr)
            continue
        result = next((b.input for b in msg.content if getattr(b, "type", "") == "tool_use"), None)
        by_slug = {x["slug"]: x for x in (result or {}).get("recipes", [])}
        for f, r in batch:
            slug = r.get("slug") or ""
            hit = by_slug.get(slug)
            if not hit:
                continue
            kps = int(hit.get("kcal_per_serving") or 0)
            if kps <= 0:
                continue
            r["kcal_per_serving"] = kps
            r["kcal_total"] = int(hit.get("kcal_total") or kps * int(r.get("servings") or 1))
            r["kcal_basis"] = "ai_haiku"
            r["kcal_computed_at"] = today
            if not args.dry_run:
                Path(f).write_text(yaml.safe_dump(r, sort_keys=False, allow_unicode=True))
            priced += 1
        print(f"  priced {priced}/{len(todo)}", file=sys.stderr)

    print(json.dumps({"ok": True, "priced": priced}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
