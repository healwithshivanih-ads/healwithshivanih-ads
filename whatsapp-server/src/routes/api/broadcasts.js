import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import * as contactsSvc from '../../services/contacts/index.js';
import * as convSvc from '../../services/conversations/index.js';
import * as msgsSvc from '../../services/messages/index.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import { normalizePhone } from '../../util/phone.js';
import { OutsideServiceWindowError, ValidationError, NotFoundError } from '../../errors.js';
import { logger } from '../../logger.js';
import { db } from '../../db.js';

// origin_ref is a uuid column in the messages table — anything else triggers
// `invalid input syntax for type uuid`. If the caller hands us a UUID we use
// it; otherwise we mint one per broadcast so all recipients share it (useful
// for "show me all messages from broadcast X").
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const broadcastsRouter = Router();

// POST /api/broadcasts
//
// Send a templated WhatsApp message to a list of recipients. Each recipient
// can carry its own params (mail-merge) or fall back to a shared params array.
//
// Body shape:
//   {
//     templateName,                 // required
//     templateLanguage = 'en',
//     templateParams?: string[],    // shared fallback if recipient.params absent
//     recipients: [
//       { phone, name?, params?: string[] },
//       ...
//     ],
//     dryRun?: boolean,             // skip the actual Meta API call; just report
//     origin = 'broadcast',
//     originRef?: string            // e.g. ochre programme slug, broadcast UUID
//   }
//
// Returns:
//   {
//     ok: true,
//     total, sent, failed, skipped,
//     results: [
//       { phone, ok, message_id?, external_message_id?, conversation_id?, error?, code? },
//       ...
//     ]
//   }
//
// Sequential delivery is intentional — Meta's per-number rate limit and our
// quality rating both prefer steady pacing over bursts. With ~50 contacts a
// broadcast finishes in ~20 s.
broadcastsRouter.post('/', async (req, res, next) => {
  try {
    const {
      templateName,
      templateLanguage = 'en',
      templateParams,
      // Shared URL-button param for templates with a `URL` CTA button whose
      // URL contains a {{N}} suffix (e.g. webinar templates →
      // https://lp.theochretree.com/lp/{{1}}). Same value for every
      // recipient (one webinar → one slug). Per-recipient override is
      // supported via `recipient.buttonUrlParam` if mail-merge ever needs
      // different slugs (unusual).
      buttonUrlParam,
      recipients,
      dryRun = false,
      origin = 'broadcast',
      originRef,
      // Which number to send AS: 'marketing' (88501) | 'clients'/'default' (89765).
      // Omit → default number. Applies to every recipient in this broadcast.
      from,
    } = req.body || {};

    if (!templateName) throw new ValidationError('templateName required');
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new ValidationError('recipients[] required (non-empty)');
    }
    if (recipients.length > 1000) {
      throw new ValidationError('recipients[] cannot exceed 1000 entries per broadcast');
    }

    const ws = await getDefaultWorkspace();
    // Stable UUID for this broadcast — every recipient row's origin_ref points
    // to it. Caller can override by passing a real UUID; non-UUID strings
    // (like "admin_ui" or "broadcast/phones/2026-…") are ignored and a fresh
    // one is minted.
    const broadcastId = originRef && UUID_RE.test(originRef) ? originRef : randomUUID();
    const results = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const r of recipients) {
      if (!r?.phone) {
        skipped++;
        results.push({ phone: null, ok: false, error: 'phone missing', code: 'no_phone' });
        continue;
      }

      const normalised = normalizePhone(r.phone);
      if (!normalised) {
        skipped++;
        results.push({ phone: r.phone, ok: false, error: 'phone unparseable', code: 'bad_phone' });
        continue;
      }

      const params = Array.isArray(r.params) && r.params.length
        ? r.params
        : Array.isArray(templateParams)
          ? templateParams
          : [];

      // Per-recipient URL-button param override (rare) falls back to the
      // shared top-level value.
      const recipientButtonUrlParam = r.buttonUrlParam || buttonUrlParam;

      if (dryRun) {
        results.push({
          phone: normalised,
          ok: true,
          dry_run: true,
          params,
          button_url_param: recipientButtonUrlParam,
        });
        sent++;
        continue;
      }

      try {
        const { contact } = await contactsSvc.upsert({
          primary_phone: normalised,
          display_name: r.name || undefined,
          identities: [{ channel: 'whatsapp', external_id: normalised, is_primary: true }],
        });
        const conv = await convSvc.getOrCreate(ws.id, contact.id, 'whatsapp');

        // Assemble template components: body params (if any) + URL button
        // param (if any). Either, both, or neither — empty array means
        // "fire the template with no variables" which works for static
        // templates.
        const tplComponents = [];
        if (params.length) {
          tplComponents.push({
            type: 'body',
            parameters: params.map((p) => ({ type: 'text', text: String(p) })),
          });
        }
        if (recipientButtonUrlParam) {
          tplComponents.push({
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: String(recipientButtonUrlParam) }],
          });
        }

        const message = await msgsSvc.send({
          workspaceId: ws.id,
          conversationId: conv.id,
          contactId: contact.id,
          channel: 'whatsapp',
          type: 'template',
          templateName,
          templateLanguage,
          templateVariables: tplComponents.length
            ? { components: tplComponents }
            : undefined,
          origin,
          originRef: broadcastId,
          from: from || undefined,
        });
        results.push({
          phone: normalised,
          ok: true,
          message_id: message.id,
          external_message_id: message.external_message_id,
          conversation_id: conv.id,
        });
        sent++;
      } catch (e) {
        const isWindow = e instanceof OutsideServiceWindowError;
        results.push({
          phone: normalised,
          ok: false,
          error: e.message,
          code: isWindow ? 'outside_service_window' : e.code || 'send_failed',
        });
        failed++;
        logger.warn({ err: e.message, phone: normalised }, 'broadcast recipient failed');
      }
    }

    return res.json({
      ok: true,
      broadcast_id: broadcastId,
      total: recipients.length,
      sent,
      failed,
      skipped,
      results,
    });
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json({ ok: false, code: 'validation_error', error: e.message });
    }
    next(e);
  }
});

