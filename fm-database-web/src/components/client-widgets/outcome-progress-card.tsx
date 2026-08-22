"use client";

import { useMemo } from "react";
import type { SessionSummary } from "@/lib/server-actions/assess";
import {
  computeMrsScore,
  MRS_SUBSCALE_MAX,
  type MenopauseRatingScaleData,
} from "@/lib/fmdb/mrs-score";

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
          s.type === "intake" ? "#6366f1"
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

export function OutcomeProgressCard({
  sessions,
  mrsBaseline,
  mrsBaselineDate,
}: {
  sessions: SessionSummary[];
  /** Day-0 MRS from the client intake form (client.mrs_baseline), if any. */
  mrsBaseline?: MenopauseRatingScaleData | null;
  /** When the intake was submitted (YYYY-MM-DD or ISO) — dates the baseline point. */
  mrsBaselineDate?: string | null;
}) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [sessions]
  );

  // Only intake + check_in sessions carry symptom data worth trending
  const assessmentSessions = sorted.filter(
    (s) => s.session_type === "intake" || s.session_type === "check_in"
  );

  // Symptom burden points — last 10 sessions
  const burdenPoints = assessmentSessions.slice(-10).map((s) => ({
    date: s.date,
    count: (s.selected_symptoms ?? []).length,
    type: s.session_type,
  }));

  // MRS (Menopause Rating Scale) points — only sessions with a complete,
  // scorable 11-item entry. Partial entries are skipped, not zero-filled.
  // A scorable intake baseline (client.mrs_baseline) joins as an "intake"
  // point, so a single check-in already reads as a before/after.
  const baselineScore = computeMrsScore(mrsBaseline);
  const baselinePoint =
    baselineScore && mrsBaselineDate
      ? [{ date: mrsBaselineDate.slice(0, 10), count: baselineScore.total, type: "intake", score: baselineScore }]
      : [];
  const mrsPoints = [
    ...baselinePoint,
    ...assessmentSessions
      .map((s) => ({ s, score: computeMrsScore(s.mrs) }))
      .filter((x): x is { s: SessionSummary; score: NonNullable<ReturnType<typeof computeMrsScore>> } => x.score != null)
      .map(({ s, score }) => ({
        date: s.date,
        count: score.total,
        type: s.session_type as string,
        score,
      })),
  ]
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(-10);
  const latestMrs = mrsPoints.length > 0 ? mrsPoints[mrsPoints.length - 1] : undefined;
  const prevMrs = mrsPoints.length > 1 ? mrsPoints[mrsPoints.length - 2] : undefined;

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
  // MRS becomes the primary number once a peri/menopausal client has two
  // scorable entries; the generic symptom chart is then demoted, not removed.
  const hasMrs = mrsPoints.length >= 2;

  if (!hasBurden && !hasFP && !hasMrs) return null;

  // Symptom burden trend — latest vs first
  const firstCount = burdenPoints[0]?.count ?? 0;
  const lastCount = burdenPoints[burdenPoints.length - 1]?.count ?? 0;
  const burdenDelta = lastCount - firstCount;

  // MRS trend — latest vs first
  const firstMrs = mrsPoints[0]?.count ?? 0;
  const lastMrsTotal = latestMrs?.count ?? 0;
  const mrsDelta = lastMrsTotal - firstMrs;

  // The header pill shows whichever is primary.
  const primaryDelta = hasMrs ? mrsDelta : burdenDelta;
  const primaryLabel = hasMrs ? "MRS score" : "symptom burden";
  const showHeaderPill = hasMrs || hasBurden;

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
        {showHeaderPill && (
          <div
            className={`rounded-lg px-3 py-1.5 text-center shrink-0 ${
              primaryDelta < 0
                ? "bg-emerald-50 border border-emerald-200"
                : primaryDelta > 0
                ? "bg-red-50 border border-red-200"
                : "bg-gray-50 border"
            }`}
          >
            <p className={`text-lg font-bold leading-none ${primaryDelta < 0 ? "text-emerald-600" : primaryDelta > 0 ? "text-red-500" : "text-muted-foreground"}`}>
              {primaryDelta < 0 ? `▼${Math.abs(primaryDelta)}` : primaryDelta > 0 ? `▲${primaryDelta}` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">{primaryLabel}</p>
          </div>
        )}
      </div>

      {/* MRS chart — primary for peri/menopausal clients once 2+ scorable entries exist */}
      {hasMrs && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            Menopause Rating Scale per session
            <span className="ml-2 normal-case font-normal">
              <span className="inline-block w-2 h-2 rounded-sm bg-indigo-400 mr-0.5" />full session
              <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mx-1 ml-2" />check-in
            </span>
          </p>
          <SymptomBurdenChart sessions={mrsPoints} />
          <p className="text-[10px] text-muted-foreground">
            {firstMrs} → {lastMrsTotal} / 44
            {mrsDelta < 0
              ? ` — down ${Math.abs(mrsDelta)} ✓`
              : mrsDelta > 0
              ? ` — up ${mrsDelta}, review protocol`
              : " — stable"}
          </p>
          {latestMrs && (
            <div className="space-y-1.5 pt-1">
              <PillarBar
                label="Somatic"
                emoji="🌡️"
                color="#f59e0b"
                value={latestMrs.score.somaticVegetative}
                max={MRS_SUBSCALE_MAX.somaticVegetative}
                inverted
                prevValue={prevMrs?.score.somaticVegetative}
              />
              <PillarBar
                label="Psych"
                emoji="🧠"
                color="#8b5cf6"
                value={latestMrs.score.psychological}
                max={MRS_SUBSCALE_MAX.psychological}
                inverted
                prevValue={prevMrs?.score.psychological}
              />
              <PillarBar
                label="Urogenital"
                emoji="🌸"
                color="#ec4899"
                value={latestMrs.score.urogenital}
                max={MRS_SUBSCALE_MAX.urogenital}
                inverted
                prevValue={prevMrs?.score.urogenital}
              />
            </div>
          )}
        </div>
      )}

      {/* Symptom burden chart — primary unless MRS has taken over, in which
          case it's demoted to a collapsed disclosure so nothing disappears. */}
      {hasBurden && hasMrs && (
        <details className="group">
          <summary className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium cursor-pointer select-none">
            <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span>
            {" "}All tracked symptoms per session
          </summary>
          <div className="space-y-1 pt-2">
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
        </details>
      )}
      {hasBurden && !hasMrs && (
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
