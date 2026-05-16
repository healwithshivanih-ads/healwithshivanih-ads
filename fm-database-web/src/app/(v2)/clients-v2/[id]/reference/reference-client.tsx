"use client";

/**
 * ReferenceClient — interactive shell for the active-plan reference card.
 *
 * Renders a warm "what's the client on right now?" view: two big tile
 * buttons (Supplements / Weekly meals), an inline nutrition guidance
 * card, a lifestyle list, and a notes-for-coach block. Plan slug + status
 * are relegated to a subtle footer — not the foreground.
 *
 * Modal interactions:
 *   - 💊 Supplements tile → modal with the brand-styled supplement
 *     schedule (extracted from the saved client letter HTML and rendered
 *     in an iframe srcDoc so all the letter CSS just cascades for free).
 *     If no letter is on disk, falls back to a clean inline schedule built
 *     from plan.supplement_protocol.
 *   - 📅 Each week button → modal with that week's meal-plan section,
 *     also iframe srcDoc with the letter's <style> block.
 *
 * Current-week button is highlighted (warm coral) so the coach knows
 * which week the client is in without scanning dates.
 */
import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import type { LetterSections } from "./extract-letter-sections";

interface SupplementItem {
  supplement_slug: string;
  form?: string;
  dose?: string;
  timing?: string;
  take_with_food?: string;
  duration_weeks?: number | null;
  titration?: string;
  coach_rationale?: string;
}

interface NutritionShape {
  pattern?: string;
  add?: string[];
  reduce?: string[];
  meal_timing?: string;
  [k: string]: unknown;
}

interface PracticeItem {
  name?: string;
  cadence?: string;
  details?: string;
}

interface Props {
  clientId: string;
  displayName: string;
  firstName: string;
  activePlanSlug: string | null;
  activePlanStatus: string | null;
  activePlanVersion: number | null;
  planUpdatedAt: string | null;
  planPeriodStart: string | null;
  planPeriodWeeks: number;
  currentWeek: number | null;
  supplements: SupplementItem[];
  supplementNameMap: Record<string, string>;
  nutrition: NutritionShape;
  lifestyle: PracticeItem[];
  notesForCoach: string | null;
  letterSections: LetterSections | null;
  hasMealPlanLetter: boolean;
  hasConsolidatedLetter: boolean;
}

// ── Modal ────────────────────────────────────────────────────────────
// Plain DOM modal — no router-managed dialog, no portal complexity. We
// only need one open at a time so a top-level conditional render is fine.

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // ESC to close. Effect cleanup removes the listener on unmount.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // Lock scroll on the underlying page so the modal feels modal.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          maxWidth: 980,
          width: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "linear-gradient(180deg, #fffaf6 0%, #fff 100%)",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1d1d1f" }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: 0,
              fontSize: 22,
              cursor: "pointer",
              color: "#94a3b8",
              padding: "4px 10px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// ── Inline supplement schedule fallback ──────────────────────────────
// When the saved letter isn't on disk yet (fresh draft plan, or letter
// hasn't been generated), render a stripped-down schedule from the
// structured plan.supplement_protocol so the coach still has something.

const TIMING_SLOTS: { key: string; label: string; emoji: string }[] = [
  { key: "early_morning", label: "Early morning",     emoji: "🌅" },
  { key: "breakfast",     label: "With breakfast",    emoji: "🍳" },
  { key: "mid_morning",   label: "Mid-morning",       emoji: "🌤" },
  { key: "lunch",         label: "With lunch",        emoji: "🍱" },
  { key: "afternoon",     label: "Afternoon",         emoji: "🍵" },
  { key: "dinner",        label: "With dinner",       emoji: "🌆" },
  { key: "bedtime",       label: "Bedtime / evening", emoji: "🌙" },
  { key: "unspecified",   label: "Timing not set",    emoji: "❓" },
];

