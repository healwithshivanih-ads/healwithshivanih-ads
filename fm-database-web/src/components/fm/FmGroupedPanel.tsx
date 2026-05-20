"use client";

/**
 * FmGroupedPanel — groups several related sub-panels under one tab strip.
 *
 * Built for the Client Overview right-rail re-architecture (Wave J,
 * 2026-05-20). The right column had stacked 11 separate panels ~2,000px
 * tall; this folds them into 4 groups. Tabbed groups show one sub-panel
 * at a time so the rail stays short.
 *
 * CHROME-LIGHT BY DESIGN.
 * The grouped children (IntakeProgressCard, WeightLossCard, FmPanel-based
 * cards, etc.) each already render their own border + padding. If this
 * component drew its own card border too, every group would be a
 * card-in-card with doubled edges — the exact visual noise we're
 * removing. So FmGroupedPanel renders ONLY an eyebrow title + a tab
 * strip; the active child renders full-bleed with its native chrome.
 *
 * INACTIVE TABS STAY MOUNTED.
 * We render every tab's content and `display:none` the inactive ones
 * rather than conditionally rendering only the active tab. Several
 * children hold local React state (ClientMemoryPanel inline edits,
 * WeightLossCard modal, IntakeInsightsCard fetch) — unmounting on
 * tab-switch would silently drop unsaved work. Hiding-not-unmounting
 * costs a little DOM weight but is correctness-safe.
 *
 * Active-tab choice persists per-panel in sessionStorage.
 */

import { useEffect, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "fmcoach.groupedpanel.v1.";

export interface FmGroupedTab {
  id: string;
  label: string;
  icon?: string;
  content: ReactNode;
  /** When false the tab is hidden entirely. */
  show?: boolean;
}

export interface FmGroupedPanelProps {
  /** Stable id — sessionStorage key suffix for active-tab memory. */
  id: string;
  /** Eyebrow title above the tab strip. */
  title: string;
  /** Optional emoji before the title. */
  icon?: string;
  /** Tabbed mode. */
  tabs?: FmGroupedTab[];
  /** Plain-stack mode (no tab strip) — children stacked under the title. */
  children?: ReactNode;
}

export function FmGroupedPanel({
  id,
  title,
  icon,
  tabs,
  children,
}: FmGroupedPanelProps) {
  const visibleTabs = (tabs ?? []).filter((t) => t.show !== false);
  const [activeId, setActiveId] = useState<string>(visibleTabs[0]?.id ?? "");

  useEffect(() => {
    if (visibleTabs.length === 0) return;
    try {
      const stored = window.sessionStorage.getItem(STORAGE_PREFIX + id);
      if (stored && visibleTabs.some((t) => t.id === stored)) {
        setActiveId(stored);
      }
    } catch {
      /* private window — silent */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pickTab = (tabId: string) => {
    setActiveId(tabId);
    try {
      window.sessionStorage.setItem(STORAGE_PREFIX + id, tabId);
    } catch {
      /* swallow */
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Eyebrow title + (tabbed mode) tab strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--fm-text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
          {title}
        </span>
        {visibleTabs.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 2,
              flexWrap: "wrap",
              flex: 1,
              minWidth: 0,
            }}
          >
            {visibleTabs.map((t) => {
              const isActive = t.id === activeId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTab(t.id)}
                  style={{
                    appearance: "none",
                    background: isActive ? "var(--fm-surface)" : "transparent",
                    border: `1px solid ${
                      isActive ? "var(--fm-border)" : "transparent"
                    }`,
                    borderRadius: "var(--fm-radius-pill)",
                    padding: "3px 10px",
                    fontFamily: "inherit",
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive
                      ? "var(--fm-primary)"
                      : "var(--fm-text-tertiary)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.icon ? `${t.icon} ` : ""}
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Body — active child keeps its own native card chrome */}
      {visibleTabs.length > 0 ? (
        visibleTabs.map((t) => (
          <div
            key={t.id}
            style={{ display: t.id === activeId ? "block" : "none" }}
          >
            {t.content}
          </div>
        ))
      ) : (
        <div style={{ display: "grid", gap: 12 }}>{children}</div>
      )}
    </div>
  );
}
