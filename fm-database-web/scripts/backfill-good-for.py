#!/usr/bin/env python3
"""Backfill `good_for` on every recipe missing it, using the deterministic
derive_good_for() heuristic (no API, $0).

Text-inserts a `good_for:` block immediately before `one_line:` so the rest of
each file is byte-preserved (no YAML round-trip → no requoting surprises).
Recipes that already declare good_for are skipped.

Usage:
  python backfill-good-for.py            # apply
  python backfill-good-for.py --dry-run  # report only
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))
RECIPES_DIR = SCRIPTS_DIR.parent.parent / "fm-database" / "data" / "_recipes"

from good_for_lib import derive_good_for  # noqa: E402


def _block(tags: list[str]) -> str:
    return "good_for:\n" + "".join(f"- {t}\n" for t in tags)


def main() -> int:
    dry = "--dry-run" in sys.argv
    changed, skipped, failed = [], 0, []

    for fp in sorted(RECIPES_DIR.glob("*.yaml")):
        if fp.name.startswith("_"):
            continue
        raw = fp.read_text(encoding="utf-8")
        # already has a root-level good_for key?
        if raw.startswith("good_for:") or "\ngood_for:" in raw:
            skipped += 1
            continue
        try:
            recipe = yaml.safe_load(raw) or {}
        except Exception as e:
            failed.append(f"{fp.name}: parse error {e}")
            continue
        if not isinstance(recipe, dict):
            failed.append(f"{fp.name}: not a mapping")
            continue

        tags = derive_good_for(recipe)
        block = _block(tags)

        if "\none_line:" in raw:
            new = raw.replace("\none_line:", "\n" + block + "one_line:", 1)
        elif raw.startswith("one_line:"):
            new = block + raw
        elif "\nsteps:" in raw:
            new = raw.replace("\nsteps:", "\n" + block + "steps:", 1)
        else:
            new = raw.rstrip("\n") + "\n" + block  # last resort: append

        changed.append((fp.name, tags))
        if not dry:
            fp.write_text(new, encoding="utf-8")

    print(f"{'DRY-RUN ' if dry else ''}backfilled {len(changed)} recipe(s), "
          f"skipped {skipped} (already tagged), {len(failed)} failed")
    for name, tags in changed:
        print(f"  + {name}: {', '.join(tags)}")
    for f in failed:
        print(f"  ! {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
