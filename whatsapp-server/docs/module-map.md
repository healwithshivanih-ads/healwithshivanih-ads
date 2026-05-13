# Module Map

Status: locked, v0.1

How the codebase is laid out, what each module owns, and what depends on what.

## Mental model

Four layers, top to bottom:

```
┌─────────────────────────────────────────────────────────┐
│  ROUTES         HTTP edge. Validate, ack, delegate.     │
├─────────────────────────────────────────────────────────┤
│  SERVICES       Business logic. The only layer that     │
│                 reads/writes the DB.                     │
├─────────────────────────────────────────────────────────┤
│  CHANNELS &     External-world adapters. Meta API, Wix  │
│  INTEGRATIONS   API, Calendly API. No business logic.   │
├─────────────────────────────────────────────────────────┤
│  SCHEDULER      Background ticks that drain queues.     │
└─────────────────────────────────────────────────────────┘
```

**Rule:** routes never call channels directly. Routes call services. Services
call channels.

## Directory layout

```
whatsapp-server/
  src/
    config.js                ← env vars, validation
    db.js                    ← Supabase client singleton
    logger.js                ← pino
    errors.js                ← typed app errors

    routes/
      webhook.js             ← Meta WA inbound
      webhooks/
        calendly.js
        wix.js
        meta-ad.js
        form.js
      api/
        index.js             ← mounts all /api/* under adminAuth
        contacts.js
        identities.js
        tags.js
        conversations.js
        messages.js
        appointments.js
        reminders.js
        segments.js
        suppression.js
        broadcasts.js
        templates.js
        ai-policies.js
        ai-drafts.js
        imports.js
        integrations.js
        stats.js
      health.js

    middleware/
      adminAuth.js
      rateLimit.js
      rawBody.js              ← only on /webhook*
      errorHandler.js

    services/
      workspaces.js
      contacts/
        index.js              ← upsert, get, search, merge, delete
        identities.js
        matcher.js             ← identity matching for sync + imports
        tags.js
        imports.js             ← CSV/Wix bulk
      conversations/
        index.js
        service-window.js     ← 24h check
      messages/
        index.js              ← log, status updates, retry
      segments/
        index.js
        evaluator.js          ← Filter DSL → SQL → contact_ids
        suppression.js        ← apply hard/soft/per-broadcast rules
        ai-builder.js         ← English → filter JSON via Claude
      broadcasts/
        index.js              ← CRUD, resolve audience, queue
        sender.js              ← rate-limited drain
        stats.js
      appointments/
        index.js
      reminders/
        index.js              ← schedule on appointment create
        runner.js              ← drain pending reminders
      ai/
        policies.js           ← which policy applies to which message
        worker.js              ← drain ai_jobs queue
        prompt.js              ← context assembly
        drafts.js              ← create/approve/reject drafts
      flows/                  ← schema-only in v1
        schema.js              ← validate flow JSON
      integrations/
        wix/
          client.js            ← Wix REST wrapper
          inbound.js           ← Wix webhook handler
          outbound.js          ← push our changes to Wix
          matcher.js           ← identity matching
          reconciler.js        ← periodic catch-up scan
          mapping.js           ← field-by-field translation
        calendly/
          inbound.js

    channels/
      whatsapp/
        client.js              ← send text/template/interactive
        signature.js           ← X-Hub-Signature-256 HMAC
        parse.js               ← Meta envelope → normalized event
        templates.js           ← sync template registry from Meta
      instagram/                ← stubs in v1; IG app stays separate
        types.js               ← shared types for future merge

    scheduler/
      index.js                 ← tick loop, kicks off workers
      ticks/
        reminders.js
        broadcasts.js
        ai-worker.js
        wix-reconciler.js
        suppression-expiry.js  ← clean up expired cooldown rows

    util/
      time.js                  ← "30 days ago" parsing for filter DSL
      phone.js                 ← E.164 normalization
      crypto.js                ← encrypt/decrypt for integrations.credentials_encrypted

  sql/
    schema.sql                 ← from docs/schema.sql
    seed.sql
    migrations/

  admin-ui/                    ← React + Vite + Tailwind (separate package)
    src/
      api.js
      auth.js
      pages/
        Inbox.jsx
        Contacts.jsx
        ContactDetail.jsx
        Broadcasts.jsx
        BroadcastComposer.jsx
        BroadcastReport.jsx
        Segments.jsx
        SegmentBuilder.jsx
        Appointments.jsx
        AIReview.jsx           ← draft approval surface
        AIPolicies.jsx
        Settings/
          Workspace.jsx
          Integrations.jsx
          Suppression.jsx
          Imports.jsx
          Templates.jsx
      components/
        FilterBuilder/         ← the visual DSL editor
        AudiencePreview/       ← count + breakdown + sample
        ConversationThread/
        TagInput/
        TemplatePicker/

  docs/
    architecture.md
    schema.sql
    filter-dsl.md
    module-map.md
    wix-mapping.md
```

