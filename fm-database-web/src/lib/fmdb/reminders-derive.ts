/**
 * Plan-derived app reminders — PURE module (no node/server imports), so it can
 * run both in the Fly-rendered client app (for display) and in the Mac cron
 * (for firing). Deriving at both ends means a republished plan regenerates the
 * reminder set automatically — the stored file holds only the client's
 * overrides (on/off + a custom time), never the derived content.
 *
 * Capped at 3 reminders: morning supplements, evening supplements, weekly
 * check-in — whichever the plan actually warrants. Supplement timings are
 * bucketed AM/PM via `timingSlot()` — the ONE shared parser, so a push can no
 * longer fire at a time the app never showed. This module used to carry its own
 * copy of the keyword table, whose bare "am" matched " amla" and whose "1 pm"
 * matched inside "11 pm" — a 13:00 reminder for a 22:00 dose.
 */

import { timingSlot } from "@/lib/fmdb/client-app-format";
import { isGrowingTreeEnabled } from "@/app/app/[token]/growing-tree-flag";

export interface DerivedReminder {
  id: string;
  /** push body */
  label: string;
  /** 24h IST "HH:MM" */
  time: string;
  cadence: "daily" | "weekly";
  /** 0=Sun … 6=Sat — weekly only */
  weekday?: number;
  /** When false the reminder starts OFF (opt-in). Undefined = on by default. */
  defaultOn?: boolean;
}

export interface ReminderOverride {
  on?: boolean;
  time?: string;
  time_custom?: boolean;
}
export type ReminderOverrides = Record<string, ReminderOverride>;

export interface EffectiveReminder extends DerivedReminder {
  on: boolean;
  /** client has pinned their own time — survives plan regeneration */
  timeCustom: boolean;
}

/** Default IST clock time per slot index. */
const SLOT_TIME = ["06:30", "08:00", "10:30", "13:00", "15:30", "19:00", "21:30"];

/** No reminder is ever scheduled before this (coach rule 2026-06-16). */
export const EARLIEST_TIME = "07:30";

/** Clamp a zero-padded "HH:MM" up to the earliest-allowed time. */
function floorTime(t: string): string {
  return t < EARLIEST_TIME ? EARLIEST_TIME : t;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Days between MSQ retakes — mirrors RETAKE_DAYS in ochre-msq.tsx. */
export const MSQ_RETAKE_DAYS = 21;
/** How many days the just-opened retake window nudges before going quiet. */
const MSQ_NUDGE_DAYS = 3;

/**
 * Build the derived (default-ON) reminder set from a published plan + client.
 * Reads plan.supplement_protocol[].timing and client.next_contact_date.
 *
 * `opts.lastMsqDate` (ISO date of the newest MSQ submission) turns on the
 * score-check reminder: the MSQ is the outcome measure of record, and until
 * now NOTHING told a client her 3-week retake window had opened — the single
 * biggest reason roster-wide completion sat at 0–2 ever per client
 * (2026-08-05 audit). The nudge fires only for the first 3 days of an open
 * window, then goes quiet; retaking closes the window and silences it
 * immediately. No baseline yet → no nudge (the card's CTA owns that ask).
 */
export function deriveReminders(
  plan: Record<string, unknown>,
  client: Record<string, unknown>,
  opts?: { lastMsqDate?: string | null; todayIso?: string },
): DerivedReminder[] {
  const protocol = Array.isArray(plan.supplement_protocol)
    ? (plan.supplement_protocol as Array<Record<string, unknown>>)
    : [];

  // Bucket supplement slots into AM (0–3) and PM (4–6); a reminder fires at the
  // earliest occupied slot in its bucket so it lands when the first dose is due.
  let amSlot: number | null = null;
  let pmSlot: number | null = null;
  for (const s of protocol) {
    const slot = timingSlot(asStr(s.timing)).slot;
    if (slot <= 3) amSlot = amSlot === null ? slot : Math.min(amSlot, slot);
    else pmSlot = pmSlot === null ? slot : Math.min(pmSlot, slot);
  }

  const out: DerivedReminder[] = [];
  if (amSlot !== null) {
    out.push({ id: "supp-am", label: "Morning supplements", time: floorTime(SLOT_TIME[amSlot]), cadence: "daily" });
  }
  if (pmSlot !== null) {
    out.push({ id: "supp-pm", label: "Evening supplements", time: floorTime(SLOT_TIME[pmSlot]), cadence: "daily" });
  }

  // Weekly check-in — weekday from the client's next contact date when set,
  // else Sunday. Always offered (the client can silence it).
  let weekday = 0;
  const nc = asStr(client.next_contact_date);
  if (nc) {
    const d = new Date(`${nc}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) weekday = d.getUTCDay();
  }
  out.push({ id: "checkin", label: "Weekly check-in", time: "10:00", cadence: "weekly", weekday });

  // Growing-tree clients get a daily nudge to tend their tree. ON by default
  // since 2026-08-05: it shipped opt-in behind a settings screen nobody
  // opened, which made the one warm daily-return push effectively not exist.
  // The client can still silence it in Notifications, and it only ever
  // reaches phones that enabled push at all.
  const treeOn = isGrowingTreeEnabled(asStr(client.client_id));
  if (treeOn) {
    out.push({ id: "tree", label: "Your tree is waiting to grow today 🌱", time: "09:00", cadence: "daily" });
  }

  const capped = out.slice(0, treeOn ? 4 : 3);

  // MSQ score-check nudge — transient (3 days per window), so it rides above
  // the standing-reminder cap rather than displacing a daily one.
  const lastMsq = opts?.lastMsqDate;
  if (lastMsq) {
    const today = opts?.todayIso ?? new Date().toISOString().slice(0, 10);
    const daysSince = Math.floor(
      (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${lastMsq}T00:00:00Z`).getTime()) / 86_400_000,
    );
    if (daysSince >= MSQ_RETAKE_DAYS && daysSince < MSQ_RETAKE_DAYS + MSQ_NUDGE_DAYS) {
      capped.push({
        id: "msq",
        label: "Your 3-week score check is open — 5 minutes to see if your number dropped",
        time: "09:30",
        cadence: "daily",
      });
    }
  }

  return capped;
}

/** Overlay the client's saved overrides (on/off + pinned time) onto a derived set. */
export function effectiveReminders(
  derived: DerivedReminder[],
  overrides: ReminderOverrides,
): EffectiveReminder[] {
  return derived.map((d) => {
    const o = overrides[d.id] ?? {};
    const on = typeof o.on === "boolean" ? o.on : d.defaultOn !== false;
    const timeCustom = !!(o.time_custom && o.time);
    // Floor applies to derived AND client-pinned times — never before 07:30.
    const time = floorTime(timeCustom ? (o.time as string) : d.time);
    return { ...d, on, timeCustom, time };
  });
}
