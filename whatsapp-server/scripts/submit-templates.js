#!/usr/bin/env node
// scripts/submit-templates.js
//
// Submit WhatsApp Cloud API message templates to Meta for review.
//
// Usage:
//   node scripts/submit-templates.js                    # submit all templates
//   node scripts/submit-templates.js appt_confirmation  # submit specific ones by name
//   node scripts/submit-templates.js --list             # list local template definitions
//   node scripts/submit-templates.js --check            # fetch live status from Meta
//
// Reads WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID from .env.
//
// To add a template: append to the TEMPLATES array below. Re-run the script.
// Already-submitted names skip with a notice (Meta rejects duplicates).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GRAPH_VERSION = 'v21.0';

// ---------------------------------------------------------------------------
// Template definitions. Edit/add here.
// ---------------------------------------------------------------------------
const TEMPLATES = [
  // ── Appointment templates (existing on WABA) ───────────────────────────────
  {
    name: 'appt_confirmation',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}! Your {{4}} session is confirmed for {{2}} at {{3}}. Looking forward to our session. — Shivani',
    example: [['Priya', '15 May 2026', '5:00 PM', 'Cortisol Reset']],
  },
  {
    name: 'appt_reminder_24h',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, just a quick reminder — your {{4}} session is tomorrow ({{2}}) at {{3}}. See you then! — Shivani',
    example: [['Priya', '15 May 2026', '5:00 PM', 'Cortisol Reset']],
  },
  {
    // Coach-facing alert — fires to COACH_NOTIFY_PHONE on every cal.com
    // booking event (created / rescheduled / cancelled). {{1}} carries the
    // event headline so one template covers all three.
    name: 'coach_booking_alert_v1',
    category: 'UTILITY',
    language: 'en',
    // Body must not start/end with a variable, and needs enough literal
    // text relative to its 5 variables (Meta "words ratio" rule).
    body: 'Hi Shivani, a Cal.com booking update just came in — {{1}}. The client is {{2}}, for a {{3}} session scheduled on {{4}} at {{5}}. Please check your calendar to confirm the details.',
    example: [['new booking', 'Priya Sharma', 'Coaching Session', '19 May 2026', '3:30 PM']],
  },
  {
    name: 'appt_reminder_2h',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, your {{4}} session is in 2 hours — at {{3}} today. See you soon! — Shivani',
    example: [['Priya', '15 May 2026', '5:00 PM', 'Cortisol Reset']],
  },

  // ── FM coach manual templates (Message Templates panel on client page) ─────
  {
    name: 'fm_lab_reminder',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}}, a gentle reminder to get your labs done before our next session. Here are the tests we discussed: {{2}}. Please share the report at least 2 days before our appointment. 🙏\n\n— Shivani Hari\nYour Functional Health Coach',
    example: [['Priya', 'TSH, Vitamin D, Ferritin']],
  },
  {
    name: 'fm_supplement_instructions',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}}, here are your supplement instructions for this week: {{2}}. Take them as discussed and note any changes. Feel free to message if you have questions! 💊\n\n— Shivani Hari\nYour Functional Health Coach',
    example: [['Priya', 'Magnesium glycinate 200mg before bed; B-complex with breakfast']],
  },
  {
    name: 'fm_session_confirm',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}}, confirming our session on {{2}} at {{3}}. Please come prepared with your food journal and any new lab reports. See you then! 📋\n\n— Shivani Hari\nYour Functional Health Coach',
    example: [['Priya', '15 May 2026', '5:00 PM']],
  },
  {
    name: 'fm_encouragement',
    // Meta auto-reclassified UTILITY → MARKETING at original approval (the
    // "Rooting for you!" framing reads as engagement, not transactional).
    // Local definition kept in sync to avoid category-mismatch errors on
    // future edits. Cost implication: marketing rate (~₹0.78/msg) vs utility
    // rate (~₹0.115/msg). Used sparingly so this is fine.
    category: 'MARKETING',
    language: 'en',
    body:
      "Hi {{1}}, you're doing great! Healing takes time and consistency — be patient with yourself. Keep going with {{2}}. Rooting for you! 💚\n\n— Shivani Hari\nYour Functional Health Coach",
    example: [['Priya', 'your morning routine and consistent sleep']],
  },
  {
    name: 'fm_checkin_nudge',
    // Meta auto-reclassified UTILITY → MARKETING at original approval
    // ("just checking in" = engagement, not transactional). Same as
    // fm_encouragement — cost is ~₹0.78/msg when sent.
    category: 'MARKETING',
    language: 'en',
    body:
      'Hi {{1}}, just checking in! How are you feeling on the protocol? Any changes in {{2}}? Would love to hear how things are going. 🌿\n\n— Shivani Hari\nYour Functional Health Coach',
    example: [['Priya', 'energy or digestion']],
  },

  // ── FM coach automated templates (cron / dashboard) ────────────────────────
  {
    // Programme welcome — auto-sent by /api/handover/programme-signup the
    // moment ochre-followup confirms a paid programme signup. Combines the
    // intake-form link + the Cal.com Programme Intake Session booking link
    // in one welcome so the client only gets one message, not two.
    name: 'fm_programme_welcome',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}}, welcome to the programme — really glad to have you. Two short things before our first session:\n\n" +
      "1. Fill the intake form (~25 min, saves as you go): {{2}}\n" +
      "2. Book your 60-min Programme Intake Session: {{3}}\n\n" +
      "I'll review everything once both are done and send you next steps. Looking forward to working together.\n\n" +
      "Shivani",
    example: [['Asha', 'https://app.healwithshivanih.com/intake/abc123', 'https://cal.com/shivani-hariharan-0xyy3l/programme-intake-session']],
  },
  {
    // Sunday motivational cron (slice c). Link-based on purpose: the
    // reflection text + the 1-question response form live on a dynamic
    // /reflect/<token> page so the template body never needs to be
    // re-approved when the weekly content changes. Replies on the page
    // become quick_note sessions on the client.
    name: 'fm_weekly_motivation',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}}, your week-{{2}} reflection from your plan is here: {{3}}\n\n' +
      'A short read — 90 seconds. There\'s a one-line "how are you feeling" question at the bottom. Tap to send back so I can adjust the plan if needed.\n\n' +
      'Shivani',
    example: [['Asha', '3', 'https://app.healwithshivanih.com/reflect/xyz789']],
  },
  {
    // First-touch intake invite. Sent when coach clicks "Send intake form" on
    // the v2 client overview. Replaces the wa.me click-to-chat fallback so
    // the send goes via Meta Cloud API (one tap from dashboard, no manual
    // step on the coach's phone). Body mirrors the warm/personal copy from
    // SendIntakeFormButton.buildWhatsappLink() so the recipient experience
    // matches the previous flow.
    name: 'fm_intake_invite',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}}, please fill in this intake form before our session — it takes about 25 minutes and helps me prepare the best plan for you.\n\n{{2}}\n\nYour progress saves automatically, so feel free to pause and come back. Looking forward to it.\n\n— Shivani Hari\nYour Functional Health Coach',
    example: [['Priya', 'https://fm-coach.example.com/intake/abc123xyz']],
  },
  {
    // v0.75.4 — Sent by fm-coach when the coach clicks "🔓 Unlock full
    // intake + mark signed up" on the client Overview. The client returns
    // to the SAME intake URL they used for pre-discovery; their earlier
    // answers are preserved and the form now shows the deeper sections
    // (FM body systems, ACE, timeline, Joints & standing, etc.) below.
    // Different copy from fm_intake_invite — this is a "welcome back, we're
    // working together now" nudge, not a first-time invite.
    // Called from `lib/server-actions/intake.ts → sendIntakeUnlockedViaApi()`
    // (added in fm-coach v0.75.9). Fallback to fm_intake_invite if this
    // template hasn't approved yet — UnlockFullIntakeButton has env-gated
    // template switching.
    name: 'fm_intake_unlocked_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}}, now that we're working together I've opened up the longer intake form so I can build your specific plan. Your earlier answers are saved — pick up where you left off:\n\n{{2}}\n\nThe newer sections are the ones I'm most keen to learn. Take your time, no rush.\n\n— Shivani Hari\nYour Functional Health Coach",
    example: [['Priya', 'https://intake.theochretree.com/intake/abc123xyz']],
  },
  {
    // Re-issue the intake to capture ONLY the Tier 1 screening section
    // (joints / standing / energy / environment — Section 11) for a client
    // who has already completed the rest of the form. Sent by fm-coach's
    // `reissueTierOneIntakeAction` (the "Suspected Tier 1 signals" panel
    // on the v2 client page). The {{2}} link carries `?focus=tier1` so the
    // intake form renders ONLY that one short section — every other answer
    // stays saved + hidden.
    //
    // Deliberately distinct from the two wrong-fit templates it replaces:
    //   • fm_intake_invite      — "fill in before we work together" (they
    //                             already ARE working together)
    //   • fm_intake_unlocked_v1 — "opened up the longer intake form" (it's
    //                             one short section, not a longer form)
    // UTILITY: purely transactional form-completion, no promotion.
    name: 'fm_intake_topup_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}}, I just need a couple more answers on your intake form — a short section on joints, standing and energy. Everything you filled in before is saved, so this should only take about 2 minutes:\n\n{{2}}\n\n— Shivani Hari\nYour Functional Health Coach',
    example: [['Priya', 'https://intake.theochretree.com/intake/abc123xyz?focus=tier1']],
  },
  {
    // Sent from the FM coach client overview "📅 Send booking link" widget.
    // Coach picks an event type (Discovery / Intake / Coaching) at send time;
    // the widget builds the full cal.com URL and passes it as {{2}}.
    // Auto-linkified by WhatsApp.
    name: 'fm_book_session_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}}, ready to book your next session? You can grab a time that works for you here:\n\n{{2}}\n\nLooking forward to it.\n\n— Shivani Hari\nYour Functional Health Coach',
    example: [['Priya', 'https://cal.com/shivani-hariharan-0xyy3l/discovery-consultation']],
  },
  {
    // V2 of fm_book_session_v1: original landed MARKETING by Meta (likely
    // "ready to book your next session?" promotional CTA + "Looking
    // forward to it" warm closing). Reworded as a neutral service link.
    name: 'fm_book_session_v2',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}}, here is the link to schedule your next session:\n\n{{2}}\n\nPick a time that works for you. Reply here if you cannot find a slot that suits, and I will add availability.\n\n— Shivani Hari\nYour Functional Health Coach',
    example: [['Priya', 'https://cal.com/shivani-hariharan-0xyy3l/discovery-consultation']],
  },
  // ── Plan-publish follow-up templates (fired by fm-coach after a plan
  //    is published — see fm-coach commit ab71ac8 plan-publish-followups.ts) ──
  {
    name: 'fm_plan_letter_link_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hey {{1}}, I've just sent you the full plan over email — but here's the same thing as a phone-friendly link so you can flip it open between meals:\n\n{{2}}\n\nTake your time with it. Questions welcome, no rush. — Shivani",
    example: [['Priya', 'https://intake.theochretree.com/letter/abc123']],
  },
  {
    name: 'fm_supplement_order_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hey {{1}}, this is your supplement starter pack for the protocol — tap the link below for the full list with order options for each:\n\n{{2}}\n\nBrand and dosage matter a lot — if you're unsure about any of them, please reach out before ordering. They take 2-3 days to reach you, so earlier the better. — Shivani",
    example: [['Priya', 'https://intake.theochretree.com/supplements/priya-plan-1-2026-05-17']],
  },
  {
    // V2 of fm_supplement_order_v1: original landed MARKETING (likely "tap
    // the link below" CTA + "earlier the better" urgency). Reworded as a
    // neutral service notification — recipient already has a protocol;
    // this is just the order list for the supplements I've prescribed.
    name: 'fm_supplement_order_v2',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}}, your supplement order list from the protocol is ready:\n\n{{2}}\n\nEach link shows the brand and dose I have prescribed. Reply here with any questions before placing the order.\n\n— Shivani Hari",
    example: [['Priya', 'https://intake.theochretree.com/supplements/priya-plan-1-2026-05-17']],
  },
  {
    // Sent by POST /api/cron/intake-reminders when a client has an open intake
    // token they haven't submitted yet. Capped at 2 reminders per token, ≥5 d
    // apart. The URL in {{3}} is the unique tokenised intake link, e.g.
    // https://<fm-coach-public-url>/intake/<token>.
    name: 'fm_intake_reminder',
    category: 'UTILITY',
    language: 'en',
    // v2 body per fm-database-web/docs/whatsapp-templates.md (2026-05-15
    // handover). Replaces the earlier terse version. Submitting this with
    // the same name triggers Meta's edit-template flow (PATCH on existing
    // template id) — see submitOne() below.
    body:
      'Hi {{1}}, just a gentle nudge — your intake form is still open and helps me prepare the best plan for our session. The link is valid until {{2}}: {{3}}\n\nYour progress saves automatically, so you can pause and come back any time.\n\nWarmly, Shivani',
    example: [['Asha', '28 May', 'https://app.healwithshivanih.com/intake/abc123']],
  },
  {
    name: 'fm_start_date_check_v1',
    category: 'UTILITY',
    language: 'en',
    body: "Hi {{1}} 👋 Quick check-in from Shivani — have you started your plan yet? If yes, just reply with the date you began (e.g. 'Started 19 May'). If you'd like more time, no rush!",
    example: [['Priya']],
  },
  {
    // Cycle-date collector. Fired by fm-coach when the coach approves the
    // "ask client for next period date" action (surfaces on the client page
    // + dashboard actions-due). The client's free-text date reply is parsed
    // by the inbound webhook and auto-populates the client's period-date /
    // cycle fields. Deliberately NO coach name in the body — kept
    // coach-agnostic so the same template serves multiple coaches later.
    name: 'fm_cycle_date_check_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}} 👋 Quick check-in. Has your period started yet? If yes, please reply with the date it began (for example: 21 May). This helps me time your plan and any tests accurately.',
    example: [['Priya']],
  },

  // Weekly poll templates — each has 3 quick-reply buttons. Button labels
  // MUST match POLL_BUTTON_LABELS in src/lib/server-actions/weekly-poll.ts
  // so the webhook parser can map a button click back to a structured score.
  {
    name: 'fm_weekly_check_in_v1',
    category: 'UTILITY',
    language: 'en',
    body: "Hi {{1}} 👋 Quick weekly check-in from Shivani. How's it going overall this week?",
    example: [['Priya']],
    // Meta rejects emojis / variables / newlines / formatting in button text.
    // The parser in `lib/poll-labels.ts` uses .includes("all good") so dropping
    // the 🌿 doesn't break webhook classification.
    buttons: ['All good', 'Some struggles', 'Need help'],
  },
  {
    name: 'fm_weekly_supplement_v1',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, how are the supplements going this week?',
    example: [['Priya']],
    buttons: ['All taken', 'Missed 1-2 days', 'Stopped'],
  },
  {
    name: 'fm_weekly_meals_v1',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, sticking to the meal plan this week?',
    example: [['Priya']],
    buttons: ['Yes mostly', 'Half the time', 'Struggling'],
  },
  {
    name: 'fm_weekly_movement_v1',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, movement this week?',
    example: [['Priya']],
    buttons: ['Most days', 'A few times', 'None'],
  },

  // ── Upcoming-webinar broadcast templates ────────────────────────────────────
  //
  // Three-template progression around any upcoming workshop:
  //   1. webinar_invite_v1     — first-touch invite (sent ~7 days out)
  //   2. webinar_tomorrow_v1   — 24h reminder for whole list (registered or not)
  //   3. webinar_last_call_v1  — day-of urgency push (a few hours before start)
  //
  // All three use a URL CTA button "Register" pointing at
  //   https://lp.theochretree.com/lp/{{1}}
  // where {{1}} is the workshop slug. Meta requires the prefix to be static
  // and only the suffix variable — locks down the domain (anti-phishing).
  //
  // Body {{5}} on the invite template is a multi-line "details block" —
  // the coach assembles "WHO IT'S FOR:" + 3 bullets at send time. Packing
  // into one param keeps the total param count manageable; otherwise we'd
  // need 10+ params and Meta would balk at validation.
  //
  // All three will likely be auto-classified MARKETING by Meta (URLs +
  // promotional framing). Marketing rate ~₹0.78/msg — a 200-person triple
  // blast around one webinar is ~₹470 total.
  {
    // 8 body params: name + title + date + time + who_for + 3 bullets.
    // We tried packing who/bullets into one multi-line {{5}} param but Meta
    // rejects newlines + tabs + 4+ consecutive spaces in body parameter
    // values (error 132018 / "Param text cannot have new-line/tab
    // characters or more than 4 consecutive spaces"). So the structure
    // (line breaks + bullet chars) lives in the template body and each
    // user-supplied piece becomes its own param.
    name: 'webinar_invite_v1',
    category: 'MARKETING',
    language: 'en',
    body:
      'Hi {{1}}, want to join my next session?\n\n' +
      '📅 "{{2}}"\n' +
      '{{3}} at {{4}}\n\n' +
      "WHO IT'S FOR: {{5}}\n\n" +
      "WHAT YOU'LL GET:\n" +
      '• {{6}}\n' +
      '• {{7}}\n' +
      '• {{8}}\n\n' +
      'Tap below to reserve your spot.\n\n' +
      '— Shivani Hari\nYour Functional Health Coach',
    example: [[
      'Priya',
      'Reset Your Cortisol',
      'Wednesday 21 May',
      '5:00 PM IST',
      'Women in their 40s+ noticing afternoon energy crashes and stubborn weight around the middle',
      'Why morning cortisol matters for mid-life weight gain',
      '3 practical resets you can start tomorrow morning',
      "Live Q&A — bring anything you've been wrestling with",
    ]],
    buttons: [{
      type: 'URL',
      text: 'Register',
      url: 'https://lp.theochretree.com/lp/{{1}}',
      exampleSuffix: 'cortisol-belly-may21',
    }],
  },
  {
    name: 'webinar_tomorrow_v1',
    category: 'MARKETING',
    language: 'en',
    body:
      'Hi {{1}}, quick reminder — "{{2}}" is tomorrow at {{3}}.\n\n' +
      '{{4}}\n\n' +
      "If you've already registered you'll get the join link separately. " +
      'If not, tap below to grab a spot.\n\n' +
      '— Shivani Hari\nYour Functional Health Coach',
    example: [[
      'Priya',
      'Reset Your Cortisol',
      '5:00 PM IST',
      "It's a 60-min session — practical, no theory waffle.",
    ]],
    buttons: [{
      type: 'URL',
      text: 'Register',
      url: 'https://lp.theochretree.com/lp/{{1}}',
      exampleSuffix: 'cortisol-belly-may21',
    }],
  },
  {
    name: 'webinar_last_call_v1',
    category: 'MARKETING',
    language: 'en',
    body:
      'Hi {{1}}, last call — "{{2}}" starts at {{3}} today.\n\n' +
      "If you're on the fence, this is the one. Tap below and I'll send " +
      'the join link right away.\n\n' +
      '— Shivani Hari\nYour Functional Health Coach',
    example: [[
      'Priya',
      'Reset Your Cortisol',
      '5:00 PM IST',
    ]],
    buttons: [{
      type: 'URL',
      text: 'Register now',
      url: 'https://lp.theochretree.com/lp/{{1}}',
      exampleSuffix: 'cortisol-belly-may21',
    }],
  },

  // ── Workshop reminder series (4 templates: -24h / -1h / starting now / replay) ─
  //    All UTILITY, all body-URL pattern (auto-linkified by WhatsApp — same shape
  //    as fm_book_session_v1). Sign-off matches the email + WhatsApp brand voice.
  {
    name: 'workshop_reminder_24h_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      'Hi {{1}},\n\nReminder — *{{2}}* is {{3}}.\n\nYour join link, ready when you are:\n\n{{4}}\n\nBring your questions. See you tomorrow.\n\n— The Ochre Tree',
    example: [['Priya', '40s: The Decade No One Prepared You For', 'tomorrow at 7:30 PM IST', 'https://us06web.zoom.us/j/12345678901']],
  },
  {
    name: 'workshop_reminder_1h_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}},\n\n*{{2}}* starts in about an hour, at {{3}}.\n\nTap to join when you're ready:\n\n{{4}}\n\nSettle in a few minutes early — we'll be live on Zoom.\n\n— The Ochre Tree",
    example: [['Priya', '40s: The Decade No One Prepared You For', '7:30 PM IST', 'https://us06web.zoom.us/j/12345678901']],
  },
  {
    name: 'workshop_starting_now_v1',
    category: 'UTILITY',
    language: 'en',
    // Body must NOT start (or end) with a variable per Meta rule
    // (subcode 2388299). "Hi {{1}}" prepended instead of bare "{{1}}".
    body:
      "Hi {{1}}, we're live.\n\n*{{2}}* has started — come on in:\n\n{{3}}\n\nSee you in there.\n\n— The Ochre Tree",
    example: [['Priya', '40s: The Decade No One Prepared You For', 'https://us06web.zoom.us/j/12345678901']],
  },
  {
    // V2 of starting-now: original v1 got reclassified MARKETING by Meta
    // (likely due to "we're live", "come on in", "See you in there" —
    // event/promotional energy). Reworded as a neutral service notification
    // about a workshop the recipient already registered for. New name so
    // Meta re-evaluates fresh.
    name: 'workshop_starting_now_v2',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}}, your workshop *{{2}}* is starting now. Your join link is below:\n\n{{3}}\n\nReply here if you have any trouble joining.\n\n— The Ochre Tree",
    example: [['Priya', '40s: The Decade No One Prepared You For', 'https://us06web.zoom.us/j/12345678901']],
  },
  {
    name: 'workshop_replay_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}},\n\nThank you for joining *{{2}}*.\n\nHere's the replay — available for a limited time:\n\n{{3}}\n\nIf something came up for you after, just reply here.\n\n— The Ochre Tree",
    example: [['Priya', '40s: The Decade No One Prepared You For', 'https://us06web.zoom.us/rec/share/abc123']],
  },
  {
    // V2 of replay: original v1 got reclassified MARKETING by Meta (likely
    // due to "available for a limited time" scarcity + "Thank you for
    // joining" promotional framing). Reworded to be a neutral service
    // follow-up so Meta's classifier lands it as UTILITY. New name so Meta
    // re-evaluates fresh.
    name: 'workshop_replay_v2',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}}, your replay for *{{2}}* is ready. You can watch it any time using this link:\n\n{{3}}\n\nIf anything came up for you after the session, just reply here and I will get back to you.\n\n— The Ochre Tree",
    example: [['Priya', '40s: The Decade No One Prepared You For', 'https://us06web.zoom.us/rec/share/abc123']],
  },
  {
    // Payment link send for a registered workshop. Transactional reference
    // to the recipient's prior action ("complete your registration"), no
    // urgency, no promo claims — designed to land UTILITY on first try.
    name: 'workshop_payment_link_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}},\n\nHere is the payment link to complete your registration for *{{2}}*:\n\n{{3}}\n\n— The Ochre Tree",
    example: [['Priya', '40s: The Decade No One Prepared You For', 'https://rzp.io/rzp/OZY887WS']],
  },
  {
    // Reminder for an unpaid registration. Factual ("still active") not
    // urgent — references the prior creation of the payment link. Same
    // UTILITY-friendly pattern as fm_intake_reminder.
    name: 'workshop_payment_link_reminder_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hi {{1}},\n\nA reminder — your payment link for *{{2}}* is still active:\n\n{{3}}\n\n— The Ochre Tree",
    example: [['Priya', '40s: The Decade No One Prepared You For', 'https://rzp.io/rzp/OZY887WS']],
  },
];

