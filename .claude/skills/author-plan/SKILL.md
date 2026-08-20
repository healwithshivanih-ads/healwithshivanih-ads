---
name: author-plan
description: Author or continue a client's PLAN in chat at $0 (no API credits) with the same guardrails the paid path uses — the real predecessor, the real catalogue, the real product file, and plan-check as the gate that can refuse. Activate on "author plan", "write the next phase", "phase 2/3 plan for <client>", "continue <client>'s plan", "follow-up plan without API", "/author-plan", or whenever a plan needs writing and the coach does not want to spend credits.
---

# Author a plan in chat — gated, $0

## Why this exists

`author-assessment` fences chat-authored *assessments*. Nothing fenced chat-authored
**plans**, so they ran on recollection — and on 2026-08-02 that showed. A phase-3
plan was authored in chat by hand-rolling a one-off clone-and-patch script. It came
out clinically sound and passed plan-check, but along the way it:

- crashed twice on the Plan schema (`catalogue_snapshot` is REQUIRED; `tracking.habits`
  is a list of `{name, cadence}` objects, not the freeform strings CLAUDE.md still
  claims),
- carried the predecessor's `letter_token` onto the successor, which would have left
  two plans claiming one `/letter/<token>` URL,
- said nothing about whether the two new supplements could actually be BOUGHT — a
  question nothing in the pipeline asked until a check was added that same day.

The lesson is the same one the assessment skill learned: **author from the real
artefacts, then submit through something that can refuse.** For a plan the refuser is
`plan-check`, and `submit_plan` already blocks on CRITICAL.

## The workflow

### 1. Read the real predecessor and the real client — no summaries

```bash
cd fm-database && .venv/bin/python -m fmdb.cli plan-show <predecessor-slug>
cd fm-database && .venv/bin/python -m fmdb.cli client-show <client-id>
```

Then read, on disk, in full:

- `~/fm-plans/published/<predecessor>-vN.yaml` — every supplement's `coach_rationale`
  and `duration_weeks`, the `status_history` (mid-phase quick edits live there), and
  `notes_for_coach`.
- `~/fm-plans/clients/<id>/sessions/` — newest first. Check-ins and app MSQ rows are
  what tell you whether the last phase worked.
- Any `lab_orders` from the predecessor: which came back, which never did. An order
  that was never filled is not a finding, it is an outstanding action, and it belongs
  in the new plan.

Never author from the CLAUDE.md summary of a client. It is a snapshot of what was
true when someone last wrote it.

### 2. Decide what CHANGES, and justify each change against data

A continuation is not a re-issue and not a restart. For every item, one of:

- **carry** — unchanged, still indicated. Say nothing new about it.
- **step down / step up** — the marker moved, or twelve weeks of a repair dose is done.
- **drop** — a course completed (a 2-week antimicrobial), or it ran a whole phase
  without moving its target marker. Say which marker and by how much.
- **add** — grounded in a lab that did NOT move, a symptom that persisted, or a
  medication depletion never replaced.

Prefer a smaller, sharper change. A returning client has already absorbed one
protocol's worth of load; stacking another on top is how a plan becomes unfollowable.

### 3. Build the successor — never hand-write the YAML

The successor must be a **clone of the predecessor plus a patch**, so nothing is
silently lost. Use the same shape `generateFollowUpPlan` produces
(`src/lib/server-actions/plan-lifecycle.ts`) — read that function before authoring,
it is the reference implementation:

```
slug                 <first>-plan-<N>-<YYYY-MM-DD>-<client-id>
supersedes           <predecessor-slug>          ← REQUIRED, or supersede refuses
status               draft
version              0
status_history       []
catalogue_snapshot   {git_sha: <short sha>, snapshot_date: <today>}   ← REQUIRED field
plan_period_start    day after the predecessor's EFFECTIVE recheck
meal_plan_started_on / supplements_started_on
                     = plan_period_start for a continuing client (no shopping lag —
                       she already has everything)
amendments           []
app_menu             CARRY IT. Blanking it leaves her app with no menu at all.
letter_token         DROP IT (and letter_token_created_at). Per-plan; carrying it
                     makes two plans claim the same /letter/<token> URL.
```

