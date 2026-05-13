# Architecture — Conversational Automation Platform

Status: design locked, v0.1
Last updated: 2026-05-13

## What this is

A coach-operated conversational automation platform. WhatsApp is the primary
channel today; Instagram is handled by a separate existing app that shares the
same Wix-backed contact database. The platform handles inbound messaging,
appointment reminders, AI-drafted replies, broadcast campaigns with audience
segmentation, and two-way sync with Wix as the CRM of record.

Replaces tools like Interakt and AiSensy with a self-hosted alternative.

## System picture

```
                  ┌────────────────────────────────┐
                  │   Performance Marketing UI     │
                  │   (existing IG app's UI)       │
                  │   — separate codebase           │
                  └──────────┬─────────────────────┘
                             │ reads
                             ▼
        ┌──────────────────────────────────────────────────┐
        │              Wix Database                         │
        │   (contacts, IG comments, IG actions, labels)     │
        └──────────────────────────────────────────────────┘
                ▲                                ▲
                │ 2-way sync (phased)            │ writes (existing)
                │                                │
        ┌───────┴────────┐                ┌──────┴──────────┐
        │ WhatsApp Server│                │ Instagram App   │
        │ (this project) │                │ (existing, Fly) │
        └───────┬────────┘                └─────────────────┘
                │ reads + writes
                ▼
        ┌──────────────────┐
        │ Coach Dashboard  │
        │ (this project's  │
        │  UI: WA-focused) │
        └──────────────────┘
```

Two UIs, two channels, one truth (Wix). The dashboards don't know about each
other. They share contact data via Wix sync.

## Locked decisions

| Area | Decision |
|---|---|
| Tenancy | Single workspace today, multi-tenant data model |
| Scheduler | In-process tick loop, atomic-claim against races |
| IG app | Stays on Fly, separate UI, shares Wix DB |
| Wix sync | Two-way, phased: pull → tag/unsub write-back → full |
| Flows | Schema only in v1, runner deferred to v1.5 |
| Broadcast cap | ~5k contacts, single-process rate limiter |
| AI replies | Draft mode default, per-segment auto mode |
| CRM scope | Wix only (no abstraction layer) |
| Compliance | Explicit opt-in tracking (DPDP + Meta policy) |
| Unsubscribe | Auto-suppress + send confirmation template |
| Audience preview | Count + breakdown + 10-row random sample |
| Filter DSL | JSON tree, typed leaves, AI-assisted builder |
| Auth | Single workspace API key |

## Four subsystems

### 1. Ingest

Two inbound surfaces:

- **Meta WhatsApp webhook** (`POST /webhook`) — signature-verified, raw body
  captured before JSON parse. Persists to `webhook_events`, acks in <2s,
  processes async.
- **External webhooks** (`POST /webhooks/{calendly,wix,meta-ad,form}`) — same
  pattern: persist raw, ack fast, process async.

All inbound goes to `webhook_events` first. Parsing failures don't lose data.

### 2. Persist

Single Supabase Postgres. 22 tables (see `schema.sql`). Conventions:

- All tables scoped by `workspace_id`
- `updated_at` triggers on mutable tables
- Soft delete via `deleted_at` where audit matters
- Denormalized `contacts.last_*` columns for fast segment queries
- `jsonb` for fluid shapes (metadata, payloads, filters)

### 3. Schedule

One scheduler. One tick (configurable, default 30s). Multiple workers:

- `reminders/runner` — drain due reminders
- `broadcasts/sender` — drain broadcast queue with Meta rate limiting
- `ai/worker` — drain AI job queue
- `integrations/wix/reconciler` — periodic Wix catch-up (every 5min)
- `suppression/expiry` — expire cooldown rows (every 60s)

Atomic claim pattern (`update ... where status='pending' returning *`) keeps
multi-replica deploys safe even though we run one process today.

### 4. Send

One function: `messages.send(input)`. Every outbound goes through it:
reminders, broadcasts, AI drafts (on approval), manual replies, flow steps
(when flows ship). Writes a queued `messages` row before any side effect,
flips status on result, retries once on 5xx/network errors.

## Subsystem map

```
                     workspaces + contacts + identities
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
         conversations          appointments          segments
              │                     │                     │
           messages             reminders            broadcasts
              │                                           │
              └──────────────► ai/policies ◄──────────────┘
                                    │
                                ai/jobs
                                    │
                              ai/drafts ──► messages.send()
```

Wix sync runs orthogonally, in/out of contacts + identities + tags.

## Build sequence

Six weeks of focused work, eight while coaching alongside.

| Phase | Week | Scope |
|---|---|---|
| 1 | 1 | Schema, contacts + identities, Wix one-way import, send path, inbox view |
| 2 | 2 | Calendly/Wix booking webhooks, reminders, appointments page |
| 3 | 2–3 | Segments, suppression, filter evaluator, segment builder UI |
| 4 | 3 | Broadcast composer, sender with rate limiting, recipient queue, stats |
| 5 | 4 | AI policies, ai_jobs worker, draft review UI |
| 6 | 4–5 | Two-way Wix sync (tag + unsubscribe write-back, full bidirectional) |
| 7 | 5–6 | Error tracking, deliverability dashboard, suppression-list UI, polish |

Flows come after this. v2 territory.

## Out of scope (v1)

- Group chats
- Coach assignments / multi-user workspace
- Inbox threaded notes (single `conversations.notes` text field is enough)
- Email channel (schema supports it; no implementation)
- SMS channel (same)
- Multi-CRM connector framework
- Native mobile app
- Audit log table (sync_events + webhook_events + updated_at cover it)
- Media proxying (URLs in payloads, no rehosting)
- Flow runner + flow builder UI

## Reference documents

- `schema.sql` — full Postgres schema, 22 tables, indexes, constraints
- `filter-dsl.md` — segment / AI policy / broadcast audience rule format
- `module-map.md` — codebase layout and dependency graph
- `wix-mapping.md` — Wix ↔ us field-by-field mapping, conflict resolution
