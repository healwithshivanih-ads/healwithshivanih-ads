import { config } from '../config.js';

export function adminAuth(req, res, next) {
  if (!config.admin.apiKey) {
    return res.status(503).json({ error: 'admin_not_configured' });
  }
  const key = req.header('x-api-key');
  if (!key || key !== config.admin.apiKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
