#!/usr/bin/env python3
"""Phase 0 "recipe-shortlist injection" — engine.

Pure, dependency-light helper used by render-client-letter.py to build a
*filtered, vetted, dosha/season/diet-matched* recipe shortlist that gets injected
into the meal-bearing letter prompts. The AI still writes the meals; this just
tells it which catalogue recipes to build from first (and to ⚠-mark anything it
invents so the coach can vet + promote it into the library).

Design notes:
- DECOUPLED: no Pydantic model, not wired into `fmdb validate`. Recipes live as
  lightweight YAML in fm-database/data/_recipes/<slug>.yaml.
- DOSHA = DOWN-RANK, not exclude (per coach decision): a dish that aggravates the
  client's dosha is penalised in ranking, never hard-filtered out.
- HARD filters are SAFETY only: dietary preference, allergens, foods-to-avoid.
- GRACEFUL: if the recipe dir is empty/missing, every public fn returns "" / [] so
  the letter is byte-identical to today's behaviour.

Public API:
- recipe_shortlist_for_letter(plan, client, weight_loss=None) -> str   # the prompt block
- select_recipes(recipes, client, plan, season=None, weight_loss=False) -> list
- build_block(shortlist, weight_loss=False) -> str
- collect_candidates(markdown) -> list[str]
- append_candidates(markdown, client_id, plan_slug) -> int
"""
from __future__ import annotations
import os, re, glob, datetime
try:
    import yaml
except Exception:                       # pragma: no cover
    yaml = None

DOSHAS = {"vata", "pitta", "kapha"}
MEAL_TYPES = ("breakfast", "lunch", "dinner", "snack", "side", "drink")

# ── locate the recipe store ────────────────────────────────────────────────
def _recipes_dir() -> str:
    env = os.environ.get("FMDB_RECIPES_DIR")
    if env:
        return env
    cat = os.environ.get("FMDB_CATALOGUE_DIR")
    if cat:
        return os.path.join(cat, "_recipes")
    here = os.path.dirname(os.path.abspath(__file__))           # .../fm-database-web/scripts
    root = os.path.dirname(os.path.dirname(here))                # repo root
    return os.path.join(root, "fm-database", "data", "_recipes")

def load_recipes(directory: str | None = None) -> list[dict]:
    directory = directory or _recipes_dir()
    if not yaml or not os.path.isdir(directory):
        return []
    out = []
    for fp in sorted(glob.glob(os.path.join(directory, "*.yaml"))):
        if os.path.basename(fp).startswith("_"):                # _candidates.yaml, _README etc.
            continue
        try:
            d = yaml.safe_load(open(fp, encoding="utf-8"))
            if isinstance(d, dict) and d.get("slug"):
                out.append(d)
        except Exception:
            continue
    return out

# ── season (MATCHES render-client-letter.py month->season mapping) ──────────
def derive_season_key(month: int, country: str = "India") -> str:
    india = (country or "India").lower() in ("india", "")
    if india:
        if month in (3, 4, 5):  return "summer"
        if month in (6, 7, 8, 9): return "monsoon"
        if month in (10, 11):   return "autumn"
        return "winter"
    if month in (3, 4, 5):  return "spring"
    if month in (6, 7, 8):  return "summer"
    if month in (9, 10, 11): return "autumn"
    return "winter"

# ── client-derived filters ─────────────────────────────────────────────────
def client_doshas(client: dict) -> set[str]:
    """Doshas to pacify — from prakruti string, AI vikruti read, and the quiz."""
    found = set()
    blob = str(client.get("ayurveda_constitution") or "").lower()
    # AI constitution read (latest assess) — structured vikruti if present
    read = client.get("ayurveda_constitution_read") or client.get("constitution_read") or {}
    if isinstance(read, dict):
        for d in (read.get("vikruti_doshas") or []):
            blob += " " + str(d).lower()
        blob += " " + str(read.get("vikruti_label") or "").lower()
        blob += " " + str(read.get("prakruti_label") or "").lower()
    for d in DOSHAS:
        if d in blob:
            found.add(d)
    if not found:
        # fall back to the self-assessment quiz tally
        quiz = client.get("dosha_self_assessment") or {}
        if isinstance(quiz, dict) and quiz:
            tally = {}
            for v in quiz.values():
                v = str(v).lower()
                if v in DOSHAS:
                    tally[v] = tally.get(v, 0) + 1
            if tally:
                top = max(tally.values())
                found = {k for k, n in tally.items() if n >= top * 0.6}
    return found

def _tokens(*free_text) -> set[str]:
    toks = set()
    for t in free_text:
        if not t:
            continue
        if isinstance(t, (list, tuple)):
            parts = t
        else:
            parts = re.split(r"[,;/]| and ", str(t))
        for p in parts:
            p = p.strip().lower()
            if len(p) >= 3:
                toks.add(p)
    return toks

