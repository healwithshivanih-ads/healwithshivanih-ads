/**
 * Food diary — the pure half (no node/server imports), shared by the client
 * app, the coach desktop panel, the /m phone view and the decisions inbox.
 *
 * WHAT IT IS (docs/FOOD_DIARY_PLAN.md): a time-boxed photo diary the coach
 * switches on for one client — "for the next 3 days, snap everything you eat
 * and drink". It is not a permanent logger and not a chase: it exists only
 * while `client.yaml#food_diary` says so, and nothing automatic ever tells the
 * client about it (decision 2026-10-23: the coach does not auto-chase). The
 * only push it can cause is a reminder the CLIENT switches on in the card.
 *
 * STORAGE — two things, deliberately separate:
 *
 *   client.yaml#food_diary          the coach's switch: id, start, days, status.
 *                                   Written only on the Mac, projected to Fly
 *                                   (minus `focus`, which is her own note).
 *   _food_diary.<host>.jsonl        what happened: one JSON line per event,
 *                                   append-only, one file PER WRITING HOST —
 *                                   the same trick as _thread.<host>.jsonl, so
 *                                   Fly (client photos) and the Mac (coach
 *                                   corrections, later the AI reading) can
 *                                   never conflict over one file.
 *
 * Every line names an entry and carries only the fields that event changes.
 * The reader folds them in time order. That shape is what lets phase 2 add an
 * AI reading (`op: "read"`) and the coach correct it (`op: "label"`) on the
 * same entry with no migration: they are just more lines.
 */

/** Parts of the day a photo can belong to. Same keys as the app's "Your day"
 *  bands (day-plan.ts) minus "anytime" — a meal always happened at a time. */
export const DIARY_BANDS = ["waking", "morning", "midday", "evening", "bedtime"] as const;
export type DiaryBand = (typeof DIARY_BANDS)[number];

/** Client-facing names. Food words, not clock words: "Breakfast" reads
 *  better under a photo of breakfast than "Morning". */
export const DIARY_BAND_LABEL: Record<DiaryBand, string> = {
  waking: "Early morning",
  morning: "Breakfast",
  midday: "Lunch",
  evening: "Evening",
  bedtime: "Late night",
};

/** Same boundaries as day-plan.ts::bandForHour — pinned equal by a test. */
export function diaryBandForHour(hour: number): DiaryBand {
  if (hour < 8) return "waking";
  if (hour < 12) return "morning";
  if (hour < 16) return "midday";
  if (hour < 21) return "evening";
  return "bedtime";
}

export const DIARY_MIN_DAYS = 1;
export const DIARY_MAX_DAYS = 14;
export const DIARY_DEFAULT_DAYS = 3;
/** Days a finished diary stays on the coach's inbox if she never opens it. */
export const DIARY_INBOX_DAYS = 14;
export const DIARY_NOTE_MAX = 200;
export const DIARY_LABEL_MAX = 300;

/** The coach's switch, as stored on client.yaml. */
export interface FoodDiaryConfig {
  id: string;
  /** YYYY-MM-DD, first diary day (client's calendar). */
  start: string;
  days: number;
  /** Coach-only: what she is looking for ("protein", "snacks"). Never staged. */
  focus?: string;
  status: "active" | "ended";
  started_at?: string;
  ended_at?: string;
  /** Coach opened the finished diary — clears the inbox item. */
  reviewed_at?: string;
}

/** What phase 2 writes per photo. Declared now so the reader carries it. */
export interface DiaryAiReading {
  readable: boolean;
  confidence?: number;
  dishes?: { name: string; portion?: string }[];
  read_at?: string;
  model?: string;
}

export type DiaryOp = "add" | "edit" | "delete" | "day_done" | "label" | "read";

/** One line of a _food_diary.<host>.jsonl file. */
export interface DiaryLine {
  op: DiaryOp;
  diary_id: string;
  /** When this line was written (ISO, UTC). Orders the fold. */
  ts: string;
  entry_id?: string;
  /** add / edit — the client's own calendar day and wall-clock time. */
  date?: string;
  time?: string;
  band?: DiaryBand;
  photo?: string;
  note?: string;
  /** label — the coach's correction. Always wins over any AI reading. */
  label?: string;
  /** read — phase 2. */
  reading?: DiaryAiReading;
}

export interface DiaryEntry {
  entry_id: string;
  diary_id: string;
  date: string;
  time: string;
  band: DiaryBand;
  photo: string;
  note: string;
  created_at: string;
  edited_at?: string;
  deleted?: boolean;
  coach_label?: string;
  coach_labelled_at?: string;
  ai_reading?: DiaryAiReading;
}

