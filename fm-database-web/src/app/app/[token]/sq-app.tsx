"use client";

/**
 * The NEW front of the client app — the Sequoya shell (look D of the
 * prototype in docs/client-app-redesign/).
 *
 * The frame: a top bar (ring mark, wordmark, "Week N"), a scrolling main
 * area, four bottom tabs and a full-screen sheet host. Built so far: Home
 * (sq-home.tsx), Your whole day, Your record, recipes, and the start card.
 * The ask box, the practice player and most of Everything arrive in later
 * build steps; until then those screens say plainly that they are not built.
 *
 * Who sees this is decided in exactly one place: ochre-app.tsx calls
 * `pickAppShell` (src/lib/fmdb/app-shell.ts) and renders this component
 * instead of today's app. This file never decides that for itself.
 *
 * Ticks are NOT kept here. ochre-app.tsx owns the on-device store
 * (`ochre.app.<clientId>`) and the day's ticks and lends them in as `state`,
 * so both fronts read and write the same data. Only two per-device settings
 * live here: "track every item" and whether the return card was put away.
 *
 * Copy rule: the app says "Coach", never the coach's first name.
 */

import { dayMacros } from "@/lib/fmdb/meal-macros";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { SequoyaFonts, SequoyaRingMark } from "@/components/sequoya/sequoya-brand";
import { bandForHour } from "./day-plan";
import { buildMoments, isTicked, rankFloorAt, type SqKind, type SqMoment, type SqTicks } from "./sq-day";
import { NO_ANSWER_CARD, type AskButton } from "@/lib/fmdb/ask-card";
import { askChips, looksLikeDishQuestion, notOnListCard, routeAsk, type AskContext } from "./sq-ask";
import { fetchModelCard, handoffText, SqAskView, type AskTurn } from "./sq-ask-ui";
import { SqCoach, useCoachThread } from "./sq-coach";
import { HOSTED_TITLES, hostedAvailable, SqHost } from "./sq-host";
import { SqDayGroceries, SqDayRecipeSheet, SqDayRow, SqDayView, SqPrepLine } from "./sq-dayrow";
import { upcomingDays } from "./sq-days";
import { SqResultsSheet } from "./sq-results";
import { DEFAULT_PREFS, findPractice, parsePrefs, practiceList, type PracticePrefs } from "./sq-practice-data";
import { SqGoodnight, SqPracticePlayer, type PracticeResult } from "./sq-practice";
import { SqPractices, SqScenesSheet } from "./sq-practices";
import { sqSound } from "./sq-sound";
import { SqHome } from "./sq-home";
import { SqDiarySheet, useSqDiary } from "./sq-diary";
import { recipeTitle, recordDayTitle, SqDaySheet, SqEatingOutSheet, SqRecipeSheet, SqRecordDaySheet, SqRecordSheet } from "./sq-sheets";
import { SqStartSheet } from "./sq-start";
import { orderRows, SqOrderSheet, SqSuppsSheet, SqTripSheet, SqVitalsSheet } from "./sq-everything";
import { SqRemindSheet } from "./sq-remind";
import { SqProgressSheet } from "./sq-progress";
import { SqCard, SqIcon, SqNavRow, SqSwitchRow, type SqIconName, type SqSheet, type SqShellState } from "./sq-ui";
import "./sq.css";

export type { SqShellState } from "./sq-ui";

export type SqTabId = "today" | "practices" | "coach" | "all";

export const SQ_TABS: { id: SqTabId; label: string; icon: SqIconName }[] = [
  { id: "today", label: "Today", icon: "home" },
  { id: "practices", label: "Practices", icon: "leaf" },
  { id: "coach", label: "Coach", icon: "chat" },
  { id: "all", label: "Everything", icon: "grid" },
];

/** The one plain line every unbuilt screen shows. */
const NOT_BUILT = "This screen is not built yet.";
/** Practice settings and saved places, on this phone only. */
const PRACTICE_KEY = "sq.practice";

/** Per-device settings. Device-level like today's larger-text setting: they
 *  describe how this phone's owner likes the app, not a client's data. */
const TRACK_KEY = "sq.track";
const RETURN_KEY = "sq.return.dismissed";

