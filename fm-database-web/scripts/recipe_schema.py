"""The recipe library's vocabulary and schema check, in one place.

Every enum below used to exist in up to five copies — validate-recipes.py,
approve-recipe-candidate.py, the two AI tool schemas, and a regex table in
promote-generated-recipe.py. They had already drifted: promote emitted the
allergen `fish`, which no other copy considered valid, and mapped prawn to
`fish` while approve mapped it to `shellfish`.

That drift is not cosmetic. `is_safe()` in recipe_select.py excludes a recipe
by matching the client's allergy list against `contains_allergens`, so an
allergen the vocabulary doesn't know about is an allergen nobody is protected
from. Add new values HERE and every path picks them up.
"""
from __future__ import annotations

import os
import re

from recipe_times import check_times

MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack", "side", "drink", "salad", "soup", "condiment"}
# non_vegetarian is in active use across the library AND the app's dietary
# filter keys on it (client-app.ts recipeDietLevel) — it MUST be valid here.
DIETS = {"vegetarian", "vegan", "jain", "eggetarian", "non_vegetarian", "gluten_free", "dairy_free", "nut_free"}
DOSHAS = {"vata", "pitta", "kapha"}
# "all" = year-round; the established convention for season-agnostic recipes.
SEASONS = {"spring", "summer", "monsoon", "autumn", "winter", "all"}
RASAS = {"sweet", "sour", "salty", "pungent", "bitter", "astringent"}
# fish and shellfish stay separate: a shellfish allergy is common without any
# finned-fish allergy, and collapsing them would over-restrict every menu.
# (is_safe() substring-matches both ways, so "fish" still catches "shellfish"
# — the split costs nothing in safety and buys precision.)
ALLERGENS = {"dairy", "gluten", "nuts", "peanut", "soy", "egg", "fish", "shellfish", "sesame", "mustard"}

REQUIRED = ("slug", "name", "meal_type", "one_line")

# template slots that were meant to be substituted before the recipe shipped.
# `as appropriate` is matched bare, not only in parentheses: the seven salads
# that shipped "steam the main vegetables/sprouts as appropriate" wrote it
# unbracketed, so the parenthesised form alone reported nothing.
_PLACEHOLDER_RE = re.compile(
    r"\(as named\)|\bas named\b|\bas appropriate\b|<[a-z_]+>|\{\{", re.I)

IMAGE_RIGHTS = (None, "", "none", "book_reference_uncleared", "web_reference_uncleared",
                "licensed", "original", "original_generated", "generated_reference")

# words that describe a food but never name one — see the ingredient check in
# check_recipe(). Deliberately excludes real one-word foods the library uses as
# shorthand (chana, moong, toor, masoor, palak, ragi, til, coconut, mint…).
_MODIFIER_ONLY = {"little", "large", "small", "medium", "green", "red", "white",
                  "black", "mixed", "vegetable", "vegetables", "fresh", "whole",
                  "raw", "plain", "sweet", "hot", "quick", "easy", "assorted"}
_MILLET_STEMS = {"foxtail", "kodo", "sama", "samak", "barnyard", "proso",
                 "browntop", "kutki", "kangni"}

# ingredient keyword -> allergen. Ghee is deliberately NOT dairy (library
# convention). Word-boundary matched, so "til " needs no trailing-space hack
# and "crab" won't fire on "crabapple".
ALLERGEN_KEYWORDS: dict[str, tuple[str, ...]] = {
    # bare "butter" is deliberately absent — "sunflower seed butter" and
    # "almond or sunflower butter" both read as dairy otherwise, and real dairy
    # butter here is named (makhan / white butter). Ghee is not dairy by
    # library convention.
    "dairy": ("milk", "paneer", "yogurt", "yoghurt", "curd", "dahi", "cheese", "cream",
              "makhan", "white butter", "salted butter", "unsalted butter",
              "chhena", "khoya", "malai"),
    # "crouton" is bread by another name and the scan was blind to it —
    # beetroot-soup shipped croutons while claiming `gluten_free`.
    "gluten": ("wheat", "atta", "maida", "barley", "bulgur", "rye", "semolina", "rava",
               "sooji", "suji", "dalia", "seitan", "bread", "pasta", "crouton"),
    "nuts": ("almond", "cashew", "walnut", "pistachio", "pecan", "hazelnut", "macadamia"),
    "peanut": ("peanut", "groundnut", "moongphali"),
    # dish-form words like "omelette"/"bhurji" are NOT egg keywords — besan
    # omelette and tofu bhurji are both eggless
    "egg": ("egg", "eggs"),
    "fish": ("fish", "anchovy", "anchovies", "tuna", "salmon", "pomfret", "rohu", "surmai",
             "bangda", "mackerel", "sardine", "hilsa", "basa", "katla", "seafood"),
    "shellfish": ("prawn", "prawns", "shrimp", "crab", "lobster", "squid", "mussel",
                  "mussels", "clam", "clams", "oyster", "oysters"),
    "soy": ("soy", "soya", "tofu", "tempeh", "tamari", "edamame", "miso"),
    "sesame": ("sesame", "til", "tahini"),
    "mustard": ("mustard", "sarson", "rai"),
}

