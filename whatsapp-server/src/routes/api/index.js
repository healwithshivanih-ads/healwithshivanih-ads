import { Router } from 'express';
import express from 'express';
import { adminAuth } from '../../middleware/adminAuth.js';
import { apiLimiter } from '../../middleware/rateLimit.js';
import { contactsRouter } from './contacts.js';
import { conversationsRouter } from './conversations.js';
import { tagsRouter } from './tags.js';
import { messagesRouter } from './messages.js';
import { statsRouter } from './stats.js';
import { appointmentsRouter } from './appointments.js';
import { integrationsRouter } from './integrations.js';
import { importsRouter } from './imports.js';

export const apiRouter = Router();

// Admin auth + rate-limit on every /api/* route.
apiRouter.use(adminAuth);
apiRouter.use(apiLimiter);

// JSON parser. The /imports route handles its own multipart parsing via
// multer, so the JSON body parser only kicks in for application/json.
apiRouter.use(express.json({ limit: '5mb' }));

apiRouter.use('/contacts', contactsRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/tags', tagsRouter);
apiRouter.use('/messages', messagesRouter);
apiRouter.use('/stats', statsRouter);
apiRouter.use('/appointments', appointmentsRouter);
apiRouter.use('/integrations', integrationsRouter);
apiRouter.use('/imports', importsRouter);
