"use client";

/**
 * Calm Gut — the course section of the client app.
 *
 * For a course-only buyer this IS the app: Today (flare-up tile, this week's
 * session, the daily and night practice, the 30-second log), Sessions (all
 * eight, one opening a week), Progress (bloating + the 5-question score, the
 * listening streak) and Help (reminders, safety, support). Written to sit
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
import { Icon } from "./ochre-context";
import { Section } from "./ochre-ui";
import {
  configurePlayer,
  fmtTime,
  getPlayerState,
  load,
  pause,
  play,
  preferredVersion,
  savedPosition,
  seek,
  setPreferredVersion,
  skip,
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
  return { courseSlug: course.slug, id: t.id, title: t.title, subtitle: t.subtitle, rev: t.rev };
}

// ── small pieces ─────────────────────────────────────────────────────────────

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

function TrackRow({ t, onOpen, highlight }: { t: AppCourseTrack; onOpen: (id: string) => void; highlight?: boolean }) {
  const { listened } = useCourse();
  const mins = t.minutes.music;
  return (
    <button
      className={"cg-track" + (t.unlocked ? "" : " locked") + (highlight ? " current" : "")}
      onClick={() => t.unlocked && onOpen(t.id)}
      disabled={!t.unlocked}
      aria-label={t.unlocked ? `Play ${t.title}` : `${t.title}, ${t.unlocksLabel ?? "not open yet"}`}
    >
      <span className="cg-track-ico" aria-hidden>
        {t.unlocked ? t.kind === "practice" && t.id === "night" ? <Icon name="moon" size={18} /> : <PlayGlyph /> : <Icon name="clock" size={17} />}
      </span>
      <span className="cg-track-body">
        <span className="cg-track-title">{t.title}</span>
        <span className="cg-track-sub">
          {t.unlocked ? `${t.subtitle} · ${mins} min` : t.unlocksLabel}
        </span>
      </span>
      {listened.has(t.id) && (
        <span className="cg-done" aria-label="Listened">
          <Icon name="check" size={15} />
        </span>
      )}
    </button>
  );
}

/** "Now playing" pill: shows while a track is loaded and the player is closed. */
export function CourseNowPlaying({ onOpen }: { onOpen: (id: string) => void }) {
  const p = usePlayer();
  if (!p.track) return null;
  return (
    <div className="cg-now">
      <button className="cg-now-main" onClick={() => onOpen(p.track!.id)}>
        <span className="cg-now-title">{p.track.title}</span>
        <span className="cg-now-time">
          {fmtTime(p.current)} / {fmtTime(p.duration)}
        </span>
      </button>
      <button className="cg-now-btn" onClick={() => (p.playing ? pause() : void play())} aria-label={p.playing ? "Pause" : "Play"}>
        {p.playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
    </div>
  );
}

// ── Today ────────────────────────────────────────────────────────────────────

export function CourseTodayScreen({
  openPlayer,
  openLog,
  openScore,
  goTab,
}: {
  openPlayer: (id: string) => void;
  openLog: () => void;
  openScore: () => void;
  goTab: (t: string) => void;
}) {
  const { course, days, today, streak, scoreDue } = useCourse();
  const flare = course.tracks.find((t) => t.kind === "flare");
  const current = course.tracks.find((t) => t.id === course.currentSessionId);
  const practices = course.tracks.filter((t) => t.kind === "practice");
  const todayLog = days[today];
  const logged = !!todayLog && (todayLog.bloating !== undefined || todayLog.meals !== undefined || todayLog.stress !== undefined);
  const nextLocked = course.tracks.find((t) => t.kind === "session" && !t.unlocked);

  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">{course.ownerFirstName ? `${course.ownerFirstName}'s ${course.title}` : course.title}</div>
        <div className="date script">
          {course.finished ? "All eight sessions are open" : `Week ${course.week} of ${course.totalWeeks}`}
        </div>
      </div>

      {flare && (
        <button className="cg-flare" onClick={() => openPlayer(flare.id)}>
          <span className="cg-flare-ico" aria-hidden>
            <Icon name="heart" size={20} />
          </span>
          <span>
            <span className="cg-flare-title">Having a bad moment?</span>
            <span className="cg-flare-sub">Flare-up · 4 minutes, right now</span>
          </span>
          <span className="chev" aria-hidden>
            <Icon name="chev" size={18} />
          </span>
        </button>
      )}

      {scoreDue !== null && (
        <button className="cg-card cg-score-cta" onClick={openScore}>
          <span className="eyebrow">{scoreDue === 0 ? "Before you begin" : scoreDue === 4 ? "Halfway check" : "End-of-course check"}</span>
          <span className="cg-card-title">Your 2-minute symptom check</span>
          <span className="muted cg-card-sub">Five questions, the same each time, so you can see what changes.</span>
        </button>
      )}

      {current && (
        <Section title="This week's session">
          <button className="cg-hero" onClick={() => openPlayer(current.id)}>
            <span className="cg-hero-eyebrow">Week {current.week}</span>
            <span className="cg-hero-title">{current.title}</span>
            <span className="cg-hero-sub">
              {current.subtitle} · {current.minutes.music} min
            </span>
            <span className="cg-hero-play">
              <PlayGlyph size={16} /> Listen
            </span>
          </button>
          {current.reading && (
            <div className="card" style={{ padding: "14px 16px", marginTop: 10 }}>
              <div className="eyebrow">This week&apos;s reading</div>
              <div style={{ fontSize: 14, lineHeight: 1.65, marginTop: 6, whiteSpace: "pre-line" }}>{current.reading}</div>
            </div>
          )}
          {nextLocked && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              Next: {nextLocked.title} · {nextLocked.unlocksLabel?.replace(/^Opens /, "opens ")}
            </div>
          )}
        </Section>
      )}

      <Section title="Every day">
        {practices.map((t) => (
          <TrackRow key={t.id} t={t} onOpen={openPlayer} />
        ))}
      </Section>

      <Section title="Today's 30-second log" action={logged ? "Edit" : undefined} onAction={openLog}>
        <button className="cg-card" onClick={openLog}>
          {logged ? (
            <>
              <span className="cg-card-title">Logged for today</span>
              <span className="muted cg-card-sub">
                Bloating {todayLog?.bloating ?? "–"}/10 · stress {todayLog?.stress ?? "–"}/10
                {todayLog?.listened ? " · listened" : ""}
              </span>
            </>
          ) : (
            <>
              <span className="cg-card-title">How was your gut today?</span>
              <span className="muted cg-card-sub">Bloating, meals, bowel, stress and sleep. Patterns you can see.</span>
            </>
          )}
        </button>
      </Section>

      <button className="cg-streak" onClick={() => goTab("progress")}>
        <span className="cg-streak-n">{streak}</span>
        <span>
          {streak === 1 ? "day" : "days"} in a row with a listen
          <span className="muted" style={{ display: "block", fontSize: 12 }}>See your progress</span>
        </span>
      </button>
    </div>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function CourseSessionsScreen({ openPlayer }: { openPlayer: (id: string) => void }) {
  const { course } = useCourse();
  const sessions = course.tracks.filter((t) => t.kind === "session");
  const others = course.tracks.filter((t) => t.kind !== "session");
  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">Sessions</div>
        <div className="date script">One new session opens each week</div>
      </div>
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 2px 6px" }}>
        {`${course.tagline} Listen to this week's session most days, and the daily practice on the others.`}
      </p>
      <Section title="The eight weeks">
        {sessions.map((t) => (
          <TrackRow key={t.id} t={t} onOpen={openPlayer} highlight={t.id === course.currentSessionId} />
        ))}
      </Section>
      <Section title="Any time">
        {others.map((t) => (
          <TrackRow key={t.id} t={t} onOpen={openPlayer} />
        ))}
      </Section>
    </div>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────

/** Hand-drawn feel: a gently wobbled line through the points (deterministic). */
function wobblePath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + (i % 2 ? 1.2 : -1.2);
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

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
  const padL = 22;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const x = (w: number) => padL + ((w - 1) / Math.max(weeks - 1, 1)) * (W - padL - padR);
  const y = (v: number) => padT + (v / 10) * (H - padT - padB); // 0 at top = calm is up
  const pts = data.filter((d) => d.avg !== null).map((d) => ({ x: x(d.week), y: y(d.avg!), d }));
  if (!pts.length) {
    return (
      <div className="card-quiet soon">
        <Icon name="progress" size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <span>Log bloating for a few days and your weekly line appears here.</span>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: "12px 12px 6px" }}>
      <div className="muted" style={{ fontSize: 12, margin: "0 4px 4px" }}>
        Average bloating each week, 0 to 10. Less bloating sits higher on the chart.
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly average bloating">
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">
              {v}
            </text>
          </g>
        ))}
        <path d={wobblePath(pts)} fill="none" stroke="var(--forest)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p) => (
          <circle key={p.d.week} cx={p.x} cy={p.y} r="3.4" fill="var(--paper)" stroke="var(--forest)" strokeWidth="2" />
        ))}
        {data.map((d) => (
          <text key={d.week} x={x(d.week)} y={H - 7} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
            {d.week}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ScoreBars() {
  const { scores } = useCourse();
  if (!scores.length) return null;
  const max = 50;
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      {scores.map((s) => (
        <div key={s.week} className="cg-bar-row">
          <span className="cg-bar-label">{s.week === 0 ? "Start" : `Week ${s.week}`}</span>
          <span className="cg-bar-track">
            <span className="cg-bar-fill" style={{ width: `${(s.total / max) * 100}%` }} />
          </span>
          <span className="cg-bar-val">{s.total}</span>
        </div>
      ))}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Out of 50. Lower means your gut is bothering you less.
      </div>
    </div>
  );
}

export function CourseProgressScreen({ openScore }: { openScore: () => void }) {
  const { course, days, streak, listened, scoreDue } = useCourse();
  const sessionsHeard = course.tracks.filter((t) => t.kind === "session" && listened.has(t.id)).length;
  const daysListened = Object.values(days).filter((d) => d.listened).length;
  // The last 14 days as dots.
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const k = d.toLocaleDateString("en-CA");
    return { k, on: !!days[k]?.listened };
  });
  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">Your progress</div>
        <div className="date script">Yours alone: only you see this</div>
      </div>
      <div className="cg-stats">
        <div className="cg-stat">
          <span className="cg-stat-n">{streak}</span>
          <span className="cg-stat-l">day streak</span>
        </div>
        <div className="cg-stat">
          <span className="cg-stat-n">{daysListened}</span>
          <span className="cg-stat-l">days listened</span>
        </div>
        <div className="cg-stat">
          <span className="cg-stat-n">
            {sessionsHeard}/{course.tracks.filter((t) => t.kind === "session").length}
          </span>
          <span className="cg-stat-l">sessions heard</span>
        </div>
      </div>
      <div className="cg-dots" aria-label="Last 14 days of listening">
        {last14.map((d) => (
          <span key={d.k} className={"cg-dot" + (d.on ? " on" : "")} title={d.k} />
        ))}
      </div>
      <Section title="Bloating">
        <BloatingChart />
      </Section>
      <Section title="Symptom check" action={scoreDue !== null ? "Take it now" : undefined} onAction={openScore}>
        <ScoreBars />
        {scoreDue === null && (
          <div className="muted" style={{ fontSize: 12.5, margin: "8px 2px 0" }}>
            The check comes round at the start, halfway (week 4) and at the end (week 8).
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Help (reminders, safety, support) ───────────────────────────────────────

export function CourseHelpScreen() {
  const { course, token, reminders, setReminders } = useCourse();
  const push = usePush(token, "course");
  const [time, setTime] = useState(reminders.daily_time ?? "20:00");
  const [saved, setSaved] = useState("");
  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">Help and reminders</div>
        <div className="date script">{course.title}</div>
      </div>

      <Section title="Reminders">
        <div className="card" style={{ padding: "14px 16px" }}>
          {push.state === "unsupported" ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              Reminders need the app on your home screen. On iPhone: Share, then Add to Home Screen, then open it from there.
            </div>
          ) : push.state === "blocked" ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              Notifications are blocked for this app in your phone&apos;s settings. Allow them there, then come back.
            </div>
          ) : push.state !== "on" ? (
            <button className="cg-btn" disabled={push.busy || push.state === "checking"} onClick={() => void push.enable()}>
              <Icon name="bell" size={16} /> Turn on reminders
            </button>
          ) : (
            <>
              <label className="cg-field">
                <span>A daily reminder at</span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="cg-btn"
                  onClick={async () => {
                    const ok = await setReminders(time, reminders.unlock);
                    setSaved(ok ? `Saved: every day at ${time}.` : "Couldn't save. Try again.");
                  }}
                >
                  Save time
                </button>
                {reminders.daily_time && (
                  <button
                    className="cg-btn ghost"
                    onClick={async () => {
                      const ok = await setReminders(null, reminders.unlock);
                      setSaved(ok ? "Daily reminder off." : "Couldn't save. Try again.");
                    }}
                  >
                    No daily reminder
                  </button>
                )}
              </div>
              <label className="cg-check">
                <input
                  type="checkbox"
                  checked={reminders.unlock}
                  onChange={(e) => void setReminders(reminders.daily_time, e.target.checked)}
                />
                <span>Tell me when a new session opens</span>
              </label>
              <button className="link" style={{ marginTop: 8 }} onClick={() => void push.disable()}>
                Turn all reminders off
              </button>
            </>
          )}
          {(push.note || saved) && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              {saved || push.note}
            </div>
          )}
        </div>
      </Section>

      <Section title="Listening safely">
        <div className="card-quiet" style={{ fontSize: 13.2, lineHeight: 1.65 }}>
          {course.safety}
        </div>
      </Section>

      <Section title="Questions">
        <div className="card-quiet soon">
          <Icon name="message" size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span>
            Stuck with the app or the audio, or a payment question? Write to <strong>hello@theochretree.com</strong>.
            Replies within a working day.
          </span>
        </div>
      </Section>
    </div>
  );
}

