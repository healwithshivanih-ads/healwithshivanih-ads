#!/usr/bin/env node
// Dry-run audit harness for the appointments-reminder pipeline.
//
// Exercises every deterministic code path with synthetic Wix and Cal.com
// payloads. No DB writes, no Meta API calls. Catches:
//
//   - classification mistakes (every Wix location → expected verdict)
//   - template-param shape (count + order vs the submit-templates.js
//     example arrays — wrong shape = Meta rejection at send time)
//   - scheduler kind selection per classification
//   - timing math for each reminder kind (24h/1h/5min/+5min offsets)
//   - audience derivation (_coach suffix → coach)
//   - Zoom URL-suffix extraction for all known Zoom domain shapes
//   - Wix JWT decode round-trip with a locally-signed test payload
//   - noshow probe button routing for all 3 actions + 2 negative paths
//
// Doesn't catch (covered by smoke-test on first real booking):
//   - Real Wix dashboard signature against our public key
//   - Real Cal.com event payload field locations
//   - Coach contact resolution (matchContact DB lookup)
//   - Meta template ID + language acceptance at send time
//   - Reminder runner DB upsert race / atomic-claim under load
//
// Run: node scripts/dry-run-appointments.mjs

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import {
  classifyWixBooking,
  pickLocationAddress,
  pickLocationId,
  DISTANCE_LOCATION_IDS,
} from '../src/integrations/wix/classify.js';

import {
  REMINDER_KINDS,
  REMINDER_TEMPLATES,
  KINDS_BY_CLASSIFICATION,
  audienceForKind,
  scheduledMsFor,
} from '../src/services/reminders/index.js';

import {
  buildTemplateComponents,
  zoomUrlSuffix,
} from '../src/services/reminders/template-params.js';

// ──────────────────────────────────────────────────────────────────────
// Test runner
// ──────────────────────────────────────────────────────────────────────
const results = { pass: 0, fail: 0, items: [] };

function check(label, ok, detail = '') {
  results.items.push({ label, ok, detail });
  if (ok) results.pass++; else results.fail++;
  const mark = ok ? '✓' : '✗';
  const colour = ok ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';
  console.log(`  ${colour}${mark}${reset} ${label}${detail ? ' — ' + detail : ''}`);
}

function section(name) {
  console.log(`\n\x1b[1m━━━ ${name} ━━━\x1b[0m`);
}

// ──────────────────────────────────────────────────────────────────────
// Fixtures — real ids from the Wix dashboard (locations endpoint)
// ──────────────────────────────────────────────────────────────────────
const WIX_LOCATIONS = {
  IN: '05fd2dd8-a460-4f7f-9c79-fa5adc16ddb3',           // distance marker
  Senapati: '1a306c05-62e0-4184-b362-5fef93bedb4a',     // Mumbai clinic
  GDAmbekar: '78222928-2001-4cce-9f9a-b28cba20e46a',    // Mumbai clinic
  NewDelhi: '2d361a12-dc53-46c7-94a4-eba8b90c71b2',     // Delhi clinic
  Dubai: '18afd587-6148-4f31-8a94-93a25b9b7c31',        // Dubai clinic
};

function wixBookingFixture(locationId, opts = {}) {
  const formattedAddress = opts.address || (
    locationId === WIX_LOCATIONS.IN ? 'India' :
    locationId === WIX_LOCATIONS.Senapati ? 'Senapati Bapat Marg, Mumbai' :
    locationId === WIX_LOCATIONS.GDAmbekar ? 'ICC TWO, Island City Center, G D Ambekar Road, Dadar East, Wadala, Mumbai, Maharashtra, India' :
    locationId === WIX_LOCATIONS.NewDelhi ? 'The Ochre Tree, Block C, New Friends Colony, New Delhi, Delhi, India' :
    locationId === WIX_LOCATIONS.Dubai ? 'JLT, Dubai' :
    null
  );
  const locationName = opts.locationName || (
    locationId === WIX_LOCATIONS.IN ? 'IN' :
    locationId === WIX_LOCATIONS.Senapati ? 'Senapati Bapat Marg' :
    locationId === WIX_LOCATIONS.GDAmbekar ? 'G D Ambekar Road' :
    locationId === WIX_LOCATIONS.NewDelhi ? 'New Delhi' :
    locationId === WIX_LOCATIONS.Dubai ? 'Dubai' :
    null
  );
  return {
    id: opts.id || crypto.randomUUID(),
    bookedEntity: {
      slot: {
        serviceId: opts.serviceId || crypto.randomUUID(),
        startDate: opts.startDate || '2026-06-15T11:30:00.000Z',
        endDate: opts.endDate || '2026-06-15T12:30:00.000Z',
        location: {
          id: locationId,
          name: locationName,
          formattedAddress,
          locationType: 'OWNER_BUSINESS',
        },
      },
      title: opts.title || 'Bach Flower Remedy',
    },
    contactDetails: opts.contactDetails || {
      firstName: 'Priya',
      email: 'priya@example.com',
    },
    startDate: opts.startDate || '2026-06-15T11:30:00.000Z',
    endDate: opts.endDate || '2026-06-15T12:30:00.000Z',
  };
}

