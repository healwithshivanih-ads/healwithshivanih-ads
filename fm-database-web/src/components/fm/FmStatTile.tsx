/**
 * FmStatTile — labeled number tile used in dashboard stats grid and the
 * body composition / vitals grid on the client overview.
 *
 * The variant `highlight` paints the number primary-orange when there's
 * something the coach needs to attend to (e.g. > 0 in "Need attention").
 */

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
}

export function FmStatTile({ label, value, unit, delta, highlight, onClick }: FmStatTileProps) {
  const classes = ["fm-stat-tile"];
  if (highlight) classes.push("highlight");
  if (onClick) classes.push("clickable");
  return (
    <div className={classes.join(" ")} onClick={onClick}>
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
