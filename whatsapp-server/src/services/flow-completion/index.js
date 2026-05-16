// Flow-completion handler.
//
// When a user finishes a WhatsApp Flow (clicked "Save my spot" on the
// 40s-decade form), Meta sends an inbound webhook with `type: nfm_reply`.
// `channels/whatsapp/parse.js` normalises it to `ev.type = 'flow'`. Here
// we:
//
//   1. Extract the form data from response_json
//   2. Map to a campaign (workshop slug) — currently a 1:1 lookup since
//      we only have the one Flow live. When we add more, switch to
//      `flow_token` (set per-send) for routing
//   3. Build a personalised LP URL: prefill first name + email +
//      phone + concern + UTM
//   4. Send the LP link back as a free-form WhatsApp message — we're
//      inside the post-click 24h window so no template needed
//
// Idempotency: the inbound logInbound() already dedupes on external
// message id, so Meta retries on this completion event won't double-
// send. We don't track our own "did we already follow up?" state.

import { logger } from '../../logger.js';
import * as wa from '../../channels/whatsapp/client.js';

// Map Flow → campaign metadata. Add entries as new Flows ship.
//
// Determining "which Flow this is" — Meta puts the Flow id on the
// inbound message as `interactive.nfm_reply.name` (the registered Flow
// name in the WABA). For now we just key on whether the payload looks
// like our 40s-decade form (has a `concern` field with our 5 ids).
//
// Better long-term: send a `flow_token` when launching the Flow from a
// template/ad and route on that. Move to that once we have >1 Flow.
const CAMPAIGNS = {
  '40s-decade-jun11': {
    slug: '40s-decade-jun11',
    title: '40s: The Decade No One Prepared You For',
    date_label: 'Thursday 11 June',
    time_label: '7:00 PM IST',
    price_label: '₹199',
    lp_base: 'https://lp.theochretree.com/lp/40s-decade-jun11',
    concerns: ['sleep', 'energy', 'weight', 'mood', 'all'],
  },
};

/**
 * Best-effort campaign detection. Walks the response_json keys to figure
 * out which campaign's Flow this submission belongs to. Returns the
 * CAMPAIGNS entry or null.
 */
function pickCampaign(formData) {
  // The 40s-decade flow has a `concern` field with these specific ids.
  if (formData && typeof formData.concern === 'string'
      && CAMPAIGNS['40s-decade-jun11'].concerns.includes(formData.concern)) {
    return CAMPAIGNS['40s-decade-jun11'];
  }
  return null;
}

function buildLpUrl(campaign, formData, waId) {
  const params = new URLSearchParams({
    utm_source: 'meta_ctwa',
    utm_medium: 'whatsapp_flow',
    utm_campaign: campaign.slug,
    phone: waId,
  });
  if (formData.first_name) params.set('firstName', formData.first_name);
  if (formData.email) params.set('email', formData.email);
  if (formData.concern) params.set('qual', formData.concern);
  return `${campaign.lp_base}?${params.toString()}`;
}

// Concern → warm acknowledgement line. Mirrors the Flow dropdown ids so that
// every reply names the user's specific concern back to them. Keeps the
// initial response feeling personal rather than generic.
const CONCERN_ACK = {
  sleep:
    "The 3am wake-up is so often where this whole thing starts — there's a real biology behind it and I'll walk you through it on the 11th.",
  energy:
    "The 4pm crash is real and it's not just \"getting older\" — your hormones have changed how you handle food and stress. I'll explain on the 11th.",
  weight:
    "The middle-weight thing in your 40s is one of the most workable patterns once you understand what's driving it. Coming up on the 11th.",
  mood:
    "Hot flashes and irritability has a clear hormone story behind it that nobody told us. I'll cover it on the 11th.",
  all:
    '"Honestly, all of it" is what most women say — and it usually IS connected. One root cause, four hormone shifts. I\'ll walk through the whole picture on the 11th.',
};

