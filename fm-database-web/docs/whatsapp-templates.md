# Meta WhatsApp template drafts

Templates needed by fm-coach for outbound messages. Submit via the
WhatsApp Business Manager (or the whatsapp-server-shivani Fly app's
template-management UI). Once approved, they become callable by name
through `sendWhatsAppAction(phone, name, [params])`.

Each template should be **Category: UTILITY**, **Language: English (en)**.
Body parameters are positional `{{1}} {{2}} {{3}}` — Meta validates that
every param has a default example.

---

## ✅ Slice (a) — Questionnaire / intake

### `fm_intake_reminder`

Daily cron-triggered nudge to clients with an open intake link who
haven't submitted yet.

**Body:**

```
Hi {{1}}, just a gentle nudge — your intake form is still open and helps me prepare the best plan for our session. The link is valid until {{2}}: {{3}}

Your progress saves automatically, so you can pause and come back any time.

Warmly, Shivani
```

**Params:**
- `{{1}}` — Client first name (example: `Asha`)
- `{{2}}` — Expiry date short label (example: `28 May`)
- `{{3}}` — Intake URL (example: `https://app.healwithshivanih.com/intake/abc123`)

**Footer (optional):** `Reply STOP to opt out.`

---

### `fm_programme_welcome`

Auto-sent when ochre-followup hands over a paying client to fm-coach.
Combines the intake form + Cal.com Programme Intake Session booking
link in one message.

**Body:**

```
Hi {{1}}, welcome to the programme — really glad to have you. Two short things before our first session:

1. Fill the intake form (~25 min, saves as you go): {{2}}
2. Book your 60-min Programme Intake Session: {{3}}

I'll review everything once both are done and send you next steps. Looking forward to working together.

Shivani
```

**Params:**
- `{{1}}` — Client first name (example: `Asha`)
- `{{2}}` — Intake form URL (example: `https://app.healwithshivanih.com/intake/abc123`)
- `{{3}}` — Cal.com Programme Intake Session URL (example: `https://cal.com/shivani-hariharan-0xyy3l/programme-intake-session`)

**Category:** UTILITY (transactional onboarding — not marketing).

---

## ⏳ Slice (b) — Cal.com appointment scheduling (drafts — submit when ready)

### `fm_appointment_booked`

Sent immediately when a Cal.com webhook confirms a booking.

**Body:**

```
Hi {{1}}, your session is confirmed for {{2}}. Add to your calendar here: {{3}}

If anything changes, you can reschedule or cancel from the same link.

See you soon,
Shivani
```

**Params:**
- `{{1}}` — Client first name
- `{{2}}` — Date + time (example: `Tuesday 28 May at 4:00 PM IST`)
- `{{3}}` — Cal.com management URL


### `fm_appointment_reminder_24h`

Cron-fired 24h before a confirmed appointment.

**Body:**

```
Hi {{1}}, gentle reminder — our session is tomorrow at {{2}}. Join here: {{3}}

If you've thought of anything you want to flag before we speak, feel free to message it through. Otherwise see you then.

Shivani
```

**Params:**
- `{{1}}` — Client first name
- `{{2}}` — Time short label (example: `4:00 PM IST`)
- `{{3}}` — Meeting link (Zoom/Meet/Cal.com landing)


### `fm_appointment_reminder_2h`

Cron-fired 2h before a confirmed appointment.

**Body:**

```
Hi {{1}}, see you in 2 hours. Here's the link: {{2}}

Have a glass of water + step outside for a few minutes of sun before we start — clearer signal for a focused session.

Shivani
```

**Params:**
- `{{1}}` — Client first name
- `{{2}}` — Meeting link

---

## ⏳ Slice (c) — Weekly motivational (draft — submit when ready)

### `fm_weekly_motivation`

Link-based template — the actual reflection text lives at a coach-domain
URL so we never need to re-approve the template when the message
content changes. Each week the system generates a tokenised
`/reflect/<token>` page with the week's reflection + a 1-question
response form (whose reply lands as a `quick_note` session).

**Body:**

```
Hi {{1}}, your week-{{2}} reflection from your plan is here: {{3}}

A short read — 90 seconds. There's a one-line "how are you feeling" question at the bottom. Tap to send back so I can adjust the plan if needed.

Shivani
```

**Params:**
- `{{1}}` — Client first name
- `{{2}}` — Week number (example: `4`)
- `{{3}}` — Reflection URL (example: `https://app.healwithshivanih.com/reflect/xyz789`)

---

## Submission checklist

1. Open WhatsApp Business Manager → Account Tools → Message Templates
2. Click "Create Template" → Category UTILITY → English (en)
3. Paste the body verbatim
4. Add the example values for each `{{N}}` placeholder (Meta enforces this)
5. Submit — approval typically takes 24-48h
6. Once approved, no app code changes needed — `sendWhatsAppAction(phone, "fm_intake_reminder", [...])` will work

If a template gets rejected, common reasons:
- Promotional language → reclassify as MARKETING (not what we want)
- Links to a domain not verified in WhatsApp Business → add the domain
  under "Verified Domains" first
- Generic / placeholder-only body → add more specific copy before params
