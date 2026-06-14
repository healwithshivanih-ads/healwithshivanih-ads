"use client";

/**
 * StageGate — journey-stage-aware demotion for right-rail panels.
 *
 * When `demoted` is false the children render exactly as before (zero
 * change). When true, the panels collapse to a one-line quiet pill —
 * still one click away, never unreachable. Open/closed choice persists
 * per-tab in sessionStorage so the coach's preference sticks across
 * refreshes within a session.
 *
 * This is a visibility wrapper only: it never moves or alters the
 * wrapped panels, so no functionality is lost (audit decision 2026-06-11).
 */

import { useEffect, useState } from "react";

export function StageGate({
  demoted,
  label,
  storageKey,
  children,
  initialOpen = false,
}: {
  demoted: boolean;
  label: string;
  storageKey: string;
  children: React.ReactNode;
  /** Start expanded when there's nothing persisted yet (e.g. the wrapped
   *  panel is actionable this load). A persisted choice still wins. */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    try {
      const v = sessionStorage.getItem(storageKey);
      if (v === "1") setOpen(true);
      else if (v === "0") setOpen(false);
    } catch {
      /* private mode */
    }
  }, [storageKey]);

  if (!demoted) return <>{children}</>;

  const toggle = () =>
    setOpen((o) => {
      try {
        sessionStorage.setItem(storageKey, o ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !o;
    });

  return (
    <div>
      <button
        onClick={toggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 14px",
          background: "transparent",
          border: "1px dashed var(--fm-border, rgba(120,113,108,0.35))",
          borderRadius: "var(--fm-radius-md, 10px)",
          color: "var(--fm-text-secondary)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
        }}
        aria-expanded={open}
      >
        <span>{label}</span>
        <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          {open ? "▴ hide" : "▾ show"}
        </span>
      </button>
      {open && <div style={{ display: "grid", gap: 16, marginTop: 12 }}>{children}</div>}
    </div>
  );
}