function classifyTiming(raw: string | undefined): string {
  if (!raw) return "unspecified";
  const t = raw.toLowerCase();
  if (/(early\s*morning|first thing|wake|empty stomach)/.test(t)) return "early_morning";
  if (/with dinner|at dinner|dinner/.test(t)) return "dinner";
  if (/(bedtime|before bed|at night|evening)/.test(t)) return "bedtime";
  if (/(breakfast|morning meal)/.test(t)) return "breakfast";
  if (/(mid[- ]?morning|11 ?am|10 ?am)/.test(t)) return "mid_morning";
  if (/(lunch|midday|1 ?pm|2 ?pm)/.test(t)) return "lunch";
  if (/(afternoon|3 ?pm|4 ?pm|tea time|teatime)/.test(t)) return "afternoon";
  return "unspecified";
}

function FallbackSchedule({
  supplements,
  nameMap,
}: {
  supplements: SupplementItem[];
  nameMap: Record<string, string>;
}) {
  const grouped = useMemo(() => {
    const buckets: Record<string, SupplementItem[]> = {};
    for (const s of supplements) (buckets[classifyTiming(s.timing)] ??= []).push(s);
    return TIMING_SLOTS.map((slot) => ({ slot, items: buckets[slot.key] ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [supplements]);

  if (supplements.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
        No supplements on this plan.
      </div>
    );
  }
  return (
    <div style={{ padding: 24, display: "grid", gap: 18 }}>
      <p style={{ fontSize: 12, color: "#92400e", background: "#fef3c7", padding: "8px 12px", borderRadius: 6, margin: 0 }}>
        💡 The client letter for this plan hasn&apos;t been generated yet, so
        showing the raw protocol. Generate the letter from <strong>Communicate</strong>
        for the brand-styled timeline + buy links.
      </p>
      {grouped.map(({ slot, items }) => (
        <div key={slot.key}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "#6b7280",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 14 }}>{slot.emoji}</span> {slot.label}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {items.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {nameMap[s.supplement_slug] ?? s.supplement_slug}
                </div>
                <div style={{ fontSize: 12, color: "#475569", marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {s.dose && <span><strong>Dose:</strong> {s.dose}</span>}
                  {s.timing && <span><strong>When:</strong> {s.timing}</span>}
                  {s.form && <span><strong>Form:</strong> {s.form}</span>}
                  {s.take_with_food && <span><strong>Food:</strong> {s.take_with_food}</span>}
                </div>
                {s.coach_rationale && (
                  <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 6, whiteSpace: "pre-wrap" }}>
                    {s.coach_rationale}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Iframe modal body ────────────────────────────────────────────────
// Build a complete HTML document combining the letter's <style> block
// with one extracted chunk (supplement schedule or per-week section).
// Rendering in an iframe keeps the letter's CSS isolated from the
// reference page's own styles — no class-name collisions.

function iframeDoc(styleBlock: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>${styleBlock}
  /* Reference modal: never need page chrome / FAB / print bars. */
  body { margin: 0; padding: 16px 18px 60px; background: #fff; }
  .brand-header, .brand-footer, .week-print-bar, .no-print { display: none !important; }
  .content { max-width: none; margin: 0; padding: 0; }
  /* Ensure tables don't horizontally overflow inside the narrower modal. */
  table { width: 100% !important; }
</style>
</head>
<body><div class="content">${body}</div></body>
</html>`;
}

function statusTone(status: string | null): { bg: string; fg: string; label: string } | null {
  if (!status) return null;
  if (status === "published") return { bg: "#d1fae5", fg: "#065f46", label: "Live" };
  if (status === "ready_to_publish") return { bg: "#fef3c7", fg: "#92400e", label: "Ready" };
  return { bg: "#e2e8f0", fg: "#475569", label: "Draft" };
}

export function ReferenceClient({
  clientId,
  displayName,
  firstName,
  activePlanSlug,
  activePlanStatus,
  activePlanVersion,
  planUpdatedAt,
  planPeriodStart,
  planPeriodWeeks,
  currentWeek,
  supplements,
  supplementNameMap,
  nutrition,
  lifestyle,
  notesForCoach,
  letterSections,
  hasMealPlanLetter,
  hasConsolidatedLetter,
}: Props) {
  const [modal, setModal] = useState<
    | { kind: "supplements" }
    | { kind: "week"; num: number }
    | null
  >(null);

  // Which weeks have actual content in the letter? Show buttons only for
  // those — better than showing 12 buttons where half open empty modals.
  const availableWeekNums = useMemo(() => {
    if (!letterSections) return [];
    return Object.keys(letterSections.weeks)
      .map((n) => parseInt(n, 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
  }, [letterSections]);

  const supplementCount = supplements.length;
  const statusToneObj = statusTone(activePlanStatus);
  const hasLetter = letterSections !== null;

  // Modal content (supplements + week).
  const supplementsBody =
    letterSections?.supplementSchedule
      ? (
        <iframe
          srcDoc={iframeDoc(letterSections.styleBlock, letterSections.supplementSchedule)}
          title="Supplement schedule"
          style={{ width: "100%", height: "75vh", border: 0 }}
        />
      )
      : <FallbackSchedule supplements={supplements} nameMap={supplementNameMap} />;

  const weekBody =
    modal?.kind === "week" && letterSections?.weeks[modal.num]
      ? (
        <iframe
          srcDoc={iframeDoc(letterSections.styleBlock, letterSections.weeks[modal.num])}
          title={`Week ${modal.num} meal plan`}
          style={{ width: "100%", height: "75vh", border: 0 }}
        />
      )
      : null;

  return (
    <div
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "28px 24px 80px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        color: "#1d1d1f",
      }}
    >
      {/* ── Warm header ── */}
      <Link
        href={`/clients-v2/${clientId}`}
        style={{ fontSize: 12, color: "#6b7280", textDecoration: "none" }}
      >
        ← Back to {firstName}
      </Link>

      <h1
        style={{
          fontSize: 26,
          margin: "10px 0 4px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        Here&apos;s what {firstName} is on right now.
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "#6b7280",
          margin: "0 0 26px",
          lineHeight: 1.55,
        }}
      >
        A one-screen reference for mid-call lookups — supplement timings,
        weekly meals, and the foods we&apos;ve agreed to lean into or pull back
        from. Click anywhere highlighted to dive in.
      </p>

      {!activePlanSlug && (
        <div
          style={{
            padding: 24,
            background: "#fef2f2",
            border: "1px dashed #fca5a5",
            borderRadius: 10,
            color: "#7f1d1d",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {firstName} doesn&apos;t have an active plan yet. Once you finish a
          Full Assessment and activate the plan, this page will become
          your at-a-glance reference.
        </div>
      )}

      {activePlanSlug && (
        <>
          {/* ── Two tile buttons row ── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 14,
              marginBottom: 30,
            }}
          >
            {/* 💊 Supplements tile */}
            <button
              type="button"
              onClick={() => setModal({ kind: "supplements" })}
              disabled={supplementCount === 0}
              style={{
                textAlign: "left",
                padding: "18px 20px",
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                background: supplementCount === 0 ? "#f8fafc" : "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
                cursor: supplementCount === 0 ? "default" : "pointer",
                fontFamily: "inherit",
                transition: "transform 0.08s, box-shadow 0.08s",
                opacity: supplementCount === 0 ? 0.55 : 1,
              }}
              onMouseDown={(e) => supplementCount > 0 && (e.currentTarget.style.transform = "scale(0.98)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
            >
              <div style={{ fontSize: 28, marginBottom: 6 }}>💊</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
                {supplementCount} supplement{supplementCount !== 1 ? "s" : ""}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                {supplementCount === 0
                  ? "Nothing on the protocol yet."
                  : "View the daily schedule — what to take, when, and why."}
              </div>
            </button>

            {/* 📅 Weekly meals tile */}
            <button
              type="button"
              onClick={() => {
                if (availableWeekNums.length > 0) {
                  // Default to currentWeek if available, else first week.
                  const target =
                    currentWeek && availableWeekNums.includes(currentWeek)
                      ? currentWeek
                      : availableWeekNums[0];
                  setModal({ kind: "week", num: target });
                }
              }}
              disabled={availableWeekNums.length === 0}
              style={{
                textAlign: "left",
                padding: "18px 20px",
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                background:
                  availableWeekNums.length === 0
                    ? "#f8fafc"
                    : "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
                cursor: availableWeekNums.length === 0 ? "default" : "pointer",
                fontFamily: "inherit",
                transition: "transform 0.08s",
                opacity: availableWeekNums.length === 0 ? 0.55 : 1,
              }}
              onMouseDown={(e) =>
                availableWeekNums.length > 0 && (e.currentTarget.style.transform = "scale(0.98)")
              }
              onMouseUp={(e) => (e.currentTarget.style.transform = "")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
            >
              <div style={{ fontSize: 28, marginBottom: 6 }}>📅</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
                {hasMealPlanLetter || hasConsolidatedLetter
                  ? `Weekly meals${currentWeek ? ` — currently Week ${currentWeek}` : ""}`
                  : "Nutrition guidelines"}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                {availableWeekNums.length > 0
                  ? `Tap a week below to see ${firstName}'s plan for those 7 days.`
                  : hasLetter
                    ? "The saved letter doesn't have per-week sections."
                    : "Generate the meal-plan letter from Communicate to enable weekly tables."}
              </div>
            </button>
          </div>

          {/* ── Week buttons row ── */}
          {availableWeekNums.length > 0 && (
            <div style={{ marginBottom: 30 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: "#6b7280",
                  marginBottom: 8,
                }}
              >
                Jump to a specific week
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {availableWeekNums.map((n) => {
                  const isCurrent = currentWeek === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setModal({ kind: "week", num: n })}
                      style={{
                        padding: "10px 16px",
                        borderRadius: 999,
                        border: isCurrent ? "0" : "1px solid #e5e7eb",
                        background: isCurrent
                          ? "linear-gradient(135deg, #ff6b35 0%, #ff8252 100%)"
                          : "#fff",
                        color: isCurrent ? "#fff" : "#1d1d1f",
                        fontWeight: isCurrent ? 700 : 600,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        boxShadow: isCurrent ? "0 4px 12px rgba(255, 107, 53, 0.3)" : "none",
                        transition: "transform 0.08s",
                      }}
                      title={
                        isCurrent
                          ? `${firstName} is in Week ${n} right now`
                          : `View Week ${n} meals`
                      }
                    >
                      Week {n}
                      {isCurrent && (
                        <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.9 }}>
                          • now
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {planPeriodStart && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
                  Plan started {planPeriodStart} · {planPeriodWeeks} weeks total
                </div>
              )}
            </div>
          )}

          {/* ── Nutrition guidance (inline — short enough to live here) ── */}
          {(nutrition.pattern || (nutrition.add?.length ?? 0) > 0 || (nutrition.reduce?.length ?? 0) > 0) && (
            <section
              style={{
                marginBottom: 24,
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>
                🥗 What we&apos;re eating &amp; pulling back
              </h2>
              {!hasMealPlanLetter && (
                <p
                  style={{
                    fontSize: 12,
                    color: "#94a3b8",
                    margin: "0 0 14px",
                    fontStyle: "italic",
                  }}
                >
                  {firstName} prefers guidelines over daily menus — this is
                  the menu reference.
                </p>
              )}
              {nutrition.pattern && (
                <div style={{ fontSize: 13.5, marginBottom: 14, color: "#475569" }}>
                  <strong>Pattern:</strong> {nutrition.pattern}
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gap: 18,
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                }}
              >
                {Array.isArray(nutrition.add) && nutrition.add.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#065f46",
                        marginBottom: 8,
                      }}
                    >
                      ✅ Lean into
                    </div>
                    <ul style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
                      {nutrition.add.map((item, i) => (
                        <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "#1d1d1f" }}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(nutrition.reduce) && nutrition.reduce.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#7f1d1d",
                        marginBottom: 8,
                      }}
                    >
                      🛑 Pull back on
                    </div>
                    <ul style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
                      {nutrition.reduce.map((item, i) => (
                        <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "#1d1d1f" }}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {nutrition.meal_timing && (
                <div style={{ fontSize: 13, marginTop: 14, color: "#475569" }}>
                  <strong>Meal timing:</strong> {nutrition.meal_timing}
                </div>
              )}
            </section>
          )}

          {/* ── Lifestyle ── */}
          {lifestyle.length > 0 && (
            <section
              style={{
                marginBottom: 24,
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 14px" }}>
                🌿 Daily practices
              </h2>
              <ul style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 10 }}>
                {lifestyle.map((p, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                    <strong>{p.name ?? "(unnamed practice)"}</strong>
                    {p.cadence && (
                      <span style={{ color: "#94a3b8" }}>
                        {" "}
                        · {p.cadence}
                      </span>
                    )}
                    {p.details && (
                      <div style={{ fontSize: 12.5, color: "#475569", marginTop: 2 }}>
                        {p.details}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Notes for coach ── */}
          {notesForCoach && (
            <section
              style={{
                marginBottom: 24,
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <h2
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  margin: "0 0 8px",
                  color: "#92400e",
                }}
              >
                📝 Your own notes on this plan
              </h2>
              <div
                style={{
                  fontSize: 12.5,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.55,
                  color: "#78350f",
                }}
              >
                {notesForCoach}
              </div>
            </section>
          )}

          {/* ── Footer: machine identifiers ── */}
          <div
            style={{
              marginTop: 36,
              paddingTop: 14,
              borderTop: "1px solid #f1f5f9",
              fontSize: 11,
              color: "#94a3b8",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span>Plan</span>
            <code
              style={{
                fontSize: 10.5,
                padding: "1px 6px",
                background: "#f8fafc",
                borderRadius: 4,
              }}
            >
              {activePlanSlug}
            </code>
            {activePlanVersion !== null && <span>v{activePlanVersion}</span>}
            {statusToneObj && (
              <span
                style={{
                  background: statusToneObj.bg,
                  color: statusToneObj.fg,
                  padding: "1px 7px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                {statusToneObj.label}
              </span>
            )}
            {planUpdatedAt && (
              <span>· updated {planUpdatedAt.slice(0, 10)}</span>
            )}
            {activePlanSlug && (hasMealPlanLetter || hasConsolidatedLetter) && (
              <a
                href={`/api/letter/${clientId}/${activePlanSlug}/${hasMealPlanLetter ? "meal_plan" : "consolidated"}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginLeft: "auto",
                  color: "#6b7280",
                  textDecoration: "underline",
                }}
              >
                Open full letter ↗
              </a>
            )}
            <Link
              href={`/clients-v2/${clientId}/plan`}
              style={{ color: "#6b7280", textDecoration: "underline" }}
            >
              Plan editor ↗
            </Link>
          </div>
        </>
      )}

      {/* ── Modals ── */}
      {modal?.kind === "supplements" && (
        <Modal
          title="💊 Daily supplement schedule"
          subtitle={`${supplementCount} supplements · grouped by when ${firstName} takes them`}
          onClose={() => setModal(null)}
        >
          {supplementsBody}
        </Modal>
      )}
      {modal?.kind === "week" && (
        <Modal
          title={`📅 Week ${modal.num}${currentWeek === modal.num ? " — happening now" : ""}`}
          subtitle={`Meal plan for ${firstName}, Week ${modal.num}`}
          onClose={() => setModal(null)}
        >
          {weekBody ?? (
            <div style={{ padding: 32, color: "#94a3b8", fontSize: 13 }}>
              No saved content for Week {modal.num}.
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