/** Radii of the small week ring's circles, outermost first. Exported for the
 *  test only.
 *
 *  The outermost ring sits where this week falls between the centre (r 3) and
 *  the rim (r 15), so the ring grows outwards across the programme. Inside
 *  it, one ring per week lived — on a 12-week programme, exactly the
 *  prototype. On a longer one (26 weeks) a ring per week would sit under half
 *  a pixel apart and smudge into a solid disc, so the rings are thinned to
 *  stay at least MIN_GAP apart; the exact week is always in the button's
 *  label, never left to counting rings. */
const MIN_GAP = 1;
export function weekRingRadii(week: number, total: number): number[] {
  const n = Math.max(1, Math.floor(total) || 1);
  const lived = Math.min(Math.max(0, Math.floor(week) || 0), n);
  if (lived === 0) return [];
  const outer = n > 1 ? 3 + (12 * (lived - 1)) / (n - 1) : 3;
  const count = Math.min(lived, Math.floor((outer - 3) / MIN_GAP) + 1);
  const gap = count > 1 ? (outer - 3) / (count - 1) : 0;
  return Array.from({ length: count }, (_, k) => Number((outer - k * gap).toFixed(1)));
}

/**
 * The small tree-ring beside "Week N": rings for the weeks lived, the current
 * week drawn heavier, inside a faint outer circle. Weeks still to come are
 * not drawn at this size.
 */
function WeekRings({ week, total }: { week: number; total: number }) {
  const rings = weekRingRadii(week, total).map((r, k) => (
    <circle key={r} cx={17} cy={17} r={r} fill="none" stroke="var(--sq-fire)" strokeWidth={k === 0 ? 2 : 1} />
  ));
  return (
    <svg viewBox="0 0 34 34" aria-hidden="true">
      <circle cx={17} cy={17} r={15.5} fill="none" stroke="var(--sq-line-strong)" strokeWidth={1} />
      {rings}
    </svg>
  );
}

