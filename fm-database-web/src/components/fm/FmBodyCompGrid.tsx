"use client";

/**
 * FmBodyCompGrid — body composition tiles with sparkline + baseline toggle
 * (design 5B).
 *
 * Each tile shows current value, an SVG sparkline of the historical series,
 * and delta vs the selected baseline ("vs Intake" / "vs Previous" / "4-wk avg").
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FmPanel } from "./FmPanel";
import { addMeasurementAction } from "@/lib/server-actions/clients";

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
  /** Wires the "Log entry" button to addMeasurementAction. Optional —
   *  omit to keep the panel read-only. */
  clientId?: string;
  /** Optional values pre-filled into the log-entry form (e.g. from the
   *  client's intake submission so the coach doesn't retype them). */
  prefill?: {
    height_cm?: number | null;
    weight_kg?: number | null;
    waist_cm?: number | null;
    hip_cm?: number | null;
    blood_pressure_systolic?: number | null;
    blood_pressure_diastolic?: number | null;
  };
}

type Baseline = "intake" | "prev" | "avg4";

const BASELINES: { id: Baseline; label: string; windowText: string }[] = [
  { id: "intake", label: "vs Intake", windowText: "8 wks" },
  { id: "prev", label: "vs Previous", windowText: "1 wk" },
  { id: "avg4", label: "4-wk avg", windowText: "4 wks" },
];

