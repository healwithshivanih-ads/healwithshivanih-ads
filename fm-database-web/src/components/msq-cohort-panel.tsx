/**
 * MsqCohortPanel — practice-level symptom outcomes from the Progress-tab MSQ.
 *
 * Server component. Renders the cohort's headline MSQ (the standard FM
 * outcome number) plus a per-system trajectory. Two live states:
 *   - "baseline"  — clients have a baseline but no retake yet (retakes are
 *                   21-day gated). Shows where the cohort's burden sits.
 *   - "trend"     — at least one client has a retake. Shows improving /
 *                   holding / worse per system.
 * Reads nothing new — it's a pure rollup of data the app already collects.
 * Source: getCohortMsqOutcomes (lib/fmdb/msq-cohort.ts).
 */
import Link from "next/link";
import { FmPanel } from "@/components/fm";
import type { CohortMsqOutcomes, CohortMsqSystem } from "@/lib/fmdb/msq-cohort";

const C_IMPROVE = "var(--fm-success)";
const C_HOLD = "var(--fm-border-strong)";
const C_WORSE = "#e0544f";
const C_SEV = "#8d99ae";

const SYSTEMS_SHOWN = 8;

function Sparkline({ points, improving }: { points: number[]; improving: boolean }) {
  if (points.length < 2) return null;
  const W = 132;
  const H = 36;
  const pad = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (W - 2 * pad);
    const y = pad + (1 - (v - min) / span) * (H - 2 * pad);
    return `${Math.round(x)},${Math.round(y)}`;
  });
  const stroke = improving ? "#1d9e75" : "#8d99ae";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`Cohort average MSQ trending from ${points[0]} to ${points[points.length - 1]}`}
      style={{ flexShrink: 0 }}
    >
      <polyline points={coords.join(" ")} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={coords[0].split(",")[0]} cy={coords[0].split(",")[1]} r={2.4} fill={stroke} />
      <circle cx={coords[coords.length - 1].split(",")[0]} cy={coords[coords.length - 1].split(",")[1]} r={2.4} fill={stroke} />
    </svg>
  );
}

function TrendRow({ s }: { s: CohortMsqSystem }) {
  const total = s.improving + s.holding + s.worse || 1;
  const pct = s.avgDeltaPct ?? 0;
  const tagColor = pct <= -1 ? C_IMPROVE : pct >= 1 ? C_WORSE : "var(--fm-text-tertiary)";
  const tag = pct === 0 ? "—" : `${pct < 0 ? "↓" : "↑"} ${Math.abs(pct)}%`;
  return (
    <Link
      href={`/dashboard-v2/outcomes/${s.id}`}
      style={{ display: "flex", alignItems: "center", gap: 10, margin: "7px 0", textDecoration: "none", color: "inherit" }}
    >
      <div style={{ width: 104, fontSize: 12.5, color: "var(--fm-text-primary)" }}>{s.label}</div>
      <div style={{ flex: 1, height: 13, display: "flex", borderRadius: 999, overflow: "hidden", background: "var(--fm-bg-warm)" }}>
        {s.improving > 0 && <div style={{ flex: s.improving, background: C_IMPROVE }} />}
        {s.holding > 0 && <div style={{ flex: s.holding, background: C_HOLD }} />}
        {s.worse > 0 && <div style={{ flex: s.worse, background: C_WORSE }} />}
        {total === 1 && s.improving + s.holding + s.worse === 0 && <div style={{ flex: 1, background: "var(--fm-bg-warm)" }} />}
      </div>
      <div style={{ width: 52, textAlign: "right", fontSize: 12, fontWeight: 700, color: tagColor }}>{tag}</div>
      <span style={{ width: 10, textAlign: "right", color: "var(--fm-text-tertiary)", fontSize: 14 }}>›</span>
    </Link>
  );
}

