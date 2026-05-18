"use client";

/**
 * NasaLeanTestPanel (v0.75.3) — coach-led in-session orthostatic stand
 * test, run on the Zoom call. Captures HR (+ optional BP) at supine, 1,
 * 3, 5, 7, 10 min standing against a wall.
 *
 * Delta-HR ≥ 30 bpm + symptoms = POTS pattern, auto-flagged in result.
 *
 * Saves to client.physical_exam_findings[] with kind="nasa_lean_test".
 * SOAP Objective renders the most recent entry. Trend across sessions
 * preserved for rechecks.
 *
 * Coach UX: collapsed by default (one button on the Overview).
 * Expanded: HR fields + symptom chips + notes + save. Auto-calculates
 * the delta + POTS flag inline.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveExamFindingAction } from "@/lib/server-actions/clients";

interface Props {
  clientId: string;
  /** Pre-fill from intake form's self-check, if the client filled it. */
  selfReportSupineHr?: string;
  selfReportStandingHr?: string;
  selfReportSymptoms?: string[];
  /** Latest saved nasa_lean_test finding, if any — read-only summary. */
  latestSavedAt?: string;
  latestDeltaHr?: number;
  latestPotsFlag?: boolean;
}

const SYMPTOM_OPTIONS = [
  "lightheaded / dizzy",
  "vision tunnelling or going dark",
  "heart racing or pounding",
  "brain fog",
  "hot, flushed, sweaty",
  "cold, clammy",
  "nauseous",
  "had to sit down before 10 min",
  "felt completely fine",
];

interface Reading {
  hr: string;
  bp_sys: string;
  bp_dia: string;
}

const TIMEPOINTS = [
  { key: "supine", label: "Supine 5 min" },
  { key: "min_1", label: "Standing 1 min" },
  { key: "min_3", label: "Standing 3 min" },
  { key: "min_5", label: "Standing 5 min" },
  { key: "min_7", label: "Standing 7 min" },
  { key: "min_10", label: "Standing 10 min" },
];

