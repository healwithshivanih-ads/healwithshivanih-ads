# Discovery Tier — consult-only delivery + 15-day upgrade window — spec

**Status:** spec'd 2026-06-25. **P0 + P1 + P2 (code) built & verified 2026-06-25**
(localhost preview + isolated test stores). P0: `discovery_call_date` +
`discovery-tier.ts` resolver + 11 unit tests. P1: plan-less loader branch
(`buildDiscoveryAppData`) + the discovery app shell, all four tabs
screenshot-verified. P2: plan-less Fly projection (`app-staging-action.py` made
plan-optional + 3 allowlist keys, staging test-verified incl. PHI minimisation +
package regression + discovery→package auto-upgrade) + `shareDiscoveryApp` server
action + `DiscoveryAppCard` on the coach Overview. **NOT deployed** — needs a
localhost `fm-coach` rebuild + a `flyctl deploy` (the P1 client-app code is what
clients read on Fly). P3–P4 pending (WhatsApp nudges, upgrade handoff polish).
Companion to
[`LAB_VAULT_SPEC.md`](./LAB_VAULT_SPEC.md) — that doc owns the **Labs surface**
for discovery clients (its Phases 3–5). This doc owns everything *around* it: the
commercial model, the app-tier resolver, tab gating, the Summary view, the
upgrade-CTA state machine, and the credit-window WhatsApp nudges.

## The commercial model (coach-decided 2026-06-25)

A client can buy an **initial consultation at ₹12,000** to understand their
reports and get a few foundational starting changes — without committing to the
full package.

- **Upgrade within 15 days** of the discovery call → the ₹12,000 is **adjusted
  against** the package price.
- **After 15 days** → the credit expires. Two paths: buy the full package at
  **full price**, or **book a fresh discovery call** (its ₹12,000 then credits,
  on a fresh 15-day clock).
- **Re-book resets the clock.** Each discovery call is its own ₹12,000 and its own
  15-day window. Credit does **not** stack — one call's credit at a time
  (the latest call wins).

### Map vs Journey — the value boundary (why this doesn't cannibalise the package)

The consult sells **the Map** (clarity / orientation). The package sells **the
Journey** (change, walked together). The consult is generous on clarity and gives
away **nothing** of the package's *form*. The dividing test for any deliverable:
**orientation goes in; implementation is the package.**

| Discovery tier **gives** (Map) | Package **reserves** (Journey) |
|---|---|
| Plain-English report decode (the discovery call) | The structured 12-week protocol |
| Lab Vault — their markers vs FM-optimal ranges | Personalised meal plans + recipes |
| The root-cause *story* | Supplement protocol (doses / timing / brands) |
| 2–3 **foundational, universally-safe** starting changes (principles, not prescriptions) | The full app: Today / Plan / Progress, tracking, reminders |
| A written **Starting Map** summary they keep | Lab ordering + functional-test interpretation over time |
| An honest preview of what the journey adds | Adjustments as labs & symptoms shift |

