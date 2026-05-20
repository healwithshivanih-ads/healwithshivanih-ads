/**
 * FmFivePillars — sleep / stress / movement / nutrition / connection.
 *
 * If a check-in landed this week → values + target rows.
 * If no entry in N+ days → stale banner with "Send check-in" CTA (design 1F).
 * If never captured → empty rows with em-dashes.
 */
import { FmPanel } from "./FmPanel";

export interface FivePillarsValue {
  /** sleep hours per night */
  sleep_hours?: number | null;
  /** sleep quality 1-5 */
  sleep_quality?: number | null;
  /** stress 1-5 (higher = more stress) */
  stress_level?: number | null;
  /** movement days per week 0-7 */
  movement_days_per_week?: number | null;
  /** nutrition 1-5 */
  nutrition_quality?: number | null;
  /** connection 1-5 */
  connection_quality?: number | null;
}

export interface FmFivePillarsProps {
  /** Most recent five_pillars block — null if no check-in ever. */
  latest?: FivePillarsValue | null;
  /** Days since the latest check-in — controls the stale banner. */
  daysSinceLastEntry?: number | null;
  /** Stale threshold; default 7 days. */
  staleAfterDays?: number;
  /** "Send check-in" handler (opens templates panel pre-filtered). */
  onSendCheckIn?: () => void;
}

const PILLARS = [
  { key: "sleep", name: "Sleep", icon: "😴", target: "7–9 hr/night" },
  { key: "stress", name: "Stress", icon: "🌊", target: "<5/10" },
  { key: "movement", name: "Movement", icon: "🏃", target: "5+ days/wk" },
  { key: "nutrition", name: "Nutrition", icon: "🥗", target: "≥7/10" },
  { key: "connection", name: "Connection", icon: "💞", target: "≥7/10" },
] as const;

function valueFor(latest: FivePillarsValue | null | undefined, key: string): { v: string; u: string } {
  if (!latest) return { v: "—", u: "" };
  switch (key) {
    case "sleep":
      return latest.sleep_hours != null
        ? { v: latest.sleep_hours.toString(), u: "hr" }
        : { v: "—", u: "" };
    case "stress":
      return latest.stress_level != null
        ? { v: latest.stress_level.toString(), u: "/5" }
        : { v: "—", u: "" };
    case "movement":
      return latest.movement_days_per_week != null
        ? { v: latest.movement_days_per_week.toString(), u: "/7" }
        : { v: "—", u: "" };
    case "nutrition":
      return latest.nutrition_quality != null
        ? { v: latest.nutrition_quality.toString(), u: "/5" }
        : { v: "—", u: "" };
    case "connection":
      return latest.connection_quality != null
        ? { v: latest.connection_quality.toString(), u: "/5" }
        : { v: "—", u: "" };
    default:
      return { v: "—", u: "" };
  }
}

export function FmFivePillars({
  latest,
  daysSinceLastEntry,
  staleAfterDays = 7,
  onSendCheckIn,
}: FmFivePillarsProps) {
  const isStale =
    daysSinceLastEntry != null && daysSinceLastEntry >= staleAfterDays;
  const isEmpty = !latest;

  return (
    <FmPanel title="Five pillars (this week)">
      {isStale && !isEmpty && (
        <div
          style={{
            padding: "10px 12px",
            background: "rgba(247, 147, 30, 0.08)",
            border: "1px solid rgba(247, 147, 30, 0.25)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            color: "#B8770A",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span>⏳</span>
          <span>
            Last entry <strong>{daysSinceLastEntry} days ago</strong> · check-in due
          </span>
          {onSendCheckIn && (
            <button
              type="button"
              onClick={onSendCheckIn}
              title="Opens templates panel pre-filtered to check-in templates — coach picks one and confirms before sending"
              style={{
                marginLeft: "auto",
                background: "var(--fm-warning)",
                border: 0,
                color: "#fff",
                padding: "5px 11px",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: "var(--fm-radius-sm)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Send check-in
            </button>
          )}
        </div>
      )}

      {isEmpty && (
        <div
          style={{
            padding: "12px 14px",
            background: "var(--fm-bg-warm)",
            border: "1.5px dashed var(--fm-primary)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 4 }}>🌿</div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--fm-text-primary)",
              marginBottom: 4,
            }}
          >
            No 5-pillars check-in on file yet
          </div>
          <p
            style={{
              margin: "0 0 10px",
              lineHeight: 1.55,
            }}
          >
            Capture sleep, stress, movement, nutrition + connection in your next check-in
            session, or ask the client to fill them in via WhatsApp.
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {onSendCheckIn && (
              <button
                type="button"
                onClick={onSendCheckIn}
                title="Opens templates panel pre-filtered to check-in templates"
                style={{
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border)",
                  color: "var(--fm-text-primary)",
                  padding: "5px 11px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                💬 Ask client via WhatsApp
              </button>
            )}
            <a
              href={onSendCheckIn ? "#capture-checkin" : "#"}
              onClick={(e) => {
                // Routes to the existing Analyse / Check-in form. Bridge
                // component (in pages that use this primitive) can override
                // by passing onSendCheckIn that does the routing instead.
                e.preventDefault();
                onSendCheckIn?.();
              }}
              style={{
                background: "var(--fm-primary)",
                color: "#fff",
                padding: "5px 11px",
                fontSize: 12,
                fontWeight: 700,
                borderRadius: "var(--fm-radius-sm)",
                textDecoration: "none",
              }}
            >
              📝 Capture from check-in
            </a>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 4 }}>
        {PILLARS.map((p) => {
          const { v, u } = valueFor(latest, p.key);
          return (
            <div
              key={p.key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 13,
                padding: "5px 0",
                borderBottom: "1px dashed var(--fm-border-light)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--fm-text-secondary)",
                  fontWeight: 600,
                }}
              >
                <span style={{ fontSize: 14 }}>{p.icon}</span>
                {p.name}
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: v === "—" ? "var(--fm-text-tertiary)" : "var(--fm-text-primary)",
                    fontFamily: "var(--fm-font-mono)",
                  }}
                >
                  {v}
                  {u && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: "var(--fm-text-tertiary)",
                        marginLeft: 2,
                      }}
                    >
                      {u}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)" }}>
                  target {p.target}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {!isStale && !isEmpty && (
        <p
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            fontStyle: "italic",
          }}
        >
          Tiles show the latest entry until a fresh value lands.
        </p>
      )}
    </FmPanel>
  );
}
