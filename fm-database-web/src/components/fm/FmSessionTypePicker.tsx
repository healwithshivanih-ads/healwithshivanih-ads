"use client";

/**
 * FmSessionTypePicker — Phase 3 / design C1.
 *
 * 5 cards in a row, each tinted with its semantic colour. Selected card
 * glows with its tint; CTA inherits the colour so the coach reads action
 * without reading text. The "produces" hint per card locks each session
 * type to its downstream artifact.
 *
 * Dense mode (used inline above a form once a type is picked) shows a
 * compact horizontal pill bar instead of full cards.
 */
import Link from "next/link";

export const FM_SESSION_TYPES = [
  {
    id: "discovery",
    icon: "🔍",
    label: "Discovery",
    duration: "15 min",
    produces: "Fit assessment + lab order",
    tint: "#B8770A",
  },
  {
    id: "intake",
    icon: "📋",
    label: "Intake",
    duration: "60 min",
    produces: "Full medical history on file",
    tint: "#3a4250",
  },
  {
    id: "full",
    icon: "🔬",
    label: "Full assessment",
    duration: "90 min",
    produces: "AI synthesis → root causes + plan",
    tint: "#5a3fb0",
  },
  {
    id: "checkin",
    icon: "💬",
    label: "Check-in",
    duration: "30 min",
    produces: "Adherence + measurements + tweaks",
    tint: "#1E8449",
  },
  {
    id: "quick",
    icon: "📌",
    label: "Quick note",
    duration: "<1 min",
    produces: "Single-thread observation on record",
    tint: "#004E89",
  },
] as const;

export type FmSessionTypeId = (typeof FM_SESSION_TYPES)[number]["id"];

export interface FmSessionTypePickerProps {
  /** Currently selected type, if any. */
  selectedId?: FmSessionTypeId | null;
  /** Compact horizontal pills (inline above a form) vs full cards. */
  dense?: boolean;
  /** Card click handler. Receives the selected type. */
  onSelect?: (id: FmSessionTypeId) => void;
  /** Optional href per card — if provided, cards render as Next Links.
   *  Use a map (not a function) so Server Components can pass it through
   *  to this Client primitive without tripping the RSC serialisation
   *  boundary. */
  hrefMap?: Partial<Record<FmSessionTypeId, string>>;
  /** What's already on file for this client — drives the CTA label per
   *  card. With this set, "Run intake" becomes "Review intake →" once an
   *  intake exists; the recommended next session also gets a "Next" badge.
   *  Coach feedback: "if intake is done, what's the point of saying run
   *  again — should say update intake". */
  completionState?: Partial<Record<FmSessionTypeId, "done" | "active" | "pending">>;
  /** Highlights the single card the journey says is the recommended
   *  next action. Drawn from ClientJourney.nextStep on the server. */
  recommendedId?: FmSessionTypeId | null;
}

export function FmSessionTypePicker({
  selectedId,
  dense = false,
  onSelect,
  hrefMap,
  completionState,
  recommendedId,
}: FmSessionTypePickerProps) {
  if (dense) return <PickerDense selectedId={selectedId} onSelect={onSelect} hrefMap={hrefMap} />;
  return (
    <PickerFull
      selectedId={selectedId}
      onSelect={onSelect}
      hrefMap={hrefMap}
      completionState={completionState}
      recommendedId={recommendedId}
    />
  );
}

