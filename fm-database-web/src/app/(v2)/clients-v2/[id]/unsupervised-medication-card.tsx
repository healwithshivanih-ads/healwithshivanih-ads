/**
 * UnsupervisedMedicationCard — coach-side safety flash on the Overview when the
 * intake shows a dependence-forming psychoactive medication being taken with no
 * clinical supervision.
 *
 * Built after Shweta (cl-906, 2026-09-21): twenty years of unprescribed
 * alprazolam, with BOTH halves of the evidence sitting in her submitted intake
 * (`psych_medications` + `current_mental_health_care: "No"`). Nothing joined
 * them, and it surfaced only because the coach happened to mention it.
 *
 * Deliberately NOT dismissible. Every other card on this page is a prompt; this
 * one is a standing constraint on what is safe to author, and it stays true for
 * as long as the medication does. A coach who dismisses it once would lose it
 * for every future plan, letter and check-in written for that client.
 *
 * Server component — the detector is pure and there is nothing to interact with.
 */

import { FmPanel, FmChip } from "@/components/fm";
import type { UnsupervisedMedicationAdvisory } from "@/lib/fmdb/unsupervised-medication";

interface Props {
  advisory: UnsupervisedMedicationAdvisory | null;
}

export function UnsupervisedMedicationCard({ advisory }: Props) {
  if (!advisory) return null;
  const critical = advisory.severity === "critical";
  const accent = critical ? "#9f1239" : "#b45309";
  const wash = critical ? "#fff1f2" : "#fffbeb";
  const edge = critical ? "#fecdd3" : "#fde68a";

  return (
    <FmPanel
      title={`${critical ? "🚨" : "⚠️"} Medication safety — read before authoring`}
      subtitle={advisory.headline}
    >
      <div
        style={{
          background: wash,
          border: `1px solid ${edge}`,
          borderRadius: 10,
          padding: "12px 14px",
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          {advisory.findings.map((f, i) => (
            <div key={i} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <FmChip>{f.drugClass}</FmChip>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: accent }}>{f.reported}</span>
                <span style={{ fontSize: 11, color: "#6f6a5d" }}>· {f.sourceField}</span>
              </div>
              {f.withdrawalEvidence && (
                <div style={{ fontSize: 12.5, color: "#6f6a5d", fontStyle: "italic", paddingLeft: 2 }}>
                  Their words: “{f.withdrawalEvidence}”
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${edge}`, paddingTop: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.4, color: accent, fontWeight: 700, marginBottom: 6 }}>
            WHAT FOLLOWS FROM THIS
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
            {advisory.actions.map((a, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink, #2b2d42)" }}>
                {a}
              </li>
            ))}
          </ol>
        </div>

        <div style={{ fontSize: 11.5, color: "#6f6a5d", lineHeight: 1.4 }}>
          Flagged because the intake records a medication in this class alongside
          “no current mental health care”. If that is out of date, correct the
          client record rather than working around this card.
        </div>
      </div>
    </FmPanel>
  );
}
