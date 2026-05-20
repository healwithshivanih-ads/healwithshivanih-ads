"use client";

/**
 * FmCollapsibleStep — wraps an assess input section so it collapses to a
 * 1-line summary chip once the coach is done with it. Reduces vertical
 * scroll on the left column when the coach is reviewing later steps.
 *
 * Open/collapsed state is persisted to localStorage per-step so the
 * coach's preference survives reloads. Open by default unless the
 * caller opts in to `defaultOpen={false}` (rare — used by sections
 * that always start filled, e.g. the intake recap).
 *
 * Usage:
 *
 *   <FmCollapsibleStep
 *     title="🎯 Symptoms + conditions to focus on"
 *     subtitle="Pre-loaded from the most recent intake."
 *     summary={`${symptoms.length} symptoms · ${topics.length} topics`}
 *     storageKey="assess-symptoms"
 *   >
 *     <SlugMultiPicker ... />
 *   </FmCollapsibleStep>
 */
import { useEffect, useState } from "react";
import { FmPanel } from "./FmPanel";

export interface FmCollapsibleStepProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /**
   * 1-line summary rendered when the step is collapsed. Should answer
   * "what's in this section now?" — e.g. "4 symptoms · 3 topics".
   */
  summary: React.ReactNode;
  /**
   * localStorage key. Different steps should use different keys so
   * each can be collapsed independently. Prefix with "fm-step-" for
   * clarity.
   */
  storageKey: string;
  /** Default open state on first mount (before localStorage hydrates). */
  defaultOpen?: boolean;
  children: React.ReactNode;
  /** Pass-through to FmPanel. */
  accent?: "primary" | "secondary" | "warm" | "cool";
  /** Pass-through to FmPanel's rightSlot when expanded. */
  rightSlot?: React.ReactNode;
}

export function FmCollapsibleStep({
  title,
  subtitle,
  summary,
  storageKey,
  defaultOpen = true,
  children,
  accent,
  rightSlot,
}: FmCollapsibleStepProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once.
  useEffect(() => {
    if (hydrated) return;
    setHydrated(true);
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "0") setOpen(false);
      else if (saved === "1") setOpen(true);
    } catch {
      /* privacy mode / quota — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem(storageKey, v ? "1" : "0"); } catch {}
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpenPersist(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 14px",
          background: "var(--fm-surface, #fff)",
          border: "1px solid var(--fm-border-light, #f0f0f0)",
          borderRadius: "var(--fm-radius-md, 8px)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
        title="Click to expand this step"
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "rgba(46, 204, 113, 0.15)",
            color: "#1E8449",
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          ✓
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--fm-text-primary, #1a1a1a)",
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--fm-text-secondary, #5a5a5a)",
              marginTop: 1,
            }}
          >
            {summary}
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary, #999)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          expand ▼
        </span>
      </button>
    );
  }

  return (
    <FmPanel
      title={title}
      subtitle={subtitle}
      accent={accent}
      rightSlot={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {rightSlot}
          <button
            type="button"
            onClick={() => setOpenPersist(false)}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--fm-text-tertiary, #999)",
              background: "transparent",
              border: "1px solid var(--fm-border, #e8e8e8)",
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            title="Collapse this step (your selection is preserved)"
          >
            collapse ▲
          </button>
        </div>
      }
    >
      {children}
    </FmPanel>
  );
}
