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
    <div className="fm-grouped-panel">
      <style>{GROUPED_PANEL_CSS}</style>

      {/* Header band — eyebrow title + (tabbed mode) tab strip. Sits on a
          cool-grey band with a divider so it visually OWNS the body
          below instead of floating disconnected above it. */}
      <div className="fm-grouped-head">
        <span className="fm-grouped-title">
          {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
          {title}
        </span>
        {visibleTabs.length > 0 && (
          <div className="fm-grouped-tabs">
            {visibleTabs.map((t) => {
              const isActive = t.id === activeId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTab(t.id)}
                  className={`fm-grouped-tab${isActive ? " is-active" : ""}`}
                >
                  {t.icon ? `${t.icon} ` : ""}
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Body — the active child. The CSS below flattens the child's own
          card chrome (border / radius / shadow / outer margin) so it
          merges seamlessly into this panel instead of nesting a
          card-inside-a-card. */}
      <div className="fm-grouped-body">
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
    </div>
  );
}

/* One scoped stylesheet for every FmGroupedPanel instance. The child-
   flattening rules use `!important` so they beat the children's inline
   `style={{ border: ... }}` — a stylesheet !important rule outranks an
   inline declaration that lacks !important. This is what turns "floating
   title above a separate card" into one connected panel. */
const GROUPED_PANEL_CSS = `
.fm-grouped-panel {
  border: 1px solid var(--fm-border);
  border-radius: var(--fm-radius-md);
  background: var(--fm-surface);
  overflow: hidden;
}
.fm-grouped-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  background: var(--fm-bg-cool);
  border-bottom: 1px solid var(--fm-border-light);
}
.fm-grouped-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--fm-text-tertiary);
  white-space: nowrap;
}
.fm-grouped-tabs {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.fm-grouped-tab {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--fm-radius-pill);
  padding: 3px 10px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  color: var(--fm-text-tertiary);
  cursor: pointer;
  white-space: nowrap;
}
.fm-grouped-tab.is-active {
  background: var(--fm-surface);
  border-color: var(--fm-border);
  font-weight: 700;
  color: var(--fm-primary);
}
.fm-grouped-body {
  padding: 12px;
}
/* Flatten the immediate child card so it merges into the panel. The
   child is either a tab wrapper (>div) holding the card, or — in
   plain-stack mode — the cards directly. Strip border / radius /
   shadow / outer margin at the first two levels so any single-card
   child sheds its own chrome; deeper nested content is untouched. */
.fm-grouped-body > div > .FmPanel,
.fm-grouped-body > div > div[style],
.fm-grouped-body > .FmPanel,
.fm-grouped-body > div[style] {
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  margin: 0 !important;
  background: transparent !important;
}
`;
