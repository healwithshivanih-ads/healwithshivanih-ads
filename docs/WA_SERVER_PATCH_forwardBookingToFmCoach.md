# WA-server-side patch — `forwardBookingToFmCoach()` (slice 2)

**Target repo:** `whatsapp-server-shivani` (the other chat).
**Goal:** after each cal.com event lands an `appointments` row, fire a signed POST to fm-coach so the dashboard's "📅 Upcoming bookings" widget lights up.

## Receiver

Already live: `POST https://intake.theochretree.com/api/cal-com-webhook`
Auth: `X-WhatsApp-Signature-256 = HMAC-SHA256(rawBody, FM_COACH_WEBHOOK_SECRET)`
(Same secret + header name as the existing `forwardInbound` pattern — no new env needed.)

## Payload contract

```json
{
  "type": "booking_created" | "booking_rescheduled" | "booking_cancelled",
  "booking": {
    "uid": "<cal.com uid — stable across reschedules>",
    "external_id": "cal_com:<uid>",
    "appointment_id": "<WA server appointments.id UUID>",
    "event_slug": "programme-intake-session",
    "event_title": "Programme Intake Session",
    "start_time": "ISO8601",
    "end_time": "ISO8601",
    "status": "confirmed" | "cancelled" | "rescheduled",
    "title": "Programme Intake Session between Shivani and …"
  },
  "attendee": {
    "email": "...",
    "phone": "...",
    "name":  "..."
  }
}
```

fm-coach matches the attendee independently against `~/fm-plans/clients/*/client.yaml` (`email`, then `mobile_number` last-10-digit). Unmatched → `~/fm-plans/_calcom_unmatched.yaml` for coach to review.

## New file: `src/services/forwarder/cal-com-forwarder.js`

```js
// Slice 2 of the cal.com integration: after the WA server processes a
// cal.com webhook (creates/updates appointments row, queues reminders),
// it forwards a resolved booking event to fm-coach so the coach
// dashboard can show upcoming sessions. Fire-and-forget; failures
// logged but never block reminder scheduling.

import { createHmac } from 'node:crypto';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

const TIMEOUT_MS = 5000;

/**
 * @param {object} args
 * @param {'booking_created'|'booking_rescheduled'|'booking_cancelled'} args.type
 * @param {object} args.payload  cal.com payload (post-handler)
 * @param {string} [args.appointmentId]  WA server appointments.id
 */
export async function forwardBookingToFmCoach({ type, payload, appointmentId }) {
  const url = config.fmCoachWebhook.url;
  const secret = config.fmCoachWebhook.secret;
  if (!url) return; // forwarder disabled

  const attendee = (payload.attendees && payload.attendees[0]) || {};
  const uid = String(payload.uid || payload.bookingId || payload.id || '');
  if (!uid) {
    logger.warn({ payload }, 'cal-com forwarder: no uid, skipping');
    return;
  }

  const body = {
    type,
    booking: {
      uid,
      external_id: `cal_com:${uid}`,
      appointment_id: appointmentId || null,
      event_slug: payload.type || payload.eventTypeSlug || null,
      event_title: payload.title || payload.eventTitle || null,
      start_time: payload.startTime || null,
      end_time: payload.endTime || null,
      status:
        type === 'booking_cancelled' ? 'cancelled' :
        type === 'booking_rescheduled' ? 'rescheduled' :
        'confirmed',
      title: payload.title || null,
    },
    attendee: {
      email: attendee.email || payload.responses?.email || null,
      phone: attendee.smsReminderNumber || attendee.phoneNumber || null,
      name: attendee.name || payload.responses?.name || null,
    },
  };

  const bodyStr = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    const sig = createHmac('sha256', secret).update(bodyStr).digest('hex');
    headers['X-Whatsapp-Signature-256'] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/cal-com-webhook`, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { status: res.status, uid, body: text.slice(0, 200) },
        'fm-coach booking forward returned non-2xx',
      );
    } else {
      logger.info({ uid, type }, 'fm-coach booking forwarded');
    }
  } catch (err) {
    logger.warn({ err: err.message, uid }, 'fm-coach booking forward failed');
  } finally {
    clearTimeout(timer);
  }
}
```

**Note on the URL:** `config.fmCoachWebhook.url` already points at `https://intake.theochretree.com` (used by `forwardInbound`). The forwarder above appends `/api/cal-com-webhook` to that base. If `config.fmCoachWebhook.url` already includes a path (e.g. `…/api/whatsapp-webhook`), strip the path first or expose a `config.fmCoachWebhook.baseUrl` to avoid double-pathing.

