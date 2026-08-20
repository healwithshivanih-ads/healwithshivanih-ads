/**
 * Graduation notice — the one message that fires when a client crosses from
 * REVIEW to LIBRARY.
 *
 * THE GAP THIS CLOSES. `resolveAppMode` computes the mode per request, from
 * dates. Nothing announces the transition. So on the morning after her review
 * window closed, cl-017 opened the app and found it quietly different — no
 * menus, no plan, a frozen recipe floor — and nobody had said a word. The app
 * had not broken and had not locked her out; it had simply moved on without
 * telling her. cl-004 was queued to do the same on 3 Sep.
 *
 * This module decides, for one client on one day, whether that message is due.
 * It is PURE — no I/O, no clock, no React. The cron route
 * (/api/cron/graduation-notice) does the reading and the sending; every rule
 * that could get a message wrong lives here where a test can fail on it.
 *
 * THE EDGE IS NOT RECOMPUTED. `resolveAppMode` is the authority on whether a
 * client is on the floor — this asks it rather than re-deriving the window, so
 * the two can never drift apart. The only arithmetic done here is WHEN the
 * floor started (recheck + GRACE_DAYS + 1, the day after REVIEW's last day),
 * which is what makes "once per graduation" expressible.
 *
 * IDEMPOTENCE IS DATE-SCOPED, NOT A BOOLEAN. The durable send-state is the
 * outbound WhatsApp record already on disk (`getLastSentAtAction`) — there is
 * no parallel state file to drift or to forget to write. A bare "have we ever
 * sent this?" would be wrong in the other direction: a client who graduates,
 * buys another phase, and graduates again a season later deserves the message
 * the second time too. So the comparison is against THIS graduation's start
 * date: a send stamped on or after `graduatedOn` closes this one, and an older
 * send belongs to a previous programme and does not.
 */

import { resolveAppMode, GRACE_DAYS, type AppModeInput } from "./app-mode";
import { effectiveRecheckDate } from "./plan-timing";

/**
 * How far back the sweep will reach for a graduation it has not yet announced.
 *
 * Without a cap, the first run of this cron would message every client who has
 * ever finished a programme — years of graduations arriving in one batch, each
 * one reading as news. 30 days is wide enough to survive a cron outage or a
 * machine that was off for a fortnight, and narrow enough that the backlog it
 * can ever discover is one month deep.
 */
export const GRADUATION_BACKFILL_DAYS = 30;

export interface GraduationNoticeInput {
  /** Today in the client-facing zone (IST), as YYYY-MM-DD. */
  todayYmd: string;
  /** Exactly what the app reads to decide its mode. Not second-guessed here. */
  appMode: AppModeInput;
  /** Does the client have a mobile number on file? No number, no message. */
  hasPhone: boolean;
  /**
   * Days since their most recent recorded app open; null when they have never
   * opened it. Null is the case that matters — see the rule below.
   */
  daysSinceLastOpen: number | null;
  /** ISO timestamp of the last graduation notice sent to this client, if any. */
  lastSentAt: string | null;
}

export interface GraduationNoticeDecision {
  send: boolean;
  /** Why, in words — logged by the cron so a quiet day is still legible. */
  reason: string;
  /** The day this client landed on the LIBRARY floor, when computable. */
  graduatedOn?: string;
}

