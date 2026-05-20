"use client";

/**
 * FmSupplementGrid — visual timing chart + detail list for the Plan tab's
 * supplement protocol. Replaces the flat "name · dose · timing" rows.
 *
 * Two surfaces, stacked:
 *   1. Daily timing bubble row — 7 canonical slots (Early Morning → Bedtime).
 *      Each slot shows a circle with the count of supplements assigned to
 *      that time. Orange-gradient when populated, neutral when empty.
 *      Coach can click a bubble to filter the detail list below.
 *   2. Detail list — one row per supplement with name + dose + timing slot
 *      chip + coach rationale + form. Click a row to expand the rationale.
 *
 * Slot classification mirrors render-client-letter.py's _TIMING_SLOTS —
 * same regex keywords on the supplement's `timing` string so the letter
 * and the coach view bucket each supplement identically.
 *
 * Design source: FM Backlog Explorations · Group D4.
 */
import { useMemo, useState } from "react";
import { stripBrand } from "@/lib/fmdb/supplement-display";

export interface FmSupplementGridItem {
  /** Catalogue slug — used as the primary identifier + display fallback. */
  supplement_slug: string;
  /** Free-text dose (e.g. "5000 IU", "200 mcg", "400 mg"). */
  dose?: string;
  /** Free-text timing — classified into one of 7 slots by keyword match. */
  timing?: string;
  /** Form (e.g. "capsule", "powder") — small caption next to dose. */
  form?: string;
  /** Coach-only rationale; rendered as expandable detail. */
  coach_rationale?: string;
  /** Optional explicit "took today" markers — for future adherence integration. */
  duration_weeks?: number | null;
}

export interface FmSupplementGridProps {
  items: FmSupplementGridItem[];
}

interface SlotDef {
  idx: number;
  label: string;
  short: string;
  emoji: string;
  keywords: string[];
}

// Mirrors render-client-letter.py::_TIMING_SLOTS. Keep in sync — both
// surfaces classify the same `timing` string the same way.
const SLOTS: SlotDef[] = [
  {
    idx: 0,
    label: "Early Morning",
    short: "Early AM",
    emoji: "🌅",
    keywords: ["early morning", "empty stomach", "fasting", "before breakfast", "wake"],
  },
  {
    idx: 1,
    label: "With Breakfast",
    short: "Breakfast",
    emoji: "☀️",
    keywords: ["breakfast", "morning", "with food", "8 am", "7 am", "9 am", " am"],
  },
  {
    idx: 2,
    label: "Mid-Morning",
    short: "Mid-AM",
    emoji: "🕙",
    keywords: ["mid-morning", "mid morning", "10 am", "between meals", "snack"],
  },
  {
    idx: 3,
    label: "With Lunch",
    short: "Lunch",
    emoji: "🥗",
    keywords: ["lunch", "midday", "noon", "1 pm", "12 pm"],
  },
  {
    idx: 4,
    label: "Afternoon",
    short: "PM",
    emoji: "🌤",
    keywords: ["afternoon", "2 pm", "3 pm", "4 pm"],
  },
  {
    idx: 5,
    label: "With Dinner",
    short: "Dinner",
    emoji: "🌆",
    keywords: ["dinner", "evening meal", "supper", "6 pm", "7 pm", "5 pm", "with evening"],
  },
  {
    idx: 6,
    label: "Before Bed",
    short: "Bedtime",
    emoji: "🌙",
    keywords: ["bedtime", "before bed", "night", "sleep", "9 pm", "10 pm", "before sleep"],
  },
];

function classifySlot(timing: string | undefined): SlotDef {
  const t = (timing ?? "").toLowerCase();
  for (const s of SLOTS) {
    if (s.keywords.some((kw) => t.includes(kw))) return s;
  }
  // Default → With Breakfast (matches Python helper).
  return SLOTS[1];
}

function prettySlug(slug: string): string {
  // Title-case + strip ALL known brand prefixes (Vitaone, Himalaya,
  // Organic India, Now Foods, Thorne, etc.) via the shared helper so
  // every supplement surface in the app is consistent (B-update
  // 2026-05-19). Was previously only stripping `vitaone-`.
  const titled = slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return stripBrand(titled);
}