export function NasaLeanTestPanel({
  clientId,
  selfReportSupineHr,
  selfReportStandingHr,
  selfReportSymptoms,
  latestSavedAt,
  latestDeltaHr,
  latestPotsFlag,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [readings, setReadings] = useState<Record<string, Reading>>(() => {
    const init: Record<string, Reading> = {};
    TIMEPOINTS.forEach((t) => {
      init[t.key] = { hr: "", bp_sys: "", bp_dia: "" };
    });
    if (selfReportSupineHr) init.supine.hr = selfReportSupineHr;
    if (selfReportStandingHr) init.min_10.hr = selfReportStandingHr;
    return init;
  });

  const [symptoms, setSymptoms] = useState<string[]>(selfReportSymptoms ?? []);
  const [notes, setNotes] = useState("");

  // Auto-calc delta-HR + POTS flag
  const { deltaHr, peakStandingHr, supineHr, potsFlag } = useMemo(() => {
    const supine = Number(readings.supine.hr);
    let peak = 0;
    for (const k of ["min_1", "min_3", "min_5", "min_7", "min_10"]) {
      const v = Number(readings[k].hr);
      if (!Number.isNaN(v) && v > peak) peak = v;
    }
    const delta = supine > 0 && peak > 0 ? peak - supine : null;
    const pots = delta != null && delta >= 30;
    return {
      supineHr: supine > 0 ? supine : null,
      peakStandingHr: peak > 0 ? peak : null,
      deltaHr: delta,
      potsFlag: pots,
    };
  }, [readings]);

  const setReading = (key: string, field: keyof Reading, val: string) =>
    setReadings((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: val },
    }));

  const toggleSymptom = (s: string) =>
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const onSave = () => {
    startTransition(async () => {
      const res = await saveExamFindingAction({
        client_id: clientId,
        finding: {
          kind: "nasa_lean_test",
          result: {
            readings,
            symptoms,
            supine_hr: supineHr,
            peak_standing_hr: peakStandingHr,
            delta_hr: deltaHr,
            pots_pattern: potsFlag,
          },
          notes: notes.trim(),
        },
      });
      if (res.ok) {
        toast.success(`✅ NASA lean test saved · ${potsFlag ? "POTS pattern flagged" : "no POTS pattern"}`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Save failed");
      }
    });
  };

  // Collapsed state — small button strip
  if (!open) {
    return (
      <div
        style={{
          padding: "10px 14px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border-light)",
          borderRadius: "var(--fm-radius-md)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 16 }}>🩺</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>NASA lean test</div>
          {latestSavedAt ? (
            <div style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>
              Last: {new Date(latestSavedAt).toLocaleDateString()} ·{" "}
              {latestDeltaHr != null
                ? `ΔHR +${latestDeltaHr} bpm`
                : "no Δ recorded"}
              {latestPotsFlag ? " · POTS pattern" : ""}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
              10-min orthostatic stand test — run on Zoom call
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: "5px 12px",
            fontSize: 11.5,
            fontWeight: 700,
            background: "transparent",
            color: "var(--fm-primary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
          }}
        >
          {latestSavedAt ? "Re-test" : "Start test"}
        </button>
      </div>
    );
  }

  // Expanded state — full test interface
  return (
    <div
      style={{
        padding: 14,
        background: "var(--fm-surface)",
        border: "1.5px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-md)",
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🩺</span>
        <div style={{ fontSize: 13, fontWeight: 700 }}>NASA 10-min lean test</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            marginLeft: "auto",
            padding: "3px 9px",
            fontSize: 11,
            background: "transparent",
            color: "var(--fm-text-secondary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
          }}
        >
          ✕ Close
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)", lineHeight: 1.5 }}>
        Client lies supine 5 min. Note HR + BP. Then stands against a wall —
        heels ~15 cm out, head + shoulders touching, arms relaxed. Take
        readings at 1, 3, 5, 7, 10 min. Delta-HR ≥ 30 bpm + symptoms = POTS.
      </div>

      {/* Pre-filled note from intake */}
      {selfReportSupineHr || selfReportStandingHr ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--fm-text-secondary)",
            padding: "6px 10px",
            background: "rgba(99, 102, 241, 0.08)",
            border: "1px solid rgba(99, 102, 241, 0.25)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          💡 Client self-reported on intake:{" "}
          {selfReportSupineHr ? `supine ${selfReportSupineHr} bpm` : "—"} →{" "}
          {selfReportStandingHr ? `standing ${selfReportStandingHr} bpm` : "—"}
          {selfReportSymptoms && selfReportSymptoms.length > 0
            ? ` · ${selfReportSymptoms.length} symptoms`
            : ""}
        </div>
      ) : null}

      {/* Readings table */}
      <div style={{ display: "grid", gap: 6 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 70px 110px",
            gap: 8,
            fontSize: 10,
            fontWeight: 700,
            color: "var(--fm-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            paddingBottom: 2,
            borderBottom: "1px solid var(--fm-border-light)",
          }}
        >
          <div>Timepoint</div>
          <div>HR (bpm)</div>
          <div>BP (sys/dia)</div>
        </div>
        {TIMEPOINTS.map((t) => (
          <div
            key={t.key}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 70px 110px",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 12 }}>{t.label}</div>
            <input
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={readings[t.key].hr}
              onChange={(e) => setReading(t.key, "hr", e.target.value)}
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="number"
                inputMode="numeric"
                placeholder="sys"
                value={readings[t.key].bp_sys}
                onChange={(e) => setReading(t.key, "bp_sys", e.target.value)}
                style={{ ...inputStyle, width: 48 }}
              />
              <span>/</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="dia"
                value={readings[t.key].bp_dia}
                onChange={(e) => setReading(t.key, "bp_dia", e.target.value)}
                style={{ ...inputStyle, width: 48 }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Delta-HR + POTS flag — auto-calc */}
      <div
        style={{
          padding: "8px 12px",
          background: potsFlag
            ? "rgba(220, 38, 38, 0.08)"
            : deltaHr != null
              ? "rgba(34, 197, 94, 0.08)"
              : "var(--fm-bg-cool)",
          border: `1px solid ${potsFlag ? "#dc2626" : deltaHr != null ? "#86efac" : "var(--fm-border-light)"}`,
          borderRadius: "var(--fm-radius-sm)",
          fontSize: 12,
        }}
      >
        {deltaHr != null ? (
          <>
            <strong>Delta HR: +{deltaHr} bpm</strong> (supine {supineHr} → peak {peakStandingHr})
            {potsFlag && (
              <span style={{ color: "#9a1b1b", fontWeight: 700, marginLeft: 8 }}>
                · ⚠ POTS pattern (Δ ≥ 30 bpm)
              </span>
            )}
          </>
        ) : (
          <span style={{ color: "var(--fm-text-tertiary)" }}>
            Δ-HR + POTS flag auto-calculate as you enter readings.
          </span>
        )}
      </div>

      {/* Symptoms */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-secondary)", marginBottom: 6 }}>
          Symptoms observed during the 10 min
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SYMPTOM_OPTIONS.map((s) => {
            const active = symptoms.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSymptom(s)}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: active ? "var(--fm-primary)" : "transparent",
                  color: active ? "#fff" : "var(--fm-text-secondary)",
                  border: `1px solid ${active ? "var(--fm-primary)" : "var(--fm-border)"}`,
                  borderRadius: 99,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-secondary)", marginBottom: 6 }}>
          Notes (optional)
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Did the test on Oura ring; client sat down at min 8 from dizziness; HR continued to climb."
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: 12,
            fontFamily: "inherit",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-sm)",
            resize: "vertical",
          }}
        />
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={pending || (supineHr == null && peakStandingHr == null)}
        style={{
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 700,
          background: pending ? "#94a3b8" : "var(--fm-primary)",
          color: "#fff",
          border: "none",
          borderRadius: "var(--fm-radius-sm)",
          cursor: pending ? "wait" : "pointer",
          width: "fit-content",
        }}
      >
        {pending ? "Saving…" : "💾 Save assessment"}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  border: "1px solid var(--fm-border-light)",
  borderRadius: "var(--fm-radius-sm)",
  width: "100%",
  boxSizing: "border-box",
};
