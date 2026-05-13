import { Router } from 'express';
import express from 'express';
import { adminAuth } from '../../middleware/adminAuth.js';
import { apiLimiter } from '../../middleware/rateLimit.js';
import { contactsRouter } from './contacts.js';
import { conversationsRouter } from './conversations.js';
import { tagsRouter } from './tags.js';
import { messagesRouter } from './messages.js';
import { statsRouter } from './stats.js';

export const apiRouter = Router();

// All /api/* routes are JSON-bodied, admin-authed, rate-limited.
apiRouter.use(express.json({ limit: '5mb' }));
apiRouter.use(adminAuth);
apiRouter.use(apiLimiter);

apiRouter.use('/contacts', contactsRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/tags', tagsRouter);
apiRouter.use('/messages', messagesRouter);
apiRouter.use('/stats', statsRouter);
