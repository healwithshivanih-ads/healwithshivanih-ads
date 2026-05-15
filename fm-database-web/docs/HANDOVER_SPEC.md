# 2-stage handover from ochre-followup → fm-coach

Specification for the funnel-to-clinical handover. fm-coach implements
the receiving side (this repo, Phase 2 build). ochre-followup needs the
two POST calls described below.

## Boundary

| Stage | When | Owner |
|---|---|---|
| Lead capture (Wix / Meta ads / IG) | — | **ochre-followup** |
| Discovery call booking + confirmation reminders | — | **ochre-followup** |
| Discovery call completed | **Stage 1 handover** | both — ochre still markets, fm-coach holds data |
| Programme upsell (post-discovery follow-ups, payment links, drip) | until paid | **ochre-followup** |
| Razorpay programme payment success | **Stage 2 handover** | **fm-coach takes over** |
| Intake form, plan generation, coaching sessions, weekly motivation | post-signup | **fm-coach** |

After Stage 2, ochre-followup MUST stop ALL outbound activity on the
client. fm-coach is sole owner.

## Shared secret

Generate once. Store on both apps:
- `HANDOVER_SECRET` — long random string (e.g., `openssl rand -hex 32`)
- ochre-followup also stores: `FM_COACH_HANDOVER_URL=https://<public-fm-coach-host>/api/handover`

## HMAC signing

Every POST body must be signed:
```
signature_hex = HMAC-SHA256(HANDOVER_SECRET, raw_body)
x-handover-signature: sha256=<signature_hex>
```

fm-coach verifies using constant-time comparison. Mismatched signature → 401.

## Stage 1 — Discovery call completed

### Request

```http
POST /api/handover/discovery-complete
Content-Type: application/json
x-handover-signature: sha256=<hex>

{
  "source": "ochre-followup",
  "discovery_completed_at": "2026-05-15T11:00:00Z",
  "discovery_call_notes": "Free-form notes from the discovery call. Optional.",
  "wix_member_id": "optional-wix-id",
  "client": {
    "display_name": "Asha Mehta",
    "email": "asha@example.com",
    "phone_e164": "919876543210"
  }
}
```

### Behaviour

fm-coach:
1. Match by phone AND email. Both must agree to merge with an existing client.
   - If only phone matches OR only email matches but the other differs →
     returns `409 phone_email_conflict`. ochre should alert the coach;
     do NOT retry.
2. If no match → creates a fresh `cl-NNN` client.yaml in
   `lifecycle_state: prospect`.
3. If matched → updates the existing client's `discovery_completed_at`
   and appends to `discovery_call_notes`.
4. **Takes no outbound action.** No intake form, no reminders, no Cal.com
   processing — `lifecycle_state: prospect` gates everything off.

### Responses

```json
200 { "ok": true, "client_id": "cl-007", "is_new_client": true }
200 { "ok": true, "client_id": "cl-003", "is_new_client": false }
409 { "ok": false, "code": "phone_email_conflict", "error": "..." }
400 { "ok": false, "error": "...", "code": "bad_payload" }
401 { "ok": false, "error": "signature_mismatch" }
500 { "ok": false, "error": "..." }
```

### ochre-followup retry policy
- 4xx → do NOT retry (the data is bad — alert coach, log)
- 5xx or network failure → retry with exponential backoff, up to 5 attempts over 30 min
- Final failure → alert coach + keep client in pre-handover state

## Stage 2 — Programme payment success

### Request

```http
POST /api/handover/programme-signup
Content-Type: application/json
x-handover-signature: sha256=<hex>

{
  "source": "ochre-followup",
  "razorpay_payment_id": "pay_xxxxxxxxxxx",
  "razorpay_order_id": "order_xxxxxxxxx",
  "paid_at": "2026-05-15T11:43:00Z",
  "amount_paisa": 199900,
  "programme_slug": "fm-12wk",
  "client": {
    "display_name": "Asha Mehta",
    "email": "asha@example.com",
    "phone_e164": "919876543210"
  }
}
```

### Behaviour

fm-coach:
1. Match by phone + email (same rule as Stage 1).
2. **Requires a Stage-1 prospect record to exist first.** If no match
   found → returns `409 no_prospect_found` with instruction to fire
   discovery-complete first. ochre should fire discovery-complete
   synthetically (with empty notes) for clients who paid without going
   through a Discovery call. ochre then immediately fires programme-signup.
3. Idempotency: same `razorpay_payment_id` for an already-handed-over
   client → returns `200 ok=true, already_handed_over=true`. Safe to retry.
