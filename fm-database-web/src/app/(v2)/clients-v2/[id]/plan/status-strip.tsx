"use client";

/**
 * StatusStrip — compact Plan-tab header row (2026-06-15 redesign).
 *
 * Replaces the tall FmWorkflowBanner + the separate full-width
 * PlanConflictPanel and FmRecheckPanel. One scannable row:
 *
 *   ● Plan active · {slug} | Week 5 of 12 · N days in | ↻ next follow-up
 *     …………………………………………………………… [⚠ N to review ▾]  [Welcome letter →]
 *
 * Conflicts + recheck don't disappear — they fold into the expandable
 * "N to review" pill, rendered as `children` so the real interactive
 * panels (PlanConflictPanel one-click fixes, FmRecheckPanel 5-step flow)
 * keep every affordance. Nothing is lost; it's just collapsed by default.
 *
 * Draft / recheck states reuse the same chrome — only the dot tone, the
 * label, and the trailing action change.
 */

import { useState } from "react";
import Link from "next/link";

export type StatusTone = "active" | "draft" | "recheck" | "none";

const TONE: Record<StatusTone, { dot: string; ring: string; label: string }> = {
  active: { dot: "#2E9E5F", ring: "rgba(46,158,95,0.18)", label: "Plan active" },
  draft: { dot: "var(--fm-warning)", ring: "rgba(243,156,18,0.18)", label: "Draft" },
  recheck: { dot: "var(--fm-primary)", ring: "rgba(255,107,53,0.18)", label: "Re-check due" },
  none: { dot: "var(--fm-text-tertiary)", ring: "rgba(120,113,108,0.18)", label: "No plan" },
};

export interface StatusStripProps {
  tone: StatusTone;
  /** Overrides the default label for the tone (e.g. "Ready to publish"). */
  label?: string;
  slug?: string;
  /** e.g. "Week 5 of 12 · 33 days in" — omitted when no plan-period dates. */
  weekLabel?: string;
  /** ISO date of the next follow-up / recheck. */
  followDate?: string;
  /** Count shown on the amber pill; pill hidden when 0 and no children. */
  alertCount?: number;
  /** Trailing right-side action (e.g. "Welcome letter →" or activate). */
  trailing?: React.ReactNode;
  /**
   * Folded behind the "N to review" pill — the real PlanConflictPanel +
   * FmRecheckPanel live here so no functionality is lost.
   */
  children?: React.ReactNode;
}

function humanDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function StatusStrip({
  tone,
  label,
  slug,
  weekLabel,
  followDate,
  alertCount = 0,
  trailing,
  children,
}: StatusStripProps) {
  const [open, setOpen] = useState(false);
  const t = TONE[tone];
  const hasAlerts = alertCount > 0 && !!children;

  return (
    <div className="fm-status-strip">
      <div className="fm-status-strip-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: t.dot,
              boxShadow: `0 0 0 3px ${t.ring}`,
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 14 }}>{label ?? t.label}</span>
          {slug && (
            <span
              style={{
                fontFamily: "var(--fm-font-mono)",
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                background: "var(--fm-bg-cool)",
                border: "1px solid var(--fm-border-light)",
                padding: "2px 7px",
                borderRadius: "var(--fm-radius-sm)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 280,
              }}
              title={slug}
            >
              {slug}
            </span>
          )}
        </div>

        {weekLabel && (
          <>
            <div className="fm-status-strip-div" />
            <div className="fm-status-meta">{weekLabel}</div>
          </>
        )}

        {followDate && (
          <>
            <div className="fm-status-strip-div" />
            <div className="fm-status-meta">
              ↻ Next follow-up{" "}
              <b style={{ color: "var(--fm-text-primary)" }}>{humanDate(followDate)}</b>
            </div>
          </>
        )}

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {hasAlerts && (
            <button
              type="button"
              className="fm-status-alert-pill"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              ⚠ {alertCount} to review
              <span
                style={{
                  display: "inline-block",
                  transition: "transform .15s",
                  transform: open ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                ▾
              </span>
            </button>
          )}
          {trailing}
        </div>
      </div>

      {hasAlerts && open && <div className="fm-status-alert-body">{children}</div>}
    </div>
  );
}

/** Convenience link used as a StatusStrip trailing action. */
export function StatusStripLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        color: "var(--fm-text-secondary)",
        borderRadius: "var(--fm-radius-md)",
        padding: "6px 12px",
        fontSize: 12,
        textDecoration: "none",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  );
}