## Wire into `src/routes/webhooks/cal-com.js`

```diff
 import { matchContact } from '../../services/contacts/matcher.js';
 import * as appointments from '../../services/appointments/index.js';
 import * as tagsSvc from '../../services/contacts/tags.js';
+import { forwardBookingToFmCoach } from '../../services/forwarder/cal-com-forwarder.js';

 // …

 async function handleBookingCreated(payload) {
   // … existing logic that resolves contact, creates appointment …

-  await appointments.create({
+  const appt = await appointments.create({
     workspaceId: ws.id,
     contactId: contact.id,
     // …
   });
+
+  // Slice 2: forward to fm-coach so the dashboard can show "Upcoming".
+  forwardBookingToFmCoach({
+    type: 'booking_created',
+    payload,
+    appointmentId: appt?.id,
+  }).catch((err) =>
+    logger.warn({ err: err.message }, 'forwardBookingToFmCoach failed (booking_created)'),
+  );
 }

 async function handleBookingRescheduled(payload) {
   // … existing reschedule logic …

+  forwardBookingToFmCoach({
+    type: 'booking_rescheduled',
+    payload,
+    appointmentId: row?.id,
+  }).catch((err) =>
+    logger.warn({ err: err.message }, 'forwardBookingToFmCoach failed (booking_rescheduled)'),
+  );
 }

 async function handleBookingCancelled(payload) {
   // … existing cancel logic …

+  forwardBookingToFmCoach({
+    type: 'booking_cancelled',
+    payload,
+    appointmentId: row?.id,
+  }).catch((err) =>
+    logger.warn({ err: err.message }, 'forwardBookingToFmCoach failed (booking_cancelled)'),
+  );
 }
```

## Smoke test (after deploy)

From the WA server's Fly machine:

```bash
flyctl ssh console -a whatsapp-server-shivani -C 'node -e "
const { forwardBookingToFmCoach } = await import(\"/app/src/services/forwarder/cal-com-forwarder.js\");
await forwardBookingToFmCoach({
  type: \"booking_created\",
  payload: {
    uid: \"smoke-fwd-\" + Date.now(),
    title: \"Programme Intake Session between Shivani and Test\",
    type: \"programme-intake-session\",
    startTime: new Date(Date.now() + 24*60*60*1000).toISOString(),
    endTime:   new Date(Date.now() + 25*60*60*1000).toISOString(),
    attendees: [{ email: \"sudarshankarnad@gmail.com\", name: \"Sudarshan\" }],
  },
  appointmentId: null,
});"'
```

Then check on the FM coach side:
- `~/fm-plans/_calcom_bookings.yaml` should have a row under `cl-008`
- `/dashboard-v2` "📅 Upcoming bookings" panel should show the row

If `matched: false` returns instead, check the attendee email / phone match against the corresponding `client.yaml` field on FM coach.

## What's NOT in this patch

- Backfilling existing `appointments` rows into fm-coach. Not needed if coach only cares about new bookings going forward. If we want history, write a one-shot script on the WA server that iterates `appointments` and POSTs each via `forwardBookingToFmCoach`.
- A retry on forward failure. The raw event is already in `webhook_events` on the WA server, so manual replay is possible. Auto-retry would need a separate queue.
