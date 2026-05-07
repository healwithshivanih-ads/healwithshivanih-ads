"use client";

import { useMemo } from "react";
import type { SessionSummary } from "@/app/assess/actions";

// ── Colour palette ─────────────────────────────────────────────────────────────
const PILLAR_CONFIG: Array<{
  key: "sleep_quality" | "stress_level" | "movement_days_per_week" | "nutrition_quality" | "connection_quality";
  label: string;
  color: string;
  emoji: string;
  inverted: boolean;
  max: number;
}> = [
  { key: "sleep_quality",          label: "Sleep",      color: "#6366f1", emoji: "😴", inverted: false, max: 5 },
  { key: "stress_level",           label: "Stress",     color: "#ef4444", emoji: "🧠", inverted: true,  max: 5 },
  { key: "movement_days_per_week", label: "Movement",   color: "#10b981", emoji: "🏃", inverted: false, max: 7 },
  { key: "nutrition_quality",      label: "Nutrition",  color: "#f59e0b", emoji: "🥗", inverted: false, max: 5 },
  { key: "connection_quality",     label: "Connection", color: "#ec4899", emoji: "❤️", inverted: false, max: 5 },
];

// ── SVG bar chart for symptom burden ──────────────────────────────────────────

function SymptomBurdenChart({
  sessions,
}: {
  sessions: Array<{ date?: string; count: number; type: string }>;
}) {
  const maxCount = Math.max(1, ...sessions.map((s) => s.count));
  const W = 380;
  const H = 80;
  const PAD_X = 4;
  const PAD_Y = 6;
  const barW = Math.max(8, Math.min(32, (W - PAD_X * 2) / sessions.length - 4));
  const gap = (W - PAD_X * 2 - barW * sessions.length) / Math.max(1, sessions.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm overflow-visible">
      {sessions.map((s, i) => {
        const barH = Math.max(3, ((s.count / maxCount) * (H - PAD_Y * 2)));
        const x = PAD_X + i * (barW + gap);
        const y = H - PAD_Y - barH;
        const isFirst = i === 0;
        const isLast = i === sessions.length - 1;
        const delta = i > 0 ? s.count - sessions[i - 1].count : 0;
        const barColor =
          s.type === "full_assessment" ? "#6366f1"
          : s.type === "check_in" ? "#10b981"
          : "#94a3b8";

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={3}
              fill={barColor}
              opacity={0.85}
            />
            {/* Count label on bar */}
            <text
              x={x + barW / 2}
              y={y - 3}
              textAnchor="middle"
              fontSize={9}
              fill="#64748b"
            >
              {s.count}
            </text>
            {/* Delta arrow on last bar */}
            {isLast && delta !== 0 && (
              <text
                x={x + barW / 2}
                y={y - 13}
                textAnchor="middle"
                fontSize={9}
                fill={delta < 0 ? "#10b981" : "#ef4444"}
              >
                {delta < 0 ? `▼${Math.abs(delta)}` : `▲${delta}`}
              </text>
            )}
            {/* Date label — show first and last only */}
            {(isFirst || isLast) && s.date && (
              <text
                x={x + barW / 2}
                y={H - 1}
                textAnchor="middle"
                fontSize={8}
                fill="#94a3b8"
              >
                {s.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Five pillars bar ───────────────────────────────────────────────────────────

function PillarBar({
  label,
  emoji,
  color,
  value,
  max = 5,
  inverted,
  prevValue,
}: {
  label: string;
  emoji: string;
  color: string;
  value: number;
  max?: number;
  inverted: boolean;
  prevValue?: number;
}) {
  const pct = (value / max) * 100;
  const effectiveScore = inverted ? max + 1 - value : value; // for display purposes
  const delta = prevValue != null ? value - prevValue : null;
  const improved = inverted ? (delta != null && delta < 0) : (delta != null && delta > 0);
  const worsened = inverted ? (delta != null && delta > 0) : (delta != null && delta < 0);

  return (
    <div className="grid grid-cols-[72px_1fr_32px] items-center gap-2">
      <span className="text-[11px] text-muted-foreground text-right whitespace-nowrap">
        {emoji} {label}
      </span>
      <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex items-center gap-0.5">
        <span className="text-[11px] font-medium" style={{ color }}>
          {value}/{max}
        </span>
        {delta !== null && delta !== 0 && (
          <span className={`text-[9px] ${improved ? "text-emerald-600" : worsened ? "text-red-500" : ""}`}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function OutcomeProgressCard({ sessions }: { sessions: SessionSummary[] }) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [sessions]
  );

  // Only full_assessment + check_in sessions carry symptom data worth trending
  const assessmentSessions = sorted.filter(
    (s) => s.session_type === "full_assessment" || s.session_type === "check_in"
  );

  // Symptom burden points — last 10 sessions
  const burdenPoints = assessmentSessions.slice(-10).map((s) => ({
    date: s.date,
    count: (s.selected_symptoms ?? []).length,
    type: s.session_type,
  }));

  // Five pillars — most recent session with fp data, and the one before it
  const fpSessions = sorted.filter((s) => s.five_pillars != null);
  const latestFP = fpSessions.length > 0 ? fpSessions[fpSessions.length - 1].five_pillars : undefined;
  const prevFP = fpSessions.length > 1 ? fpSessions[fpSessions.length - 2].five_pillars : undefined;

  // Session cadence stats
  const totalSessions = sessions.length;
  const firstDate = sorted[0]?.date;
  const lastDate = sorted[sorted.length - 1]?.date;
  const spanDays =
    firstDate && lastDate && firstDate !== lastDate
      ? Math.round(
          (new Date(lastDate).getTime() - new Date(firstDate).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : null;
  const avgDaysBetween =
    spanDays != null && totalSessions > 1
      ? Math.round(spanDays / (totalSessions - 1))
      : null;

  const hasBurden = burdenPoints.length >= 2;
  const hasFP = latestFP != null;

  if (!hasBurden && !hasFP) return null;

  // Symptom burden trend — latest vs first
  const firstCount = burdenPoints[0]?.count ?? 0;
  const lastCount = burdenPoints[burdenPoints.length - 1]?.count ?? 0;
  const burdenDelta = lastCount - firstCount;

  return (
    <div className="rounded-xl border bg-white p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            📈 Outcome progress
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalSessions} session{totalSessions !== 1 ? "s" : ""}
            {spanDays != null && ` · ${Math.round(spanDays / 30)} months`}
            {avgDaysBetween != null && ` · avg every ${avgDaysBetween} days`}
          </p>
        </div>
        {hasBurden && burdenPoints.length >= 2 && (
          <div
            className={`rounded-lg px-3 py-1.5 text-center shrink-0 ${
              burdenDelta < 0
                ? "bg-emerald-50 border border-emerald-200"
                : burdenDelta > 0
                ? "bg-red-50 border border-red-200"
                : "bg-gray-50 border"
            }`}
          >
            <p className={`text-lg font-bold leading-none ${burdenDelta < 0 ? "text-emerald-600" : burdenDelta > 0 ? "text-red-500" : "text-muted-foreground"}`}>
              {burdenDelta < 0 ? `▼${Math.abs(burdenDelta)}` : burdenDelta > 0 ? `▲${burdenDelta}` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">symptom burden</p>
          </div>
        )}
      </div>

      {/* Symptom burden chart */}
      {hasBurden && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            Symptom burden per session
            <span className="ml-2 normal-case font-normal">
              <span className="inline-block w-2 h-2 rounded-sm bg-indigo-400 mr-0.5" />full session
              <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mx-1 ml-2" />check-in
            </span>
          </p>
          <SymptomBurdenChart sessions={burdenPoints} />
          <p className="text-[10px] text-muted-foreground">
            {firstCount} → {lastCount} symptoms
            {burdenDelta < 0
              ? ` — down ${Math.abs(burdenDelta)} ✓`
              : burdenDelta > 0
              ? ` — up ${burdenDelta}, review protocol`
              : " — stable"}
          </p>
        </div>
      )}

      {/* Five Pillars */}
      {hasFP && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            Five pillars
            {fpSessions.length > 1 && (
              <span className="ml-2 normal-case font-normal text-muted-foreground">
                vs {fpSessions[fpSessions.length - 2]?.date?.slice(5)} prev
              </span>
            )}
          </p>
          <div className="space-y-1.5">
            {PILLAR_CONFIG.map(({ key, label, emoji, color, inverted, max }) => {
              const val = latestFP![key as keyof typeof latestFP];
              const prev = prevFP?.[key as keyof typeof prevFP];
              if (val == null) return null;
              return (
                <PillarBar
                  key={key}
                  label={label}
                  emoji={emoji}
                  color={color}
                  value={val as number}
                  max={max}
                  inverted={inverted}
                  prevValue={prev as number | undefined}
                />
              );
            })}
          </div>
          {prevFP && (
            <p className="text-[10px] text-muted-foreground italic">
              Compared to previous session with five pillars data
            </p>
          )}
        </div>
      )}
    </div>
  );
}
