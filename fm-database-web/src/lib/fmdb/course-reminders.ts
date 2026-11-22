/**
 * Which course reminders are due for one listener this minute.
 *
 * Only two kinds, both chosen by the listener in the app:
 *   daily   — at their own time, on their own clock; skipped once they have
 *             already listened today (nothing to remind about).
 *   unlock  — "Week N is open", on the day a session opens, at 09:00 their
 *             time (or their daily time, if that is earlier).
 * A reminder fires at its time or up to CATCHUP_MIN late (a Mac waking mid-
 * morning still sends once), never twice a day (fired keys carry the date).
 * Pure: the cron does the I/O and the sending.
 */

import { courseDay, isTrackUnlocked, type CourseDef } from "./courses";
import type { CourseRecord } from "./course-store";

export const COURSE_CATCHUP_MIN = 180;
const UNLOCK_AT_MIN = 9 * 60;

export interface DueCourseReminder {
  key: string;
  title: string;
  body: string;
}

function hhmmToMin(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function dueCourseReminders(input: {
  course: CourseDef;
  startYmd: string;
  record: CourseRecord;
  fired: Record<string, string>;
  todayYmd: string;
  nowMin: number;
}): DueCourseReminder[] {
  const { course, startYmd, record, fired, todayYmd, nowMin } = input;
  const day = courseDay(startYmd, todayYmd);
  if (day < 0) return [];
  const out: DueCourseReminder[] = [];
  const inWindow = (at: number) => nowMin - at >= 0 && nowMin - at <= COURSE_CATCHUP_MIN;

  const daily = hhmmToMin(record.reminders.daily_time);
  const dailyKey = `daily:${course.slug}`;
  if (daily !== null && inWindow(daily) && fired[dailyKey] !== todayYmd && !record.days[todayYmd]?.listened) {
    const current = [...course.tracks].reverse().find((t) => t.kind === "session" && isTrackUnlocked(t, day));
    out.push({
      key: dailyKey,
      title: course.title,
      body: current
        ? `Time for your practice: the daily practice, or this week's "${current.title}". Somewhere you can close your eyes.`
        : "Time for your practice. Somewhere you can close your eyes.",
    });
  }

  if (record.reminders.unlock) {
    const at = Math.min(UNLOCK_AT_MIN, daily ?? UNLOCK_AT_MIN);
    for (const t of course.tracks) {
      if (t.kind !== "session" || !t.week || t.week === 1) continue; // week 1 opens the day they pay
      if (day !== 7 * (t.week - 1)) continue;
      const key = `unlock:${course.slug}:${t.id}`;
      if (fired[key] || !inWindow(at)) continue;
      out.push({ key, title: course.title, body: `Week ${t.week} is open: "${t.title}".` });
    }
  }
  return out;
}