_JAIN_BAD = ("onion", "garlic", "potato", "carrot", "beet", "radish", "turnip",
             "yam", "sweet potato", "mushroom", "ginger root")

def _full_ingredient_text(recipe: dict) -> str:
    """main_ingredients + the FULL ingredients list, lowercased.

    main_ingredients alone misses tempering/flavour-base items (garlic, onion)
    that recipes routinely list only in `ingredients` — a Jain- or
    avoid-list-scan against main_ingredients only will pass those through.
    """
    parts = list(recipe.get("main_ingredients") or [])
    for ing in recipe.get("ingredients") or []:
        if isinstance(ing, dict):
            parts.append(str(ing.get("item", "")))
        else:
            parts.append(str(ing))
    return " ".join(parts).lower()

def diet_ok(recipe: dict, dietary_preference: str) -> bool:
    dp = (dietary_preference or "").lower()
    diets = set(d.lower() for d in (recipe.get("diet") or []))
    if "vegan" in dp:
        return "vegan" in diets
    if "jain" in dp:
        if not ({"vegetarian", "vegan", "jain"} & diets):
            return False
        if "jain" in diets:
            return True
        ings = _full_ingredient_text(recipe)
        return not any(b in ings for b in _JAIN_BAD)
    if "egg" in dp:                                   # eggetarian
        return bool({"vegetarian", "vegan", "eggetarian"} & diets)
    if "non" in dp:                                   # non-vegetarian → anything ok
        return True
    if "veg" in dp:                                   # vegetarian
        return bool({"vegetarian", "vegan"} & diets)
    return True                                       # unspecified → no diet filter

def is_safe(recipe: dict, allergies: list, avoid_tokens: set[str]) -> bool:
    # allergens: match client allergy terms against the recipe's curated allergen set
    rec_allergens = set(a.lower() for a in (recipe.get("contains_allergens") or []))
    for a in (allergies or []):
        a = str(a).lower().strip()
        if a and any(a in ra or ra in a for ra in rec_allergens):
            return False
    # foods-to-avoid / triggers: substring match against the full ingredient list
    ings = _full_ingredient_text(recipe)
    for tok in avoid_tokens:
        if tok in ings:
            return False
    return True

def score_recipe(recipe: dict, doshas: set[str], season: str | None,
                 topics: set[str], region: str, weight_loss: bool,
                 lab_priorities: dict | None = None) -> float:
    s = 0.0
    bal = set(d.lower() for d in (recipe.get("balances_dosha") or []))
    agg = set(d.lower() for d in (recipe.get("aggravates_dosha") or []))
    if doshas:
        s += 3.0 * len(bal & doshas)
        s -= 2.0 * len(agg & doshas)          # DOWN-RANK aggravating dishes (not excluded)
    if season and season in [x.lower() for x in (recipe.get("seasons") or [])]:
        s += 2.0
    if topics:
        s += 2.0 * len(set(g.lower() for g in (recipe.get("good_for") or [])) & topics)
    if region and str(recipe.get("region") or "").lower() == region.lower():
        s += 1.0
    if weight_loss:
        k = recipe.get("approx_kcal_per_serving")
        if isinstance(k, (int, float)):
            s += 1.0 if k <= 350 else (-1.0 if k >= 550 else 0.0)
    # lab-aware: up-rank recipes rich in a nutrient the client is low on
    if lab_priorities:
        rich = {str(t).lower() for t in (recipe.get("rich_in") or [])}
        s += sum(w for tag, w in lab_priorities.items() if tag in rich)
    return s

# ── selection ──────────────────────────────────────────────────────────────
def select_recipes(recipes, client, plan, season=None, weight_loss=False,
                   per_meal=6, total=22):
    doshas = client_doshas(client)
    dp = client.get("dietary_preference") or ""
    allergies = client.get("known_allergies") or client.get("allergies") or []
    avoid = _tokens(client.get("foods_to_avoid"), client.get("reported_triggers"))
    # plan-level binding exclusions, if the caller routed them onto the plan
    nut = (plan or {}).get("nutrition") or {}
    avoid |= _tokens(nut.get("foods_to_remove"))
    topics = set(str(t).lower() for t in ((plan or {}).get("assessment", {}) or {}).get("focus_topics", []))
    topics |= set(str(c).lower() for c in (client.get("active_conditions") or []))
    region = (client.get("region") or "").lower()
    try:
        from lab_nutrient_priorities import lab_nutrient_priorities
        lab_priorities = lab_nutrient_priorities(client)
    except Exception:
        lab_priorities = {}

    eligible = []
    for r in recipes:
        if not diet_ok(r, dp):
            continue
        if not is_safe(r, allergies, avoid):
            continue
        eligible.append((score_recipe(r, doshas, season, topics, region, weight_loss, lab_priorities), r))
    eligible.sort(key=lambda x: x[0], reverse=True)

    # coverage: take up to `per_meal` per meal_type, then global cap
    chosen, seen, by_type = [], set(), {}
    for sc, r in eligible:
        mts = r.get("meal_type") or ["other"]
        if not any(by_type.get(mt, 0) < per_meal for mt in mts):
            continue
        if r["slug"] in seen:
            continue
        seen.add(r["slug"]); chosen.append((sc, r))
        for mt in mts:
            by_type[mt] = by_type.get(mt, 0) + 1
        if len(chosen) >= total:
            break
    return chosen     # list of (score, recipe)