// ---------------------------------------------------------------------------
// .env loader (no dep on dotenv — keeps the script self-contained)
// ---------------------------------------------------------------------------
function loadEnv() {
  // If the required vars are already in process.env (e.g. running inside the
  // Fly container where they're injected as secrets), skip the .env file.
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    return { ...process.env };
  }
  const envPath = resolve(ROOT, '.env');
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    fail(`could not read ${envPath} — is the project root correct?`);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Graph API calls
// ---------------------------------------------------------------------------
function buildComponents(tpl) {
  const components = [
    {
      type: 'BODY',
      text: tpl.body,
      ...(tpl.example ? { example: { body_text: tpl.example } } : {}),
    },
  ];
  // Buttons (max 3 per template per Meta spec). Two flavours:
  //   - plain string  → QUICK_REPLY (existing behaviour, weekly polls etc.)
  //   - { type, text, url, exampleSuffix } → URL CTA. Meta requires:
  //       url:     "https://prefix.example.com/path/{{1}}"
  //       example: ["https://prefix.example.com/path/concrete-value"]
  //     where the {{1}} is filled in at send time. The hardcoded prefix
  //     locks down the domain (anti-phishing); only the suffix is dynamic.
  if (Array.isArray(tpl.buttons) && tpl.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: tpl.buttons.slice(0, 3).map((b) => {
        if (typeof b === 'string') {
          return { type: 'QUICK_REPLY', text: b.slice(0, 25) };
        }
        if (b?.type === 'URL') {
          const btn = {
            type: 'URL',
            text: String(b.text || 'Open').slice(0, 25),
            url: b.url,
          };
          // Example is required by Meta when the URL contains a {{N}} var.
          if (b.url && b.url.includes('{{')) {
            btn.example = b.example || [b.exampleSuffix
              ? b.url.replace(/\{\{\d+\}\}/, b.exampleSuffix)
              : b.url.replace(/\{\{\d+\}\}/, 'sample')];
          }
          return btn;
        }
        // Fallback — treat unknown shape as a quick reply.
        return { type: 'QUICK_REPLY', text: String(b.text || b).slice(0, 25) };
      }),
    });
  }
  return components;
}