export interface FoldedDiary {
  /** Live entries (deleted ones removed), oldest eaten first. */
  entries: DiaryEntry[];
  /** Days the client marked "done for today". */
  daysDone: Set<string>;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isYmd = (s: unknown): s is string => typeof s === "string" && YMD.test(s);
export const isHhmm = (s: unknown): s is string => typeof s === "string" && HHMM.test(s);
export const isDiaryBand = (s: unknown): s is DiaryBand =>
  typeof s === "string" && (DIARY_BANDS as readonly string[]).includes(s);

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Coerce whatever is on client.yaml into a config, or null. js-yaml turns an
 * unquoted 2026-10-23 into a Date, so dates are accepted in both forms.
 */
export function parseDiaryConfig(raw: unknown): FoodDiaryConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ymd = (v: unknown): string =>
    v instanceof Date ? (Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10)) : typeof v === "string" ? v.slice(0, 10) : "";
  const iso = (v: unknown): string | undefined =>
    v instanceof Date ? v.toISOString() : typeof v === "string" && v ? v : undefined;
  const id = typeof r.id === "string" ? r.id : "";
  const start = ymd(r.start);
  const days = Number(r.days);
  if (!id || !isYmd(start) || !Number.isInteger(days) || days < DIARY_MIN_DAYS || days > DIARY_MAX_DAYS) return null;
  return {
    id,
    start,
    days,
    ...(typeof r.focus === "string" && r.focus ? { focus: r.focus } : {}),
    status: r.status === "ended" ? "ended" : "active",
    ...(iso(r.started_at) ? { started_at: iso(r.started_at) } : {}),
    ...(iso(r.ended_at) ? { ended_at: iso(r.ended_at) } : {}),
    ...(iso(r.reviewed_at) ? { reviewed_at: iso(r.reviewed_at) } : {}),
  };
}

export function diaryLastDay(cfg: FoodDiaryConfig): string {
  return addDays(cfg.start, cfg.days - 1);
}

/** Every diary day, first to last. */
export function diaryDates(cfg: FoodDiaryConfig): string[] {
  return Array.from({ length: cfg.days }, (_, i) => addDays(cfg.start, i));
}

export type DiaryPhase = "upcoming" | "running" | "finished";

/** Ended by the coach, or past its last day → finished. */
export function diaryPhase(cfg: FoodDiaryConfig, todayYmd: string): DiaryPhase {
  if (cfg.status === "ended") return "finished";
  if (todayYmd < cfg.start) return "upcoming";
  if (todayYmd > diaryLastDay(cfg)) return "finished";
  return "running";
}

/** 1-based day number of `todayYmd`, clamped to the window. */
export function diaryDayNumber(cfg: FoodDiaryConfig, todayYmd: string): number {
  return Math.min(cfg.days, Math.max(1, daysBetween(cfg.start, todayYmd) + 1));
}

/** The day the diary actually finished — when the coach ended it early, that
 *  day; otherwise its last day. */
export function diaryFinishedOn(cfg: FoodDiaryConfig): string {
  const last = diaryLastDay(cfg);
  if (cfg.status === "ended" && cfg.ended_at) {
    const ended = cfg.ended_at.slice(0, 10);
    return ended < last ? ended : last;
  }
  return last;
}

/** Days a client may still add a photo to: every diary day up to today. */
export function diaryOpenDates(cfg: FoodDiaryConfig, todayYmd: string): string[] {
  if (diaryPhase(cfg, todayYmd) !== "running") return [];
  return diaryDates(cfg).filter((d) => d <= todayYmd);
}

/** Parse one JSONL file's text. Torn or foreign lines are skipped. */
export function parseDiaryLines(raw: string): DiaryLine[] {
  const out: DiaryLine[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const l = JSON.parse(t) as DiaryLine;
      if (l && typeof l.op === "string" && typeof l.diary_id === "string" && typeof l.ts === "string") out.push(l);
    } catch {
      /* torn final line from an interrupted append — the rest still reads */
    }
  }
  return out;
}

/**
 * Fold every host's lines for ONE diary into its current entries.
 *
 * Order is by `ts`, so a correction written on the Mac after a client's edit
 * on Fly lands after it regardless of which file it came from. A line that
 * edits an entry nobody added is ignored rather than inventing one.
 */
export function foldDiary(lines: readonly DiaryLine[], diaryId: string): FoldedDiary {
  const mine = lines.filter((l) => l.diary_id === diaryId).slice().sort((a, b) => a.ts.localeCompare(b.ts));
  const byId = new Map<string, DiaryEntry>();
  const daysDone = new Set<string>();
  for (const l of mine) {
    if (l.op === "day_done") {
      if (isYmd(l.date)) daysDone.add(l.date);
      continue;
    }
    if (!l.entry_id) continue;
    if (l.op === "add") {
      if (byId.has(l.entry_id) || !l.photo || !isYmd(l.date) || !isHhmm(l.time) || !isDiaryBand(l.band)) continue;
      byId.set(l.entry_id, {
        entry_id: l.entry_id,
        diary_id: l.diary_id,
        date: l.date,
        time: l.time,
        band: l.band,
        photo: l.photo,
        note: typeof l.note === "string" ? l.note : "",
        created_at: l.ts,
      });
      continue;
    }
    const e = byId.get(l.entry_id);
    if (!e) continue;
    if (l.op === "edit") {
      if (isYmd(l.date)) e.date = l.date;
      if (isHhmm(l.time)) e.time = l.time;
      if (isDiaryBand(l.band)) e.band = l.band;
      if (typeof l.note === "string") e.note = l.note;
      e.edited_at = l.ts;
    } else if (l.op === "delete") {
      e.deleted = true;
      e.edited_at = l.ts;
    } else if (l.op === "label") {
      const label = typeof l.label === "string" ? l.label.trim() : "";
      if (label) {
        e.coach_label = label;
        e.coach_labelled_at = l.ts;
      } else {
        delete e.coach_label;
        delete e.coach_labelled_at;
      }
    } else if (l.op === "read" && l.reading && typeof l.reading.readable === "boolean") {
      e.ai_reading = l.reading;
    }
  }
  const entries = [...byId.values()]
    .filter((e) => !e.deleted)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.created_at.localeCompare(b.created_at));
  return { entries, daysDone };
}

