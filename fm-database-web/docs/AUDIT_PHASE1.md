# Phase-1 Audit — Findings Register

**Date:** 2026-06-05 · **Scope:** the 3 critical workstreams — client-output
correctness, data/PHI integrity, silent-failure sweep. **Method:** focused,
verified read-only pass (each finding confirmed against the actual code).

> **Coverage note:** this is a *focused first cut* — the highest-value, verified
> defects, not an exhaustive line-by-line sweep of the 7,000-line letter script
> and every write path. A deeper exhaustive pass is recommended as Phase-1b
> (see "Next" below). Nothing here is a hunch; every item cites code.

## Executive summary

No actively-broken client letters were found beyond what's already fixed this
week. The real risks are **structural**: the same logic implemented in multiple
places drifts (the cause of the date + sent-badge bugs), external API calls
beyond the one just fixed can still hang opaquely, and data writes aren't
crash-safe. None are five-alarm, but the top two are quick wins that prevent the
exact bug classes you've been hitting.

## Themes
1. **Duplicated logic drifts.** The same rule lives in TS *and* Python (or in
   several TS files) with subtly different fallbacks — this is the root cause of
   the recurring "dates look wrong" bugs.
2. **Opaque external-call hangs.** The no-timeout Anthropic pattern fixed in the
   letter generator still exists in several other shims.
3. **Writes aren't crash-safe.** PHI YAML is written in place, not atomically.

---

## Findings

### HIGH

**H1 · Day-1 anchor fallback chains diverge across 3 files**
- `src/lib/fmdb/plan-timing.ts` → `meal_plan_started_on` → `plan_period_start + 3d`
- `src/lib/fmdb/client-journey.ts` → `meal_plan_started_on` → **`supplements_started_on`** → `plan_period_start` (no +3d)
- `src/lib/server-actions/meal-plan-drip.ts` → `meal_plan_started_on` → `plan_period_start + 3d`
- **Why it matters:** for a client with no `meal_plan_started_on` but a
  `supplements_started_on` (or neither), the journey strip computes a different
  week number / recheck date than the dashboard, calendar, and drip panel. Same
  bug class as the just-fixed timezone issue — silent, client-visible.
- **Fix:** make `plan-timing.ts` the single source of truth and have
  `client-journey.ts` call it; delete the divergent local chain.

**H2 · Multiple Anthropic shims have no request timeout (opaque hangs)**
- `scripts/parse-functional-test.py`, `parse-genetic-report.py`,
  `draft-followup-message.py`, `generate-intake-insights.py` construct
  `Anthropic(...)` with no `timeout`/`max_retries` (verified: 0 `timeout`
  occurrences). `chat.py` / `coach-knowledge.py` route through the engine —
  confirm the suggester client too.
- **Why it matters:** exactly the failure you hit on letters — a stalled
  connection hangs to the caller's SIGKILL and surfaces as an opaque "exited
  null with no stdout." Affects DUTCH/GI-MAP parsing, genetic reports, follow-up
  drafts, intake insights.
- **Fix:** the same `httpx.Timeout(read=180) + max_retries=3` applied to
  `render-client-letter.py` — ideally via a single shared `_anthropic_client()`
  helper so it can't drift again.

### MEDIUM

**M1 · Plan/client/session YAML writes are not atomic**
- `src/lib/fmdb/writer.ts:152` `await fs.writeFile(target, dump)`;
  `fmdb/plan/storage.py` `write_plan`/client/session use `p.write_text(...)` —
  all direct overwrites, no temp-file-then-rename.
- **Why it matters:** a crash or concurrent write mid-write leaves a truncated /
  unparseable YAML — a corrupted PHI plan or client file. Low frequency, high
  blast radius.
- **Fix:** write to `target.tmp` then atomic `rename`/`os.replace`.

**M2 · `FLY_INTAKE_ONLY` is fail-open**
- `src/middleware.ts:134` gates the coach-UI 404 on
  `process.env.FLY_INTAKE_ONLY === "1"`. If the env is ever unset on Fly, the
  coach UI (PHI) becomes publicly reachable.
- **Why it matters:** documented invariant, but no code-level fail-safe — one
  bad deploy = data exposure.
- **Fix:** fail-closed (assert the env at boot on Fly, or derive intake-only
  from a baked build flag rather than a runtime env that can vanish).

**M3 · Prompt-side meat examples rely on the AI to substitute for veg clients**
- `render-client-letter.py:846` (MCAS block "fresh fish, chicken/eggs") and
  `:4030` (breakfast-swap example "1 boiled egg") are in the prompt; veg-safety
  depends on the AI's substitution rule firing.
- **Why it matters:** the deterministic plate leak is fixed, but these prose
  examples could still seed meat into a vegetarian/Jain letter if the model
  doesn't substitute. Lower likelihood (AI-guarded) but same harm class.
- **Fix:** make the examples diet-aware, or add a post-gen veg-safety regex gate
  on the final letter for veg/Jain/vegan clients.

### LOW

**L1 · Send-log read-modify-write is non-atomic, no lock**
- `src/app/api/email/actions.ts` — documented in-code; concurrent sends can
  clobber. Dedup + human pace mitigate. Fix later if automation drives sends.

**L2 · Ghost-inbox class (recurring pattern, needs a sweep)**
- ~70 client-component `await …Action()` call sites; the documented pattern is
  that some lack `.catch()` + visible error UI, so a failed server action shows
  an empty state instead of an error. Needs a per-call-site sweep (Phase-1b) —
  flagged as a class, not yet enumerated.

---

## Next
1. **Fix H1 + H2 now** — both are quick, both prevent bug classes you've already
   been bitten by. (M1 next — small, protects PHI.)
2. **Phase-1b (exhaustive):** enumerate L2 (catch coverage), deep-read the letter
   injection/marker edge cases and all write paths. Either a longer manual pass
   or a retried multi-agent run with a simpler output contract.
3. Then **Phase 2** (duplication/dead-code/debt) and **Phase 3** (tests + CI +
   standing drift-guard) per the roadmap already agreed.
