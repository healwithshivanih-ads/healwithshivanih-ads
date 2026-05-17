# Drug entry authoring prompt — FMDB `DrugDepletion` schema

Paste this whole block to an AI when you want it to draft one or more new
`drug_depletions/<slug>.yaml` files for the FM Database catalogue. The
output is plain YAML that drops directly into `fm-database/data/drug_depletions/`.

---

You are extracting clinical drug information for a Functional Medicine
coaching catalogue. The catalogue captures medications across **three
axes**, not just nutrient depletions:

1. **Implied diagnosis** — what conditions does prescribing this drug
   imply about the client?
2. **Protocol cautions** — what foods, supplements, practices, lab
   monitoring, or referral coordination does the drug constrain?
3. **Nutrient depletion** — what specific nutrients does this drug
   deplete or interfere with, and what's the standard FM replacement?

For each drug or drug-class I name, produce ONE YAML file in this exact
schema. Output the YAML in a fenced code block per drug, prefixed by a
one-line filename hint like `# file: cromolyn-sodium.yaml`.

## Hard rules (non-negotiable)

- **slug** — lowercase, hyphens only, ASCII, no spaces. For a class entry,
  use the plural class name (e.g. `tyrosine-kinase-inhibitors`,
  `glp1-agonists`).
- **drug_aliases** — include EVERY common brand name AND every common
  Indian brand name (drug names in India can be wildly different from US/UK).
  Include common misspellings, abbreviations, generic name variants.
  For a class entry, list every member drug as an alias so a mention of
  any one brand name resolves to the class entry.
- **drug_class** — must be one of:
  `thyroid_hormone | metformin | ppi | h2_blocker | statin |
   oral_contraceptive | hrt | beta_blocker | ace_inhibitor | arb |
   thiazide_diuretic | loop_diuretic | ssri | snri | benzodiazepine |
   nsaid | aspirin | corticosteroid | antibiotic | methotrexate |
   insulin | sulfonylurea | levodopa | phenytoin | valproate |
   antipsychotic | mast_cell_stabiliser |
   leukotriene_receptor_antagonist | anti_ige_biologic |
   h1_antihistamine | tyrosine_kinase_inhibitor | glp1_agonist |
   sglt2_inhibitor | dpp4_inhibitor | other`.
- **evidence_tier** — must be one of:
  `strong | plausible_emerging | fm_specific_thin | confirm_with_clinician`.
- **status** — `active`.
- **updated_at** — today's ISO date (YYYY-MM-DD).
- **updated_by** — `shivani`.
- **DO NOT invent topic slugs**. Use `topic_slug: null` if you're not
  sure whether the catalogue has the canonical topic. Suggested topics
  to use only if they exist: `insulin-resistance`, `pcos`, `hypertension`,
  `dyslipidaemia`, `hypothyroidism`, `hashimotos-thyroiditis`,
  `gerd-acid-reflux`, `hypochlorhydria`, `dysbiosis`,
  `histamine-intolerance-mcas`, `mast-cell-activation`,
  `chronic-urticaria`, `allergic-asthma`, `food-allergy-ige`,
  `depression-anxiety`, `chronic-pain`, `autoimmune-inflammation`,
  `chronic-kidney-disease`, `oncology-supportive-care`,
  `cardiovascular-prevention`, `hormonal-contraception`,
  `antibiotic-induced-dysbiosis`.
- **No clinical jargon in `coach_notes`** — write for a coach reading the
  entry between sessions. Plain language, 2-4 sentences, specific.
- **No US-centric brand monopoly** — always include the Indian brand
  names alongside US/UK ones (Indian coach uses this).

## Schema

