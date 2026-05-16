"use client";

/**
 * ReferenceClient — interactive shell for the active-plan reference card.
 *
 * Renders supplements grouped by timing slot, a "What to eat / avoid"
 * nutrition card, a lifestyle chips row, and the notes_for_coach panel.
 * Top search box filters supplements live by slug, display name, timing,
 * form, dose, or rationale — so coach types "niacin" mid-call and the
 * row highlights instantly.
 *
 * Standalone page (no client subnav). Print button is plain
 * window.print(); the page is already a single column so it prints
 * cleanly without extra CSS plumbing.
 */
import { useState, useMemo } from "react";
import Link from "next/link";

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
  cooking_adjustments?: unknown[];
  home_remedies?: unknown[];
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
  planUpdatedAt: string | null;
  supplements: SupplementItem[];
  supplementNameMap: Record<string, string>;
  nutrition: NutritionShape;
  lifestyle: PracticeItem[];
  notesForCoach: string | null;
  hasMealPlanLetter: boolean;
  hasConsolidated: boolean;
}

// Same 7 timing slots that the supplement-schedule renderer in
// render-client-letter.py uses, so the visual order matches the
// client letter the coach sees on screen.
const TIMING_SLOTS: { key: string; label: string; emoji: string }[] = [
  { key: "early_morning", label: "Early morning",        emoji: "🌅" },
  { key: "breakfast",     label: "With breakfast",       emoji: "🍳" },
  { key: "mid_morning",   label: "Mid-morning",          emoji: "🌤" },
  { key: "lunch",         label: "With lunch",           emoji: "🍱" },
  { key: "afternoon",     label: "Afternoon",            emoji: "🍵" },
  { key: "dinner",        label: "With dinner",          emoji: "🌆" },
  { key: "bedtime",       label: "Bedtime / evening",    emoji: "🌙" },
  { key: "unspecified",   label: "Timing not set",       emoji: "❓" },
];

/** Map a free-form `timing` string to one of TIMING_SLOTS keys. Mirrors
 *  the `_timing_slot()` helper in render-client-letter.py — same order
 *  of pattern checks. Keep them in sync if you tweak either. */
function classifyTiming(raw: string | undefined): string {
  if (!raw) return "unspecified";
  const t = raw.toLowerCase();
  if (/(early\s*morning|first thing|wake|empty stomach)/.test(t)) return "early_morning";
  if (/(bedtime|before bed|at night|pm$|evening with dinner|evening|9 ?pm|10 ?pm)/.test(t)) {
    // "evening, with dinner" → dinner takes precedence; the dinner check below catches it.
    if (/with dinner|at dinner|dinner/.test(t)) return "dinner";
    return "bedtime";
  }
  if (/(breakfast|morning meal|with morning food)/.test(t)) return "breakfast";
  if (/(mid[- ]?morning|11 ?am|10 ?am)/.test(t)) return "mid_morning";
  if (/(lunch|midday|1 ?pm|2 ?pm)/.test(t)) return "lunch";
  if (/(afternoon|3 ?pm|4 ?pm|tea time|teatime)/.test(t)) return "afternoon";
  if (/(dinner|evening meal|7 ?pm|8 ?pm|with dinner)/.test(t)) return "dinner";
  return "unspecified";
}

function statusBadge(status: string | null) {
  if (!status) return null;
  const tone =
    status === "published"
      ? { bg: "rgba(16,185,129,0.12)", fg: "#065f46", label: "✓ Published" }
      : status === "ready_to_publish"
        ? { bg: "rgba(245,158,11,0.14)", fg: "#92400e", label: "● Ready" }
        : { bg: "rgba(148,163,184,0.18)", fg: "#475569", label: "✎ Draft" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        background: tone.bg,
        color: tone.fg,
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
      }}
    >
      {tone.label}
    </span>
  );
}