/** Add n days to a YYYY-MM-DD in UTC. Mirrors the discipline in app-mode.ts. */
function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The YYYY-MM-DD prefix of an ISO timestamp, or null if it isn't one. */
function ymdOf(iso: string | null): string | null {
  if (typeof iso !== "string") return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Is the graduation message due for this client today?
 *
 * Every `send: false` carries a reason rather than a bare boolean, because the
 * failure mode being guarded against is a message that should have gone and
 * silently didn't — the same class of bug as the silence this whole feature
 * exists to fix.
 */
export function graduationNoticeDecision(
  input: GraduationNoticeInput,
): GraduationNoticeDecision {
  const { todayYmd, appMode } = input;

  // 1. Ask the app, don't re-derive it. If the client is not on the floor,
  //    there is nothing to announce — including the case where they are still
  //    inside REVIEW with the decision open.
  const mode = resolveAppMode(appMode, todayYmd);
  if (mode.mode !== "LIBRARY") {
    return { send: false, reason: `mode is ${mode.mode}, not LIBRARY` };
  }

  // 2. LIBRARY has several doors. This message is for exactly one of them: the
  //    plan window running out with no decision. A maintenance client whose
  //    coverage lapsed gets the renewal/lapse nudge instead, and someone with
  //    no plan at all never had a programme to complete.
  const onMaintenanceTrack =
    appMode.maintenance_status === "active" ||
    appMode.maintenance_status === "lapsed" ||
    (typeof appMode.maintenance_paid_through === "string" &&
      appMode.maintenance_paid_through.length > 0);
  if (onMaintenanceTrack) {
    return { send: false, reason: "on the maintenance track — lapse nudge covers this" };
  }
  if (!appMode.plan) {
    return { send: false, reason: "no plan on file — never had a programme to complete" };
  }

  const recheck = effectiveRecheckDate(appMode.plan, appMode.recheckOpts);
  if (!recheck) {
    return { send: false, reason: "recheck date not computable from the plan" };
  }

  // 3. REVIEW's last day is recheck + GRACE_DAYS, so the floor starts the day
  //    after. This date is the identity of this particular graduation.
  const graduatedOn = addDaysYmd(recheck, GRACE_DAYS + 1);

  if (todayYmd > addDaysYmd(graduatedOn, GRADUATION_BACKFILL_DAYS)) {
    return {
      send: false,
      graduatedOn,
      reason: `graduated ${graduatedOn}, beyond the ${GRADUATION_BACKFILL_DAYS}d backfill window`,
    };
  }

  // 4. Only for clients who actually used the app. "Your programme is complete
  //    — your recipes stay open" is a warm line to someone who lived in the
  //    app and a baffling one to someone who never opened it. Note this is
  //    "ever opened", not "opened recently": a client who drifted off in week
  //    three still earns an honest close, and their keepsake is still theirs.
  if (input.daysSinceLastOpen === null) {
    return { send: false, graduatedOn, reason: "never opened the app" };
  }

  if (!input.hasPhone) {
    return { send: false, graduatedOn, reason: "no mobile number on file" };
  }

  // 5. Once per graduation. A send stamped on or after this floor's start day
  //    closes it. An unparseable stamp is treated as sent — the cost of a
  //    missed message is one quiet client; the cost of a duplicate is a client
  //    told twice that their programme has ended.
  if (input.lastSentAt !== null) {
    const sentYmd = ymdOf(input.lastSentAt);
    if (sentYmd === null) {
      return { send: false, graduatedOn, reason: "unreadable last-sent stamp — refusing to risk a repeat" };
    }
    if (sentYmd >= graduatedOn) {
      return { send: false, graduatedOn, reason: `already sent ${sentYmd} for this graduation` };
    }
  }

  return { send: true, graduatedOn, reason: `graduated ${graduatedOn}` };
}

/**
 * The message body, rendered. Kept beside the decision so the copy is reviewed
 * with the rule that fires it.
 *
 * Honest about what changed (the programme is finished), honest about what did
 * not (recipes, keepsake and re-order links stay), and it does not sell. The
 * moment a client discovers their app has gone quiet is the worst possible
 * moment to pitch them; the door back is named, not pushed.
 */
export function renderGraduationNotice(firstName: string): string {
  return (
    `Hi ${firstName} 👋 Your programme with me has come to its natural end — ` +
    `you've finished the full arc, and that's worth pausing on.\n\n` +
    `Your app stays yours: your recipes, your keepsake and your supplement ` +
    `re-order links are all still there whenever you want them.\n\n` +
    `If you'd like to talk about what comes next, or you just want to tell me ` +
    `how you're doing, I'm one message away. 🌿`
  );
}
