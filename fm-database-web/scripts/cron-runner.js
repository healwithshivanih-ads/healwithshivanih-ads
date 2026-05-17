#!/usr/bin/env node
/**
 * fm-coach-cron — scheduled-task daemon.
 *
 * Runs in PM2 as a sidecar to the Next.js app (see ecosystem.config.js).
 * Fires HTTP POSTs against the app's internal /api/cron/<job> endpoints
 * on a schedule. Each endpoint is idempotent + protected by CRON_SECRET.
 *
 * Schedules (all IST — Asia/Kolkata):
 *
 *   08:30  intake-reminders     — nudge clients whose intake token is open,
 *                                 not submitted, ≥5d since last reminder.
 *                                 (slice b adds: 09:00 appointment-reminders)
 *                                 (slice c adds: 09:00 motivational-messages)
 *
 * Logs to PM2 stdout: `pm2 logs fm-coach-cron`.
 */
const cron = require("node-cron");

const APP_URL = (process.env.APP_URL || "http://localhost:3002").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET || "";

if (!SECRET) {
  console.error("[cron-runner] CRON_SECRET not set — every /api/cron/* call will be rejected.");
}

async function fire(job) {
  const url = `${APP_URL}/api/cron/${job}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": SECRET,
      },
      body: JSON.stringify({ source: "fm-coach-cron", ts: new Date().toISOString() }),
    });
    const text = await res.text();
    const took = Date.now() - startedAt;
    if (res.ok) {
      console.log(`[cron-runner] ${job} ✓ ${res.status} (${took}ms): ${text.slice(0, 200)}`);
    } else {
      console.error(`[cron-runner] ${job} ✗ ${res.status} (${took}ms): ${text.slice(0, 400)}`);
    }
  } catch (err) {
    console.error(`[cron-runner] ${job} threw:`, err && err.message ? err.message : err);
  }
}

// 08:30 IST daily — intake reminders
cron.schedule(
  "30 8 * * *",
  () => fire("intake-reminders"),
  { timezone: "Asia/Kolkata" },
);

// Every minute — drain due rows from _pending_sends.yaml (supplement-order
// nudge queued 6h after plan publish, with a 9am IST floor). Cheap when
// queue is empty; only sends a WhatsApp template when a row is due.
cron.schedule(
  "* * * * *",
  () => fire("pending-sends"),
  { timezone: "Asia/Kolkata" },
);

console.log(
  `[cron-runner] started · target ${APP_URL} · CRON_SECRET ${SECRET ? "set" : "MISSING"} · schedules:`
    + "\n  · 08:30 IST  intake-reminders"
    + "\n  · * * * * *  pending-sends",
);

// Keep the process alive (node-cron handles its own timers).
setInterval(() => {}, 1 << 30);
