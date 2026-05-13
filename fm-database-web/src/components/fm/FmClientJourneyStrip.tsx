/**
 * FmClientJourneyStrip — horizontal breadcrumb-style strip showing
 * where a client is in their FM coaching arc.
 *
 *   Discovery  →  Intake  →  Plan active  →  Week 4 of 12  →  Next due
 *   ✔ Apr 2     ✔ Apr 8    ✔ Apr 14         (active)         May 30
 *
 * Mounted on every client subpage (PlanPageShell, AnalysePageShell,
 * SessionsPageShell, CommunicatePageShell, overview/page.tsx) so the
 * coach always sees the workflow stage above the subnav.
 *
 * Server component — pure rendering of the journey computed by
 * loadClientJourney() in lib/fmdb/client-journey.ts.
 */
import type { ClientJourney, JourneyStep } from "@/lib/fmdb/client-journey";
import { formatLongDate } from "@/lib/fmdb/format-date";

const STATUS_STYLE: Record<
  JourneyStep["status"],
  { dotBg: string; dotBorder: string; dotIcon: string; labelCol: string; captionCol: string }
> = {
  done: {
    dotBg: "#1E8449",
    dotBorder: "#1E8449",
    dotIcon: "✓",
    labelCol: "#1E8449",
    captionCol: "var(--fm-text-secondary)",
  },
  active: {
    dotBg: "#F39C12",
    dotBorder: "#F39C12",
    dotIcon: "●",
    labelCol: "#8a5a08",
    captionCol: "#8a5a08",
  },
  pending: {
    dotBg: "var(--fm-surface)",
    dotBorder: "var(--fm-border)",
    dotIcon: "",
    labelCol: "var(--fm-text-tertiary)",
    captionCol: "var(--fm-text-tertiary)",
  },
  na: {
    dotBg: "var(--fm-surface)",
    dotBorder: "var(--fm-border-light)",
    dotIcon: "—",
    labelCol: "var(--fm-text-tertiary)",
    captionCol: "var(--fm-text-tertiary)",
  },
};

function isIsoDate(s: string | undefined): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}/.test(s);
}

export function FmClientJourneyStrip({ journey }: { journey: ClientJourney }) {
  const { steps } = journey;
  return (
    <div
      role="navigation"
      aria-label="Client journey"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 0,
        padding: "10px 14px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        marginBottom: 12,
        overflowX: "auto",
      }}
    >
      {steps.map((step, i) => {
        const sty = STATUS_STYLE[step.status];
        const isLast = i === steps.length - 1;
        const caption =
          step.caption && isIsoDate(step.caption)
            ? formatLongDate(step.caption)
            : step.caption ?? "";
        return (
          <div
            key={step.id}
            style={{
              display: "flex",
              alignItems: "center",
              flex: isLast ? "0 0 auto" : "1 1 auto",
              minWidth: 110,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: sty.dotBg,
                    border: `1.5px solid ${sty.dotBorder}`,
                    color: step.status === "done" || step.status === "active" ? "#fff" : sty.labelCol,
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  {sty.dotIcon}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: sty.labelCol,
                    whiteSpace: "nowrap",
                  }}
                >
                  {step.label}
                </span>
              </div>
              <span
                style={{
                  fontSize: 10.5,
                  color: sty.captionCol,
                  marginLeft: 24,
                  whiteSpace: "nowrap",
                  fontFamily:
                    isIsoDate(step.caption)
                      ? "inherit"
                      : "inherit",
                }}
              >
                {caption}
              </span>
            </div>
            {!isLast && (
              <div
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 1,
                  background:
                    step.status === "done"
                      ? "#1E8449"
                      : step.status === "active"
                        ? "#F39C12"
                        : "var(--fm-border-light)",
                  margin: "0 8px",
                  minWidth: 24,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
