"use client";

/**
 * CalendarMonthGrid — 7×N month grid for /calendar.
 *
 * Reads events as a flat array (date + kind + label + href). Day cells
 * group by date, render up to 3 chips, show "+N more" overflow.
 *
 * Navigation is URL-driven (?ym=YYYY-MM) for shareable links.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export type CalendarEventKind =
  | "session"
  | "booking"
  | "follow_up_due"
  | "follow_up_upcoming"
  | "recheck_due";

export interface CalendarEvent {
  date: string;            // YYYY-MM-DD
  kind: CalendarEventKind;
  label: string;           // displayed in chip — e.g. "Geetika · check-in"
  clientId: string;
  href: string;            // where to go on click
  tooltip?: string;        // hover detail
}

const KIND_STYLE: Record<CalendarEventKind, { bg: string; fg: string; border: string; emoji: string }> = {
  session:             { bg: "rgba(46, 110, 213, 0.10)",  fg: "#1d4ed8", border: "rgba(46, 110, 213, 0.45)",  emoji: "📋" },
  booking:             { bg: "rgba(30, 132, 73, 0.12)",   fg: "#15803d", border: "rgba(30, 132, 73, 0.55)",   emoji: "📅" },
  follow_up_upcoming:  { bg: "rgba(245, 158, 11, 0.12)",  fg: "#b45309", border: "rgba(245, 158, 11, 0.50)",  emoji: "🟡" },
  follow_up_due:       { bg: "rgba(239, 68, 68, 0.12)",   fg: "#b91c1c", border: "rgba(239, 68, 68, 0.50)",   emoji: "🔴" },
  recheck_due:         { bg: "rgba(124, 58, 237, 0.12)",  fg: "#6d28d9", border: "rgba(124, 58, 237, 0.50)",  emoji: "🟣" },
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(ym: string): { date: string; dayOfMonth: number; dow: number }[] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const out: { date: string; dayOfMonth: number; dow: number }[] = [];
  for (let d = 1; d <= last; d++) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = new Date(y, (m ?? 1) - 1, d).getDay(); // 0 = Sun, but we'll show Mon-first
    out.push({ date, dayOfMonth: d, dow });
  }
  return out;
}

/** Render Monday-first weeks (index 0 = Mon, 6 = Sun). */
function dowMondayFirst(dow: number): number {
  return (dow + 6) % 7;
}

export function CalendarMonthGrid({
  ym,
  events,
  todayStr,
}: {
  ym: string;
  events: CalendarEvent[];
  todayStr: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const goToMonth = (newYm: string) => {
    const next = new URLSearchParams(params);
    next.set("ym", newYm);
    router.push(`/calendar?${next.toString()}`);
  };

  // Index events by date for O(1) day lookup
  const byDate: Record<string, CalendarEvent[]> = {};
  for (const ev of events) {
    (byDate[ev.date] ||= []).push(ev);
  }

  const days = daysInMonth(ym);
  const firstDow = dowMondayFirst(days[0]?.dow ?? 1);

  // Build cells: blank leading cells + day cells. Pad trailing to 42 for stable 6-row grid.
  type Cell = { kind: "blank" } | { kind: "day"; date: string; dayOfMonth: number };
  const cells: Cell[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ kind: "blank" });
  for (const d of days) cells.push({ kind: "day", date: d.date, dayOfMonth: d.dayOfMonth });
  while (cells.length < 42 && cells.length % 7 !== 0) cells.push({ kind: "blank" });

  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Counts in the visible month — show at top
  const monthEvents = events.filter((e) => e.date.startsWith(ym + "-"));
  const sessionN  = monthEvents.filter((e) => e.kind === "session").length;
  const overdueN  = monthEvents.filter((e) => e.kind === "follow_up_due").length;
  const upcomingN = monthEvents.filter((e) => e.kind === "follow_up_upcoming").length;
  const recheckN  = monthEvents.filter((e) => e.kind === "recheck_due").length;

  return (
    <div>
      {/* Navigation header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => goToMonth(shiftMonth(ym, -1))}
          aria-label="Previous month"
          style={navBtnStyle()}
        >
          ← Prev
        </button>
        <h2
          style={{
            fontFamily: "var(--fm-font-display)",
            fontSize: 22,
            fontWeight: 600,
            margin: 0,
            color: "var(--fm-text-primary)",
          }}
        >
          {monthLabel(ym)}
        </h2>
        <button
          onClick={() => goToMonth(shiftMonth(ym, 1))}
          aria-label="Next month"
          style={navBtnStyle()}
        >
          Next →
        </button>
        <button
          onClick={() => goToMonth(todayStr.slice(0, 7))}
          style={{ ...navBtnStyle(), fontWeight: 700 }}
        >
          Today
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--fm-text-tertiary)", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>📋 {sessionN} session{sessionN === 1 ? "" : "s"}</span>
          {overdueN > 0 && <span style={{ color: "#b91c1c" }}>🔴 {overdueN} overdue</span>}
          {upcomingN > 0 && <span style={{ color: "#b45309" }}>🟡 {upcomingN} upcoming</span>}
          {recheckN > 0 && <span style={{ color: "#6d28d9" }}>🟣 {recheckN} recheck</span>}
        </span>
      </div>

      {/* Weekday header row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          marginBottom: 4,
        }}
      >
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "var(--fm-text-tertiary)",
              textAlign: "center",
              padding: "4px 0",
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "minmax(110px, auto)",
          gap: 4,
        }}
      >
        {cells.map((cell, idx) => {
          if (cell.kind === "blank") {
            return (
              <div
                key={`blank-${idx}`}
                style={{
                  background: "var(--fm-surface-muted, rgba(0,0,0,0.02))",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              />
            );
          }
          const dayEvents = byDate[cell.date] ?? [];
          const isToday = cell.date === todayStr;
          const shown = dayEvents.slice(0, 3);
          const hidden = dayEvents.length - shown.length;
          return (
            <div
              key={cell.date}
              style={{
                background: "var(--fm-surface)",
                border: `1px solid ${isToday ? "var(--fm-primary)" : "var(--fm-border-light)"}`,
                borderRadius: "var(--fm-radius-sm)",
                padding: "6px 6px 4px",
                minHeight: 110,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: isToday ? 700 : 500,
                  color: isToday ? "var(--fm-primary)" : "var(--fm-text-secondary)",
                  marginBottom: 2,
                }}
              >
                {cell.dayOfMonth}
              </div>
              {shown.map((ev, i) => {
                const s = KIND_STYLE[ev.kind];
                return (
                  <Link
                    key={`${ev.date}-${i}`}
                    href={ev.href}
                    title={ev.tooltip ?? ev.label}
                    style={{
                      display: "block",
                      fontSize: 11,
                      lineHeight: 1.3,
                      padding: "2px 5px",
                      background: s.bg,
                      color: s.fg,
                      border: `1px solid ${s.border}`,
                      borderRadius: 3,
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.emoji} {ev.label}
                  </Link>
                );
              })}
              {hidden > 0 && (
                <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)", paddingLeft: 4 }}>
                  +{hidden} more
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "var(--fm-text-tertiary)" }}>
        <span>📋 session</span>
        <span>🟡 follow-up upcoming (≤7 days)</span>
        <span>🔴 follow-up overdue</span>
        <span>🟣 plan recheck due</span>
      </div>
    </div>
  );
}

function navBtnStyle(): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    background: "var(--fm-surface)",
    color: "var(--fm-text-primary)",
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    cursor: "pointer",
  };
}