function BaselineRow({ s, maxBaseline }: { s: CohortMsqSystem; maxBaseline: number }) {
  const w = Math.round((s.avgBaseline / (maxBaseline || 1)) * 100);
  return (
    <Link
      href={`/dashboard-v2/outcomes/${s.id}`}
      style={{ display: "flex", alignItems: "center", gap: 10, margin: "7px 0", textDecoration: "none", color: "inherit" }}
    >
      <div style={{ width: 104, fontSize: 12.5, color: "var(--fm-text-primary)" }}>{s.label}</div>
      <div style={{ flex: 1, height: 13, borderRadius: 999, overflow: "hidden", background: "var(--fm-bg-warm)" }}>
        <div style={{ width: `${w}%`, height: "100%", background: C_SEV }} />
      </div>
      <div style={{ width: 52, textAlign: "right", fontSize: 12, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
        {s.avgBaseline}
      </div>
      <span style={{ width: 10, textAlign: "right", color: "var(--fm-text-tertiary)", fontSize: 14 }}>›</span>
    </Link>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        color: "var(--fm-text-secondary)",
        background: "var(--fm-bg-warm)",
        padding: "2px 9px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--fm-text-secondary)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

export function MsqCohortPanel({ data }: { data: CohortMsqOutcomes }) {
  if (data.mode === "empty") {
    return (
      <FmPanel title="Symptom outcomes (MSQ)" subtitle="Medical Symptom Questionnaire · cohort">
        <p style={{ fontSize: 12.5, color: "var(--fm-text-secondary)", lineHeight: 1.6, margin: 0 }}>
          No MSQ baselines captured yet. As clients complete the questionnaire in the app&apos;s Progress tab, their
          baseline and 21-day retakes roll up here — the practice&apos;s headline outcome number plus which body systems
          are improving across everyone.
        </p>
      </FmPanel>
    );
  }

  const trend = data.mode === "trend";
  const rows = data.systems.slice(0, SYSTEMS_SHOWN);
  const maxBaseline = Math.max(...data.systems.map((s) => s.avgBaseline), 1);

  const headlineValue = trend ? data.avgLatestTotal : data.avgBaselineTotal;
  const improvingCohort = (data.deltaPct ?? 0) < 0;

  // Insight line.
  let insight = "";
  if (trend) {
    const best = data.systems.filter((s) => s.improving > s.worse && (s.avgDeltaPct ?? 0) < 0).slice(0, 2);
    const stubborn = [...data.systems].sort((a, b) => b.worse - a.worse || (b.avgDeltaPct ?? 0) - (a.avgDeltaPct ?? 0))[0];
    if (best.length) {
      insight = `${best.map((s) => s.label).join(" and ")} ${best.length > 1 ? "are" : "is"} responding fastest across your clients.`;
      if (stubborn && stubborn.worse > 0 && !best.some((s) => s.id === stubborn.id))
        insight += ` ${stubborn.label} is the cohort's stubborn system — worth a protocol look.`;
    }
  } else {
    const top = data.systems.slice(0, 2).map((s) => s.label);
    insight = `Cohort burden concentrates in ${top.join(" and ")} — the systems to design around.`;
  }

  return (
    <FmPanel
      title="Symptom outcomes (MSQ)"
      subtitle={trend ? "Medical Symptom Questionnaire · cohort trajectory" : "Medical Symptom Questionnaire · cohort baseline"}
      rightSlot={
        <Chip>
          {trend ? `${data.clientsWithTrend} with a retake` : `${data.clientsWithMsq} ${data.clientsWithMsq === 1 ? "baseline" : "baselines"}`}
        </Chip>
      }
    >
      {/* Headline */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)" }}>Avg MSQ score · lower is better</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: "var(--fm-text-primary)", lineHeight: 1 }}>{headlineValue}</span>
            {trend && (
              <>
                <span style={{ fontSize: 13, color: "var(--fm-text-tertiary)" }}>from {data.avgBaselineTotal} at baseline</span>
                {data.deltaPct !== null && data.deltaPct !== 0 && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: improvingCohort ? C_IMPROVE : C_WORSE }}>
                    {improvingCohort ? "↓" : "↑"} {Math.abs(data.deltaPct)}%
                  </span>
                )}
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
            {trend && data.latestBandLabel ? (
              <Chip>
                {data.baselineBandLabel} → {data.latestBandLabel}
              </Chip>
            ) : (
              <Chip>{data.baselineBandLabel} band</Chip>
            )}
            <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)", alignSelf: "center" }}>
              n={trend ? data.clientsWithTrend : data.clientsWithMsq} with {trend ? "≥2 MSQ" : "a baseline"}
            </span>
          </div>
        </div>
        {trend && <div style={{ marginLeft: "auto" }}><Sparkline points={data.cohortPoints} improving={improvingCohort} /></div>}
      </div>

      {/* Systems */}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fm-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
        {trend ? "By system — which areas are moving" : "By system — where burden sits"}
      </div>
      {trend && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 10 }}>
          <LegendDot color={C_IMPROVE} label="Improving" />
          <LegendDot color={C_HOLD} label="Holding" />
          <LegendDot color={C_WORSE} label="Worse" />
        </div>
      )}
      {rows.map((s) => (trend ? <TrendRow key={s.id} s={s} /> : <BaselineRow key={s.id} s={s} maxBaseline={maxBaseline} />))}
      {data.systems.length > SYSTEMS_SHOWN && (
        <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 6 }}>
          {SYSTEMS_SHOWN} of {data.systems.length} systems
        </div>
      )}

      {/* Insight */}
      {insight && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            background: "var(--fm-bg-cool)",
            borderRadius: "var(--fm-radius-md)",
            padding: "10px 12px",
            marginTop: 14,
            fontSize: 12.5,
            color: "var(--fm-text-primary)",
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden="true">💡</span>
          <span>{insight}</span>
        </div>
      )}

      <div style={{ marginTop: 11, fontSize: 11, color: "var(--fm-text-tertiary)", lineHeight: 1.5 }}>
        From the MSQ baseline + 21-day retakes in the Progress tab — nothing new to ask.
        {!trend && " Trajectory appears once clients complete their first retake."}
      </div>
    </FmPanel>
  );
}
