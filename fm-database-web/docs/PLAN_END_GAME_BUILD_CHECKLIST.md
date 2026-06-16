# Plan end-game — build scope & phase checklist

Companion to `PLAN_END_GAME_SPEC.md` (the what/why). This is the how — the
ordered, file-level checklist we tick through so we don't blunder a feature that
touches the **live client app**.

**Status:** not started. Grounded against the codebase 2026-06-15.

---

## How to use this doc

- Phases are **independently shippable**. Don't open phase N+1 until phase N's
  exit criteria are all checked.
- Each phase states its **client-surface impact** and **deploy target** up front.
  If it says "Fly", clients are affected and it needs `flyctl deploy` + a smoke
  test on a real token.
- The checkboxes are the contract. If a task turns out wrong mid-build, fix the
  checklist first, then the code.

---

## Two-runtime reality (the thing that makes this safe)

| Surface | Runtime | Changes when | Clients see it? |
|---|---|---|---|
| Ochre Tree app `/app/[token]`, `/recipes`, `/supplements`, intake, WhatsApp | Fly `theochretree-coach` | `flyctl deploy -a theochretree-coach` | **yes** |
| Coach UI `/clients-v2`, `/plans`, `/dashboard-v2`, `/assess` | localhost PM2 `fm-coach` | `npm run build && pm2 restart fm-coach --update-env` | no |

Code on your Mac does **not** reach clients until a Fly deploy. Phase 0 is built
and verified entirely on localhost with **no Fly deploy** → zero client impact.

---

## Global guardrails — re-read before every phase

- [ ] **`Plan` is `extra="forbid"`** (`fmdb/plan/models.py:1132`). New plan fields
      must be declared in the model or every write throws. **Cross-version rule:**
      never write a plan YAML carrying a new field to disk until that field's model
      change is deployed to Fly too — the older Fly build would reject the plan on
      load. (Mutagen syncs `~/fm-plans` both ways, so a locally-written plan reaches
      Fly within seconds.)
- [ ] **`Client` is `extra="ignore"`** (`models.py:283`). Reading new maintenance
      fields raw is safe even before the model declares them; declaring them keeps
      the writer round-trip clean.
- [ ] **Resolver is the single source of truth.** Never branch app modes ad hoc in
      a component. Every gate reads `app_mode` from `resolveAppMode`.
- [ ] **Client-text scrubbers are mandatory** on anything client-facing
      (back-on-track, monthly card): no drug brands, no lab values, no "titrate".
      Reuse `clientifyWhy` (`client-app.ts:1402`), `clientifyDose`
      (`supplements/[planSlug]/page.tsx:74`), `stripBrand` (`supplement-display.ts`).
- [ ] **No-hallucination rule** on generated cards: state only on-file facts, never
      invent quantities/prices.
- [ ] **WhatsApp templates** are registered via `whatsapp-server/scripts/submit-templates.js`
      in the canonical clone `~/whatsapp-server` — **never** the Meta dashboard,
      never the fm-coach repo's retired copy.
- [ ] **Deploy after code changes.** Coach-only → PM2 rebuild. Client-app → Fly
      deploy + smoke. "Works on localhost" ≠ done for client surfaces.

---

## Already built — do NOT rebuild