function apptFixture(opts = {}) {
  return {
    id: 'appt-' + crypto.randomUUID().slice(0, 8),
    workspace_id: 'ws-1',
    starts_at: opts.startsAt || '2026-06-15T11:30:00.000Z',
    ends_at: opts.endsAt || '2026-06-15T12:30:00.000Z',
    title: opts.title || 'Bach Flower Remedy',
    location: opts.location || null,
    join_url: opts.joinUrl || null,
    status: 'scheduled',
    classification: opts.classification || null,
    metadata: opts.metadata || {},
    ...opts.extra,
  };
}

function contactFixture(opts = {}) {
  return {
    id: 'contact-' + crypto.randomUUID().slice(0, 8),
    display_name: opts.displayName ?? 'Priya Sharma',
    primary_phone: opts.phone ?? '+919876543210',
    locale: opts.locale ?? 'en',
  };
}

// ──────────────────────────────────────────────────────────────────────
// 1. CLASSIFIER — every Wix location id
// ──────────────────────────────────────────────────────────────────────
section('1. Wix classifier — every location id');

for (const [name, id] of Object.entries(WIX_LOCATIONS)) {
  const booking = wixBookingFixture(id);
  const expected = (name === 'IN') ? 'distance' : 'in_person';
  const actual = classifyWixBooking(booking);
  check(`location ${name} (${id.slice(0, 8)}…) → ${actual}`,
    actual === expected,
    actual !== expected ? `expected ${expected}` : '');

  const addr = pickLocationAddress(booking);
  const expectAddr = id === WIX_LOCATIONS.IN ? 'India' : null;
  check(`  address extraction non-null`, !!addr, `got: ${addr?.slice(0, 60) || 'null'}`);
}

check('missing-location defaults to in_person',
  classifyWixBooking({}) === 'in_person');
check('null booking → in_person (no throw)',
  classifyWixBooking(null) === 'in_person');
check('DISTANCE_LOCATION_IDS contains exactly 1 id',
  DISTANCE_LOCATION_IDS.size === 1 && DISTANCE_LOCATION_IDS.has(WIX_LOCATIONS.IN));

// Variant payload shapes (defensive walk in pickLocationId)
check('pickLocationId handles bookedEntity.location (no slot)',
  pickLocationId({ bookedEntity: { location: { id: WIX_LOCATIONS.Senapati } } }) === WIX_LOCATIONS.Senapati);
check('pickLocationId handles bare slot.location',
  pickLocationId({ slot: { location: { id: WIX_LOCATIONS.GDAmbekar } } }) === WIX_LOCATIONS.GDAmbekar);
check('pickLocationId handles bare location',
  pickLocationId({ location: { id: WIX_LOCATIONS.NewDelhi } }) === WIX_LOCATIONS.NewDelhi);
check('pickLocationId returns null on missing',
  pickLocationId({}) === null);

// ──────────────────────────────────────────────────────────────────────
// 2. SCHEDULER — kinds emitted per classification
// ──────────────────────────────────────────────────────────────────────
section('2. Scheduler — kinds emitted per classification');

const EXPECTED_KINDS = {
  in_person: [
    'confirmation_inperson',
    't_minus_24h_inperson_client',
    't_minus_24h_inperson_coach',
    't_minus_1h_inperson_client',
  ],
  distance: [
    't_minus_5min_distance_client',
  ],
  zoom: [
    'confirmation_zoom',
    't_minus_1h_zoom_client',
    't_minus_1h_zoom_coach',
    't_plus_5min_noshow_zoom_client',
  ],
};

