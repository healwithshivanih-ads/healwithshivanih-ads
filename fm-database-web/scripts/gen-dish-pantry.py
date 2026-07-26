#!/usr/bin/env python3
"""Regenerate src/lib/fmdb/dish-pantry.json from the ingredient table.

The dish splitter has to answer one question deterministically: is this
post-dash fragment a BARE INGREDIENT (so the dash was a gloss of the dish in
front of it) or a DISH in its own right (so the dash was a descriptor and the
" + " after it are real component boundaries)? The ingredient table is the only
authority on what counts as a bare ingredient, and dish-components.ts is a pure
module, so the phrase list is baked out here rather than read at runtime.

Only whole PHRASES ship. A bag of loose words would be far too permissive: the
table's composite aliases ("mixed salad vegetables", "idli dosa batter", "moong
dal") would leak "salad", "idli", "dosa" and "dal" into the vocabulary and let
a real side dish read as an ingredient.

Run after editing fm-database/data/_ingredient_nutrients.yaml:
    fm-database/.venv/bin/python fm-database-web/scripts/gen-dish-pantry.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "fm-database" / "data" / "_ingredient_nutrients.yaml"
OUT = ROOT / "fm-database-web" / "src" / "lib" / "fmdb" / "dish-pantry.json"

# Mirrors recipeLibKey() in dish-components.ts — both sides must normalise
# identically or a phrase baked here can never be matched there.
def key(s: str) -> str:
    s = re.sub(r"\([^)]*\)", " ", s.lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", s)).strip()


def main() -> None:
    table = yaml.safe_load(SRC.read_text())
    table.pop("_meta", None)

    phrases: set[str] = set()
    for slug, entry in table.items():
        names = [str(slug).replace("-", " ")]
        names += [str(a) for a in (entry.get("aliases") or [])]
        for raw in names:
            # A name carrying a digit, a comma or a "+" is a recipe-line
            # fragment ("bay leaf + 2 cloves + small cinnamon", "g chicken,
            # small pieces"), not the name of an ingredient.
            if re.search(r"[\d,+/]", raw):
                continue
            toks = [t for t in key(raw).split(" ") if len(t) >= 3]
            # Four words is already "cooked white cannellini beans"; anything
            # longer is prose from a recipe line.
            if not toks or len(toks) > 4:
                continue
            phrases.add(" ".join(toks))

    OUT.write_text(json.dumps(sorted(phrases), indent=0, ensure_ascii=False) + "\n")
    print(f"{len(phrases)} phrases -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
