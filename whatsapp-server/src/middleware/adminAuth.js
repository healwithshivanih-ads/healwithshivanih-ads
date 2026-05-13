import { config } from '../config.js';

export function adminAuth(req, res, next) {
  const key = req.header('x-api-key');
  if (!config.admin.apiKey) {
    return res.status(503).json({ error: 'admin api key not configured' });
  }
  if (!key || key !== config.admin.apiKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
