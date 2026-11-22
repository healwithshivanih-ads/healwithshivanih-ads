"use client";

/**
 * Calm Gut — the course section of the client app.
 *
 * For a course-only buyer this IS the app: Today (flare-up tile, this week's
 * session, the daily and night practice, the 30-second log), Sessions (all
 * eight, one opening a week), Progress (bloating + the 5-question score, the
 * days listened, never a streak) and Help (reminders, safety, support). Written to sit
 * inside the full app too, for programme clients later (course.only false).
 *
 * Rules carried from the launch plan: safety text on every track's screen;
 * "may ease", never cure / heal / treat; no supplements; the listener's logs
 * are theirs (saved to their own record so a new phone keeps them).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AppCourse, AppCourseTrack } from "@/lib/fmdb/course-app";
import type { CourseDayLog, CourseScore } from "@/lib/fmdb/course-store";
import { COURSE_SCORE_QUESTIONS } from "@/lib/fmdb/courses";
import { usePush } from "@/lib/fmdb/use-push";
import {
  configurePlayer,
  fmtTime,
  getPlayerState,
  introSeen,
  load,
  playWithIntro,
  pause,
  play,
  PLAYBACK_RATES,
  preferredRate,
  preferredVersion,
  savedPosition,
  seek,
  setPendingVersion,
  setPreferredVersion,
  setRate,
  skip,
  skipIntro,
  stop,
  subscribePlayer,
  type CourseVersion,
  type PlayerTrack,
} from "./course-player";
import { isSavedOffline, offlineSupported, removeOffline, saveOffline } from "./course-offline";

// ── shared state ─────────────────────────────────────────────────────────────

interface CourseCtx {
  course: AppCourse;
  token: string;
  days: Record<string, CourseDayLog>;
  scores: CourseScore[];
  listened: Set<string>;
  streak: number;
  scoreDue: number | null;
  today: string;
  saveLog: (date: string, patch: CourseDayLog) => Promise<boolean>;
  saveScore: (answers: Record<string, number>) => Promise<{ ok: boolean; total?: number }>;
  setReminders: (daily_time: string | null, unlock: boolean) => Promise<boolean>;
  reminders: AppCourse["reminders"];
}

const Ctx = createContext<CourseCtx | null>(null);

export function useCourse(): CourseCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCourse outside CourseProvider");
  return c;
}

function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Consecutive listening days ending today, or yesterday (grace day). */
export function streakFrom(days: Record<string, CourseDayLog>, today: string): number {
  let t = Date.parse(`${today}T00:00:00Z`);
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (!days[ymd(t)]?.listened) t -= 86_400_000;
  let n = 0;
  while (days[ymd(t)]?.listened) {
    n++;
    t -= 86_400_000;
  }
  return n;
}

async function post(token: string, action: string, body: Record<string, unknown>) {
  const res = await fetch("/api/app-course", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action, ...body }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && j.ok === true, j };
}

export function CourseProvider({
  course,
  token,
  clientId,
  children,
}: {
  course: AppCourse;
  token: string;
  clientId: string;
  children: React.ReactNode;
}) {
  const [days, setDays] = useState<Record<string, CourseDayLog>>(course.history.days);
  const [scores, setScores] = useState<CourseScore[]>(course.history.scores);
  const [listened, setListened] = useState<Set<string>>(
    () => new Set(course.tracks.filter((t) => t.listened).map((t) => t.id)),
  );
  const [reminders, setRem] = useState(course.reminders);
  const today = localToday();

  useEffect(() => {
    configurePlayer({
      token,
      clientKey: clientId,
      onListened: (id) => {
        setListened((s) => new Set(s).add(id));
        setDays((d) => ({ ...d, [localToday()]: { ...(d[localToday()] ?? {}), listened: true } }));
      },
    });
  }, [token, clientId]);

  const saveLog = useCallback(
    async (date: string, patch: CourseDayLog) => {
      setDays((d) => ({ ...d, [date]: { ...(d[date] ?? {}), ...patch } }));
      const { ok } = await post(token, "log", { course: course.slug, date, ...patch });
      return ok;
    },
    [token, course.slug],
  );

  const saveScore = useCallback(
    async (answers: Record<string, number>) => {
      const { ok, j } = await post(token, "score", { course: course.slug, answers });
      if (ok && Array.isArray(j.scores)) setScores(j.scores as CourseScore[]);
      return { ok, total: typeof j.total === "number" ? j.total : undefined };
    },
    [token, course.slug],
  );

  const setReminders = useCallback(
    async (daily_time: string | null, unlock: boolean) => {
      setRem({ daily_time, unlock });
      const { ok } = await post(token, "reminders", { course: course.slug, daily_time, unlock });
      return ok;
    },
    [token, course.slug],
  );

  const scoreDue = useMemo(() => {
    // Recompute from the live list so a just-saved score clears the card.
    if (course.scoreDue === null) return null;
    return scores.some((s) => s.week === course.scoreDue) ? null : course.scoreDue;
  }, [course.scoreDue, scores]);

  const value: CourseCtx = {
    course,
    token,
    days,
    scores,
    listened,
    streak: streakFrom(days, today),
    scoreDue,
    today,
    saveLog,
    saveScore,
    setReminders,
    reminders,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function usePlayer() {
  return useSyncExternalStore(subscribePlayer, getPlayerState, getPlayerState);
}

function toPlayerTrack(course: AppCourse, t: AppCourseTrack): PlayerTrack {
  return { courseSlug: course.slug, id: t.id, title: t.title, subtitle: t.subtitle, rev: t.rev, kind: t.kind };
}

// ── the look ─────────────────────────────────────────────────────────────────
// Same look as the new coach app (mock-up v12, Shivani 22 Nov 2026: "check the
// new coach app look - that works"): ash ground, off-white rows with a thin
// border and no shadow, Fraunces headings (never italic), Instrument Sans text,
// charcoal square-cornered buttons, plain hairline lists, text-only tab bar.
// No gradients, no pills for actions, no emoji or decorative icons.

function PlayGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </svg>
  );
}
function PauseGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
    </svg>
  );
}