for (const [cls, expected] of Object.entries(EXPECTED_KINDS)) {
  const actual = KINDS_BY_CLASSIFICATION[cls];
  const eq = expected.length === actual?.length && expected.every((k) => actual.includes(k));
  check(`KINDS_BY_CLASSIFICATION.${cls} has exactly ${expected.length} kinds`,
    eq, eq ? '' : `expected [${expected.join(',')}], got [${actual?.join(',') || ''}]`);
}

// Every kind in KINDS_BY_CLASSIFICATION must have a template
for (const [cls, kinds] of Object.entries(KINDS_BY_CLASSIFICATION)) {
  for (const k of kinds) {
    check(`${cls}/${k} → template '${REMINDER_TEMPLATES[k]}'`, !!REMINDER_TEMPLATES[k]);
  }
}

// Legacy fallback still works
check('REMINDER_KINDS (legacy fallback) still has 3 entries',
  REMINDER_KINDS.length === 3 && REMINDER_KINDS.every((k) => REMINDER_TEMPLATES[k]));

// ──────────────────────────────────────────────────────────────────────
// 3. SCHEDULING MATH — every kind hits the right offset from startsAt
// ──────────────────────────────────────────────────────────────────────
section('3. Scheduling math — offsets from starts_at');

const startsMs = Date.parse('2026-06-15T11:30:00.000Z');
const nowMs = Date.parse('2026-06-14T11:30:00.000Z');  // 24h before
const MIN = 60_000, HOUR = 60 * MIN;

const offsetTests = [
  ['confirmation', 0, 'immediate (= nowMs)', nowMs],
  ['confirmation_inperson', 0, 'immediate', nowMs],
  ['confirmation_zoom', 0, 'immediate', nowMs],
  ['t_minus_24h', -24 * HOUR, '24h before', startsMs - 24 * HOUR],
  ['t_minus_24h_inperson_client', -24 * HOUR, '24h before', startsMs - 24 * HOUR],
  ['t_minus_24h_inperson_coach', -24 * HOUR, '24h before', startsMs - 24 * HOUR],
  ['t_minus_2h', -2 * HOUR, '2h before (legacy)', startsMs - 2 * HOUR],
  ['t_minus_1h_inperson_client', -1 * HOUR, '1h before', startsMs - 1 * HOUR],
  ['t_minus_1h_zoom_client', -1 * HOUR, '1h before', startsMs - 1 * HOUR],
  ['t_minus_1h_zoom_coach', -1 * HOUR, '1h before', startsMs - 1 * HOUR],
  ['t_minus_5min_distance_client', -5 * MIN, '5min before', startsMs - 5 * MIN],
  ['t_plus_5min_noshow_zoom_client', 5 * MIN, '5min after', startsMs + 5 * MIN],
];

for (const [kind, offsetLabel, desc, expected] of offsetTests) {
  const got = scheduledMsFor(kind, startsMs, nowMs);
  const ok = got === expected;
  const delta = expected === nowMs ? '' : ` (Δ ${(got - startsMs) / MIN}min from start)`;
  check(`${kind} → ${desc}${delta}`, ok, ok ? '' : `expected ${expected}, got ${got}`);
}

check('unknown kind → null',
  scheduledMsFor('garbage_kind', startsMs, nowMs) === null);

// ──────────────────────────────────────────────────────────────────────
// 4. AUDIENCE — every kind resolves to client or coach
// ──────────────────────────────────────────────────────────────────────
section('4. Audience derivation (_coach suffix → coach)');

const ALL_KINDS = Object.keys(REMINDER_TEMPLATES);
const COACH_KINDS = new Set(['t_minus_24h_inperson_coach', 't_minus_1h_zoom_coach']);

for (const k of ALL_KINDS) {
  const expected = COACH_KINDS.has(k) ? 'coach' : 'client';
  const got = audienceForKind(k);
  check(`${k.padEnd(36)} → ${got}`, got === expected,
    got === expected ? '' : `expected ${expected}`);
}

// ──────────────────────────────────────────────────────────────────────
// 5. TEMPLATE PARAMS — every kind builds a Meta-acceptable shape
// ──────────────────────────────────────────────────────────────────────
section('5. Template param builders — body param count + URL button presence');

