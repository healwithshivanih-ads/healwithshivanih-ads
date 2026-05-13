import { sendTemplate } from '../whatsapp/client.js';
import { db } from '../db.js';
import { getOrCreateConversation } from './conversations.js';

// Convenience wrapper that takes a contact_id (not wa_id) and looks up the rest.
export async function sendApprovedTemplate({
  contactId,
  templateName,
  languageCode = 'en',
  variables = {},
}) {
  const supabase = db();
  const { data: contact, error } = await supabase.from('contacts').select('*').eq('id', contactId).maybeSingle();
  if (error || !contact) throw new Error('contact not found');

  const conv = await getOrCreateConversation(contactId);

  // Convert variables object into body params (positional). If caller passes
  // an array as `variables.body`, use that. Otherwise we use object values in order.
  let bodyParams = [];
  if (Array.isArray(variables.body)) {
    bodyParams = variables.body.map((v) => ({ type: 'text', text: String(v) }));
  } else if (Array.isArray(variables)) {
    bodyParams = variables.map((v) => ({ type: 'text', text: String(v) }));
  } else if (variables && typeof variables === 'object') {
    bodyParams = Object.values(variables).map((v) => ({ type: 'text', text: String(v) }));
  }

  const components = bodyParams.length ? [{ type: 'body', parameters: bodyParams }] : [];

  return sendTemplate({
    to: contact.wa_id,
    templateName,
    languageCode,
    components,
    conversationId: conv.id,
    contactId,
  });
}
