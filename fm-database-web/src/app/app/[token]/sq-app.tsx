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

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { SequoyaFonts, SequoyaRingMark } from "@/components/sequoya/sequoya-brand";
import { bandForHour } from "./day-plan";
import { buildMoments, isTicked, rankFloorAt, type SqKind, type SqMoment, type SqTicks } from "./sq-day";
import { SqHome } from "./sq-home";
import { recipeTitle, recordDayTitle, SqDaySheet, SqRecipeSheet, SqRecordDaySheet, SqRecordSheet } from "./sq-sheets";
import { SqStartSheet } from "./sq-start";
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
  const go = (next: SqTabId) => {
    setTab(next);
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
  const active = SQ_TABS.find((t) => t.id === tab) ?? SQ_TABS[0];
  const ready = state.hydrated && now !== null;

  let sheetTitle = "";
  let sheetBody: React.ReactNode = null;
  if (sheet) {
    if (sheet.k === "day") {
      sheetTitle = "Your whole day";
      sheetBody = <SqDaySheet moments={moments} ticks={ticks} track={track} onToggle={toggle} open={open} />;
    } else if (sheet.k === "record") {
      sheetTitle = "Your record";
      sheetBody = <SqRecordSheet data={data} moments={moments} ticks={ticks} todayYmd={todayYmd} open={open} />;
    } else if (sheet.k === "recday") {
      sheetTitle = recordDayTitle(sheet.date);
      sheetBody = <SqRecordDaySheet data={data} date={sheet.date} />;
    } else if (sheet.k === "recipe") {
      sheetTitle = recipeTitle(data, sheet.slot);
      sheetBody = <SqRecipeSheet data={data} slot={sheet.slot} />;
    } else if (sheet.k === "start") {
      sheetTitle = "How this app works";
      sheetBody = <SqStartSheet />;
    } else {
      sheetTitle = sheet.title;
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
        <button
          type="button"
          className="sq-ringbtn"
          aria-label={`Your progress, week ${week} of ${totalWeeks}`}
          onClick={() => open({ k: "soon", title: "Your progress" })}
        >
          <span>Week {week}</span>
          <WeekRings week={week} total={totalWeeks} />
        </button>
      </header>

      {/* aria-busy until the phone's own ticks and clock are known: before
          that, what is "next" cannot be known either. */}
      <main className="sq-scroll" ref={scrollRef} aria-busy={!ready} inert={sheet ? true : undefined}>
        {tab === "today" ? (
          <SqHome
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
          />
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
                  </div>
                </SqCard>
                <SqCard title="You">
                  <div className="sq-list">
                    <SqNavRow title="Your record" note="Everything you have ticked, day by day" onOpen={() => open({ k: "record" })} />
                    <SqSwitchRow
                      title="Track every item on Home"
                      on={track}
                      onNote="On · ticks and your daily count show on Home"
                      offNote="Off · Home stays simple"
                      onChange={setTrack}
                    />
                    <SqSwitchRow
                      title="Larger text"
                      on={state.textLarge}
                      onNote="On · tap to go back to normal"
                      offNote="Off · tap to make everything bigger"
                      onChange={state.setTextLarge}
                    />
                  </div>
                </SqCard>
                <section className="sq-soft">The rest of this tab is not built yet.</section>
              </>
            ) : (
              <SqCard>
                <p className="sq-sub">{NOT_BUILT}</p>
              </SqCard>
            )}
          </>
        )}
      </main>

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
          </button>
        ))}
      </nav>

      {sheet && (
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