4. Flips `lifecycle_state: prospect → programme_active`.
5. Stamps `programme_started_at` (= paid_at) and `programme_payment_id`.
6. Fires onboarding kit (best-effort, partial failure doesn't fail the handover):
   - Generates intake token (30-day TTL)
   - Sends `fm_programme_welcome` WhatsApp template with intake URL + Cal.com Programme Intake Session URL
   - Writes a `quick_note` session tagged `[source: handover_programme_signup]`

### Responses

```json
200 { "ok": true, "client_id": "cl-007", "is_new_client": false }
200 { "ok": true, "client_id": "cl-007", "already_handed_over": true }
409 { "ok": false, "code": "no_prospect_found", "error": "..." }
409 { "ok": false, "code": "phone_email_conflict", "error": "..." }
400 { "ok": false, "error": "...", "code": "bad_payload" }
401 { "ok": false, "error": "signature_mismatch" }
```

### ochre-followup behaviour after a successful Stage 2

In ochre-followup's database, mark the client:
- `handed_over_at = NOW()`
- `fm_coach_client_id = <client_id from response>`

Every outbound action (cron, AiSensy drip, Cal.com webhook handler,
Wix sync, email drip) must add `WHERE handed_over_at IS NULL`:

```sql
-- example: appointment reminder cron
SELECT * FROM clients
WHERE next_appointment_at < NOW() + INTERVAL '24 hours'
  AND handed_over_at IS NULL    -- ← new
  AND NOT reminded_24h;
```

This applies to (at minimum, based on ochre's secrets):
- AISENSY_APPT_REMINDER_CAMP cron
- AISENSY_BOOK_NEXT_CAMP cron
- AISENSY_W0_CAMP / AISENSY_A3_CAMP / AISENSY_B2_CAMP / AISENSY_D2_CAMP — every drip campaign
- Razorpay payment-link follow-up reminders
- Cal.com webhook handler (when a handed-over client books a Coaching Session via Cal.com, ochre should ignore — fm-coach will pick it up via its own Cal.com webhook, added in Phase 3)
- Wix → AiSensy sync (the new-lead-detected job)

## Phone + email normalisation

- `phone_e164`: digits only, no `+`. E.164-formatted (country code prefix included). Indian mobiles: starts with `91` then 10 digits. fm-coach normalises by stripping non-digits before matching.
- `email`: trimmed, lowercased, before matching.

## Edge cases

| Case | Behaviour |
|---|---|
| ochre fires Stage 2 without Stage 1 first | fm-coach returns 409 no_prospect_found. ochre should fire Stage 1 first, then retry Stage 2. |
| Same payment ID hits Stage 2 twice (retry after first success) | Idempotent — second call returns 200 with `already_handed_over: true`. |
| Phone matches existing client but email differs | 409 phone_email_conflict. Coach investigates manually. |
| Discovery booked but client never paid | Prospect record stays in fm-coach forever (no harm — it's not in active lists). Periodic sweep could delete prospects older than 90 days if desired. |
| Client paid for programme but never had a Discovery (direct upsell) | ochre fires Stage 1 first (synthetic, with `discovery_completed_at = paid_at` and empty notes), then Stage 2 immediately. |
| WhatsApp template fails (Meta API down) | Handover still succeeds (200 OK). Coach sees the `onboarding_partial_failures` field and manually re-sends via existing "Send intake form" button. |
| fm-coach is down at Stage 2 time | ochre keeps retrying (5× over 30 min). Final failure → alert coach. Client temporarily stays in pre-handover state; ochre keeps marketing them (which is fine — they paid, so the next AiSensy drip after fm-coach recovers will be incorrect but not destructive). |

## Manual smoke test (during dev)

fm-coach exposes a coach-only test route:

```bash
curl -X POST $APP_URL/api/handover/test \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{
    "display_name": "Test Handover",
    "email": "test-handover@example.com",
    "phone_e164": "919999999999"
  }'
```

This bypasses HMAC verification (auth via cron secret instead) and runs
both stages back-to-back against a synthetic client. Use to verify the
flow end-to-end before ochre wires up its half.

## Open items (won't block Phase 2)

- `fm_programme_welcome` WhatsApp template needs Meta approval. Drafted in
  `docs/whatsapp-templates.md`. Until approved, Stage 2 will return 200
  but the WhatsApp send will land in `onboarding_partial_failures`.
- ochre-followup needs HANDOVER_SECRET added to Fly secrets and the two
  POST calls wired in. Coach (or whoever maintains ochre) applies the
  changes documented above.
