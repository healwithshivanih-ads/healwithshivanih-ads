/**
 * FmDepletionBanner — surfaces drug-nutrient depletion warnings on the
 * Overview tab above the FM markers panel (design 8A).
 *
 * One row per medication that matches a catalogue depletion entity. Each
 * row shows: drug · severity dot · depleted nutrients · "jump to labs"
 * action. Inline-in-plan-editor variant (8B) is a separate component.
 */
import { FmPanel } from "./FmPanel";

export interface DepletionRow {
  /** Display name of the matched medication (e.g. "Levothyroxine 50 mcg"). */
  drug: string;
  /** Nutrient names depleted by this drug (e.g. ["Selenium", "Iron"]). */
  nutrients: string[];
  /** Severity: "watch" = soft amber; "flag" = red. */
  severity: "watch" | "flag";
  /** Optional click handler to highlight the affected markers below. */
  onJumpToLabs?: () => void;
}

export interface FmDepletionBannerProps {
  rows: DepletionRow[];
  /** Click "Open in Plan" — routes to the Plan editor. */
  onOpenInPlan?: () => void;
}

export function FmDepletionBanner({ rows, onOpenInPlan }: FmDepletionBannerProps) {
  if (rows.length === 0) return null;

  return (
    <FmPanel
      style={{
        padding: "12px 16px",
        background: "linear-gradient(135deg, rgba(243,156,18,0.10), rgba(247,147,30,0.06))",
        borderColor: "rgba(243,156,18,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>💊</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#8a5a08", marginBottom: 2 }}>
            {rows.length} medication{rows.length === 1 ? "" : "s"} may deplete nutrients
            <span
              style={{
                fontSize: 9.5,
                marginLeft: 8,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(0,0,0,0.06)",
                color: "#B8770A",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              catalogue
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)" }}>
            Check matching labs before drafting the supplement plan.
          </div>
        </div>
        {onOpenInPlan && (
          <button
            type="button"
            onClick={onOpenInPlan}
            style={{
              background: "#B8770A",
              color: "#fff",
              border: 0,
              padding: "6px 12px",
              fontSize: 11.5,
              fontWeight: 700,
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            Open in Plan →
          </button>
        )}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              padding: "8px 12px",
              background: "var(--fm-surface)",
              borderRadius: "var(--fm-radius-sm)",
              border: "1px solid var(--fm-border-light)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 11.5,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: r.severity === "flag" ? "var(--fm-danger)" : "#B8770A",
                flexShrink: 0,
              }}
            />
            <span style={{ fontWeight: 700, minWidth: 140 }}>{r.drug}</span>
            <span style={{ color: "var(--fm-text-tertiary)", fontSize: 10 }}>depletes</span>
            <span style={{ color: "var(--fm-text-secondary)", flex: 1, fontWeight: 500 }}>
              {r.nutrients.join(" · ")}
            </span>
            {r.onJumpToLabs && (
              <button
                type="button"
                onClick={r.onJumpToLabs}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "var(--fm-text-tertiary)",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: 0,
                  fontFamily: "inherit",
                }}
              >
                jump to labs →
              </button>
            )}
          </div>
        ))}
      </div>
    </FmPanel>
  );
}
