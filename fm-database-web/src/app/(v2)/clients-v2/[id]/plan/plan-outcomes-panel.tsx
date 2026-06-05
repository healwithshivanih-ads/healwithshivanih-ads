"use client";

/**
 * PlanOutcomesPanel — outcome tracking surface for a published plan.
 *
 * Loads the delta computation (Plan.baseline_snapshot vs latest
 * Client.health_snapshots) on mount and renders three sections:
 *
 *   1. 🧪 Lab markers — what's moved since the plan started, sorted
 *      improving → worsening → unchanged → unknown. Direction tagging
 *      respects FM optimal ranges (TSH/hsCRP/insulin/etc lower-is-
 *      better; ferritin/vitamin D higher-is-better; etc).
 *
 *   2. 📏 Measurements — weight, waist, BP, HR. Same delta math.
 *
 *   3. 📋 Presenting symptoms (Phase 1 stub) — the symptoms the plan
 *      targets. Phase 2 will join against follow-up symptom logs to
 *      show resolved/improved/same/worsened; for now just lists what's
 *      being tracked so coach can ask explicitly at follow-up.
 *
 * Phase 1 is per-client only — no cross-client aggregation yet (that's
 * Phase 2). When the panel says "ferritin 35 → 62 in 84 days" it's
 * still showing coach what the protocol did for ONE client. The
 * aggregation that drives evidence_tier adjustments is Phase 3.
 */
import { useEffect, useState } from "react";
import {
  computePlanOutcomesAction,
  type PlanOutcomesResult,
  type LabDelta,
  type MeasurementDelta,
} from "@/lib/server-actions/plan-outcomes";
import { FmPanel, FmChip } from "@/components/fm";

interface Props {
  planSlug: string;
  clientId: string;
}

const DIRECTION_TONE: Record<LabDelta["direction"], { bg: string; fg: string; emoji: string; label: string }> = {
  improving: { bg: "rgba(16, 185, 129, 0.10)", fg: "#065f46", emoji: "📈", label: "improving" },
  worsening: { bg: "rgba(239, 68, 68, 0.10)", fg: "#7f1d1d", emoji: "📉", label: "worsening" },
  unchanged: { bg: "rgba(148, 163, 184, 0.10)", fg: "#475569", emoji: "≈", label: "unchanged" },
  unknown:   { bg: "rgba(245, 158, 11, 0.10)", fg: "#92400e", emoji: "?", label: "no FM direction" },
};

const MEAS_LABEL: Record<string, string> = {
  weight_kg: "Weight",
  waist_cm: "Waist",
  blood_pressure_systolic: "BP systolic",
  blood_pressure_diastolic: "BP diastolic",
  resting_heart_rate: "Resting HR",
};

const MEAS_UNIT: Record<string, string> = {
  weight_kg: "kg",
  waist_cm: "cm",
  blood_pressure_systolic: "mmHg",
  blood_pressure_diastolic: "mmHg",
  resting_heart_rate: "bpm",
};

function fmtDelta(d: LabDelta | MeasurementDelta): string {
  if (d.delta_numeric === null) return "—";
  const sign = d.delta_numeric > 0 ? "+" : "";
  const n = Math.abs(d.delta_numeric) < 1 ? d.delta_numeric.toFixed(2) : d.delta_numeric.toFixed(1);
  return `${sign}${n}`;
}