function highlight(text: string, q: string) {
  if (!q.trim()) return text;
  try {
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    const parts = text.split(re);
    return parts.map((p, i) =>
      re.test(p) ? (
        <mark key={i} style={{ background: "#fef08a", padding: "0 2px", borderRadius: 2 }}>
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  } catch {
    return text;
  }
}

export function ReferenceClient({
  clientId,
  displayName,
  firstName,
  activePlanSlug,
  activePlanStatus,
  planUpdatedAt,
  supplements,
  supplementNameMap,
  nutrition,
  lifestyle,
  notesForCoach,
  hasMealPlanLetter,
  hasConsolidated,
}: Props) {
  const [q, setQ] = useState("");

  // Filter supplements live against the search query. We search across
  // every text-bearing field so "niacin" matches the slug, "9 pm" matches
  // the timing, and "thyroid" matches a rationale paragraph.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return supplements;
    return supplements.filter((s) => {
      const name = (supplementNameMap[s.supplement_slug] ?? s.supplement_slug).toLowerCase();
      const haystack = [
        name,
        s.supplement_slug,
        s.form,
        s.dose,
        s.timing,
        s.take_with_food,
        s.titration,
        s.coach_rationale,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [q, supplements, supplementNameMap]);

  // Group filtered supplements by timing slot, preserving slot order.
  const grouped = useMemo(() => {
    const buckets: Record<string, SupplementItem[]> = {};
    for (const s of filtered) {
      const slot = classifyTiming(s.timing);
      (buckets[slot] ??= []).push(s);
    }
    return TIMING_SLOTS.map((slot) => ({ slot, items: buckets[slot.key] ?? [] })).filter(
      (group) => group.items.length > 0,
    );
  }, [filtered]);

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "20px 24px 80px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        color: "var(--fm-text-primary, #1d1d1f)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
          paddingBottom: 12,
          borderBottom: "1px solid var(--fm-border-light, #e5e7eb)",
        }}
        className="no-print-flex"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Link
            href={`/clients-v2/${clientId}`}
            style={{ fontSize: 11, color: "var(--fm-text-secondary, #6b7280)" }}
          >
            ← Back to {firstName}
          </Link>
          <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>
            📋 Active plan reference — {displayName}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {activePlanSlug ? (
              <>
                <code
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    background: "rgba(148,163,184,0.12)",
                    borderRadius: 4,
                  }}
                >
                  {activePlanSlug}
                </code>
                {statusBadge(activePlanStatus)}
                {planUpdatedAt && (
                  <span style={{ fontSize: 10, color: "var(--fm-text-tertiary, #94a3b8)" }}>
                    updated {planUpdatedAt.slice(0, 10)}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 12, color: "#dc2626" }}>
                No active plan — start a Full Assessment first.
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              padding: "6px 12px",
              background: "var(--fm-surface, #fff)",
              border: "1px solid var(--fm-border, #d1d5db)",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            🖨 Print
          </button>
          {activePlanSlug && (hasMealPlanLetter || hasConsolidated) && (
            <a
              href={`/api/letter/${clientId}/${activePlanSlug}/${hasMealPlanLetter ? "meal_plan" : "consolidated"}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "6px 12px",
                background: "var(--fm-primary, #ff6b35)",
                color: "#fff",
                border: 0,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              📖 Open full letter →
            </a>
          )}
        </div>
      </div>

      {!activePlanSlug && (
        <div
          style={{
            padding: 24,
            background: "rgba(252,165,165,0.12)",
            border: "1px dashed #fca5a5",
            borderRadius: 8,
            color: "#7f1d1d",
            fontSize: 13,
          }}
        >
          {firstName} has no active plan to reference. Start a Full Assessment from the{" "}
          <Link href={`/clients-v2/${clientId}`} style={{ textDecoration: "underline" }}>
            Overview tab
          </Link>
          .
        </div>
      )}

      {/* Search */}
      {activePlanSlug && supplements.length > 0 && (
        <div style={{ margin: "16px 0", display: "flex", gap: 10, alignItems: "center" }} className="no-print">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`🔍 Search supplements — try "niacin", "bedtime", "with food"…`}
            autoFocus
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid var(--fm-border, #d1d5db)",
              borderRadius: 8,
              fontSize: 13,
              background: "var(--fm-surface, #fff)",
            }}
          />
          {q.trim() && (
            <span style={{ fontSize: 11, color: "var(--fm-text-tertiary, #94a3b8)" }}>
              {filtered.length} of {supplements.length}
            </span>
          )}
        </div>
      )}

      {/* Supplements */}
      {activePlanSlug && (
        <section
          style={{
            marginBottom: 24,
            background: "var(--fm-surface, #fff)",
            border: "1px solid var(--fm-border-light, #e5e7eb)",
            borderRadius: 10,
            padding: 18,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px" }}>
            💊 Supplements{" "}
            <span style={{ fontWeight: 400, fontSize: 12, color: "var(--fm-text-tertiary, #94a3b8)" }}>
              ({supplements.length} on protocol)
            </span>
          </h2>
          {supplements.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--fm-text-tertiary, #94a3b8)", margin: 0 }}>
              No supplements on this plan.
            </p>
          )}
          {supplements.length > 0 && grouped.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--fm-text-tertiary, #94a3b8)", margin: 0 }}>
              No supplements match &ldquo;{q}&rdquo;.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {grouped.map(({ slot, items }) => (
              <div key={slot.key}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    color: "var(--fm-text-secondary, #6b7280)",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{slot.emoji}</span>
                  {slot.label}
                  <span
                    style={{
                      fontWeight: 400,
                      color: "var(--fm-text-tertiary, #94a3b8)",
                      textTransform: "none",
                      letterSpacing: 0,
                    }}
                  >
                    · {items.length} item{items.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {items.map((s, i) => {
                    const name = supplementNameMap[s.supplement_slug] ?? s.supplement_slug;
                    return (
                      <div
                        key={`${s.supplement_slug}-${i}`}
                        style={{
                          padding: "10px 12px",
                          border: "1px solid var(--fm-border-light, #e5e7eb)",
                          borderRadius: 8,
                          background: "var(--fm-bg-cool, #f8fafc)",
                          display: "grid",
                          gap: 4,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            flexWrap: "wrap",
                            alignItems: "baseline",
                          }}
                        >
                          <strong style={{ fontSize: 13.5 }}>{highlight(name, q)}</strong>
                          <Link
                            href={`/catalogue/supplement/${s.supplement_slug}`}
                            target="_blank"
                            style={{
                              fontSize: 10,
                              color: "var(--fm-text-tertiary, #94a3b8)",
                              textDecoration: "none",
                            }}
                          >
                            ↗ catalogue
                          </Link>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            fontSize: 12,
                            flexWrap: "wrap",
                            color: "var(--fm-text-secondary, #475569)",
                          }}
                        >
                          {s.dose && (
                            <span>
                              <strong>Dose:</strong> {highlight(s.dose, q)}
                            </span>
                          )}
                          {s.timing && (
                            <span>
                              <strong>When:</strong> {highlight(s.timing, q)}
                            </span>
                          )}
                          {s.form && (
                            <span>
                              <strong>Form:</strong> {highlight(s.form, q)}
                            </span>
                          )}
                          {s.take_with_food && (
                            <span>
                              <strong>Food:</strong> {highlight(s.take_with_food, q)}
                            </span>
                          )}
                          {typeof s.duration_weeks === "number" && (
                            <span>
                              <strong>For:</strong> {s.duration_weeks} wks
                            </span>
                          )}
                        </div>
                        {s.titration && (
                          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary, #475569)" }}>
                            <strong>Titration:</strong> {highlight(s.titration, q)}
                          </div>
                        )}
                        {s.coach_rationale && (
                          <details style={{ fontSize: 11.5 }}>
                            <summary
                              style={{
                                cursor: "pointer",
                                color: "var(--fm-text-tertiary, #94a3b8)",
                                userSelect: "none",
                              }}
                            >
                              Why I picked this
                            </summary>
                            <div
                              style={{
                                marginTop: 4,
                                whiteSpace: "pre-wrap",
                                color: "var(--fm-text-secondary, #475569)",
                              }}
                            >
                              {highlight(s.coach_rationale, q)}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Nutrition */}
      {activePlanSlug && (
        <section
          style={{
            marginBottom: 24,
            background: "var(--fm-surface, #fff)",
            border: "1px solid var(--fm-border-light, #e5e7eb)",
            borderRadius: 10,
            padding: 18,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>
            🥗 Nutrition guidance
          </h2>
          {!hasMealPlanLetter && (
            <p
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary, #94a3b8)",
                margin: "0 0 12px",
              }}
            >
              {firstName} opted out of daily meal plans — these guidelines are
              their menu reference.
            </p>
          )}
          {hasMealPlanLetter && activePlanSlug && (
            <p style={{ fontSize: 11, margin: "0 0 12px" }}>
              <a
                href={`/api/letter/${clientId}/${activePlanSlug}/meal_plan`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--fm-primary, #ff6b35)", textDecoration: "underline" }}
              >
                📖 Open full 14-day meal plan →
              </a>
            </p>
          )}
          {nutrition.pattern && (
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              <strong>Pattern:</strong> {nutrition.pattern}
            </div>
          )}
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {Array.isArray(nutrition.add) && nutrition.add.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#065f46",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 6,
                  }}
                >
                  ✅ Foods to emphasise
                </div>
                <ul style={{ paddingLeft: 16, margin: 0, display: "grid", gap: 5 }}>
                  {nutrition.add.map((item, i) => (
                    <li key={i} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
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
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#7f1d1d",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 6,
                  }}
                >
                  🛑 Foods to reduce / avoid
                </div>
                <ul style={{ paddingLeft: 16, margin: 0, display: "grid", gap: 5 }}>
                  {nutrition.reduce.map((item, i) => (
                    <li key={i} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {nutrition.meal_timing && (
            <div style={{ fontSize: 12.5, marginTop: 12 }}>
              <strong>Meal timing:</strong> {nutrition.meal_timing}
            </div>
          )}
          {!nutrition.pattern && !Array.isArray(nutrition.add) && !Array.isArray(nutrition.reduce) && (
            <p style={{ fontSize: 12, color: "var(--fm-text-tertiary, #94a3b8)", margin: 0 }}>
              No nutrition guidance recorded on this plan yet.
            </p>
          )}
        </section>
      )}

      {/* Lifestyle */}
      {activePlanSlug && lifestyle.length > 0 && (
        <section
          style={{
            marginBottom: 24,
            background: "var(--fm-surface, #fff)",
            border: "1px solid var(--fm-border-light, #e5e7eb)",
            borderRadius: 10,
            padding: 18,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>
            🌿 Lifestyle practices
          </h2>
          <ul style={{ paddingLeft: 16, margin: 0, display: "grid", gap: 6 }}>
            {lifestyle.map((p, i) => (
              <li key={i} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                <strong>{p.name ?? "(unnamed practice)"}</strong>
                {p.cadence && (
                  <span style={{ color: "var(--fm-text-tertiary, #94a3b8)" }}>
                    {" "}
                    · {p.cadence}
                  </span>
                )}
                {p.details && (
                  <div style={{ fontSize: 12, color: "var(--fm-text-secondary, #475569)" }}>
                    {p.details}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Notes for coach */}
      {activePlanSlug && notesForCoach && (
        <section
          style={{
            marginBottom: 24,
            background: "rgba(254,243,199,0.4)",
            border: "1px dashed #f59e0b",
            borderRadius: 10,
            padding: 14,
          }}
        >
          <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 6px", color: "#92400e" }}>
            📝 Notes for coach
          </h2>
          <div
            style={{
              fontSize: 12,
              whiteSpace: "pre-wrap",
              lineHeight: 1.5,
              color: "#78350f",
            }}
          >
            {notesForCoach}
          </div>
        </section>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print, .no-print-flex { display: none !important; }
          body { background: white !important; }
          details > summary { display: none; }
          details > div { display: block !important; }
          a[target="_blank"]::after { content: ""; }
        }
      `}</style>
    </div>
  );
}
