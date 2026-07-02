# Revenue Export Contract — fm-coach → ochre-funnel (Loop 1)

**Written 2026-07-02 · Blueprint Phase 2** (`docs/GROWTH_SYSTEM_BLUEPRINT.md` §4 Loop 1 + Loop 4).
This is the single most valuable piece of plumbing in the growth system: it lets
ochre-funnel judge funnels on the ₹12k–₹60k lifetime value that IS the business,
not just webinar tickets — and it powers the capacity interlock (Loop 4).

Canonical copy lives here; a mirror sits at
`healwithshivanih-ads/fm-database-web/docs/REVENUE_EXPORT_CONTRACT.md`.
If they diverge, THIS file wins.

---

## 1. Shape — one webhook, three event types

```
POST {OCHRE_FUNNEL_URL}/api/webhooks/fm-coach-revenue
Content-Type: application/json
x-fm-coach-signature: <hex HMAC-SHA256(rawBody, shared secret)>
```

- Shared secret: `FM_REVENUE_EXPORT_SECRET` (fm-coach `.env.local`) =
  `FM_COACH_REVENUE_SECRET` (ochre-funnel Fly secret). Same value, two names —
  each app names secrets by counterpart convention.
- One event per POST. The sender is a drain loop, not a batcher.

### Envelope

```json
{
  "version": 1,
  "source": "fm-coach",
  "event_id": "payment:pay_ABC123",
  "event_type": "payment" | "programme_completed" | "active_client_count",
  "occurred_at": "2026-07-02T09:30:00.000Z",
  "data": { ... }
}
```

`event_id` is **deterministic** — the idempotency key end to end (sender outbox
dedupe, receiver job dedupe, receiver row dedupe). Conventions:

| event_type | event_id |
|---|---|
| payment (Razorpay) | `payment:<razorpay_payment_id>` |
| payment (manual/no rzp id) | `payment:manual:<client_id>:<YYYY-MM-DD>:<product>` |
| programme_completed | `programme_completed:<plan_slug>` |
| active_client_count | `active_client_count:<YYYY-MM-DDTHH:mm>` (IST, minute resolution — dedupes double-fires, allows several snapshots/day; receiver applies guarded by `as_of`) |

### `data` for `payment`

```json
{
  "product": "lab" | "maintenance" | "programme" | "consultation" | "triage" | "other",
  "amount_paisa": 1000000,
  "currency": "INR",
  "razorpay_payment_id": "pay_ABC123",
  "paid_at": "2026-07-02T09:29:41.000Z",
  "client": {
    "client_id": "cl-007",
    "email": "person@example.com",
    "phone_e164": "919876543210"
  }
}
```

- `client.client_id` is fm-coach's opaque id — safe to store, never PII on its own.
- `email` / `phone_e164` are the **join keys** (same pair the handover contract
  uses; phone is digits-only, country code, no `+`). Either may be null.

### `data` for `programme_completed`

```json
{
  "plan_slug": "meghana-plan-1-2026-04-02-cl-007",
  "completed_at": "2026-07-02T09:30:00.000Z",
  "client": { "client_id": "cl-007", "email": "…", "phone_e164": "…" }
}
```

