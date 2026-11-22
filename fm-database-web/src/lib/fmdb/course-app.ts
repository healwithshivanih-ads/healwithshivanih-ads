/**
 * The course section of the client app.
 *
 * `buildAppCourse` turns a course + the listener's start date + their saved
 * record into what the screens read: which tracks are open today, this
 * week's session, the safety text, the log history and the streak.
 *
 * `buildCourseAppData` is the whole app payload for someone who bought ONLY
 * a course (Calm Gut, ₹2,499): tier "guided" (no coach, no chat, no labs) with
 * `course.only = true`, which the app shell routes to the course screens and
 * the Ochre wordmark. Every plan-shaped field is empty on purpose.
 *
 * Programme clients getting the course later: attach `course` (with
 * only = false) to their normal payload from a per-client switch; the
 * screens are written to work as a section of the full app too.
 */

import type { ClientAppData } from "./client-app";
import type { GuidedSubscriber } from "./guided-tier";
import { refundOffer, rupees } from "./course-refund";
import { courseImage, type CourseImage } from "./course-images";
import { clientCourseOwnerId, clientCourses } from "./client-courses";
import {
  courseDay,
  dueScoreWeek,
  getCourse,
  isTrackUnlocked,
  trackUnlockYmd,
  type CourseDef,
  type CourseTrackKind,
} from "./courses";
import {
  listeningStreak,
  readCourseRecord,
  type CourseDayLog,
  type CourseRecord,
  type CourseReminderPrefs,
  type CourseScore,
} from "./course-store";

export interface AppCourseTrack {
  id: string;
  kind: CourseTrackKind;
  title: string;
  subtitle: string;
  week?: number;
  unlocked: boolean;
  /** YYYY-MM-DD it opens (sessions); null for always-open tracks. */
  unlocksOn: string | null;
  /** "Opens Tue 15 Dec" for a locked session; null when open. */
  unlocksLabel: string | null;
  minutes: { music: number; voice: number };
  /** Audio revision — part of the offline cache key. */
  rev: string;
  safetyExtra?: string;
  /** The week's 2-minute reading (sessions and intros); null otherwise. */
  reading: string | null;
  readingTitle?: string;
  /** Sessions: the week's intro track id (r1 …). */
  introId?: string;
  /** Only a voice version exists (intros): no music/voice switch. */
  voiceOnly?: boolean;
  /** Listened to ≥ 80% at least once. */
  listened: boolean;
  /** Her week photo for this track (course-images.ts); null until it exists. */
  image?: CourseImage | null;
}

export interface AppCourse {
  slug: string;
  title: string;
  tagline: string;
  /** The buyer's first name, shown as "Priya's Calm Gut" — a gentle reminder
   *  that the link is personal. Empty when unknown. */
  ownerFirstName: string;
  /** True when the course IS the whole app (a course-only buyer). */
  only: boolean;
  startedOn: string;
  startLabel: string;
  /** 0 on the start day. */
  day: number;
  /** 1-based course week, capped at totalWeeks. */
  week: number;
  totalWeeks: number;
  /** Past the last week: every session open, the course carries on as a library. */
  finished: boolean;
  /** This week's session (the newest open one). */
  currentSessionId: string | null;
  safety: string;
  tracks: AppCourseTrack[];
  todayYmd: string;
  history: { days: Record<string, CourseDayLog>; scores: CourseScore[] };
  streak: number;
  /** The checkpoint week (0 / 6 / 12) whose symptom check is due, or null. */
  scoreDue: number | null;
  reminders: CourseReminderPrefs;
  /** Paid buyers in their first 7 days can ask for a refund in the app.
   *  Null for gifts and for programme clients. */
  refund?: {
    eligible: boolean;
    amountLabel: string;
    until: string;
    pendingSince: string | null;
  } | null;
}

const HISTORY_DAYS = 180;

function ymdInTz(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function shortDateLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}

