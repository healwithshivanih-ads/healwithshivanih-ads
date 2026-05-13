"use client";

/**
 * FmFormDraftClear — small top-right "✕ Clear all" button for any form
 * that uses useFormDraft. Renders a one-step confirm (two-click) so the
 * coach doesn't nuke 20 minutes of typing by accident.
 *
 * Designed to be parked in a form header alongside the title, e.g.:
 *
 *   <div style={{ display: "flex", justifyContent: "space-between" }}>
 *     <h2>Intake form</h2>
 *     <FmFormDraftClear onClear={clearDraft} hasDraft={hasSavedDraft} />
 *   </div>
 */
import { useState } from "react";

export interface FmFormDraftClearProps {
  /** Wipe the localStorage key + reset the form's local state. */
  onClear: () => void;
  /** When false, render disabled so the coach knows there's nothing to clear. */
  hasDraft: boolean;
  /** Override the default tooltip. */
  title?: string;
}

export function FmFormDraftClear({
  onClear,
  hasDraft,
  title = "Clear the in-progress draft and reset every field",
}: FmFormDraftClearProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          // Auto-cancel the confirm after 4s so a stale "Confirm clear"
          // button doesn't sit around waiting to surprise the coach.
          window.setTimeout(() => setConfirming(false), 4000);
          return;
        }
        onClear();
        setConfirming(false);
      }}
      disabled={!hasDraft && !confirming}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        fontSize: 11.5,
        fontWeight: 600,
        background: confirming ? "var(--fm-danger, #b91c1c)" : "transparent",
        color: confirming
          ? "#fff"
          : hasDraft
            ? "var(--fm-text-secondary, #5a5a5a)"
            : "var(--fm-text-tertiary, #999)",
        border: `1px solid ${
          confirming
            ? "var(--fm-danger, #b91c1c)"
            : "var(--fm-border, #e8e8e8)"
        }`,
        borderRadius: "var(--fm-radius-sm, 6px)",
        cursor: hasDraft || confirming ? "pointer" : "not-allowed",
        opacity: hasDraft || confirming ? 1 : 0.55,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        transition: "all 150ms ease",
      }}
    >
      <span aria-hidden="true">✕</span>
      <span>{confirming ? "Confirm clear" : "Clear all"}</span>
    </button>
  );
}
