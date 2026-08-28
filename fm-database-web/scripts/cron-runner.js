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
 *   06:30  renewal-sweep          — lapse clients whose plan ended with no
 *                                    successor, past 14d grace. Never touches
 *                                    app_token; a lapsed client keeps their app.
 *                                    Runs before 06:45 client-yaml-integrity
 *                                    on purpose: it is the only cron that
 *                                    writes client.yaml, so the guard checks
 *                                    its work the same morning.
 *   06:45  client-yaml-integrity  — validates every client.yaml.
 *   08:30  intake-reminders        — nudge clients whose intake token is open,
 *                                    not submitted, ≥5d since last reminder.
 *   09:00  appointment-reminders  — morning-of WhatsApp reminder to every
 *                                    client with a booking TODAY. Idempotent.
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

// ---------------------------------------------------------------------------
// QUIET JOBS — the three per-minute schedules below.
//
// pending-sends / intake-reconcile / app-reminders each fire 1440x/day and used
// to log a ~170-char success line EVERY run: ~4,320 lines/day, which reached
// 316k lines / 55 MB in three months. ~99% of it said "I ran, nothing to do",
// which buries the lines that matter and makes `pm2 logs fm-coach-cron`
// useless to watch live. So a quiet job logs only when something actually
// happened, or on any error.
//
// It does NOT go fully silent. A cron that DIED and a cron that had nothing to
// do must never look the same, so the hourly heartbeat further down always
// reports run counts — `runs 0` there is the alarm. (2026-08-22)
// ---------------------------------------------------------------------------
const QUIET_JOBS = ["pending-sends", "intake-reconcile", "app-reminders", "infra-health"];

// Shape guard. If a payload does not carry the field the predicate reads, we
// do NOT get to call it noise — otherwise renaming a response field (say
// `fired` -> `dispatched`) would silently mute the job forever instead of
// showing up as a change in the log. Fail loud, not open.
const REQUIRED_KEYS = {
  "pending-sends": ["fired"],
  "app-reminders": ["sent"],
  "intake-reconcile": ["reconciled"],
  "infra-health": ["problems", "repaired"],
};

// intake-reconcile per-client outcomes that mean "steady state, nothing done".
// Measured, not guessed: across 3 months of logs the actions seen were
// noop (273,118) and skipped_coach_newer (54,749) — versus SEVEN real events
// (draft_mirrored x5, submission_merged, submission_marker_only). Treating
// skipped_coach_newer as activity — the obvious first guess — would have
// silenced nothing, because it is the dominant steady state.
const RECONCILE_QUIET_ACTIONS = new Set(["noop", "skipped_coach_newer"]);

// "Did anything actually happen?" per job. An unrecognised shape returns true
// on purpose: a payload we do not understand gets logged, never swallowed.
//
// The fields deliberately NOT treated as activity are the ones verified
// constant across consecutive runs (two back-to-back calls returned
// byte-identical payloads): intake-reconcile's top-level `purged` list,
// app_staging.refreshed, coach_staging.people and coach_staging.unchanged.
// They report what was scanned, not what changed.
const HAS_ACTIVITY = {
  "pending-sends": (p) =>
    (p.fired || 0) > 0 || (p.failed || 0) > 0 || (p.errors || []).length > 0,

  "app-reminders": (p) => (p.sent || 0) > 0 || (p.skipped || 0) > 0,

  // Healthy infra is the steady state, 288x/day. Anything else — a problem
  // found, a tunnel restarted, an alert sent — is exactly what we want in the
  // log, so only the all-clear is noise. `skipped` (COACH_PUBLIC_URL unset)
  // counts as quiet too: nothing to watch is a config choice, not an event.
  "infra-health": (p) =>
    (p.problems || []).length > 0 || p.repaired === true || (p.alerted || 0) > 0,

  "intake-reconcile": (p) => {
    const app = p.app_staging || {};
    const coach = p.coach_staging || {};
    return (
      (p.reconciled || []).some((r) =>
        (r.actions || []).some((a) => !RECONCILE_QUIET_ACTIONS.has(a)),
      ) ||
      app.ok === false ||
      (app.checkins_mirrored || 0) > 0 ||
      (app.purged || 0) > 0 ||
      (app.errors || []).length > 0 ||
      coach.ok === false ||
      (coach.bytes || 0) > 0 ||
      (coach.notes_drained || 0) > 0
    );
  },
};