export function buildAppCourse(
  course: CourseDef,
  startYmd: string,
  record: CourseRecord,
  opts: { tz: string; now?: Date; only: boolean; ownerFirstName?: string },
): AppCourse {
  const todayYmd = ymdInTz(opts.now ?? new Date(), opts.tz);
  const day = courseDay(startYmd, todayYmd);
  const listenedIds = new Set(record.listens.map((l) => l.track));
  const tracks: AppCourseTrack[] = course.tracks.map((t) => {
    const unlocked = isTrackUnlocked(t, day);
    const unlocksOn = t.kind === "session" ? trackUnlockYmd(t, startYmd) : null;
    return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      subtitle: t.subtitle,
      ...(t.week ? { week: t.week } : {}),
      unlocked,
      unlocksOn,
      unlocksLabel: !unlocked && unlocksOn ? `Opens ${shortDateLabel(unlocksOn)}` : null,
      minutes: t.minutes,
      rev: t.rev,
      ...(t.safetyExtra ? { safetyExtra: t.safetyExtra } : {}),
      reading: t.reading,
      ...(t.readingTitle ? { readingTitle: t.readingTitle } : {}),
      ...(t.introId ? { introId: t.introId } : {}),
      ...(t.voiceOnly ? { voiceOnly: true } : {}),
      listened: listenedIds.has(t.id),
    };
  });
  const openSessions = tracks.filter((t) => t.kind === "session" && t.unlocked);
  const current = openSessions[openSessions.length - 1] ?? null;
  const week = day < 0 ? 0 : Math.min(Math.floor(day / 7) + 1, course.totalWeeks);

  const cutoff = Date.parse(`${todayYmd}T00:00:00Z`) - HISTORY_DAYS * 86_400_000;
  const days: Record<string, CourseDayLog> = {};
  for (const [k, v] of Object.entries(record.days)) {
    if (Date.parse(`${k}T00:00:00Z`) >= cutoff) days[k] = v;
  }

  return {
    slug: course.slug,
    title: course.title,
    tagline: course.tagline,
    ownerFirstName: opts.ownerFirstName ?? "",
    only: opts.only,
    startedOn: startYmd,
    startLabel: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long" }).format(
      new Date(`${startYmd}T00:00:00Z`),
    ),
    day,
    week,
    totalWeeks: course.totalWeeks,
    finished: day >= course.totalWeeks * 7,
    currentSessionId: current?.id ?? null,
    safety: course.safety,
    tracks,
    todayYmd,
    history: { days, scores: record.scores },
    streak: listeningStreak(record.days, todayYmd),
    scoreDue: dueScoreWeek(
      course,
      day,
      record.scores.map((s) => s.week),
    ),
    reminders: record.reminders,
  };
}

/** A course the coach gave a programme client in their own app, or null when
 *  none is switched on (client.yaml#courses, client-courses.ts). The record
 *  is the client's own: clients/<id>/course-<slug>.json. */
export async function buildClientCourse(
  doc: Record<string, unknown>,
  clientId: string,
  tz: string,
  now: Date = new Date(),
): Promise<AppCourse | null> {
  const entry = clientCourses(doc)[0];
  if (!entry) return null;
  const course = getCourse(entry.slug);
  if (!course) return null;
  const record = await readCourseRecord(clientCourseOwnerId(clientId), course.slug);
  const c = buildAppCourse(course, entry.started_on, record, { tz, now, only: false });
  // No refund and no course reminders here: the client app has its own.
  return { ...c, tracks: c.tracks.map((t) => ({ ...t, image: courseImage(t.id) })), refund: null };
}

