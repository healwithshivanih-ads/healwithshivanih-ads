/**
 * AIReadCard — what the AI thinks about THIS plan for THIS client.
 *
 * Pulls together three AI surfaces so the coach sees them at-a-glance
 * when about to approve/edit a plan:
 *
 *   1. Top likely drivers from the latest assessment session
 *   2. ai_sanity_check.concerns on the plan (if a check has been run)
 *   3. Active rework_suggestion on the client (if any)
 *
 * Each surface is collapsible. If all three are empty, the whole card
 * still renders with a "no AI activity yet — run a sanity check" CTA so
 * the coach knows where the AI input lives.
 */
import Link from "next/link";

interface SanityConcern {
  severity?: "critical" | "warning" | "info" | string;
  category?: string;
  message?: string;
  where?: string;
  suggested_fix?: string;
}

interface LikelyDriver {
  mechanism_slug?: string;
  mechanism?: string;
  name?: string;
  confidence?: number;
  rank?: number;
  reasoning?: string;
}

interface ReworkSuggestion {
  generated_at?: string;
  triggered_by?: string;
  benefit_pct?: number;
  confidence?: "low" | "medium" | "high" | string;
  rationale?: string;
  suggested_changes?: Array<{
    op?: string;
    target_kind?: string;
    target_slug?: string | null;
    description?: string;
    reason?: string;
  }>;
  dismissed_at?: string;
  applied_at?: string;
  applied_to_plan?: string;
}

interface Props {
  planSlug: string;
  clientId?: string;
  /** From plan.ai_sanity_check */
  sanityCheck?: {
    overall_assessment?: string;
    coherence_score?: number;
    client_fit_score?: number;
    concerns?: SanityConcern[];
  } | null;
  /** From latest session's ai_analysis.likely_drivers (max 3 surfaced) */
  topDrivers?: LikelyDriver[];
  /** From client.rework_suggestion */
  reworkSuggestion?: ReworkSuggestion | null;
}

const SEVERITY_TONE: Record<string, { bg: string; color: string; emoji: string }> = {
  critical: { bg: "rgba(239, 68, 68, 0.10)",   color: "#b91c1c", emoji: "🔴" },
  warning:  { bg: "rgba(245, 158, 11, 0.10)",  color: "#92400e", emoji: "🟡" },
  info:     { bg: "rgba(46, 110, 213, 0.08)",  color: "#1d4ed8", emoji: "🔵" },
};


