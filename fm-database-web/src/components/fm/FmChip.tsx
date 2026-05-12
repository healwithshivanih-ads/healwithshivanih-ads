/**
 * FmChip + FmStatusPill — small text badges.
 *
 * FmChip: neutral chip for tags (conditions, FM markers, lab names).
 * FmStatusPill: uppercase status badge with semantic palette (draft / sent
 *   / scheduled / locked / done / in-progress / blocking / pending / signal-*).
 */

const STYLES = `
.fm-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 500;
  color: var(--fm-text-secondary);
  background: var(--fm-bg-cool);
  border: 1px solid transparent;
  border-radius: var(--fm-radius-sm);
  line-height: 1.3;
  font-family: inherit;
}
.fm-chip.tone-primary {
  background: rgba(255, 107, 53, 0.10);
  color: var(--fm-primary);
  font-weight: 600;
}
.fm-chip.tone-warning {
  background: rgba(243, 156, 18, 0.10);
  color: var(--fm-warning);
}
.fm-chip.tone-danger {
  background: rgba(231, 76, 60, 0.10);
  color: var(--fm-danger);
}
.fm-chip.tone-success {
  background: rgba(46, 204, 113, 0.10);
  color: var(--fm-success);
}
.fm-chip.tone-secondary {
  background: rgba(0, 78, 137, 0.10);
  color: var(--fm-secondary);
}
.fm-chip.outline {
  background: var(--fm-surface);
  border-color: var(--fm-border);
}

.fm-status-pill {
  display: inline-flex;
  align-items: center;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  padding: 3px 7px;
  border-radius: 3px;
  background: var(--fm-bg-cool);
  color: var(--fm-text-secondary);
  line-height: 1.3;
}
.fm-status-pill.draft       { background: var(--fm-bg-warm); color: var(--fm-primary); }
.fm-status-pill.sent        { background: rgba(46,204,113,0.14); color: var(--fm-success); }
.fm-status-pill.scheduled   { background: rgba(0,109,143,0.14);  color: var(--fm-secondary); }
.fm-status-pill.locked      { background: var(--fm-bg-cool);     color: var(--fm-text-tertiary); }
.fm-status-pill.done        { background: rgba(46,160,67,0.14);  color: var(--fm-success); }
.fm-status-pill.in-progress { background: rgba(217,119,87,0.14); color: var(--fm-primary); }
.fm-status-pill.blocking    { background: rgba(220,53,69,0.12);  color: #c0392b; }
.fm-status-pill.pending     { background: var(--fm-bg-cool);     color: var(--fm-text-secondary); }
.fm-status-pill.active      { background: var(--fm-primary);     color: #fff; }
`;

export interface FmChipProps {
  tone?: "primary" | "warning" | "danger" | "success" | "secondary" | "neutral";
  outline?: boolean;
  children: React.ReactNode;
  title?: string;
}

export function FmChip({ tone = "neutral", outline, children, title }: FmChipProps) {
  const classes = ["fm-chip"];
  if (tone !== "neutral") classes.push(`tone-${tone}`);
  if (outline) classes.push("outline");
  return (
    <span className={classes.join(" ")} title={title}>
      <style>{STYLES}</style>
      {children}
    </span>
  );
}

export type FmStatusPillKind =
  | "draft" | "sent" | "scheduled" | "locked"
  | "done"  | "in-progress" | "blocking" | "pending" | "active";

export function FmStatusPill({
  kind,
  children,
}: {
  kind: FmStatusPillKind;
  children: React.ReactNode;
}) {
  return (
    <span className={`fm-status-pill ${kind}`}>
      <style>{STYLES}</style>
      {children}
    </span>
  );
}
