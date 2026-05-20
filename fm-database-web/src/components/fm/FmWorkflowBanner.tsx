/**
 * FmWorkflowBanner — colour-per-state stage banner.
 *
 * Per design 3B, the banner reads from the corner of the eye via colour:
 *   amber  → no_plan       (needs attention but not urgent)
 *   slate  → draft         (work-in-progress, neutral)
 *   green  → active        (healthy / live)
 *   indigo → recheck       (cyclical / scheduled milestone)
 *
 * Brand orange stays reserved for primary CTAs across the rest of the
 * surface — the banner doesn't compete.
 *
 * For Discovery state, the Plan tab renders FmDiscoveryJourneyStrip
 * instead (design 7B) — the journey strip absorbs the banner. That
 * component lives separately.
 */

export type FmWorkflowStage = "no_plan" | "draft" | "active" | "recheck";

const STATE_META: Record<
  FmWorkflowStage,
  {
    bg: string;
    border: string;
    icon: string;
    iconCol: string;
    textCol: string;
    btnBg: string;
    label: string;
  }
> = {
  no_plan: {
    bg: "linear-gradient(135deg, rgba(243,156,18,0.10), rgba(247,147,30,0.15))",
    border: "rgba(243,156,18,0.35)",
    icon: "🌱",
    iconCol: "#B8770A",
    textCol: "#8a5a08",
    btnBg: "#B8770A",
    label: "no_plan",
  },
  draft: {
    bg: "linear-gradient(135deg, rgba(90,90,90,0.06), rgba(120,120,120,0.10))",
    border: "rgba(60,60,60,0.20)",
    icon: "📝",
    iconCol: "#3a4250",
    textCol: "#3a4250",
    btnBg: "#3a4250",
    label: "draft",
  },
  active: {
    bg: "linear-gradient(135deg, rgba(46,204,113,0.08), rgba(39,174,96,0.12))",
    border: "rgba(46,204,113,0.35)",
    icon: "✅",
    iconCol: "#1E8449",
    textCol: "#1E8449",
    btnBg: "#1E8449",
    label: "active",
  },
  recheck: {
    bg: "linear-gradient(135deg, rgba(110,76,200,0.08), rgba(90,63,176,0.12))",
    border: "rgba(110,76,200,0.30)",
    icon: "🔁",
    iconCol: "#5a3fb0",
    textCol: "#5a3fb0",
    btnBg: "#5a3fb0",
    label: "recheck",
  },
};

export interface FmWorkflowBannerProps {
  stage: FmWorkflowStage;
  /** Headline e.g. "Plan active · week 4 of 12". */
  title: React.ReactNode;
  /** Sub-line, e.g. "Next follow-up May 20 · 3 letters queued." */
  detail?: React.ReactNode;
  /** Action button text, e.g. "Generate letters". */
  cta?: React.ReactNode;
  ctaHref?: string;
  onCtaClick?: () => void;
}

export function FmWorkflowBanner({
  stage,
  title,
  detail,
  cta,
  ctaHref,
  onCtaClick,
}: FmWorkflowBannerProps) {
  const m = STATE_META[stage];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: "var(--fm-radius-md)",
        background: m.bg,
        border: `1.5px solid ${m.border}`,
      }}
    >
      <span style={{ fontSize: 20 }}>{m.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: m.textCol, marginBottom: 2 }}>
          {title}
          <span
            style={{
              fontSize: 10,
              marginLeft: 8,
              padding: "1px 6px",
              borderRadius: 3,
              background: "rgba(0,0,0,0.06)",
              color: m.iconCol,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {m.label}
          </span>
        </div>
        {detail && (
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>{detail}</div>
        )}
      </div>
      {cta && (
        <ActionButton href={ctaHref} onClick={onCtaClick} bg={m.btnBg}>
          {cta} →
        </ActionButton>
      )}
    </div>
  );
}

function ActionButton({
  href,
  onClick,
  bg,
  children,
}: {
  href?: string;
  onClick?: () => void;
  bg: string;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    background: bg,
    color: "#fff",
    border: 0,
    fontWeight: 700,
    padding: "7px 14px",
    fontSize: 12,
    borderRadius: "var(--fm-radius-sm)",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
  if (href) {
    return (
      <a href={href} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} style={style}>
      {children}
    </button>
  );
}
