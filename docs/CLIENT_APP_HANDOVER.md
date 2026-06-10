# Client-Facing Mobile App (Project 2) — Build Handover

**Status:** Design ready, not yet built. This doc captures the architecture + delivery decisions
agreed on 2026-06-10 so a fresh chat can start integration without re-deriving them.

**Read first:** the root `CLAUDE.md` (full project context) and the memory note
`project_intake_staging_layer.md` (Fly ⇄ Mac sync model). This app is the long-deferred
"Project 2 / JSON export contract for mobile app" item.

---

## 1. What this is

A **persistent client companion PWA** — not a read-only plan viewer. Clients install it once
from a WhatsApp link, log in with phone + OTP, and use it daily to read their plan, track
adherence, message the coach, and see progress. It is a new public surface on the existing
Fly stack, reading the same `~/fm-plans/` data that already syncs to Fly via Mutagen.

## 2. Decisions locked (do not re-litigate)

| Decision | Choice | Rationale |
|---|---|---|
| **Delivery model** | **PWA** (web app, "Add to Home Screen") | Reuses Next.js + Fly + Mutagen + WhatsApp stack. No App Store fees/review. Right for India-on-phones client base. |
| **Auth** | **Phone number + OTP** | Persistent PHI app needs real sessions, not a stateless link. OTP delivered **over WhatsApp** (self-hosted server), not SMS. |
| **Core features** | Read plan · Track & check-in · Two-way messaging · Progress & reminders | Full companion app, all four. |
| **Reminder channel** | **WhatsApp, not PWA push** | iOS PWA push is fragile. App *displays* Day-N/timing; nudges fire via existing WhatsApp templates. |
| **Messaging model** | **Recommended: mirror the existing WhatsApp inbox** (one coach inbox) | ⚠️ NOT yet confirmed by coach — see Open Questions. |

## 3. Why PWA over the alternatives (reference)

- **vs Native (App/Play Store):** native only earns its keep for store discoverability or deep
  device APIs (HealthKit/Google Fit, background sync). Not needed yet. Native = new codebase
  (RN/Flutter), review cycles, fees. Rejected for v1.
- **vs plain responsive web page:** no install/offline/home-screen icon — doesn't feel like an app.

Revisit native only if (a) store discovery becomes a growth channel, or (b) wearable/health-data
integration becomes a requirement.

## 4. Architecture & data flow

```
Coach Mac (authoritative ~/fm-plans/)
   │  publishes plan → writes plan.json artifact per client
   ▼
Mutagen sync  ⇄  Fly app (new: theochretree-app or new route family on existing app, bom region)
                    │  client installs PWA, logs in (phone + OTP over WhatsApp)
                    ▼
              Client phone (home-screen PWA)
                    │  reads plan.json · writes tracking + messages
                    ▼
              Fly volume → Mutagen → back to Mac (coach dashboard sees it)
```

- **Hosting:** either a sibling Fly app `theochretree-app` OR a new public route family on the
  existing `theochretree-coach` app (e.g. `/app/*` or `/c/*`). Either way, add the route family to
  the `middleware.ts` public-path allowlist next to `/intake/*` and `/start/*`. The
  `FLY_INTAKE_ONLY=1` split must keep coach UI (`/clients-v2`, `/plans`, etc.) returning 404 on the
  public host — verify the new routes don't punch a hole in that.
- **Sync:** Mac is authoritative (per existing invariant). Client writes land on the Fly volume and
  flow back via Mutagen. Conflict policy = Mac wins unless proven otherwise.
- **Data isolation:** server-side enforcement only. Never trust a client-supplied client id —
  derive the client from the authenticated session.

## 5. The four features → work required

### 5.1 Read the plan — the `plan.json` export contract (THE SPINE — build first)
- Today plans render to **HTML letters** (`fm-database-web/scripts/render-client-letter.py` +
  `brand_html.py`). The app needs **structured JSON**, not HTML.
- Define a **versioned `plan.json`** artifact written at publish time (hook into the publish
  lifecycle in `fmdb/plan/transitions.py` / the publish server action).
- Must contain: today's meals, the week's meal grid, the supplement schedule (already generated
  server-side by `_build_supplement_schedule_html` — extract the data, not the HTML), Day-N of plan
  (driven by `meal_plan_started_on` / `effective_meal_plan_start()` — see v0.70 effective-dates
  logic, that 12-week clock is immutable once set), tracking targets, recheck date.
- Reuse `effectiveRecheckDate()` / `effectiveMealPlanStart()` from `src/lib/fmdb/plan-timing.ts`.
- Everything else in the app hangs off this contract. **Draft and agree this schema before any UI.**

### 5.2 OTP login — the biggest new subsystem
- Existing public links are **stateless secrets**; OTP means **sessions**. This is net-new infra.
- **Issue/verify flow:** generate code → send via `WHATSAPP_SERVER_URL` (self-hosted WA server,
  already in `.env.local`) → verify → mint session.
