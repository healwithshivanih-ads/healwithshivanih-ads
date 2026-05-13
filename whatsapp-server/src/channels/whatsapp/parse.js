// Normalises Meta's `whatsapp_business_account` webhook envelope into a flat
// list of typed events. Caller iterates and dispatches.
//
// Returns NormalizedEvent[]:
//   { kind: 'message', wa_id, profile_name?, type, body?, payload, external_message_id, timestamp }
//   { kind: 'status',  external_message_id, status, recipient_id, errors?, timestamp, payload }

const TYPE_MAP = {
  text: 'text',
  image: 'image',
  document: 'document',
  audio: 'audio',
  video: 'video',
  sticker: 'sticker',
  reaction: 'reaction',
  location: 'text', // collapsed, payload preserves details
  contacts: 'text',
};

export function parseIncoming(envelope) {
  const events = [];
  if (!envelope || envelope.object !== 'whatsapp_business_account') return events;

  for (const entry of envelope.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const profileByWaId = Object.fromEntries(
        (value.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]),
      );

      for (const m of value.messages || []) {
        const waId = m.from;
        const tsIso = m.timestamp
          ? new Date(parseInt(m.timestamp, 10) * 1000).toISOString()
          : new Date().toISOString();

        const ev = {
          kind: 'message',
          wa_id: waId,
          profile_name: profileByWaId[waId] || null,
          external_message_id: m.id,
          timestamp: tsIso,
          type: TYPE_MAP[m.type] || m.type || 'text',
          body: null,
          payload: m,
        };

        switch (m.type) {
          case 'text':
            ev.body = m.text?.body || '';
            break;
          case 'interactive': {
            const it = m.interactive || {};
            if (it.type === 'button_reply') {
              ev.type = 'interactive_button';
              ev.body = it.button_reply?.title || '';
              ev.payload = { ...m, _normalized: it.button_reply };
            } else if (it.type === 'list_reply') {
              ev.type = 'interactive_list';
              ev.body = it.list_reply?.title || '';
              ev.payload = { ...m, _normalized: it.list_reply };
            } else if (it.type === 'nfm_reply') {
              ev.type = 'flow';
              ev.body = '[flow_submission]';
              ev.payload = { ...m, _normalized: it.nfm_reply };
            } else {
              ev.type = 'text';
              ev.body = `[interactive:${it.type}]`;
            }
            break;
          }
          case 'button':
            ev.type = 'interactive_button';
            ev.body = m.button?.text || '';
            ev.payload = { ...m, _normalized: m.button };
            break;
          case 'image':
          case 'document':
          case 'audio':
          case 'video':
          case 'sticker':
            ev.body = m[m.type]?.caption || `[${m.type}]`;
            break;
          case 'reaction':
            ev.type = 'reaction';
            ev.body = m.reaction?.emoji || '[reaction]';
            break;
          case 'location':
            ev.body = `[location:${m.location?.latitude},${m.location?.longitude}]`;
            break;
          default:
            ev.body = `[${m.type}]`;
        }
        events.push(ev);
      }

      for (const s of value.statuses || []) {
        events.push({
          kind: 'status',
          external_message_id: s.id,
          status: s.status, // sent | delivered | read | failed
          recipient_id: s.recipient_id,
          errors: s.errors || null,
          timestamp: s.timestamp
            ? new Date(parseInt(s.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
          payload: s,
        });
      }
    }
  }
  return events;
}
