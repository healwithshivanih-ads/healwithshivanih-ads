# Phase-1b Audit — Findings Register (exhaustive, verified)

**Date:** 2026-06-05 · **Method:** 7 scoped read-only finder agents → adversarial
refute-pass (only confirmed findings kept) → synthesis. 34 agents, ~6M tokens.
**25 verified defects.** Each survived an independent attempt to refute it.

## Executive summary

Four recurring failure modes span the letter pipeline, the AI parsing shims, the
messaging/queue layer, and the public web routes:

1. **Silent LLM truncation** — 4 LLM call-sites accept `max_tokens`-truncated
   output as complete and **cache** it: truncated clinical letters, blank
   assessments, and partial lab/genetic records ship as `ok:true` with no error,
   and caching/SHA-dedup makes the loss **permanent**. *No `stop_reason` check
   anywhere.*
2. **Data-loss races** — 4+ unsynchronized, non-atomic writers contend over
   `_pending_sends.yaml` and `client.yaml`. **The M1 atomic-write fix never
   reached these shims.** Lost or duplicated client sends; truncated PHI on crash.
3. **Unauthenticated PHI on the public host** — `/supplements/<planSlug>` and
   `/recipes/<planSlug>` serve client medication + meal-plan data gated only by a
   **guessable** `firstname-plan-N-date-clNNN` slug (the "UUID-ish slug" comment
   is false). Three webhooks fail **open** when their HMAC secret is unset.
4. **Missing error handling + a wrong-drug match** — ghost-inbox class (stuck
   spinners / blank panels), plus a substring drug-match that injects **another
   medication's HARD-RULE protocol cautions** into a client's letter.

## Top priorities (in order)
1. **Stop caching truncated LLM output** — add `stop_reason=='max_tokens'` guards
   to render-client-letter, suggester.synthesize, parse-functional-test,
   parse-genetic-report → return `ok:false`, don't write the cache/SHA record.
2. **Lock + atomic-write the shared hot files** — `_pending_sends.yaml` and
   `client.yaml` through one advisory-locked temp+rename accessor.
3. **Token-gate `/supplements/<planSlug>` + `/recipes/<planSlug>`** like
   `/letter/<token>` (opaque 192-bit token, not the readable slug).
4. **Fail-close the WhatsApp/Zoom/Cal.com webhooks** when the secret is unset;
   remove the Cal.com no-secret bypass.
5. **Persist+audit every verified Cal.com event up front** so shape-mismatched
   bookings aren't silently lost.
6. **Fix the wrong-drug substring match** — reuse the module's word-boundary
   `_kw_matches` so 'arb'/'pan' stop matching carbamazepine/panadol.
7. **Wrap bare-awaited Server Actions** (session-edit, plan-outcomes,
   cycle-tracking, handout-drip) in try/catch + visible error UI.
8. **Fix the letter-render bugs together** — emoji week-heading regex (dead print
   buttons), recipe-split swallowing the sign-off, meal_plan_phase schedule
   desync, per-week print CSS beyond week 5, plate guardrail placement.

---

## Findings by severity

### HIGH
- **Letter shipped + cached truncated** when Sonnet hits `max_tokens` (no `stop_reason` check) — `scripts/render-client-letter.py`.
- **Blank assessment cached as ok:true** on truncated/absent tool_use — `fmdb/assess/suggester.py`.
- **Functional-test (DUTCH/GI-MAP) parser persists truncated lab record + SHA-dedups it** — `scripts/parse-functional-test.py`.
- **WhatsApp thread append: non-atomic + lost-append race** — `scripts/save-session.py`.
- **`_pending_sends.yaml` cron drain vs queue writes: lost-update** (lost WhatsApp nudge) — `src/lib/server-actions/plan-publish-followups.ts`.
- **handout-drip.py is a 3rd unsynchronized writer** to `_pending_sends.yaml` (dupe/lost client sends) — `scripts/handout-drip.py`.
- **Intake autosave overwrites whole `client.yaml` non-atomically every ~5s**, no validation/version guard (PHI loss + clobber) — `scripts/intake-token-action.py`.
- **session-edit-panel: measurement save discarded, no try/catch** → silent log divergence — `…/sessions/session-edit-panel.tsx`.
- **cal-com webhook silently drops verified-but-shape-mismatched bookings** (no audit, terminal 400) — `src/app/api/cal-com-webhook/route.ts`.
- **Drug-caution match uses naive substring** → injects the WRONG drug's HARD-RULE cautions ('arb'→carbamazepine, 'pan'→panadol) — `scripts/render-client-letter.py`.
- **Unauthenticated `/supplements/<planSlug>` serves PHI behind guessable slug** — `src/app/supplements/[planSlug]/page.tsx`.
- **Unauthenticated `/recipes/<planSlug>` serves meal-plan PHI behind guessable slug** — `src/app/recipes/[planSlug]/page.tsx`.

