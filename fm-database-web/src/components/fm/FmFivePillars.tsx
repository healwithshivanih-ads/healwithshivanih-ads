/**
 * FmFivePillars — sleep / stress / movement / nutrition / connection.
 *
 * Two data sources, merged per-pillar (whichever is newer wins):
 *   1. Session-based `FivePillarsValue` — full check-in form capture
 *      (richer: sleep_hours, days/week for movement, etc.)
 *   2. Per-pillar `DerivedFivePillars` — rolled up from Tier 1 weekly
 *      poll button taps (rating 1-5 + received_at + source).
 *
 * Per-pillar row shows a small "from poll · 2d ago" / "from check-in ·
 * 5d ago" trail so the coach knows what's fresh and where the value came
 * from. Panel header carries a colour-tiered freshness chip computed
 * from the most-recent timestamp across both sources.
 *
 * If no check-in landed within staleAfterDays → amber banner with
 * "Send check-in" CTA. If never captured → empty rows with em-dashes.
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

/** Single entry written by update-derived-pillar.py on every Tier 1
 *  weekly-poll button reply. Lives on client.derived_five_pillars in
 *  client.yaml; one key per pillar. */
export interface DerivedPillarEntry {
  rating?: number | null;       // 1-5 (good=5, partial=3, struggling=2)
  raw?: string | null;          // verbatim button label tapped
  received_at?: string | null;  // ISO
  source?: string | null;       // "weekly_poll" usually
}

export interface DerivedFivePillars {
  sleep?: DerivedPillarEntry | null;
  stress?: DerivedPillarEntry | null;
  movement?: DerivedPillarEntry | null;
  nutrition?: DerivedPillarEntry | null;
  connection?: DerivedPillarEntry | null;
  updated_at?: string | null;   // ISO — newest pillar wrote
}

