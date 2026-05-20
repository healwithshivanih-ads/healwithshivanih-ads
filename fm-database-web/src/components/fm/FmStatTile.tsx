/**
 * FmStatTile — labeled number tile used in dashboard stats grid and the
 * body composition / vitals grid on the client overview.
 *
 * The variant `highlight` paints the number primary-orange when there's
 * something the coach needs to attend to (e.g. > 0 in "Need attention").
 *
 * Pass `href` to make the whole tile a clickable link (Server-Component
 * safe — uses next/link). Pass `onClick` for a client-side handler. Both
 * apply `.clickable` styling.
 */
import Link from "next/link";

const STYLES = `
.fm-stat-tile {
  background: var(--fm-surface);
  border: 1px solid var(--fm-border);
  border-radius: var(--fm-radius-md);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  transition: all var(--fm-dur-1) var(--fm-ease-out);
}
.fm-stat-tile.highlight {
  border-color: var(--fm-primary);
  background: var(--fm-bg-warm);
}
.fm-stat-tile.clickable { cursor: pointer; }
.fm-stat-tile.clickable:hover { border-color: var(--fm-border-strong); }
.fm-stat-tile-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--fm-text-tertiary);
  font-weight: 700;
  margin: 0;
}
.fm-stat-tile-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--fm-text-primary);
  line-height: 1;
}
.fm-stat-tile.highlight .fm-stat-tile-value { color: var(--fm-primary); }
.fm-stat-tile-value-unit {
  font-size: 12px;
  font-weight: 600;
  color: var(--fm-text-tertiary);
  margin-left: 3px;
}
.fm-stat-tile-delta {
  font-size: 11px;
  font-weight: 600;
  margin-top: 2px;
  /* Clamp long delta strings to 2 lines so a verbose "why" doesn't
     blow out the tile's height (and through it the page-header column
     width). Coach bug 2026-05-20: a 45-marker labs list ended up here. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  word-break: break-word;
}
.fm-stat-tile-delta.up    { color: var(--fm-secondary); }
.fm-stat-tile-delta.down  { color: var(--fm-success); }
.fm-stat-tile-delta.flat  { color: var(--fm-text-tertiary); }
.fm-stat-tile-delta.warn  { color: var(--fm-primary); }
`;

export interface FmStatTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  /** Optional trend line under the value. */
  delta?: { text: React.ReactNode; trend: "up" | "down" | "flat" | "warn" };
  highlight?: boolean;
  onClick?: () => void;
  /** When set, renders the tile as a next/link. Server-component safe.
   *  Mutually exclusive with onClick (if both set, onClick wins). */
  href?: string;
  /** Optional native title tooltip — useful for breakdown info. */
  title?: string;
}

export function FmStatTile({ label, value, unit, delta, highlight, onClick, href, title }: FmStatTileProps) {
  const classes = ["fm-stat-tile"];
  if (highlight) classes.push("highlight");
  if (onClick || href) classes.push("clickable");
  const inner = (
    <>
      <style>{STYLES}</style>
      <div className="fm-stat-tile-label">{label}</div>
      <div className="fm-stat-tile-value">
        {value}
        {unit && <span className="fm-stat-tile-value-unit">{unit}</span>}
      </div>
      {delta && (
        <div className={`fm-stat-tile-delta ${delta.trend}`}>
          {delta.trend === "up" ? "↑ " : delta.trend === "down" ? "↓ " : delta.trend === "warn" ? "⚠ " : "→ "}
          {delta.text}
        </div>
      )}
    </>
  );
  if (href && !onClick) {
    return (
      <Link
        href={href}
        className={classes.join(" ")}
        title={title}
        style={{ textDecoration: "none", color: "inherit" }}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className={classes.join(" ")} onClick={onClick} title={title}>
      {inner}
    </div>
  );
}

/** Grid wrapper for several stat tiles. */
export function FmStatGrid({ children, cols }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols ?? "auto-fit"}, minmax(140px, 1fr))`,
        gap: "10px",
      }}
    >
      {children}
    </div>
  );
}
