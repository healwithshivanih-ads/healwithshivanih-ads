"use client";

/**
 * GateFindingsPanel — surfaces author-gate findings (fmdb/assess/author_gate.py)
 * on the Full Assessment results.
 *
 * The gate ran on every synthesis long before anything rendered it, so its
 * findings were computed, returned to the browser and silently dropped. This
 * panel is the missing surface.
 *
 * Tone is driven by which ARRAY a finding came from, not by reading
 * finding.severity — the gate's severities are "HARD"/"WARN", which does not
 * match the critical/warning/info vocabulary the rest of the AI surfaces use,
 * and a shared tone map keyed on the wrong words fails silently (everything
 * renders as "info").
 */
import { FmPanel } from "@/components/fm";

export interface GateFinding {
  severity: string;
  section: string;
  code: string;
  message: string;
  /** The offending slug / test name. The gate emits "" (not undefined) when absent. */
  target?: string;
}

export interface GateReport {
  ok: boolean;
  hard_failures: GateFinding[];
  warnings: GateFinding[];
}

interface Props {
  gate?: GateReport | null;
}

const HARD_TONE = { bg: "rgba(239, 68, 68, 0.10)", color: "#b91c1c", emoji: "✗" };
const WARN_TONE = { bg: "rgba(245, 158, 11, 0.10)", color: "#92400e", emoji: "⚠" };

export function GateFindingsPanel({ gate }: Props) {
  const hardFailures = gate?.hard_failures ?? [];
  const warnings = gate?.warnings ?? [];

  if (hardFailures.length === 0 && warnings.length === 0) return null;

  return (
    <FmPanel
      title="🚦 Safety checks on this assessment"
      subtitle={
        hardFailures.length > 0
          ? "Anything under “Blocked” stopped this assessment from being saved — fix it and run the analysis again. Anything under “Worth a look” did save, but read it before you act on the suggestions below."
          : "These checks passed, with notes. Nothing was blocked — the assessment saved. Read these before you act on the suggestions below."
      }
      rightSlot={
        <div style={{ display: "inline-flex", gap: 8 }}>
          {hardFailures.length > 0 && (
            <span style={countChip(HARD_TONE)}>
              ✗ {hardFailures.length} blocked
            </span>
          )}
          {warnings.length > 0 && (
            <span style={countChip(WARN_TONE)}>
              ⚠ {warnings.length} to review
            </span>
          )}
        </div>
      }
      style={{ marginBottom: 12 }}
    >
      <div style={{ display: "grid", gap: 14 }}>
        {hardFailures.length > 0 && (
          <section>
            <h4 style={sectionTitle()}>
              ✗ Blocked — fix these and re-run the analysis
            </h4>
            <div style={{ display: "grid", gap: 6 }}>
              {hardFailures.map((f, i) => (
                <FindingRow key={`hard-${i}`} finding={f} tone={HARD_TONE} />
              ))}
            </div>
          </section>
        )}

        {warnings.length > 0 && (
          <section>
            <h4 style={sectionTitle()}>
              ⚠ Worth a look — saved, but check these before you build the plan
            </h4>
            <div style={{ display: "grid", gap: 6 }}>
              {warnings.map((f, i) => (
                <FindingRow key={`warn-${i}`} finding={f} tone={WARN_TONE} />
              ))}
            </div>
          </section>
        )}
      </div>
    </FmPanel>
  );
}

function FindingRow({
  finding,
  tone,
}: {
  finding: GateFinding;
  tone: { bg: string; color: string; emoji: string };
}) {
  return (
    <div
      style={{
        fontSize: 12,
        padding: "6px 9px",
        background: tone.bg,
        color: tone.color,
        borderRadius: "var(--fm-radius-sm)",
        lineHeight: 1.45,
      }}
    >
      <strong>
        {tone.emoji} {finding.section}.{finding.code}
      </strong>
      {finding.target && (
        <code
          style={{
            marginLeft: 6,
            fontSize: 10,
            opacity: 0.75,
            fontFamily: "var(--fm-font-mono)",
          }}
        >
          {finding.target}
        </code>
      )}
      <div style={{ marginTop: 2 }}>{finding.message}</div>
    </div>
  );
}

function sectionTitle(): React.CSSProperties {
  return {
    margin: "0 0 6px",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-tertiary)",
  };
}

function countChip(tone: { bg: string; color: string }): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 7px",
    background: tone.bg,
    color: tone.color,
    borderRadius: "var(--fm-radius-pill)",
  };
}
