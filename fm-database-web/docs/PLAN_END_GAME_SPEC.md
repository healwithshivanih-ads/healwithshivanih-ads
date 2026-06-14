# Plan end-game: graduation, maintenance, and the Library floor — spec

**Status:** spec'd 2026-06-13, to build. No code written yet. Brainstormed with
coach; all the open product decisions below are now closed.

## The core idea

The 12-week plan is a *phase*, not a finish line. "End of plan" is a decision
point, never an app lock-out. Separate two things that get conflated:

- **Program end** — the 12-week active protocol concludes. A milestone (surface a
  graduation report), not an exit.
- **App access** — the companion app NEVER hard-locks. At week 12 it transitions
  to a *review* state, and from there to one of three tracks. If a client pays
  for nothing, the app degrades gracefully to a frozen **Library** floor — it
  does not expire.

Keep the existing 12-week countdown (Day X of 84) for momentum. Its job is to
drive the client toward the review, not to slam a door at day 84.

## The three tracks after the review gate

1. **Continue (Phase 2)** — full price, new 12-week protocol on the next layer.
   App behaves exactly as today. Mechanically this is already a plan supersede.
2. **Maintain (₹2,000/month)** — hands-free paid tier. Prepaid in 6-month blocks
   (₹12,000). Lighter app mode. Details below.
3. **Library (free floor)** — NOT a tier we sell or advertise. It is simply what
   the app lands on when someone declines/lapses. Its only job is to keep the
   door open for re-engagement without burning the relationship.

The choice we ever *present* is Continue or Maintain. Library is the silent
floor under a "no."

## App-state resolver (derived, not a new lifecycle enum)

Resolve the client's app mode at request time from existing fields + the new
maintenance record:

```
ACTIVE      plan published AND today < effective_meal_plan_start + plan_period_weeks*7
REVIEW      within ~14d of (or past) effective_recheck_date, no successor yet
            → show graduation report + "Continue or Maintain?" choice
PHASE2      a newer published plan supersedes the old one → resolves to ACTIVE
MAINTENANCE maintenance.paid_through >= today
GRACE       maintenance lapsed AND today <= maintenance.paid_through + 15 days
            → full access retained, renewal banner shown
LIBRARY     none of the above (never paid, or lapsed past grace) → frozen floor
```

`effective_recheck_date` and `effective_meal_plan_start` already exist
(`fm-database/fmdb/plan/models.py`, `src/lib/fmdb/plan-timing.ts`).

## Tier matrix (what each app mode renders)

| Surface | Library (free floor) | Maintenance (₹2,000/mo) | Continue / Phase 2 |
|---|---|---|---|
| Menus (`plan.app_menu`) | ✗ frozen | ✅ viewable | ✅ fresh |
| Recipe library | 4 samples only | ✅ full searchable | ✅ + new |
| Recipe sample rule | auto: 1 each breakfast/lunch/dinner/snack | full | full |
| Monthly do's & don'ts | teaser only | 🔄 auto-refresh monthly | 🔄 full protocol |
| Supplements + buy links | names + links stay live | simplified (basics + remedies), kept current | full, targeted |
| Lab cadence / reminders | ✗ | ✅ scheduled | ✅ + interpreted at review |
| Back on track plan | ✗ (teased) | ✅ | ✅ |
| New check-ins / tracking / co-pilot | read-only history | ✅ | ✅ |
| Recipes-only PDF keepsake | ✅ one-time at graduation | ✅ | ✅ |

The paid moat is deliberately: **menus + monthly do's/don'ts + lab cadence + back
on track plan.** Recipes are NOT a moat — the free PDF keepsake hands all of them
over at graduation; the in-app recipe library is a convenience layer, not a gate.

## "Back on track plan" (internal: flare protocol)

The safety net, and the emotional reason someone keeps paying. A pre-agreed,
self-serve reset card, generated once at graduation from the client's own plan
(the foods/remedies they responded to). Client-facing name: **"back on track
plan."** Contents:

- A short reset (3–7 days) of the gentlest foods they tolerated; drop their known
  triggers; sleep + hydration prioritised.
- 1–2 as-needed remedies/supplements they personally responded to, at doses
  already established as safe during the 12 weeks (nothing new).
