import { Router } from 'express';
import { db } from '../../db.js';
import { getDefault as getDefaultWorkspace } from '../../services/workspaces.js';

export const statsRouter = Router();

statsRouter.get('/', async (_req, res, next) => {
  try {
    const ws = await getDefaultWorkspace();
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [contactsRes, openConvRes, todayMsgRes] = await Promise.all([
      db().from('contacts').select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws.id).is('deleted_at', null),
      db().from('conversations').select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws.id).eq('status', 'open'),
      db().from('messages').select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws.id).gte('created_at', todayIso),
    ]);

    res.json({
      contacts_total: contactsRes.count || 0,
      conversations_open: openConvRes.count || 0,
      messages_today: todayMsgRes.count || 0,
      drafts_pending: 0, // wired in Round 2 when ai_jobs lands
    });
  } catch (e) { next(e); }
});