// ── Player overlay ───────────────────────────────────────────────────────────

export function CoursePlayerOverlay({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const { course, token } = useCourse();
  const t = course.tracks.find((x) => x.id === trackId) ?? null;
  const p = usePlayer();
  const [version, setVersion] = useState<CourseVersion>(() => preferredVersion());
  const [offline, setOffline] = useState<"no" | "yes" | "saving">("no");
  const [progress, setProgress] = useState(0);
  const [offlineErr, setOfflineErr] = useState("");
  const pt = t ? toPlayerTrack(course, t) : null;
  const isThis = !!pt && p.track?.id === pt.id;

  useEffect(() => {
    if (!pt) return;
    let live = true;
    void isSavedOffline(pt, version).then((s) => live && setOffline(s ? "yes" : "no"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, version]);

  if (!t || !pt) return null;
  if (!t.unlocked) {
    return (
      <div className="overlay-scroll">
        <button className="back-link" onClick={onClose}>
          <Icon name="arrowLeft" size={16} /> Back
        </button>
        <div className="overlay-pad">
          <h2 className="h-serif">{t.title}</h2>
          <p className="muted">{t.unlocksLabel}</p>
        </div>
      </div>
    );
  }

  const resumeAt = isThis ? p.current : savedPosition(pt, version);
  const duration = isThis && p.duration ? p.duration : t.minutes[version] * 60;
  const start = () => {
    if (isThis && p.version === version) void play();
    else void load(pt, version, { autoplay: true });
  };
  const switchVersion = (v: CourseVersion) => {
    setVersion(v);
    setPreferredVersion(v);
    if (isThis) void load(pt, v, { autoplay: p.playing });
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

  return (
    <div className="overlay-scroll cg-player">
      <button
        className="back-link"
        onClick={() => {
          // Closing leaves a playing session playing (eyes closed, phone down);
          // the Now Playing pill brings it back. A paused one is put away.
          if (isThis && !p.playing) stop();
          onClose();
        }}
      >
        <Icon name="arrowLeft" size={16} /> Back
      </button>
      <div className="overlay-pad">
        <div className="eyebrow">{t.kind === "session" ? `Calm Gut · week ${t.week}` : "Calm Gut"}</div>
        <h2 className="h-serif" style={{ fontSize: 26, margin: "6px 0 2px", lineHeight: 1.2 }}>
          {t.title}
        </h2>
        <div className="muted" style={{ fontSize: 13.5 }}>
          {t.subtitle} · {t.minutes[version]} min
        </div>

        <div className="cg-safety" role="note">
          {course.safety}
          {t.safetyExtra && <strong style={{ display: "block", marginTop: 6 }}>{t.safetyExtra}</strong>}
        </div>

        <div className="cg-toggle" role="radiogroup" aria-label="Version">
          {(["music", "voice"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={version === v} className={version === v ? "on" : ""} onClick={() => switchVersion(v)}>
              {v === "music" ? "With music" : "Voice only"}
            </button>
          ))}
        </div>

        <div className="cg-transport">
          <input
            type="range"
            className="cg-scrub"
            min={0}
            max={Math.max(1, Math.floor(duration))}
            value={Math.floor(isThis ? p.current : resumeAt)}
            onChange={(e) => isThis && seek(Number(e.target.value))}
            disabled={!isThis}
            aria-label="Position"
          />
          <div className="cg-times">
            <span>{fmtTime(isThis ? p.current : resumeAt)}</span>
            <span>{fmtTime(duration)}</span>
          </div>
          <div className="cg-buttons">
            <button className="cg-skip" onClick={() => skip(-15)} disabled={!isThis} aria-label="Back 15 seconds">
              −15
            </button>
            <button
              className="cg-play"
              onClick={() => (isThis && p.playing ? pause() : start())}
              aria-label={isThis && p.playing ? "Pause" : "Play"}
            >
              {isThis && p.loading ? <span className="spinner" /> : isThis && p.playing ? <PauseGlyph size={30} /> : <PlayGlyph size={30} />}
            </button>
            <button className="cg-skip" onClick={() => skip(15)} disabled={!isThis} aria-label="Forward 15 seconds">
              +15
            </button>
          </div>
          {!isThis && resumeAt > 30 && <div className="muted cg-resume">Picks up at {fmtTime(Math.max(0, resumeAt - 5))}</div>}
          {isThis && p.error && <div className="cg-error">{p.error}</div>}
          {isThis && p.counted && <div className="muted cg-resume">Counted as listened today</div>}
        </div>

        {offlineSupported() && (
          <div className="cg-offline">
            {offline === "yes" ? (
              <>
                <span>
                  <Icon name="check" size={14} /> Saved on this phone
                </span>
                <button
                  className="link"
                  onClick={async () => {
                    await removeOffline(pt, version);
                    setOffline("no");
                  }}
                >
                  Remove
                </button>
              </>
            ) : offline === "saving" ? (
              <span>Saving… {Math.round(progress * 100)}%</span>
            ) : (
              <button
                className="cg-btn ghost"
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
            {offlineErr && <div className="cg-error">{offlineErr}</div>}
          </div>
        )}

        {t.reading && (
          <div className="card" style={{ padding: "14px 16px", marginTop: 16 }}>
            <div className="eyebrow">This week&apos;s reading</div>
            <div style={{ fontSize: 14, lineHeight: 1.65, marginTop: 6, whiteSpace: "pre-line" }}>{t.reading}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Daily log ────────────────────────────────────────────────────────────────

function Scale({ value, onChange, label }: { value: number | undefined; onChange: (v: number) => void; label: string }) {
  return (
    <div className="cg-scale" role="radiogroup" aria-label={label}>
      {Array.from({ length: 11 }, (_, i) => (
        <button key={i} role="radio" aria-checked={value === i} className={value === i ? "on" : ""} onClick={() => onChange(i)}>
          {i}
        </button>
      ))}
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

export function CourseLogOverlay({ onClose }: { onClose: () => void }) {
  const { days, today, saveLog } = useCourse();
  const [log, setLog] = useState<CourseDayLog>(() => ({ ...(days[today] ?? {}) }));
  // "I listened today" is ticked by the player too; send it only when the
  // listener changed it here, so a tick landing while this form is open
  // is not overwritten by the form's older copy.
  const [listenTouched, setListenTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch: CourseDayLog) => setLog((l) => ({ ...l, ...patch }));
  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose}>
        <Icon name="arrowLeft" size={16} /> Back
      </button>
      <div className="overlay-pad">
        <div className="eyebrow">Today · about 30 seconds</div>
        <h2 className="h-serif" style={{ fontSize: 24, margin: "6px 0 14px" }}>
          How was your gut today?
        </h2>

        <div className="cg-q">Bloating (0 = none, 10 = worst)</div>
        <Scale label="Bloating" value={log.bloating} onChange={(v) => set({ bloating: v })} />

        <div className="cg-q">Comfort after meals</div>
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

        <div className="cg-q">Bowel movement</div>
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

        <div className="cg-q">Stress (0 = calm, 10 = very stressed)</div>
        <Scale label="Stress" value={log.stress} onChange={(v) => set({ stress: v })} />

        <div className="cg-q">Sleep last night</div>
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

        <label className="cg-check" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={!!log.listened}
            onChange={(e) => {
              setListenTouched(true);
              set({ listened: e.target.checked });
            }}
          />
          <span>I listened today</span>
        </label>
        <div className="muted" style={{ fontSize: 11.5, margin: "2px 0 0 26px" }}>
          Ticks itself when you play most of a track.
        </div>

        <div className="cg-q">My triggers (optional)</div>
        <textarea
          className="cg-note"
          rows={3}
          maxLength={600}
          placeholder="A meal, a stressful moment, anything you noticed"
          value={log.note ?? ""}
          onChange={(e) => set({ note: e.target.value })}
        />

        <button
          className="cg-btn wide"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            const { listened, ...rest } = log;
            const ok = await saveLog(today, listenTouched ? { ...rest, listened: !!listened } : rest);
            setBusy(false);
            if (ok) onClose();
            else setErr("Saved on this phone, but it didn't reach the server. It will try again next time you save.");
          }}
        >
          {busy ? "Saving…" : "Save today"}
        </button>
        {err && <div className="cg-error">{err}</div>}
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
      <div className="overlay-scroll">
        <div className="overlay-pad" style={{ textAlign: "center", paddingTop: 60 }}>
          <div className="cg-result">{result}</div>
          <div className="muted">out of 50</div>
          <h2 className="h-serif" style={{ fontSize: 22, margin: "14px 0 6px" }}>
            Saved
          </h2>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
            The same five questions come round again, so you can see what changes. Lower is better.
          </p>
          <button className="cg-btn" style={{ marginTop: 18 }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose}>
        <Icon name="arrowLeft" size={16} /> Back
      </button>
      <div className="overlay-pad">
        <div className="eyebrow">{scoreDue === 0 || scoreDue === null ? "Symptom check" : `Week ${scoreDue} symptom check`}</div>
        <h2 className="h-serif" style={{ fontSize: 24, margin: "6px 0 4px" }}>
          Over the past 7 days
        </h2>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
          0 = not at all, 10 = as bad as it gets.
        </p>
        {COURSE_SCORE_QUESTIONS.map((q) => (
          <div key={q.id}>
            <div className="cg-q">{q.label}</div>
            <Scale label={q.label} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
          </div>
        ))}
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
          {busy ? "Saving…" : complete ? "Save my score" : "Answer all five"}
        </button>
        {err && <div className="cg-error">{err}</div>}
      </div>
    </div>
  );
}

// ── Account (course-only) ────────────────────────────────────────────────────

/** The package account overlay talks about body measures, labs, plan
 *  reminders and "your logs reach Shivani" — none of which is true for a
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
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose}>
        <Icon name="arrowLeft" size={16} /> Back
      </button>
      <div className="overlay-pad">
        <div className="acct-card">
          <div style={{ flex: 1 }}>
            <div className="acct-name">{name}</div>
            <div className="acct-sub">{contact}</div>
            <div className="acct-plan">
              {course.title} · started {course.startLabel}
            </div>
          </div>
        </div>
        <div className="set-group">
          <div className="card" style={{ overflow: "hidden" }}>
            <label className="set-row" style={{ cursor: "pointer" }}>
              <span className="sr-name" style={{ flex: 1 }}>
                Larger text
                <span className="sr-meta">Bigger type across the app</span>
              </span>
              <input type="checkbox" checked={textLarge} onChange={(e) => onTextLarge(e.target.checked)} />
            </label>
            <button
              className="set-row"
              onClick={goHelp}
              style={{ width: "100%", background: "none", border: "none", font: "inherit", textAlign: "left", cursor: "pointer" }}
            >
              <span className="sr-name" style={{ flex: 1 }}>
                Reminders
                <span className="sr-meta">A daily time, and when a new session opens</span>
              </span>
              <Icon name="chev" size={17} style={{ color: "var(--muted)" }} />
            </button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 14 }}>
          Your log and scores are saved to your own record, so a new phone keeps your history. Nobody else reads them.
        </div>
        <div className="muted" style={{ textAlign: "center", fontSize: 11.5, marginTop: 18, paddingBottom: 8 }}>
          The Ochre Tree · {course.title}
        </div>
      </div>
    </div>
  );
}