/** The whole app payload for a course-only buyer. */
export async function buildCourseAppData(
  sub: GuidedSubscriber,
  course: CourseDef,
  tz: string,
  now: Date = new Date(),
): Promise<ClientAppData> {
  const record = await readCourseRecord(sub.subscriber_id, course.slug);
  const owner = (sub.display_name || "").trim().split(/\s+/)[0] ?? "";
  const appCourse = buildAppCourse(course, sub.start_date, record, {
    tz,
    now,
    only: true,
    ownerFirstName: owner && owner.toLowerCase() !== "there" ? owner : "",
  });
  const todayLong = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now);
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dom = Number(ymdInTz(now, tz).slice(8, 10));
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: tz, month: "long" }).format(now);
  const firstName = (sub.display_name || "there").split(/\s+/)[0];
  // Letters only: "Shivani (demo)" → "SD", never "S(".
  const initials =
    (sub.display_name || "")
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}]/gu, "")[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "·";

  return {
    clientId: sub.subscriber_id,
    planSlug: `course:${course.slug}`,
    token: sub.app_token,
    timezone: tz,
    tier: "guided",
    exerciseSessions: [],
    checkinPrefill: { supplements: {}, practices: {} },
    discoveryCredit: null,
    discoverySummary: null,
    discoveryStage: null,
    intakeUrl: null,
    mode: "ACTIVE",
    endgame: null,
    labOrders: [],
    client: {
      firstName,
      program: course.title,
      week: Math.max(appCourse.week, 1),
      totalWeeks: course.totalWeeks,
      tenureWeek: Math.max(appCourse.week, 1),
      tenureTotalWeeks: course.totalWeeks,
      phaseNumber: 1,
      continued: false,
      startDateLabel: appCourse.startLabel,
      notStarted: false,
      startsInDays: 0,
      dosha: [],
      doshaLabel: "",
      coachLine: "",
    },
    coach: {
      // Never shown to a course buyer; no personal name here (Shivani, 22 Nov).
      name: "Coach",
      role: "Functional medicine coach",
      initials: "OT",
      whatsappNumber: "", // a course buyer has no coach access
      whatsappPrefill: "",
      nextSession: null,
    },
    today: { dow: todayLong, dateLabel: `${dom} ${month}`, idx: Math.max(0, DOW_LONG.indexOf(todayLong)) },
    weekStrip: [],
    meals: [],
    weekMenus: [],
    menuIsSample: false,
    recipePack: [],
    grocery: null,
    swapGroups: [],
    msqEntries: [],
    travel: null,
    mealExtra: {},
    supplements: [],
    upcomingSupplements: [],
    allSupplements: [],
    slotOrder: [],
    practices: [],
    guidelines: [],
    practicesComingLater: 0,
    seedCycling: null,
    periodCare: null,
    cyclePhase: null,
    breathwork: null,
    somatic: [],
    eft: null,
    sleep: null,
    mindBody: null,
    mindBodyReads: [],
    mindBodyWithheld: 0,
    principles: [],
    labs: [],
    labVault: null,
    journey: [],
    faq: [],
    symptomScore: null,
    watchList: [],
    labCheckpoints: { note: "", list: [] },
    movementGoalMins: 0,
    remedies: [],
    remedyLib: [],
    remedyShelf: [],
    tissueSalts: null,
    coachPicks: [],
    planRef: {
      pattern: course.title,
      authoredBy: "The Ochre Tree",
      forNote: course.tagline,
      phase: { currentIdx: 0, list: [] },
      plate: [],
      accents: [],
      oils: { use: [], avoid: [], note: "" },
      foods: { eat: [], sometimes: [], avoid: [] },
      letterFoods: null,
      avoidWhy: "",
      cooking: [],
      focus: { why: course.tagline, conditions: [] },
      ayurveda: null,
      flags: [],
    },
    mealsNote: "",
    lessons: [],
    resources: [],
    aiSuggested: [],
    account: {
      name: sub.display_name,
      contact: sub.email || sub.phone,
      plan: course.title,
      member: "",
      avatar: initials,
      photoUrl: null,
      collectionAddress: "",
      collectionPincode: "",
    },
    body: {
      heightCm: null,
      ageYears: null,
      sex: "",
      latest: { weightKg: null, waistCm: null, hipCm: null, bpSystolic: null, bpDiastolic: null, measuredOn: null },
      history: [],
    },
    reminders: [],
    weightLoss: null,
    planUpdatedAt: null,
    clientUpdateNote: null,
    guidedWeekly: null,
    guidedAbout: null,
    course: {
      ...appCourse,
      tracks: appCourse.tracks.map((t) => ({ ...t, image: courseImage(t.id) })),
      refund: (() => {
        const r = refundOffer(sub, now);
        return r.amountPaise > 0 ? { eligible: r.eligible, amountLabel: rupees(r.amountPaise), until: r.until, pendingSince: r.pendingSince } : null;
      })(),
    },
  };
}
