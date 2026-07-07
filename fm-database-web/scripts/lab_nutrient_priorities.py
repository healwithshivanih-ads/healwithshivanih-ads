"""Map a client's off-range lab markers to recipe `rich_in` nutrient tags.

Shared by recipe_select.py (letter shortlist ranking) and, mirrored, by the
TS dish picker (recipe-picker.ts). When a client's ferritin is low, iron-rich
dishes should surface first; when vitamin D is suboptimal, so should the few
vitamin-D carriers, and so on.

Deliberately conservative — this NUDGES ranking, never filters. It reads only
markers flagged `low` / `suboptimal` (a deficiency the diet can help with);
a `high` marker is handled case-by-case (homocysteine high → needs folate+B12;
CRP/ESR high → omega-3). We never down-rank on a high nutrient marker because
you can't un-eat iron from a menu.

Returns {rich_in_tag: weight}. Weight is 1.0 for a suboptimal marker and 1.5
for a frank low/high — so a genuine deficiency outranks a borderline one.
"""
from __future__ import annotations

import re

# rich_in tag -> substrings that identify a marker measuring that nutrient's
# status. Matched case-insensitively against marker_name. Order-independent.
_MARKER_TO_TAG = {
    "iron": ["ferritin", "serum iron", "transferrin sat", "tsat", "hemoglobin",
             "haemoglobin", "hematocrit", "haematocrit", " mch", "mcv", "iron studies"],
    "b12": ["b12", "b-12", "cobalamin", "holotc", "holotranscobalamin", "active b12"],
    "folate": ["folate", "folic"],
    "vitamin-d": ["vitamin d", "25-oh", "25 oh", "25(oh)", "cholecalciferol"],
    "magnesium": ["magnesium"],
    "calcium": ["calcium"],  # serum calcium low; 24-hr urine calcium excluded below
    "zinc": ["zinc"],
    "potassium": ["potassium"],
    "omega-3": ["omega-3 index", "omega 3 index", "omega-3", "epa", "dha"],
    "protein": ["albumin", "total protein", "serum protein"],
    "vitamin-c": ["vitamin c", "ascorb"],
}

# markers whose name matches a tag above but which do NOT indicate that
# nutrient's dietary status (excluded from the deficiency mapping).
_EXCLUDE = ["24-hr urine calcium", "urine calcium", "a/g ratio", "globulin"]

# high-marker rules: a HIGH marker that a specific nutrient helps correct.
_HIGH_RULES = {
    "homocysteine": {"folate": 1.5, "b12": 1.2},
    "crp": {"omega-3": 1.0},
    "hs-crp": {"omega-3": 1.0},
    "esr": {"omega-3": 1.0},
}

_LOW_FLAGS = {"low", "suboptimal", "deficient", "borderline"}


def lab_nutrient_priorities(client: dict) -> dict[str, float]:
    """client -> {rich_in tag: boost weight}. Empty when no actionable marker."""
    out: dict[str, float] = {}
    markers = client.get("lab_markers") if isinstance(client, dict) else None
    if not isinstance(markers, list):
        return out

    for m in markers:
        if not isinstance(m, dict):
            continue
        name = str(m.get("marker_name") or "").lower().strip()
        if not name or any(x in name for x in _EXCLUDE):
            continue
        flag = str(m.get("flag") or "").lower().strip()

        # deficiency-style: low / suboptimal marker -> boost its nutrient
        if flag in _LOW_FLAGS:
            weight = 1.5 if flag in ("low", "deficient") else 1.0
            for tag, needles in _MARKER_TO_TAG.items():
                if any(n in name for n in needles):
                    out[tag] = max(out.get(tag, 0.0), weight)

        # high-marker corrective rules (homocysteine, inflammation)
        if flag == "high":
            for needle, tags in _HIGH_RULES.items():
                if needle in name:
                    for tag, w in tags.items():
                        out[tag] = max(out.get(tag, 0.0), w)

    return out


def priority_label(priorities: dict[str, float]) -> str:
    """Human phrase for the coach: 'boosted for low iron, vitamin D'."""
    if not priorities:
        return ""
    tags = sorted(priorities, key=lambda t: -priorities[t])
    pretty = [t.replace("-", " ") for t in tags]
    return "boosted for " + ", ".join(pretty)


_WORD_RE = re.compile(r"[a-z0-9-]+")


def recipe_lab_boost(recipe: dict, priorities: dict[str, float]) -> float:
    """Score bonus for a recipe whose rich_in tags match client priorities."""
    if not priorities:
        return 0.0
    rich = {str(t).lower() for t in (recipe.get("rich_in") or [])}
    return sum(w for tag, w in priorities.items() if tag in rich)
