---
name: author-assessment
description: Author an FM assessment for a client in chat at $0 (no API credits) while following the SAME guardrails the paid API path uses — the real 47-rule SYSTEM prompt, the real catalogue slug whitelist, and a deterministic validation gate that refuses unsafe or broken output. Activate on "author assessment", "run assessment for <client>", "assess <client> without API", "chat assessment", "/author-assessment", or whenever the coach wants an assessment done without spending API credits.
---

# Author an assessment in chat — gated, $0

## Why this exists

Two authors can write an assessment: the paid API (`synthesize()`) and this chat.
The API path's guardrails live in a 47-rule SYSTEM prompt plus a catalogue slug
whitelist. Chat authoring historically ran on *memory* of those rules (CLAUDE.md,
notes) — a summary, not the rules — which is why its output drifted.

This workflow removes the drift: **emit the exact briefing the paid model would
have received, author strictly from it, then submit through a validation gate
that can refuse.** Same inputs, same rules, same fence.

Never skip the gate. Never hand-write the session YAML. Both were the old
failure modes.

## The workflow

### 1. Emit the briefing (no spend)

```bash
cd fm-database-web && echo '{"client_id":"cl-0XX","symptoms":["..."],"topics":["..."],"complaints":"...","author_context":true}' \
  | ../fm-database/.venv/bin/python3 scripts/assess.py > /tmp/ctx.json
```

Returns: `system_prompt` (the real 47 rules), `client_ctx` (dossier — conditions,
meds, known_labs, cycle, IFM baseline, intake insights), `drug_context`
(condition implications + protocol cautions per matched medication), `subgraph`,
`slug_whitelist`, and `session_history`.

Read **all** of it before writing a word. In particular read `system_prompt` —
those rules govern your output, not your recollection of them.

### 2. Author strictly from that document

Hard constraints, all enforced in step 3:

- **Slugs**: reference only what is in `slug_whitelist`. Anything genuinely
  missing goes in `catalogue_additions_suggested` — never invent a slug.
- **Labs**: check `client_ctx.known_labs` first. If a marker is already on file,
  cite its value in your reasoning rather than re-ordering it. A genuine re-check
  must be `kind: "repeat"`.
- **Supplements**: honour `drug_context.protocol_cautions`. A de-prescription
  MUST carry `continue_or_change: "stop"` — that field is what keeps the item out
  of the generated plan.
- **Protein**: if a renal/urate marker is flagged high, keep protein moderate.
  Never push it.
- **Prose**: every client-facing line must be true of THIS client. No generic
  filler ("eat a balanced diet", "stay hydrated").

### 3. Submit through the gate

```bash
cd fm-database-web && echo '{"client_id":"cl-0XX","symptoms":[...],"topics":[...],"complaints":"...","chat_authored":{ ...AssessSuggestions... }}' \
  | ../fm-database/.venv/bin/python3 scripts/assess.py
```

- **Hard failures → nothing is saved.** The response lists each with a code and
  what to do. Fix and resubmit; retrying costs nothing.
- **Warnings → saved, but surfaced.** Read them; they usually want a small edit.
- On success the session is stamped `chat_authored (validated, no Anthropic call)`,
  which is auditably distinct from a real model run.

### 4. Generate the draft plan

```bash
cd fm-database-web && echo '{"client_id":"cl-0XX","session_id":"<from step 3>","picks":{}}' \
  | ../fm-database/.venv/bin/python3 scripts/generate-draft.py
```

Then run `plan-check` and fix anything CRITICAL before telling the coach it's ready:

```bash
cd fm-database && .venv/bin/python -m fmdb.cli plan-check <plan-slug>
```

## What the gate checks

**Hard (blocks the write)** — schema; unknown catalogue slugs (alias-aware);
supplement contraindicated with an active condition, a current medication, a
life-stage, or the client's pregnancy/lactation state; a supplement matching a
`known_allergies` entry; `avoid_together` medication interaction; drug-caution
`avoid_supplement`; a lab already on file not marked `repeat`; duplicate lab
orders (within the payload, whether or not the client has labs on file); protein
pushed on a renal/urate-flagged client; invalid `continue_or_change`.

**Warn (saves, but tells you)** — real slug that wasn't in this subgraph; missing
evidence-tier caveat on a thin-tier supplement; a repeat named but not
structured; out-of-range numerics (confidence_pct, fit_percent, duration_weeks,
due_in_weeks); generic filler prose.

## 4b. Adversarial self-review (the clinical-reasoning layer, $0)

The gate is mechanical: it catches unsafe and broken, never *unsound*. Before telling
the coach an assessment is ready, run one deliberate skeptic pass over your own work.
Model it on `fm-database/fmdb/plan/ai_check.py`, which does exactly this for a plan —
read its SYSTEM prompt for the categories and severity language, then apply the same
lens yourself, for free, instead of billing a Sonnet call.

Check, in this order, and state the verdict per item rather than a general impression:

1. **Coherence** — does the protocol actually address the drivers you named, or did you
   list drivers and then prescribe around them?
2. **Client fit** — re-read `client_ctx.active_conditions`, `current_medications`,
   `known_allergies`, `dietary_preference`, `non_negotiables`. Does every single item
   survive those? Name the ones you checked.
3. **Translation fidelity** — for each supplement, does your rationale match what the
   CATALOGUE says that supplement does? Inventing a plausible mechanism is the easiest
   error to make and the hardest for the coach to catch.
4. **Grounding** — can you point at a specific datum (a lab value, a quoted symptom, a
   medication) behind each recommendation? Anything you cannot ground is a guess wearing
   a clinical voice; cut it or label it.
5. **Sequencing** — is the load realistic for THIS client in week 1, given their
   anxiety, budget, and what they already take?

Write the findings down for the coach. If a check fails, fix it and re-submit through
the gate — do not report an assessment as ready with a known-soft finding buried.

## What the gate does NOT check

It cannot score clinical reasoning, tone, or whether an ATM classification is
right. Those stay with the coach, plan-check, and the plan editor — exactly as on
the API path. Passing the gate means "nothing structurally unsafe", not "this is
a good assessment".

## Notes

- Coach-side only. No Fly deploy. `$0` — no Anthropic call anywhere in this flow.
- The gate also runs on the paid API path, where it is advisory (the money is
  already spent, so findings are attached rather than blocking).
- Extra context you have gathered — WhatsApp messages, voice notes, the coach's
  own remarks — is a legitimate *addition* to the briefing. The guardrails
  constrain the output, not the inputs.