// GET /api/broadcasts/:id — rollup of delivery status for a broadcast.
//
// `:id` is the UUID returned by the POST endpoint as `broadcast_id`. We use
// it as origin_ref on every recipient's `messages` row, so the rollup is a
// simple aggregation by status over messages.origin_ref.
//
// Meta callbacks asynchronously update the status column (queued → sent →
// delivered → read, or → failed with an error payload). The dispatch-time
// numbers from the POST response are first-touch — call this endpoint
// later to get true delivery / read counts.
broadcastsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    // Validate UUID shape — origin_ref is a uuid column; a malformed value
    // would error inside Postgres rather than returning a 404.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) {
      throw new ValidationError('broadcast id must be a UUID');
    }

    const { data, error } = await db()
      .from('messages')
      .select('id,status,sent_at,external_message_id,error,contact_id,conversation_id')
      .eq('origin_ref', id)
      .eq('direction', 'outbound')
      .order('sent_at', { ascending: true });
    if (error) throw error;

    if (!data || data.length === 0) {
      throw new NotFoundError(`no messages found for broadcast ${id}`);
    }

    // Status rollup. Meta's lifecycle: queued → sent → delivered → read,
    // or → failed at any point. Group counts plus surface failures so the
    // coach can see which recipients didn't make it.
    const counts = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, other: 0 };
    const failures = [];
    for (const m of data) {
      const s = m.status || 'other';
      if (s in counts) counts[s] += 1;
      else counts.other += 1;
      if (s === 'failed') {
        failures.push({
          message_id: m.id,
          external_message_id: m.external_message_id,
          contact_id: m.contact_id,
          error: m.error,
        });
      }
    }

    return res.json({
      ok: true,
      broadcast_id: id,
      total: data.length,
      counts,
      // Quick top-line: how many actually made it to the device vs not yet.
      delivered_or_read: counts.delivered + counts.read,
      first_sent_at: data[0]?.sent_at || null,
      last_sent_at: data[data.length - 1]?.sent_at || null,
      failures,
    });
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json({ ok: false, code: 'validation_error', error: e.message });
    }
    if (e instanceof NotFoundError) {
      return res.status(404).json({ ok: false, code: 'not_found', error: e.message });
    }
    next(e);
  }
});