Effective dates come from `plan-timing.ts` / `Plan.effective_*` — the STORED
`plan_period_recheck_date` ignores travel pauses and a corrected start date. Get the
predecessor's effective recheck before choosing the start date.

### 4. Submit through the gate

```bash
cd fm-database && .venv/bin/python -m fmdb.cli plan-check <new-slug>
```

**0 CRITICAL or it does not ship** — `submit_plan` enforces this anyway, so fix
findings here rather than discovering them at activation. WARNINGs are advisory but
each one deserves a sentence in `notes_for_coach` saying why it stands, or the next
reviewer will undo your reasoning.

The gate catches, among others: unknown catalogue slugs (alias-aware); a supplement
contraindicated against an active condition or current medication; combo-product
nutrient overlap (a standalone alongside a blend that already contains it); a
supplement with **no order link** in `supplement_links.yaml` and no pinned `buy_link`,
which is exactly when the client's Reorder button silently fails to render.

### 4-pre. Every supplement and practice gets a `client_note` — TWO LINES, about THEM

"What is this one for?" is the question clients ask most. Without a `client_note` the app falls
back to mining `coach_rationale`, which returns whichever sentence survives scrubbing — often a
lab readout or a safety caveat. Write the answer instead.

**The shape, every time:**

```
Line 1 — what it does, in plain words.
Line 2 — why YOU / how to take it.
```

Two lines. Not a paragraph: it is read on a phone, between a checklist and a menu.

**Line 2 is the one that matters, and it must be about this client.** Compare:

- Generic floor (acceptable): *"Magnesium — for muscles, nerves and steadier sleep."*
- Actually theirs: *"Magnesium — yours sits low, and your acidity medicine makes it harder to
  hold on to."*

Take the reason from their own results and their own medicines, in words they would recognise.
The catalogue's `notes_for_client` is the FLOOR, not the goal — it is there so nobody ever
gets nothing.

**Responsible wording — non-negotiable:**
- no marker values, no drug names, no diagnoses, no promises
- never imply it replaces a prescribed medicine
- second person throughout — "yours", not "his"

Same rule for `PracticeItem.client_note`, and there it also does safety work: practice
`details` render behind only a LIGHT scrub, so anything clinical in `details` needs a client
version written explicitly or it reaches the phone.

**The check that can fail:** `client-facing-leak.test.ts`. Run it before handing over. It
scans every field that prints verbatim and fails on anything NEW.

### 4a. If the plan prescribes EXERCISE, prescribe the PROGRESSION with it

A level with no next rung is a plateau with extra steps. Every prescribed exercise gets three
things in its `note`, in the client's own words:

1. **Where they are now** — the rung's own prescription, not the letter ("5 stands, both hands
   on the chair arms", not "level A").
2. **What READY looks like** — the observable thing that means the next rung is earned.
3. **What comes next** — so the client can see the path, not just today's step.

And the session's `details` carries the coach-facing rules:

- **Earned, not timed.** Rungs advance at a CHECK-IN, when the client is genuinely doing the
  movement at its cadence — never because a fortnight elapsed. A calendar progression on a
  client who has not started is how someone gets hurt.
- **One at a time.** Advance a single exercise per review. If something aggravates, you need to
  know which one did it.
- **State the gate on anything held back.** A fourth movement waiting on a cardiac clearance or
  an unassessed joint belongs in the note WITH its condition, so it is not quietly forgotten.

The ladders live in the catalogue (`data/exercises/<slug>.yaml` → `levels[]`, each with its own
`prescription`, `reps`, `support`). Read them and quote the rung's prescription — do not invent
a progression the entry does not have, and do not skip rungs to look ambitious.