function PickerFull({
  selectedId,
  onSelect,
  hrefMap,
  completionState,
  recommendedId,
}: Omit<FmSessionTypePickerProps, "dense">) {
  return (
    <div>
      <h2
        style={{
          fontFamily: "var(--fm-font-display)",
          fontSize: 22,
          fontWeight: 400,
          margin: "0 0 4px",
          letterSpacing: "-0.4px",
        }}
      >
        New session
      </h2>
      <p
        style={{
          fontSize: 13,
          color: "var(--fm-text-secondary)",
          margin: "0 0 24px",
        }}
      >
        Pick a session type to populate the form.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 14,
        }}
      >
        {FM_SESSION_TYPES.map((s) => {
          const sel = s.id === selectedId;
          const state = completionState?.[s.id];
          const isDone = state === "done";
          const isRecommended = recommendedId === s.id;
          const ctaLabel = (() => {
            // Once an intake / discovery is on file, the natural action
            // is to REVIEW it, not to start a fresh one (coach pain
            // point — kept clicking "Run intake" thinking it'd open the
            // existing record). Check-in / quick note can always repeat.
            if (s.id === "discovery") return isDone ? "Review discovery →" : "Run discovery →";
            if (s.id === "intake") return isDone ? "Review intake →" : "Run intake →";
            if (s.id === "full") return isDone ? "Re-run assessment →" : "Run assessment →";
            if (s.id === "checkin") return "Log check-in →";
            return "Add note →";
          })();
          const inner = (
            <div
              style={{
                position: "relative",
                padding: "20px 18px",
                borderRadius: "var(--fm-radius-lg)",
                border: `2px solid ${
                  isRecommended
                    ? "#F39C12"
                    : sel
                      ? s.tint
                      : "var(--fm-border-light)"
                }`,
                background: sel
                  ? `linear-gradient(135deg, ${s.tint}12, ${s.tint}04)`
                  : isRecommended
                    ? "linear-gradient(135deg, rgba(243,156,18,0.10), rgba(243,156,18,0.03))"
                    : "var(--fm-surface)",
                boxShadow: sel ? `0 4px 18px ${s.tint}25` : "none",
                cursor: "pointer",
                transition: "all 200ms var(--fm-ease-out)",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                opacity: isDone && !isRecommended ? 0.78 : 1,
              }}
            >
              {/* ★ "Next" badge — the single card the journey says is the
                  recommended next move for this client. */}
              {isRecommended && (
                <div
                  style={{
                    position: "absolute",
                    top: -10,
                    left: 12,
                    background: "#F39C12",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}
                >
                  ★ Next
                </div>
              )}
              {/* ✓ tick on done sessions — coach knows it's already on
                  file at a glance, and the CTA reads "Review" not "Run". */}
              {isDone && (
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    background: "rgba(30, 132, 73, 0.12)",
                    color: "#1E8449",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  ✓ Done
                </div>
              )}
              <div style={{ fontSize: 28, marginBottom: 10 }}>{s.icon}</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: sel ? s.tint : "var(--fm-text-primary)",
                  marginBottom: 2,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  marginBottom: 10,
                }}
              >
                {s.duration}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--fm-text-secondary)",
                  lineHeight: 1.55,
                  paddingTop: 10,
                  borderTop: `1px dashed ${sel ? s.tint + "50" : "var(--fm-border-light)"}`,
                  flex: 1,
                }}
              >
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    color: "var(--fm-text-tertiary)",
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  produces
                </span>
                {s.produces}
              </div>
              <div
                style={{
                  marginTop: 14,
                  padding: "6px 10px",
                  background: sel ? s.tint : "transparent",
                  color: sel ? "#fff" : s.tint,
                  border: `1px solid ${s.tint}`,
                  borderRadius: "var(--fm-radius-sm)",
                  fontSize: 11.5,
                  fontWeight: 700,
                  textAlign: "center",
                }}
              >
                {ctaLabel}
              </div>
            </div>
          );
          const href = hrefMap?.[s.id];
          if (href) {
            return (
              <Link
                key={s.id}
                href={href}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {inner}
              </Link>
            );
          }
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect?.(s.id)}
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                fontFamily: "inherit",
                color: "inherit",
                textAlign: "left",
              }}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PickerDense({
  selectedId,
  onSelect,
  hrefMap,
}: Omit<FmSessionTypePickerProps, "dense">) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--fm-text-tertiary)",
          marginBottom: 8,
        }}
      >
        Session type
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {FM_SESSION_TYPES.map((s) => {
          const sel = s.id === selectedId;
          const inner = (
            <div
              style={{
                padding: "10px 12px",
                border: `1.5px solid ${sel ? s.tint : "var(--fm-border-light)"}`,
                borderRadius: "var(--fm-radius-md)",
                background: sel
                  ? `linear-gradient(135deg, ${s.tint}10, ${s.tint}05)`
                  : "var(--fm-surface)",
                cursor: "pointer",
                height: "100%",
              }}
            >
              <div style={{ fontSize: 16, marginBottom: 4 }}>{s.icon}</div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: sel ? s.tint : "var(--fm-text-primary)",
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontSize: 9.5,
                  color: "var(--fm-text-tertiary)",
                  fontWeight: 600,
                  marginTop: 2,
                }}
              >
                {s.duration}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: sel ? "var(--fm-text-secondary)" : "var(--fm-text-tertiary)",
                  marginTop: 4,
                  lineHeight: 1.4,
                }}
              >
                {s.produces}
              </div>
            </div>
          );
          const href = hrefMap?.[s.id];
          if (href) {
            return (
              <Link
                key={s.id}
                href={href}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {inner}
              </Link>
            );
          }
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect?.(s.id)}
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                fontFamily: "inherit",
                color: "inherit",
                textAlign: "left",
              }}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