# ── prompt block ───────────────────────────────────────────────────────────
def _fmt_rows(recipes, weight_loss=False) -> str:
    order = {m: i for i, m in enumerate(MEAL_TYPES)}
    rows = sorted(recipes, key=lambda r: order.get((r.get("meal_type") or ["other"])[0], 99))
    out = []
    for r in rows:
        mt = "/".join(r.get("meal_type") or ["meal"])
        kcal = r.get("approx_kcal_per_serving")
        kcal_s = f" (~{kcal} kcal)" if (weight_loss and isinstance(kcal, (int, float))) else ""
        one = (r.get("one_line") or r.get("name") or "").strip()
        out.append(f"  • [{mt}] {r.get('name')} — {one}{kcal_s}")
    return "\n".join(out)

def pinned_safety_warnings(client: dict, pinned: list) -> list:
    """Flag coach-pinned recipes that conflict with the client's diet/allergens."""
    dp = client.get("dietary_preference") or ""
    allergies = client.get("known_allergies") or client.get("allergies") or []
    avoid = _tokens(client.get("foods_to_avoid"), client.get("reported_triggers"))
    warns = []
    for r in pinned:
        if not diet_ok(r, dp):
            warns.append(f"{r.get('name')}: may not fit the '{dp}' diet")
        elif not is_safe(r, allergies, avoid):
            warns.append(f"{r.get('name')}: contains an allergen or avoided ingredient")
    return warns

def build_block(pinned: list, fill: list, weight_loss=False, client=None) -> str:
    """pinned + fill are lists of recipe dicts. The block frames the library as a
    PREFERRED PALETTE — the AI is explicitly free to compose other dishes too."""
    if not pinned and not fill:
        return ""
    sections = []
    if pinned:
        warns = pinned_safety_warnings(client or {}, pinned)
        wtxt = ("\n  ⚠ COACH-PIN SAFETY CHECK: " + "; ".join(warns)) if warns else ""
        sections.append("COACH-SELECTED RECIPES (the coach chose these specifically for this "
                        "client — use them where they fit a meal):\n" + _fmt_rows(pinned, weight_loss) + wtxt)
    if fill:
        sections.append("ALSO A GOOD FIT (dosha / season / diet-matched from the recipe library):\n"
                        + _fmt_rows(fill, weight_loss))
    body = "\n\n".join(sections)
    return f"""

═══════════════════════════════════════════════════════════════════════════
✦ RECIPE PALETTE for this client's meals — a PREFERRED palette, NOT a restriction.

{body}

HOW TO USE THIS PALETTE:
• Use the COACH-SELECTED recipes first (by exact name) wherever they fit a meal slot.
• Then draw on the "also a good fit" library recipes by name.
• You are NOT limited to these — freely compose ANY other suitable dish you judge
  right for her constitution, season, and preferences. Prefix any meal that is NOT
  from the lists above with "⚠ " so the coach can review and add it to the library.
• This palette does NOT override the binding FOODS_TO_REMOVE / season-avoid / dosha
  rules stated above — those still win.
• Keep the client's calorie targets; the kcal hints help balance the day.
═══════════════════════════════════════════════════════════════════════════
"""

# ── high-level convenience (what the letter calls) ─────────────────────────
def recipe_shortlist_for_letter(plan: dict, client: dict, weight_loss=None) -> str:
    recipes = load_recipes()
    if not recipes:
        return ""
    wl = bool(weight_loss and weight_loss.get("enabled"))
    season = derive_season_key(datetime.date.today().month, client.get("country") or "India")
    bymap = {r["slug"]: r for r in recipes}
    pinned_slugs = ((plan or {}).get("nutrition") or {}).get("recipes") or []
    pinned = [bymap[s] for s in pinned_slugs if s in bymap]
    if pinned:
        # The coach has a curated set (auto-suggested, then pruned) — that IS the
        # palette. Don't re-add library fill (it would undo the pruning). The AI
        # still composes anything else it needs (⚠-marked).
        fill = []
    else:
        # No curated set on the plan → auto-suggest the best matches in the letter.
        fill = [r for _sc, r in select_recipes(recipes, client, plan, season=season, weight_loss=wl)]
    return build_block(pinned, fill, weight_loss=wl, client=client)