| Capability | Where | Implication |
|---|---|---|
| `graduated` plan status + `graduate_plan()` + `graduated/` bucket | `enums.py:111`, `transitions.py:334` | REVIEW→graduate path exists |
| Publish auto-supersedes siblings (1 active plan/client) | `transitions.py:254` | PHASE2 = supersede, already works |
| Maintenance plan generator (Haiku, 26wk, `intent="maintenance"`) | `generate-follow-up.py:63,289`; action `generateFollowUpPlan` `plan-lifecycle.ts:774` | don't write a new generator |
| Effective-date timing helpers | `plan-timing.ts`; Python `Plan.effective_recheck_date()` `models.py:1320` | resolver reuses these |
| Baseline snapshot at publish + outcome deltas | `transitions.py` baseline; `ProgressScreen` | graduation report has its data |
| Recipes HTML sidecar `<slug>-recipes.html` at `/recipes/<token>` | `recipes/[planSlug]/page.tsx` | keepsake = reuse this, **no PDF lib** |
| Delayed WhatsApp nudge queue + minute cron drain | `_pending_sends.yaml`; `tickPendingSends` `plan-publish-followups.ts:254`; `cron-runner.js:71` | reuse for maintenance nudges |
| App token resolver (client `app_token` → fallback `letter_token`) | `loadClientAppData` `client-app.ts:1592`; `resolveAppToken` `letter-token.ts` | resolver plugs in here |
| PWA service worker + push | `public/ochre-app/sw.js` | reuse for nudges if wanted |

---

## Phase 0 — Data model + resolver (foundation)

**Goal:** lay every non-visible primitive so later phases are pure UI/generator work.
**Client-surface impact:** NONE. **Deploy target:** localhost PM2 only — **do not `flyctl deploy`.**
**Status: ✅ done — 2026-06-15. Not committed (other WIP in tree); PM2 not restarted (new code is inert).**

### Pre-flight (verify before writing code)
- [x] Client write path confirmed: `updateClientProfile` (`clients.ts:806`) reads + writes
      **raw YAML** (`yaml.dump`, no Pydantic round-trip). Additive fields are safe.
- [x] `Client` is `extra="ignore"` → new fields surface raw on read before TS types know them.

### Tasks
- [x] `Client` model: added `maintenance_status`, `maintenance_started_on`,
      `maintenance_paid_through`, `maintenance_term_months=6` (`models.py`, after `family_history`).
- [x] `Plan` model: added `back_on_track_plan: Optional[dict]` + `monthly_cards: Optional[dict]`
      (`models.py`, after `app_menu_pending`).
- [x] TS types mirrored in `src/lib/fmdb/types.ts` (Client block + `PlanFields` block).
- [x] New `src/lib/fmdb/app-mode.ts` → `resolveAppMode(input, todayYmd)`. Reuses
      `effectiveRecheckDate`. NOTE: PHASE2 collapses into ACTIVE (renders identically);
      surfaced via `result.continued` instead of a separate gating branch.
- [x] Resolver is standalone — only `app-mode.test.ts` imports it (confirmed by grep).
- [x] Unit tests: `src/lib/fmdb/app-mode.test.ts`, 15 cases incl. boundaries (recheck −14d,
      paid_through +0 / +15 / +16d). `npm test` (vitest, newly added dev dep) → 15/15.
- [x] `setMaintenanceStatus` server action in `clients.ts` (raw-YAML bypass, 4 fields only,
      coach-route revalidation). Called nowhere yet.

### Verification
- [x] `fmdb.cli validate` → **0 errors** (existing plans/clients load with new fields).
- [x] `npm run build` + `npm run type-check` → both clean.
- [x] Resolver unit tests → 15/15 pass.
- [x] No render path imports the resolver and nothing calls the action → client app byte-identical.

### Rollback
- [ ] Pure additions; revert is `git checkout` of the 5 touched files + remove the 2 new
      files. No data written, nothing on Fly. (`npm uninstall -D vitest` to undo the dev dep.)

### Exit criteria
- [x] Model + resolver + action in place, tests + build green, **not deployed to Fly**,
      client app byte-identical to today. (Working tree only — not committed.)

---

## Phase 1 — REVIEW mode + graduation report

**Goal:** at the 12-week mark the app shows a "Your 12 weeks" report + a coach-mediated
"Continue or Maintain?" choice.
**Client-surface impact:** YES. **Deploy target:** Fly + smoke.

### Pre-flight
- [ ] Confirm `baseline_snapshot` shape and where `ProgressScreen` computes symptom-burden
      + Five Pillars deltas, so the report reuses that math (no recompute).
