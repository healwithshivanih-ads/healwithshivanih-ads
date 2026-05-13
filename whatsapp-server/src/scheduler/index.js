// Scheduler stub. Round 2 wires up tick loops for reminders / broadcasts /
// ai-worker / wix reconciler / suppression expiry. For now `start()` is a noop
// so app boot doesn't need conditional code.
import { logger } from '../logger.js';

export function start() {
  logger.info('scheduler: noop in Round 1 (tick loop arrives in Round 2)');
}
