"use client";

/**
 * The NEW front of the client app — the Sequoya shell (look D of the
 * prototype in docs/client-app-redesign/).
 *
 * Step 0 of the build plan: the frame only. A top bar (ring mark, wordmark,
 * "Week N"), a scrolling main area, four bottom tabs and a full-screen sheet
 * host. Each tab is a placeholder; Home, ticks, the ask box and the practice
 * player arrive in the later steps.
 *
 * Who sees this is decided in exactly one place: ochre-app.tsx calls
 * `pickAppShell` (src/lib/fmdb/app-shell.ts) and renders this component
 * instead of today's app. This file never decides that for itself.
 *
 * State is NOT kept here. ochre-app.tsx owns the on-device store
 * (`ochre.app.<clientId>`) and the day's ticks, and hands them in as `state`,
 * so both fronts read and write the same data and a client moved back to
 * today's app finds everything she ticked.
 *
 * Copy rule: the app says "Coach", never the coach's first name.
 */

import { useEffect, useRef, useState } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { SequoyaFonts, SequoyaRingMark } from "@/components/sequoya/sequoya-brand";
import { bandForHour } from "./day-plan";
import "./sq.css";

/** The shared state today's app owns and lends to this front. Step 0 only
 *  reads `hydrated`; the ticks are carried so step 1 (Home) can use them
 *  without touching the store again. */
export interface SqShellState {
  /** True once the on-device store has been read back. */
  hydrated: boolean;
  /** Today's supplement / remedy ticks: id → the time it was ticked. */
  logged: Record<string, string>;
  /** Today's practice ticks: id → done. */
  practicesDone: Record<string, boolean>;
  toggleSupp: (id: string) => void;
  togglePractice: (id: string) => void;
  /** Tick several at once; never un-ticks. */
  markDone: (ids: { logIds: string[]; practiceIds: string[] }) => void;
}

export type SqTabId = "today" | "practices" | "coach" | "all";

type SqIconName = "home" | "leaf" | "chat" | "grid" | "x";

/** Line icons, 24×24, drawn with the stroke set in `.sq-ic`. */
const ICON_PATHS: Record<SqIconName, string> = {
  home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  leaf: "M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l8-8",
  chat: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  grid: "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z",
  x: "M6 6l12 12M18 6L6 18",
};

function SqIcon({ name }: { name: SqIconName }) {
  return (
    <svg className="sq-ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export const SQ_TABS: { id: SqTabId; label: string; icon: SqIconName }[] = [
  { id: "today", label: "Today", icon: "home" },
  { id: "practices", label: "Practices", icon: "leaf" },
  { id: "coach", label: "Coach", icon: "chat" },
  { id: "all", label: "Everything", icon: "grid" },
];

/** The one plain line every unbuilt screen shows. */
const NOT_BUILT = "This screen is not built yet.";

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

interface Sheet {
  title: string;
}

export default function SqApp({ data, state }: { data: ClientAppData; state: SqShellState }) {
  const [tab, setTab] = useState<SqTabId>("today");
  const [sheet, setSheet] = useState<Sheet | null>(null);

  // Midday on the server and on first paint; the device's own hour after
  // mount. Reading the clock during render would differ between the server
  // (its timezone) and the phone, and React would flag the mismatch.
  const [sky, setSky] = useState<SkyTime>("midday");
  useEffect(() => {
    setSky(skyForHour(new Date().getHours()));
  }, []);

  const scrollRef = useRef<HTMLElement | null>(null);
  const go = (next: SqTabId) => {
    setTab(next);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  // A sheet covers the whole app, so it behaves as a dialog: Escape closes it
  // and focus returns to whatever opened it.
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openSheet = (s: Sheet) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSheet(s);
  };
  const closeSheet = () => {
    setSheet(null);
    openerRef.current?.focus();
    openerRef.current = null;
  };
  useEffect(() => {
    if (!sheet) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSheet(null);
      openerRef.current?.focus();
      openerRef.current = null;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const { week, totalWeeks } = data.client;
  const active = SQ_TABS.find((t) => t.id === tab) ?? SQ_TABS[0];

  return (
    <div className="sq-app" data-time={sky}>
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
          onClick={() => openSheet({ title: "Your progress" })}
        >
          <span>Week {week}</span>
          <WeekRings week={week} total={totalWeeks} />
        </button>
      </header>

      {/* aria-busy until the on-device store is read back: before that the
          day's ticks are not known, and later steps draw from them. */}
      <main className="sq-scroll" ref={scrollRef} aria-busy={!state.hydrated} inert={sheet ? true : undefined}>
        <div className="sq-greet">
          <h1>{active.label}</h1>
        </div>
        <div className="sq-card">
          <p>{NOT_BUILT}</p>
        </div>
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
        <div className="sq-sheet" role="dialog" aria-modal="true" aria-labelledby="sq-sheet-title">
          <div className="sq-sheet-h">
            <h2 id="sq-sheet-title">{sheet.title}</h2>
            <button type="button" className="sq-x" aria-label="Close" onClick={closeSheet} ref={closeRef}>
              <SqIcon name="x" />
            </button>
          </div>
          <div className="sq-sheet-b">
            <div className="sq-card">
              <p>{NOT_BUILT}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
