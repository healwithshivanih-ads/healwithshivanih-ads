/**
 * Plan-derived app reminders — PURE module (no node/server imports), so it can
 * run both in the Fly-rendered client app (for display) and in the Mac cron
 * (for firing). Deriving at both ends means a republished plan regenerates the
 * reminder set automatically — the stored file holds only the client's
 * overrides (on/off + a custom time), never the derived content.
 *
 * Capped at 3 reminders: morning supplements, evening supplements, weekly
 * check-in — whichever the plan actually warrants. Supplement timings are
 * bucketed AM/PM via the SAME slot logic the client letters use
 * (_timing_slot in render-client-letter.py), kept in sync by hand.
 */

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

// Mirror of _TIMING_SLOTS in render-client-letter.py (keep in sync).
// [slotIndex, keywords]. Single-word keywords match on word boundaries;
// multi-word / hyphenated keywords match as substrings.
const TIMING_SLOTS: Array<[number, string[]]> = [
  [0, ["early morning", "empty stomach", "fasting", "before breakfast", "wake"]],
  [1, ["breakfast", "morning", "with food", "am", "8 am", "7 am", "9 am"]],
  [2, ["mid-morning", "mid morning", "10 am", "between meals", "snack"]],
  [3, ["lunch", "midday", "noon", "1 pm", "12 pm"]],
  [4, ["afternoon", "2 pm", "3 pm", "4 pm"]],
  [5, ["dinner", "evening meal", "supper", "6 pm", "7 pm", "5 pm", "with evening"]],
  [6, ["bedtime", "before bed", "night", "sleep", "9 pm", "10 pm", "before sleep"]],
];

/** Default IST clock time per slot index. */
const SLOT_TIME = ["06:30", "08:00", "10:30", "13:00", "15:30", "19:00", "21:30"];

/** No reminder is ever scheduled before this (coach rule 2026-06-16). */
export const EARLIEST_TIME = "07:30";

/** Clamp a zero-padded "HH:MM" up to the earliest-allowed time. */
function floorTime(t: string): string {
  return t < EARLIEST_TIME ? EARLIEST_TIME : t;
}

function matchSlot(text: string): number | null {
  const tl = text.toLowerCase();
  for (const [idx, keywords] of TIMING_SLOTS) {
    for (const kw of keywords) {
      if (kw.includes(" ") || kw.includes("-")) {
        if (tl.includes(kw)) return idx;
      } else {
        const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (re.test(tl)) return idx;
      }
    }
  }
  return null;
}

function timingToSlot(timing: string): number {
  // The PRIMARY timing is the first clause. Everything after a caveat delimiter
  // (em/en dash, period, semicolon, open paren) is usually a SEPARATION rule —
  // "Evening with dinner — at least 4 h after your MORNING dose", "… keep clear
  // of the MORNING levothyroxine" — whose own time words must NOT decide the
  // bucket (else an evening supplement is mis-slotted to AM and loses its
  // reminder). Slot on the primary clause; fall back to the full string only
  // when the primary carries no time cue at all.
  const full = (timing || "").toLowerCase();
  const primary = full.split(/\s[—–-]\s|[.;(]/)[0];
  return matchSlot(primary) ?? matchSlot(full) ?? 1; // default: with breakfast
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Build the derived (default-ON) reminder set from a published plan + client.
 * Reads plan.supplement_protocol[].timing and client.next_contact_date.
 */
export function deriveReminders(
  plan: Record<string, unknown>,
  client: Record<string, unknown>,
): DerivedReminder[] {
  const protocol = Array.isArray(plan.supplement_protocol)
    ? (plan.supplement_protocol as Array<Record<string, unknown>>)
    : [];

  // Bucket supplement slots into AM (0–3) and PM (4–6); a reminder fires at the
  // earliest occupied slot in its bucket so it lands when the first dose is due.
  let amSlot: number | null = null;
  let pmSlot: number | null = null;
  for (const s of protocol) {
    const slot = timingToSlot(asStr(s.timing));
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

  // Growing-tree clients get an opt-in daily nudge to tend their tree. Off by
  // default (the client turns it on in Notifications) so it's never pushy.
  const treeOn = isGrowingTreeEnabled(asStr(client.client_id));
  if (treeOn) {
    out.push({ id: "tree", label: "Your tree is waiting to grow today 🌱", time: "09:00", cadence: "daily", defaultOn: false });
  }

  return out.slice(0, treeOn ? 4 : 3);
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
