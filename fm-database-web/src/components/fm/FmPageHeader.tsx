/**
 * FmPageHeader — display-serif title + subtitle + optional right slot.
 *
 * Sits below the topbar at the top of every page. Pure layout — no state.
 */

const STYLES = `
.fm-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  margin-bottom: 32px;
}
.fm-page-header-title-wrap { min-width: 0; }
.fm-page-header-title {
  font-family: var(--fm-font-display);
  font-size: 32px;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--fm-text-primary);
  margin: 0 0 6px;
  font-weight: 400;
}
.fm-page-header-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--fm-text-secondary);
  line-height: 1.55;
}
.fm-page-header-right { flex-shrink: 0; }
`;

export interface FmPageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned slot (stats grid, action buttons, etc.). */
  rightSlot?: React.ReactNode;
  /** Override the heading element (default h1). Useful for nested page headers (use h2). */
  as?: "h1" | "h2" | "h3";
  /** Tighter font-size for nested headers. */
  size?: "lg" | "md" | "sm";
}

export function FmPageHeader({
  title,
  subtitle,
  rightSlot,
  as: As = "h1",
  size = "lg",
}: FmPageHeaderProps) {
  const fontSize = size === "lg" ? 32 : size === "md" ? 24 : 20;
  return (
    <div className="fm-page-header">
      <style>{STYLES}</style>
      <div className="fm-page-header-title-wrap">
        <As className="fm-page-header-title" style={{ fontSize: `${fontSize}px` }}>
          {title}
        </As>
        {subtitle && <p className="fm-page-header-subtitle">{subtitle}</p>}
      </div>
      {rightSlot && <div className="fm-page-header-right">{rightSlot}</div>}
    </div>
  );
}
