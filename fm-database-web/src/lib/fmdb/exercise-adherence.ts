/**
 * What a client has actually DONE of their exercise session.
 *
 * WHY THIS REPORTS AND DOES NOT DECIDE. The obvious next step is a rule — "three
 * clean sessions, offer to advance a level" — and that number would be invented.
 * This project has already spent months gating the mind-body drip on a sensor
 * that was structurally empty, and the fix was not a better threshold, it was
 * getting real data first. So this surfaces the sessions and leaves the decision
 * where it belongs. When there is a season of real logs, the rule can be derived
 * from them rather than guessed ahead of them.
 *
 * `completed` matters as much as the count. A client who opens the session and
 * works through two of six exercises is telling you something specific — most
 * likely that the session is too long or too hard — and a plain "3 sessions this
 * week" would hide it behind a number that looks like success.
 *
 * UPDATE 2026-08-05: the coach overrode the wait-for-data stance — see
 * exercise-progression.ts, which layers an EXPLICITLY PROVISIONAL readiness
 * rule on top of these counts. This module still only reports; the rule and its
 * constants live there, marked for revision once real log seasons exist.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { getPlansRoot } from "./paths";

export interface ExerciseSessionRecord {
  date: string;
  seconds: number | null;
  completed: boolean;
  name: string;
}

export interface ExerciseAdherence {
  /** Every logged session in the window, newest first. */
  sessions: ExerciseSessionRecord[];
  /** Distinct days with at least one session — the honest "how often" number. */
  days: number;
  finished: number;
  partial: number;
  /** ISO date of the most recent session, or null. */
  lastDate: string | null;
  /** Median seconds across FINISHED sessions — null until there are any. */
  medianSeconds: number | null;
  /** One plain sentence for the coach. Never a recommendation. */
  headline: string;
}

const EMPTY: ExerciseAdherence = {
  sessions: [], days: 0, finished: 0, partial: 0,
  lastDate: null, medianSeconds: null,
  headline: "No sessions logged yet.",
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export async function loadExerciseAdherence(
  clientId: string,
  days = 28,
): Promise<ExerciseAdherence> {
  if (!clientId) return EMPTY;
  const file = path.join(getPlansRoot(), "clients", clientId, "_practice_log.jsonl");

  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    // No log file at all is the normal state for most clients, not an error.
    return EMPTY;
  }

  const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const sessions: ExerciseSessionRecord[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as {
        kind?: string; date?: string; seconds?: number | null;
        completed?: boolean; name?: string;
      };
      // Exact string match, matching every other reader of this file.
      if (r.kind !== "exercise") continue;
      if (typeof r.date !== "string" || r.date < cutoff) continue;
      sessions.push({
        date: r.date,
        seconds: typeof r.seconds === "number" ? r.seconds : null,
        // The shim defaults a missing `completed` to true, so mirror that rather
        // than reading absence as abandonment.
        completed: r.completed !== false,
        name: typeof r.name === "string" ? r.name : "Movement session",
      });
    } catch {
      /* one malformed line must not hide the rest */
    }
  }

  if (sessions.length === 0) return EMPTY;

  sessions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const finished = sessions.filter((s) => s.completed).length;
  const partial = sessions.length - finished;
  const uniqueDays = new Set(sessions.map((s) => s.date)).size;
  const med = median(
    sessions.filter((s) => s.completed && s.seconds != null).map((s) => s.seconds as number),
  );

  const dayWord = uniqueDays === 1 ? "day" : "days";
  let headline = `${uniqueDays} ${dayWord} in the last ${days}`;
  if (med != null) {
    headline += med >= 90 ? `, typically ${Math.round(med / 60)} min` : `, typically ${med}s`;
  }
  // Named rather than folded into the total: a part-way session is a signal
  // about the session, not a failure of the client.
  if (partial > 0) {
    headline += ` · ${partial} stopped part-way`;
  }

  return {
    sessions, days: uniqueDays, finished, partial,
    lastDate: sessions[0].date, medianSeconds: med, headline,
  };
}
