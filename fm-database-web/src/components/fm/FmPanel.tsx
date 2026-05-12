/**
 * FmPanel — the workhorse content surface.
 *
 * White card, soft border, optional title row. Used everywhere a section
 * of content needs structure (clinical summary, body comp, FM markers,
 * triage section, plan phase, etc.).
 */

const STYLES = `
.fm-panel {
  background: var(--fm-surface);
  border: 1px solid var(--fm-border);
  border-radius: var(--fm-radius-lg);
  padding: 22px;
  transition: border-color var(--fm-dur-1) var(--fm-ease-out);
}
.fm-panel.accent-primary  { border-color: var(--fm-primary); }
.fm-panel.accent-secondary{ border-color: var(--fm-secondary); }
.fm-panel.warm            { background: linear-gradient(135deg, var(--fm-bg-warm) 0%, var(--fm-surface) 70%); }
.fm-panel.cool            { background: var(--fm-bg-cool); }
.fm-panel.flat            { padding: 0; }
.fm-panel-title-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.fm-panel-title-row.tight { margin-bottom: 8px; }
.fm-panel-title {
  margin: 0 0 2px;
  font-size: 14px;
  font-weight: 700;
  color: var(--fm-text-primary);
  font-family: var(--fm-font-body);
  letter-spacing: 0.01em;
  text-transform: uppercase;
}
.fm-panel-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--fm-text-secondary);
  line-height: 1.5;
  font-weight: 400;
}
.fm-panel-content { display: grid; gap: 10px; }
.fm-info-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  font-size: 12.5px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--fm-border-light);
}
.fm-info-row:last-child { border-bottom: none; }
.fm-info-label {
  color: var(--fm-text-tertiary);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.fm-info-value { color: var(--fm-text-primary); }
`;

export interface FmPanelProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned slot in the title row (button, count badge). */
  rightSlot?: React.ReactNode;
  /** Accent color modifier. */
  accent?: "primary" | "secondary" | "warm" | "cool";
  /** Tight title spacing (for compact panels). */
  tight?: boolean;
  /** No padding (for tables / lists that paint to edges). */
  flat?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function FmPanel({
  title,
  subtitle,
  rightSlot,
  accent,
  tight,
  flat,
  className,
  style,
  children,
}: FmPanelProps) {
  const classes = ["fm-panel"];
  if (accent) classes.push(accent === "primary" ? "accent-primary" : accent === "secondary" ? "accent-secondary" : accent);
  if (flat) classes.push("flat");
  if (className) classes.push(className);
  return (
    <section className={classes.join(" ")} style={style}>
      <style>{STYLES}</style>
      {(title || subtitle || rightSlot) && (
        <div className={`fm-panel-title-row${tight ? " tight" : ""}`}>
          <div>
            {title && <h3 className="fm-panel-title">{title}</h3>}
            {subtitle && <p className="fm-panel-subtitle">{subtitle}</p>}
          </div>
          {rightSlot && <div>{rightSlot}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Convenience row inside FmPanel content. */
export function FmInfoRow({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="fm-info-row">
      <span className="fm-info-label">{label}</span>
      <span className="fm-info-value">{value}</span>
    </div>
  );
}
