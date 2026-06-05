// Forwarder: schedule a warm nudge on ochre-funnel.
//
// Called by the flow-completion handler (Flow submitted) and the inbound
// webhook (button tap on a webinar_invite_v2 broadcast). Fires a signed
// POST to ochre-funnel's /api/jobs/schedule-warm-nudge endpoint. The
// receiver de-dupes on (funnelId, contactId) so last-touch wins —
// re-triggering doesn't double-fire.
//
// Best-effort: failures are logged but never block inbound processing.

import { createHmac } from 'node:crypto';
import { logger } from '../../logger.js';

const TIMEOUT_MS = 5000;

/**
 * @param {object} args
 * @param {string} args.phone         E.164 with or without "+"
 * @param {string} args.funnelSlug    e.g. "40s-decade"
 * @param {string} args.trigger       'tap' | 'flow_started' | 'flow_completed'
 * @param {string} [args.firstName]   from Flow form when applicable
 * @param {string} [args.email]       from Flow form when applicable
 */
export async function scheduleWarmNudge(args) {
  const url = process.env.OCHRE_FUNNEL_URL;
  const secret = process.env.OCHRE_FUNNEL_API_KEY;
  if (!url) {
    logger.debug('warm-nudge forwarder: OCHRE_FUNNEL_URL not set, skipping');
    return;
  }

  const payload = {
    phone: args.phone,
    funnelSlug: args.funnelSlug,
    lastTouchAt: new Date().toISOString(),
    trigger: args.trigger,
    firstName: args.firstName || null,
    email: args.email || null,
  };
  const bodyStr = JSON.stringify(payload);

  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    headers['X-Ochre-Funnel-Signature-256'] =
      `sha256=${createHmac('sha256', secret).update(bodyStr).digest('hex')}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/api/jobs/schedule-warm-nudge`,
      {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { status: res.status, body: text.slice(0, 200) },
        'warm-nudge forward returned non-2xx',
      );
    } else {
      logger.info(
        { phone: args.phone, funnelSlug: args.funnelSlug, trigger: args.trigger },
        'warm-nudge scheduled on ochre-funnel',
      );
    }
  } catch (err) {
    logger.warn({ err: err.message, url }, 'warm-nudge forward failed');
  } finally {
    clearTimeout(timer);
  }
}