```yaml
slug: <slug>                            # required, lowercase-hyphens
drug_name: <Canonical Name>             # required
drug_aliases:                           # required, at least 3 entries
  - <brand 1>
  - <brand 2>
  - <generic variant>
  - <Indian brand>
drug_class: <one of enum above>         # required
summary: |                              # 2-4 sentences. What is it,
  <why is it prescribed, who gets it,    #  what's the clinical context.
   any important warnings>

# ── 1. NUTRIENT DEPLETIONS ──────────────────────────────────────
depletes:                               # list — empty list [] is fine
  - nutrient: <name>                    # e.g. "Vitamin B12 (cobalamin)"
    severity: <mild | moderate | severe>
    mechanism: <1 sentence — pharmacology>
    monitoring_recommendation: <lab + frequency>
    typical_supplement_dose: <FM-appropriate replacement>

# ── 2. CONDITION IMPLICATIONS (NEW — what the drug TELLS US) ───
# Each entry: what diagnosis is this drug most often prescribed for?
# Confidence:
#   high     = near-pathognomonic. e.g. cromolyn → MCAS.
#              Use this when the drug is almost exclusively used for
#              this condition.
#   moderate = common but not exclusive. e.g. metformin → T2D
#              (also PCOS, prediabetes). Will surface as "Suspected: …".
#   low      = one of many indications. Will be IGNORED — only use if
#              you really can't narrow further.
condition_implications:
  - label: <human-readable diagnosis>   # what coach should see in active_conditions
    confidence: <high | moderate | low>
    rationale: <1-2 sentence why this drug implies this dx>
    topic_slug: <topic slug or null>    # leave null if uncertain

# ── 3. PROTOCOL CAUTIONS (NEW — what the FM protocol must respect) ─
# kind options:
#   avoid_food         — coach must steer meal plan away from these
#   avoid_supplement   — block in supplement_protocol
#   avoid_practice     — exclude from lifestyle / detox protocols
#   prefer_food        — meal plan should emphasise these
#   prefer_supplement  — protocol should include these (with prescriber OK)
#   timing             — when to take what, away from what
#   refer              — coordinate with prescriber / specialist
#   monitor            — coach should track this at every check-in
# severity:
#   critical = blocks the plan. Must be addressed before letters go out.
#   warning  = surfaces in plan-check; doesn't block but coach must read.
#   info     = informational; informs prompts and meal-plan generator.
protocol_cautions:
  - kind: <one of enum above>
    item: <free-text — specific foods / supplements / practices>
    severity: <critical | warning | info>
    reason: <1-line WHY — used in plan-check finding text>

# ── Standard fields ────────────────────────────────────────────
timing_separations:                     # list of free-text rules
  - "<e.g. Take 4h apart from calcium, iron, coffee>"

contraindicated_supplements:            # list of supplement SLUGS, not names
  - <supplement-slug>                   # must exist in catalogue — or omit

monitoring_labs:                        # list of free-text lab + frequency
  - <e.g. B12 + MMA annually>

coach_notes: |                          # 2-4 sentences, plain language
  <how a coach should think about this drug at the chair>

linked_to_topics:                       # list of topic slugs
  - <topic-slug>

linked_to_mechanisms: []                # leave empty unless you know real slugs

sources:                                # at least 1 entry
  - id: coach-shivani                   # use this for coach-derived entries
    location: <where in your reasoning>
    quote: <1-sentence summary of what makes this drug entry worth having>

evidence_tier: <strong | plausible_emerging | fm_specific_thin | confirm_with_clinician>
version: 1
status: active
updated_at: <YYYY-MM-DD today>
updated_by: shivani
```

## Examples to anchor

The catalogue already has these as references; match their depth and
phrasing tone:

- `cromolyn-sodium.yaml` — high-confidence MCAS implication, rich
  protocol_cautions for low-histamine framing
- `tyrosine-kinase-inhibitors.yaml` — class entry with 30+ aliases,
  critical-severity refer + avoid_supplement cautions, oncology
  coordination front and centre
- `metformin.yaml` — heavy on `depletes` (B12 severe, folate mild,
  CoQ10 mild), high-conf insulin-resistance + moderate-conf PCOS
- `proton-pump-inhibitors.yaml` — chronic acid suppression cascade,
  GERD high + functional hypochlorhydria moderate

## Drugs to add (substitute your list)

Generate one YAML per drug below in the schema above:

- <drug 1>
- <drug 2>
- <drug N>

If any drug name is ambiguous (multiple compounds share that name across
countries) — ask me which one to scope before generating.

---

After generation, save each YAML to
`fm-database/data/drug_depletions/<slug>.yaml` and run
`fmdb validate` to confirm 0 errors.
