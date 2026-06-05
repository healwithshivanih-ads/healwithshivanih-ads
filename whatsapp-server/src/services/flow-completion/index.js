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

import { createHmac } from 'node:crypto';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import * as wa from '../../channels/whatsapp/client.js';
import { scheduleWarmNudge } from '../warm-nudge-forwarder/index.js';

const OCHRE_FORWARD_TIMEOUT_MS = 5000;

/**
 * Fire-and-forget POST to the Ochre flow-completion webhook so the FM /
 * coaching app can upsert a Contact + push to Wix CRM. Signed with
 * HMAC-SHA256 over the JSON body bytes (X-Ochre-Flow-Signature-256). No-op
 * if config.ochreFlowWebhook.url is unset.
 */
async function forwardFlowCompletionToOchre({ campaign, formData, waId, contact }) {
  const url = config.ochreFlowWebhook.url;
  const secret = config.ochreFlowWebhook.secret;
  if (!url) return;

  const payload = {
    type: 'flow_completion',
    campaign: campaign.slug,
    campaign_title: campaign.title,
    // Short, CRM-friendly display name for the per-campaign Wix label.
    // Falls back to title on the ochre side if absent.
    campaign_label: campaign.wix_campaign_label || campaign.title,
    wa_id: waId,
    first_name: formData.first_name || null,
    email: formData.email || null,
    concern: formData.concern || null,
    contact_id: contact?.id || null,
    contact_display_name: contact?.display_name || null,
    submitted_at: new Date().toISOString(),
    raw_form_data: formData,
  };
  const bodyStr = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    const sig = createHmac('sha256', secret).update(bodyStr).digest('hex');
    headers['X-Ochre-Flow-Signature-256'] = `sha256=${sig}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCHRE_FORWARD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { status: res.status, url, body: text.slice(0, 200) },
        'ochre flow-completion forward returned non-2xx',
      );
    } else {
      logger.info({ wa_id: waId, campaign: campaign.slug, url }, 'ochre flow-completion forwarded');
    }
  } catch (err) {
    logger.warn({ err: err.message, url }, 'ochre flow-completion forward failed');
  } finally {
    clearTimeout(timer);
  }
}

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
    wix_campaign_label: "40's Decade",
    date_label: 'Thursday 11 June',
    time_label: '7:00 PM IST',
    price_label: '₹199',
    lp_base: 'https://lp.theochretree.com/lp/40s-decade-jun11',
    concerns: ['sleep', 'energy', 'weight', 'mood', 'all'],
    // Poster shown as the image header on Touch 0 + Touch 1. Must be a
    // publicly reachable JPG/PNG ≤5 MB. Square (1:1) renders best in
    // WhatsApp's interactive bubble. Leave null until the poster is ready
    // — the cta_url message is still valid without a header.
    header_image_url: null,
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

// Touch 0 body — sent immediately after Flow submission. Adds context (who
// Shivani is + which workshop they came in for) before the concern-specific
// acknowledgement, because CTWA leads may have forgotten the ad already by
// the time they finish the Flow. Body text only — the URL is moved to a
// CTA button so the user sees a clean "Reserve my seat" tap target instead
// of a raw URL.
function buildFollowUpBody(campaign, formData) {
  const ack = CONCERN_ACK[formData.concern] || '';
  return [
    `${greeting(formData.first_name)} — so glad you reached out!`,
    '',
    `I'm Shivani Hariharan, a Functional Health Coach. You signed up through my ad for *${campaign.title}* — my upcoming live workshop on the hormone shifts behind sleep, mood, weight and brain fog in your 40s.`,
    '',
    `📅 ${campaign.date_label} · ${campaign.time_label} · ${campaign.price_label} · 60 min on Zoom · recording yours for life.`,
    '',
    ack,
    '',
    'Tap below to reserve your spot — or reply with any questions, I\'m here.',
  ].join('\n');
}

// Touch 1 body — +2h nudge. Keeps the context (workshop name + date) so a
// distracted user re-orients instantly. The button takes them to the same
// pre-filled LP.
function buildNudgeBody(campaign, formData) {
  const nudge = CONCERN_NUDGE[formData.concern] || '';
  return [
    `${greeting(formData.first_name)} — quick nudge.`,
    '',
    `Just checking in case my earlier message slipped past your inbox — this is about *${campaign.title}* on ${campaign.date_label}, ${campaign.time_label}.`,
    '',
    `${nudge} The recording stays yours for life, so even if ${campaign.date_label.split(' ')[0]} doesn\'t work, you won\'t miss out.`,
    '',
    'Tap below to reserve your spot, or reply with any questions.',
  ].join('\n');
}

export async function handleFlowCompletion({ event, contact /* , conversation */ }) {
  // (forwarder fires after we extract formData below)
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

  // Fire-and-forget: schedule a +6h warm nudge on ochre-funnel. Receiver
  // is keyed on funnelSlug — campaign.slug matches the Funnel.slug column.
  // Idempotent: same (funnel, contact) just bumps scheduledFor.
  scheduleWarmNudge({
    phone: event.wa_id,
    funnelSlug: campaign.slug,
    trigger: 'flow_completed',
    firstName: formData.first_name || undefined,
    email: formData.email || undefined,
  }).catch(() => {});

  const lpUrl = buildLpUrl(campaign, formData, event.wa_id);
  const body = buildFollowUpBody(campaign, formData);

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
    'flow completion: sending Touch 0 (cta_url button)',
  );

  try {
    await wa.sendCtaUrl({
      to: event.wa_id,
      body,
      headerImageUrl: campaign.header_image_url || undefined,
      footerText: '— Shivani Hari',
      displayText: 'Reserve my seat',
      url: lpUrl,
    });
  } catch (e) {
    logger.error({ err: e.message, wa_id: event.wa_id }, 'flow completion: Touch 0 send failed');
    throw e;
  }

  // Fire-and-forget POST to ochre so it can upsert the Contact + push to
  // Wix CRM. Errors logged but don't block the rest of the handler. Runs
  // AFTER the LP link send so the user-visible follow-up isn't delayed by
  // ochre being slow.
  forwardFlowCompletionToOchre({
    campaign,
    formData,
    waId: event.wa_id,
    contact,
  }).catch(() => {});

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
  const nudgeBody = buildNudgeBody(campaign, formData);
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const t = setTimeout(() => {
    wa.sendCtaUrl({
      to: waId,
      body: nudgeBody,
      headerImageUrl: campaign.header_image_url || undefined,
      footerText: '— Shivani Hari',
      displayText: 'Reserve my seat',
      url: lpUrl,
    })
      .then(() => logger.info({ wa_id: waId, campaign: campaign.slug }, 'flow completion: Touch 1 (+2h) sent'))
      .catch((err) => logger.error({ err: err.message, wa_id: waId }, 'flow completion: Touch 1 send failed'));
  }, TWO_HOURS_MS);
  t.unref?.();
  logger.info({ wa_id: waId, campaign: campaign.slug }, 'flow completion: Touch 1 scheduled for +2h');
}
