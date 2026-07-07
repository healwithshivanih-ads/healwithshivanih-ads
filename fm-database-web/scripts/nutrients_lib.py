"""Shared deterministic nutrient engine for the recipe library.

Reads fm-database/data/_ingredient_nutrients.yaml (canonical ingredient ->
per-100g macro/micro values + densities, IFCT 2017 / USDA reference basis)
and computes per-serving nutrients for a recipe dict by parsing its
ingredients' qty/unit into grams. No AI calls — same inputs, same outputs.

Used by:
  - compute-recipe-nutrients.py   (backfill / on-demand CLI)
  - approve-recipe-candidate.py   (recipe-inbox approval gate)

Written-back keys on a recipe (see compute_recipe_nutrients):
  nutrients_per_serving:  {kcal, protein_g, carbs_g, fat_g, fibre_g,
                           iron_mg, calcium_mg, magnesium_mg, zinc_mg,
                           potassium_mg, folate_ug, b12_ug, vit_d_ug,
                           vit_c_mg, omega3_mg}
  nutrient_coverage_pct:  share of estimated ingredient mass (water excluded)
                          that matched the table — below LOW_COVERAGE the
                          rich_in tags are withheld
  rich_in:                per-serving threshold badges (see RICH_IN_THRESHOLDS)
  nutrient_basis:         "ingredient_table_v1"
  nutrients_computed_at:  ISO date

kcal_per_serving (basis ai_haiku) is intentionally NOT touched — the app's
weight-loss tracking reads it; nutrients_per_serving.kcal is the
table-derived figure and the two are reported side by side in backfill.
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
FMDB_ROOT = SCRIPTS_DIR.parent.parent / "fm-database"
TABLE_PATH = FMDB_ROOT / "data" / "_ingredient_nutrients.yaml"

NUTRIENT_KEYS = [
    "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g",
    "iron_mg", "calcium_mg", "magnesium_mg", "zinc_mg", "potassium_mg",
    "folate_ug", "b12_ug", "vit_d_ug", "vit_c_mg", "omega3_mg",
]

# Per-serving thresholds for a rich_in badge (~15-20% of adult daily need).
RICH_IN_THRESHOLDS = {
    "protein": ("protein_g", 12),
    "fibre": ("fibre_g", 5),
    "iron": ("iron_mg", 3),
    "calcium": ("calcium_mg", 150),
    "magnesium": ("magnesium_mg", 70),
    "zinc": ("zinc_mg", 2),
    "potassium": ("potassium_mg", 500),
    "folate": ("folate_ug", 80),
    "b12": ("b12_ug", 0.6),
    "vitamin-c": ("vit_c_mg", 20),
    "vitamin-d": ("vit_d_ug", 2),
    "omega-3": ("omega3_mg", 500),
}

LOW_COVERAGE = 70.0  # % matched mass below which rich_in is withheld

# ---------------------------------------------------------------- normalize

_PREP_WORDS = (
    r"(finely |coarsely |freshly |roughly |thinly )?"
    r"(chopped|grated|diced|sliced|minced|cubed|melted|peeled|ground|crushed|"
    r"shredded|julienned|torn|beaten|whisked|soaked|sprouted|steamed|boiled|"
    r"cooked|roasted|toasted|powdered|juiced|halved|quartered|pitted|deseeded|"
    r"seeded|cored|trimmed|washed|rinsed|drained|packed|heaped|heaping|mashed|"
    r"pureed|blanched|cleaned|sectioned|slit|dissolved.*|cut.*|in batons|"
    r"about.*|plus.*|for garnish|for serving|for topping|for cooking|"
    r"for frying|for drizzling|for soaking|for steaming|to bind|to thicken|"
    r"well rinsed|no stems|crumbled)"
)

_DROP_SEGMENT = re.compile(
    rf"({_PREP_WORDS}|to taste|optional|as needed|as named|room temperature|"
    rf"at room temperature|warmed?|cold|extra|divided|white|hemp seeds|"
    rf"orange zest|.*bunch|.*block|if using)( .*)?"
)


def normalize_item(item: str) -> str:
    """Collapse a free-text ingredient line to a matchable phrase."""
    s = str(item or "").strip().lower()
    m = re.match(r"^for [^:]+:\s*(.+)$", s)
    if m:
        s = m.group(1)
    s = re.sub(r"\([^)]*\)", "", s)
    s = re.sub(
        r"^[\d\s/.\-¼½¾–]+(tsp|tbsp|cups?|inch(es)?|cloves?|pinch(es)?|g\b|oz\b)?\s+",
        "", s,
    )
    parts = [p.strip() for p in s.split(",")]
    keep = [parts[0]]
    for p in parts[1:]:
        if not _DROP_SEGMENT.fullmatch(p):
            keep.append(p)
    s = ", ".join(keep)
    # "A, B, or C milk" constructions: the trailing noun distributes across the
    # alternatives — "almond, sunflower, or cow's milk" is a MILK, not almonds.
    if re.search(r"\bmilks?\b", s) and "coconut milk" not in s and "buttermilk" not in s:
        for alt in re.split(r"\s+or\s+|,", s):
            if re.search(r"\bmilks?\b", alt):
                s = alt.strip()
                break
    # sprouted mung in any phrasing ("whole green mung beans, sprouted") is the
    # hydrated sprout, not the dry bean — 7x lighter per cup
    if "sprout" in str(item).lower() and re.search(r"\bmo?ong|mung\b", s):
        return "sprouted mung beans"
    s = re.split(r"\s+or\s+|\s*/\s*", s)[0]
    s = re.split(r"\s+and\s+", s)[0]
    s = re.sub(r"^(?:a\s+)?pinch(?:es)?\s+(?:of\s+)?", "", s)
    s = re.sub(r"^(?:a\s+)?few\s+", "", s)
    s = re.sub(r"\s+", " ", s).strip(" ,.-+")
    return s


# ------------------------------------------------------------------ matcher

class NutrientTable:
    def __init__(self, path: Path = TABLE_PATH):
        raw = yaml.safe_load(path.read_text()) or {}
        self.entries: dict[str, dict] = {
            k: v for k, v in raw.items() if not k.startswith("_")
        }
        self.alias_index: dict[str, str] = {}
        for key, spec in self.entries.items():
            self.alias_index.setdefault(key.replace("-", " "), key)
            for a in spec.get("aliases") or []:
                self.alias_index.setdefault(str(a).lower(), key)
        # longest-first so "coconut sugar" wins over "coconut"
        self.sorted_aliases = sorted(self.alias_index, key=len, reverse=True)

    def match(self, norm: str) -> str | None:
        if norm in self.alias_index:
            return self.alias_index[norm]
        for a in self.sorted_aliases:
            if len(a) < 4:
                continue
            # word-boundary substring, tolerant of a trailing plural s/es
            if re.search(rf"(?<![a-z]){re.escape(a)}(?:e?s)?(?![a-z])", norm):
                return self.alias_index[a]
        return None


# --------------------------------------------------------------- qty parser

_FRACTIONS = {"¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3}


def parse_qty(qty: Any) -> float | None:
    """'1' -> 1.0, '8-10' -> 9.0, '1 1/2' -> 1.5, 'to taste' -> 0."""
    if qty is None:
        return None
    if isinstance(qty, (int, float)):
        return float(qty)
    s = str(qty).strip().lower()
    if not s:
        return None
    if s in ("to taste", "as needed", "a little", "little", "optional"):
        return 0.0
    if s in ("a few", "few"):
        return 3.0
    for ch, val in _FRACTIONS.items():
        s = s.replace(ch, f" {val} ")
    s = s.replace("–", "-").replace("—", "-")
    s = re.sub(r"\s*-\s*", "-", s).strip()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)$", s)
    if m:
        return (float(m.group(1)) + float(m.group(2))) / 2
    m = re.match(r"^(\d+)\s+(\d+)/(\d+)$", s)
    if m:
        return float(m.group(1)) + float(m.group(2)) / float(m.group(3))
    m = re.match(r"^(\d+)/(\d+)$", s)
    if m:
        return float(m.group(1)) / float(m.group(2))
    m = re.match(r"^(\d+(?:\.\d+)?)", s)
    if m:
        return float(m.group(1))
    if "half" in s:
        return 0.5
    return None


_EMBEDDED_QTY = re.compile(
    r"^\s*([\d/.\s\-–¼½¾⅓⅔]*\d[\d/.\s\-–¼½¾⅓⅔]*)\s*"
    r"(tsp|tbsp|cups?|g|kg|ml|oz|lb|pinch(?:es)?|inch(?:es)?|cloves?|leaves)?\s+(.+)$"
)


def extract_embedded_qty(raw_item: str) -> tuple[str, str] | None:
    """Some recipes carry the amount inside the item string with no qty/unit
    fields — e.g. {'item': '3 eggs'} or {'item': '1 tsp coconut oil'}.
    Returns (qty, unit) when the leading amount parses, else None."""
    m = _EMBEDDED_QTY.match(str(raw_item or ""))
    if not m:
        return None
    return m.group(1).strip(), (m.group(2) or "").strip()


_SIZE_FACTORS = {"small": 0.7, "medium": 1.0, "large": 1.4}

# fixed gram weights for fuzzy units (per unit)
_FUZZY_UNIT_GRAMS = {
    "pinch": 0.3, "pinches": 0.3, "pinch each": 0.3,
    "dash": 0.5,
    "squeeze": 5.0,
    "sprig": 1.0, "sprigs": 1.0, "few sprigs": 1.0,
    "wedge": 10.0, "wedges": 10.0, "few wedges": 10.0,
    "cube": 10.0, "cubes": 10.0,
    "ring": 10.0, "rings": 10.0,
    "stalk": 40.0, "stalks": 40.0,
    "clove": 3.0, "cloves": 3.0,
    "drizzle": 5.0, "small drizzle": 5.0,
    "batch": 0.0,
}


def _cup_grams(entry: dict) -> float:
    d = (entry.get("density") or {})
    g = d.get("g_per_cup")
    return float(g) if g else 120.0


def _piece_grams(entry: dict, category: str) -> float:
    d = (entry.get("density") or {})
    g = d.get("g_per_piece")
    if g:
        return float(g)
    # a "piece" of a nut or spice is grams, not a 50g chunk — "10 almonds"
    # must not read as half a kilo of almonds
    return {
        "vegetable": 100.0, "fruit": 130.0, "leafy": 50.0,
        "nut_seed": 2.0, "spice": 1.0, "herb": 2.0, "dried_fruit": 10.0,
        "oil_fat": 5.0, "sweetener": 5.0,
    }.get(category, 30.0)


def ingredient_grams(qty: Any, unit: Any, entry: dict, norm_item: str) -> float | None:
    """Best-effort grams for one ingredient row. None = cannot estimate."""
    q = parse_qty(qty)
    unit_s = str(unit or "").strip().lower()
    # units like "eggs or 1 cup beans" / "chilies (or 1/4 tsp cayenne)" are
    # noun echoes with an alternative baked in — keep the first alternative
    unit_s = re.sub(r"\([^)]*\)", "", unit_s)
    unit_s = re.split(r"\s+or\s+", unit_s)[0].strip()
    category = entry.get("category", "other")
    cup = _cup_grams(entry)

    # unit strings that carry their own quantity semantics
    if unit_s in ("to taste",):
        return 0.0
    if unit_s in _FUZZY_UNIT_GRAMS:
        return (q if q not in (None, 0) else 1.0) * _FUZZY_UNIT_GRAMS[unit_s]
    if "handful" in unit_s:
        base = 20.0 if category in ("leafy", "herb") else 30.0
        if "small" in unit_s:
            base *= 0.6
        return (q if q not in (None, 0) else 1.0) * base
    if "leaves" in unit_s or unit_s == "leaf" or "leaf" in unit_s:
        per_leaf = (entry.get("density") or {}).get("g_per_leaf") or 0.5
        return (q if q not in (None, 0) else 5.0) * float(per_leaf)
    if "bunch" in unit_s:
        return (q if q not in (None, 0) else 1.0) * (75.0 if category in ("herb", "leafy") else 100.0)

    if q is None:
        if unit_s == "":
            # No amount anywhere ("salt", "ghee to cook", garnish rows):
            # one piece when countable, else a modest category default.
            d = entry.get("density") or {}
            if d.get("g_per_piece"):
                return float(d["g_per_piece"])
            return {
                "spice": 2.0, "herb": 3.0, "oil_fat": 5.0, "condiment": 5.0,
                "sweetener": 5.0, "liquid": 0.0, "leafy": 10.0,
                "nut_seed": 10.0, "dairy": 20.0, "protein": 50.0,
                "vegetable": 30.0, "fruit": 30.0,
            }.get(category, 20.0)
        return None
    if q == 0:
        return 0.0

    # compound units like "tbsp + 2 tsp", "tbsp plus 1 tsp" — approximate up
    if "tbsp" in unit_s and "tsp" in unit_s:
        return q * cup / 16 + 2 * cup / 48
    if unit_s.startswith("tsp"):
        return q * cup / 48
    if unit_s.startswith("tbsp"):
        return q * cup / 16
    if unit_s.startswith("cup"):
        packed = 1.2 if "packed" in unit_s else 1.0
        return q * cup * packed
    if unit_s in ("g", "gram", "grams", "gm"):
        return q
    if unit_s in ("kg",):
        return q * 1000
    if unit_s in ("ml",):
        return q  # ~1 g/ml for the liquids in this library
    if unit_s in ("l", "litre", "liter"):
        return q * 1000
    if unit_s == "oz" or "oz" in unit_s:
        return q * 28.35
    if unit_s == "lb":
        return q * 453.6
    if unit_s == "quart":
        return q * 4 * cup
    if "inch" in unit_s:
        return q * 6.0  # fresh ginger / turmeric root per inch
    if unit_s == "head":
        return q * 400.0
    if unit_s in ("part", "parts"):
        return q * cup / 48  # spice-mix proportions: read one part as one tsp
    if unit_s in _SIZE_FACTORS:
        return q * _piece_grams(entry, category) * _SIZE_FACTORS[unit_s]
    if unit_s in ("piece", "pieces", "whole", "") or unit_s.startswith("whole "):
        return q * _piece_grams(entry, category)
    # unit is itself a noun echo ("lemon", "lime", "almonds", "eggs...") —
    # treat as pieces of the matched entry
    if re.fullmatch(r"[a-z' \-]+", unit_s):
        size = next((f for w, f in _SIZE_FACTORS.items() if w in unit_s), 1.0)
        return q * _piece_grams(entry, category) * size
    return None


def parse_servings(val: Any) -> float:
    q = parse_qty(val)
    if q and q > 0:
        return q
    return 2.0


# ------------------------------------------------------------------ compute

def compute_recipe_nutrients(recipe: dict, table: NutrientTable) -> dict:
    """Returns {per_serving, coverage_pct, rich_in, unmatched, notes}."""
    totals = {k: 0.0 for k in NUTRIENT_KEYS}
    matched_mass = 0.0
    total_mass = 0.0
    unmatched: list[str] = []
    notes: list[str] = []

    # Steeped-and-strained drinks (jeera water, digestive teas): the seeds and
    # herbs are discarded, only a water-soluble fraction is consumed. Count
    # spices/herbs at 20% so a fennel tea doesn't score like a fennel snack.
    is_strained_drink = "drink" in (recipe.get("meal_type") or []) and any(
        "strain" in str(s).lower() for s in recipe.get("steps") or []
    )

    servings = parse_servings(recipe.get("servings"))

    for ing in recipe.get("ingredients") or []:
        if not isinstance(ing, dict):
            continue
        raw = str(ing.get("item", ""))
        norm = normalize_item(raw)
        if not norm:
            continue
        key = table.match(norm)
        if key is None:
            unmatched.append(raw)
            # assume a modest 30g so coverage honestly reflects the gap
            total_mass += 30.0
            continue
        entry = table.entries[key]
        if key in ("water", "broth"):
            # zero-nutrient carriers — keep out of the coverage denominator
            continue
        qty, unit = ing.get("qty"), ing.get("unit")
        if qty in (None, "") and unit in (None, ""):
            embedded = extract_embedded_qty(raw)
            if embedded:
                qty, unit = embedded
        grams = ingredient_grams(qty, unit, entry, norm)
        if grams is None:
            notes.append(f"could not size: {raw!r}")
            total_mass += 30.0
            unmatched.append(raw)
            continue
        total_mass += grams
        matched_mass += grams
        factor = 1.0
        if is_strained_drink and entry.get("category") in ("spice", "herb"):
            factor = 0.2
        # Sabzi/soup templates measure "2 cups moong" as COOKED volume — more
        # than ~100g of DRY legume per serving is not a real home recipe, so
        # reinterpret the cups as cooked legume (≈0.34x nutrients per gram).
        if (
            entry.get("category") == "dal_legume"
            and entry.get("basis") == "dry"
            and str(unit or "").strip().lower().startswith("cup")
            and grams / servings > 100
        ):
            factor *= 0.34
            notes.append(f"read as cooked volume: {raw!r}")
        per100 = entry.get("per_100g") or {}
        for k in NUTRIENT_KEYS:
            totals[k] += float(per100.get(k) or 0.0) * grams * factor / 100.0

    per_serving = {}
    for k in NUTRIENT_KEYS:
        v = totals[k] / servings
        per_serving[k] = round(v, 1) if v < 100 else round(v)

    coverage = 100.0 * matched_mass / total_mass if total_mass > 0 else 0.0
    coverage = round(coverage, 1)

    rich_in = []
    if coverage >= LOW_COVERAGE:
        for tag, (field, threshold) in RICH_IN_THRESHOLDS.items():
            if per_serving.get(field, 0) >= threshold:
                rich_in.append(tag)

    if per_serving["kcal"] > 1500:
        notes.append("kcal/serving > 1500 — check qty parsing")

    return {
        "per_serving": per_serving,
        "coverage_pct": coverage,
        "rich_in": rich_in,
        "unmatched": unmatched,
        "notes": notes,
    }


def apply_to_recipe(recipe: dict, result: dict) -> None:
    """Mutate recipe dict with the computed block (order-preserving append)."""
    recipe["nutrients_per_serving"] = result["per_serving"]
    recipe["nutrient_coverage_pct"] = result["coverage_pct"]
    recipe["rich_in"] = result["rich_in"]
    recipe["nutrient_basis"] = "ingredient_table_v1"
    recipe["nutrients_computed_at"] = date.today().isoformat()