export function AIReadCard({
  planSlug,
  clientId,
  sanityCheck,
  topDrivers,
  reworkSuggestion,
}: Props) {
  const hasDrivers = (topDrivers?.length ?? 0) > 0;
  const concerns = sanityCheck?.concerns ?? [];
  const hasConcerns = concerns.length > 0;
  const hasRework =
    reworkSuggestion != null &&
    !reworkSuggestion.applied_at &&
    !reworkSuggestion.dismissed_at &&
    (reworkSuggestion.benefit_pct ?? 0) > 0 &&
    (reworkSuggestion.suggested_changes?.length ?? 0) > 0;

  const concernCounts = {
    critical: concerns.filter((c) => c.severity === "critical").length,
    warning:  concerns.filter((c) => c.severity === "warning").length,
    info:     concerns.filter((c) => c.severity === "info").length,
  };

  return (
    <details
      open={hasConcerns || hasRework}
      style={{
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-md)",
        padding: "12px 16px",
        marginBottom: 12,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontWeight: 700,
          fontSize: 14,
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span>🧠 AI&apos;s read on this client + plan</span>
        {/* Inline summary chips */}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
          {hasDrivers && (
            <span style={summaryChip("info")}>
              🩺 {topDrivers!.length} driver{topDrivers!.length === 1 ? "" : "s"}
            </span>
          )}
          {concernCounts.critical > 0 && (
            <span style={summaryChip("critical")}>
              🔴 {concernCounts.critical} critical
            </span>
          )}
          {concernCounts.warning > 0 && (
            <span style={summaryChip("warning")}>
              🟡 {concernCounts.warning} warning
            </span>
          )}
          {hasRework && (
            <span style={summaryChip("warning")}>
              🔄 rework {reworkSuggestion.benefit_pct}%
            </span>
          )}
          {!hasDrivers && !hasConcerns && !hasRework && (
            <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
              no AI activity yet
            </span>
          )}
        </span>
      </summary>

      <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
        {/* DRIVERS */}
        {hasDrivers && (
          <section>
            <h4 style={sectionTitle()}>🩺 Top drivers (from latest assessment)</h4>
            <ol style={{ margin: 0, paddingLeft: 22, fontSize: 12, lineHeight: 1.55 }}>
              {topDrivers!.slice(0, 3).map((d, i) => {
                const label =
                  d.mechanism_slug ??
                  d.mechanism ??
                  d.name ??
                  `driver ${i + 1}`;
                return (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <strong>{label}</strong>
                    {d.confidence != null && (
                      <span style={{ color: "var(--fm-text-tertiary)", marginLeft: 6 }}>
                        ({d.confidence}% confidence)
                      </span>
                    )}
                    {d.reasoning && (
                      <div style={{ color: "var(--fm-text-secondary)", marginTop: 2 }}>
                        {d.reasoning.slice(0, 180)}
                        {d.reasoning.length > 180 ? "…" : ""}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* SANITY CHECK */}
        {hasConcerns ? (
          <section>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <h4 style={sectionTitle()}>⚖ AI plan-check concerns</h4>
              {sanityCheck?.coherence_score != null && (
                <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                  coherence {sanityCheck.coherence_score}/5 · client-fit{" "}
                  {sanityCheck.client_fit_score}/5
                </span>
              )}
            </div>
            {sanityCheck?.overall_assessment && (
              <p
                style={{
                  margin: "4px 0 8px",
                  fontSize: 12,
                  color: "var(--fm-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {sanityCheck.overall_assessment}
              </p>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              {concerns.slice(0, 6).map((c, i) => {
                const tone = SEVERITY_TONE[c.severity ?? "info"] ?? SEVERITY_TONE.info;
                return (
                  <div
                    key={i}
                    style={{
                      fontSize: 12,
                      padding: "6px 9px",
                      background: tone.bg,
                      color: tone.color,
                      borderRadius: "var(--fm-radius-sm)",
                      lineHeight: 1.45,
                    }}
                  >
                    <strong>{tone.emoji} {c.category}</strong>
                    {c.where && (
                      <code
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          opacity: 0.75,
                          fontFamily: "var(--fm-font-mono)",
                        }}
                      >
                        {c.where}
                      </code>
                    )}
                    <div style={{ marginTop: 2 }}>{c.message}</div>
                    {c.suggested_fix && (
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 11,
                          opacity: 0.85,
                        }}
                      >
                        💡 {c.suggested_fix}
                      </div>
                    )}
                  </div>
                );
              })}
              {concerns.length > 6 && (
                <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                  + {concerns.length - 6} more concern{concerns.length - 6 === 1 ? "" : "s"}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section>
            <h4 style={sectionTitle()}>⚖ AI plan-check</h4>
            <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", margin: 0 }}>
              No AI sanity check has been run yet for this plan. Run it from
              the right-rail plan-check panel — it surfaces coherence /
              client-fit / sequencing / regional-availability concerns the
              deterministic check can&apos;t catch.
            </p>
          </section>
        )}

        {/* REWORK SUGGESTION */}
        {hasRework && (
          <section>
            <h4 style={sectionTitle()}>🔄 Active rework suggestion</h4>
            <div
              style={{
                background: "rgba(245, 158, 11, 0.08)",
                border: "1px solid rgba(245, 158, 11, 0.30)",
                borderRadius: "var(--fm-radius-sm)",
                padding: "10px 12px",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <strong>
                  {reworkSuggestion.benefit_pct}% estimated benefit
                </strong>
                <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                  · {reworkSuggestion.confidence} confidence · triggered by{" "}
                  {reworkSuggestion.triggered_by}
                </span>
              </div>
              {reworkSuggestion.rationale && (
                <p style={{ margin: "6px 0 6px", color: "var(--fm-text-secondary)" }}>
                  {reworkSuggestion.rationale}
                </p>
              )}
              <p style={{ margin: 0, fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                {reworkSuggestion.suggested_changes?.length ?? 0} proposed changes — apply
                from the client overview&apos;s rework banner.
                {clientId && (
                  <>
                    {" "}
                    <Link
                      href={`/clients-v2/${clientId}`}
                      style={{ color: "var(--fm-primary)" }}
                    >
                      Open overview →
                    </Link>
                  </>
                )}
              </p>
            </div>
          </section>
        )}
      </div>

      <input type="hidden" data-plan-slug={planSlug} />
    </details>
  );
}

function sectionTitle(): React.CSSProperties {
  return {
    margin: 0,
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-tertiary)",
  };
}

function summaryChip(kind: "critical" | "warning" | "info"): React.CSSProperties {
  const tone = SEVERITY_TONE[kind];
  return {
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 7px",
    background: tone.bg,
    color: tone.color,
    borderRadius: "var(--fm-radius-pill)",
  };
}