### MEDIUM
- **plan-outcomes-panel: auto-load no try/catch → permanent 'Loading…'** — `…/plan/plan-outcomes-panel.tsx`.
- **cycle-tracking-panel: WhatsApp send + save bare-awaited → stuck spinner, no error** — `…/cycle-tracking-panel.tsx`.
- **update-derived-pillar.py: non-atomic client.yaml write, no lock** — `scripts/update-derived-pillar.py`.
- **Genetic-report parser accepts truncated tool_use, no stop_reason** — `scripts/parse-genetic-report.py`.
- **Corrupt drug YAML silently drops a drug's cautions from every letter** (`except: continue`) — `scripts/render-client-letter.py`.
- **Per-week "Print Week N" buttons dead** (emoji-prefixed week headings never match the wrap regex) — `scripts/brand_html.py`.
- **Recipe split swallows the "With warmth, Shivani" sign-off** into the sidecar → letter ends abruptly — `scripts/render-client-letter.py`.
- **meal_plan_phase shows the FULL 12-week schedule** while narrative is weeks 3–4 (phase-bound default desync) — `scripts/render-client-letter.py`.
- **Queued reminders/no-join nudges silently lost forever if `_pending_sends.yaml` corrupts** (`catch → []`) — `src/lib/server-actions/plan-publish-followups.ts`.
- **WhatsApp/Zoom/Cal.com HMAC verification fail-open** when secret unset — `src/app/api/whatsapp-webhook/route.ts` (+ zoom, cal-com).

### LOW
- **Cal.com accepts a forged signature when both secrets unset** (unguarded "dev convenience" branch) — `src/app/api/cal-com-webhook/route.ts`.
- **handout-drip-panel: auto-load no try/catch → silent blank panel** — `…/handout-drip-panel.tsx`.
- **Per-week print isolation CSS only covers weeks 1–5** (week ≥6 prints other weeks) — `scripts/brand_html.py`.
- **Plate guardrail mis-places the portion plate** when the eat-heading regex fails — `scripts/render-client-letter.py`.

---

## Recommended remediation tiers
- **Tier 0 (urgent — do now):** PHI exposure (#3), truncation-caching guards (#1),
  wrong-drug match (#6), webhook fail-close (#4). These are
  safety/security/correctness with real client blast radius.
- **Tier 1 (soon):** shared-file locking/atomicity (#2, #5), the ghost-inbox
  panels (#7), the recipe-split sign-off + phase-schedule desync (#8 subset).
- **Tier 2:** the remaining letter-render polish (dead print buttons, print CSS,
  plate placement), corrupt-YAML surfacing, low-severity webhook hardening.

---

## Remediation status (2026-06-05)

**FIXED + deployed** (commits 16a1ce2, 1f76d16, 5531b4e, dfef9e5, 28fa254):
- Wrong-drug substring match → word-boundary.
- LLM truncation guards on all 4 call-sites (letter, assess, functional-test, genetic).
- Webhooks fail-closed (whatsapp/zoom/cal-com) + cal-com no-secret bypass removed.
- cal-com verified-but-unmatched events persisted + 200 (no silent drop).
- Recipe-split sign-off retained; meal_plan_phase schedule-window desync.
- Atomic writes for intake autosave, derived-pillar, save-session append,
  handout-drip + plan-publish-followups queue; corrupt-queue quarantine.
- Ghost-inbox try/catch on plan-outcomes, handout-drip, cycle-tracking,
  session-edit panels.

**OPEN (decided to defer):**
1. **Token-gate /supplements + /recipes** (PHI exposure) — HELD by coach
   (breaks already-sent recipe links). TOP open item.
2. **Cross-process LOCK** on _pending_sends.yaml + client.yaml — atomicity done,
   but the multi-process lost-update race needs a shared advisory lock
   (cron vs queue vs handout-drip; intake autosave vs inbound webhook).

**OPEN (Tier-2 polish, not yet scheduled):**
- Dead per-week "Print Week N" buttons (emoji week-heading regex in brand_html).
- Per-week print CSS only covers weeks 1–5.
- Plate guardrail placement when the eat-heading regex fails.
- Corrupt drug_depletion YAML silently dropping a drug's cautions (surface it).
- Low-severity webhook hardening already covered by the fail-close fix.
