// In-process pub/sub for live admin/dashboard updates.
//
// When the inbound webhook handler logs a new message, it publishes an event
// here. SSE-connected clients (the admin Inbox + Ochre /messages) hear the
// event and refresh their open conversation / list instantly — instead of
// waiting up to 10 s for the next poll.
//
// Multi-replica caveat: this is in-process only. Fly currently runs 2 VMs
// for whatsapp-server-shivani. Each VM has its own emitter, so an inbound
// landing on VM A is only seen by SSE clients connected to VM A. Acceptable
// today (we have at most 1 active coach + the polling fallback in the UI
// still works as before — SSE is purely a "feel faster" layer). If we ever
// need cross-VM fanout, swap this for a Supabase Realtime channel or a
// small Redis pub/sub — no other module needs to change.

import { EventEmitter } from 'node:events';
import { logger } from '../../logger.js';

// Higher cap than default 10 — each admin/dashboard browser holds 1 listener.
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function publish(eventType, payload) {
  emitter.emit(eventType, payload);
  logger.debug({ event: eventType, payload }, 'event published');
}

export function subscribe(eventType, handler) {
  emitter.on(eventType, handler);
  return () => emitter.off(eventType, handler);
}

// Convenience helpers — keep call sites self-documenting.
export const EVENTS = {
  INBOUND_MESSAGE: 'inbound.message',
  OUTBOUND_STATUS: 'outbound.status',
};