/** The sky behind the top bar follows the client's own clock. */
type SkyTime = "morning" | "midday" | "evening";
function skyForHour(hour: number): SkyTime {
  const band = bandForHour(hour);
  if (band === "waking" || band === "morning") return "morning";
  if (band === "midday") return "midday";
  return "evening";
}

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode — the setting simply does not stick
  }
}
function writeFlag(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export default function SqApp({ data, state }: { data: ClientAppData; state: SqShellState }) {
  const [tab, setTab] = useState<SqTabId>("today");
  /** Open sheets, the top one last. Closing takes off one. */
  const [stack, setStack] = useState<SqSheet[]>([]);
  const sheet = stack[stack.length - 1] ?? null;

  // The phone's own clock. Null on the server and on first paint: reading it
  // during render would differ between the server (its timezone) and the
  // phone, and React would flag the mismatch. Refreshed when she comes back
  // to the app, so "next" follows the real time of day.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const onShow = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);
  const hour = now ? now.getHours() : null;
  // Hour AND minute: the windows of the day turn on the half hour.
  const nowRank = now ? rankFloorAt(now.getHours(), now.getMinutes()) : rankFloorAt(12);
  const todayYmd = now ? now.toLocaleDateString("en-CA") : "";

  // Per-device settings, read after mount for the same reason as the clock.
  const [track, setTrackState] = useState(false);
  const [returnDismissed, setReturnDismissed] = useState(false);
  useEffect(() => {
    setTrackState(readFlag(TRACK_KEY) === "on");
    setReturnDismissed(readFlag(RETURN_KEY) === new Date().toLocaleDateString("en-CA"));
  }, []);
  const setTrack = (on: boolean) => {
    setTrackState(on);
    writeFlag(TRACK_KEY, on ? "on" : null);
  };
  const dismissReturn = () => {
    setReturnDismissed(true);
    writeFlag(RETURN_KEY, new Date().toLocaleDateString("en-CA"));
  };

  // ── the day ────────────────────────────────────────────────────────────
  const moments = useMemo(
    () => buildMoments({ meals: data.meals, supplements: data.supplements, remedies: data.remedies, practices: data.practices }),
    [data.meals, data.supplements, data.remedies, data.practices],
  );
  const ticks: SqTicks = useMemo(
    () => ({ logged: state.logged, practicesDone: state.practicesDone, practiceAt: state.practiceAt }),
    [state.logged, state.practicesDone, state.practiceAt],
  );
  const toggle = (id: string, kind: SqKind) => (kind === "practice" ? state.togglePractice(id) : state.toggleTick(id));
  /** The moment ticked most recently with Done — what "Undo" takes back. */
  const [lastId, setLastId] = useState<string | null>(null);
  const done = (m: SqMoment) => {
    if (!isTicked(m.id, m.kind, ticks)) toggle(m.id, m.kind);
    setLastId(m.id);
  };
  // Undo reverses exactly one action: the tick Done made. Anything ticked
  // with it (a supplement tapped on the card) stays as she left it.
  const undo = (m: SqMoment) => {
    if (isTicked(m.id, m.kind, ticks)) toggle(m.id, m.kind);
    setLastId(null);
  };

  // ── tabs and sheets ────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLElement | null>(null);
  // The day row on Today: 0 is today, then the next days; THREE (-1) lists
  // the next three days together.
  const days = useMemo(() => upcomingDays(data.weekMenus ?? []), [data.weekMenus]);
  const [dayAt, setDayAt] = useState(0);
  const swipeX = useRef<number | null>(null);
  const go = (next: SqTabId) => {
    setTab(next);
    if (next === "today") setDayAt(0);
    // A tab tap leaves whatever was open on top: one tap, one place.
    setStack([]);
    // The Today tab always lands on Home; the question thread is one tap in.
    if (next === "today") setView("home");
    setHint("");
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  // A sheet covers the whole app, so it behaves as a dialog: Escape closes it
  // and, when the last one closes, focus returns to whatever opened the first.
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const open = (s: SqSheet) => {
    if (stack.length === 0) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setStack((prev) => [...prev, s]);
  };
  // The food diary's state lives here so Home and its sheet show the same
  // photos. A photo picked from Home opens the diary sheet to be saved.
  const diary = useSqDiary(data, () => {
    if (stack[stack.length - 1]?.k !== "diary") open({ k: "diary" });
  });
  const close = () => {
    if (stack.length <= 1) {
      openerRef.current?.focus();
      openerRef.current = null;
    }
    setStack((prev) => prev.slice(0, -1));
  };
  const depth = stack.length;
  useEffect(() => {
    if (depth === 0) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (depth === 1) {
        openerRef.current?.focus();
        openerRef.current = null;
      }
      setStack((prev) => prev.slice(0, -1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [depth]);

  const { week, totalWeeks } = data.client;

  // ── practices ────────────────────────────────────────────────────────────
  const practices = useMemo(
    () => practiceList({ eft: data.eft, sleep: data.sleep, breathwork: data.breathwork, somatic: data.somatic }),
    [data.eft, data.sleep, data.breathwork, data.somatic],
  );
  // Per-device settings and saved places, read after mount like the others.
  const [prefs, setPrefsState] = useState<PracticePrefs>(DEFAULT_PREFS);
  useEffect(() => {
    const t = setTimeout(() => setPrefsState(parsePrefs(readFlag(PRACTICE_KEY))), 0);
    return () => clearTimeout(t);
  }, []);
  const setPrefs = (next: PracticePrefs) => {
    setPrefsState(next);
    writeFlag(PRACTICE_KEY, JSON.stringify(next));
  };
  /** Open a practice. Called straight from a tap: a phone only lets sound
   *  start inside one, so the audio is woken here, before the screen draws. */
  const beginPractice = (id: string) => {
    if (!findPractice(practices, id)) return go("practices");
    sqSound().unlock();
    open({ k: "practice", id });
  };
  const finishPractice = (r: PracticeResult) => {
    const { practice } = r;
    // Finishing a practice ticks it for today, exactly as tapping its tick would.
    if (practice.practiceId && !state.practicesDone[practice.practiceId]) state.togglePractice(practice.practiceId);
    const { [practice.id]: _done, ...resume } = prefs.resume;
    void _done;
    setPrefs({ ...prefs, resume, last: { id: practice.id === "one" ? "breath" : practice.id, ymd: todayYmd } });
    // The coach's log of practices, as today's app writes it. Best effort.
    const kind = practice.kind === "tap" ? "eft" : practice.kind === "reset" ? "somatic" : practice.kind;
    void fetch("/api/app-practice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        token: data.token,
        kind,
        practice_id: practice.practiceId,
        name: practice.title,
        theme: r.theme ?? null,
        suds_before: r.sudsBefore ?? null,
        suds_after: r.sudsAfter ?? null,
        seconds: r.seconds,
        slug: practice.kind === "reset" ? practice.id.slice("reset:".length) : null,
      }),
    }).catch(() => {});
    // The wind-down ends on the goodnight screen; the rest simply close.
    setStack((prev) => [...prev.slice(0, -1), ...(practice.kind === "sleep" ? [{ k: "night" } as SqSheet] : [])]);
  };
  /** Bedtime supplements still open, for the goodnight screen's one tick. */
  const bedtimeOpen = moments.flatMap((m) =>
    m.band === "bedtime" && m.kind === "supp" && !isTicked(m.id, m.kind, ticks) ? [{ id: m.id, name: m.title }] : [],
  );

  // ── the ask box and the coach ──────────────────────────────────────────
  /** Today shows Home or the thread of questions. */
  const [view, setView] = useState<"home" | "ask">("home");
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [input, setInput] = useState("");
  const [hint, setHint] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const turnSeq = useRef(0);
  const coach = useCoachThread(data.token, tab === "coach");
  const askCtx: AskContext = { data, moments, ticks, nowRank, todayYmd };

  const toCoach = (draft?: string) => {
    go("coach");
    if (draft !== undefined) setInput(draft);
    // After the tab has drawn its own placeholder.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const ask = (q: string) => {
    if (!now) return; // the phone's clock is not known yet
    const r = routeAsk(q, askCtx);
    if (r.type === "empty") {
      setHint("Type a question, or tap one of the questions on Today.");
      return;
    }
    setHint("");
    if (r.type === "open") return r.sheet.k === "practice" ? beginPractice(r.sheet.id) : open(r.sheet);
    if (r.type === "tab") return r.tab === "coach" ? toCoach(r.draft) : go(r.tab);
    const id = ++turnSeq.current;
    setTab("today");
    setView("ask");
    if (r.type === "card") {
      setTurns((t) => [...t, { id, q, card: r.card, send: "idle" }]);
      return;
    }
    setTurns((t) => [...t, { id, q, card: null, send: "idle" }]);
    void fetchModelCard(data.token, q).then((got) => {
      // No answer to a food question: the guide's own line for a food the
      // plan does not mention, so she has something to act on now.
      const guide = data.planRef?.eatingOut;
      const card = got === NO_ANSWER_CARD && guide && looksLikeDishQuestion(q) ? notOnListCard(guide, q) : got;
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, card } : x)));
    });
  };

  const onCardButton = (b: AskButton) => {
    if (b.to === "day" || b.to === "record" || b.to === "start" || b.to === "eatout" || b.to === "remind" || b.to === "vitals") open({ k: b.to });
    else if (b.to === "recipe" && b.ref) open({ k: "recipe", slot: b.ref });
    else if (b.to === "soon" && b.ref === "results") open({ k: "results" });
    else if (b.to === "soon") open({ k: "soon", title: b.ref ?? b.label });
    else if (b.to === "practice" && b.ref) beginPractice(b.ref);
    else if (b.to === "practices") go("practices");
    else if (b.to === "coach") toCoach(b.draft);
  };

  /** Hand a question to the coach: it goes into the same thread as a message. */
  const sendToCoach = (turn: AskTurn) => {
    const mark = (send: AskTurn["send"]) => setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, send } : x)));
    mark("sending");
    void coach.send(handoffText(turn.q, week, totalWeeks), false).then((ok) => mark(ok ? "sent" : "failed"));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (tab === "coach") {
      if (!text) return setHint("Type a message first.");
      setHint("");
      setInput("");
      void coach.send(text);
      return;
    }
    if (text) setInput("");
    ask(text);
  };

  const active = SQ_TABS.find((t) => t.id === tab) ?? SQ_TABS[0];
  const ready = state.hydrated && now !== null;

  let sheetTitle = "";
  let sheetBody: React.ReactNode = null;
  if (sheet) {
    if (sheet.k === "day") {
      sheetTitle = "Your whole day";
      sheetBody = <SqDaySheet menu={dayMacros(data.meals)} target={data.dayTargets} moments={moments} ticks={ticks} track={track} onToggle={toggle} open={open} />;
    } else if (sheet.k === "record") {
      sheetTitle = "Your record";
      sheetBody = <SqRecordSheet data={data} moments={moments} ticks={ticks} todayYmd={todayYmd} open={open} />;
    } else if (sheet.k === "recday") {
      sheetTitle = recordDayTitle(sheet.date);
      sheetBody = <SqRecordDaySheet data={data} date={sheet.date} />;
    } else if (sheet.k === "dayrecipe") {
      const slot = days[sheet.d]?.slots[sheet.s];
      sheetTitle = slot?.recipe?.title ?? slot?.slot ?? "Recipe";
      sheetBody = <SqDayRecipeSheet slot={slot} />;
    } else if (sheet.k === "recipe") {
      sheetTitle = recipeTitle(data, sheet.slot);
      sheetBody = <SqRecipeSheet data={data} slot={sheet.slot} />;
    } else if (sheet.k === "eatout" && data.planRef?.eatingOut) {
      sheetTitle = sheet.where ?? "Eating out";
      sheetBody = <SqEatingOutSheet guide={data.planRef.eatingOut} where={sheet.where} open={open} />;
    } else if (sheet.k === "results") {
      sheetTitle = "Your results";
      sheetBody = <SqResultsSheet results={data.sq?.results ?? null} onAsk={() => toCoach("Could you walk me through my results?")} />;
    } else if (sheet.k === "progress") {
      sheetTitle = "Your progress";
      sheetBody = <SqProgressSheet data={data} open={open} />;
    } else if (sheet.k === "scenes") {
      sheetTitle = "Backgrounds";
      sheetBody = <SqScenesSheet prefs={prefs} setPrefs={setPrefs} />;
    } else if (sheet.k === "diary") {
      sheetTitle = "Food diary";
      sheetBody = <SqDiarySheet d={diary} data={data} />;
    } else if (sheet.k === "supps") {
      sheetTitle = "Your supplements";
      sheetBody = <SqSuppsSheet data={data} />;
    } else if (sheet.k === "order") {
      sheetTitle = "Order supplements";
      sheetBody = <SqOrderSheet data={data} todayYmd={todayYmd} onAsk={() => toCoach("Where do I get the supplements that have no shop link?")} />;
    } else if (sheet.k === "vitals") {
      sheetTitle = "Weight and blood pressure";
      sheetBody = <SqVitalsSheet data={data} todayYmd={todayYmd} />;
    } else if (sheet.k === "trip") {
      sheetTitle = "Your trip";
      sheetBody = (
        <SqTripSheet data={data} todayYmd={todayYmd} onEatOut={data.planRef?.eatingOut ? () => open({ k: "eatout" }) : undefined} />
      );
    } else if (sheet.k === "remind") {
      sheetTitle = "Reminders";
      sheetBody = <SqRemindSheet data={data} />;
    } else if (sheet.k === "start") {
      sheetTitle = "How this app works";
      sheetBody = <SqStartSheet />;
    } else {
      sheetTitle = sheet.k === "soon" ? sheet.title : "Eating out";
      sheetBody = (
        <SqCard>
          <p className="sq-sub">{NOT_BUILT}</p>
        </SqCard>
      );
    }
  }

  return (
    <div className={"sq-app" + (state.textLarge ? " sq-big" : "")} data-time={hour === null ? "midday" : skyForHour(hour)}>
      <SequoyaFonts />

      <header className="sq-bar">
        <span className="sq-mark">
          <SequoyaRingMark size={30} />
        </span>
        <span className="sq-word">Sequoya</span>
        <button type="button" className="sq-ringbtn" aria-label={`Your progress, week ${week} of ${totalWeeks}`} onClick={() => open({ k: "progress" })}>
          <span>Week {week}</span>
          <WeekRings week={week} total={totalWeeks} />
        </button>
      </header>

      {/* aria-busy until the phone's own ticks and clock are known: before
          that, what is "next" cannot be known either. */}
      <main className="sq-scroll" ref={scrollRef} aria-busy={!ready} inert={sheet ? true : undefined}>
        {tab === "today" && view === "ask" ? (
          <SqAskView turns={turns} onBack={() => setView("home")} onButton={onCardButton} onSend={sendToCoach} onAsk={ask} />
        ) : tab === "today" && dayAt !== 0 ? (
          <div
            onTouchStart={(e) => (swipeX.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              const x0 = swipeX.current;
              swipeX.current = null;
              if (x0 === null || dayAt < 0) return;
              const dx = e.changedTouches[0].clientX - x0;
              if (Math.abs(dx) > 60) setDayAt(Math.max(0, Math.min(days.length - 1, dayAt + (dx < 0 ? 1 : -1))));
            }}
          >
            <SqDayRow days={days} at={dayAt} pick={setDayAt} />
            <SqDayView days={days} at={dayAt} open={open} />
          </div>
        ) : tab === "today" ? (
          <div
            onTouchStart={(e) => (swipeX.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              const x0 = swipeX.current;
              swipeX.current = null;
              if (x0 !== null && x0 - e.changedTouches[0].clientX > 60 && days.length > 1) setDayAt(1);
            }}
          >
          <SqHome
            dayRow={
              <>
                <SqDayRow days={days} at={dayAt} pick={setDayAt} />
                <SqPrepLine next={days[1]} />
              </>
            }
            data={data}
            moments={moments}
            ticks={ticks}
            ready={ready}
            hour={hour}
            nowRank={nowRank}
            checkinSentWeek={state.checkinSentWeek}
            track={track}
            lastId={lastId}
            onDone={done}
            onUndo={undo}
            onToggle={toggle}
            open={open}
            returnDismissed={returnDismissed}
            onDismissReturn={dismissReturn}
            chips={ready ? askChips(askCtx) : []}
            onAsk={ask}
            diary={diary}
          />
          {days[0] && <SqDayGroceries day={days[0]} />}
          </div>
        ) : tab === "coach" ? (
          <SqCoach data={data} thread={coach} />
        ) : tab === "practices" ? (
          <SqPractices list={practices} prefs={prefs} todayYmd={todayYmd} next={data.mindBody} onBegin={beginPractice} open={open} />
        ) : (
          <>
            <div className="sq-greet">
              <h1>{active.label}</h1>
            </div>
            {tab === "all" ? (
              <>
                <SqCard title="Start here">
                  <div className="sq-list">
                    <SqNavRow title="How this app works" note="One minute, whenever you need it" onOpen={() => open({ k: "start" })} />
                    <SqSwitchRow
                      title="Larger text"
                      on={state.textLarge}
                      onNote="On · tap to go back to normal"
                      offNote="Off · tap to make everything bigger"
                      onChange={state.setTextLarge}
                    />
                  </div>
                </SqCard>
                {data.planRef?.eatingOut && (
                  <SqCard title="Your plan">
                    <div className="sq-list">
                      <SqNavRow title="Eating out" note="What to choose and what to skip, away from home" onOpen={() => open({ k: "eatout" })} />
                    </div>
                  </SqCard>
                )}
                {(() => {
                  const have = hostedAvailable(data);
                  const row = (id: "menu" | "grocery" | "checkin" | "labs" | "move", note: string) =>
                    have.has(id) ? <SqNavRow key={id} title={HOSTED_TITLES[id]} note={note} onOpen={() => open({ k: "hosted", id })} /> : null;
                  return (
                    <>
                      {(have.has("menu") || have.has("grocery")) && (
                        <SqCard title="Food">
                          <div className="sq-list">
                            {row("menu", "Every meal, day by day")}
                            {row("grocery", "What to buy, ticked off as you go")}
                          </div>
                        </SqCard>
                      )}
                      <SqCard title="Each week">
                        <div className="sq-list">
                          {row("checkin", state.checkinSentWeek >= data.client.week ? `Week ${data.client.week} sent` : "A minute, once a week, for your coach")}
                          <SqNavRow
                            title="Your results"
                            note={data.sq?.results ? "Body age and your numbers, shared by your coach" : "Your coach shares these with you first"}
                            onOpen={() => open({ k: "results" })}
                          />
                          {row("labs", "Book a test, and the reports you have")}
                          {row("move", "Your strength session")}
                        </div>
                      </SqCard>
                    </>
                  );
                })()}
                {(data.supplements.length > 0 || (data.upcomingSupplements ?? []).length > 0) && (
                  <SqCard title="Supplements">
                    <div className="sq-list">
                      <SqNavRow title="Your supplements" note="What each one is for and when" onOpen={() => open({ k: "supps" })} />
                      <SqNavRow title="Order supplements" note={`${orderRows(data).length} to order, each with its own shop page`} onOpen={() => open({ k: "order" })} />
                    </div>
                  </SqCard>
                )}
                <SqCard title="You">
                  <div className="sq-list">
                    <SqNavRow title="Log weight or blood pressure" note="Takes ten seconds" onOpen={() => open({ k: "vitals" })} />
                    <SqNavRow
                      title={data.travel ? "Your trip" : "Going away?"}
                      note={data.travel ? "Your coach has your dates" : "Tell your coach your dates"}
                      onOpen={() => open({ k: "trip" })}
                    />
                    <SqNavRow title="Your progress" note="How you feel, your readings and your tests, week by week" onOpen={() => open({ k: "progress" })} />
                    <SqNavRow title="Your record" note="Everything you have ticked, day by day" onOpen={() => open({ k: "record" })} />
                    <SqNavRow title="Reminders" note="Your phone reminds you at each supplement time" onOpen={() => open({ k: "remind" })} />
                    <SqNavRow title="Keep the app on your phone" note="Add it to your Home Screen, and what to do if you lose the link" onOpen={() => open({ k: "start" })} />
                    <SqSwitchRow
                      title="Track every item on Home"
                      on={track}
                      onNote="On · ticks and your daily count show on Home"
                      offNote="Off · Home stays simple"
                      onChange={setTrack}
                    />
                  </div>
                </SqCard>
              </>
            ) : (
              <SqCard>
                <p className="sq-sub">{NOT_BUILT}</p>
              </SqCard>
            )}
          </>
        )}
      </main>

      {/* One box, two jobs: a question about the plan on Today, a message to
          the coach on the Coach tab. The placeholder says which. */}
      {(tab === "today" || tab === "coach") && (
        <form className="sq-composer" onSubmit={submit} inert={sheet ? true : undefined} autoComplete="off">
          {hint && (
            <p className="sq-hint" role="status">
              {hint}
            </p>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (hint) setHint("");
            }}
            placeholder={tab === "coach" ? "Message your coach" : "Ask about your plan"}
            aria-label={tab === "coach" ? "Message your coach" : "Ask about your plan"}
            enterKeyHint="send"
            maxLength={tab === "coach" ? 4000 : 500}
          />
          <button className="sq-send" type="submit" aria-label="Send">
            <SqIcon name="up" />
          </button>
        </form>
      )}

      <nav className="sq-tabs" aria-label="Main" inert={sheet ? true : undefined}>
        {SQ_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="sq-tab"
            aria-current={t.id === tab ? "page" : undefined}
            onClick={() => go(t.id)}
          >
            <SqIcon name={t.icon} />
            {t.label}
            {t.id === "coach" && coach.unread && tab !== "coach" && <span className="sq-tabdot" role="img" aria-label="New message" />}
          </button>
        ))}
      </nav>

      {/* The diary's photo picker sits outside everything a sheet makes inert,
          so "Add a photo" works from Home and from the diary sheet alike. */}
      {diary.input}
      {sheet?.k === "practice" && findPractice(practices, sheet.id) && (
        <SqPracticePlayer
          key={sheet.id}
          data={data}
          practice={findPractice(practices, sheet.id)!}
          hour={hour ?? 12}
          prefs={prefs}
          setPrefs={setPrefs}
          onFinish={finishPractice}
          onClose={close}
        />
      )}
      {sheet?.k === "hosted" && (
        <SqHost
          id={sheet.id}
          data={data}
          checkinSent={state.checkinSentWeek >= data.client.week}
          onCheckinSent={() => state.markCheckinSent?.()}
          openHosted={(id) => setStack((prev) => [...prev.slice(0, -1), { k: "hosted", id }])}
          openResults={() => setStack((prev) => [...prev.slice(0, -1), { k: "results" }])}
          onClose={close}
        />
      )}
      {sheet?.k === "night" && <SqGoodnight pending={bedtimeOpen} onTick={(id) => state.toggleTick(id)} onClose={close} />}
      {sheet && sheet.k !== "practice" && sheet.k !== "night" && sheet.k !== "hosted" && (
        // key: each sheet is its own element, so opening one from another
        // starts at the top and plays its own entrance.
        <div key={depth} className="sq-sheet" role="dialog" aria-modal="true" aria-labelledby="sq-sheet-title">
          <div className="sq-sheet-h">
            <h2 id="sq-sheet-title">{sheetTitle}</h2>
            <button type="button" className="sq-x" aria-label={depth > 1 ? "Back" : "Close"} onClick={close} ref={closeRef}>
              <SqIcon name="x" />
            </button>
          </div>
          <div className="sq-sheet-b">{sheetBody}</div>
        </div>
      )}
    </div>
  );
}