/** Coach grid: diary day → band → entries. Every day and band present. */
export function diaryGrid(cfg: FoodDiaryConfig, entries: readonly DiaryEntry[]): {
  date: string;
  dayNumber: number;
  bands: { band: DiaryBand; entries: DiaryEntry[] }[];
  count: number;
}[] {
  return diaryDates(cfg).map((date, i) => {
    const today = entries.filter((e) => e.date === date);
    return {
      date,
      dayNumber: i + 1,
      count: today.length,
      bands: DIARY_BANDS.map((band) => ({ band, entries: today.filter((e) => e.band === band) })),
    };
  });
}

/** A fresh diary id: date + short random suffix. */
export function newDiaryId(startYmd: string, rand: string): string {
  return `fd-${startYmd}-${rand.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase()}`;
}

/**
 * Should a finished diary be a decision on the coach's inbox today?
 * Exit: she marks it reviewed, or DIARY_INBOX_DAYS pass.
 */
export function diaryInboxAge(cfg: FoodDiaryConfig, todayYmd: string): number | null {
  if (diaryPhase(cfg, todayYmd) !== "finished") return null;
  if (cfg.reviewed_at) return null;
  const finished = diaryFinishedOn(cfg);
  // Ended on its last day (or early) — it is ready from the day after the
  // last one the client could add to, or the day the coach ended it.
  const readyOn = cfg.status === "ended" ? finished : addDays(finished, 1);
  const age = daysBetween(readyOn, todayYmd);
  if (age < 0 || age > DIARY_INBOX_DAYS) return null;
  return age;
}

/** Time-of-day reminders the client may switch on from the card. All OFF by
 *  default — a diary never pushes anything the client did not ask for. */
export const DIARY_REMINDERS = [
  { id: "diary-breakfast", label: "Food diary — add your breakfast", time: "09:00" },
  { id: "diary-lunch", label: "Food diary — add your lunch", time: "14:00" },
  { id: "diary-dinner", label: "Food diary — add your dinner", time: "21:00" },
] as const;

/**
 * What the CLIENT's app receives. Built field by field rather than by
 * spreading an entry, so a coach correction or a phase-2 AI reading (dishes,
 * portions, confidence — numbers) can never reach a client screen by being
 * carried along. food-diary.test.ts pins the key set.
 */
export interface ClientDiaryEntry {
  entry_id: string;
  date: string;
  time: string;
  band: DiaryBand;
  note: string;
  file: string;
}

export interface ClientDiaryView {
  id: string;
  days: number;
  dayNumber: number;
  today: string;
  isLastDay: boolean;
  /** Diary days up to today — where an "earlier" photo may go. */
  openDates: string[];
  entries: ClientDiaryEntry[];
  daysDone: string[];
}

export function clientDiaryView(
  cfg: FoodDiaryConfig | null,
  folded: FoldedDiary | null,
  todayYmd: string,
): ClientDiaryView | null {
  if (!cfg || diaryPhase(cfg, todayYmd) !== "running") return null;
  const entries = (folded?.entries ?? []).map((e) => ({
    entry_id: e.entry_id,
    date: e.date,
    time: e.time,
    band: e.band,
    note: e.note,
    file: e.photo,
  }));
  return {
    id: cfg.id,
    days: cfg.days,
    dayNumber: diaryDayNumber(cfg, todayYmd),
    today: todayYmd,
    isLastDay: todayYmd === diaryLastDay(cfg),
    openDates: diaryOpenDates(cfg, todayYmd),
    entries,
    daysDone: [...(folded?.daysDone ?? [])].sort(),
  };
}

/**
 * Server-side acceptance of a client-sent diary date. The phone sends its own
 * calendar day; the server's "today" may be a timezone away, so a date is
 * accepted when it is a diary day and not more than a day ahead of UTC.
 */
export function acceptClientDiaryDate(cfg: FoodDiaryConfig, dateYmd: string, nowUtcYmd: string): boolean {
  if (cfg.status !== "active") return false;
  if (!isYmd(dateYmd) || !diaryDates(cfg).includes(dateYmd)) return false;
  if (dateYmd > addDays(nowUtcYmd, 1)) return false;
  // Over: more than a day past its last day in UTC terms.
  if (nowUtcYmd > addDays(diaryLastDay(cfg), 1)) return false;
  return true;
}