function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined) return "";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(0)}%`;
}

export function PlanOutcomesPanel({ planSlug, clientId }: Props) {
  const [result, setResult] = useState<PlanOutcomesResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await computePlanOutcomesAction(planSlug, clientId);
        if (cancelled) return;
        setResult(r);
      } catch (e) {
        // Audit Phase-1b: without this catch a thrown action (malformed YAML,
        // rotated Server Action ID on a stale tab) left the panel stuck on
        // "Loading…" forever. Surface it via the existing error branch.
        if (!cancelled)
          setResult({ ok: false, error: (e as Error).message } as PlanOutcomesResult);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planSlug, clientId]);

  if (loading) {
    return (
      <FmPanel
        title="📊 Outcomes since plan publish"
        subtitle="Lab markers + measurements + symptoms — vs the baseline captured when this plan went live."
      >
        <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>Loading…</div>
      </FmPanel>
    );
  }

  if (!result || !result.ok) {
    return (
      <FmPanel
        title="📊 Outcomes since plan publish"
        subtitle={result?.error ?? "Couldn't load outcomes."}
      >
        <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>
          {result?.error ?? "Try refreshing."}
        </div>
      </FmPanel>
    );
  }

  if (!result.has_baseline) {
    return (
      <FmPanel
        title="📊 Outcomes since plan publish"
        subtitle="Baseline snapshot wasn't captured for this plan."
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            padding: "10px 12px",
            background: "rgba(148,163,184,0.08)",
            border: "1px dashed rgba(148,163,184,0.35)",
            borderRadius: 6,
            lineHeight: 1.5,
          }}
        >
          This plan was published before outcome tracking landed. The next
          plan you publish (or supersede this one with) will capture a
          baseline automatically. To populate retroactively, run the
          backfill script:{" "}
          <code style={{ fontSize: 11 }}>
            .venv/bin/python -c &quot;…&quot;
          </code>{" "}
          (or reactivate from a snapshot manually).
        </div>
      </FmPanel>
    );
  }

  const { lab_deltas, measurement_deltas, presenting_symptoms_baseline, baseline_date, current_date, days_since_baseline, backfilled } = result;

  return (
    <FmPanel
      title="📊 Outcomes since plan publish"
      subtitle={`Comparing baseline (${baseline_date || "—"}) to most recent data (${current_date || "—"})${
        days_since_baseline !== undefined ? ` · ${days_since_baseline} days elapsed` : ""
      }${backfilled ? " · (backfilled snapshot — pre-Phase-1 plan)" : ""}.`}
    >
      <div style={{ display: "grid", gap: 16 }}>
        {/* ── Lab deltas ── */}
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--fm-text-secondary)",
              marginBottom: 8,
            }}
          >
            🧪 Lab markers ({lab_deltas.length})
          </div>
          {lab_deltas.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>
              No follow-up labs to compare yet. Once new lab values are recorded
              (Sessions → quick note with labs, or the lab upload panel), deltas
              will surface here automatically.
            </div>
          )}
          {lab_deltas.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {lab_deltas.map((d, i) => {
                const tone = DIRECTION_TONE[d.direction];
                return (
                  <div
                    key={`${d.marker_name}-${i}`}
                    style={{
                      padding: "8px 10px",
                      background: tone.bg,
                      border: `1px solid ${tone.fg}33`,
                      borderRadius: 6,
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: tone.fg }}>
                        {tone.emoji} {d.marker_name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--fm-text-secondary)", marginTop: 2 }}>
                        <strong>{String(d.baseline_value)}</strong>
                        {d.unit ? ` ${d.unit}` : ""}
                        {" → "}
                        <strong>{String(d.current_value)}</strong>
                        {d.unit ? ` ${d.unit}` : ""}
                        {d.delta_numeric !== null && (
                          <>
                            {" · Δ "}
                            <strong>{fmtDelta(d)}</strong>
                            {d.delta_pct !== null && ` (${fmtPct(d.delta_pct)})`}
                          </>
                        )}
                      </div>
                    </div>
                    <FmChip tone={d.direction === "improving" ? "success" : d.direction === "worsening" ? "danger" : "neutral"}>
                      {tone.label}
                    </FmChip>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Measurement deltas ── */}
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--fm-text-secondary)",
              marginBottom: 8,
            }}
          >
            📏 Measurements ({measurement_deltas.length})
          </div>
          {measurement_deltas.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>
              No follow-up measurements logged yet.
            </div>
          )}
          {measurement_deltas.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {measurement_deltas.map((d) => {
                const tone = DIRECTION_TONE[d.direction];
                const unit = MEAS_UNIT[d.field] || "";
                return (
                  <div
                    key={d.field}
                    style={{
                      padding: "8px 10px",
                      background: tone.bg,
                      border: `1px solid ${tone.fg}33`,
                      borderRadius: 6,
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: tone.fg }}>
                        {tone.emoji} {MEAS_LABEL[d.field] || d.field}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--fm-text-secondary)", marginTop: 2 }}>
                        <strong>{String(d.baseline_value)}</strong>{unit ? ` ${unit}` : ""}
                        {" → "}
                        <strong>{String(d.current_value)}</strong>{unit ? ` ${unit}` : ""}
                        {d.delta_numeric !== null && (
                          <>
                            {" · Δ "}
                            <strong>{fmtDelta(d)}</strong>
                            {unit ? ` ${unit}` : ""}
                          </>
                        )}
                      </div>
                    </div>
                    <FmChip tone={d.direction === "improving" ? "success" : d.direction === "worsening" ? "danger" : "neutral"}>
                      {tone.label}
                    </FmChip>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Presenting symptoms (Phase-1 placeholder) ── */}
        {presenting_symptoms_baseline.length > 0 && (
          <section>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "var(--fm-text-secondary)",
                marginBottom: 8,
              }}
            >
              📋 Symptoms targeted by this plan ({presenting_symptoms_baseline.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {presenting_symptoms_baseline.map((s) => (
                <FmChip key={s} tone="neutral">
                  {s}
                </FmChip>
              ))}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                marginTop: 6,
                fontStyle: "italic",
                lineHeight: 1.5,
              }}
            >
              Phase 1 only lists what this plan was targeting. At follow-up,
              ask explicitly which of these have resolved / improved / are
              unchanged — Phase 2 will join structured symptom logs from
              check-in sessions to auto-classify each.
            </div>
          </section>
        )}
      </div>
    </FmPanel>
  );
}
