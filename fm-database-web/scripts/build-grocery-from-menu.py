#!/usr/bin/env python3
"""Build a tick-off shopping list from a plan's app_menu — DETERMINISTICALLY, $0.

`generate-grocery-list.py` asks Haiku. That is fine on the dashboard path, where
FM_API_OK is set and the spend is expected. It is NOT available on the $0 chat
path (author-plan), where a menu can be hand-authored and the client then has a
menu and no shopping list — which is exactly what happened to cl-024 until the
list was built by hand.

This reads the menu that already exists, resolves each dish to its catalogue
recipe, and aggregates the recipes' own ingredient lines. No model call.

stdin:  {"client_id": str, "plan_slug": str, "weeks": [1,2]|null, "dry_run": bool}
stdout: {"ok": bool, "items": N, "categories": N, "path": str, "unresolved": [...], "error": str|null}

Writes: ~/fm-plans/clients/<id>/meal-plans/<plan_slug>-grocery.yaml
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import OrderedDict
from pathlib import Path

import yaml

FMDB = Path(__file__).resolve().parents[2] / "fm-database"
RECIPES = FMDB / "data" / "_recipes"


def plans_root() -> Path:
    return Path(os.environ.get("FMDB_PLANS_DIR") or (Path.home() / "fm-plans"))


# Aisle for an ingredient, by the words it contains. First match wins, so the
# specific patterns must precede the generic ones.
AISLES: list[tuple[str, re.Pattern]] = [
    ("Dals & legumes", re.compile(r"\b(dal|daal|lentil|moong|masoor|toor|arhar|urad|chana|rajma|chickpea|kabuli|val|lobia|sprout|besan|gram flour)\b", re.I)),
    ("Grains & atta", re.compile(r"\b(atta|flour|rice|millet|jowar|bajra|ragi|wheat|oats|poha|rava|suji|semolina|barley|jau|quinoa|batter|bread|roti|idli|dosa)\b", re.I)),
    ("Dairy", re.compile(r"\b(milk|curd|dahi|yoghurt|yogurt|paneer|ghee|butter|cheese|buttermilk|chaas|tofu|cream)\b", re.I)),
    ("Nuts, seeds & dry fruit", re.compile(r"\b(almond|walnut|cashew|pista|pistachio|peanut|seed|flax|alsi|til|sesame|pumpkin seed|sunflower|makhana|raisin|date|anjeer|fig)\b", re.I)),
    ("Spices & masala", re.compile(r"\b(jeera|cumin|haldi|turmeric|dhania|coriander powder|ajwain|hing|asafoetida|masala|chilli powder|pepper|mustard seed|rai|methi seed|fenugreek seed|elaichi|cardamom|clove|dalchini|cinnamon|bay leaf|salt|saunf|fennel)\b", re.I)),
    ("Oils & condiments", re.compile(r"\b(oil|vinegar|honey|jaggery|gud|sauce|pickle|achar|tamarind|imli)\b", re.I)),
    ("Vegetables & fresh", re.compile(r"\b(tomato|onion|potato|lauki|ghiya|tinda|bhindi|okra|palak|spinach|methi|sarson|cabbage|cauliflower|gobi|carrot|beet|cucumber|kheera|capsicum|shimla|brinjal|baingan|gourd|karela|pumpkin|kaddu|peas|matar|beans|mushroom|ginger|adrak|garlic|lehsun|chilli|coriander|dhania|mint|pudina|curry leaf|lemon|nimbu|apple|banana|guava|amrood|pear|nashpati|jamun|papaya|orange|mosambi|fruit|greens|drumstick|radish|mooli)\b", re.I)),
]
STAPLES = re.compile(r"\b(salt|water|oil|jeera|cumin|haldi|turmeric|dhania|hing|ajwain|pepper|mustard seed|rai|ginger|garlic|onion|tomato|ghee)\b", re.I)

# Ingredient-line noise: quantities, units, prep verbs.
QTY = re.compile(r"^\s*[\d¼½¾/.\-–—]+\s*(?:g|kg|ml|l|tsp|tbsp|cup|cups|katori|bowl|piece|pieces|no\.?|nos\.?|inch|clove|cloves|sprig|sprigs|pinch|handful)?\s*", re.I)
PREP = re.compile(r",?\s*\b(chopped|finely chopped|sliced|grated|soaked|boiled|roasted|crushed|ground|minced|diced|washed|peeled|to taste|optional|fresh|as needed|for garnish|for tempering)\b.*$", re.I)


def clean_ingredient(line: str) -> str:
    s = str(line or "").strip()
    s = QTY.sub("", s)
    s = PREP.sub("", s)
    s = re.sub(r"\([^)]*\)", "", s)          # drop parenthetical asides
    s = re.sub(r"\s+", " ", s).strip(" ,.-–—")
    return s


def aisle_for(item: str) -> str:
    for name, rx in AISLES:
        if rx.search(item):
            return name
    return "Other"


def recipe_index() -> dict[str, dict]:
    """name (normalised) -> recipe dict."""
    idx: dict[str, dict] = {}
    for f in RECIPES.glob("*.yaml"):
        try:
            d = yaml.safe_load(f.read_text())
        except Exception:
            continue
        if isinstance(d, dict) and d.get("name"):
            idx[norm(d["name"])] = d
    return idx


def norm(s: str) -> str:
    """Same shape as the app's recipeLibKey: lowercase, parens dropped, squashed."""
    s = re.sub(r"\([^)]*\)", " ", str(s or "").lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def primary_dish(cell: str) -> str:
    return str(cell or "").split(" + ")[0].strip()


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    cid = payload.get("client_id")
    slug = payload.get("plan_slug")
    want_weeks = payload.get("weeks")
    dry = bool(payload.get("dry_run"))
    if not cid or not slug:
        print(json.dumps({"ok": False, "error": "client_id and plan_slug required"}))
        return 1

    root = plans_root()
    pub = list((root / "published").glob(f"{slug}-v*.yaml")) or list((root / "drafts").glob(f"{slug}.yaml"))
    if not pub:
        print(json.dumps({"ok": False, "error": f"plan not found: {slug}"}))
        return 1
    plan = yaml.safe_load(pub[0].read_text())
    menu = plan.get("app_menu") or {}
    weeks = menu.get("weeks") or []
    if not weeks:
        print(json.dumps({"ok": False, "error": "plan has no app_menu to build from"}))
        return 1

    idx = recipe_index()
    # item -> {aisle, for:set(dish)}
    agg: "OrderedDict[str, dict]" = OrderedDict()
    unresolved: list[str] = []

    for w in weeks:
        if want_weeks and w.get("week") not in want_weeks:
            continue
        for day in w.get("days") or []:
            for s in day.get("slots") or []:
                dish = primary_dish(s.get("dish"))
                if not dish:
                    continue
                rec = idx.get(norm(dish))
                if not rec:
                    if dish not in unresolved:
                        unresolved.append(dish)
                    continue
                for line in rec.get("ingredients") or []:
                    item = clean_ingredient(line if isinstance(line, str) else line.get("item", ""))
                    if not item or len(item) < 2:
                        continue
                    key = item.lower()
                    entry = agg.setdefault(key, {"item": item, "aisle": aisle_for(item), "for": set()})
                    entry["for"].add(rec["name"])

    items = [
        {
            "item": e["item"],
            "category": e["aisle"],
            **({"staple": True} if STAPLES.search(e["item"]) else {}),
            "for": sorted(e["for"])[:4],
        }
        for e in agg.values()
    ]
    # group by aisle so the list reads like a shopping trip
    order = [a for a, _ in AISLES] + ["Other"]
    items.sort(key=lambda i: (order.index(i["category"]) if i["category"] in order else 99, i["item"].lower()))

    out = {
        "generated_at": payload.get("now") or "",
        "generated_by": "build-grocery-from-menu.py (deterministic, no model call)",
        "note": "Everything your menu needs for the weeks ahead. Tick as you go — "
                "the pantry basics are marked, so skip what you already have.",
        "weeks": [{"week": w.get("week", i + 1), "items": items} for i, w in enumerate(weeks)
                  if not want_weeks or w.get("week") in want_weeks],
    }

    dest = root / "clients" / cid / "meal-plans" / f"{slug}-grocery.yaml"
    if not dry:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(yaml.safe_dump(out, sort_keys=False, allow_unicode=True, width=96))

    print(json.dumps({
        "ok": True,
        "items": len(items),
        "categories": len({i["category"] for i in items}),
        "path": str(dest),
        "unresolved": unresolved,
        "dry_run": dry,
        "error": None,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