export function FmSupplementGrid({ items }: FmSupplementGridProps) {
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Bucket each item into its slot. Memo because items list can change
  // when coach edits the plan.
  const bySlot = useMemo(() => {
    const m: Record<number, FmSupplementGridItem[]> = {};
    for (const s of SLOTS) m[s.idx] = [];
    for (const it of items) {
      const slot = classifySlot(it.timing);
      m[slot.idx].push(it);
    }
    return m;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeSlot == null) return items;
    return items.filter((it) => classifySlot(it.timing).idx === activeSlot);
  }, [items, activeSlot]);

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: "12px 14px",
          background: "var(--fm-bg-cool)",
          borderRadius: "var(--fm-radius-sm)",
          fontSize: 12,
          color: "var(--fm-text-tertiary)",
        }}
      >
        No supplements in the protocol yet.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Timing bubble row — 7 slots */}
      <div
        style={{
          padding: "14px 12px 16px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border-light)",
          borderRadius: "var(--fm-radius-md)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--fm-text-secondary)",
            }}
          >
            Daily timing · 7-slot
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
            }}
          >
            {activeSlot == null
              ? "Click a slot to filter the list below"
              : "Click again or × to clear filter"}
            {activeSlot != null && (
              <button
                type="button"
                onClick={() => setActiveSlot(null)}
                style={{
                  marginLeft: 8,
                  padding: "2px 8px",
                  fontSize: 10,
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-pill)",
                  background: "var(--fm-surface)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "var(--fm-text-secondary)",
                }}
              >
                Clear ×
              </button>
            )}
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
          }}
        >
          {SLOTS.map((slot) => {
            const count = bySlot[slot.idx].length;
            const isActive = activeSlot === slot.idx;
            const hasItems = count > 0;
            return (
              <button
                type="button"
                key={slot.idx}
                onClick={() =>
                  setActiveSlot((cur) => (cur === slot.idx ? null : slot.idx))
                }
                disabled={!hasItems}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  background: "transparent",
                  border: 0,
                  cursor: hasItems ? "pointer" : "default",
                  fontFamily: "inherit",
                  padding: 0,
                }}
                title={slot.label}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: isActive
                      ? "var(--fm-primary)"
                      : "var(--fm-text-tertiary)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    height: 14,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {slot.short}
                </span>
                <span
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: hasItems
                      ? isActive
                        ? "linear-gradient(135deg, #2B2D42, #1A1B2A)"
                        : "linear-gradient(135deg, var(--fm-primary), #E65527)"
                      : "var(--fm-bg-cool)",
                    color: hasItems ? "#fff" : "var(--fm-text-tertiary)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: hasItems ? 19 : 11,
                    fontWeight: 700,
                    boxShadow: hasItems
                      ? "0 4px 10px rgba(255, 107, 53, 0.25)"
                      : "none",
                    transition: "transform 140ms ease, box-shadow 140ms ease",
                    transform: isActive ? "scale(1.08)" : "scale(1)",
                  }}
                >
                  {hasItems ? count : "—"}
                </span>
                <span style={{ fontSize: 13, lineHeight: 1 }}>{slot.emoji}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail list — name · dose · timing chip · rationale */}
      <div style={{ display: "grid", gap: 6 }}>
        {filteredItems.length === 0 ? (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--fm-bg-cool)",
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 12,
              color: "var(--fm-text-tertiary)",
            }}
          >
            No supplements in this slot.
          </div>
        ) : (
          filteredItems.map((it, i) => {
            const slot = classifySlot(it.timing);
            const key = `${it.supplement_slug}-${i}`;
            const isExp = expanded[key];
            const hasRationale =
              !!it.coach_rationale && it.coach_rationale.trim().length > 0;
            return (
              <div
                key={key}
                style={{
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    hasRationale
                      ? setExpanded((s) => ({ ...s, [key]: !s[key] }))
                      : undefined
                  }
                  disabled={!hasRationale}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto auto",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "9px 12px",
                    background: "transparent",
                    border: 0,
                    cursor: hasRationale ? "pointer" : "default",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--fm-text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {prettySlug(it.supplement_slug)}
                      {it.dose && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--fm-text-secondary)",
                            marginLeft: 8,
                          }}
                        >
                          · {it.dose}
                        </span>
                      )}
                      {it.form && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--fm-text-tertiary)",
                            marginLeft: 6,
                            fontWeight: 500,
                          }}
                        >
                          ({it.form})
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--fm-text-tertiary)",
                        fontFamily: "var(--fm-font-mono)",
                        marginTop: 1,
                      }}
                    >
                      {it.supplement_slug}
                      {typeof it.duration_weeks === "number" &&
                        it.duration_weeks > 0 && (
                          <>
                            <span style={{ margin: "0 5px" }}>·</span>
                            {it.duration_weeks} wk
                            {it.duration_weeks === 1 ? "" : "s"}
                          </>
                        )}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "3px 9px",
                      borderRadius: "var(--fm-radius-pill)",
                      background: "rgba(255, 107, 53, 0.10)",
                      color: "var(--fm-primary)",
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {slot.emoji} {slot.short}
                  </span>
                  {hasRationale && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--fm-text-tertiary)",
                        transform: isExp ? "rotate(0deg)" : "rotate(-90deg)",
                        transition: "transform 160ms",
                        width: 12,
                        display: "inline-block",
                        textAlign: "center",
                      }}
                    >
                      ▾
                    </span>
                  )}
                  {!hasRationale && <span style={{ width: 12 }} />}
                </button>
                {isExp && hasRationale && (
                  <div
                    style={{
                      padding: "0 12px 12px 12px",
                      fontSize: 12,
                      lineHeight: 1.55,
                      color: "var(--fm-text-secondary)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {it.coach_rationale}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