- [x] Decision #1 settled — native Razorpay checkout (Phase 1b). P1 ships the choice UI +
      coach-notify + 5-day nudge; the actual payment lands in Phase 1b.

### Tasks
- [ ] Wire `resolveAppMode` into `loadClientAppData` (`client-app.ts:1592`); expose
      `app_mode` + `reason` on `ClientAppData`.
- [ ] REVIEW screen component under `src/app/app/[token]/`: before/after card + Continue/Maintain
      choice buttons (checkout itself is wired in Phase 1b).
- [ ] Render REVIEW when `app_mode === 'REVIEW'`; keep ACTIVE rendering untouched otherwise.
- [ ] On tap: record the choice + notify coach ("client X chose Y" — WhatsApp + dashboard chip).
- [ ] 5-day non-responder nudge: coach message when a client makes no selection 5 days into the
      review window (cron, gated). Does NOT change the recheck+15d → LIBRARY fall.
- [ ] Coach dashboard: "graduation due" triage chip (reuse `effectiveRecheckDate` overdue signal).

### Verification
- [ ] Local: temporarily point a test token's plan to a past recheck date → REVIEW renders;
      revert.
- [ ] `npm run build && type-check` clean.
- [ ] Deploy to Fly; smoke a **test** token (not a live client) → REVIEW renders, choice CTA works.
- [ ] Confirm a live ACTIVE client's token still renders ACTIVE unchanged.

### Rollback
- [ ] Resolver returns ACTIVE for everyone not at recheck — feature flag the REVIEW branch
      so it can be disabled without redeploy if needed.

### Exit criteria
- [ ] No live client is in REVIEW unexpectedly; ACTIVE clients unaffected; report numbers
      match `ProgressScreen`.

---

## Phase 1b — Native Razorpay payment (the money phase) ⚠ real money on a public app

**Goal:** Continue/Maintain tap → inline Razorpay checkout (UPI + card) → automated flip.
**Client-surface impact:** YES (payment surface). **Deploy target:** Fly + secrets.
**Prereq (coach):** a Razorpay account with TEST + LIVE keys + a webhook secret.
**Note:** fm-coach holds no Razorpay keys today — the existing integration is only the
ochre-followup *handover receiver* (`/api/handover/programme-signup`). This is net-new.

### Pre-flight
- [ ] Coach supplies `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` (test first).
- [x] GST: DEFERRED 2026-06-15 — not GST-registered yet; revisit at volume. **No invoicing in v1.**
- [ ] Confirm SKUs + amounts: Maintain = ₹12,000 / 6-mo block; Continue = Phase-2 fee.
- [ ] Check the companion app's CSP — must allow `checkout.razorpay.com` (next.config headers).

### Tasks
- [x] **Payment UI built (2026-06-15):** `ochre-checkout.tsx` — UPI/Card toggle + Pay button,
      app-styled, Razorpay seam = `onPay` prop with an honest holding state. type-check + build
      green. NOT mounted into the REVIEW screen, NOT deployed.
- [ ] Add `razorpay` SDK dep; env vars local + Fly secrets.
- [ ] Order-create route/action (token-gated to the client + chosen SKU) → Razorpay order.
- [ ] Wire Razorpay Checkout.js behind the `onPay` seam (the real gateway call) + mount the
      component in the REVIEW screen.
- [ ] `/api/razorpay-webhook`: raw-body HMAC verify (webhook secret), persist-before-process,
      always return 200, idempotent on `razorpay_payment_id`.
- [ ] On `payment.captured` / `order.paid`: `setMaintenanceStatus(active, paid_through=+6mo)` for
      Maintain, or kick Phase-2 plan generation for Continue; then notify coach.
- [ ] Coach notification on successful payment (WhatsApp + dashboard).
- [ ] Built so the same checkout is reused for the 6-month renewal (Phase 5).

