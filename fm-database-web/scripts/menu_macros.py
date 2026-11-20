"""
menu_macros — the client app's menu grams, in Python, for the weekly drafter.

A MIRROR of three TypeScript modules, pinned to them by
src/lib/fmdb/menu-macros-parity.test.ts over the real recipe library:
  meal-macros.ts     macrosFromServing, isNothing, mealMacros
  recipe-portion.ts  recipePortion, menuPortion, portionFactor
  plain-foods.ts     buildPlainFoodLookup
Change one side, change the other, or the parity test fails.

Why a copy: the drafter (generate-week-menu.py) must add up each drafted day
exactly as the app will show it to the client, so it can build the day to
the client's target (scripts/day_targets.py) and fix a day that misses.
"""
from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

import yaml

_DATA = Path(__file__).resolve().parent.parent.parent / "fm-database" / "data"
MIN_COVERAGE = 90
MAX_PORTION_KCAL = 700  # meal-macros.ts MAX_PORTION_KCAL
KEYS = ("protein_g", "carbs_g", "fat_g", "fibre_g")


def _js_round(v: float) -> int:
    """Math.round: halves go up."""
    return int(math.floor(v + 0.5))


# ── recipe-portion.ts ───────────────────────────────────────────────────────
PIECE_DRY_G = [
    (r"phulka", 25), (r"chapati|chapathi|\broti\b", 30), (r"bhakri|bhakar", 40), (r"thepla", 35),
    (r"paratha|parotta", 45), (r"chilla|cheela|chila", 40), (r"pesarattu|\badai\b", 45),
    (r"uttapam|uthappam", 55), (r"dosa|dosai", 45), (r"idli|idly", 20), (r"appe\b|appam|paniyaram", 12),
    (r"pancake", 40), (r"\bpuri\b|poori", 20),
]
DAL_PER_BOWL_G, GRAIN_PER_BOWL_G, KHICHDI_PER_BOWL_G = 30, 45, 60
VEG_PER_BOWL_G, GLASS_G, READY_PER_BOWL_G, TBSP_G = 150, 250, 160, 15
SOUP_RE = r"\bsoup\b|rasam|shorba|broth|\bstock\b|chowder|consomm"
SALAD_RE = r"salad|slaw|kachumber|koshimbir|raita|dressing|vinaigrette"
GLASS_RE = r"smoothie|lassi|chaas|buttermilk|\bmilk\b|juice|kanji|shake|\bdrink\b|latte|kadha|\btea\b|infusion|sharbat|\bwater\b"
SPOON_RE = r"chutney|\bpodi\b|pickle|\bdip\b|thokku|achar|gunpowder|spice mix|masala powder|pesto"
KHICHDI_RE = r"khichdi|khichri|pongal|bisi bele"
SABZI_RE = r"sabzi|sabji|bhaji|palya|poriyal|thoran|\bsaag\b|stir.?fry|subzi|usal|curry|kootu|avial"
DRY = {"dry", "dried", "raw", "soaked", "sprouted"}
UNITS = ("piece", "bowl", "glass", "tbsp")


def _round_half(q: float) -> float:
    return _js_round(q * 2) / 2


