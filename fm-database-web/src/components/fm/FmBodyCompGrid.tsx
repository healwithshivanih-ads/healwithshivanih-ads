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
  /** ISO date (YYYY-MM-DD) for each point in `series`, same indexing.
   *  Drives the elapsed-time label in each tile so coach sees the REAL
   *  window the delta covers ("−8 kg in 10 days" vs the previous
   *  hard-coded "−8 kg in 8 wks" which was misleading when intake
   *  was only days ago). When omitted, falls back to the baseline's
   *  default windowText. */
  seriesDates?: string[];
  /** Optional secondary series for compound metrics — used by Blood
   *  pressure to render systolic + diastolic in a single tile as
   *  "118/76". Same indexing as `series` (paired by position). When
   *  set, the delta + sparkline use the PRIMARY series. */
  secondarySeries?: number[];
  /** Optional display formatter — overrides default numeric formatting. */
  format?: (v: number) => string;
  /** "down" means lower is healthier (e.g. weight, BMI). "up" means higher. "neutral" both fine. */
  goalDirection?: "down" | "up" | "neutral";
}

/** All body-comp snapshots feeding the tile time-series, surfaced for
 *  the "Manage entries" expander so coach can delete a wrong entry (B2:
 *  Archana cl-007's 68→60 kg "trend" was a typo correction, not a real
 *  loss — coach had no UI to remove the bad entry). */
export interface BodyCompSnapshot {
  origin: "measurements_log" | "health_snapshots";
  date: string;             // YYYY-MM-DD
  source?: string;          // only present for health_snapshots
  values: Array<{ label: string; text: string }>;  // pre-formatted "Weight: 68 kg" rows
}