function isDuplicateNameError(body) {
  // Meta surfaces this in two places:
  //   error.message       — usually generic "Invalid parameter"
  //   error.error_user_msg — actual "...already exists" sentence
  // and either of two subcodes:
  //   2388023 — generic "already exists"
  //   2388024 — "Content in this language already exists"
  const msg = String(
    body?.error?.error_user_msg || body?.error?.message || '',
  ).toLowerCase();
  const sub = body?.error?.error_subcode;
  return (
    msg.includes('already exists') ||
    msg.includes('exists with same') ||
    sub === 2388023 ||
    sub === 2388024
  );
}

async function findTemplateIdByName(wabaId, token, name, language) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`
    + `?name=${encodeURIComponent(name)}&fields=id,name,language,status&limit=20`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  // Meta returns ALL languages for a name. Match the language too.
  const match = (body.data || []).find(
    (t) => t.name === name && t.language === language,
  );
  return match?.id || null;
}

async function editTemplate(templateId, token, tpl) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${templateId}`;
  const payload = {
    // Meta lets you edit BODY (and BUTTONS/FOOTER/etc.) but NOT name /
    // category / language on an existing template. Components only.
    components: buildComponents(tpl),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function submitOne(wabaId, token, tpl) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`;
  const payload = {
    name: tpl.name,
    category: tpl.category,
    language: tpl.language,
    components: buildComponents(tpl),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, status: res.status, body, mode: 'created' };

  // If Meta says "name already exists" we fall over to the edit path:
  // look up the existing template id by name+language, PATCH components.
  // Useful for body refinements without re-numbering the template name.
  if (isDuplicateNameError(body)) {
    const existingId = await findTemplateIdByName(wabaId, token, tpl.name, tpl.language);
    if (!existingId) return { ok: false, status: res.status, body };
    const edit = await editTemplate(existingId, token, tpl);
    return { ...edit, body: { ...(edit.body || {}), id: existingId }, mode: 'edited' };
  }

  return { ok: res.ok, status: res.status, body };
}

async function listLive(wabaId, token) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?limit=100&fields=name,language,status,category,components`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`Meta returned ${res.status}: ${JSON.stringify(body)}`);
  return body.data || [];
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--list')) {
  console.log(`Local template definitions (${TEMPLATES.length}):\n`);
  for (const t of TEMPLATES) {
    console.log(`  ${t.name}  [${t.category}, ${t.language}]`);
    console.log(`    ${t.body}`);
    if (t.buttons) console.log(`    buttons: ${t.buttons.join(' | ')}`);
    console.log();
  }
  process.exit(0);
}