**Guardrail:** consult starting-changes must stay *generic-safe* (e.g. "front-load
protein, get morning light, stop eating 3h before bed"), never a real protocol
(e.g. "magnesium glycinate 400mg at bedtime"). The line is
*foundational-principle vs personalised-prescription*. All copy obeys the
no-hallucination + coaching-scope rules ([feedback_no_hallucinations_in_client_letters],
NBHWC/FMCA: educate, never diagnose / prescribe / interpret).

The "contact channel" is **purely commercial** — upgrade / repurchase / re-book.
There is **no in-app support thread** (an open thread would become free ongoing
coaching and hollow out the package). Genuinely logistical questions route to a
plain "Questions? WhatsApp Shivani" link to the normal number — handled as any
lead, no coaching obligation.

## Delivery mode: a gated, read-only `discovery` mode of The Ochre Tree app

Not a PDF, not a chat app. The same PWA (`/app/<app_token>`), resolved into a
read-only consult experience. Three things the app does that a PDF can't:

1. Their reports **live** somewhere persistent + beautifully interpreted (a PDF
   gets buried in WhatsApp).
2. The locked Today/Plan/Progress tabs are a **silent salesman** — "🔒 Unlocks
   with your full journey" shows what they're missing, continuously.
3. The upgrade CTA sits **next to their own out-of-optimal lab values** — the
   highest-intent upsell surface that exists.

### Tab matrix (discovery mode)

The app shell is `ochre-app.tsx` (5 tabs: Today / Plan / Progress / Labs / Coach;
`BottomNav` in `ochre-ui.tsx`). Today the only gate is the `setupHold` guard that
swaps Today/Plan/Progress for `PlanHoldScreen` while keeping Labs + Coach
reachable. Discovery mode adds a second gate keyed on tier.

| Tab | Discovery mode |
|---|---|
| **Labs** | ✅ Full Lab Vault, `mode="discovery"` — "Worth exploring together" pinned section (see LAB_VAULT_SPEC) |
| **Summary** | ✅ NEW — the "Your Starting Map" view (replaces the **Today** tab label/icon in discovery mode) |
| **Plan** | 🔒 Locked — "🔒 Unlocks with your full journey" + upgrade CTA |
| **Progress** | 🔒 Locked — same |
| **Coach** | ✅ Upgrade CTA state machine (below) + plain WhatsApp link. **No message thread.** |

Implementation note: rather than a 6th tab, **discovery mode re-skins the `today`
tab slot as "Summary"** (icon + label + screen swap), so the bottom nav stays
4–5 items and `ochre-app.tsx`'s existing tab switch needs one new branch, not a
nav rewrite.

## The shared "open floor" — also the non-renewal default (coach decision 2026-06-25)

This read-only shell is NOT only for never-signed-up clients. It is the **default
an app falls back to whenever someone isn't an active package client** — including
a client who **doesn't renew**. The discovery shell and the plan-end-game
**LIBRARY** floor (`app-mode.ts`: "frozen free floor when never paid, lapsed past
grace, or no plan") are the **same surface**:

> read-only **Lab Vault** + **book labs** + locked Plan/Progress + a re-engage CTA.

So the shell is rendered when **`tier === "discovery"` OR the resolved
`appMode === "LIBRARY"`** (GRACE keeps full access — the floor only kicks in at a
true lapse). The shell is shared; two things are parameterised by context:

| | Discovery (never signed up) | Lapsed / non-renewal (LIBRARY) |
|---|---|---|
| **Summary tab** | the "Starting Map" | "your journey so far" / where they left off |
| **Lab Vault** | discovery-mode (gaps) | their FULL history from the programme, read-only |
| **Re-engage CTA** | "Start the programme" + 15-day ₹12k credit | "Renew / continue" (win-back offer) |
| **Labs — book** | ✅ | ✅ |

**Two universals, regardless of mode:**
1. **See your own labs** — the Lab Vault is always reachable (active, discovery,
   lapsed). It never gets locked.
2. **Book labs** — available in **every** mode, active clients included (see
   [`LAB_BOOKING_SPEC.md`](./LAB_BOOKING_SPEC.md)). Booking is a cross-cutting
   capability, not gated to the floor.

Build impact: extend the `data.tier === "discovery"` render branch in
`ochre-app.tsx` to also fire for `appMode === "LIBRARY"`, and parameterise the
Summary + CTA by which. The locked-tab + Lab-Vault machinery is already built
(P1); LIBRARY reuses it. Open sub-decisions in "Open decisions" below.

## Data model

### New Client fields (`fm-database/fmdb/plan/models.py`)

All `Optional`, default `None`, so existing clients load unchanged
(`extra="ignore"` already tolerates them; add explicitly anyway for clarity).

- `discovery_call_date: Optional[date]` — the credit-window anchor. Set when the
  coach logs the discovery call / issues the discovery app link. **Re-booking
  overwrites this** (resets the clock).
- *(computed, not stored)* credit expiry = `discovery_call_date + DISCOVERY_CREDIT_WINDOW_DAYS`.
  Add a class constant `DISCOVERY_CREDIT_WINDOW_DAYS = 15` next to the existing
  `MEAL_PLAN_DEFAULT_DELAY_DAYS` pattern, so it lives in one place.

### Reuse (don't duplicate)

- `engagement_status` (`pending | signed_up | declined`) — `signed_up` already
  means "enrolled / paid for package." A **discovery-tier** client is one with a
  discovery session + `app_token` issued, `engagement_status != signed_up`, and no
  published plan. ([engagement_status=signed_up meaning] — signed_up ≠ plan exists.)
- `discovery_session_completed_at`, `discovery_lab_pack_sent_at`,
  `intake_full_unlocked_at` — existing journey markers; `discovery_call_date` can
  default from `discovery_session_completed_at.date()` if the coach doesn't set it
  explicitly.
- `app_token` (`ensureClientAppToken` in `src/lib/server-actions/app-token.ts`) —
  **stable per-client link**; survives the discovery→package upgrade so the URL
  never changes when they convert. Use this, not a per-plan `letter_token`.
- `health_snapshots`, `lab_reference_ranges` — already power the Lab Vault.

## The app-tier resolver

Add a pure resolver alongside the existing app-mode logic in
`src/lib/fmdb/client-app.ts` (mirrors the `notStarted` / `startsInDays` resolution
already there, and the mode states in `PLAN_END_GAME_SPEC.md`).

```
resolveAppTier(client, plan) ->
  "package"   if engagement_status == "signed_up" OR a published plan exists
  "discovery" if app_token issued AND not package        // consult-only
  // (existing package sub-states — hold / active / review / maintenance /
  //  grace / library — resolve as today once tier == "package")
```

Then the **discovery CTA sub-state** is date-driven off `discovery_call_date`
(`D = whole days since the call`, UTC, same date math as `startsInDays`):

| Window | CTA state (Summary footer + Coach tab) |
|---|---|
| **D ≤ 15** | `credit_live` — "Upgrade to your full journey — your **₹12,000 applies** · expires **{expiry date}**" + countdown ("{15−D} days left") |
| **D > 15** | `credit_expired` — "Your credit window has closed. **Start the full package**, or **book a fresh discovery call** (it credits toward your package)." |

One field (`discovery_call_date`) drives the whole state machine. No manual
flipping. On upgrade (`engagement_status → signed_up` + plan published) the tier
flips to `package` and the app becomes the full Ochre Tree via the existing flow —
**same token, same URL.**

## The Summary view ("Your Starting Map")

New screen component (e.g. `ochre-discovery-summary.tsx`), rendered in the `today`
slot when `tier == "discovery"`. Sections:

1. **Header** — warm, brand-voiced ("Here's your starting map, {first name}").
2. **Top 2–3 root-cause hypotheses** — orientation-framed, scope-safe.
3. **Your foundational starting changes** — the 2–3 generic-safe principles.
4. **What your full journey would address** — the honest gap list (this *is* the
   upsell; mirrors the package-reserves column above).
5. **Upgrade CTA footer** — the date-driven state from the resolver.

**Authoring:** populate from the discovery session + Lab Vault, written
**client-voiced** so it bypasses the `clientifyWhy` / `scrubAuthors` scrubbers
(those exist because coach-audit / drug-class / lab-value text otherwise leaks into
the app — any *non*-authored prose MUST pass through them). Keep it a lightweight
artifact, **not** a published plan. Consider a `discovery_summary` block on the
client (structured: `hypotheses[]`, `foundational_changes[]`, `journey_preview[]`)
authored by the coach in a small UI, OR a dedicated lightweight letter type — TBD,
see open decisions.

## WhatsApp credit-window nudges

The window is the conversion engine. Reuse the delayed-send queue pattern from
`src/lib/server-actions/plan-publish-followups.ts` (`_pending_sends.yaml` +
`tickPendingSends()` cron, with the 9am-IST floor — no 2am nudges).

On issuing the discovery app link (sets `discovery_call_date = today`), enqueue:

| When | `kind` | Template (register via `whatsapp-server/scripts/submit-templates.js`) | Gist |
|---|---|---|---|
| Day 0 (immediate) | `discovery_app_ready` | `fm_discovery_app_ready_v1` | "Your reports are now in your Ochre Tree app: {link}" |
| Day 7 | `discovery_credit_halfway` | `fm_discovery_credit_day7_v1` | "Halfway through your credit window — here's what your journey would tackle first." |
| Day 13 | `discovery_credit_expiring` | `fm_discovery_credit_expiry_v1` | "Your ₹12,000 credit expires in 2 days." |

**Non-negotiables (from project memory):**
- Every send pairs `sendWhatsAppAction()` **with** `recordOutboundMessageAction()`
  or it never shows in the coach inbox — wrap both, don't call send alone.
- Template **bodies** must be registered + Meta-approved via
  `submit-templates.js`, never edited ad-hoc in `actions.ts` or the Meta dashboard.
- Add the three new `kind` values to the `PendingSend` union and the `tick` drain.
- Gate behind an env flag (mirror `FM_AUTO_PUBLISH_FOLLOWUPS=1`) so dev runs don't
  message clients — e.g. `FM_DISCOVERY_NUDGES=1`.
- Re-booking (overwriting `discovery_call_date`) must **clear any pending
  discovery nudges** for that client and re-enqueue from the new Day 0.

## ⚠ Build dependencies (do these first — they block the tier)

1. **Lab Vault Phase 2 is not on Fly yet.** The Labs tab (plan mode) is built but
   undeployed. Discovery tier is Lab-Vault-first — deploy Phase 2, then build the
   discovery-mode surface (LAB_VAULT_SPEC Phase 3).
2. **Discovery clients are not in the Fly projection scope.** The
   `/api/cron/intake-reconcile` reconciler only stages *active intakes* today. A
   discovery client's `client.yaml` (and `health_snapshots`, `lab_reference_ranges`,
   `app_token`, `discovery_call_date`, `discovery_summary`) won't reach Fly — so
   the app will 404 / show empty — until:
   - the reconciler includes discovery-tier clients, **and**
   - every field the discovery app reads is added to the **`_APP_CLIENT_KEYS`
     allowlist**. *Fields not on the allowlist silently never reach Fly* — this is
     the single most common "why is the app empty" bug. (See project memory:
     app supplement phasing + `_APP_CLIENT_KEYS`.)
3. **Coach-side trigger.** A button on the client Overview / EngagementPicker area
   — "🌱 Share app at discovery stage". It does NOT mint a new link: it calls the
   idempotent `ensureClientAppToken` (returns the client's existing `app_token` if
   one was already issued), stamps `discovery_call_date`, enqueues the credit
   nudges, and re-stages to Fly. ONE `app_token` per client for life — the same
   `/app/<token>` URL resolves to the discovery app now and flips IN PLACE to the
   full package app the moment a plan is published (see resolution order in
   `loadClientAppData`). No re-send on upgrade.

## Build phases

- **P0 — data + resolver (localhost): ✅ DONE 2026-06-25.** `discovery_call_date`
  on Client (`models.py`); `DISCOVERY_CREDIT_WINDOW_DAYS` + `resolveAppTier` +
  `resolveDiscoveryCredit` in **`src/lib/fmdb/discovery-tier.ts`** (a sibling pure
  module — kept OUT of `client-app.ts` and `app-mode.ts` so the tier axis stays
  separate from the plan-lifecycle axis); 11 unit tests in `discovery-tier.test.ts`
  (D≤15 / boundary / D>15 / re-book reset / fail-open on missing date).
- **P1 — app shell gating: ✅ DONE 2026-06-25.** Plan-less loader branch
  `buildDiscoveryAppData` + a `resolveDiscoveryClientByToken` scanner, wired into
  `loadClientAppData`'s `return null` fallthrough (package path byte-for-byte
  untouched; `tier: "package"` added to its return). New `ochre-discovery.tsx`
  (`DiscoverySummaryScreen` in the `today` slot, `DiscoveryLockedScreen` for
  Plan/Progress, `DiscoveryCoachScreen` + shared `UpgradeCta`/`PlainContactLine`).
  `ochre-app.tsx` branches on `data.tier === "discovery"`; `BottomNav` relabels
  Today→Summary. Labs reuses the existing vault in `mode: "discovery"`.
  GOTCHA fixed during preview: js-yaml parses unquoted `date:`/numeric `value:`
  fields into Date/number — `asYmd()` coerces `discovery_call_date`, and the
  discovery builder normalises `health_snapshots` to strings before
  `buildLabVault` (else the Labs renderer crashes on `[object Date]`).
