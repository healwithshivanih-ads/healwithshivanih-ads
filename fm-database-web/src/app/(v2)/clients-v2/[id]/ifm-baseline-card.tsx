/**
 * IfmBaselineCard — renders the stored IFM 7-node functional-medicine
 * baseline (client.ifm_baseline) on the v2 Overview.
 *
 * Read-only display — a server component, no hooks. The baseline is
 * written either by the intake form's section-8 scoring or by a coach /
 * AI mapping pass. Each node carries a 1–5 score (1 = optimal,
 * 5 = severe dysfunction) plus a rationale.
 *
 * Distinct from the IFMTrend widget, which derives node scores from
 * session AI-analysis over time. This card shows the single captured
 * baseline + its rationale + the primary-node cascade.
 */
import { FmPanel } from "@/components/fm";

const NODES = [
  { id: "assimilation", label: "Assimilation", emoji: "🦠", desc: "Gut, digestion, microbiome, absorption" },
  { id: "defense_repair", label: "Defense & Repair", emoji: "🛡️", desc: "Immune, inflammation, infection" },
  { id: "energy", label: "Energy", emoji: "⚡", desc: "Mitochondria, ATP, metabolism" },
  { id: "biotransformation", label: "Biotransformation", emoji: "🔄", desc: "Liver, detox pathways, elimination" },
  { id: "transport", label: "Transport", emoji: "🚢", desc: "Cardiovascular, lymph, blood" },
  { id: "communication", label: "Communication", emoji: "📡", desc: "Hormones, neurotransmitters, signalling" },
  { id: "structural", label: "Structural Integrity", emoji: "🏛️", desc: "Bone, muscle, cell membranes" },
] as const;

interface IfmNodeScore {
  score?: number;
  rationale?: string;
}
export interface IfmBaseline {
  date?: string;
  source?: string;
  primary_node?: string;
  cascade?: string;
  nodes?: Record<string, IfmNodeScore>;
}

// 1 = optimal (green) → 5 = severe (red).
const SCORE_COLOR: Record<number, string> = {
  1: "#16a34a",
  2: "#84cc16",
  3: "#f59e0b",
  4: "#f97316",
  5: "#dc2626",
};
const SCORE_LABEL: Record<number, string> = {
  1: "Optimal",
  2: "Mild",
  3: "Moderate",
  4: "Significant",
  5: "Severe",
};

export function IfmBaselineCard({
  baseline,
}: {
  baseline: IfmBaseline | null | undefined;
}) {
  if (!baseline || !baseline.nodes || Object.keys(baseline.nodes).length === 0) {
    return null;
  }
  const nodes = baseline.nodes;

  return (
    <FmPanel
      title="🧭 IFM Matrix — baseline"
      subtitle={
        (baseline.date ? `Captured ${baseline.date}` : "Baseline") +
        " · 1 = optimal, 5 = severe dysfunction" +
        (baseline.source ? ` · ${baseline.source}` : "")
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        {NODES.map((n) => {
          const entry = nodes[n.id];
          const score =
            typeof entry?.score === "number" ? entry.score : undefined;
          const isPrimary = baseline.primary_node === n.id;
          const color = score ? SCORE_COLOR[score] ?? "#94a3b8" : "#cbd5e1";
          return (
            <div
              key={n.id}
              style={{
                padding: "9px 11px",
                borderRadius: "var(--fm-radius-sm)",
                background: isPrimary
                  ? "rgba(220, 38, 38, 0.05)"
                  : "var(--fm-surface)",
                border: `1px solid ${
                  isPrimary ? "rgba(220, 38, 38, 0.35)" : "var(--fm-border)"
                }`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 15 }}>{n.emoji}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{n.label}</span>
                {isPrimary && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      color: "#fff",
                      background: "#dc2626",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    Primary
                  </span>
                )}
                {/* 5-segment score bar */}
                <span
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    gap: 3,
                    alignItems: "center",
                  }}
                >
                  {[1, 2, 3, 4, 5].map((seg) => (
                    <span
                      key={seg}
                      style={{
                        width: 14,
                        height: 8,
                        borderRadius: 2,
                        background:
                          score && seg <= score ? color : "var(--fm-border)",
                      }}
                    />
                  ))}
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: score ? color : "var(--fm-text-tertiary)",
                      marginLeft: 4,
                      minWidth: 64,
                      textAlign: "right",
                    }}
                  >
                    {score ? `${score}/5 ${SCORE_LABEL[score] ?? ""}` : "—"}
                  </span>
                </span>
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: entry?.rationale ? 3 : 0,
                }}
              >
                {n.desc}
              </div>
              {entry?.rationale && (
                <p
                  style={{
                    fontSize: 11.5,
                    color: "var(--fm-text-secondary)",
                    margin: 0,
                    lineHeight: 1.45,
                  }}
                >
                  {entry.rationale}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {baseline.cascade && (
        <div
          style={{
            marginTop: 10,
            padding: "9px 11px",
            background: "var(--fm-bg-cool)",
            border: "1px dashed var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 11.5,
            color: "var(--fm-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "var(--fm-text-primary)" }}>Cascade:</strong>{" "}
          {baseline.cascade}
        </div>
      )}
    </FmPanel>
  );
}