/** A Today row: coloured dot, small grey label, title, one line, chevron. */
function Row({
  dot,
  label,
  title,
  meta,
  onClick,
  done,
}: {
  dot: "fire" | "grow" | "cedar" | "grey";
  label: string;
  title: string;
  meta?: string;
  onClick: () => void;
  done?: boolean;
}) {
  return (
    <button className="cg-it" onClick={onClick}>
      <span className={`cg-dot ${dot}`} aria-hidden />
      <span className="cg-it-body">
        <span className="cg-k">{label}</span>
        <span className="cg-t">{title}</span>
        {meta && <span className="cg-m">{meta}</span>}
      </span>
      {done ? (
        <span className="cg-ok" aria-label="Done today">
          ✓
        </span>
      ) : (
        <span className="cg-go" aria-hidden>
          ›
        </span>
      )}
    </button>
  );
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function longDate(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** "Now playing" bar: shows while a track is loaded and the player is closed. */
export function CourseNowPlaying({ onOpen }: { onOpen: (id: string) => void }) {
  const p = usePlayer();
  if (!p.track) return null;
  const sessionId = p.introFor?.id ?? p.track.id;
  return (
    <div className="cg-now">
      <button className="cg-now-main" onClick={() => onOpen(sessionId)}>
        <span className="cg-now-title">{p.introFor ? `${p.introFor.title}, intro` : p.track.title}</span>
        <span className="cg-now-time">
          {fmtTime(p.current)} of {fmtTime(p.duration)}
        </span>
      </button>
      <button className="cg-now-btn" onClick={() => (p.playing ? pause() : void play())} aria-label={p.playing ? "Pause" : "Play"}>
        {p.playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
    </div>
  );
}

// ── Today ────────────────────────────────────────────────────────────────────

/** Days with a listen in the current course week, and in all. No streaks:
 *  a missed day never shows as something broken (persona review, 22 Nov). */
export function listenedCounts(days: Record<string, CourseDayLog>, startYmd: string, week: number, today: string) {
  const weekStart = new Date(Date.parse(`${startYmd}T00:00:00Z`) + 7 * Math.max(0, week - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let thisWeek = 0;
  let total = 0;
  for (const [k, d] of Object.entries(days)) {
    if (!d.listened) continue;
    total++;
    if (k >= weekStart && k <= today) thisWeek++;
  }
  return { thisWeek, total };
}

/** The earliest open session not heard yet, if it is behind this week's. */
export function catchUpSession(course: AppCourse, listened: Set<string>): AppCourseTrack | null {
  const open = course.tracks.filter((t) => t.kind === "session" && t.unlocked);
  const behind = open.find((t) => !listened.has(t.id) && t.id !== course.currentSessionId);
  return behind ?? null;
}

export function CourseTodayScreen({
  openPlayer,
  openLog,
  openScore,
}: {
  openPlayer: (id: string) => void;
  openLog: () => void;
  openScore: () => void;
  goTab?: (t: string) => void;
}) {
  const { course, days, today, scoreDue, listened } = useCourse();
  const flare = course.tracks.find((t) => t.kind === "flare");
  const current = course.tracks.find((t) => t.id === course.currentSessionId);
  // Behind? Show the one to catch up on, not two new things at once.
  const catchUp = catchUpSession(course, listened);
  const session = catchUp ?? current;
  const daily = course.tracks.find((t) => t.id === "daily");
  const short = course.tracks.find((t) => t.id === "daily-short");
  const todayLog = days[today];
  const logged = !!todayLog && (todayLog.bloating !== undefined || todayLog.meals !== undefined || todayLog.stress !== undefined);
  const nextLocked = course.tracks.find((t) => t.kind === "session" && !t.unlocked);
  const title = course.ownerFirstName ? `${course.ownerFirstName}'s ${course.title}` : course.title;
  const counts = listenedCounts(days, course.startedOn, course.week, today);
  const intro = session?.introId ? course.tracks.find((t) => t.id === session.introId) : null;

  return (
    <div className="cg-screen">
      <p className="cg-date">{longDate()}</p>
      <h1 className="cg-h1">{title}</h1>
      <p className="cg-sub">
        {course.finished ? "All eight sessions are open." : `Week ${course.week} of ${course.totalWeeks}.`}
        {nextLocked?.unlocksLabel ? ` Next, ${nextLocked.title}, ${nextLocked.unlocksLabel.replace(/^Opens /, "opens ")}.` : ""}
      </p>

      <div className="cg-list">
        {session && (
          <div className="cg-it cg-it-card">
            <button className="cg-it-main" onClick={() => openPlayer(session.id)}>
              <span className="cg-dot grow" aria-hidden />
              <span className="cg-it-body">
                <span className="cg-k">{catchUp ? "Catch up" : "This week"}</span>
                <span className="cg-t">{catchUp ? `Catch up: ${session.title}` : session.title}</span>
                <span className="cg-m">
                  {catchUp && current
                    ? `Week ${session.week} session, ${session.minutes.music} minutes. This week's, ${current.title}, is there when you're ready.`
                    : `Session ${session.week}, ${session.minutes.music} minutes${!session.listened && session.introId ? ". Starts with a 2-minute intro the first time." : ""}`}
                </span>
              </span>
              <span className="cg-go" aria-hidden>
                ›
              </span>
            </button>
            {intro && (
              <div className="cg-it-links">
                <button className="cg-link-btn" onClick={() => openPlayer(intro.id)}>
                  This week&apos;s reading: {session.readingTitle}, to hear or read
                </button>
              </div>
            )}
          </div>
        )}
        {scoreDue !== null && (
          <Row
            dot="cedar"
            label="Symptom check"
            title={scoreDue === 0 ? "Before you begin" : scoreDue === 4 ? "Halfway" : "End of the course"}
            meta="Five questions, about 2 minutes. The same each time, so you can see what changes."
            onClick={openScore}
          />
        )}
        {flare && (
          <Row dot="fire" label="Having a bad moment?" title="Flare-up, 4 minutes" meta="Play it now, wherever you can close your eyes" onClick={() => openPlayer(flare.id)} />
        )}
        {daily && (
          <div className="cg-it cg-it-card">
            <button className="cg-it-main" onClick={() => openPlayer(daily.id)}>
              <span className="cg-dot grow" aria-hidden />
              <span className="cg-it-body">
                <span className="cg-k">Every day</span>
                <span className="cg-t">{daily.title}</span>
                <span className="cg-m">{daily.minutes.music} minutes</span>
              </span>
              <span className="cg-go" aria-hidden>
                ›
              </span>
            </button>
            {short && (
              <div className="cg-it-links">
                <button className="cg-link-btn" onClick={() => openPlayer(short.id)}>
                  Short daily practice · {short.minutes.music} min
                </button>
              </div>
            )}
          </div>
        )}
        <Row
          dot="grey"
          label="Today"
          title="30-second log"
          meta={
            logged
              ? `Bloating ${todayLog?.bloating ?? "–"}, stress ${todayLog?.stress ?? "–"}${todayLog?.listened ? ", listened" : ""}. Tap to change.`
              : "Bloating, meals, bowel, stress and sleep"
          }
          onClick={openLog}
        />
      </div>

      <p className="cg-note-line">
        {counts.thisWeek === 0
          ? "No listening yet this week. The short practice takes 7 minutes."
          : `You listened on ${counts.thisWeek} ${counts.thisWeek === 1 ? "day" : "days"} this week.`}
      </p>
    </div>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

function TrackLine({ t, onOpen, current }: { t: AppCourseTrack; onOpen: (id: string) => void; current?: boolean }) {
  const { listened } = useCourse();
  const right = !t.unlocked
    ? t.unlocksLabel
    : listened.has(t.id)
      ? `${t.minutes.music} min ✓`
      : `${t.minutes.music} min`;
  return (
    <button
      className={"cg-track" + (t.unlocked ? "" : " locked") + (current ? " current" : "")}
      onClick={() => t.unlocked && onOpen(t.id)}
      disabled={!t.unlocked}
      aria-label={t.unlocked ? `Play ${t.title}` : `${t.title}, ${t.unlocksLabel ?? "not open yet"}`}
    >
      <span className="cg-track-l">
        {t.week ? <span className="cg-k">Week {t.week}</span> : null}
        <span className="cg-t">{t.title}</span>
      </span>
      <span className="cg-track-r">
        {current && <span className="cg-tag fire">This week</span>}
        <span className="cg-m">{right}</span>
      </span>
    </button>
  );
}

export function CourseSessionsScreen({ openPlayer }: { openPlayer: (id: string) => void }) {
  const { course } = useCourse();
  const sessions = course.tracks.filter((t) => t.kind === "session");
  const others = course.tracks.filter((t) => t.kind !== "session" && t.kind !== "intro");
  return (
    <div className="cg-screen">
      <h1 className="cg-h1">Sessions</h1>
      <p className="cg-sub">{`${course.tagline} Listen to this week's session most days, and the daily practice on the others.`}</p>
      <div className="cg-card">
        <h2 className="cg-h2">The eight weeks</h2>
        <div className="cg-lines">
          {sessions.map((t) => (
            <TrackLine key={t.id} t={t} onOpen={openPlayer} current={t.id === course.currentSessionId} />
          ))}
        </div>
      </div>
      <div className="cg-card">
        <h2 className="cg-h2">Any time</h2>
        <div className="cg-lines">
          {others.map((t) => (
            <TrackLine key={t.id} t={t} onOpen={openPlayer} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────

export function bloatingWeeks(days: Record<string, CourseDayLog>, startYmd: string, weeks: number) {
  const start = Date.parse(`${startYmd}T00:00:00Z`);
  const out: { week: number; avg: number | null; n: number }[] = [];
  for (let w = 1; w <= weeks; w++) out.push({ week: w, avg: null, n: 0 });
  const sums = new Map<number, { s: number; n: number }>();
  for (const [k, v] of Object.entries(days)) {
    if (v.bloating === undefined) continue;
    const w = Math.floor((Date.parse(`${k}T00:00:00Z`) - start) / (7 * 86_400_000)) + 1;
    if (w < 1 || w > weeks) continue;
    const cur = sums.get(w) ?? { s: 0, n: 0 };
    sums.set(w, { s: cur.s + v.bloating, n: cur.n + 1 });
  }
  for (const o of out) {
    const c = sums.get(o.week);
    if (c) {
      o.avg = Math.round((c.s / c.n) * 10) / 10;
      o.n = c.n;
    }
  }
  return out;
}

function BloatingChart() {
  const { course, days } = useCourse();
  const weeks = Math.max(course.totalWeeks, course.week);
  const data = bloatingWeeks(days, course.startedOn, weeks);
  const W = 320;
  const H = 150;
  const padL = 24;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const x = (w: number) => padL + ((w - 1) / Math.max(weeks - 1, 1)) * (W - padL - padR);
  // Plain scale: 0 at the bottom, 10 at the top. Down is good, and the text says so.
  const y = (v: number) => padT + (1 - v / 10) * (H - padT - padB);
  const pts = data.filter((d) => d.avg !== null).map((d) => ({ x: x(d.week), y: y(d.avg!), d }));
  if (!pts.length) {
    return <p className="cg-m" style={{ margin: 0 }}>Log bloating for a few days and your weekly line appears here.</p>;
  }
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return (
    <>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average bloating each week">
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#EFE8E0" />
            <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#6B655F">
              {v}
            </text>
          </g>
        ))}
        <path d={line} fill="none" stroke="#557A43" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p) => (
          <circle key={p.d.week} cx={p.x} cy={p.y} r="3.5" fill="#FFFDFA" stroke="#557A43" strokeWidth="2" />
        ))}
        <text x={W - padR} y={y(10) + 12} textAnchor="end" fontSize="10" fill="#6B655F">
          more bloating ↑
        </text>
        <text x={W - padR} y={y(0) - 5} textAnchor="end" fontSize="10" fill="#6B655F">
          less bloating ↓
        </text>
        {data.map((d) => (
          <text key={d.week} x={x(d.week)} y={H - 6} textAnchor="middle" fontSize="10" fill="#6B655F">
            {d.week}
          </text>
        ))}
      </svg>
      <p className="cg-m" style={{ margin: 0 }}>Your average for each week, 0 to 10. Lower on the chart means less bloating.</p>
    </>
  );
}

export function CourseProgressScreen({ openScore }: { openScore: () => void }) {
  const { course, days, today, listened, scoreDue, scores } = useCourse();
  const sessionsTotal = course.tracks.filter((t) => t.kind === "session").length;
  const sessionsHeard = course.tracks.filter((t) => t.kind === "session" && listened.has(t.id)).length;
  const counts = listenedCounts(days, course.startedOn, course.week, today);
  return (
    <div className="cg-screen">
      <h1 className="cg-h1">Your progress</h1>
      <p className="cg-sub">Only you see this.</p>
      <div className="cg-card">
        <div className="cg-lines">
          <div className="cg-line"><span>Days you listened this week</span><b>{counts.thisWeek}</b></div>
          <div className="cg-line"><span>Days you listened in total</span><b>{counts.total}</b></div>
          <div className="cg-line"><span>Sessions heard</span><b>{sessionsHeard} of {sessionsTotal}</b></div>
        </div>
      </div>
      <div className="cg-card">
        <h2 className="cg-h2">Bloating</h2>
        <BloatingChart />
      </div>
      <div className="cg-card">
        <h2 className="cg-h2">Symptom check</h2>
        {scores.length > 0 ? (
          <>
            {scores.map((s) => (
              <div key={s.week} className="cg-bar-row">
                <span className="cg-bar-label">{s.week === 0 ? "Start" : s.week === 4 ? "Halfway" : "End"}</span>
                <span className="cg-bar-track"><span className="cg-bar-fill" style={{ width: `${(s.total / 50) * 100}%` }} /></span>
                <b className="cg-bar-val">{s.total}</b>
              </div>
            ))}
            <p className="cg-m" style={{ margin: 0 }}>Out of 50. A shorter bar means your gut is bothering you less.</p>
          </>
        ) : (
          <p className="cg-m" style={{ margin: 0 }}>Your scores show here once you&apos;ve done the first check.</p>
        )}
        {scoreDue !== null ? (
          <button className="cg-btn" onClick={openScore}>Take the check now</button>
        ) : (
          <p className="cg-m" style={{ margin: 0 }}>The check comes round at the start, halfway (week 4) and at the end (week 8).</p>
        )}
      </div>
    </div>
  );
}

// ── Help (reminders, safety, support) ───────────────────────────────────────

export function CourseHelpScreen({ openRefund }: { openRefund?: () => void }) {
  const { course, token, reminders, setReminders } = useCourse();
  const push = usePush(token, "course");
  const [time, setTime] = useState(reminders.daily_time ?? "20:00");
  const [saved, setSaved] = useState("");
  return (
    <div className="cg-screen">
      <h1 className="cg-h1">Help and reminders</h1>
      <p className="cg-sub">{course.title}</p>

      <div className="cg-card">
        <h2 className="cg-h2">Reminders</h2>
        {push.state === "unsupported" ? (
          <p className="cg-p">Reminders need the app on your home screen. On iPhone: Share, then Add to Home Screen, then open it from there.</p>
        ) : push.state === "blocked" ? (
          <p className="cg-p">Notifications are blocked for this app in your phone&apos;s settings. Allow them there, then come back.</p>
        ) : push.state !== "on" ? (
          <>
            <p className="cg-p">One reminder a day at a time you choose, and a note when a new session opens. Nothing else.</p>
            <button className="cg-btn" disabled={push.busy || push.state === "checking"} onClick={() => void push.enable()}>
              Turn on reminders
            </button>
          </>
        ) : (
          <>
            <label className="cg-field">
              <span>Daily reminder at</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <div className="cg-btns">
              <button
                className="cg-btn"
                onClick={async () => {
                  const ok = await setReminders(time, reminders.unlock);
                  setSaved(ok ? `Saved. Every day at ${time}.` : "That didn't save. Try again.");
                }}
              >
                Save time
              </button>
              {reminders.daily_time && (
                <button
                  className="cg-btn ghost"
                  onClick={async () => {
                    const ok = await setReminders(null, reminders.unlock);
                    setSaved(ok ? "Daily reminder off." : "That didn't save. Try again.");
                  }}
                >
                  No daily reminder
                </button>
              )}
            </div>
            <label className="cg-check">
              <input type="checkbox" checked={reminders.unlock} onChange={(e) => void setReminders(reminders.daily_time, e.target.checked)} />
              <span>Tell me when a new session opens</span>
            </label>
            <button className="cg-link-btn" onClick={() => void push.disable()}>
              Turn all reminders off
            </button>
          </>
        )}
        {(push.note || saved) && <p className="cg-m" style={{ margin: 0 }}>{saved || push.note}</p>}
      </div>

      <div className="cg-card">
        <h2 className="cg-h2">Listening safely</h2>
        <p className="cg-p">{course.safety}</p>
      </div>

      <div className="cg-card">
        <h2 className="cg-h2">Questions</h2>
        <p className="cg-p">For any problem, just reply to your welcome email.</p>
        {course.refund?.pendingSince ? (
          <p className="cg-m" style={{ margin: 0 }}>
            You asked for a refund on {new Date(course.refund.pendingSince).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. It will be done
            within 2 working days.
          </p>
        ) : course.refund?.eligible && openRefund ? (
          <button className="cg-link-btn quiet" onClick={openRefund}>
            Request a refund
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Player overlay ───────────────────────────────────────────────────────────

function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { v: T; l: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="cg-seg-row">
      <span className="cg-seg-label">{label}</span>
      <div className="cg-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} role="radio" aria-checked={value === o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReadingText({ title, text }: { title?: string; text: string }) {
  return (
    <div className="cg-card">
      {title && <h2 className="cg-h2">{title}</h2>}
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i} className="cg-p">
          {para}
        </p>
      ))}
    </div>
  );
}

export function CoursePlayerOverlay({
  trackId,
  onClose,
  onOpenTrack,
}: {
  trackId: string;
  onClose: () => void;
  /** Open another track's player (the session's intro). */
  onOpenTrack?: (id: string) => void;
}) {
  const { course, token } = useCourse();
  const t = course.tracks.find((x) => x.id === trackId) ?? null;
  const p = usePlayer();
  const [preferred, setVersion] = useState<CourseVersion>(() => preferredVersion());
  const [rate, setRateState] = useState<number>(() => preferredRate());
  // The intros exist in one version only.
  const version: CourseVersion = t?.voiceOnly ? "voice" : preferred;
  const [offline, setOffline] = useState<"no" | "yes" | "saving">("no");
  const [progress, setProgress] = useState(0);
  const [offlineErr, setOfflineErr] = useState("");
  const [showReading, setShowReading] = useState(false);
  // The safety text shows in full the first time each track is opened on this
  // phone, then folds to one line (persona review, 22 Nov: Play comes first).
  const safetyKey = `ochre.course.safety.${course.slug}.${trackId}`;
  const [safetyOpen, setSafetyOpen] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(safetyKey);
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(safetyKey, new Date().toISOString());
    } catch {
      /* private mode: it simply shows in full each time */
    }
  }, [safetyKey]);
  const pt = t ? toPlayerTrack(course, t) : null;
  const isThis = !!pt && p.track?.id === pt.id;
  // This session's intro is playing ahead of it.
  const introPlaying = !!pt && p.introFor?.id === pt.id;
  const live = isThis || introPlaying;
  const introTrack = t?.introId ? (course.tracks.find((x) => x.id === t.introId) ?? null) : null;

  useEffect(() => {
    if (!pt) return;
    let alive = true;
    void isSavedOffline(pt, version).then((s) => alive && setOffline(s ? "yes" : "no"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, version]);

  if (!t || !pt) return null;
  if (!t.unlocked) {
    return (
      <div className="overlay-scroll cg-overlay">
        <button className="cg-back" onClick={onClose}>‹ Back</button>
        <div className="cg-screen">
          <h1 className="cg-h1">{t.title}</h1>
          <p className="cg-sub">{t.unlocksLabel}</p>
        </div>
      </div>
    );
  }

  const resumeAt = live ? p.current : savedPosition(pt, version);
  // While an intro is loading its length isn't known yet: show the intro's, not the session's.
  const duration = live && p.duration ? p.duration : (introPlaying && introTrack ? introTrack.minutes.voice : t.minutes[version]) * 60;
  const start = () => {
    if (introPlaying || (isThis && p.version === version)) {
      void play();
      return;
    }
    // First play of a week's session on this phone: the intro first.
    if (introTrack && !t.listened && !introSeen(pt) && savedPosition(pt, version) === 0) {
      void playWithIntro(toPlayerTrack(course, introTrack), pt, version);
      return;
    }
    void load(pt, version, { autoplay: true });
  };
  const switchVersion = (v: CourseVersion) => {
    setVersion(v);
    setPreferredVersion(v);
    if (introPlaying) setPendingVersion(v);
    else if (isThis) void load(pt, v, { autoplay: p.playing });
  };
  const changeRate = (r: number) => {
    setRateState(r);
    setRate(r);
  };
  const fetchLink = async () => {
    const res = await fetch("/api/app-course", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "audio", course: course.slug, track: t.id, version }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
    if (!j.ok || !j.url) throw new Error(j.error || "Audio is not available right now.");
    return j.url;
  };
  const context =
    t.kind === "session" ? `Week ${t.week} session` : t.kind === "intro" ? `Week ${t.week} reading` : t.kind === "flare" ? "For a bad moment" : "Any time";
  const minutes = t.minutes[version];

  return (
    <div className="overlay-scroll cg-overlay cg-player">
      <button
        className="cg-back"
        onClick={() => {
          // Closing leaves a playing session playing (eyes closed, phone down);
          // the Now Playing bar brings it back. A paused one is put away.
          if (live && !p.playing) stop();
          onClose();
        }}
      >
        ‹ Back
      </button>
      <div className="cg-screen">
        <p className="cg-date">{context}</p>
        <h1 className="cg-h1">{t.title}</h1>
        <p className="cg-sub">
          {t.kind === "intro" ? `${t.readingTitle}, read aloud. ${minutes} minutes.` : `${capitalise(t.subtitle.replace(/^Session \d+ · /, ""))}. ${minutes} minutes.`}
        </p>

        <div className="cg-transport">
          <input
            type="range"
            className="cg-scrub"
            min={0}
            max={Math.max(1, Math.floor(duration))}
            value={Math.floor(live ? p.current : resumeAt)}
            onChange={(e) => live && seek(Number(e.target.value))}
            disabled={!live}
            aria-label="Position"
          />
          <div className="cg-times">
            <span>{fmtTime(live ? p.current : resumeAt)}</span>
            <span>{fmtTime(duration)}</span>
          </div>
          <div className="cg-buttons">
            <button className="cg-skip" onClick={() => skip(-15)} disabled={!live} aria-label="Back 15 seconds">
              Back 15 s
            </button>
            <button className="cg-play" onClick={() => (live && p.playing ? pause() : start())} aria-label={live && p.playing ? "Pause" : "Play"}>
              {live && p.loading ? <span className="spinner" /> : live && p.playing ? <PauseGlyph size={28} /> : <PlayGlyph size={28} />}
            </button>
            <button className="cg-skip" onClick={() => skip(15)} disabled={!live} aria-label="Forward 15 seconds">
              Forward 15 s
            </button>
          </div>
          {!live && resumeAt > 30 && <p className="cg-m cg-center">Picks up at {fmtTime(Math.max(0, resumeAt - 5))}</p>}
          {live && p.error && <p className="cg-error">{p.error}</p>}
          {isThis && p.counted && <p className="cg-m cg-center">Counted as listened today</p>}
        </div>

        {introPlaying && introTrack && (
          <div className="cg-card cg-intro-now" role="status">
            <p className="cg-p">
              <b>The week {t.week} intro is playing first:</b> {introTrack.readingTitle}. The session follows straight after.
            </p>
            <button className="cg-btn ghost" onClick={() => void skipIntro()}>
              Skip intro
            </button>
          </div>
        )}

        <div className="cg-card">
          {!t.voiceOnly && (
            <Seg
              label="Sound"
              value={version}
              options={[
                { v: "music" as CourseVersion, l: "With music" },
                { v: "voice" as CourseVersion, l: "Voice only" },
              ]}
              onChange={switchVersion}
            />
          )}
          {!t.voiceOnly && version === "music" && <p className="cg-m cg-hint">Prefer only the voice? Switch to Voice only.</p>}
          <Seg label="Speed" value={rate} options={PLAYBACK_RATES.map((r) => ({ v: r as number, l: `${r}×` }))} onChange={changeRate} />
          {offlineSupported() && (
            <div className="cg-seg-row">
              <span className="cg-seg-label">On this phone</span>
              {offline === "yes" ? (
                <span className="cg-m">
                  Saved.{" "}
                  <button
                    className="cg-link-btn"
                    onClick={async () => {
                      await removeOffline(pt, version);
                      setOffline("no");
                    }}
                  >
                    Remove
                  </button>
                </span>
              ) : offline === "saving" ? (
                <span className="cg-m">Saving… {Math.round(progress * 100)}%</span>
              ) : (
                <button
                  className="cg-btn ghost small"
                  onClick={async () => {
                    setOfflineErr("");
                    setOffline("saving");
                    try {
                      await saveOffline(pt, version, fetchLink, setProgress);
                      setOffline("yes");
                    } catch (e) {
                      setOffline("no");
                      setOfflineErr(e instanceof Error ? e.message : "Couldn't save.");
                    }
                  }}
                >
                  Save for offline
                </button>
              )}
            </div>
          )}
          {offlineSupported() && offline !== "yes" && <p className="cg-m cg-hint">Plays without internet, e.g. on a flight.</p>}
          {offlineErr && <p className="cg-error">{offlineErr}</p>}
        </div>

        {safetyOpen ? (
          <div className="cg-card cg-safety" role="note">
            <h2 className="cg-h2">Before you listen</h2>
            <p className="cg-p">{course.safety}</p>
            {t.safetyExtra && (
              <p className="cg-p">
                <b>{t.safetyExtra}</b>
              </p>
            )}
          </div>
        ) : (
          <button className="cg-safety-line" onClick={() => setSafetyOpen(true)} aria-expanded={false}>
            Safety: read before listening ▸
          </button>
        )}

        {t.kind === "intro" && t.reading && <ReadingText title={t.readingTitle} text={t.reading} />}
        {t.kind !== "intro" && introTrack && t.reading && (
          <div className="cg-card">
            <h2 className="cg-h2">This week&apos;s reading</h2>
            <p className="cg-p">{t.readingTitle}</p>
            <div className="cg-btns">
              {onOpenTrack && !introPlaying && (
                <button className="cg-btn ghost" onClick={() => onOpenTrack(introTrack.id)}>
                  Play this week&apos;s intro, 2 min
                </button>
              )}
              <button className="cg-btn ghost" onClick={() => setShowReading((v) => !v)}>
                {showReading ? "Hide the text" : "Read it"}
              </button>
            </div>
            {showReading &&
              t.reading.split(/\n\n+/).map((para, i) => (
                <p key={i} className="cg-p">
                  {para}
                </p>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Daily log ────────────────────────────────────────────────────────────────

/** A 0–10 picker with its two ends named, so nobody has to guess which way is good. */
function Scale({
  value,
  onChange,
  label,
  low,
  high,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  label: string;
  low: string;
  high: string;
}) {
  return (
    <div>
      <div className="cg-scale" role="radiogroup" aria-label={`${label}, 0 ${low}, 10 ${high}`}>
        {Array.from({ length: 11 }, (_, i) => (
          <button key={i} role="radio" aria-checked={value === i} className={value === i ? "on" : ""} onClick={() => onChange(i)}>
            {i}
          </button>
        ))}
      </div>
      <div className="cg-scale-ends" aria-hidden>
        <span>0 {low}</span>
        <span>10 {high}</span>
      </div>
    </div>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | undefined;
  options: { v: T; l: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="cg-choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

/** A half-filled log survives the app being closed (a baby wakes up) and
 *  comes back the next time the log opens that day. */
function draftKey(slug: string, day: string) {
  return `ochre.course.logdraft.${slug}.${day}`;
}
function readDraft(slug: string, day: string): { log: CourseDayLog; listenTouched: boolean } | null {
  try {
    const raw = localStorage.getItem(draftKey(slug, day));
    return raw ? (JSON.parse(raw) as { log: CourseDayLog; listenTouched: boolean }) : null;
  } catch {
    return null;
  }
}

export function CourseLogOverlay({ onClose }: { onClose: () => void }) {
  const { course, days, today, saveLog } = useCourse();
  const [draft] = useState(() => readDraft(course.slug, today));
  const [log, setLog] = useState<CourseDayLog>(() => ({ ...(days[today] ?? {}), ...(draft?.log ?? {}) }));
  // "I listened today" is ticked by the player too; send it only when the
  // listener changed it here, so a tick landing while this form is open
  // is not overwritten by the form's older copy.
  const [listenTouched, setListenTouched] = useState(draft?.listenTouched ?? false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    try {
      localStorage.setItem(draftKey(course.slug, today), JSON.stringify({ log, listenTouched }));
    } catch {
      /* private mode: no draft, the form still works */
    }
  }, [dirty, log, listenTouched, course.slug, today]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch: CourseDayLog) => {
    setDirty(true);
    setLog((l) => ({ ...l, ...patch }));
  };
  return (
    <div className="overlay-scroll cg-overlay">
      <button className="cg-back" onClick={onClose}>‹ Back</button>
      <div className="cg-screen">
        <p className="cg-date">{longDate()}</p>
        <h1 className="cg-h1">How was your gut today?</h1>
        <p className="cg-sub">
          {draft ? "Carrying on where you left off. " : "About 30 seconds. "}Skip anything you&apos;re not sure of.
        </p>

        <div className="cg-card">
          <p className="cg-q">Bloating</p>
          <Scale label="Bloating" low="none" high="worst" value={log.bloating} onChange={(v) => set({ bloating: v })} />

          <p className="cg-q">Comfort after meals</p>
          <Choice
            label="Comfort after meals"
            value={log.meals}
            onChange={(v) => set({ meals: v })}
            options={[
              { v: "poor", l: "Poor" },
              { v: "okay", l: "Okay" },
              { v: "good", l: "Good" },
            ]}
          />

          <p className="cg-q">Bowel movement</p>
          <Choice
            label="Bowel movement"
            value={log.bowel}
            onChange={(v) => set({ bowel: v })}
            options={[
              { v: "none", l: "None" },
              { v: "easy", l: "Easy" },
              { v: "hard", l: "Hard" },
              { v: "loose", l: "Loose" },
            ]}
          />

          <p className="cg-q">Stress</p>
          <Scale label="Stress" low="calm" high="very stressed" value={log.stress} onChange={(v) => set({ stress: v })} />

          <p className="cg-q">Sleep last night</p>
          <Choice
            label="Sleep"
            value={log.sleep}
            onChange={(v) => set({ sleep: v })}
            options={[
              { v: "poor", l: "Poor" },
              { v: "okay", l: "Okay" },
              { v: "good", l: "Good" },
            ]}
          />

          <label className="cg-check">
            <input
              type="checkbox"
              checked={!!log.listened}
              onChange={(e) => {
                setListenTouched(true);
                set({ listened: e.target.checked });
              }}
            />
            <span>
              I listened today <span className="cg-m">ticks itself when you play most of a track</span>
            </span>
          </label>

          <p className="cg-q">My triggers <span className="cg-m">optional</span></p>
          <textarea
            className="cg-note"
            rows={3}
            maxLength={600}
            placeholder="A meal, a stressful moment, anything you noticed"
            value={log.note ?? ""}
            onChange={(e) => set({ note: e.target.value })}
          />
        </div>

        <button
          className="cg-btn wide"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            const { listened, ...rest } = log;
            const ok = await saveLog(today, listenTouched ? { ...rest, listened: !!listened } : rest);
            setBusy(false);
            if (ok) {
              try {
                localStorage.removeItem(draftKey(course.slug, today));
              } catch {
                /* nothing to clear */
              }
              onClose();
            }
            else setErr("Saved on this phone, but it didn't reach the server. It will try again next time you save.");
          }}
        >
          {busy ? "Saving…" : "Save today"}
        </button>
        {err && <p className="cg-error">{err}</p>}
      </div>
    </div>
  );
}

// ── Symptom check ────────────────────────────────────────────────────────────

export function CourseScoreOverlay({ onClose }: { onClose: () => void }) {
  const { saveScore, scoreDue } = useCourse();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const complete = COURSE_SCORE_QUESTIONS.every((q) => answers[q.id] !== undefined);

  if (result !== null) {
    return (
      <div className="overlay-scroll cg-overlay">
        <div className="cg-screen cg-center" style={{ paddingTop: 72 }}>
          <p className="cg-result">{result}</p>
          <p className="cg-sub">out of 50</p>
          <h1 className="cg-h1" style={{ fontSize: 24 }}>Saved</h1>
          <p className="cg-p">The same five questions come round again, so you can see what changes. Lower is better.</p>
          <button className="cg-btn wide" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-scroll cg-overlay">
      <button className="cg-back" onClick={onClose}>‹ Back</button>
      <div className="cg-screen">
        <p className="cg-date">{scoreDue === 4 ? "Halfway check" : scoreDue === 8 ? "End-of-course check" : "Symptom check"}</p>
        <h1 className="cg-h1">Over the past 7 days</h1>
        <p className="cg-sub">Same five questions each time, so you can see what changes.</p>
        <div className="cg-card">
          {COURSE_SCORE_QUESTIONS.map((q) => (
            <div key={q.id}>
              <p className="cg-q">{q.label}</p>
              <Scale label={q.label} low="not at all" high="worst" value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            </div>
          ))}
        </div>
        <button
          className="cg-btn wide"
          disabled={!complete || busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            const r = await saveScore(answers);
            setBusy(false);
            if (r.ok && r.total !== undefined) setResult(r.total);
            else setErr("That didn't save. Check your connection and try again.");
          }}
        >
          {busy ? "Saving…" : complete ? "Save my score" : "Answer all five to save"}
        </button>
        {err && <p className="cg-error">{err}</p>}
      </div>
    </div>
  );
}

// ── Account (course-only) ────────────────────────────────────────────────────

/** The package account overlay talks about body measures, labs, plan
 *  reminders and "your logs reach Shivani", none of which is true for a
 *  course buyer. This one is only what is. */
export function CourseAccountOverlay({
  name,
  contact,
  textLarge,
  onTextLarge,
  onClose,
  goHelp,
}: {
  name: string;
  contact: string;
  textLarge: boolean;
  onTextLarge: (v: boolean) => void;
  onClose: () => void;
  goHelp: () => void;
}) {
  const { course } = useCourse();
  return (
    <div className="overlay-scroll cg-overlay">
      <button className="cg-back" onClick={onClose}>‹ Back</button>
      <div className="cg-screen">
        <h1 className="cg-h1">{name}</h1>
        <p className="cg-sub">
          {contact}. {course.title}, started {course.startLabel}.
        </p>
        <div className="cg-card">
          <div className="cg-lines">
            <label className="cg-line" style={{ cursor: "pointer" }}>
              <span>Larger text</span>
              <input type="checkbox" checked={textLarge} onChange={(e) => onTextLarge(e.target.checked)} />
            </label>
            <button className="cg-line cg-line-btn" onClick={goHelp}>
              <span>Reminders</span>
              <span className="cg-go" aria-hidden>›</span>
            </button>
          </div>
        </div>
        <p className="cg-m">Your log and scores are saved to your own record, so a new phone keeps your history. Nobody else reads them.</p>
      </div>
    </div>
  );
}

// ── Refund (paid buyers, first 7 days) ──────────────────────────────────────

export function CourseRefundOverlay({ onClose }: { onClose: () => void }) {
  const { course, token } = useCourse();
  const [state, setState] = useState<"ask" | "busy" | "refunded" | "pending">("ask");
  const [err, setErr] = useState("");
  const amount = course.refund?.amountLabel ?? "";
  const reload = () => window.location.reload();

  if (state === "refunded" || state === "pending") {
    return (
      <div className="overlay-scroll cg-overlay">
        <div className="cg-screen" style={{ paddingTop: 72 }}>
          <h1 className="cg-h1">{state === "refunded" ? "Refund requested" : "We've received your request"}</h1>
          <p className="cg-p">
            {state === "refunded"
              ? "You'll get an email shortly."
              : "It will be done within 2 working days. Your course stays open until then."}
          </p>
          <button className="cg-btn" onClick={reload}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-scroll cg-overlay">
      <button className="cg-back" onClick={onClose}>‹ Back</button>
      <div className="cg-screen">
        <h1 className="cg-h1">Request a refund</h1>
        <p className="cg-p">
          Your course will end now, and {amount} will return to your original payment method in 5–7 working days.
        </p>
        <div className="cg-btns">
          <button
            className="cg-btn"
            disabled={state === "busy"}
            onClick={async () => {
              setState("busy");
              setErr("");
              const { ok, j } = await post(token, "refund", { course: course.slug });
              if (ok && (j.status === "refunded" || j.status === "pending")) setState(j.status);
              else {
                setState("ask");
                setErr("That didn't go through. Try again, or reply to your welcome email.");
              }
            }}
          >
            {state === "busy" ? "Requesting…" : "Refund"}
          </button>
          <button className="cg-btn ghost" disabled={state === "busy"} onClick={onClose}>
            Keep my course
          </button>
        </div>
        {err && <p className="cg-error">{err}</p>}
      </div>
    </div>
  );
}
