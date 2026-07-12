"""Deterministic `good_for` derivation for recipes (no API, $0).

Maps a recipe's concrete signals — `rich_in` nutrient badges, main ingredients,
`meal_type`, `diet`, kcal, fibre — onto the recipe library's established
`good_for` condition vocabulary. Conservative by design: only emits
well-populated tags backed by a clear signal, so it is safe to run unattended
over the whole library AND inside the inbox approve pipeline. The coach can
always refine on /recipes.

Output vocabulary (all already common in the library):
  agni-digestive-fire, digestion-and-nutrient-absorption, blood-sugar-regulation,
  constipation, protein-adequacy-vegetarian, gut-microbiome,
  anti-inflammatory-diet, hydration-and-brain-function
"""
from __future__ import annotations

# low-glycaemic grains / legumes / sprouts → blood-sugar-regulation
_LOWGI = (
    "jowar", "sorghum", "bajra", "pearl millet", "ragi", "finger millet", "millet",
    "foxtail", "kodo", "barnyard", "little millet", "oat", "barley", "quinoa",
    "buckwheat", "brown rice", "black rice", "red rice", "amaranth", "rajgira",
    "whole wheat", "besan", "chickpea flour", "moong", "lentil", "dal", "chana",
    "rajma", "lobia", "cowpea", "sprout", "chickpea", "black gram", "horse gram",
)
# fermented / cultured → gut-microbiome
_FERMENTED = (
    "curd", "yogurt", "yoghurt", "buttermilk", "chaas", "idli", "idly", "dosa",
    "dhokla", "kanji", "pickle", "achaar", "miso", "kimchi", "sauerkraut",
    "fermented", "appam", "kadhi", "handvo", "kombucha", "tempeh",
)
# anti-inflammatory signals
_ANTIINFLAM = (
    "turmeric", "haldi", "ginger", "flax", "alsi", "walnut", "omega", "spinach",
    "palak", "methi", "fenugreek", "moringa", "drumstick", "mackerel", "sardine",
    "salmon", "amla", "tulsi", "green tea",
)
# digestive spices (used to keep drinks in the digestive lane vs plain hydration)
_DIGESTIVE_SPICE = (
    "jeera", "cumin", "ajwain", "carom", "ginger", "hing", "asafoetida", "fennel",
    "saunf", "pepper", "mint", "pudina", "coriander", "curry lea", "tulsi",
)
_MEAT = (
    "chicken", "mutton", "lamb", "fish", "prawn", "shrimp", "crab", "meat",
    "beef", "pork", "keema", "egg", "bangda", "mackerel", "sardine", "salmon",
)


def _text(recipe: dict) -> str:
    parts = [str(recipe.get("name") or "")]
    parts += [str(x) for x in (recipe.get("main_ingredients") or [])]
    for ing in (recipe.get("ingredients") or []):
        if isinstance(ing, dict):
            parts.append(str(ing.get("item", "")))
    return " ".join(parts).lower()


def derive_good_for(recipe: dict) -> list[str]:
    """Return an ordered, de-duped list of good_for tags for a recipe dict.

    Never returns an empty list — falls back to the most generic digestive tag.
    """
    text = _text(recipe)
    rich = {str(t).lower() for t in (recipe.get("rich_in") or [])}
    diets = {str(d).lower() for d in (recipe.get("diet") or [])}
    meals = {str(m).lower() for m in (recipe.get("meal_type") or [])}
    np = recipe.get("nutrients_per_serving") or {}
    try:
        fibre = float(np.get("fibre_g") or 0)
    except (TypeError, ValueError):
        fibre = 0.0
    try:
        kcal = float(recipe.get("approx_kcal_per_serving")
                     or recipe.get("kcal_per_serving") or 0)
    except (TypeError, ValueError):
        kcal = 0.0
    has_meat = any(w in text for w in _MEAT)

    is_drink = bool(meals) and meals <= {"drink"}
    is_condiment = bool(meals) and meals <= {"condiment"}

    tags: list[str] = []

    def add(t: str) -> None:
        if t not in tags:
            tags.append(t)

    # base digestive tags for real cooked dishes (the library norm ~75%)
    if not is_drink and not is_condiment:
        add("agni-digestive-fire")
        add("digestion-and-nutrient-absorption")

    # fibre → constipation relief
    if "fibre" in rich or fibre >= 6:
        add("constipation")

    # low-GI grains / legumes, or high-fibre-and-light → blood sugar
    if any(g in text for g in _LOWGI) or ("fibre" in rich and 0 < kcal <= 400):
        add("blood-sugar-regulation")

    # vegetarian protein adequacy
    if "protein" in rich and ({"vegetarian", "vegan", "eggetarian"} & diets) and not has_meat:
        add("protein-adequacy-vegetarian")

    # fermented → gut microbiome
    if any(f in text for f in _FERMENTED):
        add("gut-microbiome")

    # anti-inflammatory signals
    if "omega-3" in rich or any(w in text for w in _ANTIINFLAM):
        add("anti-inflammatory-diet")

    # drinks: keep in a sensible lane
    if is_drink:
        if any(w in text for w in _DIGESTIVE_SPICE):
            add("digestion-and-nutrient-absorption")
        else:
            add("hydration-and-brain-function")

    if not tags:
        add("agni-digestive-fire")
    return tags