const CONCERN_NUDGE = {
  sleep:  "Sleep is one of the easiest patterns to shift once you understand it.",
  energy: "Energy comes back faster than you'd think once the right pieces are in place.",
  weight: "The weight piece is more about the hormones than discipline.",
  mood:   "The mood and hot-flash piece has clean, evidence-based answers.",
  all:    "When it's 'all of it', there's usually one root cause — that's exactly what the workshop unpacks.",
};

function greeting(firstName) {
  return firstName ? `Hi ${firstName}` : 'Hi there';
}

function buildFollowUpText(campaign, formData, lpUrl) {
  const ack = CONCERN_ACK[formData.concern] || '';
  return [
    `${greeting(formData.first_name)} — so glad you reached out.`,
    '',
    ack,
    '',
    `Your spot: ${lpUrl}`,
    `${campaign.price_label} · ${campaign.date_label} · ${campaign.time_label} · 60 min on Zoom · recording yours for life.`,
    '',
    'Any questions, just reply here.',
    '',
    '— Shivani Hari',
  ].join('\n');
}

function buildNudgeText(campaign, formData, lpUrl) {
  const nudge = CONCERN_NUDGE[formData.concern] || '';
  return [
    `${greeting(formData.first_name)} — quick check-in.`,
    '',
    `${nudge} The recording stays yours for life, so even if Thursday doesn't work, you won't miss out.`,
    '',
    `Your spot: ${lpUrl}`,
    '',
    "Any questions? I'm here.",
    '',
    '— Shivani Hari',
  ].join('\n');
}

export async function handleFlowCompletion({ event, contact /* , conversation */ }) {
  // Pull the encrypted form response Meta put on the inbound event.
  // parse.js stores it as ev.payload._normalized.response_json (a JSON
  // string).
  const responseJsonStr = event?.payload?._normalized?.response_json;
  if (!responseJsonStr) {
    logger.warn({ wa_id: event.wa_id }, 'flow completion: no response_json');
    return;
  }
  let formData;
  try {
    formData = JSON.parse(responseJsonStr);
  } catch (e) {
    logger.error({ err: e.message, raw: responseJsonStr.slice(0, 200) }, 'flow completion: bad JSON');
    return;
  }

  const campaign = pickCampaign(formData);
  if (!campaign) {
    logger.warn({ wa_id: event.wa_id, formData }, 'flow completion: campaign not matched, skipping follow-up');
    return;
  }

  const lpUrl = buildLpUrl(campaign, formData, event.wa_id);
  const text = buildFollowUpText(campaign, formData, lpUrl);

  logger.info(
    {
      wa_id: event.wa_id,
      contact_id: contact?.id,
      campaign: campaign.slug,
      first_name: formData.first_name || '(none)',
      email: formData.email || '(none)',
      concern: formData.concern,
      lp_url: lpUrl,
    },
    'flow completion: sending LP link',
  );

  try {
    await wa.sendText({ to: event.wa_id, body: text });
  } catch (e) {
    logger.error({ err: e.message, wa_id: event.wa_id }, 'flow completion: failed to send LP link');
    throw e;
  }

  // Touch 1 — +2h soft nudge if they haven't replied or paid yet. Stays
  // inside the 24h customer-service window so we can keep it freeform (no
  // template needed).
  //
  // LIMITATION: in-process setTimeout. If the server restarts within 2h,
  // the scheduled nudge is lost. Acceptable trade-off for the initial
  // ship — a persistent ctwa_nudges table + runner tick is a follow-up.
  // Touches at +24h and +3d will need persistence (template-based) when
  // we add them.
  const waId = event.wa_id;
  const nudgeText = buildNudgeText(campaign, formData, lpUrl);
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const t = setTimeout(() => {
    wa.sendText({ to: waId, body: nudgeText })
      .then(() => logger.info({ wa_id: waId, campaign: campaign.slug }, 'flow completion: Touch 1 (+2h) sent'))
      .catch((err) => logger.error({ err: err.message, wa_id: waId }, 'flow completion: Touch 1 send failed'));
  }, TWO_HOURS_MS);
  t.unref?.();
  logger.info({ wa_id: waId, campaign: campaign.slug }, 'flow completion: Touch 1 scheduled for +2h');
}
