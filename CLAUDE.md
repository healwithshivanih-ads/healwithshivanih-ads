# CLAUDE.md — Project Context

This file is loaded automatically at the start of every Claude Code session.
Update it as the project evolves so future sessions resume with full context.

## Project: FM Database (Project 1)

Internal functional medicine catalogue used by coaches to author structured
client plans. A future client-facing mobile app (Project 2) will consume
published plans as JSON artifacts.

**Active branch:** `claude/functional-medicine-database-hQxA8`
**Licensing:** Proprietary (all rights reserved, internal-only)

## Status

**v0.1 (current)** — `Supplement` entity working end-to-end:
- Pydantic schema + loader + validator + CLI (`validate`, `list`, `show <slug>`)
- One seed entry: `magnesium-glycinate`
- Located at `fm-database/`

**Next:** Add `Source`, `Topic`, `Claim` entities; seed ~20 supplements from vitaone skill.

## Architecture (Locked)

### 17 Catalogue Entity Types
1. Topic — clinical area
2. Symptom — fuzzy matching
3. Mechanism — physiology
4. **Claim** — evidence-tiered assertion (first-class entity)
5. Supplement — abstract compound (Layer A; brand-agnostic)
6. Food — single item
7. LabTest — clinician-only (read access for coach)
8. LifestylePractice — single practice
9. DietaryPattern — eating frameworks
10. ReferralTrigger — red flags
11. Source — citation registry
12. Recipe — pantry meals
13. HomeRemedy — churans, infused waters
14. CookingAdjustment — cookware, oil swaps
15. MiscIntervention — catch-all
16. Protocol — multi-week programs
17. EducationalModule — learning units

### Authoring Model: Clinician-Partnered
- Coach writes lifestyle, nutrition education sections
- Clinician writes & signs prescriptive sections (supplements, labs)

### Evidence Tiers
`strong` | `plausible_emerging` | `fm_specific_thin` | `confirm_with_clinician`

### Plan Lifecycle
`draft` → `in_review` → `awaiting_clarification` → `ready_to_publish` → `published` → `superseded` | `revoked`

### Storage
- YAML catalogue committed to repo (this repo)
- Plan/client data: gitignored
- Audit log: JSONL

## File Map

```
fm-database/
  fmdb/
    __init__.py
    enums.py        # 8 enums (Timing, DoseUnit, EvidenceTier, ...)
    models.py       # Pydantic Supplement + supporting classes
    loader.py       # load_supplements, load_supplement
    validator.py    # validate_all (7 check categories)
    cli.py          # validate, list, show <slug>
  data/
    supplements/    # one YAML per supplement
  README.md
  requirements.txt
```

## Content Sources

Tier 1 (own material) at `.claude/skills/vitaone-fm-reference/`:
- `SKILL.md` — coaching scope (DO NOT use for prescriptive content rules)
- `references/topic_index.md` — symptom clusters, red flags
- `references/evidence_tiers.md` — 70+ tiered claims (model for Claim entity)
- `references/practice_guide.md` — coaching guidance (LifestylePractice / DietaryPattern / HomeRemedy seeds)
- `references/full_kb.md` — 122 posts

## Run

```
cd fm-database
pip install -r requirements.txt
python -m fmdb.cli validate
python -m fmdb.cli list
python -m fmdb.cli show magnesium-glycinate
```

## Roadmap

1. `Source` entity — registers vitaone skill + future inputs
2. `Topic` entity — so `Supplement.linked_to_topics` resolves
3. `Claim` entity — evidence-tiered assertions from evidence_tiers.md
4. Seed ~20 supplements from vitaone content
5. Ingestion pipeline — AI extraction → review CLI → approve
6. Plan schema + publishing flow (lifecycle, AI sanity check, diff-guard)
7. Plan storage (drafts/published/audit logs)
8. Clinician signing workflow for prescriptive sections
9. JSON export contract for Project 2 (mobile app)
