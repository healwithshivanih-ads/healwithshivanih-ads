import { Router } from 'express';
import { subscribe, EVENTS } from '../../services/events/index.js';
import { logger } from '../../logger.js';

export const eventsRouter = Router();

// GET /api/events — Server-Sent Events stream. Subscribers (admin Inbox,
// Ochre /messages page) receive lightweight notifications:
//   - `inbound.message`  → new WA inbound landed; UI re-fetches list/thread
//   - `outbound.status`  → Meta status callback (delivered/read/failed)
// Both events are summary-only — the UI uses them as a hint to refresh,
// not as the source of truth. Polling fallback still runs as a safety net
// (10 s) so a dropped SSE connection doesn't hide messages forever.
//
// Heartbeat every 25 s keeps the connection alive through proxies (Fly's
// edge timeout is 60 s for idle connections).
eventsRouter.get('/', (req, res) => {
  // SSE requires explicit headers. flushHeaders() to send them before any
  // event data so the client knows the stream is open.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx-ish buffering if anything sits in front
  });
  res.flushHeaders();
  res.write(': connected\n\n');

  function send(type, data) {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  const unsubInbound = subscribe(EVENTS.INBOUND_MESSAGE, (payload) => {
    send('inbound.message', payload);
  });
  const unsubStatus = subscribe(EVENTS.OUTBOUND_STATUS, (payload) => {
    send('outbound.status', payload);
  });

  const heartbeat = setInterval(() => {
    // SSE comment line — keeps the connection warm without firing client handlers.
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubInbound();
    unsubStatus();
    logger.debug('sse client disconnected');
  });
});