- **P2 — Fly enablement: ✅ CODE DONE 2026-06-25 (deploy pending).**
  `app-staging-action.py` made plan-optional: `_stage_one` + the `stage` action +
  `_refresh` now stage a plan-less discovery client (client.yaml + trimmed lab
  vault only, no plan/letters); `_APP_CLIENT_KEYS` += `engagement_status`,
  `discovery_call_date`, `discovery_summary`; `_latest_published_slug_for` lets a
  staged discovery client auto-upgrade to package staging once a plan ships.
  `stageDiscoveryClientArtifacts` (letter-token.ts) + `shareDiscoveryApp`
  (app-token.ts: ensure token → start 15-day window → project to Fly) +
  `DiscoveryAppCard` on the coach Overview (gated `!publishedPlan && engagement !==
  "signed_up"`). Staging shim verified end-to-end (discovery stage, PHI
  minimisation, package regression, refresh, auto-upgrade); type-clean.
  **Deploy steps remaining:** (1) build + `pm2 restart fm-coach` (coach localhost —
  picks up the staging-script + server-action + card changes); (2) `flyctl deploy`
  (Fly client app — picks up the P1 discovery loader/screens). Lab Vault Phase 2
  must also be live on Fly (same deploy). The cron refresh then keeps discovery
  clients fresh automatically once one is staged via the card.
