"use client";

/**
 * Pre-test answers for one blood draw — the coach records what the client did
 * in the days before (illness, paracetamol, hard exercise, biotin…). The lab
 * engine (fm-database/fmdb/assess/lab_confounders.py) lowers confidence on the
 * markers each answer distorts. Every question is optional: "—" = not known.
 *
 * Mirrors fmdb.plan.models.LabPretest (extra="forbid"); keep the two in step.
 */
import type { HormoneRoute, LabPretest } from "@/lib/fmdb/types";

type BoolKey =
  | "illness_3w"
  | "paracetamol_48h"
  | "alcohol_48h"
  | "hard_exercise_72h"
  | "biotin_72h"
  | "high_dose_vitamin_d"
  | "creatine"
  | "fasted";

const QUESTIONS: Array<{ key: BoolKey; label: string; hint: string }> = [
  { key: "illness_3w", label: "Ill in the 3 weeks before?", hint: "cold, flu, fever, infection, vaccine" },
  { key: "paracetamol_48h", label: "Paracetamol in the 48 h before?", hint: "raises ALT/AST" },
  { key: "alcohol_48h", label: "Alcohol in the 48 h before?", hint: "raises GGT, TG" },
  { key: "hard_exercise_72h", label: "Hard exercise in the 72 h before?", hint: "weights, long run — ALT/AST/CK" },
  { key: "biotin_72h", label: "Biotin in the 72 h before?", hint: "hair/skin/nail, B-complex — thyroid tests" },
  { key: "high_dose_vitamin_d", label: "High-dose vitamin D?", hint: "weekly 60k sachets, bolus" },
  { key: "creatine", label: "Taking creatine?", hint: "raises creatinine, lowers eGFR" },
  { key: "fasted", label: "Fasted 8-12 h?", hint: "glucose, insulin, TG" },
];

const ROUTES: Array<{ value: HormoneRoute | ""; label: string }> = [
  { value: "", label: "—" },
  { value: "none", label: "None" },
  { value: "oral_estrogen", label: "Oral oestrogen (HRT pill)" },
  { value: "ocp", label: "Combined pill (OCP)" },
  { value: "transdermal_estrogen", label: "Transdermal oestrogen (gel/patch)" },
  { value: "vaginal_estrogen", label: "Vaginal oestrogen" },
  { value: "progestogen_only", label: "Progestogen only" },
  { value: "other", label: "Other" },
];

const field: React.CSSProperties = {
  fontSize: 12,
  border: "1px solid var(--fm-border, #d0d5dd)",
  borderRadius: 6,
  padding: "3px 6px",
  background: "white",
};

export function LabPretestForm({
  value,
  onChange,
  disabled = false,
}: {
  value: LabPretest;
  onChange: (next: LabPretest) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<LabPretest>) => {
    const next: LabPretest = { ...value, ...patch };
    // Drop unknowns so the stored block only holds real answers.
    for (const k of Object.keys(next) as Array<keyof LabPretest>) {
      if (next[k] === undefined || next[k] === "") delete next[k];
    }
    onChange(next);
  };

  return (
    <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
          gap: "4px 14px",
        }}
      >
        {QUESTIONS.map((q) => (
          <label key={q.key} style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
            <span title={q.hint}>
              {q.label} <span style={{ color: "#667085" }}>({q.hint})</span>
            </span>
            <select
              aria-label={q.label}
              style={field}
              disabled={disabled}
              value={value[q.key] === true ? "yes" : value[q.key] === false ? "no" : ""}
              onChange={(e) =>
                set({ [q.key]: e.target.value === "yes" ? true : e.target.value === "no" ? false : undefined })
              }
            >
              <option value="">—</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        ))}
      </div>

      {value.illness_3w && (
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          What and when?
          <input
            style={{ ...field, flex: 1 }}
            disabled={disabled}
            placeholder="e.g. cold, 10 days before"
            value={value.illness_note ?? ""}
            onChange={(e) => set({ illness_note: e.target.value })}
          />
        </label>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Hormones
          <select
            aria-label="Hormone route"
            style={field}
            disabled={disabled}
            value={value.hormone_route ?? ""}
            onChange={(e) => set({ hormone_route: (e.target.value || undefined) as HormoneRoute | undefined })}
          >
            {ROUTES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Cycle day
          <input
            type="number"
            min={1}
            max={60}
            aria-label="Cycle day"
            style={{ ...field, width: 60 }}
            disabled={disabled || value.no_cycle === true}
            value={value.cycle_day ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set({ cycle_day: Number.isFinite(n) && n >= 1 && n <= 60 ? n : undefined });
            }}
          />
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.no_cycle === true}
            onChange={(e) => set({ no_cycle: e.target.checked ? true : undefined, cycle_day: undefined })}
          />
          No cycle (post-menopause / n.a.)
        </label>
      </div>
    </div>
  );
}