// job -> { runs, active }, reset each hour by the heartbeat.
const tally = new Map();

function note(job, active) {
  if (!QUIET_JOBS.includes(job)) return;
  const t = tally.get(job) || { runs: 0, active: 0 };
  t.runs += 1;
  if (active) t.active += 1;
  tally.set(job, t);
}

// Exported for the unit test; also keeps the predicates honest.
function isNoise(job, bodyText) {
  if (!QUIET_JOBS.includes(job)) return false;
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return false; // unparseable success body — surface it
  }
  if (parsed === null || typeof parsed !== "object") return false;
  if (parsed.ok === false) return false;
  const required = REQUIRED_KEYS[job] || [];
  if (!required.every((k) => k in parsed)) return false; // shape drifted — log it
  const test = HAS_ACTIVITY[job];
  if (!test) return false;
  try {
    return !test(parsed);
  } catch {
    return false;
  }
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
      const noise = isNoise(job, text);
      note(job, !noise);
      if (!noise) {
        console.log(`[cron-runner] ${job} ✓ ${res.status} (${took}ms): ${text.slice(0, 200)}`);
      }
    } else {
      note(job, true);
      console.error(`[cron-runner] ${job} ✗ ${res.status} (${took}ms): ${text.slice(0, 400)}`);
    }
  } catch (err) {
    note(job, true);
    console.error(`[cron-runner] ${job} threw:`, err && err.message ? err.message : err);
  }
}

// 06:30 IST daily — lapse clients whose plan ended and was never renewed.
//
// First job of the morning, and the slot is chosen, not spare. This is the only
// cron that WRITES client.yaml, and client-yaml-integrity runs at 06:45 — so
// putting the sweep ahead of it means the guard validates this morning's writes
// this morning, instead of a bad write sitting unnoticed for 24h. Everything
// client-facing (08:30 intake nudges, 09:00 appointment reminders) then reads
// an already-correct roster rather than nudging someone who lapsed overnight.
// Idempotent, and self-healing: a lapsed client with a plan again is restored.
cron.schedule(
  "30 6 * * *",
  () => fire("renewal-sweep"),
  { timezone: "Asia/Kolkata" },
);

// 08:30 IST daily — intake reminders
cron.schedule(
  "30 8 * * *",
  () => fire("intake-reminders"),
  { timezone: "Asia/Kolkata" },
);

