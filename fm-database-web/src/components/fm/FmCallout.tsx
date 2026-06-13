/**
 * FmCallout — a semantic, tinted notice box.
 *
 * Replaces the hand-rolled inline rgba() callouts scattered across the coach
 * pages (green "activate" rows, violet "pending draft" banners, red conflict
 * boxes) with one tone-driven primitive so they look consistent and stop
 * inventing one-off colours. Tones map to the --fm-* semantic tokens via
 * color-mix, so they track the design system.
 */

const STYLES = `
.fm-callout {
  display: flex;
  gap: 11px;
  align-items: flex-start;
  padding: 11px 14px;
  border-radius: var(--fm-radius-md);
  border: 1.5px solid var(--fm-border);
  background: var(--fm-bg-cool);
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--fm-text-secondary);
}
.fm-callout-icon { font-size: 16px; line-height: 1.35; flex-shrink: 0; }
.fm-callout-body { flex: 1; min-width: 0; display: grid; gap: 5px; }
.fm-callout-title { font-weight: 700; font-size: 13px; color: var(--fm-text-primary); }
.fm-callout-actions { flex-shrink: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.fm-callout.tone-success { background: color-mix(in srgb, var(--fm-success) 8%, var(--fm-surface)); border-color: color-mix(in srgb, var(--fm-success) 38%, transparent); }
.fm-callout.tone-success .fm-callout-title { color: color-mix(in srgb, var(--fm-success) 75%, #000); }
.fm-callout.tone-warning { background: color-mix(in srgb, var(--fm-warning) 10%, var(--fm-surface)); border-color: color-mix(in srgb, var(--fm-warning) 42%, transparent); }
.fm-callout.tone-warning .fm-callout-title { color: color-mix(in srgb, var(--fm-warning) 78%, #000); }
.fm-callout.tone-danger  { background: color-mix(in srgb, var(--fm-danger) 7%, var(--fm-surface)); border-color: color-mix(in srgb, var(--fm-danger) 32%, transparent); }
.fm-callout.tone-danger .fm-callout-title { color: var(--fm-danger); }
.fm-callout.tone-info    { background: color-mix(in srgb, var(--fm-secondary) 7%, var(--fm-surface)); border-color: color-mix(in srgb, var(--fm-secondary) 30%, transparent); }
.fm-callout.tone-info .fm-callout-title { color: var(--fm-secondary); }
.fm-callout.tone-neutral { background: var(--fm-bg-cool); border-color: var(--fm-border); }
`;

export interface FmCalloutProps {
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
  /** Leading emoji/icon. */
  icon?: React.ReactNode;
  /** Optional bold title line above the body. */
  title?: React.ReactNode;
  /** Right-aligned action(s) — buttons/links. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function FmCallout({
  tone = "neutral",
  icon,
  title,
  actions,
  children,
  className,
  style,
}: FmCalloutProps) {
  const classes = ["fm-callout", `tone-${tone}`];
  if (className) classes.push(className);
  return (
    <div className={classes.join(" ")} style={style}>
      <style>{STYLES}</style>
      {icon != null && <span className="fm-callout-icon">{icon}</span>}
      <div className="fm-callout-body">
        {title && <div className="fm-callout-title">{title}</div>}
        {children}
      </div>
      {actions && <div className="fm-callout-actions">{actions}</div>}
    </div>
  );
}
