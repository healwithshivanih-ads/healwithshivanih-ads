"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  IFM_NODES,
  computeIFMMatrix,
  detectLabPatterns,
  type IFMNodeScore,
  type LabPattern,
} from "@/lib/fmdb/ifm-matrix";
import type { AssessResult } from "@/lib/fmdb/anthropic-types";

interface Props {
  result: AssessResult;
  selectedSymptoms: string[];
}

// ── Score bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${score}%`, backgroundColor: color, opacity: score > 0 ? 1 : 0.15 }}
      />
    </div>
  );
}

// ── Node card ──────────────────────────────────────────────────────────────────

function NodeCard({ ns, isPrimary, isSecondary }: { ns: IFMNodeScore; isPrimary: boolean; isSecondary: boolean }) {
  const node = IFM_NODES.find((n) => n.id === ns.node)!;
  const active = ns.score > 0;

  return (
    <div
      className={`
        rounded-xl border p-3 transition-all
        ${isPrimary ? "border-2 shadow-md" : isSecondary ? "border shadow-sm" : "border-dashed opacity-50"}
      `}
      style={{
        borderColor: active ? node.color : "#e5e7eb",
        backgroundColor: active ? `${node.color}0d` : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-lg leading-none">{node.emoji}</span>
          <div>
            <p className="text-xs font-semibold leading-tight">{node.label}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{node.description}</p>
          </div>
        </div>
        {isPrimary && (
          <Badge className="text-[10px] py-0 px-1.5 shrink-0" style={{ backgroundColor: node.color, color: "#fff" }}>
            Primary
          </Badge>
        )}
        {isSecondary && !isPrimary && (
          <span className="text-[10px] text-muted-foreground shrink-0">2nd</span>
        )}
      </div>

      <ScoreBar score={ns.score} color={node.color} />

      {ns.score > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
          Score: {ns.score}%
          {ns.contributors.length > 0 && (
            <> · {ns.contributors.slice(0, 3).join(", ")}{ns.contributors.length > 3 ? ` +${ns.contributors.length - 3}` : ""}</>
          )}
        </p>
      )}
    </div>
  );
}

// ── Lab pattern banner ─────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<LabPattern["severity"], { bg: string; border: string; icon: string }> = {
  flag:    { bg: "bg-red-50",    border: "border-red-200",    icon: "🚩" },
  warning: { bg: "bg-amber-50",  border: "border-amber-200",  icon: "⚠️" },
  info:    { bg: "bg-blue-50",   border: "border-blue-200",   icon: "ℹ️" },
};

function LabPatternBanner({ pattern }: { pattern: LabPattern }) {
  const node = IFM_NODES.find((n) => n.id === pattern.node)!;
  const style = SEVERITY_STYLES[pattern.severity];

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${style.bg} ${style.border}`}>
      <div className="flex items-start gap-2">
        <span className="text-sm leading-none mt-0.5 shrink-0">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{pattern.title}</span>
            {pattern.value && (
              <code className="text-[10px] bg-white/60 px-1 py-0.5 rounded font-mono">{pattern.value}</code>
            )}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: `${node.color}20`, color: node.color }}
            >
              {node.emoji} {node.label}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 leading-snug">{pattern.detail}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function IFMMatrixCard({ result, selectedSymptoms }: Props) {
  const { suggestions, computed_ratios } = result;
  const drivers = suggestions?.likely_drivers ?? [];
  const topics = suggestions?.topics_in_play ?? [];
  const labs = suggestions?.extracted_labs ?? [];
  const ratios = computed_ratios ?? [];

  const matrixResult = useMemo(
    () => computeIFMMatrix(drivers, topics, selectedSymptoms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drivers.length, topics.length, selectedSymptoms.length]
  );

  const labPatterns = useMemo(
    () => detectLabPatterns(labs, ratios),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labs.length, ratios.length]
  );

  const activeNodes = matrixResult.nodes.filter((n) => n.score > 0);
  if (activeNodes.length === 0 && labPatterns.length === 0) return null;

  const primary = matrixResult.primaryNode;
  const secondary = matrixResult.nodes.find(
    (n) => n.node !== primary && n.score > 0
  )?.node ?? null;

  const flags   = labPatterns.filter((p) => p.severity === "flag");
  const warnings = labPatterns.filter((p) => p.severity === "warning");
  const infos   = labPatterns.filter((p) => p.severity === "info");

  return (
    <Card className="border-indigo-200 bg-indigo-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          🧬 IFM Matrix
          {activeNodes.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {activeNodes.length} of 7 nodes implicated
            </span>
          )}
        </CardTitle>
        {matrixResult.cascade && (
          <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-indigo-300 pl-2 mt-1">
            {matrixResult.cascade}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 7-node grid */}
        {activeNodes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {matrixResult.nodes.map((ns) => (
              <NodeCard
                key={ns.node}
                ns={ns}
                isPrimary={ns.node === primary}
                isSecondary={ns.node === secondary}
              />
            ))}
          </div>
        )}

        {/* Lab patterns */}
        {labPatterns.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              🧪 Lab pattern recognition
            </p>
            <div className="space-y-1.5">
              {[...flags, ...warnings, ...infos].map((p) => (
                <LabPatternBanner key={p.id} pattern={p} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