// 09:00 IST daily — morning-of session reminder to clients with a booking today
cron.schedule(
  "0 9 * * *",
  () => fire("appointment-reminders"),
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

// Every minute — drain the intake staging layer: mirror open-form drafts +
// submissions from the Fly-synced staging tree back into the authoritative
// store, and purge finalised/revoked/expired intakes off Fly. No-op when
// FMDB_STAGING_DIR is unset (legacy full-replica mode).
cron.schedule(
  "* * * * *",
  () => fire("intake-reconcile"),
  { timezone: "Asia/Kolkata" },
);

// 06:45 IST daily — duplicate-key integrity check on every client.yaml. A file
// js-yaml can't parse (dup keys, e.g. the cl-021 incident) is silently skipped
// by loader.ts, so that client vanishes from the dashboard + their app. Scan-
// only; emails the coach ONLY when something is corrupt (with a 1-line repair
// command). Cheap pure-Python scan; no-op-quiet on clean days.
cron.schedule(
  "45 6 * * *",
  () => fire("client-yaml-integrity"),
  { timezone: "Asia/Kolkata" },
);

// 07:00 IST daily — auto-draft next week's menus for clients whose new week
// starts within 3 days (weekly cadence, 2026-06-12). Drafts wait for coach
// approval in the studio; nothing reaches clients automatically.
cron.schedule(
  "0 7 * * *",
  () => fire("weekly-menu-drafts"),
  { timezone: "Asia/Kolkata" },
);

// 07:30 IST daily — email the coach a digest of weekly menus awaiting approval
// (runs after the 07:00 drafts so fresh drafts are included). Only emails when
// the queue is non-empty. Closes the "drafts pile up silently" gap.
cron.schedule(
  "30 7 * * *",
  () => fire("menu-approval-digest"),
  { timezone: "Asia/Kolkata" },
);

// 07:45 IST daily — menu-artifact freshness guard: regenerate grocery + recipes
// for any client whose artifact is MISSING, WEEK-MISMATCHED, or STALE (built
// before the menu was last changed — catches menus edited outside the approve
// flow). Idempotent; fresh artifacts are skipped.
cron.schedule(
  "45 7 * * *",
  () => fire("grocery-backfill"),
  { timezone: "Asia/Kolkata" },
);

// 08:00 IST daily — auto-approve fallback (fixed-day + fallback model). Only
// approves pending, non-travel drafts for clients ALREADY in a week with no
// live menu (would otherwise be frozen). Pre-loaded next-week drafts wait for
// the coach's approval day.
cron.schedule(
  "0 8 * * *",
  () => fire("menu-auto-approve"),
  { timezone: "Asia/Kolkata" },
);

// 10:00 IST daily — tell clients whose app has just dropped from their live
// plan to the frozen LIBRARY floor that their programme is complete. The mode
// change is computed from dates and announces itself to nobody; without this a
// client opens the app to find it silently different (cl-017, 19 Aug 2026).
// Idempotent — once per graduation, not once per day; state is the outbound WA
// record, so a repeat run sends nothing.
cron.schedule(
  "0 10 * * *",
  () => fire("graduation-notice"),
  { timezone: "Asia/Kolkata" },
);

// Every minute — fire time-of-day app reminders (client sets these in the app's
// Account screen; delivered via web push). Cheap: skips any reminder not due
// this minute, idempotent per (client, reminder, day). A reminder only lands if
// the client also has push notifications on.
cron.schedule(
  "* * * * *",
  () => fire("app-reminders"),
  { timezone: "Asia/Kolkata" },
);

// 21:00 IST daily — revenue export to ochre-funnel (growth-system Loop 1):
// graduation sweep + active_client_count snapshot + outbox drain. Idempotent;
// no-op when OCHRE_FUNNEL_REVENUE_URL / FM_REVENUE_EXPORT_SECRET are unset.
cron.schedule(
  "0 21 * * *",
  () => fire("revenue-export"),
  { timezone: "Asia/Kolkata" },
);

// Every 5 minutes — infra watchdog. Probes the public tunnel, the auth wall in
// front of it, and Fly; RESTARTS the tunnel itself when it is down, and only
// emails after ~15 min of failed repairs (or immediately if coach routes are
// being served publicly without auth).
//
// 5 minutes, not hourly, because the point is that a dead tunnel is repaired
// before the coach ever notices — on 2026-08-15 one had been dead for weeks and
// surfaced only when she urgently needed it from away.
cron.schedule(
  "*/5 * * * *",
  () => fire("infra-health"),
  { timezone: "Asia/Kolkata" },
);

// Top of every hour — liveness for the quiet jobs above. This is the whole
// reason quieting them is safe: `runs 0` here means a per-minute schedule has
// STOPPED, which silence alone could never tell you.
cron.schedule(
  "0 * * * *",
  () => {
    const parts = QUIET_JOBS.map((job) => {
      const t = tally.get(job) || { runs: 0, active: 0 };
      tally.set(job, { runs: 0, active: 0 });
      return `${job} ${t.runs} runs/${t.active} active`;
    });
    console.log(`[cron-runner] hourly · ${parts.join(" · ")}`);
  },
  { timezone: "Asia/Kolkata" },
);

console.log(
  `[cron-runner] started · target ${APP_URL} · CRON_SECRET ${SECRET ? "set" : "MISSING"} · schedules:`
    + "\n  · 06:45 IST  client-yaml-integrity"
    + "\n  · 07:00 IST  weekly-menu-drafts"
    + "\n  · 07:30 IST  menu-approval-digest"
    + "\n  · 07:45 IST  grocery-backfill"
    + "\n  · 08:00 IST  menu-auto-approve"
    + "\n  · 08:30 IST  intake-reminders"
    + "\n  · 09:00 IST  appointment-reminders"
    + "\n  · 10:00 IST  graduation-notice"
    + "\n  · 21:00 IST  revenue-export"
    + "\n  · * * * * *  pending-sends"
    + "\n  · * * * * *  intake-reconcile"
    + "\n  · * * * * *  app-reminders"
    + "\n  · 0 * * * *  hourly heartbeat"
    + `\n  quiet (log only on activity/error): ${QUIET_JOBS.join(", ")}`,
);

// Keep the process alive (node-cron handles its own timers).
setInterval(() => {}, 1 << 30);
