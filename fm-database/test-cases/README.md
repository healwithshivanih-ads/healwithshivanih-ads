# Clinical Test Cases — FM Coach

Two case libraries that validate the catalogue + assess engine + protocol templates
against expected clinical behaviour. **All cases are SYNTHETIC.** No real PHI.

## Layout

```
test-cases/
  clinical/        # Golden cases — known-good FM clinical patterns
    <case-id>.yaml
  safety/          # Adversarial — must-block / must-warn / must-refer
    <case-id>.yaml
```

## Two test modes

### Static mode (default, free)

Validates without calling the AI:

- Every slug referenced in `client`, `intake`, and `expected` resolves to a
  canonical catalogue entry (topics, mechanisms, symptoms, supplements).
- Every `expected.must_warn` / `must_block` contraindication trace is reachable
  from the supplement's `contraindications` block in the catalogue.
- Every `expected.forbidden` slug is in the catalogue (so we know what we're
  forbidding actually exists to be recommended).
- Catches catalogue-coverage gaps before they reach production.

Run nightly / pre-commit:

```bash
cd fm-database
.venv/bin/python scripts/test-clinical.py
```

### Live mode (paid, ~$0.20 / case)

Actually runs `assess.synthesize()` against the case's intake and compares
the AI output against `expected.must_include` / `must_warn` / `must_refer`.

Use after major changes (new catalogue ingest, prompt change, template update):

```bash
.venv/bin/python scripts/test-clinical.py --mode live
```

## Case YAML schema

See `clinical/example-golden-case-template.yaml` and
`safety/example-safety-case-template.yaml` for full annotated examples.

Minimum required fields:

```yaml
case_id: <unique-slug>
case_type: golden | safety
synthetic: true                # always true — no real PHI ever
description: <one-line summary>
source: <where pattern is documented>

client:
  age_band: 30-35 | 35-40 | ...
  sex: F | M
  conditions: [<topic-slug>, ...]      # current diagnosed conditions
  medications: [<freeform>]
  allergies: [<freeform>]
  pregnancy_status: not_pregnant | pregnant | trying | lactating  # optional

intake:
  symptoms: [<symptom-slug>, ...]
  topics: [<topic-slug>, ...]          # what coach pre-selects
  presenting_complaints: <text>

expected:
  must_include:                        # at least one of these must appear
    drivers: [<topic-or-mech-slug>]
    supplements_any_of:
      - [<slug-A>, <slug-B>]           # AT LEAST ONE of A or B must appear
    topics: [<topic-slug>]

  must_warn: [<freeform-rule>]         # AI must surface these caveats
  must_block: [<freeform-rule>]        # AI must refuse / strongly caution
  must_refer: true | false             # AI must include referral to clinician
  forbidden: [<supplement-slug>]       # AI must NOT recommend these
```

## Adding new cases

1. Copy a template from `clinical/` or `safety/`.
2. Edit fields. Keep `synthetic: true`.
3. Run `scripts/test-clinical.py <case-id>` to validate the case schema and
   catalogue resolution.
4. Commit. Future catalogue / template / prompt changes will be tested against
   this case automatically.

## Triage philosophy

- **A case failing static validation** = catalogue gap or case-author bug.
  Fix the catalogue OR fix the case YAML.
- **A case failing live mode** = the system regressed clinically.
  Triage urgent: prompt drift, context window issues, catalogue contradiction.
- **All golden cases must pass** before publishing any prompt change to coach Mac.
