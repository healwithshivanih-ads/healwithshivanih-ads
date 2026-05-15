# TODOs — deferred work captured durably

Things we noted to come back to. Each entry: date noted, context, what to do.

## 🗓 Cal.com event types

### Add "Programme Closing Session" event type
**Noted:** 2026-05-15
**Context:** When slice (b) shipped, we routed 3 cal.com event types from the
booking button: Discovery Consultation (30min), Programme Intake Session
(60min), Coaching Session (30min). Programme Intro Call was dropped per
coach feedback.

**To do:**
1. Create a new Cal.com event type called something like "Programme Closing
   Session" or "Programme Wrap-up" — probably 60min, Zoom.
   - Suggested description: "Your final session — we'll review the 12-week
     retest labs, what shifted, what didn't, and decide if/what comes
     next in phase 2."
2. Add the slug to the routing logic in slice (b) — the booking button on
   the v2 client page should offer this type when:
     - Client's active plan is in week 11-12 (approaching plan_period_end)
     - OR plan has been published >12 weeks ago and no recheck yet
3. WhatsApp template `fm_appointment_booked` works as-is for this — no new
   template needed.

**Effort:** ~30 min once slice (b) is shipped and the routing pattern exists.

---

## 🧪 Other items as they come up

(Add new TODOs above this line. Format: ### Title, **Noted:** date, **Context:** + **To do:** + **Effort:** sections.)
