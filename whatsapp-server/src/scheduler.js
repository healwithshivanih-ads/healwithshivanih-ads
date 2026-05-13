import { logger } from './logger.js';
import { runDueReminders } from './services/reminders.js';

let timer = null;

export function startScheduler({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  logger.info({ intervalMs }, 'reminder scheduler started');
  // Stagger first run a few seconds after boot so server is fully up
  setTimeout(() => {
    runDueReminders().catch((e) => logger.error({ err: e.message }, 'reminder loop crashed'));
    timer = setInterval(() => {
      runDueReminders().catch((e) => logger.error({ err: e.message }, 'reminder loop crashed'));
    }, intervalMs);
  }, 5_000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
