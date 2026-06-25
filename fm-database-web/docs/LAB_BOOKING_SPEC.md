# Lab Booking (Acumen) — in-app panel ordering + payment — spec

**Status:** spec'd 2026-06-25. Not built. Builds on the Acumen catalogue
(`fm-database/data/lab_providers/acumen.yaml`, rates locked 2026-06), the client
app (`/app/<token>`), the discovery tier ([`DISCOVERY_TIER_SPEC.md`](./DISCOVERY_TIER_SPEC.md)),
the Lab Vault ([`LAB_VAULT_SPEC.md`](./LAB_VAULT_SPEC.md)), and the existing
Razorpay handover pattern (`src/lib/server-actions/handover.ts`).

Coach decisions 2026-06-25: **fully in-app Razorpay**; surfaced in **both apps**
with the **Lab Vault** as the entry point; spec-first (this doc) before code.

## Goal

Let a client book an Ochre-branded Acumen lab panel from inside the app, pay in
app (Razorpay), and have results flow back into their Lab Vault. Turns the Lab
Vault's "worth exploring" gaps into a one-tap action, and adds a revenue line that
also warms the upgrade to the full programme.

## Catalogue — the FINAL deal (4 profiles, not the old 3 tiers)

⚠ **Pricing source of truth = `acumen.yaml#profiles_final` (deal closed 2026-06-25),
NOT the `packages:` block** (the 3-tier ₹3,999/5,999/8,999 design is explicitly
marked *superseded*). The locked structure is a **Base panel for everyone + one
gender/age add-on profile**:

| Profile | Audience | Our cost | **Client MRP** | Margin |
|---|---|---|---|---|
| Base Panel | everyone | ₹8,500 | **₹12,500** | ₹4,000 |
| Women's Reproductive | women <45 | ₹16,500 | **₹23,500** | ₹7,000 |
| Perimenopause | women 40+ | ₹13,000 | **₹20,000** | ₹7,000 |
| Male | men | ₹14,000 | **₹21,000** | ₹7,000 |

Add-on individual tests bill at **50% of Acumen catalogue** (`addon_tests`). Base
is the full FM core (metabolic + full thyroid + lipid/ApoB/Lp(a) + hs-CRP +
homocysteine + iron + vit D + active B12 + morning cortisol; **no sex hormones** —
those live in the gender/age profiles).

**Functional tests — out of in-app scope.** Acumen does NOT run zonulin,
4-point salivary cortisol, DUTCH, GI-MAP, or OAT — those stay a **coach-side
referral** the coach arranges separately, not bookable in-app. The order model
keeps a `provider` field so another lab could be added later, but P1 is
**Acumen only**.

> ⚠ **Branch note:** this worktree's `acumen.yaml` predates the deal — it has only
> the superseded 3-tier `packages:`. The build branch must carry `main`'s
> `acumen.yaml` (with `profiles_final` + the 50%-catalogue `addon_tests`).

## Commercial model (reseller — confirm, don't assume)

The client pays **Ochre Tree** for an **Ochre-branded profile** at the MRP above;
Ochre settles with Acumen B2B at `our_cost` (Acumen bills 50% of catalogue). This
is a **reseller / channel-partner** relationship — Ochre sells its own packaged
offering, NOT "collecting on Acumen's behalf" (which would be RBI
payment-aggregator territory).

