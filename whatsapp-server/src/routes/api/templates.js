// List approved WhatsApp templates from the Meta WABA.
//
// Powers the Broadcast page's template picker — fetches live so newly-
// approved templates show up without a code change. Cached in-process
// for 60s to stay polite to Meta's API. The /api/* auth gate (admin
// x-api-key) wraps this; no additional auth needed here.
//
// Returns an array of:
//   {
//     name: "appt_confirm_inperson_client",
//     language: "en",
//     category: "UTILITY",
//     status: "APPROVED",
//     bodyText: "Hi {{1}}! Your in-person {{4}} session is confirmed for {{2}} at {{3}}.\n\n📍 {{5}}\n\n…",
//     paramCount: 5,
//     params: [
//       { index: 1, label: "Variable 1", placeholder: "Priya" },
//       { index: 2, label: "Variable 2", placeholder: "20 May 2026" },
//       ... // derived from the template's `example` array when present
//     ],
//     hasUrlButton: false,
//     urlButtonUrl: null,
//     quickReplyButtons: []
//   }

import { Router } from 'express';
import fetch from 'node-fetch';
import { config, resolveWhatsappNumber } from '../../config.js';
import { logger } from '../../logger.js';

export const templatesRouter = Router();

// Per-number-key cache so switching between main and marketing doesn't
// thrash. Keyed by the resolved phoneNumberId+wabaId so misconfigs don't
// leak between numbers.
const caches = new Map(); // key → { fetchedAt: ms, items: [...] }
const CACHE_TTL_MS = 60_000;

templatesRouter.get('/', async (req, res, next) => {
  try {
    // `from` selects which WABA to list templates from:
    //   undefined | 'default' | 'clients' → Ochre Tree (89765, the main number)
    //   'marketing'                       → HealwithshivaniH (88501, broadcasts)
    // Both share the same System User token. Each WABA has its OWN approved
    // template set — broadcasts page should use 'marketing'.
    const from = (req.query.from || 'default').toString();
    let number;
    try {
      number = resolveWhatsappNumber(from);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const wabaId = number.businessAccountId;
    const token = number.token;
    const graphVersion = config.whatsapp.graphVersion || 'v21.0';
    if (!wabaId || !token) {
      return res.status(500).json({ error: `WABA id or token not configured for "${from}"` });
    }

    const cacheKey = `${wabaId}|${number.phoneNumberId}`;
    if (req.query.refresh === '1') caches.delete(cacheKey);
    const cached = caches.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return res.json({
        items: cached.items,
        from,
        waba_id: wabaId,
        cached_age_ms: Date.now() - cached.fetchedAt,
      });
    }

    const url = `https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates`
      + `?limit=100&fields=name,language,status,category,components`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const text = await r.text();
      logger.warn({ status: r.status, body: text.slice(0, 200) }, 'templates: meta fetch failed');
      return res.status(502).json({ error: 'meta_fetch_failed', meta_status: r.status, body: text.slice(0, 500) });
    }
    const body = await r.json();
    const raw = body?.data || [];
    const items = raw.map(normalise).filter(Boolean);
    caches.set(cacheKey, { fetchedAt: Date.now(), items });
    res.json({ items, from, waba_id: wabaId, cached_age_ms: 0 });
  } catch (e) {
    next(e);
  }
});

/**
 * Normalise a Meta template record into the shape the Broadcast UI consumes.
 * Returns null for non-APPROVED templates (we don't surface PENDING / REJECTED
 * to coaches).
 */
function normalise(t) {
  if (t.status !== 'APPROVED') return null;
  const components = t.components || [];
  const body = components.find((c) => c.type === 'BODY');
  const bodyText = body?.text || '';
  const bodyExample = body?.example?.body_text?.[0] || [];

  // {{N}} placeholders in body — count how many, derive `params` with
  // example values from Meta when present.
  const paramIndices = Array.from(new Set(
    (bodyText.match(/\{\{(\d+)\}\}/g) || [])
      .map((m) => parseInt(m.slice(2, -2), 10)),
  )).sort((a, b) => a - b);
  const params = paramIndices.map((i) => ({
    index: i,
    label: `Variable ${i}`,
    placeholder: bodyExample[i - 1] || '',
  }));

  // Buttons — URL button and quick-reply buttons
  const buttonsComp = components.find((c) => c.type === 'BUTTONS');
  let hasUrlButton = false;
  let urlButtonUrl = null;
  let urlButtonText = null;
  const quickReplyButtons = [];
  for (const b of buttonsComp?.buttons || []) {
    if (b.type === 'URL') {
      hasUrlButton = true;
      urlButtonUrl = b.url;
      urlButtonText = b.text;
    } else if (b.type === 'QUICK_REPLY') {
      quickReplyButtons.push(b.text);
    }
  }

  // Header — surface for context (some templates have an image header)
  const header = components.find((c) => c.type === 'HEADER');
  const headerType = header?.format || null;
  const headerText = header?.text || null;

  return {
    name: t.name,
    language: t.language,
    category: t.category,           // UTILITY | MARKETING | AUTHENTICATION
    status: t.status,
    bodyText,
    paramCount: paramIndices.length,
    params,
    headerType,
    headerText,
    hasUrlButton,
    urlButtonUrl,
    urlButtonText,
    quickReplyButtons,
  };
}