MEAT_WORDS = ("chicken", "mutton", "lamb", "fish", "prawn", "shrimp", "crab", "meat",
              "beef", "pork", "keema")
ROOT_WORDS = ("onion", "garlic", "potato", "carrot", "beet", "radish", "ginger",
              "turnip", "yam")

# The trailing `s?` is load-bearing. Without it `\bcashew\b` matched "cashew
# curd" but not "cashews", so foxtail-millet-pongal shipped with untagged
# cashews while tofu-tikka was caught — the gate was blind to exactly the
# spelling an ingredient list actually uses. Plurals were hand-listed for
# egg/fish/shellfish and forgotten for the other 67 keywords.
_ALLERGEN_RE = {
    allergen: re.compile(r"\b(" + "|".join(re.escape(w) for w in words) + r")s?\b")
    for allergen, words in ALLERGEN_KEYWORDS.items()
}

# Coconut milk, almond milk and peanut butter are not dairy — and coconut milk
# is in a large slice of this library, so without this the dairy signal is
# mostly false positives. Scrubbed for the dairy pass only, so "soy milk" still
# reports soy.
_PLANT_DAIRY = re.compile(
    r"\b(coconut|almond|soy|soya|oat|rice|cashew|hemp|flax|peanut|walnut|nut)\s+"
    r"(milk|cream|butter|yoghurt|yogurt|curd)\b")

# "bajra rava" and "jowar flour" are millet, not wheat — without this every
# millet upma reports gluten.
_MILLET_GRAIN = re.compile(
    r"\b(bajra|jowar|ragi|nachni|millet|rice|corn|maize|besan|chickpea|almond|coconut)\s*"
    r"[\w()]*\s*(rava|suji|sooji|semolina|flour|atta)\b")

_SCRUB = {"dairy": _PLANT_DAIRY, "gluten": _MILLET_GRAIN}

# A parenthetical that tells the cook how to VARY the dish names a food the
# recipe as written does not contain: "2 tbsp cream (use soy cream for vegan)"
# is a dairy recipe, not a soy one. Stripped before every allergen pass, so the
# tag describes what is actually in the pot. Only instruction parentheticals
# match — "(~250 g)" and "(kala namak)" are left alone.
_SUBSTITUTION_PAREN = re.compile(
    r"\(\s*(?:use|omit|swap|substitute|replace|skip)\b[^)]*\)", re.I)

# Mustard is excluded from the gap check (not from the vocabulary): tempering
# seed appears in most Indian savoury cooking, so gap-checking it flags ~86
# recipes and buries the allergens where a miss actually harms someone. Tag it
# by hand when mustard is a headline ingredient, as sarson fish curry does.
GAP_CHECK_ALLERGENS = ALLERGENS - {"mustard"}


def derive_allergens(ingredient_text: str) -> set[str]:
    """Allergens implied by an ingredient blob. Conservative: keywords only."""
    text = _SUBSTITUTION_PAREN.sub(" ", (ingredient_text or "").lower())
    return {
        a for a, rx in _ALLERGEN_RE.items()
        if rx.search(_SCRUB[a].sub(" ", text) if a in _SCRUB else text)
    }


