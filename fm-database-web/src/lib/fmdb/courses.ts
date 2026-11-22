/**
 * Audio courses sold or given through the client app. Calm Gut is the first.
 *
 * A course is a fixed set of audio tracks, released by week from the day the
 * listener starts (the day they pay, not the next Monday). Each track has two
 * versions, with music and voice only. Nothing here is personal: it is the
 * same course for everyone, so it lives in code, not in a client record.
 *
 * Copy rules (Calm Gut launch plan, 22 Nov 2026): "may ease", never cure /
 * heal / treat; never a supplement; no AI-voice line anywhere.
 *
 * Audio files are SWAPPABLE: every track carries a `rev`. Re-recording a
 * session means uploading the new file under a new rev and bumping it here,
 * which also invalidates any offline copy on a phone (the cache key carries
 * the rev). Object keys: `<course>/<rev>/<track>-<version>.m4a`.
 */

export type CourseSlug = "calm-gut";
export type CourseTrackKind = "session" | "practice" | "flare";
export type CourseVersion = "music" | "voice";

export interface CourseTrackDef {
  /** Stable id: s1..s8, daily, night, flare. Used in keys, logs and URLs. */
  id: string;
  kind: CourseTrackKind;
  title: string;
  /** One line under the title. */
  subtitle: string;
  /** Sessions only: the course week it opens (1 = the day they start). */
  week?: number;
  /** Length in whole minutes, music and voice-only versions. */
  minutes: { music: number; voice: number };
  /** Bump when the audio file is replaced. */
  rev: string;
  /** Extra on-screen safety text for this track, after the general line. */
  safetyExtra?: string;
  /** The 2-minute reading for the week. Null = not written yet (placeholder). */
  reading: string | null;
}

export interface CourseDef {
  slug: CourseSlug;
  title: string;
  /** Short line for the header of the course screen. */
  tagline: string;
  totalWeeks: number;
  /** Weeks (counted from 0 = the start week) the 5-question score is asked. */
  scoreWeeks: number[];
  /** Shown on every track's screen. */
  safety: string;
  tracks: CourseTrackDef[];
}

const GENERAL_SAFETY =
  "Listen only when you can safely close your eyes: never while driving, cooking, bathing or caring for a child. " +
  "This does not replace a diagnosis or your medicine. Blood in stools, weight loss without trying, symptoms that " +
  "wake you at night, or new symptoms after 50 mean seeing a doctor first.";

export const CALM_GUT: CourseDef = {
  slug: "calm-gut",
  title: "Calm Gut",
  tagline: "8 weeks of gut-directed hypnotherapy. It may ease bloating, discomfort and stress-related gut symptoms.",
  totalWeeks: 8,
  scoreWeeks: [0, 6, 12],
  safety: GENERAL_SAFETY,
  tracks: [
    { id: "s1", kind: "session", week: 1, title: "Calm belly", subtitle: "Session 1 · settling in", minutes: { music: 17, voice: 17 }, rev: "d1", reading: null },
    { id: "s2", kind: "session", week: 2, title: "Turning down the volume", subtitle: "Session 2 · the volume dial", minutes: { music: 24, voice: 24 }, rev: "d1", reading: null },
    { id: "s3", kind: "session", week: 3, title: "The river", subtitle: "Session 3 · an easy flow", minutes: { music: 25, voice: 24 }, rev: "d1", reading: null },
    { id: "s4", kind: "session", week: 4, title: "Soft and spacious", subtitle: "Session 4 · for bloating", minutes: { music: 25, voice: 25 }, rev: "d1", reading: null },
    { id: "s5", kind: "session", week: 5, title: "The stress shield", subtitle: "Session 5 · when the day gets busy", minutes: { music: 24, voice: 24 }, rev: "d1", reading: null },
    { id: "s6", kind: "session", week: 6, title: "Eating with ease", subtitle: "Session 6 · meals and eating out", minutes: { music: 24, voice: 24 }, rev: "d1", reading: null },
    {
      id: "s7",
      kind: "session",
      week: 7,
      title: "Cool, calm chest",
      subtitle: "Session 7 · acidity and reflux",
      minutes: { music: 24, voice: 24 },
      rev: "d1",
      safetyExtra:
        "Trouble or pain swallowing, vomiting blood, black stools or chest pain need a doctor first (chest pain can be the heart). Don't stop acidity tablets on your own.",
      reading: null,
    },
    { id: "s8", kind: "session", week: 8, title: "Your calm gut, going forward", subtitle: "Session 8 · keeping it", minutes: { music: 24, voice: 24 }, rev: "d1", reading: null },
    { id: "daily", kind: "practice", title: "Daily practice", subtitle: "Once a day", minutes: { music: 16, voice: 16 }, rev: "d1", reading: null },
    { id: "night", kind: "practice", title: "Night practice", subtitle: "For bed · ends in sleep", minutes: { music: 19, voice: 18 }, rev: "d1", reading: null },
    {
      id: "flare",
      kind: "flare",
      title: "Flare-up",
      subtitle: "For a bad moment",
      minutes: { music: 4, voice: 4 },
      rev: "d2",
      safetyExtra: "If the pain is severe, new, or different from usual, seek medical care.",
      reading: null,
    },
  ],
};