// Expected body param counts MUST match each template's `example` array
// length in scripts/submit-templates.js. Wrong count = Meta send-time error
// "number of variables doesn't match".
const EXPECTED_BODY_COUNTS = {
  confirmation: 4,
  t_minus_24h: 4,
  t_minus_2h: 4,
  confirmation_inperson: 5,
  t_minus_24h_inperson_client: 5,
  t_minus_24h_inperson_coach: 5,
  t_minus_1h_inperson_client: 4,
  t_minus_5min_distance_client: 2,
  confirmation_zoom: 4,
  t_minus_1h_zoom_client: 3,
  t_minus_1h_zoom_coach: 3,
  t_plus_5min_noshow_zoom_client: 2,
};
const EXPECTED_URL_BUTTON = new Set([
  'confirmation_zoom',
  't_minus_1h_zoom_client',
  't_minus_1h_zoom_coach',
]);

const sampleAppt = apptFixture({
  startsAt: '2026-06-15T17:00:00+05:30',  // 5pm IST
  title: 'Bach Flower Remedy',
  joinUrl: 'https://us02web.zoom.us/j/85123456789?pwd=abc123',
  metadata: {
    wix_location_address: 'ICC TWO, Island City Center, G D Ambekar Road, Mumbai',
  },
});
const sampleContact = contactFixture();

for (const kind of ALL_KINDS) {
  const { components, resolved } = buildTemplateComponents(kind, sampleAppt, sampleContact);
  const bodyComp = components.find((c) => c.type === 'body');
  const buttonComp = components.find((c) => c.type === 'button');
  const expectedCount = EXPECTED_BODY_COUNTS[kind];
  const expectButton = EXPECTED_URL_BUTTON.has(kind);

  check(`${kind}: body param count = ${expectedCount}`,
    bodyComp?.parameters?.length === expectedCount,
    `got ${bodyComp?.parameters?.length}`);

  // Sanity: no empty / undefined param strings (Meta rejects)
  const emptyParams = (bodyComp?.parameters || []).filter(
    (p) => !p.text || p.text === 'undefined' || p.text === 'null',
  );
  check(`${kind}: no empty/undefined params`, emptyParams.length === 0,
    emptyParams.length ? `${emptyParams.length} empty(s): ${JSON.stringify(emptyParams)}` : '');

  // URL button presence
  if (expectButton) {
    check(`${kind}: has URL button component`, !!buttonComp);
    check(`${kind}: URL button has 1 param`, buttonComp?.parameters?.length === 1);
    check(`${kind}: URL button param is a non-empty text`,
      buttonComp?.parameters?.[0]?.text?.length > 0);
  } else {
    check(`${kind}: NO URL button (template doesn't have one)`, !buttonComp);
  }
}

// ──────────────────────────────────────────────────────────────────────
// 6. TEMPLATE PARAM EDGE CASES — missing data shouldn't crash
// ──────────────────────────────────────────────────────────────────────
section('6. Template params — edge cases');

// No address → fallback string used
const noAddrAppt = apptFixture({ metadata: {} });
const { resolved: noAddr } = buildTemplateComponents('confirmation_inperson', noAddrAppt, sampleContact);
check(`confirmation_inperson with missing address → fallback`,
  noAddr.bodyParams[4].includes('(address') || noAddr.bodyParams[4].length > 0,
  `got: '${noAddr.bodyParams[4]}'`);

// No contact name → 'there'
const anonContact = contactFixture({ displayName: '' });
const { resolved: anon } = buildTemplateComponents('confirmation_inperson', sampleAppt, anonContact);
check(`confirmation_inperson with empty name → 'there'`, anon.bodyParams[0] === 'there');

// Null join_url for a Zoom template
const noZoomAppt = apptFixture({ joinUrl: null });
const { components: noZoomComp, resolved: noZoomRes } = buildTemplateComponents('confirmation_zoom', noZoomAppt, sampleContact);
const hasButton = noZoomComp.find((c) => c.type === 'button');
check(`confirmation_zoom with null join_url → NO URL button component`,
  !hasButton, hasButton ? 'CRITICAL: Meta will reject this template send' : '');
