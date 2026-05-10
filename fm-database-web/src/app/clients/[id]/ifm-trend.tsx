"use client";

/**
 * IFMTrend — shows how the 7 IFM node scores have changed across
 * full-assessment sessions OVER TIME.
 *
 * Two modes:
 *  - 2 sessions → side-by-side comparison (delta arrow)
 *  - 3+ sessions → per-node sparkline chart (one row per IFM node,
 *    one mini bar per session, hover/title shows date + score)
 *
 * Fetches raw session AI analysis on mount (lightweight — only mechanism slugs
 * and topic slugs; skips supplements and other large arrays).
 * Only rendered when ≥2 full-assessment sessions exist.
 */

import { useEffect, useState } from "react";
import { IFM_NODES, computeIFMMatrix } from "@/lib/fmdb/ifm-matrix";
import { loadFullSessionAnalysisAction, type SessionAnalysisData } from "@/app/assess/actions";
import type { SessionSummary } from "@/app/assess/actions";

interface IFMTrendProps {
  clientId: string;
  sessions: SessionSummary[];
}

// ── Mini sparkline bar ─────────────────────────────────────────────────────────

function ScoreBar({
  score,
  color,
  maxScore = 100,
}: {
  score: number;
  color: string;
  maxScore?: number;
}) {
  const pct = Math.max(0, Math.min(100, maxScore > 0 ? (score / maxScore) * 100 : 0));
  return (
    <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Delta arrow ────────────────────────────────────────────────────────────────

function DeltaArrow({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-[11px] text-muted-foreground">±0</span>;
  const up = delta > 0;
  return (
    <span className={`text-[11px] font-bold ${up ? "text-amber-600" : "text-emerald-600"}`}>
      {up ? "↑" : "↓"} {Math.abs(delta)}
    </span>
  );
}

// ── Per-node sparkline (3+ sessions) ───────────────────────────────────────────

interface SparklinePoint {
  date: string;
  score: number;
}

function NodeSparkline({
  points,
  color,
  maxScore,
}: {
  points: SparklinePoint[];
  color: string;
  maxScore: number;
}) {
  if (points.length === 0) {
    return <div className="h-6 w-full" />;
  }
  // SVG line + dots, ~120px wide × 24px tall
  const W = 120;
  const H = 24;
  const xStep = points.length > 1 ? W / (points.length - 1) : W;
  const norm = (s: number) => H - 2 - (Math.max(0, Math.min(maxScore, s)) / Math.max(1, maxScore)) * (H - 4);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * xStep} ${norm(p.score)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-6">
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={i * xStep}
          cy={norm(p.score)}
          r={2}
          fill={color}
        >
          <title>{`${p.date} · ${p.score}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function IFMTrend({ clientId, sessions }: IFMTrendProps) {
  const fullSessions = sessions.filter((s) => s.session_type === "intake");

  // Don't render unless there are ≥2 intake sessions
  if (fullSessions.length < 2) return null;

  return <IFMTrendInner clientId={clientId} />;
}

function IFMTrendInner({ clientId }: { clientId: string }) {
  const [analyses, setAnalyses] = useState<SessionAnalysisData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadFullSessionAnalysisAction(clientId)
      .then((data) => {
        if (!cancelled) {
          setAnalyses(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground italic px-1 py-2">
        Loading IFM trend data…
      </div>
    );
  }

  if (error || !analyses || analyses.length < 2) return null;

  const scoreSession = (s: SessionAnalysisData) =>
    computeIFMMatrix(
      s.likely_drivers.map((d) => ({ mechanism_slug: d.mechanism_slug, rank: d.rank ?? 0, reasoning: d.reasoning ?? "" })),
      s.topics_in_play.map((t) => ({ topic_slug: t.topic_slug, role: t.role, rationale: "", confidence_pct: null })),
      s.selected_symptoms
    );

  // Score every session
  const sessionScores = analyses.map((s) => ({
    date: s.date ?? "—",
    result: scoreSession(s),
  }));

  // Find max score across ALL sessions for consistent y-axis
  const allScores = sessionScores.flatMap((ss) => ss.result.nodes.map((n) => n.score));
  const maxScore = Math.max(1, ...allScores);

  // Build per-node series
  const lastResult = sessionScores[sessionScores.length - 1].result;
  const nodeSeries = IFM_NODES.map((node) => {
    const points: SparklinePoint[] = sessionScores.map((ss) => {
      const found = ss.result.nodes.find((n) => n.node === node.id);
      return { date: ss.date, score: found?.score ?? 0 };
    });
    const currScore = points[points.length - 1]?.score ?? 0;
    const prevScore = points.length > 1 ? points[points.length - 2].score : currScore;
    const firstScore = points[0]?.score ?? 0;
    return {
      node,
      points,
      currScore,
      prevScore,
      firstScore,
      delta: currScore - prevScore,
      totalDelta: currScore - firstScore,
      isPrimary: lastResult.primaryNode === node.id,
    };
  });

  const showSparklines = sessionScores.length >= 3;
  const firstDate = sessionScores[0].date;
  const lastDate = sessionScores[sessionScores.length - 1].date;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          IFM Matrix trend ({sessionScores.length} session{sessionScores.length !== 1 ? "s" : ""})
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {firstDate} → {lastDate}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2">
        {nodeSeries.map(({ node, points, currScore, prevScore, firstScore, delta, totalDelta, isPrimary }) => {
          void prevScore; // shown in delta calc only
          return (
            <div key={node.id} className="flex items-center gap-2">
              <span className="text-base w-6 shrink-0" title={node.description}>{node.emoji}</span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-medium truncate" style={{ color: node.color }}>
                    {node.label}
                    {isPrimary && <span className="ml-1 text-[9px] font-bold opacity-70">PRIMARY</span>}
                  </span>
                  {showSparklines ? (
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {firstScore}
                      <span className="mx-1 opacity-40">→</span>
                      <span className={
                        totalDelta > 0 ? "text-amber-600 font-bold" :
                        totalDelta < 0 ? "text-emerald-600 font-bold" :
                        "text-muted-foreground"
                      }>
                        {currScore}
                      </span>
                    </span>
                  ) : (
                    <DeltaArrow delta={delta} />
                  )}
                </div>
                {showSparklines ? (
                  <NodeSparkline points={points} color={node.color} maxScore={maxScore} />
                ) : (
                  <ScoreBar score={currScore} color={node.color} maxScore={maxScore} />
                )}
              </div>
              {!showSparklines && (
                <span
                  className="text-[11px] font-semibold tabular-nums shrink-0 w-6 text-right"
                  style={{ color: node.color }}
                >
                  {currScore}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {lastResult.cascade && (
        <p className="text-[11px] text-muted-foreground italic leading-relaxed border-t pt-2">
          {lastResult.cascade}
        </p>
      )}

      <p className="text-[10px] text-muted-foreground">
        Scores derived from AI-identified mechanism slugs + topics across {sessionScores.length} full session{sessionScores.length !== 1 ? "s" : ""}.
        {showSparklines ? " Hover any dot for date + score." : ""}{" "}
        <span className="text-amber-600 font-medium">↑ rising load</span> ·{" "}
        <span className="text-emerald-600 font-medium">↓ load reducing</span>.
      </p>
    </div>
  );
}