def recipe_portion(name: str, lines: list | None, servings: float | None, table: dict, hand_set: Any = None) -> dict | None:
    if isinstance(hand_set, dict) and isinstance(hand_set.get("qty"), (int, float)) and hand_set["qty"] > 0 and hand_set.get("unit") in UNITS:
        return {"qty": hand_set["qty"], "unit": hand_set["unit"]}
    if not lines or not servings or servings <= 0:
        return None
    n = name.lower()
    g: dict[str, float] = {}
    total = 0.0
    for l in lines:
        info = table.get(l.get("key")) if l.get("key") else None
        info = info if isinstance(info, dict) else None
        cat = (info or {}).get("category") or "none"
        basis = (info or {}).get("basis") or "dry"
        bucket = "ready" if cat in ("dal_legume", "grain", "flour") and basis not in DRY else cat
        per = float(l.get("g") or 0) / servings
        g[bucket] = g.get(bucket, 0.0) + per
        total += per
    v = lambda k: g.get(k, 0.0)  # noqa: E731

    def out(q: float, unit: str):
        if not math.isfinite(q) or q <= 0:
            return None
        return {"qty": max(0.5, min(6, _round_half(q))), "unit": unit}

    if re.search(SOUP_RE, n) or re.search(SALAD_RE, n) or re.search(r"sandwich|chaat|\btoast\b|\bbowl\b|\bwrap\b", n):
        return None
    for pat, per in PIECE_DRY_G:
        if re.search(pat, n):
            dry = v("flour") + v("grain") + v("dal_legume")
            return out(dry / per, "piece") if dry > 0 else None
    if re.search(GLASS_RE, n):
        return out(total / GLASS_G, "glass")
    if re.search(SPOON_RE, n):
        return out(total / TBSP_G, "tbsp")
    dal = v("dal_legume")
    grain = v("grain") + v("flour")
    if re.search(KHICHDI_RE, n) and dal + grain > 0:
        return out((dal + grain) / KHICHDI_PER_BOWL_G, "bowl")
    if dal + grain >= 8 and v("ready") < 50:
        return out(dal / DAL_PER_BOWL_G + grain / GRAIN_PER_BOWL_G, "bowl")
    if v("ready") >= 50 and dal + grain < 8:
        return out((v("ready") + v("vegetable") + v("leafy")) / READY_PER_BOWL_G, "bowl")
    if re.search(SABZI_RE, n):
        veg = total - v("oil_fat") - v("spice") - v("condiment")
        return out(veg / VEG_PER_BOWL_G, "bowl") if veg >= 25 else None
    return None


def menu_portion(portion: str | None) -> dict | None:
    t = (portion or "").lower().replace("½", "0.5").replace("¼", "0.25").strip()
    if not t:
        return None
    num = None
    f = re.search(r"(\d+)\s*/\s*(\d+)", t)
    if f:
        num = int(f.group(1)) / int(f.group(2))
    else:
        m = re.search(r"\d+(?:\.\d+)?", t)
        if m:
            num = float(m.group(0))
        elif re.search(r"\bhalf\b", t):
            num = 0.5
        elif re.search(r"\b(a|one)\b", t):
            num = 1
    size = 0.7 if re.search(r"\bsmall\b", t) else 1.3 if re.search(r"\b(large|big)\b", t) else 1
    q = num if num is not None else 1
    if re.search(r"\bcups?\b", t):
        return {"qty": q * size, "unit": "bowl", "asGlass": q * size * 0.8}
    if re.search(r"\b(bowls?|katoris?|plates?|servings?)\b", t):
        return {"qty": q * size, "unit": "bowl"}
    if re.search(r"\b(glass|glasses|mugs?)\b", t):
        return {"qty": q * size, "unit": "glass"}
    if re.search(r"\b(tbsp|tablespoons?)\b", t):
        return {"qty": q, "unit": "tbsp"}
    if re.search(r"\b(tsp|teaspoons?)\b", t):
        return {"qty": q / 3, "unit": "tbsp"}
    if re.fullmatch(r"\d+(?:\.\d+)?", t) or re.search(r"\b(pieces?|pcs?|nos?)\b", t):
        return {"qty": num, "unit": "piece"} if num else None
    return None


def portion_factor(serving: dict | None, menu: dict | None) -> float | None:
    if not serving or not menu:
        return None
    if serving["unit"] == menu["unit"]:
        qty = menu["qty"]
    elif serving["unit"] == "glass" and menu.get("asGlass"):
        qty = menu["asGlass"]
    else:
        return None
    fct = qty / serving["qty"]
    return fct if math.isfinite(fct) and fct > 0 else None


