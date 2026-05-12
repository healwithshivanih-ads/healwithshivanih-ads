"use client";

/**
 * FmTopBar — 64px sticky top bar with breadcrumbs + ⌘K search trigger + user.
 *
 * The search trigger is a button (no input field here) — clicking it should
 * open the existing /search route or a command palette. Phase 1 will wire
 * the real ⌘K handler.
 */
import Link from "next/link";

export interface FmBreadcrumb {
  label: string;
  /** Omit for the current/last segment. */
  href?: string;
}

export interface FmTopBarProps {
  crumbs?: FmBreadcrumb[];
  /** Right-aligned action shown next to the search button. */
  rightSlot?: React.ReactNode;
  /** Called when the search button or ⌘K is pressed. */
  onSearchClick?: () => void;
  /** Override the user label (initials, name). */
  user?: { initials: string; name?: string };
}

const STYLES = `
.fm-topbar {
  height: var(--fm-topbar-h, 64px);
  background: var(--fm-surface);
  border-bottom: 1px solid var(--fm-border);
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 28px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
}
.fm-topbar-crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--fm-text-secondary);
  flex: 1;
  min-width: 0;
}
.fm-topbar-crumb {
  color: var(--fm-text-secondary);
  text-decoration: none;
  white-space: nowrap;
}
.fm-topbar-crumb:hover { color: var(--fm-text-primary); }
.fm-topbar-crumb.current {
  color: var(--fm-text-primary);
  font-weight: 600;
}
.fm-topbar-crumb-sep {
  color: var(--fm-text-tertiary);
  opacity: 0.6;
  font-size: 11px;
}
.fm-topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.fm-topbar-search {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  font-size: 12.5px;
  color: var(--fm-text-secondary);
  background: var(--fm-surface-2);
  border: 1px solid var(--fm-border);
  border-radius: var(--fm-radius-md);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--fm-dur-1) var(--fm-ease-out);
  min-width: 200px;
}
.fm-topbar-search:hover {
  background: var(--fm-surface);
  border-color: var(--fm-border-strong);
}
.fm-topbar-search-icon { font-size: 13px; }
.fm-topbar-search-placeholder { flex: 1; text-align: left; color: var(--fm-text-tertiary); }
.fm-topbar-search-kbd {
  font-family: var(--fm-font-mono);
  font-size: 10px;
  color: var(--fm-text-tertiary);
  padding: 2px 6px;
  background: var(--fm-surface);
  border: 1px solid var(--fm-border);
  border-radius: 3px;
}
.fm-topbar-user {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--fm-secondary), var(--fm-secondary-dark));
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
  cursor: pointer;
}
`;

export function FmTopBar({ crumbs, rightSlot, onSearchClick, user }: FmTopBarProps) {
  return (
    <header className="fm-topbar">
      <style>{STYLES}</style>
      <div className="fm-topbar-crumbs">
        {(crumbs ?? []).map((c, i, arr) => {
          const isLast = i === arr.length - 1;
          return (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              {c.href && !isLast ? (
                <Link href={c.href} className="fm-topbar-crumb">
                  {c.label}
                </Link>
              ) : (
                <span className={`fm-topbar-crumb${isLast ? " current" : ""}`}>{c.label}</span>
              )}
              {!isLast && <span className="fm-topbar-crumb-sep">›</span>}
            </span>
          );
        })}
      </div>
      <div className="fm-topbar-actions">
        <button
          type="button"
          className="fm-topbar-search"
          onClick={onSearchClick}
          aria-label="Search"
        >
          <span className="fm-topbar-search-icon">⌕</span>
          <span className="fm-topbar-search-placeholder">Search clients, catalogue…</span>
          <span className="fm-topbar-search-kbd">⌘K</span>
        </button>
        {rightSlot}
        <span className="fm-topbar-user" title={user?.name ?? "Shivani Hari"}>
          {user?.initials ?? "SH"}
        </span>
      </div>
    </header>
  );
}
