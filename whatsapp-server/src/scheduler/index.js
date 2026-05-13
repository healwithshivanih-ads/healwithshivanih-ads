// In-process scheduler. Round 2 wires:
//   - reminders.runner.tick() every 60s
//   - wix.reconciler.tick(integrationId) for each connected wix integration
//     every 5 min
//
// First batch fires 5 seconds after start() so a freshly-booted server doesn't
// sit idle for a full interval. Stop handle clears all timers.
//
// All ticks are wrapped in try/catch + duration logging. A throw in one tick
// never kills the loop or stops other workers.

import { logger } from '../logger.js';
import * as remindersRunner from '../services/reminders/runner.js';
import * as wixReconciler from '../integrations/wix/reconciler.js';

const REMINDERS_INTERVAL_MS = 60_000;
const WIX_INTERVAL_MS = 5 * 60_000;
const WARMUP_DELAY_MS = 5_000;

let timers = [];
let stopped = false;

export function start() {
  if (timers.length) {
    logger.warn('scheduler: already started, ignoring');
    return stop;
  }
  stopped = false;
  logger.info(
    { reminders_ms: REMINDERS_INTERVAL_MS, wix_ms: WIX_INTERVAL_MS },
    'scheduler: starting',
  );

  // Warm-up
  const warm = setTimeout(() => {
    if (stopped) return;
    runRemindersTick();
    runWixTick();
  }, WARMUP_DELAY_MS);
  timers.push(warm);

  // Periodic
  timers.push(setInterval(runRemindersTick, REMINDERS_INTERVAL_MS));
  timers.push(setInterval(runWixTick, WIX_INTERVAL_MS));

  return stop;
}

export function stop() {
  stopped = true;
  for (const t of timers) {
    if (t && typeof t === 'object' && t.unref) try { clearInterval(t); } catch {}
    try { clearTimeout(t); } catch {}
  }
  timers = [];
  logger.info('scheduler: stopped');
}

async function runRemindersTick() {
  if (stopped) return;
  const t0 = Date.now();
  try {
    const r = await remindersRunner.tick();
    const ms = Date.now() - t0;
    if (r.processed > 0 || r.failed > 0) {
      logger.info({ ...r, ms }, 'scheduler: reminders tick');
    } else {
      logger.debug({ ...r, ms }, 'scheduler: reminders tick (idle)');
    }
  } catch (e) {
    logger.error({ err: e.message, stack: e.stack, ms: Date.now() - t0 }, 'scheduler: reminders tick failed');
  }
}

async function runWixTick() {
  if (stopped) return;
  const t0 = Date.now();
  try {
    const integrations = await wixReconciler.listConnected();
    if (!integrations.length) {
      logger.debug('scheduler: wix tick — no connected integrations');
      return;
    }
    for (const i of integrations) {
      if (stopped) return;
      try {
        const r = await wixReconciler.tick(i.id);
        logger.info({ integrationId: i.id, ...r }, 'scheduler: wix tick');
      } catch (e) {
        logger.error({ err: e.message, integrationId: i.id }, 'scheduler: wix tick failed');
      }
    }
  } catch (e) {
    logger.error({ err: e.message, ms: Date.now() - t0 }, 'scheduler: wix tick outer failed');
  }
}
