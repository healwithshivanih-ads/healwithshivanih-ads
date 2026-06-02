"use client";

/**
 * FmSidebarNav — 260px gradient secondary (#004E89) left rail.
 *
 * Self-contained: ships its own CSS-in-JS via a <style> tag so the
 * component can be dropped into any page without touching globals.
 *
 * Sections + items are passed in as props so this primitive doesn't
 * know about the app's routes. Phase 1 will wire the real route list.
 */
import Link from "next/link";

export interface FmNavItem {
  /** Stable key, also used to determine active. */
  id: string;
  label: string;
  href: string;
  /** Emoji glyph for now; swap for SVG icons later. */
  icon: string;
  /** Optional badge text (e.g. "3", "new"). */
  badge?: string;
}

export interface FmNavSection {
  label: string;
  items: FmNavItem[];
}

export interface FmSidebarNavProps {
  sections: FmNavSection[];
  /** id of the active item — matched against FmNavItem.id. */
  activeId?: string;
  /** Header brand block. */
  brand?: {
    name: string;
    /** Small uppercase line under the name. */
    eyebrow?: string;
    /** Optional href for the brand link. Defaults to "/". */
    href?: string;
  };
  /** Footer block (e.g. user name, version). */
  footer?: React.ReactNode;
  /** Mobile drawer open state. On desktop the sidebar is always shown. */
  open?: boolean;
  /** Called to close the mobile drawer (backdrop tap, close button, nav tap). */
  onClose?: () => void;
}

const STYLES = `
.fm-sidebar {
  width: var(--fm-sidebar-w, 260px);
  background: linear-gradient(135deg, var(--fm-secondary) 0%, var(--fm-secondary-dark) 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 28px 0 16px;
  overflow-y: auto;
  flex-shrink: 0;
  height: 100vh;
  position: sticky;
  top: 0;
}
.fm-sidebar-header {
  padding: 0 24px 24px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  margin-bottom: 20px;
}
.fm-sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: inherit;
}
.fm-sidebar-brand-mark {
  width: 30px; height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--fm-primary), var(--fm-accent));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
  font-family: var(--fm-font-display);
  font-size: 16px;
  letter-spacing: -0.02em;
}
.fm-sidebar-brand-name {
  font-family: var(--fm-font-display);
  font-size: 18px;
  line-height: 1.1;
  color: #fff;
}
.fm-sidebar-brand-eyebrow {
  margin-top: 4px;
  font-size: 9.5px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: rgba(255,255,255,0.55);
  font-weight: 500;
}
.fm-sidebar-section { padding: 0 14px 22px; }
.fm-sidebar-section-label {
  font-size: 10.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: rgba(255,255,255,0.5);
  font-weight: 700;
  padding: 0 12px 8px;
  margin: 0;
}
.fm-nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  margin: 0 0 3px;
  border-radius: var(--fm-radius-md);
  background: transparent;
  border: 2px solid transparent;
  color: rgba(255,255,255,0.78);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--fm-dur-1) var(--fm-ease-out);
  text-decoration: none;
  font-family: inherit;
  line-height: 1.2;
  width: 100%;
}
.fm-nav-item:hover {
  background: rgba(255,255,255,0.10);
  color: #fff;
}
.fm-nav-item.active {
  background: rgba(255,255,255,0.18);
  color: #fff;
  border-color: var(--fm-accent);
}
.fm-nav-item-icon {
  font-size: 16px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}
.fm-nav-item-label { flex: 1; min-width: 0; }
.fm-nav-item-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: var(--fm-radius-pill);
  background: var(--fm-primary);
  color: #fff;
  margin-left: auto;
}
.fm-sidebar-spacer { flex: 1; }
.fm-sidebar-footer {
  padding: 18px 18px 0;
  margin: 0 12px;
  border-top: 1px solid rgba(255,255,255,0.1);
  font-size: 11.5px;
  color: rgba(255,255,255,0.5);
  text-align: center;
  line-height: 1.5;
}
.fm-sidebar-close {
  display: none;
  position: absolute;
  top: 14px;
  right: 14px;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: none;
  background: rgba(255,255,255,0.14);
  color: #fff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.fm-sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 240;
  border: none;
  padding: 0;
  margin: 0;
}
/* Mobile / small tablet: sidebar becomes an off-canvas drawer. */
@media (max-width: 820px) {
  .fm-sidebar {
    position: fixed;
    left: 0;
    top: 0;
    height: 100vh;
    height: 100dvh;
    width: min(82vw, 300px);
    z-index: 250;
    transform: translateX(-100%);
    transition: transform 0.25s var(--fm-ease-out, ease);
    box-shadow: 2px 0 24px rgba(0,0,0,0.35);
  }
  .fm-sidebar.fm-sidebar--open { transform: translateX(0); }
  .fm-sidebar-close { display: inline-flex; align-items: center; justify-content: center; }
  .fm-sidebar-backdrop.fm-sidebar-backdrop--show { display: block; }
}
`;

export function FmSidebarNav({
  sections,
  activeId,
  brand,
  footer,
  open,
  onClose,
}: FmSidebarNavProps) {
  return (
    <>
      <div
        className={`fm-sidebar-backdrop${open ? " fm-sidebar-backdrop--show" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`fm-sidebar${open ? " fm-sidebar--open" : ""}`}>
      <style>{STYLES}</style>
      <button
        type="button"
        className="fm-sidebar-close"
        onClick={onClose}
        aria-label="Close menu"
      >
        ✕
      </button>
      {brand && (
        <div className="fm-sidebar-header">
          <Link href={brand.href ?? "/"} className="fm-sidebar-brand">
            <span className="fm-sidebar-brand-mark">fm</span>
            <span>
              <div className="fm-sidebar-brand-name">{brand.name}</div>
              {brand.eyebrow && (
                <div className="fm-sidebar-brand-eyebrow">{brand.eyebrow}</div>
              )}
            </span>
          </Link>
        </div>
      )}
      {sections.map((section, si) => (
        <div className="fm-sidebar-section" key={si}>
          <p className="fm-sidebar-section-label">{section.label}</p>
          {section.items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              onClick={onClose}
              className={`fm-nav-item${activeId === item.id ? " active" : ""}`}
            >
              <span className="fm-nav-item-icon">{item.icon}</span>
              <span className="fm-nav-item-label">{item.label}</span>
              {item.badge && <span className="fm-nav-item-badge">{item.badge}</span>}
            </Link>
          ))}
        </div>
      ))}
      <div className="fm-sidebar-spacer" />
      {footer && <div className="fm-sidebar-footer">{footer}</div>}
      </aside>
    </>
  );
}