### Verification
- [ ] TEST-mode end-to-end on a test token: pay → webhook → status flips → coach notified.
- [ ] Forged/bad webhook signature is rejected — verify.
- [ ] CSP allows the checkout; no console CSP errors.
- [ ] Idempotency: same `payment_id` twice → single flip, no double-charge handling needed.
- [ ] Switch to LIVE keys only after a clean test pass; first live payment is the real smoke.

### Exit criteria
- [ ] A client pays in-app and is auto-flipped to MAINTENANCE (or a Phase-2 plan kicks off);
      coach notified; signature verification + idempotency proven.

---

## Phase 2 — LIBRARY + GRACE floor (the safety net)

**Goal:** lapses/declines degrade gracefully — never a lock-out. Build BEFORE the paid tier.
**Client-surface impact:** YES. **Deploy target:** Fly + smoke.

### Tasks
- [ ] GRACE mode: full access + renewal banner; 15-day window from `maintenance_paid_through`.
- [ ] LIBRARY mode (frozen floor):
  - [ ] 4 auto-derived sample recipes (1 each breakfast/lunch/dinner/snack), computed in
        `client-app.ts`, **not stored**.
  - [ ] frozen guidance teasers; supplement **names + live buy links** kept visible.
  - [ ] recipes-keepsake link (reuse `/recipes/<token>` sidecar).
  - [ ] "resume" CTA.
- [ ] Per-surface gating by `app_mode` exactly per the spec tier matrix (menus/recipes/
      do's&don'ts/supplements/labs/back-on-track/check-ins/keepsake).

### Verification
- [ ] Local: set a test client `maintenance_paid_through` to today−1 → GRACE; today−20 → LIBRARY.
- [ ] LIBRARY shows exactly 4 recipes, buy links live, no fresh menu.
- [ ] Deploy to Fly; smoke a test token through GRACE and LIBRARY.

### Exit criteria
- [ ] A declined/lapsed client retains a usable, non-expiring floor; no PHI or paid surface leaks.

---

## Phase 3 — MAINTENANCE app mode + back-on-track

**Goal:** the paid hands-free tier renders; flare card generated once at graduation.
**Client-surface impact:** YES. **Deploy target:** Fly + Python + smoke.
**Gotcha:** first phase that writes `back_on_track_plan` to a plan — obey the cross-version rule
(deploy the Plan model field to Fly **before** writing any plan that carries it).

### Tasks
- [ ] Coach action "graduate → maintenance": calls existing `generateFollowUpPlan(...,"maintenance")`,
      publishes the lighter plan (auto-supersedes), sets `maintenance_status=active` +
      `maintenance_started_on`/`maintenance_paid_through` via `setMaintenanceStatus`.
- [ ] MAINTENANCE app mode: menus + simplified supplements + monthly card slot +
      back-on-track card + lab cadence; hide active-only surfaces.
- [ ] New `scripts/generate-back-on-track.py` (Haiku): input = client's own plan; output =
      reset card (3–7d gentle foods, 1–2 already-tolerated remedies at established doses,
      do's/don'ts, off-ramp, **mandatory red-flag triggers**). Log via `usage.py:log_usage`.
- [ ] Run scrubbers on every back-on-track string; drop anything that still smells clinical.
- [ ] Persist `back_on_track_plan` on the plan (only after model field is on Fly).

### Verification
- [ ] Generate back-on-track for a test client; manually audit: no drug brands/labs/"titrate",
      red-flags present.
- [ ] Smoke a test token in MAINTENANCE: correct surfaces shown/hidden per matrix.

### Exit criteria
- [ ] A graduated client can run a self-serve reset; nothing prescriptive/new; scrubbers clean.

---

## Phase 4 — Monthly do's & don'ts generator

**Goal:** the one living thing in maintenance, with zero coach effort.
**Client-surface impact:** YES (content only). **Deploy target:** Python + cron + Fly read.

