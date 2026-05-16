import { config } from '../config.js';

export function adminAuth(req, res, next) {
  if (!config.admin.apiKey) {
    return res.status(503).json({ error: 'admin_not_configured' });
  }
  // Header is primary. Query-param fallback exists because the browser
  // EventSource API can't set custom headers — SSE clients (admin Inbox,
  // Ochre proxy) authenticate via `?key=<ADMIN_API_KEY>` on the URL.
  // Same secret either way; the URL is private (Tailnet / coach-only).
  const key = req.header('x-api-key') || req.query.key;
  if (!key || key !== config.admin.apiKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
