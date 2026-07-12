# Intake reconcile / draft-mirror fix — scope

**Status:** Phase 1 implemented (coach-edit guard). Phases 2–3 pending.
**Owner surface:** `fm-database-web/scripts/intake-token-action.py` (Mac cron `fm-coach-cron`, `_reconcile_one`).

## Problem

Coach edits to certain `client.yaml` fields silently revert ~every minute. Discovered on Kamla (cl-021, 2026-07-12): clearing `non_negotiables` / `foods_to_avoid` kept coming back with coach-authored text ("NO WEIGHT LOSS — she explicitly…"). Symptoms:
1. Coach-authored content leaked onto the **client app** (mitigated separately by the render gate in `client-app.ts`).
2. The **menu generator** reads `non_negotiables` as "foods to keep" and got fed a coach sentence as garbage input.
3. Any coach edit to an allowlisted field can be undone within one cron cycle.

## Root cause

1. `action_lookup` builds a **prefill** from the existing (coach-entered) `client.yaml` via `_prefill_from_client` — including coach-managed fields like `non_negotiables`, `foods_to_avoid`.
2. When the intake form is opened, it autosaves that prefill back via `action_save_draft` (line ~707), so **`intake_form_draft` now contains coach content** even though the client never typed it. (For a client the coach onboarded manually, the "draft" is a pure echo of coach data.)
3. `_reconcile_one` (Mac cron) mirrors `intake_form_draft` staging→authoritative and re-applies the submission/draft payload, **clobbering later coach edits** with the stale echo. It's meant to be idempotent (`intake_staging_reconciled_at`) but the draft-mirror + re-apply path re-runs against coach edits.

## Fix (phased)

### Phase 1 — Coach-edit guard (IMPLEMENTED)
In `_reconcile_one`, skip the mirror/merge when the coach's authoritative record was updated **more recently** than the client last touched the intake form. Genuine client submissions (newer than the coach's last edit) still reconcile; coach edits made after the form are never clobbered. Naturally reinforces idempotency: once `_apply_submit` bumps `updated_at`, later cron runs skip.

### Phase 2 — Don't persist prefills as drafts (root fix, pending)
`action_save_draft` / the form should distinguish client-typed input from a prefill echo — e.g. only persist fields the client actually changed, or tag the draft `source: prefill|client` and have the reconcile ignore `prefill`. Prevents the coach echo ever entering the draft.

### Phase 3 — Cleanup + field ownership (pending)
- One-off: strip prefill-echo values from existing `intake_form_draft`s for clients who never genuinely submitted.
- Decide which fields are **coach-owned** (`non_negotiables`, `foods_to_avoid`, `active_conditions`, medications…) and have the reconcile treat those as coach-authoritative unless the client explicitly changed them in a real submission.

## Testing checklist
- [ ] Coach edits to `non_negotiables`/`foods_to_avoid` stick across ≥2 cron cycles (coach-onboarded client).
- [ ] A genuine client form submission still reconciles into `client.yaml` (regression).
- [ ] A re-submission after a coach edit still applies (client re-submit wins).
- [ ] No cron errors across all clients (`pm2 logs fm-coach-cron`).

## Risk
`_reconcile_one` runs for every client each minute. The Phase-1 guard changes gating for all of them — validate the genuine-submission path before/after. It's a Mac-cron Python change (no build/Fly deploy; effective next cron run).