export interface FmFivePillarsProps {
  /** Most recent five_pillars block from sessions — null if no check-in
   *  form ever captured. */
  latest?: FivePillarsValue | null;
  /** ISO date of `latest` session (for per-row trail + freshness). */
  latestSessionAt?: string | null;
  /** Per-pillar derived snapshot rolled up from weekly poll button
   *  taps. Newer entries beat `latest` on a per-pillar basis. */
  derived?: DerivedFivePillars | null;
  /** Days since the latest check-in (session). Controls stale banner. */
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

type PillarKey = (typeof PILLARS)[number]["key"];

/** "2d", "3wk", "5mo" — terse relative-time for tight panel layouts. */
function relativeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.round(days / 7)}wk`;
  return `${Math.round(days / 30)}mo`;
}

/** Pick the session value for a pillar from FivePillarsValue. Movement
 *  prefers days/wk; the others use 1-5 ratings. */
function sessionValueFor(
  latest: FivePillarsValue | null | undefined,
  key: PillarKey,
): { display: string; unit: string; numeric: number | null } {
  if (!latest) return { display: "—", unit: "", numeric: null };
  switch (key) {
    case "sleep":
      return latest.sleep_hours != null
        ? { display: latest.sleep_hours.toString(), unit: "hr", numeric: latest.sleep_hours }
        : { display: "—", unit: "", numeric: null };
    case "stress":
      return latest.stress_level != null
        ? { display: latest.stress_level.toString(), unit: "/5", numeric: latest.stress_level }
        : { display: "—", unit: "", numeric: null };
    case "movement":
      return latest.movement_days_per_week != null
        ? {
            display: latest.movement_days_per_week.toString(),
            unit: "/7",
            numeric: latest.movement_days_per_week,
          }
        : { display: "—", unit: "", numeric: null };
    case "nutrition":
      return latest.nutrition_quality != null
        ? { display: latest.nutrition_quality.toString(), unit: "/5", numeric: latest.nutrition_quality }
        : { display: "—", unit: "", numeric: null };
    case "connection":
      return latest.connection_quality != null
        ? { display: latest.connection_quality.toString(), unit: "/5", numeric: latest.connection_quality }
        : { display: "—", unit: "", numeric: null };
  }
}

/** Pick the derived value for a pillar. All pillars expose `rating` on
 *  a 1-5 scale (good=5, partial=3, struggling=2). */
function derivedValueFor(
  derived: DerivedFivePillars | null | undefined,
  key: PillarKey,
): { entry: DerivedPillarEntry | null; display: string; unit: string } {
  const entry = derived?.[key] ?? null;
  if (!entry || entry.rating == null) {
    return { entry: null, display: "—", unit: "" };
  }
  return { entry, display: entry.rating.toString(), unit: "/5" };
}

/** Per-pillar merge — whichever data source has the newer timestamp
 *  wins. Returns the resolved value + an attribution trail
 *  ("from poll · 2d" / "from check-in · 5d"). */
function mergedRow(
  key: PillarKey,
  latest: FivePillarsValue | null | undefined,
  latestSessionAt: string | null | undefined,
  derived: DerivedFivePillars | null | undefined,
): {
  display: string;
  unit: string;
  source: "session" | "derived" | "none";
  ageLabel: string;
} {
  const sess = sessionValueFor(latest, key);
  const der = derivedValueFor(derived, key);
  const sessAt = sess.numeric != null ? latestSessionAt ?? null : null;
  const derAt = der.entry?.received_at ?? null;

  // No data either side.
  if (sessAt == null && derAt == null) {
    return { display: "—", unit: "", source: "none", ageLabel: "" };
  }
  // Only one side present.
  if (sessAt && !derAt) {
    return { display: sess.display, unit: sess.unit, source: "session", ageLabel: relativeShort(sessAt) };
  }
  if (derAt && !sessAt) {
    return { display: der.display, unit: der.unit, source: "derived", ageLabel: relativeShort(derAt) };
  }
  // Both present — newer wins.
  if (derAt! > sessAt!) {
    return { display: der.display, unit: der.unit, source: "derived", ageLabel: relativeShort(derAt) };
  }
  return { display: sess.display, unit: sess.unit, source: "session", ageLabel: relativeShort(sessAt) };
}

/** Compute panel-level freshness from the newest timestamp across BOTH
 *  data sources. Returns a colour-tiered chip spec. */
function freshnessChip(
  latestSessionAt: string | null | undefined,
  derived: DerivedFivePillars | null | undefined,
): { label: string; bg: string; fg: string; border: string } | null {
  const candidates: string[] = [];
  if (latestSessionAt) candidates.push(latestSessionAt);
  for (const key of PILLARS.map((p) => p.key) as PillarKey[]) {
    const at = derived?.[key]?.received_at;
    if (at) candidates.push(at);
  }
  if (derived?.updated_at) candidates.push(derived.updated_at);
  if (candidates.length === 0) {
    return {
      label: "Never captured",
      bg: "rgba(0,0,0,0.04)",
      fg: "var(--fm-text-tertiary)",
      border: "var(--fm-border-light)",
    };
  }
  candidates.sort();
  const newest = candidates[candidates.length - 1];
  const days = Math.max(
    0,
    Math.round((Date.now() - new Date(newest).getTime()) / (1000 * 60 * 60 * 24)),
  );
  const age = relativeShort(newest);
  if (days <= 7) {
    return {
      label: `Fresh · ${age}`,
      bg: "rgba(5, 150, 105, 0.10)",
      fg: "#065F46",
      border: "rgba(5, 150, 105, 0.30)",
    };
  }
  if (days <= 21) {
    return {
      label: `Stale · ${age}`,
      bg: "rgba(247, 147, 30, 0.10)",
      fg: "#B8770A",
      border: "rgba(247, 147, 30, 0.30)",
    };
  }
  return {
    label: `Old · ${age}`,
    bg: "rgba(220, 38, 38, 0.08)",
    fg: "#B91C1C",
    border: "rgba(220, 38, 38, 0.30)",
  };
}

const SOURCE_LABEL: Record<"session" | "derived" | "none", string> = {
  session: "from check-in",
  derived: "from poll",
  none: "",
};

export function FmFivePillars({
  latest,
  latestSessionAt,
  derived,
  daysSinceLastEntry,
  staleAfterDays = 7,
  onSendCheckIn,
}: FmFivePillarsProps) {
  // The stale banner is keyed off the SESSION timestamp specifically —
  // because the poll rotation can keep `derived` fresh weekly but a full
  // structured check-in is what the coach is being nudged to schedule.
  const isStale =
    daysSinceLastEntry != null && daysSinceLastEntry >= staleAfterDays;
  // "Empty" only when neither source has any data on file. Previously
  // this checked only `latest` and ignored derived — a client who'd
  // tapped a few poll buttons but never done a structured check-in
  // would show the empty banner even though we DID have data.
  const hasAnyData =
    !!latest ||
    (derived &&
      (PILLARS.some((p) => derived[p.key]?.rating != null) ||
        derived.updated_at));
  const isEmpty = !hasAnyData;
  const chip = freshnessChip(latestSessionAt, derived);

  // Panel title with the freshness chip rendered alongside.
  const titleNode = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      Five pillars
      {chip && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 999,
            background: chip.bg,
            color: chip.fg,
            border: `1px solid ${chip.border}`,
            letterSpacing: 0.2,
            textTransform: "uppercase",
          }}
          title="Newest timestamp across check-in form entries and weekly poll button taps"
        >
          {chip.label}
        </span>
      )}
    </span>
  );

  return (
    <FmPanel title={titleNode}>
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
            Last full check-in <strong>{daysSinceLastEntry} days ago</strong>
            {derived?.updated_at && (
              <> · poll values may still be fresh</>
            )}
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
            No 5-pillars data on file yet
          </div>
          <p
            style={{
              margin: "0 0 10px",
              lineHeight: 1.55,
            }}
          >
            Capture sleep, stress, movement, nutrition + connection in your next check-in
            session, or wait for weekly poll taps to fill in via the rotating Tier 1 send.
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
          const row = mergedRow(p.key, latest, latestSessionAt, derived);
          const trail =
            row.source !== "none" && row.ageLabel
              ? `${SOURCE_LABEL[row.source]} · ${row.ageLabel}`
              : "";
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
                  flexDirection: "column",
                  gap: 1,
                  color: "var(--fm-text-secondary)",
                  fontWeight: 600,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{p.icon}</span>
                  {p.name}
                </span>
                {trail && (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 500,
                      color: "var(--fm-text-tertiary)",
                      letterSpacing: 0.1,
                      marginLeft: 22,
                    }}
                  >
                    {trail}
                  </span>
                )}
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: row.display === "—" ? "var(--fm-text-tertiary)" : "var(--fm-text-primary)",
                    fontFamily: "var(--fm-font-mono)",
                  }}
                >
                  {row.display}
                  {row.unit && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: "var(--fm-text-tertiary)",
                        marginLeft: 2,
                      }}
                    >
                      {row.unit}
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
          Each row uses the newest value across full check-ins + Tier 1 weekly poll taps.
        </p>
      )}
    </FmPanel>
  );
}
