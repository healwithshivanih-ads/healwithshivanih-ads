#!/usr/bin/env python3
"""Extract canonical cookable dishes from active published plans' app_menu.

Drops non-recipe pills (nut/seed portions, single fruits, supplements, plain
liquids, raw garnishes/condiments). Canonicalises cookable dishes to a recipe
slug. Marks whether a library recipe (fm-database/data/_recipes) already
matches, using the same token-overlap heuristic the app uses.

Output: JSON list of {slug, dish, query, has_library_recipe, library_slug}.
"""
import yaml, glob, os, re, json, sys

PLANS = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/fm-plans/published")
RECIPES = os.path.join(os.path.dirname(__file__), "..", "..", "fm-database",
                       "data", "_recipes")

# ---- collect dish pills -----------------------------------------------------
dishes = set()
for f in glob.glob(PLANS + "/*.yaml"):
    try:
        d = yaml.safe_load(open(f))
    except Exception:
        continue
    am = (d or {}).get("app_menu") or {}

    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get("dish"), str):
                dishes.add(o["dish"].strip())
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(am)

pills = set()
for dsh in dishes:
    for p in re.split(r"\s\+\s|→|:", dsh):
        p = re.sub(r"\s+", " ", p).strip()
        if p:
            pills.add(p)

# ---- classify ---------------------------------------------------------------
# A pill is a cookable DISH if it contains a cooking-form keyword.
DISH_KW = [
    "sabzi", "subzi", "subji", "dal", "daal", "khichdi", "khichdi", "kichari",
    "upma", "chilla", "cheela", "chila", "dosa", "idli", "uttapam", "roti",
    "bhakri", "curry", "stew", "soup", "broth", "poha", "pulao", "pongal",
    "bhurji", "omelette", "omelet", "shakshuka", "bharta", "thoran", "poriyal",
    "raita", "chutney", "sambar", "rasam", "muthia", "tikka", "keema", "sukka",
    "scramble", "stir-fry", "stir fry", "sabji", "porridge", "laddoo", "chivda",
    "puffs", "salad", "slaw", "kachumber", "chaat", "smoothie", "kanji", "tadka",
    "fry", "masala", "pulav", "panna", "sherbet", "thoran", "bhel", "paratha",
]
# Never a standalone recipe (portions / garnishes / supplements / raw items).
SKIP_KW = [
    "magnesium", "collagen", "protein", "prebiotic", "probiotic", "ashwagandha",
    "triphala", "moringa powder", "aloe vera", "warm water", "jeera water",
    "methi water", "methi seed water", "coconut water", "green tea",
    "herbal tea", "buttermilk", "chaas", "warm milk", "glass of milk",
    "almond", "walnut", "cashew", "pumpkin seed", "sunflower seed", "brazil nut",
    "flaxseed", "flaxseeds", "ground flax", "mixed seeds", "til", "seeds",
    "soaked date", "dates", "makhana", "roasted chana", "roasted makhana",
    "amla", "kiwi", "banana", "apple", "orange", "pear", "guava", "papaya",
    "muskmelon", "watermelon", "fruit", "coconut", "boiled egg", "egg)", "1 egg",
    "ghee", "coconut oil", "turmeric", "haldi", "cinnamon", "black pepper",
    "cumin", "jeera", "rock salt", "lemon", "mint", "coriander", "curry leaves",
    "cucumber", "radish", "celery", "carrot stick", "capsicum crud",
    "papad", "curd", "dahi", "yogurt", "kokum", "aam panna", "kanji",
    "cabbage", "spinach", "broccoli", "cauliflower", "beans", "greens",
    "sprouts", "sabzi (ridge", "nuts", "a few", "scoop", "tbsp", "tsp",
]


def is_skip(p):
    pl = p.lower()
    # quantity-only / supplement / raw garnish
    for k in SKIP_KW:
        if k in pl:
            # but keep if it ALSO has a strong dish form (e.g. "cabbage sabzi")
            if any(dk in pl for dk in DISH_KW):
                return False
            return True
    return False


def is_dish(p):
    pl = p.lower()
    if not any(dk in pl for dk in DISH_KW):
        return False
    if is_skip(p):
        return False
    return True


# Bare generics — too vague to source a meaningful photo / author one recipe.
BARE_SKIP = {
    "dal", "salad", "broth", "chutney", "sabzi", "subzi", "curry", "soup",
    "mixed-dal", "seasonal-sabzi", "curry-leaves", "salad-with-lemon",
    "green-salad", "healing-broth", "vegetable-soup", "vegetable",
}


def slugify(name):
    s = name.lower()
    s = re.sub(r"\([^)]*\)", " ", s)           # drop parentheticals
    s = re.split(r"—|;", s)[0]                  # drop trailing coach notes
    # collapse variant tails to the BASE dish (app fuzzy-matches variants)
    s = re.sub(r"\bwith\b.*$", " ", s)          # "besan chilla with spinach" → besan chilla
    s = re.sub(r"[½¾⅓¼\d]+", " ", s)           # drop numbers/fractions
    s = re.sub(r"\b(small|medium|large|fresh|light|new|cup|cups|tbsp|tsp|"
               r"bowl|portion|g|grams|piece|pieces|first|intro|introduce|"
               r"today|style|homemade|home-set|plain|well|cooked|dry|"
               r"roasted|steamed|sautéed|sauteed|grilled|pan-seared|"
               r"semi-solid|combined|grain|no|onion|garlic|tomato|"
               r"dairy|jain)\b", " ", s)
    s = re.sub(r"[^a-z ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"\s", "-", s)


# canonical collapse: map slug → representative dish (shortest, cleanest)
canon = {}
for p in pills:
    if not is_dish(p):
        continue
    slug = slugify(p)
    if not slug or len(slug) < 3 or slug in BARE_SKIP:
        continue
    if slug not in canon or len(p) < len(canon[slug]):
        canon[slug] = p

# ---- library recipe match (token overlap, app-style) ------------------------
STOP = {"and", "with", "the", "of", "in", "a", "to", "or"}


def toks(s):
    return [t for t in re.sub(r"[^a-z ]", " ", s.lower()).split()
            if len(t) > 2 and t not in STOP]


lib = []
for f in glob.glob(RECIPES + "/*.yaml"):
    if os.path.basename(f).startswith("_"):
        continue
    try:
        r = yaml.safe_load(open(f))
    except Exception:
        continue
    if not r or not r.get("name"):
        continue
    lib.append((r.get("slug") or os.path.basename(f)[:-5], r["name"]))


def lib_match(dish):
    dt = set(toks(dish))
    best = None
    for slug, name in lib:
        rt = set(toks(name))
        if not rt:
            continue
        hit = len(rt & dt)
        # near-equality: most recipe tokens present, dish adds little
        if hit >= 2 and len(rt) - hit <= 1:
            if not best or hit > best[1]:
                best = (slug, hit)
        elif len(rt) == 1 and hit == 1:
            if not best:
                best = (slug, hit)
    return best[0] if best else None


out = []
for slug, dish in sorted(canon.items()):
    lm = lib_match(dish)
    out.append({
        "slug": slug,
        "dish": dish,
        "query": re.sub(r"\([^)]*\)", "", dish).strip() + " recipe indian",
        "has_library_recipe": bool(lm),
        "library_slug": lm,
    })

print(json.dumps(out, indent=2, ensure_ascii=False))
sys.stderr.write(f"\n{len(out)} canonical dishes "
                 f"({sum(1 for o in out if o['has_library_recipe'])} have library recipe, "
                 f"{sum(1 for o in out if not o['has_library_recipe'])} missing)\n")