- Simple do's/don'ts for a flare window.
- Duration + off-ramp: "try 5–7 days; if not settling, book a re-check."
- **Red-flag triggers** ("this is beyond a reset — see a doctor / reach out").
  Non-optional: this is what keeps the feature in coaching scope (a lifestyle
  reset, never new prescribing) and makes a hands-free tier responsible.

Locked + teased in Library; open in Maintenance. Must pass the same client-text
scrubbers as letters (no drug brands / labs / "titrate" language — see
client-app gotchas + `_clientify_dose`).

## Monthly do's & don'ts (the only living thing in maintenance)

"No human interface" means the coach does not write these. Two implementation
options:

- **A (recommended):** cheap Haiku call, keyed to the client's conditions +
  season, run once per month and cached as that month's card. Must obey the
  no-hallucination rule — state only on-file facts, never invent quantities.
- **B (no-API fallback):** a pre-authored rotating set of seasonal/condition do's
  & don'ts cards, selected by month + the client's conditions. Zero API cost.

Default to A; keep B as the fallback when the API cap is hit.

## The 6-month renewal gate (what happens after 6 months)

Each 6-month block ends on a renewal gate — it does NOT silently roll. Three
doors:

1. **Renew** — next 6-month block, maintenance continues unchanged.
2. **Re-check (the one optional human touchpoint)** — paid review where the coach
   actually reads their labs and decides: step down, stay, or re-enter active
   care. This is the periodic upsell AND the clinical safety valve (otherwise the
   "labs advised on a schedule" have nowhere to go in a hands-free tier).
3. **Lapse** — drops to GRACE (15 days full access) then LIBRARY.

Renewal mechanic: **manual prompt** (one-time UPI for the next ₹12,000 block),
not auto-debit — Indian clients distrust recurring mandates. Recommend baking a
**default annual review expectation** so labs get interpreted at least yearly.

## Graduation report (don't waste the moment)

At REVIEW, surface a "Your 12 weeks" before/after report from the outcome data the
app already computes (symptom burden + Five Pillars deltas). It is the
testimonial/referral trigger and the natural lead-in to "Continue or Maintain?".

## Data model additions

Minimal. On the client (or a small sibling record):

- `maintenance_status: none | active | lapsed`
- `maintenance_started_on: date`
- `maintenance_paid_through: date` (drives MAINTENANCE vs GRACE vs LIBRARY)
- `maintenance_term_months: int = 6`

On the plan (or generated alongside the maintenance plan, v0.67 engine exists):

- `back_on_track_plan: {...}` — generated once at graduation.
- monthly do's/don'ts — cached per `YYYY-MM`, regenerated monthly.
- sample-recipe selection is **derived** (auto: first/representative recipe per
  meal slot), not stored.

## Build checklist

- [ ] data model: maintenance fields on client + `back_on_track_plan` on plan
- [ ] app-state resolver (the table above) — one shared function, TS + Python
- [ ] REVIEW mode: graduation report + Continue/Maintain choice screen
- [ ] MAINTENANCE app mode: menus + simplified supplements + monthly do's/don'ts
      + back-on-track card + lab cadence; hide active-only surfaces
- [ ] GRACE mode: full access + renewal banner, 15-day window from `paid_through`
- [ ] LIBRARY mode: 4 auto-picked sample recipes, frozen guidance teasers,
      supplement names + live buy links, recipes-only PDF keepsake, "resume"
      CTA
- [ ] monthly do's/don'ts generator (Haiku, option A) + rotating fallback (B)
- [ ] back-on-track plan generator (from plan; client-safe scrubbed)
- [ ] recipes-only PDF keepsake export at graduation
- [ ] 6-month renewal gate: renew / re-check / lapse; manual UPI prompt
- [ ] WhatsApp nudges: review-due, renewal-due, lapse→grace (new templates via
      whatsapp-server/scripts/submit-templates.js, never the Meta dashboard)

## Effort / risk

Medium-large — spans Python (plan/maintenance model + generators), the Next app
(new app modes + resolver), and WhatsApp templates. Touches the Fly-deployed
client app, so each shippable slice needs `flyctl deploy` + a smoke test. Best
sequenced: data model + resolver first → Library/grace floor → maintenance mode
→ generators → renewal gate + nudges. Don't bolt onto a long session.
