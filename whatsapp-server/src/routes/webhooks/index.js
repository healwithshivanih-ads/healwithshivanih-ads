// Mounts all third-party (non-Meta) webhooks under /webhooks/*.
//
// These routers each apply their own express.json() because the Meta /webhook
// route uses raw-body capture for HMAC verification — we don't want to
// interfere with that.

import { Router } from 'express';
import { calendlyWebhook } from './calendly.js';
import { calComWebhook } from './cal-com.js';
import { wixWebhook } from './wix.js';
import { wixBookingsWebhook } from './wix-bookings.js';
import { metaAdWebhook } from './meta-ad.js';
import { formWebhook } from './form.js';

export const webhooksRouter = Router();

webhooksRouter.use('/calendly', calendlyWebhook);
webhooksRouter.use('/cal-com', calComWebhook);
webhooksRouter.use('/wix', wixWebhook);
webhooksRouter.use('/wix-bookings', wixBookingsWebhook);
webhooksRouter.use('/meta-ad', metaAdWebhook);
webhooksRouter.use('/form', formWebhook);
