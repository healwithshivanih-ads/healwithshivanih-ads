# _recipes — recipe store (Phase 0)

Lightweight, app-ready recipe library. NOT a first-class catalogue entity yet
(leading underscore, like _backlog.yaml / _cleanup/). Read by
fm-database-web/scripts/recipe_select.py to inject a filtered, dosha/season/diet-
matched shortlist into client meal-plan letters, and structured for the future
client mobile app's full-recipe display. Schema-check: `python scripts/validate-recipes.py`.

## Schema (per <slug>.yaml)
  slug, name                                  # required
  meal_type: [breakfast|lunch|dinner|snack|side|drink]    # required
  diet: [vegetarian|vegan|jain|eggetarian|gluten_free|dairy_free|nut_free]   # hard diet filter
  region                                       # optional
  seasons: [spring|summer|monsoon|autumn|winter]          # season ranking
  balances_dosha / aggravates_dosha: [vata|pitta|kapha]   # dosha ranking (aggravate = DOWN-RANK, not excluded)
  rasa: [sweet|sour|salty|pungent|bitter|astringent]      # optional
  main_ingredients: [...]                      # lowercased item names — used for foods-to-avoid filtering
  contains_allergens: [dairy|gluten|nuts|peanut|soy|egg|shellfish|sesame|mustard]   # allergen safety filter
  # full recipe (mobile app):
  ingredients: [{item, qty, unit}]             # full ingredient list (facts, captured faithfully)
  steps: [str]                                 # method, written in our OWN words (not the author's prose)
  servings, prep_time_min, cook_time_min
  approx_kcal_per_serving, protein_g, kcal_is_estimate    # estimates for calorie-aware ranking
  good_for: [<topic-slug>...]                  # real catalogue topic slugs — relevance ranking
  one_line, headnote                           # our own short descriptions
  attribution: {author, book, source_id, page} # credit shown in the app
  image: {file, credit, rights_status, note}   # rights_status: book_reference_uncleared | licensed | original | none
  sources: [{id, location}]
  version, status, updated_at, updated_by

## IMPORTANT — images & rights
- Recipe photos extracted from source books live under images/ which is GITIGNORED
  (uncleared copyrighted binaries are never committed). Only the YAML reference +
  rights flag are committed.
- image.rights_status = "book_reference_uncleared" -> internal authoring reference
  ONLY. The mobile-app / JSON export MUST exclude any image whose rights_status is
  not "licensed" or "original". Replace placeholders with licensed or own photos
  before client-facing use.
- Recipe text: ingredient lists are facts; method steps + descriptions are written
  in our own words and credited to the author/book.

## _candidates.yaml (gitignored)
Accumulates AI-invented (cautioned) meals captured from generated letters, for the
coach to review + promote into real recipes.
