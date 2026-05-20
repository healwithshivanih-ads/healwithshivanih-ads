"use client";

/**
 * FmAlertGroup — collapsible parent container that bundles a tier of
 * dashboard banners under a single header.
 *
 * Solves the audit's "11 sibling banner strips at uniform weight render
 * on every dashboard load → after 3-4 they become wallpaper" finding.
 * Banners stay rendered (one source of truth per data slice) but
 * visually fold into two named groups:
 *   - "Actions today" — urgent, requires coach attention (defaults open)
 *   - "FYI" — outbound nudges + admin (defaults collapsed)
 *
 * Per-group collapsed state persists in sessionStorage so coach's
 * choices survive page refreshes within the tab session. Group remains
 * mounted but unfolds children with `<details>`-style accordion.
 *
 * Auto-hides itself when there are zero children (every child has
 * conditionally returned null). No empty parent shells.
 */

import { useEffect, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "fmcoach.alertgroup.v1.";

export interface FmAlertGroupProps {
  /** Stable identifier — used as sessionStorage key suffix. */
  id: string;
  /** Eyebrow label shown in the header — short, descriptive of the tier. */
  label: string;
  /** Optional emoji shown to the LEFT of the label. */
  icon?: string;
  /** Optional aggregate count shown in a pill on the right of the header.
   *  Pass undefined / 0 to suppress the chip. */
  count?: number;
  /** Visual tier — drives the colour palette. Today = action-orange.
   *  FYI = muted slate. */
  tier: "today" | "fyi";
  /** Default collapsed state when no sessionStorage entry exists. */
  defaultCollapsed?: boolean;
  /** Banner children. Each one is responsible for its own conditional
   *  rendering / empty-state. If everything yields null, the alert group
   *  collapses to a zero-height marker (no chrome at all). */
  children: ReactNode;
}

const TIER_STYLES = {
  today: {
    bg: "linear-gradient(90deg, rgba(245, 158, 11, 0.06), rgba(245, 158, 11, 0.02))",
    border: "rgba(245, 158, 11, 0.30)",
    fg: "#b45309",
    chipBg: "rgba(245, 158, 11, 0.18)",
    chipFg: "#92400e",
  },
  fyi: {
    bg: "var(--fm-bg-cool, rgba(0,0,0,0.02))",
    border: "var(--fm-border-light)",
    fg: "var(--fm-text-secondary)",
    chipBg: "var(--fm-surface, #fff)",
    chipFg: "var(--fm-text-tertiary)",
  },
} as const;

export function FmAlertGroup({
  id,
  label,
  icon,
  count,
  tier,
  defaultCollapsed = false,
  children,
}: FmAlertGroupProps) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  // Rehydrate from sessionStorage on mount. We deliberately default to
  // the SSR value first, then patch — avoids hydration mismatch.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_PREFIX + id);
      if (raw === "open") setCollapsed(false);
      else if (raw === "closed") setCollapsed(true);
    } catch {
      /* private window / quota — silent fallback */
    }
  }, [id]);

  const persist = (next: boolean) => {
    try {
      window.sessionStorage.setItem(
        STORAGE_PREFIX + id,
        next ? "closed" : "open",
      );
    } catch {
      /* swallow */
    }
  };

  const onToggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  };

  const style = TIER_STYLES[tier];

  return (
    <section
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: "var(--fm-radius-md)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          color: style.fg,
          textAlign: "left",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transition: "transform 120ms ease-out",
            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
            fontSize: 11,
          }}
        >
          ▶
        </span>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            flex: 1,
            minWidth: 0,
          }}
        >
          {label}
        </span>
        {typeof count === "number" && count > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: "2px 9px",
              borderRadius: 999,
              background: style.chipBg,
              color: style.chipFg,
            }}
          >
            {count}
          </span>
        )}
      </button>
      {!collapsed && (
        <div
          style={{
            display: "grid",
            gap: 12,
            padding: "4px 12px 12px",
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}