### 4b. If the plan carries a MENU, build the shopping list too

A menu without a shopping list is half a prescription — the client has to reverse-engineer
the groceries themselves. The dashboard path calls `generate-grocery-list.py` (Haiku), which
is unavailable here: this flow is $0 and `FM_API_OK` is not set. Use the deterministic
builder instead — it reads the menu already on the plan and aggregates the ingredient lines
of each dish's catalogue recipe, no model call:

```bash
echo '{"client_id":"<id>","plan_slug":"<slug>"}' \
  | fm-database/.venv/bin/python fm-database-web/scripts/build-grocery-from-menu.py
```

Check the `unresolved` list it returns: those are menu cells that matched no catalogue
recipe (usually freeform items like "Guava (1)"). A handful is normal. A long list means the
menu is naming dishes the library does not have, which is worth fixing in the MENU rather
than the list.

Then hand it over — activation is the coach's, not yours:

```
Client → Plan tab → the draft → 🚀 Activate plan
```

### 5. Adversarial self-review before you call it ready ($0)

`plan-check` is mechanical: it catches unsafe and broken, never *unsound*. Run the
same lens `fmdb/plan/ai_check.py` applies, yourself, for free. Per item, state a
verdict rather than an impression:

1. **Coherence** — does the protocol address the drivers named, or were drivers listed
   and then prescribed around?
2. **Client fit** — re-read `active_conditions`, `current_medications`,
   `known_allergies`, `dietary_preference`, `non_negotiables`. Name what you checked.
3. **Translation fidelity** — does each `coach_rationale` match what the CATALOGUE says
   that supplement does? Inventing a plausible mechanism is the easiest error to make
   and the hardest for the coach to catch.
4. **Load** — count what needs its own moment in the day, not the number of rows
   (`practice-load.ts`; coach guidance is ≤7 practices, ≤2–3 dedicated). A 15-item
   supplement list on a client whose goal is coming OFF medicines deserves a sentence
   of justification or a cut.
5. **What is still outstanding** — labs ordered a phase ago and never done are the
   single most common thing a continuation quietly drops.

## What this flow does NOT do, deliberately

- **It does not activate.** Publishing supersedes the live plan and changes what the
  client sees the next morning. That is the coach's call, always.
- **It does not generate letters or menus.** Those spend credits and have their own
  gates.
- **It does not touch a published plan.** Mid-phase edits go through Quick edit
  practices / `removeSupplementFromActivePlan`, which append to `status_history`.

## Traps that have actually bitten, in this order of likelihood

1. **A new `client.yaml` field is invisible on Fly** until it is added to
   `_APP_CLIENT_KEYS` in `scripts/app-staging-action.py` and a refresh is run.
   `mind_body_depth` shipped and did nothing for days because of this.
2. **The client's first plan may not be `-plan-1-`.** Nidhi's is `nidhi-plan-2-`.
   Continuation is evidenced by `supersedes`, never by the number in the slug.
3. **`plan_period_recheck_date` is legacy.** Anything comparing against today must use
   the effective recheck, or you will start a phase before the last one ends.
4. **Publishing a successor used to fire the onboarding welcome email** (guarded since
   2026-08-02: `supersedes` set → skipped). If you add another publish-time side
   effect, ask whether it should fire for a returning client.

## Notes

- Coach-side only. No Fly deploy. **$0** — no Anthropic call anywhere in this flow.
- Extra context you have gathered — WhatsApp messages, the coach's remarks, a photo of
  a lab report — is a legitimate *addition* to the briefing. The guardrails constrain
  the output, not the inputs.
- If the coach would rather spend the credits, the paid equivalent is
  **Plan tab → Follow-up → 🔁 Next phase**, which runs `generate-follow-up.py`. Same
  destination; this flow just does the thinking without the bill.
