"use client";

/**
 * FmAnalysisProgress — Phase 3 / design C9.
 *
 * Live progress modal shown while assess.py is running (typical 2–4 min).
 * Steps shown: read prior sessions → parse labs → build subgraph →
 * synthesise drivers → draft plan → validate. The component animates a
 * spinner on the currently-active step and counts elapsed time.
 *
 * On failure renders the recovery card with "Save inputs and try later"
 * + "View logs" + "Retry from step N" actions. The shim returns errors
 * via standard {ok:false, error} responses so wiring just needs to flip
 * the `status` prop.
 */
import { useEffect, useState } from "react";

export type FmProgressStepStatus = "done" | "active" | "todo" | "error";

export interface FmProgressStep {
  /** Step label, e.g. "Reading 7 prior sessions". */
  label: string;
  status: FmProgressStepStatus;
  /** Optional elapsed timestamp e.g. "0:14". */
  elapsed?: string;
}

export interface FmAnalysisProgressProps {
  /** Overall state — running or failed. */
  status: "running" | "error";
  /** Step list with per-step status. */
  steps: FmProgressStep[];
  /** Elapsed time on the OVERALL run, e.g. "1:24". Renders large. */
  elapsedLabel?: string;
  /** Progress fraction 0–1 for the bar at the bottom. */
  progressFraction?: number;
  /** Error message (only when status="error"). */
  errorMessage?: string;
  /** Error id (e.g. "err_8af2c") for support / sentry lookups. */
  errorId?: string;
  /** Actions. */
  onCancel?: () => void;
  onRetry?: () => void;
  onSaveAndTryLater?: () => void;
  onViewLogs?: () => void;
}