Fired when the coach explicitly graduates a plan (terminal-success state — the
trigger for Loop 5's testimonial ask later). One per plan slug, ever.

### `data` for `active_client_count`

```json
{
  "active_clients": 18,
  "max_active_clients": 100,
  "signups_this_week": 3,
  "max_new_signups_per_week": 20,
  "discovery_calls_per_week": 8,
  "breakdown": {
    "active_care": 9,
    "awaiting_start": 2,
    "onboarding": 7,
    "maintenance": 0
  },
  "as_of": "2026-07-02T15:30:00.000Z"
}
```

Two capacity dimensions (coach input 2026-07-02, corrected same day):
- **The weekly intake throttle** — `signups_this_week` vs
  `max_new_signups_per_week` (20). A signup = programme enrolment
  (`programme_started_at` in the trailing 7 days, or a record created in the
  window that's already signed_up / programme_active). This is what gates
  lead-buying week to week; the window clears on its own as it rolls.
- **The practice ceiling** — `active_clients` vs `max_active_clients` (100).
  `active_clients` = active_care + awaiting_start + onboarding — every client
  the coach is **committed** to serve (a published-but-not-started plan still
  occupies a slot). Maintenance clients are reported but NOT counted against
  the ceiling (much lighter touch).
- Capacity **config travels with the count** — the coach owns her caps, so
  `max_active_clients` (100, `FM_MAX_ACTIVE_CLIENTS`), `max_new_signups_per_week`
  (20, `FM_MAX_SIGNUPS_PER_WEEK`) and `discovery_calls_per_week` (8,
  `FM_DISCOVERY_CALLS_PER_WEEK`) come from fm-coach env, not from ochre-funnel
  config. Change it in one place.

### Responses

| Status | Meaning | Sender behaviour |
|---|---|---|
| 200 `{ok:true, queued:true}` | accepted | mark sent |
| 200 `{ok:true, deduped:true}` | already seen | mark sent |
| 401 | bad signature | keep pending; alarm via attempts count |
| 400 | malformed | keep pending (a code bug — visible in outbox) |
| 5xx / network | transient | keep pending, retried next drain |

---

## 2. Sender — fm-coach

All emit sites run **Mac-side** (pm2 `fm-coach` + `fm-coach-cron`); the Fly
intake node 404s these routes and never sends.

- Library: `src/lib/fmdb/revenue-export.ts`.
- **Durable outbox**: `~/fm-plans/_revenue_export_outbox.yaml` (same pattern as
  `_pending_sends.yaml`). `emitRevenueEvent()` appends (dedupe on event_id),
  then best-effort flushes inline. Failures stay `pending` with
  `attempts`/`last_error` and drain on the next cron tick. Sent rows are kept
  as the audit trail (volume is a few rows/week).
- Emit sites:
  1. `/api/lab-order/webhook` — after order flips `paid` → payment `lab`
  2. `/api/maintenance/webhook` — one-time block paid → payment `maintenance`;
     `subscription.charged` → payment `maintenance`
  3. `processProgrammeSignup()` (handover stage 2) → payment `programme`
     (echo of a payment ochre-funnel already saw — deduped there by
     `razorpay_payment_id`) + fresh `active_client_count`
  4. `graduatePlan()` → `programme_completed` + fresh `active_client_count`
  5. `/api/cron/revenue-export` (daily 21:00 IST via cron-runner) —
     graduation sweep (catch-up), daily `active_client_count`, outbox drain
- Env (`.env.local`): `OCHRE_FUNNEL_REVENUE_URL`, `FM_REVENUE_EXPORT_SECRET`,
  optional `FM_MAX_ACTIVE_CLIENTS` (100), `FM_MAX_SIGNUPS_PER_WEEK` (20),
  `FM_DISCOVERY_CALLS_PER_WEEK` (8).
  Unset URL/secret → every emit is a silent no-op (outbox still records, so
  history backfills on first configure).

**What fm-coach does NOT send:** the ₹12k consultation payment — fm-coach never
records it (it's a Razorpay payment-link ochre-funnel mints and sees in its own
webhook). See §3: ochre-funnel records those directly.

---

## 3. Receiver — ochre-funnel

- Route: `app/api/webhooks/fm-coach-revenue/route.ts` — verify HMAC
  (timing-safe, same as Razorpay), enqueue job `fmrev.event` with
  `dedupeKey = fmrev:<event_id>` (scar #7), return 200.
- Handler (`lib/queue/handlers.ts`):
  - touches `IntegrationHeartbeat source="fm_coach"` on every event
  - `payment` / `programme_completed` → `recordRevenueEvent()` (below)
  - `active_client_count` → upsert `Setting key="coach_capacity"` +
    `evaluateCapacity()` (below)
- **`RevenueEvent` table** (`lib/revenue/record.ts`) — the money-truth store
  for post-handover revenue:
  - unique on `eventId`; payments also unique on `razorpayPaymentId` — so the
    fm-coach programme echo and this app's own direct record of the same
    payment can never double-count. **First write wins** (in practice the
    direct write, being synchronous, always lands first).
  - contact resolution: email (lowercased) → else phone (last-10-digit match).
    **Never creates a Contact** — an organic fm-coach client who never touched
    the funnel stays an unattributed row. Revenue events never trigger
    messaging (DPDP posture: join keys stored for matching only).
  - attribution snapshot at record time: `firstTouchFunnelId` (contact's
    earliest funnel-linked event) and `lastTouchFunnelId` (latest before
    `occurred_at`) — this is the A3 dual-column (first vs last touch).
- **Direct recording** (same table, `source="razorpay_direct"`): the
  consultation / programme / triage branches of the `razorpay.payment` handler
  also write a RevenueEvent — closing the gap where those payments triggered a
  handover but were counted in no money view.
- **Capacity + interlock** (`lib/revenue/capacity.ts`):
  - `Setting coach_capacity` = latest snapshot (both dimensions, breakdown, as_of).
  - **Either cap hit** (20 signups this week OR 100 active clients) →
    fire-once critical alert `capacity:full` **and pause ads on every funnel
    with live Meta campaigns** (`setFunnelAdsStatus PAUSED`) — buying leads the
    coach can't serve is pure waste. The alert names the binding dimension,
    the paused funnels and the recommended action: *waitlist / raise price /
    shift budget to nurture*. Signups win ties (the weekly throttle is the
    operative gate).
  - Cleared (the 7-day window rolls, or a slot frees) → resolve the alert +
    one info alert. **Ads are NOT auto-resumed** — resuming spend is a human
    decision (safety-before-scale), one click in the cockpit.
  - Staleness: heartbeat `fm_coach` silent > 30 h → warning alert (the daily
    count is the dead-man's signal).
- **LTV-by-funnel** on `/reports`: per funnel — ticket revenue (existing step
  metrics) + downstream revenue by first-touch and by last-touch + paying
  clients + LTV/client, with an unattributed-revenue row so nothing hides.

---

## 4. Invariants

1. `event_id` is deterministic and stable — never regenerate for the same fact.
2. Amounts are **paise integers** end to end. fm-coach converts `amount_inr × 100`.
3. The receiver never creates Contacts and never messages anyone off this data.
4. `razorpayPaymentId` dedupe means BOTH apps may report the same payment safely.
5. Capacity config (100-client ceiling / 20 signups-wk / 8 calls-wk) lives in
   fm-coach env and travels in the event — ochre-funnel stores what it's told,
   defaulting only if absent.
6. The interlock only ever **pauses** spend. Nothing in this contract resumes it.
7. Clinical data never crosses: product + amount + join keys + opaque ids only.
