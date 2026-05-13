import { Router } from 'express';
import express from 'express';
import { db } from '../db.js';
import { logger } from '../logger.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { addTag, removeTag, listTags } from '../services/contacts.js';
import { createAppointment } from '../services/appointments.js';
import { sendApprovedTemplate } from '../services/templates.js';
import { sendText, OutsideServiceWindowError } from '../whatsapp/client.js';

export const adminRouter = Router();
adminRouter.use(express.json());
adminRouter.use(adminAuth);

// ---------------- Stats ---------------------------------------------------
adminRouter.get('/stats', async (_req, res, next) => {
  try {
    const supabase = db();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();
    const [{ count: contacts }, { count: openConvs }, { count: upcoming }, { count: msgsToday }] = await Promise.all([
      supabase.from('contacts').select('*', { count: 'exact', head: true }),
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'scheduled').gte('starts_at', new Date().toISOString()),
      supabase.from('messages').select('*', { count: 'exact', head: true }).gte('created_at', todayIso),
    ]);
    res.json({
      contacts: contacts || 0,
      open_conversations: openConvs || 0,
      upcoming_appointments: upcoming || 0,
      messages_today: msgsToday || 0,
    });
  } catch (e) { next(e); }
});

// ---------------- Contacts -----------------------------------------------
adminRouter.get('/contacts', async (req, res, next) => {
  try {
    const supabase = db();
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const search = (req.query.search || '').toString().trim();
    const tag = (req.query.tag || '').toString().trim();

    let query = supabase
      .from('contacts')
      .select('id, wa_id, phone, name, opt_in_source, last_seen_at, created_at, contact_tags(tag_id, tags(name, color))', { count: 'exact' })
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,wa_id.ilike.%${search}%`);
    }
    const { data, count, error } = await query;
    if (error) throw error;

    let rows = (data || []).map((c) => ({
      ...c,
      tags: (c.contact_tags || []).map((ct) => ct.tags?.name).filter(Boolean),
    }));
    if (tag) rows = rows.filter((r) => r.tags.includes(tag));

    res.json({ rows, total: count || 0, limit, offset });
  } catch (e) { next(e); }
});

adminRouter.get('/contacts/:id', async (req, res, next) => {
  try {
    const supabase = db();
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!contact) return res.status(404).json({ error: 'not_found' });
    const tags = await listTags(contact.id);
    const { data: conv } = await supabase
      .from('conversations')
      .select('*')
      .eq('contact_id', contact.id)
      .maybeSingle();
    const { data: appts } = await supabase
      .from('appointments')
      .select('*')
      .eq('contact_id', contact.id)
      .order('starts_at', { ascending: false })
      .limit(20);
    res.json({ contact, tags, conversation: conv || null, appointments: appts || [] });
  } catch (e) { next(e); }
});

adminRouter.post('/contacts/:id/tags', async (req, res, next) => {
  try {
    const { tag } = req.body || {};
    if (!tag) return res.status(400).json({ error: 'tag required' });
    const t = await addTag(req.params.id, String(tag).trim());
    res.json({ tag: t });
  } catch (e) { next(e); }
});

adminRouter.delete('/contacts/:id/tags/:tag', async (req, res, next) => {
  try {
    await removeTag(req.params.id, req.params.tag);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Conversations -------------------------------------------
adminRouter.get('/conversations', async (req, res, next) => {
  try {
    const supabase = db();
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const status = req.query.status?.toString();
    let q = supabase
      .from('conversations')
      .select('*, contacts(id, wa_id, phone, name)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ rows: data || [] });
  } catch (e) { next(e); }
});

adminRouter.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const supabase = db();
    const { data: conv } = await supabase.from('conversations').select('*, contacts(id, wa_id, name, phone)').eq('id', req.params.id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'not_found' });
    const { data: msgs, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    res.json({ conversation: conv, messages: msgs || [] });
  } catch (e) { next(e); }
});

adminRouter.post('/conversations/:id/reply', async (req, res, next) => {
  try {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'body required' });
    const supabase = db();
    const { data: conv } = await supabase.from('conversations').select('*, contacts(*)').eq('id', req.params.id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'not_found' });
    try {
      const result = await sendText({
        to: conv.contacts.wa_id,
        body: body.trim(),
        conversationId: conv.id,
        contactId: conv.contact_id,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof OutsideServiceWindowError) {
        return res.status(409).json({ error: 'outside_service_window', message: err.message });
      }
      throw err;
    }
  } catch (e) { next(e); }
});

// ---------------- Appointments --------------------------------------------
adminRouter.get('/appointments', async (req, res, next) => {
  try {
    const supabase = db();
    const status = req.query.status?.toString();
    const from = req.query.from?.toString();
    const to = req.query.to?.toString();
    let q = supabase
      .from('appointments')
      .select('*, contacts(id, name, wa_id, phone)')
      .order('starts_at', { ascending: true })
      .limit(200);
    if (status) q = q.eq('status', status);
    if (from) q = q.gte('starts_at', from);
    if (to) q = q.lte('starts_at', to);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ rows: data || [] });
  } catch (e) { next(e); }
});

adminRouter.post('/appointments', async (req, res, next) => {
  try {
    const { contact_id, starts_at, title, source = 'manual', ends_at, notes, location, join_url } = req.body || {};
    if (!contact_id || !starts_at) {
      return res.status(400).json({ error: 'contact_id and starts_at required' });
    }
    const appt = await createAppointment({
      contactId: contact_id,
      startsAt: starts_at,
      endsAt: ends_at || null,
      title: title || null,
      source,
      notes: notes || null,
      location: location || null,
      joinUrl: join_url || null,
    });
    res.json({ appointment: appt });
  } catch (e) { next(e); }
});

// ---------------- Send template ------------------------------------------
adminRouter.post('/send-template', async (req, res, next) => {
  try {
    const { contact_id, template_name, language_code = 'en', variables = {} } = req.body || {};
    if (!contact_id || !template_name) return res.status(400).json({ error: 'contact_id and template_name required' });
    const result = await sendApprovedTemplate({
      contactId: contact_id,
      templateName: template_name,
      languageCode: language_code,
      variables,
    });
    res.json(result);
  } catch (e) {
    logger.error({ err: e.message }, 'send-template failed');
    next(e);
  }
});

// ---------------- Tags ----------------------------------------------------
adminRouter.get('/tags', async (_req, res, next) => {
  try {
    const supabase = db();
    const { data, error } = await supabase.from('tags').select('*').order('name');
    if (error) throw error;
    res.json({ rows: data || [] });
  } catch (e) { next(e); }
});

// ---------------- Messages (recent) --------------------------------------
adminRouter.get('/messages', async (req, res, next) => {
  try {
    const supabase = db();
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const { data, error } = await supabase
      .from('messages')
      .select('*, contacts(name, wa_id, phone)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ rows: data || [] });
  } catch (e) { next(e); }
});