- **Sessions:** signed cookie / JWT with expiry + server-side revocation. Multi-device handling.
- **Rate-limit** OTP issue + verify to prevent abuse.
- Mirror the tokenised-action shim pattern of `scripts/intake-token-action.py` for the server side.

### 5.3 Two-way messaging — do NOT build a second inbox
- A WhatsApp inbox already exists: `/messages` + the `/api/whatsapp-webhook` thread store
  (see memory `project_whatsapp_integration.md`).
- **Recommendation: in-app messages write to the SAME thread store**, so the coach keeps ONE inbox.
  The app is just another client-side window onto the existing thread.
- Every outbound from coach must still go through `recordOutboundMessageAction` (memory:
  send buttons must persist "sent" state; WhatsApp sends that skip this don't show in chat).
- ⚠️ Confirm mirror-vs-separate-channel with coach before modelling.

### 5.4 Track & check-in + Progress & reminders
- Check-ins write back through Fly → Mutagen → Mac, extending the write surface built for
  `intake_form_draft` + weekly poll responses. Reuse the allowlist-gated write pattern from
  `intake-token-action.py` (a field not in the allowlist is silently dropped — memory
  `project_intake_form_field_audit.md`).
- For app users, check-in data should **replace** the weekly WhatsApp poll, not duplicate it.
- **Reminders fire via WhatsApp templates** (registered through
  `whatsapp-server/scripts/submit-templates.js`, NEVER the Meta dashboard — memory
  `feedback_whatsapp_template_registration.md`). The app only *displays* Day-N / supplement
  timing / recheck.
- Progress = trends over the `health_snapshots` + session check-in history already on the client.

## 6. Onboarding / sharing flow (concrete)

1. Coach taps **"📲 Send app"** on the client page → reuse the existing WhatsApp share button
   pattern (same as intake/start link sharing).
2. Client receives `app.theochretree.com` + setup link via WhatsApp.
3. Client enters **phone → OTP over WhatsApp → verified → session**.
4. Browser prompts **"Add to Home Screen"** → installed icon.
5. Thereafter: open icon → already logged in → today's plan.

## 7. Security escalation — settle BEFORE shipping

This is a bigger blast radius than the intake form: a **persistent, authenticated app holding
every client's full plan + tracking + message history on a public Fly host.** The codebase audit
(memory `project_codebase_audit.md`) already lists **"token-gate public PHI routes"** as OPEN
(public `/recipes` and `/supplements`). Required before launch:
- Session expiry + revocation.
- Per-client data isolation enforced server-side (derive client from session, never from request).
- Rate-limiting on OTP issue/verify.
- Audit which public routes expose PHI and gate them.

## 8. Recommended build order

1. **`plan.json` export contract** — schema + writer at publish time. Unblocks everything.
2. **OTP/session layer** — phone → WhatsApp OTP → session. The gate everything sits behind.
3. **Read-the-plan screens** — render `plan.json` (the design's core screens).
4. **Track & check-in writes** — allowlist-gated, replaces weekly poll for app users.
5. **Messaging** — wire to existing WhatsApp thread store (after mirror decision).
6. **Progress + reminder display** — trends + Day-N; nudges via existing WA templates.
7. **Security hardening pass** — §7 before any real client gets a link.

## 9. Open questions for the coach (resolve in the new chat)

1. **Where is the design?** Figma link / exported screens / files in repo — needed to map screens
   to the `plan.json` contract and confirm scope.
2. **In-app chat = mirror of WhatsApp (one inbox) or a separate channel?** Recommendation: mirror.
   Shapes the data model.
3. **Hosting:** sibling Fly app `theochretree-app`, or new route family on existing
   `theochretree-coach`? (Lean: new route family — less infra, same Mutagen volume.)
4. **App domain:** `app.theochretree.com`? (needs DNS at Wix + Fly cert, same as
   `intake.theochretree.com`).

## 10. Key existing assets to reuse (don't rebuild)

- `src/middleware.ts` — public-path allowlist + `FLY_INTAKE_ONLY` split.
- `scripts/intake-token-action.py` — tokenised action shim + field allowlist pattern.
- `WHATSAPP_SERVER_URL` / `WHATSAPP_SERVER_API_KEY` — self-hosted WA send (OTP + reminders).
- `/api/whatsapp-webhook` + `/messages` — existing inbound thread store + coach inbox.
- `whatsapp-server/scripts/submit-templates.js` — template registration (OTP + reminder templates).
- `render-client-letter.py` / `brand_html.py` — extract structured data for `plan.json`.
- `src/lib/fmdb/plan-timing.ts` — effective start/recheck dates (the immutable 12-week clock).
- Mutagen Mac ⇄ Fly sync (memory `reference_mutagen_sync_repair.md`).
- DEPLOY_FLY.md — runbook to mirror for the app's domain + cert + DNS.

---

*Handover authored 2026-06-10. Start the integration chat by resolving §9, then build §8 in order.*
