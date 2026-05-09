"use client";

/**
 * IFMTrend — shows how the 7 IFM node scores have changed across
 * full-assessment sessions.
 *
 * Fetches raw session AI analysis on mount (lightweight — only mechanism slugs
 * and topic slugs; skips supplements and other large arrays).
 * Shows a mini bar + delta arrow for each of the 7 nodes.
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

  // Score the last two full-assessment sessions
  const last = analyses[analyses.length - 1];
  const prev = analyses[analyses.length - 2];

  const scoreSession = (s: SessionAnalysisData) =>
    computeIFMMatrix(
      s.likely_drivers.map((d) => ({ mechanism_slug: d.mechanism_slug, rank: d.rank ?? 0, reasoning: d.reasoning ?? "" })),
      s.topics_in_play.map((t) => ({ topic_slug: t.topic_slug, role: t.role, rationale: "", confidence_pct: null })),
      s.selected_symptoms
    );

  const lastResult = scoreSession(last);
  const prevResult = scoreSession(prev);

  // Build per-node comparison
  const nodeMap = (r: ReturnType<typeof computeIFMMatrix>) =>
    Object.fromEntries(r.nodes.map((n) => [n.node, n.score]));

  const lastScores = nodeMap(lastResult);
  const prevScores = nodeMap(prevResult);

  // Find max score across both sessions for normalisation
  const allScores = [...Object.values(lastScores), ...Object.values(prevScores)];
  const maxScore = Math.max(1, ...allScores);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          IFM Matrix trend
        </p>
        <p className="text-[11px] text-muted-foreground">
          {prev.date ?? "session 1"} → {last.date ?? "session 2"}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {IFM_NODES.map((node) => {
          const currScore = lastScores[node.id] ?? 0;
          const prevScore = prevScores[node.id] ?? 0;
          const delta = currScore - prevScore;
          const isPrimary = lastResult.primaryNode === node.id;

          return (
            <div key={node.id} className="flex items-center gap-2">
              <span className="text-base w-6 shrink-0" title={node.description}>{node.emoji}</span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-medium truncate" style={{ color: node.color }}>
                    {node.label}
                    {isPrimary && <span className="ml-1 text-[9px] font-bold opacity-70">PRIMARY</span>}
                  </span>
                  <DeltaArrow delta={delta} />
                </div>
                <ScoreBar score={currScore} color={node.color} maxScore={maxScore} />
              </div>
              <span
                className="text-[11px] font-semibold tabular-nums shrink-0 w-6 text-right"
                style={{ color: node.color }}
              >
                {currScore}
              </span>
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
        Scores derived from AI-identified mechanism slugs and topics.
        ↑ = increased load on that node · ↓ = decreased.
        Based on last 2 full sessions of {analyses.length} total.
      </p>
    </div>
  );
}
