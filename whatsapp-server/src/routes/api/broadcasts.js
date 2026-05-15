import { Router } from 'express';
import * as contactsSvc from '../../services/contacts/index.js';
import * as convSvc from '../../services/conversations/index.js';
import * as msgsSvc from '../../services/messages/index.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';
import { normalizePhone } from '../../util/phone.js';
import { OutsideServiceWindowError, ValidationError } from '../../errors.js';
import { logger } from '../../logger.js';

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
      recipients,
      dryRun = false,
      origin = 'broadcast',
      originRef,
    } = req.body || {};

    if (!templateName) throw new ValidationError('templateName required');
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new ValidationError('recipients[] required (non-empty)');
    }
    if (recipients.length > 1000) {
      throw new ValidationError('recipients[] cannot exceed 1000 entries per broadcast');
    }

    const ws = await getDefaultWorkspace();
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

      if (dryRun) {
        results.push({
          phone: normalised,
          ok: true,
          dry_run: true,
          params,
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

        const message = await msgsSvc.send({
          workspaceId: ws.id,
          conversationId: conv.id,
          contactId: contact.id,
          channel: 'whatsapp',
          type: 'template',
          templateName,
          templateLanguage,
          templateVariables: params.length
            ? {
              components: [
                {
                  type: 'body',
                  parameters: params.map((p) => ({ type: 'text', text: String(p) })),
                },
              ],
            }
            : undefined,
          origin,
          originRef,
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
