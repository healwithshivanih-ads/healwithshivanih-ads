// CSV import upload endpoint.
//
// multipart/form-data:
//   - file:    the CSV
//   - config:  JSON string with { column_mapping, default_tags, default_opt_in_source, dedupe_key }
//
// Files <1MB process synchronously and return the final import row.
// Larger files: kick off async and return { import_id } immediately.

import { Router } from 'express';
import multer from 'multer';
import { logger } from '../../logger.js';
import * as importsSvc from '../../services/contacts/imports.js';
import { ValidationError } from '../../errors.js';

export const importsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB hard cap
});

const SYNC_THRESHOLD = 1024 * 1024; // 1MB

importsRouter.get('/', async (req, res, next) => {
  try {
    const result = await importsSvc.list({
      limit: Math.min(parseInt(req.query.limit || '50', 10), 200),
      offset: parseInt(req.query.offset || '0', 10),
    });
    res.json(result);
  } catch (e) { next(e); }
});

importsRouter.get('/:id', async (req, res, next) => {
  try {
    const row = await importsSvc.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) { next(e); }
});

importsRouter.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ValidationError('file required (multipart field "file")');

    let config = {};
    if (req.body?.config) {
      try { config = JSON.parse(req.body.config); }
      catch { throw new ValidationError('config must be valid JSON'); }
    }

    const small = req.file.size < SYNC_THRESHOLD;

    if (small) {
      const result = await importsSvc.processCsv({
        filename: req.file.originalname,
        content: req.file.buffer,
        config,
      });
      return res.status(200).json(result);
    }

    // Async path: respond first, then process.
    const buf = req.file.buffer;
    const filename = req.file.originalname;
    res.status(202).json({ ok: true, queued: true, filename, size: req.file.size });
    importsSvc.processCsv({ filename, content: buf, config }).catch((e) =>
      logger.error({ err: e.message }, 'csv import async failed'));
  } catch (e) { next(e); }
});