def check_recipe(d: dict, fname: str) -> tuple[list[str], list[str]]:
    """Schema-check one recipe mapping. Returns (errors, warnings)."""
    errs: list[str] = []
    warns: list[str] = []

    for k in REQUIRED:
        if not d.get(k):
            errs.append(f"{fname}: missing required '{k}'")

    slug = d.get("slug", "")
    if slug and (not all(c.isalnum() or c == "-" for c in slug) or not slug.islower()):
        errs.append(f"{fname}: bad slug {slug!r}")
    if slug and slug != os.path.splitext(fname)[0]:
        warns.append(f"{fname}: slug {slug!r} != filename")

    def sub(field, valid, hard=True):
        bad = set(str(x).lower() for x in (d.get(field) or [])) - valid
        if bad:
            (errs if hard else warns).append(
                f"{fname}: {field} has invalid {sorted(bad)} (allowed: {sorted(valid)})")

    sub("meal_type", MEAL_TYPES); sub("diet", DIETS); sub("balances_dosha", DOSHAS)
    sub("aggravates_dosha", DOSHAS); sub("seasons", SEASONS); sub("rasa", RASAS)
    sub("contains_allergens", ALLERGENS, hard=False)

    for k in ("approx_kcal_per_serving", "protein_g"):
        if d.get(k) is not None and not isinstance(d[k], (int, float)):
            errs.append(f"{fname}: {k} must be a number")

    if not (d.get("method") or "").strip() and not (d.get("steps") or []):
        warns.append(f"{fname}: no method/steps stored")

    # the client card shows prep+cook as one "N min" chip, so passive soak
    # time folded into prep is a client-visible error, not a nitpick
    for msg in check_times(d.get("prep_time_min"), d.get("cook_time_min")):
        errs.append(f"{fname}: {msg}")

    # an untagged allergen is one the client is not protected from — warn (not
    # error) because the keyword scan can't see every brand name or variant
    declared = {str(a).lower() for a in (d.get("contains_allergens") or [])}
    # ingredients only — the dish NAME lies ("Cream of Mushroom Soup" is made
    # with rice milk here, besan omelette has no egg)
    blob = " ".join([
        str(d.get("main_ingredients") or ""),
        str(d.get("ingredients") or ""),
    ])
    missed = (derive_allergens(blob) & GAP_CHECK_ALLERGENS) - declared
    if missed:
        warns.append(
            f"{fname}: ingredients suggest {sorted(missed)} but contains_allergens "
            f"is {sorted(declared) or '[]'} — clients with that allergy are not filtered out")

    # unfilled template slot: "mixed salad vegetables / sprouts (as named)".
    # main_ingredients is checked too — the first version of this guard only
    # looked at `ingredients`, so 9 recipes kept the placeholder in
    # main_ingredients and the validator reported zero. main_ingredients is
    # not cosmetic: client-app.ts loads it as `mains` and the dish matcher
    # searches it.
    placeholder_sites = [str(i.get("item", "") if isinstance(i, dict) else i)
                         for i in (d.get("ingredients") or [])]
    placeholder_sites += [str(m) for m in (d.get("main_ingredients") or [])]
    for item in placeholder_sites:
        if _PLACEHOLDER_RE.search(item):
            errs.append(f"{fname}: {item!r} still holds a template placeholder "
                        f"— substitute the food the title names")

    # …and in the STEPS. The guard above only ever read the two ingredient
    # lists, so seven salads shipped step 1 as "Chop or lightly steam the main
    # vegetables/sprouts as appropriate" — a beetroot salad telling the client
    # to steam sprouts it does not contain. The client reads the method.
    for n, s in enumerate(d.get("steps") or [], 1):
        if _PLACEHOLDER_RE.search(str(s)):
            errs.append(f"{fname}: step {n} still holds a template placeholder "
                        f"— write the step for the food this recipe actually uses")

    # A one-word ingredient that is only a MODIFIER names no food: the recipe
    # generator substituted the first slug token into the item and stopped, so
    # the client's card read "½ cup little" (little-millet-khichdi), "1 cup
    # green" (green-chutney), "1 cup vegetable" (vegetable-millet-pulao).
    # Bare millet varieties are the same bug one step later — "foxtail" and
    # "sama" are not foods until the word `millet` follows them.
    for i in (d.get("ingredients") or []):
        item = str(i.get("item", "") if isinstance(i, dict) else i).strip()
        w = item.lower()
        if w in _MODIFIER_ONLY or (w in _MILLET_STEMS and "millet" not in w):
            errs.append(f"{fname}: ingredient {item!r} names no food — it is the "
                        f"slug's first word, not the ingredient")

    # a name cut mid-parenthesis ("Prawn omelette (75g prawns") is a bad split,
    # and the client sees the raw title
    nm = str(d.get("name") or "")
    if nm.count("(") != nm.count(")"):
        errs.append(f"{fname}: name {nm!r} has unbalanced parentheses — looks truncated")

    if not (d.get("ingredients") or []):
        warns.append(f"{fname}: no ingredients — the client app skips recipes like this")

    img = d.get("image") or {}
    if isinstance(img, dict) and img.get("rights_status") not in IMAGE_RIGHTS:
        errs.append(f"{fname}: image.rights_status invalid ({img.get('rights_status')!r})")

    return errs, warns
