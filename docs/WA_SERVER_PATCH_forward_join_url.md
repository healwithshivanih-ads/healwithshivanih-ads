# WA-server patch — forward `location` + `join_url` in slice-2 booking events

**Target repo:** `whatsapp-server-shivani` (the other chat).
**Purpose:** so fm-coach can render a "Join call →" button on the Upcoming Bookings panel + the per-client Bookings panel. Without these fields, slice-2 forwards arrive with no meeting URL and fm-coach falls back to a "(no join link)" state.

## Receiver shape (fm-coach side, already deployed)

```ts
interface SliceTwoPayload {
  type: "booking_created" | "booking_rescheduled" | "booking_cancelled";
  booking: {
    uid: string;
    external_id?: string;
    appointment_id?: string;
    event_slug?: string;
    event_title?: string;
    start_time?: string;
    end_time?: string;
    status?: string;
    title?: string;
    location?: string | null;   // ← NEW (e.g. "Zoom" / "Daily" / "In person")
    join_url?: string | null;   // ← NEW (direct meeting URL when video)
  };
  attendee: { email?: string; phone?: string; name?: string };
}
```

Both fields are optional — fm-coach renders the row regardless, just without the Join button if `join_url` is null.

## Patch — `src/services/forwarder/cal-com-forwarder.js`

The existing `forwardBookingToFmCoach()` builds the `booking` object from the cal.com `payload`. Add two lines:

```diff
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
+      location: location || null,
+      join_url: joinUrl || null,
     },
     attendee: {
       email: attendee.email || payload.responses?.email || null,
       phone: attendee.smsReminderNumber || attendee.phoneNumber || null,
       name: attendee.name || payload.responses?.name || null,
     },
   };
```

Add the helper near the top of the file (mirrors the `pickLocation` already in `src/routes/webhooks/cal-com.js`):

```js
function pickLocationForForward(payload) {
  const loc = payload.location;
  const fallbackUrl = payload.meetingUrl || payload?.metadata?.videoCallUrl || null;
  if (!loc) return { location: null, joinUrl: fallbackUrl };
  if (typeof loc === 'string') {
    const isUrl = /^https?:\/\//i.test(loc);
    return isUrl
      ? { location: 'video', joinUrl: loc }
      : { location: loc, joinUrl: fallbackUrl };
  }
  if (typeof loc === 'object') {
    return {
      location: loc.type || loc.name || null,
      joinUrl: loc.link || loc.url || loc.address || fallbackUrl,
    };
  }
  return { location: null, joinUrl: fallbackUrl };
}
```

Then in `forwardBookingToFmCoach`:

```diff
 export async function forwardBookingToFmCoach({ type, payload, appointmentId }) {
   // …
+  const { location, joinUrl } = pickLocationForForward(payload);
   const body = { /* … as above … */ };
```

## Smoke test (post-deploy)

From WA server inside Fly:

```bash
flyctl ssh console -a whatsapp-server-shivani -C 'node -e "
const { forwardBookingToFmCoach } = await import(\"/app/src/services/forwarder/cal-com-forwarder.js\");
await forwardBookingToFmCoach({
  type: \"booking_created\",
  payload: {
    uid: \"join-url-smoke-\" + Date.now(),
    title: \"Coaching Session\",
    type: \"coaching-session\",
    startTime: new Date(Date.now() + 2*60*60*1000).toISOString(),
    endTime:   new Date(Date.now() + 2.5*60*60*1000).toISOString(),
    attendees: [{ email: \"sudarshankarnad@gmail.com\", name: \"Sudarshan\" }],
    location: { type: \"integrations:zoom\", link: \"https://zoom.us/j/123456\" },
  },
  appointmentId: null,
});"'
```

Then on fm-coach:

```bash
grep -B1 -A12 'join-url-smoke-' ~/fm-plans/_calcom_bookings.yaml
```

Should show `join_url: https://zoom.us/j/123456` + `location: integrations:zoom`. Dashboard's Upcoming panel should render the "Join →" button on this row.

## Why not just add to `_calcom_bookings.yaml` manually?

Direct cal.com → fm-coach (parallel subscriber, currently the live path) already does `pickLocation()` on the fm-coach side and stores both fields. Only slice-2 forwards from WA server need this patch. Once Fly→Tailscale Funnel TLS is fixed (or whenever you want to use slice-2 again), this patch ensures both pipes produce equivalent data.
