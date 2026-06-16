/**
 * WeightLossReadinessPanel (#4) — the "who you should promise loss to" gate.
 *
 * Server component (display only) on Overview → Weight loss, above the
 * progress/goal cards. Surfaces the metabolic/hormonal blockers that make a
 * calorie deficit fail — under-optimised thyroid, insulin resistance,
 * weight-gain meds, cortisol/sleep load, perimenopause — so the coach sets
 * honest expectations and sequences root-cause work before promising loss.
 *
 * Coaching scope: flags + refers, never diagnoses or changes a prescription.
 */

import { FmCallout } from "@/components/fm/FmCallout";
import { assessWeightLossReadiness } from "@/lib/fmdb/weight-loss-readiness";
import type { ReadinessSeverity } from "@/lib/fmdb/weight-loss-readiness";

const VERDICT_META = {
  address_first: { tone: "danger", icon: "🛑", label: "Address blockers first" },
  caution: { tone: "warning", icon: "⚠️", label: "Proceed with caution" },
  ready: { tone: "success", icon: "✅", label: "No major blockers on file" },
} as const;

const DOT: Record<ReadinessSeverity, string> = {
  high: "var(--fm-danger)",
  med: "var(--fm-warning)",
  info: "var(--fm-secondary)",
};

export function WeightLossReadinessPanel({
  client,
}: {
  // The full client record (RSC passes it straight through).
  client: Parameters<typeof assessWeightLossReadiness>[0];
}) {
  const r = assessWeightLossReadiness(client);
  const meta = VERDICT_META[r.verdict];

  return (
    <FmCallout tone={meta.tone} icon={meta.icon} title={`Weight-loss readiness · ${meta.label}`}>
      {r.flags.length === 0 ? (
        <div>
          No thyroid / insulin / medication / sleep blockers detected on file. A deficit is a
          reasonable lever here — still lead with protein + strength.
        </div>
      ) : (
        <ul style={{ margin: "2px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 7 }}>
          {r.flags.map((f) => (
            <li key={f.key} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span
                aria-hidden
                style={{
                  marginTop: 5,
                  flexShrink: 0,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: DOT[f.severity],
                }}
              />
              <span>
                <strong style={{ color: "var(--fm-text-primary)" }}>{f.label}</strong>
                <span style={{ color: "var(--fm-text-secondary)" }}> — {f.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(r.considered.length > 0 || r.missing.length > 0) && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--fm-text-tertiary)" }}>
          {r.considered.length > 0 && <>Checked: {r.considered.join(", ")}. </>}
          {r.missing.length > 0 && <>Not on file: {r.missing.join(", ")}.</>}
        </div>
      )}
    </FmCallout>
  );
}
