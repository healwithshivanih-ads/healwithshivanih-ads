# Food-dosha guidelines (reference asset)

`lad-food-dosha-chart.yaml` — the full Ayurvedic Institute / Lad dosha food chart as machine-readable data: per category, per dosha (vata/pitta/kapha), the FAVOR and AVOID food lists (with `*` = moderation, `**` = rarely).

This is a REFERENCE ASSET, not a validated fmdb entity (underscore-prefixed dir is skipped by `fmdb validate`). It is the authoritative per-food dosha-suitability lookup for the recipe/plan tooling — e.g. to derive or validate a recipe's `balances_dosha`/`aggravates_dosha` from its `main_ingredients`, or to pick dosha-appropriate foods for a client's constitution. Same dosha vocabulary as the `_recipes/` library.

Source: `lad-ayurvedic-institute-food-chart`. Built from the chart by transcription; the chart itself notes the guidelines are general and individualised by agni/season/aggravation.