const COURSES: Record<CourseSlug, CourseDef> = { "calm-gut": CALM_GUT };

export function getCourse(slug: string): CourseDef | null {
  return (COURSES as Record<string, CourseDef>)[slug] ?? null;
}

export function getCourseTrack(course: CourseDef, id: string): CourseTrackDef | null {
  return course.tracks.find((t) => t.id === id) ?? null;
}

/** Object key for one track version: `calm-gut/d1/s3-music.m4a`. */
export function courseAudioKey(course: CourseDef, track: CourseTrackDef, version: CourseVersion): string {
  return `${course.slug}/${track.rev}/${track.id}-${version}.m4a`;
}

/** Whole days from start to today (both YYYY-MM-DD); negative before start. */
export function courseDay(startYmd: string, todayYmd: string): number {
  const s = Date.parse(`${startYmd}T00:00:00Z`);
  const t = Date.parse(`${todayYmd}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(t)) return -1;
  return Math.round((t - s) / 86_400_000);
}

/** Is this track open on this day of the course? Practices and the flare-up
 *  track are open from day 0; session N opens on day 7 × (N − 1). */
export function isTrackUnlocked(track: CourseTrackDef, day: number): boolean {
  if (day < 0) return false;
  if (track.kind !== "session") return true;
  return day >= 7 * ((track.week ?? 1) - 1);
}

/** YYYY-MM-DD the track opens. */
export function trackUnlockYmd(track: CourseTrackDef, startYmd: string): string {
  const days = track.kind === "session" ? 7 * ((track.week ?? 1) - 1) : 0;
  const d = new Date(Date.parse(`${startYmd}T00:00:00Z`) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Which symptom check is due today, if any. A check opens on day 7 × week and
 * stays open until it is done or the next one opens (a missed week-6 check is
 * dropped once week 12 arrives, so the listener never owes two at once).
 */
export function dueScoreWeek(
  course: CourseDef,
  day: number,
  doneWeeks: number[],
): number | null {
  if (day < 0) return null;
  const done = new Set(doneWeeks);
  let open: number | null = null;
  for (const w of course.scoreWeeks) if (day >= w * 7) open = w;
  return open !== null && !done.has(open) ? open : null;
}

/** The checkpoint a score taken today belongs to: the latest one reached. */
export function scoreCheckpointFor(course: CourseDef, day: number): number {
  let cp = course.scoreWeeks[0] ?? 0;
  for (const w of course.scoreWeeks) if (day >= w * 7) cp = w;
  return cp;
}

/** The five questions, each 0–10, "over the past 7 days". */
export const COURSE_SCORE_QUESTIONS = [
  { id: "bloating", label: "Bloating" },
  { id: "pain", label: "Pain or discomfort in your belly" },
  { id: "bowel", label: "Trouble with your bowel habit" },
  { id: "worry", label: "Worry about your gut" },
  { id: "life", label: "How much it affects your daily life" },
] as const;
export type CourseScoreId = (typeof COURSE_SCORE_QUESTIONS)[number]["id"];
