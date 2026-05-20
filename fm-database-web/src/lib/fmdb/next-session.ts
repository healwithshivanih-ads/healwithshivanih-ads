/**
 * next-session.ts — derive when the client's next session should be
 * scheduled, plus the reason. Used by:
 *   - Analyse page banner (above session-type picker)
 *   - Dashboard widget (clients due to schedule in next 3 days)
 *
 * Priority order for `nextSessionDueIso`:
 *   0. A confirmed upcoming Cal.com booking (an ACTUAL appointment on the
 *      calendar — trumps every heuristic below)
 *   1. Coach-set `client.next_contact_date` (explicit override)
 *   2. Plan's `plan_period_recheck_date` if within 21 days
 *   3. Latest check-in date + 14 days (standard FM check-in cadence)
 *   4. Latest full-assessment date + 28 days
 *   5. Latest discovery date + 7 days (pre-intake gap)
 *   6. Client intake_date + 10 days (newly intaken, no sessions yet)
 *
 * Returns null if none of these apply (e.g. one-off client, fully discharged).
 */

export interface NextSessionDue {
  iso: string;             // YYYY-MM-DD
  daysUntil: number;       // negative if overdue
  reason: string;          // short human label
  source:
    | "booked_session"
    | "client_next_contact_date"
    | "plan_recheck_date"
    | "post_checkin"
    | "post_full_assessment"
    | "post_discovery"
    | "post_intake";
  /** True when the due date has already passed. */
  overdue: boolean;
  /** Set only for source "booked_session" — the confirmed slot time. */
  bookedTimeLabel?: string;
}

type SessionRow = Record<string, unknown>;

interface ComputeArgs {
  client: Record<string, unknown> | null;
  sessions: SessionRow[];           // newest-first NOT required; we sort
  activePlan: Record<string, unknown> | null;
  todayIso?: string;                // testing seam
  /** ISO datetime of the soonest confirmed upcoming Cal.com booking for
   *  this client (full timestamp, not just the date). When present + in
   *  the future it becomes the next session — an actual appointment
   *  always beats a heuristic "should-schedule-by" date. */
  upcomingBookingIso?: string | null;
}

function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  try {
    const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Best guess at the session "type" from its presenting_complaints tag. */
function sessionType(s: SessionRow): string {
  const tag = (s.presenting_complaints as string | undefined) ?? "";
  if (tag.includes("session_type: check_in")) return "check_in";
  if (tag.includes("session_type: full_assessment") ||
      tag.includes("session_type: intake")) return "full_assessment";
  if (tag.includes("session_type: discovery")) return "discovery";
  if (tag.includes("session_type: quick_note")) return "quick_note";
  return "unknown";
}

export function computeNextSessionDue({
  client,
  sessions,
  activePlan,
  todayIso,
  upcomingBookingIso,
}: ComputeArgs): NextSessionDue | null {
  const today = parseDate(todayIso ?? new Date().toISOString().slice(0, 10));
  if (!today) return null;

  // ── Source 0 — a confirmed upcoming Cal.com booking.
  // An actual appointment on the calendar trumps every heuristic below.
  // Without this, a client with a freshly-booked session still showed
  // the stale "8 days overdue" recheck/discovery date — coach booked a
  // slot and the banner kept saying she hadn't (bug 2026-05-20).
  if (upcomingBookingIso) {
    const bookedDate = parseDate(upcomingBookingIso);
    if (bookedDate && bookedDate.getTime() >= today.getTime()) {
      let timeLabel = "";
      try {
        timeLabel = new Date(upcomingBookingIso).toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: "Asia/Kolkata",
        });
      } catch {
        /* leave blank */
      }
      const days = daysBetween(today, bookedDate);
      return {
        iso: isoOf(bookedDate),
        daysUntil: days,
        reason: timeLabel
          ? `Session booked — ${timeLabel} IST`
          : "Session booked",
        source: "booked_session",
        overdue: false,
        bookedTimeLabel: timeLabel || undefined,
      };
    }
  }

  // ── Source 1 — explicit coach override
  const explicit = parseDate(
    (client?.next_contact_date as string | undefined) ?? null,
  );
  if (explicit) {
    return {
      iso: isoOf(explicit),
      daysUntil: daysBetween(today, explicit),
      reason: "Coach-set next contact date",
      source: "client_next_contact_date",
      overdue: explicit.getTime() < today.getTime(),
    };
  }

  // ── Source 2 — plan recheck date if approaching (within 21 days)
  const recheck = parseDate(
    (activePlan?.plan_period_recheck_date as string | undefined) ?? null,
  );
  if (recheck) {
    const days = daysBetween(today, recheck);
    if (days <= 21) {
      return {
        iso: isoOf(recheck),
        daysUntil: days,
        reason:
          days <= 0
            ? "Plan recheck date passed"
            : `Plan recheck — ${days} day${days === 1 ? "" : "s"}`,
        source: "plan_recheck_date",
        overdue: days < 0,
      };
    }
  }

  // ── Sort sessions newest first
  const sorted = [...sessions].sort((a, b) => {
    const da = String(a.date ?? "");
    const db = String(b.date ?? "");
    return db.localeCompare(da);
  });

  // ── Source 3 — last check-in + 14 days
  const lastCheckin = sorted.find((s) => sessionType(s) === "check_in");
  if (lastCheckin) {
    const d = parseDate(lastCheckin.date as string | undefined);
    if (d) {
      const due = addDays(d, 14);
      return {
        iso: isoOf(due),
        daysUntil: daysBetween(today, due),
        reason: "Two weeks since last check-in",
        source: "post_checkin",
        overdue: due.getTime() < today.getTime(),
      };
    }
  }

  // ── Source 4 — last full-assessment + 28 days
  const lastFull = sorted.find((s) => sessionType(s) === "full_assessment");
  if (lastFull) {
    const d = parseDate(lastFull.date as string | undefined);
    if (d) {
      const due = addDays(d, 28);
      return {
        iso: isoOf(due),
        daysUntil: daysBetween(today, due),
        reason: "Four weeks since full assessment",
        source: "post_full_assessment",
        overdue: due.getTime() < today.getTime(),
      };
    }
  }

  // ── Source 5 — last discovery + 7 days (intake should follow)
  const lastDisc = sorted.find((s) => sessionType(s) === "discovery");
  if (lastDisc) {
    const d = parseDate(lastDisc.date as string | undefined);
    if (d) {
      const due = addDays(d, 7);
      return {
        iso: isoOf(due),
        daysUntil: daysBetween(today, due),
        reason: "One week since discovery — intake due",
        source: "post_discovery",
        overdue: due.getTime() < today.getTime(),
      };
    }
  }

  // ── Source 6 — intake_date + 10 days (newly onboarded, no sessions yet)
  const intake = parseDate(
    (client?.intake_date as string | undefined) ?? null,
  );
  if (intake) {
    const due = addDays(intake, 10);
    const days = daysBetween(today, due);
    // Only surface if intake was recent enough to still be relevant
    if (days >= -14) {
      return {
        iso: isoOf(due),
        daysUntil: days,
        reason: "Intake follow-up window",
        source: "post_intake",
        overdue: due.getTime() < today.getTime(),
      };
    }
  }

  return null;
}

/** Format a human label like "in 3 days" / "today" / "2 days overdue". */
export function humanDueLabel(due: NextSessionDue): string {
  const n = due.daysUntil;
  if (n === 0) return "due today";
  if (n === 1) return "due tomorrow";
  if (n === -1) return "1 day overdue";
  if (n > 0) return `in ${n} days`;
  return `${Math.abs(n)} days overdue`;
}