# ── auto-suggestion (coach prunes, never hand-picks) ───────────────────────
def suggest_recipes_for_plan(client: dict, plan: dict, n: int = 16) -> list:
    """The best-matched recipes for this client — used to PRE-FILL the plan so the
    coach only has to remove a few, never pick from scratch. Returns recipe dicts
    (highest-scoring first, meal-type-balanced). Same scoring as the letter fill."""
    recipes = load_recipes()
    if not recipes:
        return []
    season = derive_season_key(datetime.date.today().month, client.get("country") or "India")
    wl = bool((client.get("weight_loss") or {}).get("enabled"))
    chosen = select_recipes(recipes, client, plan, season=season, weight_loss=wl, total=n)
    return [r for _sc, r in chosen]

# ── mobile-app export (rights-gated) ───────────────────────────────────────
def export_for_app(recipe: dict) -> dict:
    """Project-2 JSON shape for one recipe. ONLY emits a photo whose rights_status
    is licensed/original — book_reference_uncleared placeholders are dropped."""
    img = recipe.get("image") or {}
    cleared = img if img.get("rights_status") in ("licensed", "original") else None
    return {
        "slug": recipe.get("slug"), "name": recipe.get("name"),
        "meal_type": recipe.get("meal_type"), "diet": recipe.get("diet"),
        "seasons": recipe.get("seasons"),
        "balances_dosha": recipe.get("balances_dosha"), "aggravates_dosha": recipe.get("aggravates_dosha"),
        "ingredients": recipe.get("ingredients"), "steps": recipe.get("steps"),
        "servings": recipe.get("servings"),
        "prep_time_min": recipe.get("prep_time_min"), "cook_time_min": recipe.get("cook_time_min"),
        "kcal": recipe.get("approx_kcal_per_serving"), "protein_g": recipe.get("protein_g"),
        "headnote": recipe.get("headnote"), "one_line": recipe.get("one_line"),
        "good_for": recipe.get("good_for"),
        "attribution": recipe.get("attribution"),
        "image": ({"file": cleared.get("file"), "credit": cleared.get("credit")} if cleared else None),
    }

# ── candidate-recipe flywheel ──────────────────────────────────────────────
def collect_candidates(markdown: str) -> list[str]:
    """Find AI-invented meals (⚠-prefixed) in a generated letter."""
    if not markdown:
        return []
    out = []
    for m in re.finditer(r"⚠\s*([^\n|–—\-:][^\n|]{2,80})", markdown):
        name = m.group(1).strip(" *#·•").strip()
        if name and name not in out:
            out.append(name)
    return out

def append_candidates(markdown: str, client_id: str, plan_slug: str,
                      directory: str | None = None) -> int:
    cands = collect_candidates(markdown)
    if not cands or not yaml:
        return 0
    directory = directory or _recipes_dir()
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, "_candidates.yaml")
    existing = []
    if os.path.exists(path):
        try:
            existing = yaml.safe_load(open(path, encoding="utf-8")) or []
        except Exception:
            existing = []
    have = {(e.get("name"), e.get("plan_slug")) for e in existing if isinstance(e, dict)}
    added = 0
    for c in cands:
        if (c, plan_slug) in have:
            continue
        existing.append({"name": c, "client_id": client_id, "plan_slug": plan_slug,
                         "seen_at": datetime.date.today().isoformat(), "status": "open"})
        added += 1
    if added:
        yaml.safe_dump(existing, open(path, "w", encoding="utf-8"), sort_keys=False, allow_unicode=True)
    return added

# ── CLI: preview / selftest ────────────────────────────────────────────────
def _selftest():
    recipes = load_recipes()
    print(f"loaded {len(recipes)} recipe(s) from {_recipes_dir()}")
    client = {"display_name": "Test Client", "dietary_preference": "vegetarian",
              "ayurveda_constitution": "Pitta-Kapha", "country": "India",
              "known_allergies": ["peanut"], "foods_to_avoid": "brinjal, raw onion",
              "active_conditions": ["high cholesterol"]}
    # pin a recipe to exercise the coach-selected path
    pin = recipes[0]["slug"] if recipes else ""
    plan = {"assessment": {"focus_topics": ["dyslipidemia", "agni-digestive-fire"]},
            "nutrition": {"foods_to_remove": ["deep-fried food"], "recipes": [pin] if pin else []}}
    block = recipe_shortlist_for_letter(plan, client, weight_loss={"enabled": True})
    print(f"pinned: {pin or '(none)'}")
    print(block or "(empty block — add recipes to data/_recipes/)")

if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        _selftest()
    else:
        print("usage: python recipe_select.py --selftest")