### Tasks
- [ ] New `scripts/generate-monthly-card.py` (Haiku): keyed to client conditions + season;
      no-hallucination; cached per `YYYY-MM` on `plan.monthly_cards`; `log_usage`.
- [ ] Option-B fallback: pre-authored rotating seasonal/condition cards, selected by month +
      conditions, zero API — used when the API cap is hit.
- [ ] Monthly cron job in `cron-runner.js` (IST), only for `maintenance_status=active`.
- [ ] App renders current month's card in MAINTENANCE; teaser in LIBRARY.

### Verification
- [ ] Dry-run the generator for a test client; audit no-hallucination compliance.
- [ ] Fallback path produces a valid card with the API disabled.

### Exit criteria
- [ ] Card refreshes monthly without coach involvement; fallback works under API cap.

---

## Phase 5 — 6-month renewal gate + WhatsApp nudges

**Goal:** the renewal economics + the clinical safety valve (re-check).
**Client-surface impact:** YES (UI + outbound WhatsApp). **Deploy target:** Fly + WhatsApp + cron.

### Tasks
- [ ] Renewal gate UI: renew / re-check / lapse. Renewal reuses the **Phase 1b Razorpay
      checkout** for the next ₹12,000 block (no auto-debit — one-time payment per block).
- [ ] `maintenance_paid_through` transitions MAINTENANCE→GRACE→LIBRARY (resolver already
      handles once fields are set).
- [ ] 3 new templates via `~/whatsapp-server/scripts/submit-templates.js`: review-due,
      renewal-due, lapse→grace. Submit; confirm Meta approval.
- [ ] Queue nudges via `_pending_sends.yaml`; gate behind new `FM_AUTO_MAINTENANCE_NUDGES=1`
      env (same pattern as `FM_AUTO_PUBLISH_FOLLOWUPS`).
- [ ] Every send routes through `sendWhatsAppAction` and records outbound (so it shows in
      the coach chat thread).

### Verification
- [ ] Templates APPROVED on Meta before any send.
- [ ] Test send each template to the coach's own number.
- [ ] Confirm GRACE→LIBRARY transition at `paid_through + 15d` on a test client.

### Exit criteria
- [ ] Renewal flow end-to-end on a test client; nudges fire only under the env gate;
      no live client nudged during testing.

---

## Open decisions (resolve before the named phase)

- **RESOLVED 2026-06-15 — decline → LIBRARY:** a client who reaches REVIEW and
  neither continues nor maintains falls to LIBRARY on the same 15-day grace the
  maintenance-lapse path uses. REVIEW window = recheck −14d through +15d; past
  that → LIBRARY. Time-based, no explicit decline signal, fully recoverable.
  Already encoded in `resolveAppMode` (`app-mode.ts`) + tested.
- **SETTLED — maintenance fields live on `Client`** (built in P0).

- **RESOLVED 2026-06-15 — decision #1 = NATIVE Razorpay checkout (see Phase 1b).** On
  Continue/Maintain tap: inline Razorpay checkout (UPI + card), automated via a signed payment
  webhook that flips maintenance + notifies the coach; plus a coach nudge at 5 days of no
  selection in the review window. fm-coach holds no Razorpay keys today (existing integration
  is only the ochre-followup handover receiver) → net-new payment phase.

Still open:
1. **(before P5)** Default annual review expectation baked in (spec recommends), so labs get
   interpreted at least yearly even if the client keeps renewing without a re-check.

---

## Build order

```
P0 (model + resolver, localhost only) ✅
   ├─ P1  (review + graduation + choice UI + coach-notify + 5-day nudge)
   ├─ P1b (NATIVE Razorpay payment — needs coach's keys) ⚠ real money
   └─ P2  (library / grace floor)            ← before paid tier
P3 (maintenance + back-on-track)
   ├─ P4 (monthly card)
   └─ P5 (renewal gate — reuses P1b checkout + nudges)
```

Ship one phase per session. Each client-facing phase = its own Fly deploy + smoke on a
**test** token, never a live client.