# ── meal-macros.ts ──────────────────────────────────────────────────────────
def _norm(s: str) -> str:
    s = re.sub(r"\([^)]*\)", " ", s.lower())
    s = re.sub(r"[^a-z\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


NOTHING_WORD = re.compile(
    r"^(magnesium|glycinate|capsules?|tablets?|supplements?|probiotics?|omega|vitamins?|sublingual|water|warm|plain|lemon|lime|ginger|garlic|coriander|cilantro|mint|curry|leaf|leaves|hing|asafoetida|turmeric|haldi|cumin|mustard|seeds?|jeera|tempering|tadka|garnish|herbs?|spices?|masala|rock|black|salt|pepper|chill?ies|chill?i|to|taste|pinch|squeeze|drizzle|sprinkle|seasoning|fresh|few|a|of|and|with|some|crushed|chopped|grated|juice|slice|slices|clove|cloves|sprig|sprigs)$"
)


def is_nothing(component: str) -> bool:
    words = [w for w in _norm(component).split(" ") if w]
    return bool(words) and all(NOTHING_WORD.match(w) for w in words)


def macros_from_serving(per: Any, coverage: Any) -> dict | None:
    if not isinstance(per, dict):
        return None
    try:
        cov = float(coverage)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(cov) or cov < MIN_COVERAGE:
        return None
    out = {}
    for k in KEYS:
        try:
            v = float(per.get(k))
        except (TypeError, ValueError):
            return None
        if not math.isfinite(v) or v < 0:
            return None
        out[k] = v
    return out


# ── plain-foods.ts ──────────────────────────────────────────────────────────
COUNTED = {"dairy", "nut_seed", "dried_fruit", "fruit", "protein", "vegetable", "leafy", "grain", "dal_legume"}
PIECE_G = {"almonds": 1.2, "walnuts": 2.5, "cashews": 1.5, "pistachios": 0.7, "peanuts": 0.6, "dates": 8, "figs-dried": 8,
           "raisins": 0.5, "egg": 50, "banana": 100, "apple": 150, "orange": 130, "kiwi": 75, "guava": 100, "pear": 150, "amla": 30}
PIECE_BY_CATEGORY = {"fruit": 100, "nut_seed": 1.5, "dried_fruit": 5}
BOWL_G = {"dairy": 150, "leafy": 40, "vegetable": 100, "fruit": 120, "nut_seed": 120, "grain": 150, "dal_legume": 150}
PLAIN_GLASS_G = 200
PLAIN_TBSP_G = {"nut_seed": 9, "dairy": 15, "dried_fruit": 10}
DILUTED = re.compile(r"\b(tea|chai|coffee|kahwa|kadha|water|infusion|decoction)\b")


def _norm_plain(s: str) -> str:
    s = re.sub(r"\([^)]*\)", " ", s.lower())
    s = re.sub(r"[^a-z'\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


class MenuMacros:
    """Load the library + ingredient table once; then meal() / day()."""

    def __init__(self, recipes: list[dict] | None = None, table: dict | None = None):
        if table is None:
            table = yaml.safe_load((_DATA / "_ingredient_nutrients.yaml").read_text(encoding="utf-8")) or {}
        self.table = {k: v for k, v in table.items() if k != "_meta" and isinstance(v, dict)}
        if recipes is None:
            recipes = []
            for f in sorted((_DATA / "_recipes").glob("*.yaml")):
                if f.name.startswith("_"):
                    continue
                try:
                    recipes.append(yaml.safe_load(f.read_text(encoding="utf-8")) or {})
                except Exception:
                    continue
        idx = []
        for r in recipes:
            m = macros_from_serving(r.get("nutrients_per_serving"), r.get("nutrient_coverage_pct"))
            if not m:
                continue
            try:
                servings = float(r.get("nutrient_servings") or r.get("servings") or 0)
            except (TypeError, ValueError):
                servings = 0
            portion = recipe_portion(str(r.get("name") or ""), r.get("nutrient_lines"), servings, self.table, r.get("serving_portion"))
            try:
                kcal = float((r.get("nutrients_per_serving") or {}).get("kcal") or 0)
            except (TypeError, ValueError):
                kcal = 0
            if kcal and kcal / ((portion or {}).get("qty") or 1) > MAX_PORTION_KCAL:
                continue  # a data error (wrong ingredient match): no grams
            for nm in [r.get("name") or ""] + list(r.get("aliases") or []):
                name = _norm(str(nm))
                if len(name) >= 5:
                    idx.append((name, {"m": m, "portion": portion, "title": r.get("name")}))
        idx.sort(key=lambda x: -len(x[0]))
        self._recipes = idx
        plain = []
        for key, e in self.table.items():
            if e.get("category") not in COUNTED or not isinstance(e.get("per_100g"), dict):
                continue
            for a in [key.replace("-", " ")] + list(e.get("aliases") or []):
                alias = _norm_plain(str(a))
                if len(alias) >= 3:
                    plain.append((alias, key, e))
        plain.sort(key=lambda x: -len(x[0]))
        self._plain = plain

    def recipe(self, component: str) -> dict | None:
        c = _norm(component)
        if len(c) < 5:
            return None
        for name, hit in self._recipes:
            if c == name or f" {name} " in f" {c} ":
                return hit
        return None

    def plain(self, title: str, portion: str | None) -> dict | None:
        t = _norm_plain(title)
        if not t or DILUTED.search(t):
            return None
        hit = next((x for x in self._plain if f" {x[0]} " in f" {t} "), None)
        if not hit:
            return None
        p = menu_portion(portion)
        if not p:
            return None
        _, key, e = hit
        cat = e.get("category") or ""
        grams = None
        if p["unit"] == "piece":
            grams = p["qty"] * PIECE_G.get(key, PIECE_BY_CATEGORY.get(cat, float("nan")))
        elif p["unit"] == "bowl":
            grams = p["qty"] * BOWL_G.get(cat, float("nan"))
        elif p["unit"] == "glass":
            grams = p["qty"] * PLAIN_GLASS_G
        elif p["unit"] == "tbsp":
            grams = p["qty"] * PLAIN_TBSP_G.get(cat, float("nan"))
        if not grams or not math.isfinite(grams):
            return None
        per = e["per_100g"]
        f = grams / 100
        return {k: (float(per[k]) * f if isinstance(per.get(k), (int, float)) else 0.0) for k in KEYS}

    def meal(self, components: list[dict]) -> dict | None:
        """components: [{"title", "portion"}] — mealMacros."""
        s = dict.fromkeys(KEYS, 0.0)
        found = unsure = 0
        for comp in components:
            c = (comp.get("title") or "").strip()
            if not c:
                continue
            hit = self.recipe(c)
            if hit:
                found += 1
                fct = portion_factor(hit["portion"], menu_portion(comp.get("portion")))
                if fct is None:
                    unsure += 1
                for k in KEYS:
                    s[k] += hit["m"][k] * (fct if fct is not None else 1)
            elif not is_nothing(c):
                pm = self.plain(c, comp.get("portion"))
                if pm:
                    found += 1
                    for k in KEYS:
                        s[k] += pm[k]
                else:
                    unsure += 1
        if not found:
            return None
        return {**{k: _js_round(s[k]) for k in KEYS}, "complete": unsure == 0}

    @staticmethod
    def split(dish: str) -> list[dict]:
        """A drafted cell "A (1 bowl) + B (2)" → components. Simpler than the
        app's splitter (no glosses or stages); good enough to check a draft."""
        out = []
        parts, depth, cur = [], 0, ""
        for ch in dish or "":  # split on "+" outside brackets only
            depth += ch in "([" and 1 or (-1 if ch in ")]" else 0)
            if ch == "+" and depth <= 0:
                parts.append(cur)
                cur = ""
            else:
                cur += ch
        parts.append(cur)
        for part in parts:
            part = part.strip()
            if not part:
                continue
            m = re.match(r"^(.*?)\s*\(([^()]*)\)\s*$", part)  # the LAST bracket is the portion
            out.append({"title": m.group(1).strip(), "portion": m.group(2).strip()} if m else {"title": part, "portion": None})
        return out

    def day(self, dishes: list[str]) -> dict:
        s = dict.fromkeys(KEYS, 0)
        complete = True
        for d in dishes:
            m = self.meal(self.split(d))
            if not m:
                complete = False
                continue
            complete = complete and m["complete"]
            for k in KEYS:
                s[k] += m[k]
        return {**s, "complete": complete}

    def per_portion_line(self, title: str, portion: str) -> str | None:
        """'Toor dal (1 bowl): protein 7 g, carbs 19 g, fat 3 g' for the prompt."""
        m = self.meal([{"title": title, "portion": portion}])
        if not m or not m["complete"]:
            return None
        return f"{title} ({portion}): protein {m['protein_g']} g, carbs {m['carbs_g']} g, fat {m['fat_g']} g"