**Coach to confirm before launch (not a code decision):**
- The Acumen agreement frames Ochre as a reseller/channel partner.
- GST handling on the full sale price, with input credit on Acumen's invoice
  (coach's CA owns this). Price panels post-GST.

**Software boundary:** this build owns the booking flow, order records, checkout
UI, payment *verification*, and the coach fulfilment dashboard. It does NOT set up
or operate the money rail — the Razorpay account, settlements, and the B2B
payments to Acumen stay with the coach. (Razorpay account + KYC + API keys are a
coach setup step.)

## Coexists with the brand-neutral requisition (don't break the rule)

`lab-requisition.ts` is deliberately **brand-neutral** ("the client picks the lab;
we don't push Dr Lal / Apollo / Thyrocare / SRL"). The Acumen booking is an
**opt-in, done-for-you convenience** (pay + home collection through us), NOT a
replacement. Keep BOTH paths:
- "📄 Use your own lab" → the existing neutral requisition (unchanged).
- "🏠 Book through Ochre (home collection)" → the new Acumen flow.

The neutral requisition stays the default framing; Acumen is the convenience offer.

## Surfaces

| Surface | What |
|---|---|
| **Coach: "Recommend labs"** (dashboard, new) | The coach approves the labs FIRST: pick the profile (pre-filled by sex/age) + any additional tests + a note + add-on prices → creates a `recommended` order. THE gate. |
| **Client: Lab Vault (both apps)** | A "worth exploring" marker explains the gap; if the coach has recommended labs, a card surfaces it. No self-serve catalogue — the client doesn't pick panels. |
| **Client: booking/pay screen** (new app overlay) | Shows the **coach's recommended order** — panel + tests + note + amount + **Pay** (Razorpay). Reuses `ochre-checkout.tsx`. No panel selection. |
| **Coach: order dashboard** (new) | Every order with status + amount + margin; fulfilment actions: mark booked-with-Acumen, mark collected, attach results. |

**Booking is UNIVERSAL — available in every app mode** (coach decision 2026-06-25):
active package clients, discovery clients, AND lapsed / non-renewing clients (the
LIBRARY floor) can all book. The Labs tab — and the "book" CTA — is never gated by
tier or renewal status; "see your own labs + book your labs, in any case." Booking
is a "Map" action (orientation), so it's allowed even inside the read-only
discovery / lapsed shell without unlocking Plan/Progress. See
[`DISCOVERY_TIER_SPEC.md`](./DISCOVERY_TIER_SPEC.md) "The shared open floor" — the
read-only Lab Vault + booking is the heart of the non-renewal default.

## Coach-approved booking — the coach gates which labs (decision 2026-06-25)

Booking is **NOT client self-serve**. The coach is the FM practitioner who decides
which panel + which (if any) additional tests are right for a client. The client
books and pays for **what the coach approved**, nothing else.

**Flow:**
1. **Coach recommends** (dashboard, "Recommend labs" on the client) — picks the
   profile (pre-filled by the client's sex/age via `profilesForClient`) + toggles
   any additional tests + an optional note. The profile price is catalogue-derived
   (`priceSelection`); the coach sets each add-on's price (so no global add-on
   margin policy is needed to ship). "Send" creates a lab order at
   `status: recommended` and projects it to the client app.
2. **Client pays** — the app's Labs tab shows *"Shivani recommends: \<panel\> —
   ₹X"* with the test list + note + **Pay**. The client can pay or not; they
   cannot self-select a different panel. On payment → `paid` (verified webhook).
3. **Coach fulfils** — `booked` → `sample_collected` → `results_in` (as before).

**Why this is clean:** add-ons are coach-curated per client (not an à-la-carte
menu the client guesses through), the charged amount is fixed by the coach at
recommendation time (and still never accepted from the client), and the clinical
gate sits with the practitioner.

**Scope.** This coach-recommendation path is how **discovery + lapsed-floor**
clients (who have no active plan) get bookable labs. **Active package clients**
already get their labs prescribed via the plan's `lab_orders` — the same
order→pay→fulfil pipeline can render a recommended order from a plan lab_order, but
that wiring is P2. For P1, the coach-recommendation builder targets the no-plan
(discovery/lapsed) clients.

## Data model

### Lab catalogue loader (new)
`src/lib/fmdb/lab-providers.ts` — pure loader reading `acumen.yaml#profiles_final`
+ `addon_tests` (ignore the superseded `packages:`). Exposes
`{ provider, profiles[], addons[] }`: each profile = `{ id, name, audience,
mrp_inr, margin_inr, fasting }`; each addon resolves its `slug` to
`lab_tests/<slug>.yaml` (FM-optimal ranges already there) with `client_inr` =
50%-catalogue. Project read-only to Fly so the app can render the menu (price is
re-derived server-side at order time, never trusted from the client).

**Profile selection by sex/age:** the app offers **Base + the ONE matching
gender/age profile** for this client (women <45 → Women's Reproductive; women 40+
→ Perimenopause; men → Male; everyone gets Base). Drive off `client.sex` +
age-from-DOB (already in `client.yaml` / the app's `body`). Don't show all four.

### Lab order record (new)
`~/fm-plans/clients/<id>/orders/<order-id>.yaml`. `order-id` = `YYYY-MM-DD-labNNN`.
Fields:
```
order_id, client_id, created_at
provider: acumen-diagnostics # provider-aware (room for others later)
profile_id: 1|2|3|4 | null   # profiles_final id (null = pure add-on order)
addon_slugs: []              # add-ons the COACH curated for this client
lines: [{label, inr}]        # itemised: profile (catalogue MRP) + each coach-priced add-on
amount_inr                   # total = sum(lines). Profile = catalogue; add-ons = coach-set.
our_cost_inr                 # our B2B cost (profile + add-on costs) — coach margin view
status: recommended | paid | booked | sample_collected | results_in | cancelled
recommended_by               # the coach who approved it (always coach-created)
recommended_at
coach_note | null            # why these labs (shown to the client)
razorpay_order_id | null
razorpay_payment_id | null
paid_at | null
booked_with_acumen_at | null
sample_collected_on | null
results_snapshot_date | null # links to the health_snapshot the results landed in
fasting_required: bool
notes | null
```
Status is the single source of truth for the order's lifecycle on both surfaces.
Lifecycle: **`recommended` (coach creates) → `paid` (client pays) → `booked` →
`sample_collected` → `results_in`** (+ `cancelled`). There is NO client-initiated
"requested" state — an order only exists once the coach has approved it.

### Reverse-mirror (Fly → Mac)
Orders are *created and paid on Fly* (that's where the client app runs), so the
order YAML is written into the Fly staging tree and must sync back to the Mac
authoritative store — exactly like app check-ins. Extend `app-staging-action.py`
`_refresh`'s reverse-mirror to copy `clients/<id>/orders/*.yaml` (copy-if-missing
for new orders; newest-wins for status advances the client can drive, e.g.
cancellation). Coach-driven status changes (booked / collected / results) are
written on the **Mac** and forward-staged to Fly the normal way.

## Payment — in-app Razorpay (the critical new infra)

No Razorpay SDK exists today; the only current touchpoint *receives* a payment id
from the Wix funnel. This adds first-party Razorpay:

1. **`razorpay` node SDK** + env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
   (Fly **secrets** — the secret never ships to the client), `RAZORPAY_WEBHOOK_SECRET`.
2. **Pay an existing recommended order** — `POST /api/lab-order/<id>/pay` (Fly):
   loads the coach-created `recommended` order, re-derives the profile price
   **server-side from `acumen.yaml`** (never trust a client-sent price; add-on
   lines are the coach-set values already stored on the order), creates a Razorpay
   Order for `amount_inr` (in paise), stamps `razorpay_order_id`, returns the order
   + the public `RAZORPAY_KEY_ID` to the app. (There is no client-side "create
   order" — the order already exists because the coach approved it.)
3. **Checkout** — wire `ochre-checkout.tsx`'s `onPay` seam to the Razorpay
   Checkout JS widget (UPI/card) with the returned `razorpay_order_id`.
4. **Verify — server-side, mandatory.** The source of truth for "paid" is the
   **Razorpay payment-captured webhook** (`POST /api/lab-order/webhook`, Fly),
   HMAC-verified with `RAZORPAY_WEBHOOK_SECRET`. On a verified capture, flip the
   matching order to `status: paid` + stamp `razorpay_payment_id`/`paid_at`.
   The client-side success handler only updates the UI — **never** marks paid on
   the client's word (mirrors the trust posture of the handover webhook, but
   first-party). Idempotent on `razorpay_payment_id` (same dedupe as
   `processProgrammeSignup`).
5. On `paid`, fire a coach notification (WhatsApp/inbox) + a client confirmation
   ("Payment received — Shivani will arrange your home collection").

## Fulfilment (coach-side, manual — no Acumen API)

Acumen has no booking API (per `acumen.yaml`); home collection is arranged by
phone (`+91 98080 50050`). Coach order dashboard:
- `paid` → coach books with Acumen (phone/portal) → **mark booked** (`booked_with_acumen_at`).
- Acumen collects sample → **mark collected**.
- Results arrive → coach uploads the report (existing `parse-health-text` /
  lab-extraction pipeline) → a `health_snapshot` is written → **mark results_in**
  with `results_snapshot_date`. Results render in the client's Lab Vault
  automatically (existing pipeline); the previously "worth exploring" markers now
  show real values.

## Phasing

- **P1 — bookable + payable + fulfillable.** Catalogue loader + Fly projection;
  order model + reverse-mirror; `/api/lab-order/create` + Razorpay Checkout wiring
  + `/api/lab-order/webhook` (verified); Lab Vault → booking entry; coach order
  dashboard (paid → booked → collected → results_in). Results reuse the existing
  upload→snapshot→vault path.
- **P2 — polish.** GST invoice (PDF) on `paid`; add-on bundling UX; per-marker
  "this panel covers it" precision; order-status nudges (WhatsApp) on each step;
  refund/cancel handling.
- **P3 — automation (only if Acumen ever exposes an API).** Auto-book + status
  callbacks. Not planned; coach-fulfilled is fine at current volume.

## Coach setup (prerequisites, coach-owned)

1. Razorpay account live + KYC + API keys (key id/secret + webhook secret).
2. Acumen reseller/channel-partner agreement confirmed (not collect-on-behalf).
3. GST treatment of the panel sale agreed with CA.
4. Razorpay secrets set as **Fly secrets** (not in the repo).

## Key invariants / gotchas

- **Reseller, not aggregator.** The client buys an *Ochre* panel; Ochre pays
  Acumen B2B. Keep the framing (and the contract) on that side of the line.
- **Price is computed server-side** from `acumen.yaml`. Never trust a client-sent
  amount — a tampered price would otherwise let a client set ₹1.
- ⚠ **Add-on amounts can only be BOUND-CHECKED, not re-derived** (review 2026-06-25).
  `priceSelection` re-derives the PROFILE price from the catalogue, but add-on
  `clientInr` is null in the catalogue (coach-set per order) — so for an order with
  add-ons there is nothing to recompute against; the amount lives only on the order
  YAML. The **pay endpoint MUST bound-check** the stored `amount_inr` before
  charging (every line ≥ its `our_cost_inr`, each add-on ≤ `MAX_ADDON_INR`, total
  ≥ `our_cost_inr`) rather than blindly trust it — OR restrict in-app Razorpay to
  **profile-only** orders for v1 and route add-on orders to manual payment. Either
  way, "server-derived price" means *recomputed* for profiles, *bound-checked* for
  add-ons. (`MAX_ADDON_INR` ceiling is already enforced at recommend time.)
- **Paid = a verified Razorpay webhook**, never the client's success callback.
- **Razorpay secret is a Fly secret**, never bundled to the client; only
  `RAZORPAY_KEY_ID` (public) reaches the browser.
- **Brand-neutral requisition stays.** Acumen is the opt-in convenience, not the
  default — don't remove "use your own lab".
- **Orders reverse-mirror Fly → Mac** like check-ins; coach status edits go
  Mac → Fly. Don't create a second write path.
- **Orders are PHI-adjacent** (they reveal what the client is testing) — same
  minimisation posture as the rest of the Fly projection.
- **Discovery clients can book** — booking is orientation (Map), allowed inside
  the read-only discovery shell; it does not unlock the locked Plan/Progress tabs.

## Open decisions

- **Add-on margin.** `acumen.yaml` notes add-ons are at/above Acumen list (no
  partner discount) — decide whether to mark them up, pass through at cost, or
  only offer add-ons within a panel. (Affects whether à-la-carte is worth surfacing
  to clients vs coach-only.)
- **Coach dashboard placement** — a tab under the client, or a global "Lab orders"
  queue across clients (like the WhatsApp inbox). A global queue scales better once
  volume grows.
- **Refunds/cancellations** — policy + Razorpay refund flow (P2).
- **Invoice identity** — whose GSTIN/branding on the client invoice (Ochre's).