check(`  buttonUrlSuffix is null`, noZoomRes.buttonUrlSuffix === null);

// Coach template uses display_name, not first-name only
const fullName = contactFixture({ displayName: 'Priya Sharma' });
const { resolved: coachRes } = buildTemplateComponents('t_minus_24h_inperson_coach', sampleAppt, fullName);
check(`coach template includes full display_name`,
  coachRes.bodyParams[0] === 'Priya Sharma');
check(`coach template ends with client phone`,
  coachRes.bodyParams[4].startsWith('+'));

// Unknown kind → fallback shape (won't match any approved template — log only)
const { resolved: fallback } = buildTemplateComponents('garbage_kind', sampleAppt, sampleContact);
check(`unknown kind triggers fallback flag`, fallback.fallback === true);

// ──────────────────────────────────────────────────────────────────────
// 7. ZOOM URL SUFFIX — all known shapes
// ──────────────────────────────────────────────────────────────────────
section('7. Zoom URL extraction');

const zoomTests = [
  ['https://us02web.zoom.us/j/85123456789?pwd=abc123', '85123456789?pwd=abc123'],
  ['https://zoom.us/j/85123456789', '85123456789'],
  ['https://eu01web.zoom.us/j/99887766554', '99887766554'],
  ['https://us04web.zoom.us/w/85123456789?tk=token', '85123456789?tk=token'],
  ['https://zoom.us/my/shivani.coaching', 'shivani.coaching'],
  [null, null],
  ['', null],
  ['https://meet.google.com/abc-def-ghi', null],   // not Zoom
  ['https://app.cal.com/video/xyz', null],         // Cal.com proxy
];
for (const [input, expected] of zoomTests) {
  const got = zoomUrlSuffix(input);
  check(`${(input || '<null>').slice(0, 50)} → ${got || '<null>'}`,
    got === expected, got === expected ? '' : `expected ${expected}`);
}

// ──────────────────────────────────────────────────────────────────────
// 8. WIX JWT — round-trip through verifyWixJwt + decodeWixWebhook
// ──────────────────────────────────────────────────────────────────────
section('8. Wix JWT verify + double-decode (local keypair)');

// Generate a fresh RSA keypair, override WIX_WEBHOOK_PUBLIC_KEY to test
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
process.env.WIX_WEBHOOK_PUBLIC_KEY = publicKey;

// Re-import the module so it picks up the new env var (the module reads
// process.env on every call — no need to re-import — but we do anyway for
// hygiene)
const { verifyWixJwt, decodeWixWebhook, WixJwtVerifyError }
  = await import('../src/integrations/wix/jwt.js');

// Build a real Wix-shaped payload: outer.data is JSON-string of an
// envelope whose .data is itself a JSON-string of the real booking event.
const innerEvent = {
  createdEvent: {
    entity: wixBookingFixture(WIX_LOCATIONS.GDAmbekar, {
      id: 'booking-12345',
      title: 'Sound Healing Session',
    }),
  },
};
const middle = {
  instanceId: 'inst-abc',
  eventType: 'wix.bookings.v2.booking.created',
  slug: 'created',
  entityFqdn: 'wix.bookings.v2.booking',
  data: JSON.stringify(innerEvent),
};
const outer = { data: JSON.stringify(middle), iat: Math.floor(Date.now() / 1000) };
const signedJwt = jwt.sign(outer, privateKey, { algorithm: 'RS256' });

try {
  const decoded = decodeWixWebhook(signedJwt);
  check('JWT verify + double-decode succeeded', true);
  check('decoded.eventType matches', decoded.eventType === 'wix.bookings.v2.booking.created');
  check('decoded.entityFqdn matches', decoded.entityFqdn === 'wix.bookings.v2.booking');
  check('decoded.envelope has createdEvent', !!decoded.envelope.createdEvent);
  // Classification should work against the inner envelope
  const innerBooking = decoded.envelope.createdEvent.entity;
  check('classifyWixBooking on decoded inner → in_person',
    classifyWixBooking(innerBooking) === 'in_person');
} catch (e) {
  check('JWT verify + double-decode succeeded', false, e.message);
}

