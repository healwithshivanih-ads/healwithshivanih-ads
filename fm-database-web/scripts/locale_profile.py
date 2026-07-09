#!/usr/bin/env python3
"""Location-aware directive for the recipe + grocery generators.

The client cooks the SAME (largely Indian) dishes wherever they live, but the
UNITS they measure in and the STORE they shop at change by country. Krittika is
in Fairfax, USA — an "Indian metric, Mumbai household" grocery list is wrong for
her (she buys in lb/oz at a US store and gets ragi/toor dal from an Indian
grocery). This returns one client-specific directive block that both generators
prepend to the (uncached) user message, so the cached system prompt stays
generic and the per-client locale specialises it.

`country` is the raw client.yaml value (free text). We classify loosely.
"""
from __future__ import annotations

_US = {
    "united states", "united states of america", "usa", "us", "u.s.", "u.s.a.",
    "america", "united-states",
}
_INDIA = {"india", "bharat", "in", ""}


def classify(country: str | None) -> str:
    c = (country or "").strip().lower()
    if c in _US:
        return "us"
    if c in _INDIA:
        return "india"
    # A few more western/metric countries worth naming explicitly; everything
    # else falls through to the generic metric profile.
    return "other"


def locale_directive(country: str | None, mode: str) -> str:
    """`mode` is 'recipe' or 'grocery'. Returns a directive to prepend to the
    user message. Empty-safe."""
    kind = classify(country)
    country_label = (country or "India").strip() or "India"

    if kind == "india":
        if mode == "grocery":
            return (
                "LOCALE — India (Mumbai household): use Indian shopping names "
                "(atta, dahi, paneer, methi, palak, jeera, haldi). Quantities in "
                "Indian METRIC only — grams / kilograms / millilitres / litres or "
                "count. NEVER pounds (lb), ounces (oz) or cups-as-purchase-size."
            )
        return (
            "LOCALE — India: standard Indian kitchen. Ingredient quantities in "
            "metric (g / ml / tsp / tbsp) or count."
        )

    if kind == "us":
        if mode == "grocery":
            return (
                "LOCALE — United States: the client cooks Indian food but shops at "
                "US grocery stores. Use US grocery names with the Indian name in "
                "brackets where helpful (e.g. \"Plain whole-milk yogurt (dahi)\", "
                "\"Cilantro (coriander)\", \"Chickpea flour (besan)\"). Quantities "
                "in US units the store sells in — lb / oz, or count, and standard "
                "US pack sizes (e.g. \"1 lb\", \"a 5-oz bag\", \"1 bunch\"). For "
                "Indian-specific staples (ragi/finger-millet flour, toor/moong/"
                "masoor dal, curry leaves, methi/fenugreek, hing/asafoetida, "
                "jaggery) append \"(Indian grocery)\". Do NOT use Mumbai framing or "
                "metric-only sizes."
            )
        return (
            "LOCALE — United States: the client is in the US. Give ingredient "
            "quantities in US kitchen units (cups, oz, lb, °F for oven/temp) rather "
            "than grams. Keep the Indian name of each spice/ingredient. Where an "
            "ingredient is Indian-specific, that's fine — the client sources it "
            "from an Indian grocery or online."
        )

    # other / unknown western country → metric, generic store, flag Indian items
    if mode == "grocery":
        return (
            f"LOCALE — {country_label}: the client cooks Indian food but shops "
            "locally. Use everyday grocery names for that country with the Indian "
            "name in brackets where helpful. Quantities in metric (g / kg / ml / l) "
            "or count. For Indian-specific staples (ragi flour, toor/moong dal, "
            "curry leaves, methi, hing, jaggery) append \"(Indian grocery)\"."
        )
    return (
        f"LOCALE — {country_label}: give ingredient quantities in metric "
        "(g / ml / tsp / tbsp) or count. Keep Indian ingredient names; the client "
        "sources Indian-specific items from an Indian grocery or online."
    )