export function FmAnalysisProgress({
  status,
  steps,
  elapsedLabel,
  progressFraction,
  errorMessage,
  errorId,
  onCancel,
  onRetry,
  onSaveAndTryLater,
  onViewLogs,
}: FmAnalysisProgressProps) {
  // Tick a 1-second timer if elapsedLabel not externally provided, so the
  // coach sees something moving even when there's no progress signal.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const liveElapsed =
    elapsedLabel ??
    `${Math.floor(tick / 60)}:${String(tick % 60).padStart(2, "0")}`;

  if (status === "error") return <ErrorCard
    steps={steps}
    errorMessage={errorMessage}
    errorId={errorId}
    onRetry={onRetry}
    onSaveAndTryLater={onSaveAndTryLater}
    onViewLogs={onViewLogs}
  />;

  return (
    <div
      style={{
        padding: 22,
        background: "var(--fm-surface)",
        borderRadius: "var(--fm-radius-lg)",
        border: "1px solid var(--fm-border-light)",
        boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(110,76,200,0.10)",
            color: "#5a3fb0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "3px solid rgba(110,76,200,0.2)",
              borderTopColor: "#5a3fb0",
              position: "absolute",
              animation: "fmspin 1.2s linear infinite",
            }}
          />
          <span style={{ fontSize: 18 }}>🔬</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#5a3fb0" }}>
            Full assessment running
          </div>
          <div style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>
            Sonnet · assess.py · estimated 2–4 min
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              fontFamily: "var(--fm-font-mono)",
              color: "var(--fm-text-primary)",
            }}
          >
            {liveElapsed}
          </div>
          <div style={{ fontSize: 10, color: "var(--fm-text-tertiary)" }}>elapsed</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((step, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                flexShrink: 0,
                background:
                  step.status === "done"
                    ? "#1E8449"
                    : step.status === "active"
                      ? "rgba(110,76,200,0.15)"
                      : "var(--fm-border-light)",
                color:
                  step.status === "done"
                    ? "#fff"
                    : step.status === "active"
                      ? "#5a3fb0"
                      : "var(--fm-text-tertiary)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {step.status === "done" ? (
                "✓"
              ) : step.status === "active" ? (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#5a3fb0",
                    animation: "fmpulse 1.2s ease-in-out infinite",
                  }}
                />
              ) : (
                i + 1
              )}
            </span>
            <span
              style={{
                flex: 1,
                fontWeight: step.status === "active" ? 700 : 500,
                color:
                  step.status === "todo"
                    ? "var(--fm-text-tertiary)"
                    : "var(--fm-text-primary)",
              }}
            >
              {step.label}
            </span>
            {step.elapsed && (
              <span
                style={{
                  fontFamily: "var(--fm-font-mono)",
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                }}
              >
                {step.elapsed}
              </span>
            )}
          </div>
        ))}
      </div>

      {progressFraction != null && (
        <>
          <div
            style={{
              height: 4,
              background: "var(--fm-border-light)",
              borderRadius: 2,
              marginTop: 18,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(1, progressFraction)) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg, #5a3fb0, #8c6fd9)",
                transition: "width 600ms",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 6,
              fontSize: 10,
              color: "var(--fm-text-tertiary)",
            }}
          >
            <span>{Math.round(progressFraction * 100)}%</span>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                style={{
                  border: 0,
                  background: "transparent",
                  fontSize: 10,
                  color: "var(--fm-text-tertiary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      <style>{`
        @keyframes fmspin { to { transform: rotate(360deg); } }
        @keyframes fmpulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.6); } }
      `}</style>
    </div>
  );
}

function ErrorCard({
  steps,
  errorMessage,
  errorId,
  onRetry,
  onSaveAndTryLater,
  onViewLogs,
}: Pick<
  FmAnalysisProgressProps,
  "steps" | "errorMessage" | "errorId" | "onRetry" | "onSaveAndTryLater" | "onViewLogs"
>) {
  const lastDoneIdx = (() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].status === "done") return i;
    }
    return -1;
  })();
  const erroredStepLabel = steps.find((s) => s.status === "error")?.label ?? "unknown step";
  const retryFromIdx = lastDoneIdx + 2;

  return (
    <div
      style={{
        padding: 22,
        background: "var(--fm-surface)",
        borderRadius: "var(--fm-radius-lg)",
        border: "1.5px solid rgba(231,76,60,0.30)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(231,76,60,0.10)",
            color: "var(--fm-danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          ⚠
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-danger)" }}>
            Synthesis failed
          </div>
          <div style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>
            Step: {erroredStepLabel}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div
          style={{
            padding: "10px 12px",
            background: "rgba(231,76,60,0.06)",
            border: "1px solid rgba(231,76,60,0.25)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            lineHeight: 1.6,
            marginBottom: 14,
          }}
        >
          {errorMessage}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background:
                  step.status === "error"
                    ? "var(--fm-danger)"
                    : step.status === "done"
                      ? "#1E8449"
                      : "var(--fm-border-light)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              {step.status === "error" ? "!" : step.status === "done" ? "✓" : i + 1}
            </span>
            <span
              style={{
                color:
                  step.status === "error"
                    ? "var(--fm-danger)"
                    : "var(--fm-text-secondary)",
                fontWeight: step.status === "error" ? 700 : 500,
              }}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {onSaveAndTryLater && (
          <button
            type="button"
            onClick={onSaveAndTryLater}
            style={btnStyle("ghost")}
          >
            Save inputs and try later
          </button>
        )}
        {onViewLogs && (
          <button type="button" onClick={onViewLogs} style={btnStyle("plain")}>
            View logs
          </button>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              ...btnStyle("plain"),
              background: "var(--fm-danger)",
              color: "#fff",
              borderColor: "transparent",
            }}
          >
            Retry{retryFromIdx > 0 ? ` from step ${retryFromIdx}` : ""}
          </button>
        )}
      </div>

      {errorId && (
        <div
          style={{
            marginTop: 10,
            fontSize: 10,
            color: "var(--fm-text-tertiary)",
            textAlign: "right",
          }}
        >
          error id ·{" "}
          <span style={{ fontFamily: "var(--fm-font-mono)" }}>{errorId}</span>
        </div>
      )}
    </div>
  );
}

function btnStyle(kind: "plain" | "ghost"): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    background:
      kind === "ghost" ? "transparent" : "var(--fm-surface)",
    color: "var(--fm-text-primary)",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