## Dependency graph

```
routes/api/*          routes/webhook(s)/*
     │                       │
     ▼                       ▼
  ┌──────────────────────────────────────┐
  │            services/                  │
  │                                       │
  │  workspaces                           │
  │  contacts ←─── imports                │
  │     │                                  │
  │     ↓                                  │
  │  conversations → messages              │
  │     │              │                   │
  │     ↓              ↓                   │
  │  segments ────→ suppression            │
  │     │              │                   │
  │     ↓              ↓                   │
  │  broadcasts ←─────┘                    │
  │  reminders                             │
  │  ai (policies, worker, drafts)         │
  │  integrations/wix                      │
  └──────┬─────────────────┬───────────────┘
         │                 │
         ▼                 ▼
   channels/whatsapp  integrations/wix/client
   channels/instagram integrations/calendly
         │
         ▼
     Meta Graph API
```

Scheduler is orthogonal — it calls into services on its tick.

## What each module owns

### Core infra
- `config` — env validation, fails fast on missing vars
- `db` — single Supabase client, typed query helpers
- `logger` — structured logs, redacts secrets
- `errors` — `OutsideServiceWindowError`, `SuppressionError`, `RateLimitError`

### Services
- `workspaces` — workspace CRUD, settings, suppression policy
- `contacts` — upsert, search, merge two contacts, soft delete
- `contacts/identities` — add/remove/verify identity rows
- `contacts/matcher` — given phone/email/wix_id, find existing contact or create
- `contacts/tags` — apply/remove tags, mirror to Wix labels
- `contacts/imports` — process CSV row-by-row, matched/created/skipped
- `conversations` — get-or-create, status changes
- `conversations/service-window` — `canSendFreeText(conversationId) → bool`
- `messages` — write queued row, attempt send via channel, reconcile status
- `segments` — CRUD on segments
- `segments/evaluator` — compile filter DSL → SQL, three modes
- `segments/suppression` — apply hard + soft + per-broadcast rules
- `segments/ai-builder` — Claude prompt that emits filter JSON from English
- `broadcasts` — create, schedule, cancel, resolve audience at send time
- `broadcasts/sender` — drain `broadcast_recipients`, respect Meta tier rate limits
- `broadcasts/stats` — recompute aggregate stats from recipient rows
- `appointments` — create/update/cancel, source-aware de-dupe
- `reminders` — schedule 4 reminders on appointment create
- `reminders/runner` — claim pending rows atomically, send via channel
- `ai/policies` — match policy to (conversation, message) by scope_filter + priority
- `ai/worker` — drain `ai_jobs`, call Claude with context, decide reply/draft/escalate
- `ai/drafts` — list pending drafts, approve (sends), reject, edit-and-send
- `integrations/wix` — full subsystem (client, inbound, outbound, reconciler, mapping)
- `integrations/calendly/inbound` — parse Calendly webhook, create/update appointment

### Channels
- `whatsapp/client` — `sendText`, `sendTemplate`, `sendInteractiveButtons`, `sendInteractiveList`, `markRead`
- `whatsapp/signature` — `verify(rawBody, signature, secret) → bool`
- `whatsapp/parse` — `parseIncoming(envelope) → NormalizedEvent[]`
- `whatsapp/templates` — sync approved templates from Meta into a local registry

### Scheduler
One tick every 30s (configurable). On each tick, runs each worker function in
parallel with timeouts:
- `reminders.runner.tick()`
- `broadcasts.sender.tick()`
- `ai.worker.tick()`
- `wix.reconciler.tick()` (every 5 min)
- `suppression.expiry.tick()` (every 60s, cheap)

## Two architectural rules

### Rule 1: Webhook handlers ack in <2 seconds

```
1. Capture raw body
2. Verify signature
3. Insert into webhook_events
4. Return 200
5. (after response) Dispatch to async processor
```

No business logic in the handler. The async processor reads
`webhook_events.processed=false` and works through them. If our server is
slow/restarting, Meta gets a fast 200 and we catch up later.

### Rule 2: All outbound goes through `messages.send()`

There is one function that writes the queued row, calls the channel, handles
errors, updates status. Reminders call it. Broadcasts call it. AI drafts call
it. Manual replies call it. No bypassing — that's how you get inconsistent
message history and missing audit trail.

## Not built in v1

To make the cut crystal clear:

- `flows/runner.js` — schema only
- `channels/instagram/client.js` — types only, for future merge
- `integrations/calendly/outbound.js` — Calendly is read-only from us
- `users` service — workspace API key is the only auth surface
