# _recipes — Phase 0 lightweight recipe store

NOT a first-class catalogue entity yet (hence the leading underscore — like
_backlog.yaml / _cleanup/). Read by fm-database-web/scripts/recipe_select.py to
build a filtered, vetted, dosha/season/diet-matched shortlist that is injected
into the meal-bearing letter prompts. NOT wired into `fmdb validate`; use
`python scripts/validate-recipes.py` for a schema check.

Schema (per <slug>.yaml):
  slug, name                         # required
  meal_type: [breakfast|lunch|dinner|snack|side|drink]   # required, >=1
  diet: [vegetarian|vegan|jain|eggetarian|gluten_free|dairy_free|nut_free]  # for hard diet filter
  region: north_indian|south_indian|...        # optional
  seasons: [spring|summer|monsoon|autumn|winter]   # season ranking
  balances_dosha / aggravates_dosha: [vata|pitta|kapha]   # dosha ranking (aggravate = down-rank, NOT excluded)
  rasa: [sweet|sour|salty|pungent|bitter|astringent]      # optional
  main_ingredients: [...]            # used for foods-to-avoid filtering
  contains_allergens: [dairy|gluten|nuts|peanut|soy|egg|shellfish|sesame]   # allergen safety filter
  approx_kcal_per_serving, protein_g # optional — feeds calorie-aware ranking
  good_for: [<topic-slug>...]        # relevance ranking (use real catalogue topic slugs)
  one_line                           # the description shown to the AI in the shortlist
  method                             # full steps (stored now so Phase 2 is half-done)
  source                             # source id

_candidates.yaml accumulates AI-invented (⚠) meals from generated letters for the
coach to review + promote into real recipes.
