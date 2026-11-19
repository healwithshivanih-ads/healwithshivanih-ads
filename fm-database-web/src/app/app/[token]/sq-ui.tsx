"use client";

/**
 * Small shared pieces of the new front: the state it is lent, the sheets it
 * can open, the line icons, and the two row shapes (a tick row, a switch row).
 * No behaviour of its own.
 */

import type { ReactNode } from "react";

/**
 * The state today's app owns and lends to the new front. ochre-app.tsx keeps
 * the on-device store (`ochre.app.<clientId>`), the day's ticks and the sync
 * to the coach; the new front only reads and toggles. Do not give it a store
 * of its own — a client switched back must find everything she ticked.
 */
export interface SqShellState {
  /** True once the on-device store has been read back. */
  hydrated: boolean;
  /** Today's meal, supplement and remedy ticks: id → the time it was ticked. */
  logged: Record<string, string>;
  /** Today's practice ticks: id → done. */
  practicesDone: Record<string, boolean>;
  /** Today's practice ticks: id → the time it was ticked. */
  practiceAt: Record<string, string>;
  /** Tick or clear a meal, supplement or remedy. */
  toggleTick: (id: string) => void;
  /** Tick or clear a practice. */
  togglePractice: (id: string) => void;
  /** The last week whose check-in was sent from this phone (0 = none). */
  checkinSentWeek: number;
  /** The per-device larger-text setting, shared with today's app. */
  textLarge: boolean;
  setTextLarge: (on: boolean) => void;
}

/** Every full-screen sheet the shell can open. */
export type SqSheet =
  | { k: "day" }
  | { k: "record" }
  | { k: "recday"; date: string }
  | { k: "recipe"; slot: string }
  | { k: "start" }
  /** the coach's eating-out guide for this plan week, in full */
  | { k: "eatout"; where?: string }
  /** a practice, playing (sq-practice.tsx); id from sq-practice-data.ts */
  | { k: "practice"; id: string }
  /** the goodnight screen after the sleep wind-down */
  | { k: "night" }
  /** the four practice backgrounds */
  | { k: "scenes" }
  /** a screen a later build step fills in */
  | { k: "soon"; title: string };

export type SqIconName = "home" | "leaf" | "chat" | "grid" | "x" | "check" | "chev" | "right" | "left" | "up" | "bag" | "pen";

/** Line icons, 24×24, drawn with the stroke set in `.sq-ic`. */
const ICON_PATHS: Record<SqIconName, string> = {
  home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  leaf: "M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l8-8",
  chat: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  grid: "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  chev: "M6 9l6 6 6-6",
  right: "M9 6l6 6-6 6",
  left: "M15 6l-6 6 6 6",
  up: "M12 19V5M5 12l7-7 7 7",
  bag: "M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
};

export function SqIcon({ name }: { name: SqIconName }) {
  return (
    <svg className="sq-ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** One tickable row: the tick, a name, and a smaller line under it. */
export function SqTickRow({
  on,
  name,
  note,
  under,
  onToggle,
}: {
  on: boolean;
  name: string;
  note?: string;
  /** indent it under the row above (a supplement taken with a meal) */
  under?: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={"sq-li" + (under ? " sq-under" : "")} aria-pressed={on} onClick={onToggle}>
      <span className="sq-tick">
        <SqIcon name="check" />
      </span>
      <span className="sq-li-body">
        <b>{name}</b>
        {note && <small>{note}</small>}
      </span>
    </button>
  );
}

/** A row that opens something. */
export function SqNavRow({ title, note, onOpen }: { title: string; note?: string; onOpen: () => void }) {
  return (
    <button type="button" className="sq-li" onClick={onOpen}>
      <span className="sq-li-body">
        <b>{title}</b>
        {note && <small>{note}</small>}
      </span>
      <SqIcon name="right" />
    </button>
  );
}

/** A row that turns a setting on or off; the note says which it is now. */
export function SqSwitchRow({
  title,
  on,
  onNote,
  offNote,
  onChange,
}: {
  title: string;
  on: boolean;
  onNote: string;
  offNote: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button type="button" className="sq-li" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="sq-li-body">
        <b>{title}</b>
        <small>{on ? onNote : offNote}</small>
      </span>
      <span className="sq-switch" aria-hidden="true" />
    </button>
  );
}

export function SqCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="sq-card">
      {title && <div className="sq-sec">{title}</div>}
      {children}
    </section>
  );
}