export function FmBodyCompGrid({
  metrics,
  lastEntryDate,
  clientId,
  prefill,
}: FmBodyCompGridProps) {
  const [baseline, setBaseline] = useState<Baseline>("intake");
  const [showLog, setShowLog] = useState(false);

  const hasAny = metrics.some((m) => m.series.length > 0);

  if (!hasAny) {
    return (
      <FmPanel
        title="Body composition & vitals"
        subtitle="No measurements logged yet."
        rightSlot={
          <button
            type="button"
            onClick={() => setShowLog(true)}
            disabled={!clientId}
            title={clientId ? undefined : "Not wired to a client"}
            style={{
              background: clientId ? "var(--fm-primary)" : "var(--fm-border)",
              color: "#fff",
              border: 0,
              padding: "6px 12px",
              fontSize: 11.5,
              fontWeight: 600,
              borderRadius: "var(--fm-radius-sm)",
              cursor: clientId ? "pointer" : "not-allowed",
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
        {showLog && clientId && (
          <LogEntryModal
            clientId={clientId}
            prefill={prefill}
            onClose={() => setShowLog(false)}
          />
        )}
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
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        {clientId && (
          <button
            type="button"
            onClick={() => setShowLog(true)}
            style={{
              background: "var(--fm-primary)",
              color: "#fff",
              border: 0,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 700,
              borderRadius: "var(--fm-radius-pill)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            + Log entry
          </button>
        )}
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
      {showLog && clientId && (
        <LogEntryModal
          clientId={clientId}
          prefill={prefill}
          onClose={() => setShowLog(false)}
        />
      )}
    </FmPanel>
  );
}

function LogEntryModal({
  clientId,
  prefill,
  onClose,
}: {
  clientId: string;
  prefill?: FmBodyCompGridProps["prefill"];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [weightKg, setWeightKg] = useState(prefill?.weight_kg?.toString() ?? "");
  const [weightLb, setWeightLb] = useState("");
  const [heightCm, setHeightCm] = useState(prefill?.height_cm?.toString() ?? "");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [waistCm, setWaistCm] = useState(prefill?.waist_cm?.toString() ?? "");
  const [waistIn, setWaistIn] = useState("");
  const [hipCm, setHipCm] = useState(prefill?.hip_cm?.toString() ?? "");
  const [hipIn, setHipIn] = useState("");
  const [sys, setSys] = useState(prefill?.blood_pressure_systolic?.toString() ?? "");
  const [dia, setDia] = useState(prefill?.blood_pressure_diastolic?.toString() ?? "");
  const [hr, setHr] = useState("");
  const [notes, setNotes] = useState("");

  function num(s: string): number | undefined {
    const n = Number(s);
    return s.trim() && !Number.isNaN(n) ? n : undefined;
  }

  // Metric wins when both are filled; imperial converts to metric for storage
  // (storage is always _cm / _kg so charts stay consistent over time).
  function pickWeight(): number | undefined {
    const kg = num(weightKg);
    if (kg !== undefined) return kg;
    const lb = num(weightLb);
    return lb !== undefined ? round1(lb * 0.453592) : undefined;
  }
  function pickHeight(): number | undefined {
    const cm = num(heightCm);
    if (cm !== undefined) return cm;
    const ft = num(heightFt) ?? 0;
    const inches = num(heightIn) ?? 0;
    const total = ft * 12 + inches;
    return total > 0 ? round1(total * 2.54) : undefined;
  }
  function pickFromInches(cmField: string, inField: string): number | undefined {
    const cm = num(cmField);
    if (cm !== undefined) return cm;
    const i = num(inField);
    return i !== undefined ? round1(i * 2.54) : undefined;
  }
  function round1(n: number): number { return Math.round(n * 10) / 10; }

  function save() {
    setErr(null);
    startTransition(async () => {
      const r = await addMeasurementAction({
        client_id: clientId,
        date,
        weight_kg: pickWeight(),
        height_cm: pickHeight(),
        waist_cm: pickFromInches(waistCm, waistIn),
        hip_cm: pickFromInches(hipCm, hipIn),
        blood_pressure_systolic: num(sys),
        blood_pressure_diastolic: num(dia),
        resting_heart_rate: num(hr),
        notes: notes.trim() || undefined,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-secondary)",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    fontSize: 13,
    border: "1px solid var(--fm-border)",
    borderRadius: 4,
    fontFamily: "inherit",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 50, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 8,
          padding: 20,
          maxWidth: 480,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Log body composition entry</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: 0, fontSize: 18, cursor: "pointer", color: "var(--fm-text-tertiary)" }}>×</button>
        </div>
        {prefill && (Object.values(prefill).some((v) => v != null)) && (
          <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", margin: "0 0 12px", fontStyle: "italic" }}>
            Pre-filled from intake submission — edit any value.
          </p>
        )}
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={labelStyle}>Date</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", margin: 0, fontStyle: "italic" }}>
            Fill either unit per row. Imperial values are converted to metric for storage.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {/* Weight */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={labelStyle}>Weight (kg)</div>
                <input type="number" step="0.1" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} style={inputStyle} placeholder="e.g. 68" />
              </div>
              <div>
                <div style={labelStyle}>Weight (lb)</div>
                <input type="number" step="0.1" value={weightLb} onChange={(e) => setWeightLb(e.target.value)} style={inputStyle} placeholder="e.g. 150" />
              </div>
            </div>
            {/* Height */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={labelStyle}>Height (cm)</div>
                <input type="number" step="0.5" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} style={inputStyle} placeholder="e.g. 165" />
              </div>
              <div>
                <div style={labelStyle}>Height (ft + in)</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="number" min={3} max={8} value={heightFt} onChange={(e) => setHeightFt(e.target.value)} style={inputStyle} placeholder="ft" />
                  <input type="number" min={0} max={11} value={heightIn} onChange={(e) => setHeightIn(e.target.value)} style={inputStyle} placeholder="in" />
                </div>
              </div>
            </div>
            {/* Waist */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={labelStyle}>Waist (cm)</div>
                <input type="number" step="0.5" value={waistCm} onChange={(e) => setWaistCm(e.target.value)} style={inputStyle} placeholder="e.g. 82" />
              </div>
              <div>
                <div style={labelStyle}>Waist (in)</div>
                <input type="number" step="0.25" value={waistIn} onChange={(e) => setWaistIn(e.target.value)} style={inputStyle} placeholder="e.g. 32" />
              </div>
            </div>
            {/* Hips */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={labelStyle}>Hips (cm)</div>
                <input type="number" step="0.5" value={hipCm} onChange={(e) => setHipCm(e.target.value)} style={inputStyle} placeholder="e.g. 96" />
              </div>
              <div>
                <div style={labelStyle}>Hips (in)</div>
                <input type="number" step="0.25" value={hipIn} onChange={(e) => setHipIn(e.target.value)} style={inputStyle} placeholder="e.g. 38" />
              </div>
            </div>
            {/* BP + HR — units are universal */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={labelStyle}>BP systolic</div>
                <input type="number" value={sys} onChange={(e) => setSys(e.target.value)} style={inputStyle} placeholder="118" />
              </div>
              <div>
                <div style={labelStyle}>BP diastolic</div>
                <input type="number" value={dia} onChange={(e) => setDia(e.target.value)} style={inputStyle} placeholder="76" />
              </div>
              <div>
                <div style={labelStyle}>Resting HR</div>
                <input type="number" value={hr} onChange={(e) => setHr(e.target.value)} style={inputStyle} placeholder="72" />
              </div>
            </div>
          </div>
          <div>
            <div style={labelStyle}>Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
              placeholder="e.g. measured at home / after fasting"
            />
          </div>
          {err && <div style={{ color: "var(--fm-danger, #b04646)", fontSize: 12 }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} disabled={pending} style={{ padding: "8px 14px", fontSize: 13, background: "transparent", border: "1px solid var(--fm-border)", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button type="button" onClick={save} disabled={pending} style={{ padding: "8px 14px", fontSize: 13, background: "var(--fm-primary)", color: "white", border: 0, borderRadius: 4, cursor: pending ? "wait" : "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              {pending ? "Saving…" : "Save entry"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