- **P3 — nudges:** register 3 templates; enqueue/drain; re-book reset; env gate.
- **P4 — upgrade handoff:** verify token-stable discovery→package flip; nudge
  cleanup on `signed_up`.

## Open decisions (carry forward)

- **Summary authoring surface** — structured `discovery_summary` block + small
  coach UI, vs a dedicated lightweight letter type. (Block is lighter; letter
  reuses the render pipeline.)
- **Second discovery call & app** — re-book reuses the same `app_token` + Summary
  view, just refreshed content + reset clock. Confirm the *previous* Summary is
  overwritten, not archived.
- **Lab Vault retest reminders vs credit nudges** — LAB_VAULT_SPEC Phases 3–5 also
  define retest reminders for discovery clients. Make sure the two reminder
  streams don't double-message; the credit nudges take priority during the 15-day
  window.
- **Access after expiry** — keep Lab Vault read-only + live past day 15 (decided:
  yes); the CTA just transitions to `credit_expired`. Don't lock them out.

### Lapsed / non-renewal floor (new 2026-06-25 — needs coach input)
- **Old plan visibility for a lapsed client** — fully locked (like discovery), OR
  keep a **read-only** view of their last plan/menus as a courtesy + renew nudge?
  (Plan-end-game's LIBRARY was "frozen floor"; a read-only last-plan is friendlier.)
- **Renew offer** — what's the win-back CTA for a lapsed client? Same package
  re-purchase, a discounted renewal, or a fresh discovery call? (Distinct from the
  discovery 15-day ₹12k credit.)
- **GRACE stays full-access** — the floor kicks in only at true lapse (past the
  15-day post-recheck GRACE window), not the moment a plan ends. Confirm.
- **Lab Vault content for lapsed** — full programme history, read-only (vs the
  discovery "gaps" view). Confirm the vault shows everything they accumulated.