export interface FmBodyCompGridProps {
  metrics: BodyCompMetric[];
  /** When was the most recent measurement taken? Shown in the panel subtitle. */
  lastEntryDate?: string;
  /** Wires the "Log entry" button to addMeasurementAction. Optional —
   *  omit to keep the panel read-only. */
  clientId?: string;
  /** All snapshots feeding the tile time-series. When supplied, the
   *  "Manage entries" expander surfaces them with delete buttons. */
  snapshots?: BodyCompSnapshot[];
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
  snapshots,
  prefill,
}: FmBodyCompGridProps) {
  const [baseline, setBaseline] = useState<Baseline>("intake");
  const [showLog, setShowLog] = useState(false);
  const [showManage, setShowManage] = useState(false);

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
              fontSize: 12,
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
                  fontSize: 10,
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
        {clientId && snapshots && snapshots.length > 0 && (
          <button
            type="button"
            onClick={() => setShowManage(true)}
            style={{
              background: "transparent",
              color: "var(--fm-text-secondary)",
              border: "1px solid var(--fm-border)",
              padding: "3px 10px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: "var(--fm-radius-pill)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            title="View all body-comp entries on file. Delete a wrong one (e.g. typo correction) so the trend reflects reality."
          >
            ✏️ Manage entries ({snapshots.length})
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
      {showManage && clientId && snapshots && (
        <ManageEntriesModal
          clientId={clientId}
          snapshots={snapshots}
          onClose={() => setShowManage(false)}
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
    fontSize: 11,
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
            fontSize: 10,
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
            fontSize: 10,
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
            fontSize: 9,
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
        {/* Compound metric (e.g. BP): render "<primary>/<secondary>" with
            the secondary pulled from the matching index in secondarySeries.
            Fall back to primary-only if secondary is missing for this point. */}
        {m.secondarySeries && m.secondarySeries.length > 0
          ? (() => {
              const secondaryAtSameIdx =
                m.secondarySeries[m.series.length - 1] ??
                m.secondarySeries[m.secondarySeries.length - 1];
              return (
                <>
                  {fmt(latest)}
                  {typeof secondaryAtSameIdx === "number" && (
                    <span style={{ color: "var(--fm-text-secondary)" }}>
                      /{fmt(secondaryAtSameIdx)}
                    </span>
                  )}
                </>
              );
            })()
          : fmt(latest)}
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
          {/* Real elapsed window between baseline and latest. When dates
              are missing, fall back to the baseline's default label.
              Coach asked 2026-05-23: "why is it showing −8kg / 8 wks?"
              The answer was: it was actually 10 days, but we hard-coded
              "8 wks" as the label. Showing the real number naturally
              flags implausible deltas (−8 kg in 10 days reads as
              suspicious; the same in 8 wks would not). */}
          {elapsedLabel(m, baseline)}
        </span>
      </div>
    </div>
  );
}

/** Compute the elapsed-time label for the delta. Returns the actual
 *  number of days/weeks between the baseline measurement and the latest
 *  one, or "single reading" when there's nothing to compare against.
 *
 *  Examples:
 *    - 7 days → "1 wk"
 *    - 12 days → "12 days"
 *    - 56 days → "8 wks"
 *    - 1 point only → "single reading" (was misleading "8 wks" before)
 *    - 0 days (two readings same day) → "same day"
 *
 *  Bug B1 fix 2026-05-23 — the previous fallback dropped to the
 *  BASELINES hardcoded "8 wks" string when seriesDates had < 2 entries,
 *  which made every brand-new client's tiles show "→ flat · 8 wks"
 *  even though no week had elapsed. */
function elapsedLabel(m: BodyCompMetric, baseline: Baseline): string {
  if (!m.seriesDates || m.seriesDates.length < 2) {
    return m.series.length === 1 ? "single reading" : "—";
  }
  const last = m.seriesDates[m.seriesDates.length - 1];
  const baseIdx =
    baseline === "intake"
      ? 0
      : baseline === "prev"
        ? m.seriesDates.length - 2
        : Math.max(0, m.seriesDates.length - 4);
  const base = m.seriesDates[baseIdx];
  if (!last || !base) return "—";
  const ms = Date.parse(last) - Date.parse(base);
  if (Number.isNaN(ms) || ms < 0) return "—";
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "same day";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const wks = Math.round(days / 7);
  return `${wks} wk${wks === 1 ? "" : "s"}`;
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

/** B2 — manage body-comp entries. Lists every snapshot on file (from
 *  both measurements_log and health_snapshots) with date + source +
 *  values, with a per-row delete button. Coach hit the −8kg/10 days
 *  bug on Archana cl-007 — corrected weight 68→60 by adding a new
 *  snapshot, leaving the old one in place; the tile then showed the
 *  fake trend. This modal lets her delete the bad entry directly. */
function ManageEntriesModal({
  clientId,
  snapshots,
  onClose,
}: {
  clientId: string;
  snapshots: BodyCompSnapshot[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  // Sort newest first — coach scans for the wrong entry from the top.
  const ordered = [...snapshots].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)),
  );

  function handleDelete(snap: BodyCompSnapshot) {
    const sig =
      snap.values.length > 0
        ? snap.values.map((v) => `${v.label}: ${v.text}`).join(", ")
        : "no values";
    if (
      !confirm(
        `Delete the ${fmtDate(snap.date)} ${snap.source ? `(${snap.source}) ` : ""}entry?\n\n` +
          `Values: ${sig}\n\n` +
          `This is permanent. The body-comp trend and any computed deltas will recalculate from the remaining entries.`,
      )
    ) {
      return;
    }
    setErr(null);
    startTransition(async () => {
      const { deleteMeasurementSnapshotAction } = await import(
        "@/lib/server-actions/clients"
      );
      const res = await deleteMeasurementSnapshotAction({
        client_id: clientId,
        origin: snap.origin,
        date: snap.date,
        source: snap.source,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
      // Close on success — refresh feeds the panel with the new list.
      onClose();
    });
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 8,
          padding: 20,
          maxWidth: 560,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Body-comp entries on file
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: 0,
              fontSize: 18,
              cursor: "pointer",
              color: "var(--fm-text-tertiary)",
            }}
          >
            ×
          </button>
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--fm-text-tertiary)",
            margin: "0 0 12px",
            fontStyle: "italic",
          }}
        >
          Newest first. Delete an entry you typed by mistake — the trend tiles
          will recalculate. (For genuine corrections, add a new entry via{" "}
          <strong>+ Log entry</strong> AND delete the wrong one here.)
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {ordered.map((snap) => (
            <div
              key={`${snap.origin}-${snap.date}-${snap.source ?? ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 10px",
                border: "1px solid var(--fm-border-light)",
                borderRadius: 6,
                background: "var(--fm-surface)",
                fontSize: 13,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{fmtDate(snap.date)}</div>
                {snap.source && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fm-text-tertiary)",
                      marginTop: 1,
                    }}
                  >
                    source: {snap.source}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fm-text-secondary)",
                    marginTop: 3,
                  }}
                >
                  {snap.values.length > 0
                    ? snap.values
                        .map((v) => `${v.label} ${v.text}`)
                        .join(" · ")
                    : "(no values)"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(snap)}
                disabled={pending}
                style={{
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "rgba(220, 38, 38, 0.08)",
                  color: "#b91c1c",
                  border: "1px solid rgba(220, 38, 38, 0.30)",
                  borderRadius: 5,
                  cursor: pending ? "wait" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                🗑 Delete
              </button>
            </div>
          ))}
        </div>
        {err && (
          <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 10 }}>{err}</div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              background: "transparent",
              border: "1px solid var(--fm-border)",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