// Bad signature path
try {
  const { publicKey: otherPub, privateKey: otherPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const badJwt = jwt.sign(outer, otherPriv, { algorithm: 'RS256' });
  decodeWixWebhook(badJwt);
  check('mismatched signature throws WixJwtVerifyError', false, 'no throw!');
} catch (e) {
  check('mismatched signature throws WixJwtVerifyError',
    e instanceof WixJwtVerifyError && e.code === 'bad_signature',
    `code: ${e.code}`);
}

// Missing public key
const savedKey = process.env.WIX_WEBHOOK_PUBLIC_KEY;
delete process.env.WIX_WEBHOOK_PUBLIC_KEY;
try {
  verifyWixJwt(signedJwt);
  check('missing public key throws no_public_key', false, 'no throw!');
} catch (e) {
  check('missing public key throws no_public_key',
    e.code === 'no_public_key', `code: ${e.code}`);
}
process.env.WIX_WEBHOOK_PUBLIC_KEY = savedKey;

// ──────────────────────────────────────────────────────────────────────
// 9. NO-SHOW BUTTON ROUTING — verify the title → action map
// ──────────────────────────────────────────────────────────────────────
section('9. No-show probe — button title → action map');

// We can't easily run handleProbeReply without DB, but we can verify the
// hardcoded BUTTON_ACTIONS map matches the 3 strings that ship in
// scripts/submit-templates.js for appt_noshow_probe_client.
const SUBMIT_TEMPLATES_BUTTONS = [
  'Be there in 5',
  'Be there in 15',
  'Need to reschedule',
];
const noshowSrc = await import('node:fs/promises')
  .then((fs) => fs.readFile('src/services/noshow/index.js', 'utf8'));

for (const title of SUBMIT_TEMPLATES_BUTTONS) {
  check(`BUTTON_ACTIONS contains "${title}"`,
    noshowSrc.includes(`'${title}'`));
}

// Negative paths the handler must guard against (regex spot-check):
check('handler checks template_name === PROBE_TEMPLATE_NAME',
  noshowSrc.includes('appt_noshow_probe_client'));
check('handler reads context.id from payload',
  noshowSrc.includes('event.payload?.context?.id'));
check('handler skips non-button events',
  noshowSrc.includes("type !== 'interactive_button'"));
check('handler pings coach for "late_15" action',
  noshowSrc.includes("case 'late_15'") && noshowSrc.includes('pingCoach'));
check('reschedule URL uses cal_com_uid from metadata',
  noshowSrc.includes('cal_com_uid') && noshowSrc.includes('app.cal.com/reschedule/'));

// ──────────────────────────────────────────────────────────────────────
// 10. CAL.COM EVENT SWITCH — verify all spec'd events have handlers
// ──────────────────────────────────────────────────────────────────────
section('10. Cal.com event switch coverage');

const calComSrc = await import('node:fs/promises')
  .then((fs) => fs.readFile('src/routes/webhooks/cal-com.js', 'utf8'));

const HANDLED_EVENTS = [
  'BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED',
  'BOOKING_CANCELED', 'MEETING_STARTED',
];
for (const ev of HANDLED_EVENTS) {
  check(`switch handles ${ev}`,
    calComSrc.includes(`case '${ev}'`));
}

// BOOKING_CREATED must pass classification: 'zoom'
check("handleBookingCreated passes classification: 'zoom'",
  /classification:\s*'zoom'/.test(calComSrc));

// MEETING_STARTED handler must filter by t_plus_5min_noshow_ prefix
check('handleMeetingStarted filters t_plus_5min_noshow_ kinds',
  calComSrc.includes('t_plus_5min_noshow_%'));

// Old inline appt_confirmation send must be gone (replaced by reminder kind)
check('legacy inline sendTemplate(appt_confirmation) removed from cal-com',
  !calComSrc.includes("templateName: 'appt_confirmation'"));

// ──────────────────────────────────────────────────────────────────────
// 11. WIX-BOOKINGS HANDLER — verify classifier wiring
// ──────────────────────────────────────────────────────────────────────
section('11. Wix-bookings handler wiring');

const wixSrc = await import('node:fs/promises')
  .then((fs) => fs.readFile('src/routes/webhooks/wix-bookings.js', 'utf8'));

check('imports classifyWixBooking + pickLocationAddress',
  wixSrc.includes('classifyWixBooking') && wixSrc.includes('pickLocationAddress'));
check('passes classification to appointments.create',
  /appointments\.create\([\s\S]+classification,?/.test(wixSrc));
check('stashes wix_location_address on metadata',
  wixSrc.includes('wix_location_address'));
check('verifies JWT via decodeWixWebhook',
  wixSrc.includes('decodeWixWebhook'));
check('drops bad-sig with 200 (no retry storm)',
  wixSrc.includes('dropping unverified JWT')
  && /res\.sendStatus\(200\)[\s\S]*looksLikeJwt\s*&&\s*signatureValid\s*===\s*false/.test(wixSrc));

// ──────────────────────────────────────────────────────────────────────
// 12. END-TO-END SCENARIO TRACE — full path through synthetic bookings
// ──────────────────────────────────────────────────────────────────────
section('12. End-to-end traces — scenario per booking type');

const scenarios = [
  {
    name: 'Wix in-person — Mumbai (G D Ambekar Rd) → Bach Flower Remedy',
    classification: 'in_person',
    address: 'ICC TWO, Island City Center, G D Ambekar Road, Dadar East, Mumbai',
    joinUrl: null,
  },
  {
    name: 'Wix in-person — New Delhi → Sound Healing Session',
    classification: 'in_person',
    address: 'The Ochre Tree, Block C, New Friends Colony, New Delhi',
    title: 'Sound Healing Session',
    joinUrl: null,
  },
  {
    name: 'Wix in-person — Dubai → Crystal Spa',
    classification: 'in_person',
    address: 'JLT, Dubai',
    title: 'Crystal Spa',
    joinUrl: null,
  },
  {
    name: 'Wix distance — IN location → Bach Flower Remedy',
    classification: 'distance',
    address: 'India',
    joinUrl: null,
  },
  {
    name: 'Cal.com Zoom — Coaching Session',
    classification: 'zoom',
    address: null,
    title: 'Coaching Session',
    joinUrl: 'https://us02web.zoom.us/j/85123456789?pwd=ZGV2dGVzdA==',
  },
  {
    name: 'Cal.com Zoom — Discovery Consultation',
    classification: 'zoom',
    address: null,
    title: 'Discovery Consultation between Shivani Hariharan and Priya',
    joinUrl: 'https://zoom.us/j/99887766554',
  },
];

const scNow = Date.parse('2026-06-14T10:00:00.000Z');  // ~25h before
const scStarts = Date.parse('2026-06-15T11:30:00.000Z');

for (const s of scenarios) {
  console.log(`\n  \x1b[36m▸ ${s.name}\x1b[0m`);
  const appt = apptFixture({
    classification: s.classification,
    title: s.title,
    joinUrl: s.joinUrl,
    metadata: s.address ? { wix_location_address: s.address } : {},
    startsAt: '2026-06-15T11:30:00.000Z',
  });
  const contact = contactFixture();

  const kinds = KINDS_BY_CLASSIFICATION[s.classification];
  check(`    classification → ${kinds.length} reminder kind(s)`, kinds.length > 0);

  for (const k of kinds) {
    const when = scheduledMsFor(k, scStarts, scNow);
    const whenLabel = when === scNow ? 'now' :
      when > scStarts ? `+${(when - scStarts) / MIN}m` :
      `-${(scStarts - when) / MIN}m`;
    const audience = audienceForKind(k);
    const { components, resolved } = buildTemplateComponents(k, appt, contact);
    const body = components.find((c) => c.type === 'body');
    const btn = components.find((c) => c.type === 'button');
    check(`    ${k}: → ${audience}, fires @ ${whenLabel}, ${body.parameters.length} params${btn ? ', + URL btn' : ''}`,
      body.parameters.length > 0 && body.parameters.every((p) => p.text && p.text !== 'undefined'),
      '');
  }
}

// ──────────────────────────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────────────────────────
console.log(`\n\x1b[1m━━━ SUMMARY ━━━\x1b[0m`);
console.log(`  \x1b[32m${results.pass} passed\x1b[0m, \x1b[${results.fail ? '31' : '32'}m${results.fail} failed\x1b[0m, ${results.items.length} total`);
if (results.fail) {
  console.log('\n  \x1b[31mFailures:\x1b[0m');
  for (const r of results.items.filter((x) => !x.ok)) {
    console.log(`    ✗ ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  }
  process.exit(1);
}
process.exit(0);