const env = loadEnv();
const TOKEN = env.WHATSAPP_TOKEN;
const WABA_ID = env.WHATSAPP_BUSINESS_ACCOUNT_ID;
if (!TOKEN) fail('WHATSAPP_TOKEN missing from .env');
if (!WABA_ID) fail('WHATSAPP_BUSINESS_ACCOUNT_ID missing from .env');

if (args.includes('--check')) {
  const live = await listLive(WABA_ID, TOKEN);
  const localNames = new Set(TEMPLATES.map((t) => t.name));
  const interesting = live
    .filter((t) => localNames.has(t.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (interesting.length === 0) {
    console.log('No matching templates found on Meta yet.');
  } else {
    console.log(`Live status for ${interesting.length} template(s):\n`);
    for (const t of interesting) {
      console.log(`  ${t.name}  [${t.language}]  →  ${t.status}`);
    }
  }
  process.exit(0);
}

// Selection: any non-flag args become a name filter
const requested = args.filter((a) => !a.startsWith('-'));
const targets = requested.length
  ? TEMPLATES.filter((t) => requested.includes(t.name))
  : TEMPLATES;

if (targets.length === 0) {
  fail(`no templates matched: ${requested.join(', ')}`);
}

console.log(`Submitting ${targets.length} template(s) to WABA ${WABA_ID}...\n`);

const results = [];
for (const tpl of targets) {
  process.stdout.write(`  ${tpl.name} ... `);
  try {
    const r = await submitOne(WABA_ID, TOKEN, tpl);
    if (r.ok) {
      const tag = r.mode === 'edited' ? '✎ edited' : '✓ created';
      console.log(`${tag} ${r.body.id || ''} (${r.body.status || 'queued'})`);
      results.push({ name: tpl.name, ok: true, id: r.body.id, status: r.body.status, mode: r.mode });
    } else {
      const errMsg = r.body?.error?.message || JSON.stringify(r.body);
      console.log(`✗ ${r.status} — ${errMsg}`);
      results.push({ name: tpl.name, ok: false, status: r.status, error: errMsg });
    }
  } catch (e) {
    console.log(`✗ network error — ${e.message}`);
    results.push({ name: tpl.name, ok: false, error: e.message });
  }
}

const okCount = results.filter((r) => r.ok).length;
const failCount = results.length - okCount;
console.log(`\n${okCount} submitted, ${failCount} failed.`);
if (failCount > 0) {
  console.log('\nCommon errors:');
  console.log('  • "Template name already exists" → already submitted; check with --check');
  console.log('  • "Invalid parameter" → body variable count mismatch with example array');
  console.log('  • "Permission denied" → token lacks whatsapp_business_management scope');
  process.exit(1);
}
