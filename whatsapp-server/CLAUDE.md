# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WhatsApp Cloud API webhook server + Wix/Calendly/Cal.com integrations + appointment reminder scheduler + admin REST API + bundled React/Vite admin UI. Built for the "Heal With Shivani" coaching practice. Wix is the CRM of record; this server syncs to it.

Self-hosted replacement for Interakt/AiSensy. Node 20 ESM. Deployed on Fly as `whatsapp-server-shivani` (region `bom`).

## Common commands

```bash
# Server (Node 20+, ESM)
npm install
npm run dev                # node --watch src/index.js (no nodemon)
npm start                  # production
npm run build              # builds admin-ui only (npm run build:ui)

# Admin UI (separate package — Vite + React + Tailwind)
cd admin-ui && npm install && npm run dev   # http://localhost:5173 in dev
cd admin-ui && npm run build                # writes admin-ui/dist (served by Express in prod)

# Smoke test the HTTP surface
./test/curl-examples.sh

# Submit WhatsApp message templates to Meta
node scripts/submit-templates.js

# Deploy
flyctl deploy
flyctl status -a whatsapp-server-shivani
flyctl logs   -a whatsapp-server-shivani
flyctl secrets set KEY=val -a whatsapp-server-shivani
```

No test runner is wired up. `test/` contains curl scripts + Postman collection + sample payloads, not unit tests.

There's no lint script. The README and existing code don't enforce one — don't add Prettier/ESLint config without confirming.

## Architecture — four layers, one rule

```
ROUTES        HTTP edge: validate, ack fast, delegate.
SERVICES      Business logic. The ONLY layer that reads/writes the DB.
CHANNELS &    External adapters: Meta Graph, Wix, Calendly. No business logic.
INTEGRATIONS
SCHEDULER     Background ticks that drain queues.
```

**Rule: routes never call channels directly. Routes call services. Services call channels.** Honour this when adding new endpoints — putting a `wix.client.update(...)` in a route file means refactoring later.

See `docs/architecture.md` and `docs/module-map.md` for the full picture (locked design decisions, build sequence, table inventory).

## Critical invariants — don't break these

1. **Raw body before JSON parse on `/webhook`.** Meta's `X-Hub-Signature-256` is HMAC-SHA256 over the *exact bytes* Meta sent. `express.json()` would re-serialize and break the HMAC. `src/index.js` mounts `webhookRouter` with raw body capture; the per-route JSON parsers live inside `apiRouter` and `webhooksRouter` so they don't clash. If you add a new path that also needs raw bytes, do the same — don't try to share a global parser.

2. **All external webhooks persist to `webhook_events` BEFORE processing.** Calendly, Wix, Meta-ad, form, and the Meta WA webhook all save the raw payload first, ack 200 fast, then process async. If processing crashes, the raw event survives and can be replayed. Don't move parsing in front of the persist — bugs in the parser would silently drop events.

3. **Always return 200 to webhook callers, even on invalid signatures or parse failures.** Meta retries indefinitely on 4xx/5xx; we'd rather log `signature_valid=false` and ack. Same philosophy for the other integrations.

4. **24h service window for free-form WhatsApp.** `services/messages` checks `conversations.last_inbound_at`. Outside 24h, free-form text throws `OutsideServiceWindowError` (HTTP 409). Templates can be sent any time. When adding new outbound paths, route through the existing send service — don't call `channels/whatsapp/client` directly.

5. **Scheduler atomic-claim pattern.** Workers (`reminders/runner`, `wix/reconciler`) acquire work with `update ... where status='pending' returning *` so multi-replica setups don't double-process. We currently run one process but the pattern is load-bearing — don't replace with naive `select then update`.

6. **Reminder idempotency.** `reminders` has `unique(appointment_id, kind)`. Re-running `scheduleReminders` for the same appointment is a no-op. There are 4 kinds: `confirmation` (immediate on booking), `t_minus_24h`, `t_minus_2h`, `post_session` (+1h after start). Any kind whose `scheduled_for` is already in the past at insertion time is skipped — a same-day booking still gets confirmation + post-session but no 24h/2h.

7. **Workspace scoping.** Every table is keyed by `workspace_id`. Services accept a workspace id (or resolve the default via `services/workspaces.getDefault`). Don't write cross-workspace queries.

8. **`config.env` vs `NODE_ENV`.** `src/config.js` reads `process.env.NODE_ENV` and falls back to `'development'`. In production on Fly, `fly.toml` sets `NODE_ENV=production` — verify with `configSummary()` log on boot if anything looks off. Required env vars in `REQUIRED` (`src/config.js`) hard-exit on boot in production but only warn in dev.

## Adding a new external webhook

The shape lives in `src/routes/webhooks/`. Each handler:

1. Mounts its own `express.json()` locally (don't add it globally).
2. Persists the raw payload to `webhook_events` first.
3. Acks 200 with minimal body.
4. Calls a service in `src/services/` or `src/integrations/` to do the work async (or synchronously if fast — but never let parsing failures or downstream errors leak as non-200).

Mirror `webhooks/cal-com.js` or `webhooks/wix-bookings.js` as a template.

## Wix is the CRM of record

Phased 2-way sync (`src/integrations/wix/`). Reads pull contacts/IG comments/labels in; writes push tag changes + unsubscribes out. Reconciler runs every 5 min via the scheduler. When designing data flows, treat Wix as authoritative for contact identity; this server's `contacts` table is a synced mirror plus WhatsApp-specific columns. Field mapping is documented in `docs/wix-mapping.md`.

## Admin auth

Every `/api/*` route requires `x-api-key: <ADMIN_API_KEY>`. The admin UI proxies through the same header. `/healthz` and `/webhook*` are unauthenticated by design.

## Out of scope (v1)

Flows runner, group chats, multi-user workspaces, email/SMS channels, multi-CRM connectors, native mobile app, media rehosting. Don't build adapters or abstractions speculating about these — the design doc explicitly defers them. See `docs/architecture.md` § "Out of scope".
