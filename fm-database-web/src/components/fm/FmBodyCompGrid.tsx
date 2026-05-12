"use client";

/**
 * FmBodyCompGrid — body composition tiles with sparkline + baseline toggle
 * (design 5B).
 *
 * Each tile shows current value, an SVG sparkline of the historical series,
 * and delta vs the selected baseline ("vs Intake" / "vs Previous" / "4-wk avg").
 */
import { useState } from "react";
import { FmPanel } from "./FmPanel";

export interface BodyCompMetric {
  /** Display label, e.g. "Weight". */
  label: string;
  /** Unit, e.g. "kg" or "" for ratios. */
  unit: string;
  /** Values over time, oldest → newest. */
  series: number[];
  /** Optional display formatter — overrides default numeric formatting. */
  format?: (v: number) => string;
  /** "down" means lower is healthier (e.g. weight, BMI). "up" means higher. "neutral" both fine. */
  goalDirection?: "down" | "up" | "neutral";
}

export interface FmBodyCompGridProps {
  metrics: BodyCompMetric[];
  /** When was the most recent measurement taken? Shown in the panel subtitle. */
  lastEntryDate?: string;
}

type Baseline = "intake" | "prev" | "avg4";

const BASELINES: { id: Baseline; label: string; windowText: string }[] = [
  { id: "intake", label: "vs Intake", windowText: "8 wks" },
  { id: "prev", label: "vs Previous", windowText: "1 wk" },
  { id: "avg4", label: "4-wk avg", windowText: "4 wks" },
];

export function FmBodyCompGrid({ metrics, lastEntryDate }: FmBodyCompGridProps) {
  const [baseline, setBaseline] = useState<Baseline>("intake");

  const hasAny = metrics.some((m) => m.series.length > 0);

  if (!hasAny) {
    return (
      <FmPanel
        title="Body composition & vitals"
        subtitle="No measurements logged yet."
        rightSlot={
          <button
            type="button"
            style={{
              background: "var(--fm-primary)",
              color: "#fff",
              border: 0,
              padding: "6px 12px",
              fontSize: 11.5,
              fontWeight: 600,
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            + Log first entry
          </button>
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
          }}
        >
          {metrics.map((m) => (
            <div
              key={m.label}
              style={{
                padding: "14px 10px",
                border: "1.5px dashed var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                color: "var(--fm-text-tertiary)",
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  fontWeight: 700,
                }}
              >
                {m.label}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  marginTop: 6,
                  lineHeight: 1,
                }}
              >
                —
              </div>
            </div>
          ))}
        </div>
        <p
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            fontStyle: "italic",
          }}
        >
          Coming later: drop a body-comp scan PDF (InBody, DEXA, BioImpedance) to fill all
          tiles at once.
        </p>
      </FmPanel>
    );
  }

  return (
    <FmPanel
      title="Body composition · trend"
      subtitle={
        lastEntryDate ? `Last entry ${lastEntryDate}.` : "Tracked at every check-in."
      }
      rightSlot={
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-pill)",
            padding: 2,
            background: "var(--fm-surface)",
          }}
        >
          {BASELINES.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBaseline(b.id)}
              style={{
                padding: "4px 12px",
                fontSize: 11,
                fontWeight: 700,
                border: 0,
                borderRadius: "var(--fm-radius-pill)",
                cursor: "pointer",
                background: baseline === b.id ? "var(--fm-primary)" : "transparent",
                color: baseline === b.id ? "#fff" : "var(--fm-text-secondary)",
                fontFamily: "inherit",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 8,
        }}
      >
        {metrics.map((m) => (
          <Tile key={m.label} m={m} baseline={baseline} />
        ))}
      </div>
    </FmPanel>
  );
}

function Tile({ m, baseline }: { m: BodyCompMetric; baseline: Baseline }) {
  if (m.series.length === 0) {
    return (
      <div
        style={{
          padding: "10px 12px",
          border: "1.5px dashed var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          color: "var(--fm-text-tertiary)",
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            fontWeight: 700,
          }}
        >
          {m.label}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6, lineHeight: 1 }}>
          —
        </div>
        <div style={{ fontSize: 10, marginTop: 6, fontWeight: 600 }}>＋ add</div>
      </div>
    );
  }

  const latest = m.series[m.series.length - 1];
  const intake = m.series[0];
  const prev = m.series[m.series.length - 2] ?? intake;
  const avg4 =
    m.series.slice(-4).reduce((s, v) => s + v, 0) /
    Math.max(1, m.series.slice(-4).length);

  const baseVal =
    baseline === "intake" ? intake : baseline === "prev" ? prev : avg4;
  const delta = latest - baseVal;
  const goal = m.goalDirection ?? "neutral";

  // Pick trend colour: improvement is green; regression is amber/red; flat is grey.
  const trend: "improve" | "regress" | "flat" =
    Math.abs(delta) < 0.05
      ? "flat"
      : goal === "down"
        ? delta < 0
          ? "improve"
          : "regress"
        : goal === "up"
          ? delta > 0
            ? "improve"
            : "regress"
          : "flat";

  const trendCol =
    trend === "improve"
      ? "var(--fm-success)"
      : trend === "regress"
        ? "var(--fm-warning)"
        : "var(--fm-text-tertiary)";

  const fmt = m.format ?? ((v: number) => v.toFixed(v >= 100 ? 0 : 1));
  const deltaSign = delta > 0 ? "+" : delta < 0 ? "" : "";
  const deltaText = trend === "flat" ? "flat" : `${deltaSign}${fmt(delta)}${m.unit}`;
  const arrow = trend === "improve" ? (goal === "down" ? "↓" : "↑") : trend === "regress" ? (goal === "down" ? "↑" : "↓") : "→";

  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
        background: "var(--fm-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--fm-text-tertiary)",
            fontWeight: 700,
          }}
        >
          {m.label}
        </div>
        <div
          style={{
            fontSize: 8.5,
            color: "var(--fm-text-tertiary)",
            fontWeight: 600,
          }}
        >
          {m.series.length}pt
        </div>
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--fm-text-primary)",
          marginTop: 3,
          lineHeight: 1,
        }}
      >
        {fmt(latest)}
        {m.unit && (
          <span
            style={{
              fontSize: 10,
              color: "var(--fm-text-tertiary)",
              fontWeight: 600,
              marginLeft: 3,
            }}
          >
            {m.unit}
          </span>
        )}
      </div>
      <div style={{ marginTop: 5 }}>
        <Sparkline data={m.series} color={trendCol} />
      </div>
      <div
        style={{
          fontSize: 10,
          color: trendCol,
          marginTop: 3,
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          {arrow} {deltaText}
        </span>
        <span style={{ color: "var(--fm-text-tertiary)", fontWeight: 500 }}>
          {BASELINES.find((b) => b.id === baseline)?.windowText}
        </span>
      </div>
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div style={{ height: 22 }} />;
  const w = 100;
  const h = 22;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastX = w;
  const lastY = h - ((data[data.length - 1] - min) / range) * (h - 4) - 2;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 22, display: "block" }}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="1.8" fill={color} />
    </svg>
  );
}
