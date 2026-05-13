// Normalises Meta's webhook payload into a flat list of events:
//   { kind: 'message'|'status', ... }
// Caller iterates and handles each.

export function parseIncoming(body) {
  const events = [];
  if (!body || body.object !== 'whatsapp_business_account') return events;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const metadata = value.metadata || {};
      const contacts = value.contacts || [];
      const contactByWaId = Object.fromEntries(
        contacts.map((c) => [c.wa_id, c.profile?.name || null]),
      );

      for (const m of value.messages || []) {
        const waId = m.from;
        const name = contactByWaId[waId] || null;
        let parsed = {
          kind: 'message',
          wa_id: waId,
          name,
          wa_message_id: m.id,
          timestamp: m.timestamp ? new Date(parseInt(m.timestamp, 10) * 1000).toISOString() : new Date().toISOString(),
          type: m.type,
          body: null,
          payload: m,
          interactive_id: null,
          interactive_title: null,
        };
        switch (m.type) {
          case 'text':
            parsed.body = m.text?.body || '';
            break;
          case 'interactive': {
            const it = m.interactive || {};
            if (it.type === 'button_reply') {
              parsed.type = 'interactive_button';
              parsed.interactive_id = it.button_reply?.id;
              parsed.interactive_title = it.button_reply?.title;
              parsed.body = parsed.interactive_title;
            } else if (it.type === 'list_reply') {
              parsed.type = 'interactive_list';
              parsed.interactive_id = it.list_reply?.id;
              parsed.interactive_title = it.list_reply?.title;
              parsed.body = parsed.interactive_title;
            } else if (it.type === 'nfm_reply') {
              // WhatsApp Flow submission
              parsed.type = 'flow';
              parsed.body = '[flow_submission]';
              parsed.payload = it.nfm_reply;
            }
            break;
          }
          case 'button':
            parsed.body = m.button?.text;
            parsed.interactive_id = m.button?.payload;
            break;
          case 'image':
          case 'document':
          case 'audio':
          case 'video':
          case 'sticker':
            parsed.body = m[m.type]?.caption || `[${m.type}]`;
            break;
          case 'location':
            parsed.body = `[location:${m.location?.latitude},${m.location?.longitude}]`;
            break;
          default:
            parsed.body = `[${m.type}]`;
        }
        events.push(parsed);
      }

      for (const s of value.statuses || []) {
        events.push({
          kind: 'status',
          wa_message_id: s.id,
          status: s.status, // sent | delivered | read | failed
          timestamp: s.timestamp ? new Date(parseInt(s.timestamp, 10) * 1000).toISOString() : new Date().toISOString(),
          recipient_id: s.recipient_id,
          errors: s.errors || null,
          payload: s,
        });
      }
    }
  }
  return events;
}
