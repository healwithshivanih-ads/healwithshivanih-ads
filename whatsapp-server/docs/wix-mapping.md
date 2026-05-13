# Wix Field Mapping

Status: locked, v0.1

Wix is the system of record for contacts. We sync bidirectionally (phased).
This doc defines every field mapping and conflict rule.

## 1. The Wix data model

### Standard fields (every Wix contact)
- Name: first + last (two fields)
- Primary email + subscription status
- Primary phone: type tag, country code, number, subscription status
- Address: type, street, street 2, city, zip, country
- Labels (e.g. "Lions gate portal.csv")
- Assignee

### Custom fields (current)
- `ExtraPhone`, `OtherPhone`
- `CompanySize`
- `CountryCode` (text, max 200)
- `VatId` (max 100)
- `Notes` (max 220)
- `RegisteredOn` (date)
- `RequestedSpokenLanguage` (max 200)

### Wix internals (via API)
- Contact ID (UUID)
- `_createdDate`, `_updatedDate`
- Source (where the contact came from in Wix's system)
- Per-channel subscription state (email, SMS, phone)

## 2. Wix → us

General principle: **standard Wix fields become typed columns; custom fields
become `metadata` jsonb**. Promote a custom field to a column only when we
filter/sort on it regularly.

| Wix field | Our destination | Notes |
|---|---|---|
| `_id` | `contact_identities (channel='wix', external_id=<wix_id>)` | Join key. |
| `name.first` + `name.last` | `contacts.display_name` (joined) | If only one set, use that. |
| `primaryEmail.email` | `contacts.primary_email` + `contact_identities (channel='email')` | Identity row mirrors subscription_status. |
| `primaryPhone.phone` | `contacts.primary_phone` + `contact_identities (channel='whatsapp')` | E.164-without-plus. |
| `primaryPhone.countryCode` | Derived; used to normalize phone | Not stored separately. |
| `address.city` | `contacts.city` | |
| `address.country` | `contacts.country` | ISO-2 code. |
| `address.*` (street, zip) | `contacts.metadata.address` (jsonb) | Not filterable. |
| `labels[]` | `tags` + `contact_tags` | Each Wix label becomes a tag with `wix_label_id` set. |
| `customFields.RequestedSpokenLanguage` | `contacts.locale` (via lookup) | Original stored in metadata. |
| `customFields.RegisteredOn` | `contacts.metadata.registered_on` + seeds `contacts.created_at` | Filterable via `field_equals`. |
| `customFields.Notes` | `contacts.metadata.notes_wix` | Separate from `notes_local` for provenance. |
| `customFields.ExtraPhone`, `OtherPhone` | Additional `contact_identities` rows | `is_primary=false`. |
| `customFields.CompanySize`, `VatId`, `CountryCode` | `contacts.metadata.*` | Not promoted. |
| `_createdDate` | `contacts.created_at` (on first import only) | Subsequent updates don't touch. |
| `_updatedDate` | `contact_identities.last_synced_at` reference | Used for catch-up scans. |
| Source field | `contacts.opt_in_source` (mapped) | E.g. "Form Submission" → `"website_form"`. |
| `primaryEmail.subscriptionStatus` | `contact_identities (channel='email').subscription_status` | |
| `primaryPhone.subscriptionStatus` | `contact_identities (channel='whatsapp').subscription_status` | Drives WhatsApp opt-in. |

### Subscription status normalization

| Wix | Ours |
|---|---|
| `subscribed` | `subscribed` |
| `unsubscribed` | `unsubscribed` |
| `notSet` | `never_subscribed` |
| `pending` | `unknown` |

### Locale mapping

| Wix RequestedSpokenLanguage | `contacts.locale` |
|---|---|
| `English` | `en-IN` |
| `Hindi` | `hi-IN` |
| `Marathi` | `mr-IN` |
| `Gujarati` | `gu-IN` |
| (default) | `en-IN` |

Original Wix value preserved in `contacts.metadata.requested_spoken_language`.

## 3. Us → Wix

| Our field | Wix destination | Phase |
|---|---|---|
| `contacts.display_name` (split first/last) | `name.first`, `name.last` | 3 |
| `contacts.primary_email` | `primaryEmail.email` | 3 |
| `contacts.primary_phone` | `primaryPhone.phone` | 3 |
| **tags added/removed locally** | `labels[]` add/remove | **2 — highest-value write-back** |
| `contacts.metadata.notes_local` | `customFields.Notes` (appended) | 3 |
| `contact_identities.subscription_status='unsubscribed'` | `primaryPhone.subscriptionStatus='unsubscribed'` | **2 — critical for compliance** |

### What we never push to Wix
- Messages, conversations
- Appointments (Calendly/Wix have their own truth)
- AI drafts, broadcasts, segments
- `metadata.*` blob beyond the explicit mapped fields

## 4. Identity matching

```
matchContact(workspace_id, candidate):
  1. If candidate has wix_id:
       Look up (channel='wix', external_id=wix_id) → return if found
  
  2. If candidate has phone:
       Normalize to E.164-without-plus
       Look up (channel='whatsapp', external_id=phone) → return if found
  
  3. If candidate has email:
       Look up (channel='email', external_id=email) → return if found
  
  4. New person:
       Create contact + identities for everything we have
       Return new contact
```

### Edge cases

**Phone matches contact A, email matches contact B.**
Don't merge automatically. Log a `sync_event` with `operation='merge_candidate'`.
Surface in UI. Coach decides.

**Wix contact changed phone.**
Find contact by wix_id. Update identity row. Keep old phone as secondary
identity (`is_primary=false`). Inbound from old number still routes correctly.

**Same Wix contact, two phones in custom fields.**
Each phone becomes its own identity row, all pointing to the same contact.
`primaryPhone` gets `is_primary=true`; extras get `is_primary=false`.

## 5. Two-way sync — loop prevention

The loop problem: we push a tag to Wix → Wix's webhook tells us "contact
updated" → we'd push the same change back.

**Solution: version-stamped writes.**

```
When we write to Wix:
  sync_version = current_value + 1
  store sync_version locally BEFORE the write
  include in Wix custom field or use Wix's revision number

When Wix's webhook arrives:
  read sync_version from payload
  if sync_version <= our local sync_version:
    ignore (this is our own write echoing back)
  else:
    process normally, update local sync_version
```

**Fallback** (if Wix doesn't expose a write-back field): time-windowing.
Ignore inbound webhooks for a contact within 60 seconds of a local write.
Less perfect, works.

## 6. Reconciler — catching up after downtime

The webhook stream is best-effort. If our server is down or Wix's delivery
fails, we miss events. The reconciler is the safety net.

```
Every 5 minutes:
  last_sync = integrations.last_incremental_sync_at
  page through Wix Contacts API where _updatedDate > last_sync
  for each contact:
    run normal inbound sync logic
  update last_incremental_sync_at = now()
```

Plus a manual "Full sync" button in the integrations settings page for when
things visibly drift.

## 7. Conflict resolution

When Wix and us disagree on the same field:

**Default rule: last-write-wins, per field.**
Every field has an implicit timestamp (Wix `_updatedDate`, our `updated_at`).
Newer wins.

### Field-specific overrides

| Field | Rule | Why |
|---|---|---|
| WhatsApp `subscription_status` | **Our side wins** | We see STOP keywords; Wix doesn't. |
| Email `subscription_status` | **Wix wins** | Wix handles email centrally. |
| `display_name` | Last-write-wins | Either side might have better version. |
| `tags`/`labels` | **Union, never delete on conflict** | Adds are safe; deletes require explicit action. |
| `metadata.notes_local` vs `notes_wix` | Separate keys, no merge | Provenance preserved. |
| `appointments` | Wix wins (read-only from us) | Wix Bookings authoritative when source=wix. |

## 8. Phased rollout

**Phase 1 (week 1)** — Wix → us, one-way.
- Inbound webhook: contact create/update/delete
- Reconciler job: hourly catch-up
- CSV import (same matcher)
- No write-back

**Phase 2 (week 4)** — Tag write-back + unsubscribe write-back.
- Coach adds/removes tag → pushed to Wix as label
- Contact STOPs us → Wix subscription marked unsubscribed
- Narrow surface area, high value

**Phase 3 (week 5)** — Full bidirectional.
- Name, custom field updates, all per the mapping table
- Conflict resolution active

## 9. Out of scope

- Wix Bookings appointments via this sync (Calendly is authoritative; separate
  `integrations/wix/bookings.js` if needed later)
- Wix CRM Tasks / Activities (we have our own conversations)
- Wix Members → our users (single-user system)
- Bulk delete propagation (soft delete locally never propagates as hard delete)

## 10. Wix API surface

**Track:** Wix Headless / REST API (older, simpler, well-documented).

**Endpoints:**
- `GET /contacts/v4/contacts` — list/page (reconciler)
- `GET /contacts/v4/contacts/{id}` — fetch one
- `PATCH /contacts/v4/contacts/{id}` — update
- `POST /contacts/v4/contacts` — create
- `POST /contacts/v4/contacts/{id}/labels` — add label
- `DELETE /contacts/v4/contacts/{id}/labels/{label-id}` — remove label

**Webhook subscriptions:** contact created, updated, deleted, label added,
label removed.

**Auth:** API key (workspace-scoped). Stored encrypted in
`integrations.credentials_encrypted`.
