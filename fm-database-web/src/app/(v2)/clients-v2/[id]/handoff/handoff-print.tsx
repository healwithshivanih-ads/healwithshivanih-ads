"use client";

/**
 * Print-and-handoff-note client wrapper for the doctor handoff route.
 *
 * Server page renders the doctor-facing summary as static HTML. This
 * small client component owns:
 *   - The "🖨 Print / Save as PDF" button (window.print() — Chrome's
 *     "Save as PDF" is the cheapest path to a clean A4)
 *   - A coach handoff-note textarea persisted per-client in localStorage
 *     so opening the route again restores what was typed
 *   - The "← Back to client" link
 */
import { useEffect, useState } from "react";
import Link from "next/link";

export function HandoffActions({
  clientId,
  printSectionId = "handoff-print-root",
}: {
  clientId: string;
  printSectionId?: string;
}) {
  return (
    <div
      className="no-print"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginBottom: 14,
      }}
    >
      <button
        type="button"
        onClick={() => {
          // Tag the body so the @media print CSS scopes to the right node.
          document.body.setAttribute("data-print-section", printSectionId);
          window.print();
          document.body.removeAttribute("data-print-section");
        }}
        style={{
          background: "var(--fm-primary)",
          color: "#fff",
          border: 0,
          padding: "9px 16px",
          fontSize: 13,
          fontWeight: 700,
          borderRadius: "var(--fm-radius-sm)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        🖨 Print / Save as PDF
      </button>
      <Link
        href={`/clients-v2/${clientId}`}
        style={{
          fontSize: 12,
          color: "var(--fm-text-secondary)",
          textDecoration: "none",
          padding: "8px 14px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          fontWeight: 600,
        }}
      >
        ← Back to client
      </Link>
      <span
        style={{
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          marginLeft: 8,
        }}
      >
        Tip: in the print dialog pick <strong>Save as PDF</strong> →{" "}
        <strong>A4</strong> → margins <strong>Default</strong>.
      </span>
    </div>
  );
}

export function HandoffNote({ clientId }: { clientId: string }) {
  const storageKey = `handoff-note:${clientId}`;
  const [note, setNote] = useState("");
  // Rehydrate on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setNote(stored);
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  // Persist on change (debounced via React's batching — simple is fine).
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, note);
    } catch {
      /* ignore */
    }
  }, [storageKey, note]);

  // When empty, render the placeholder block. When non-empty, render the
  // note in the print stream too.
  return (
    <>
      <textarea
        className="no-print"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What you'd like the receiving clinician to know — current concerns, why you're referring, what's been tried, what you're hoping to learn from them. Persists per-client in this browser."
        rows={5}
        style={{
          width: "100%",
          padding: 12,
          border: "1px dashed var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          fontSize: 13,
          fontFamily: "inherit",
          resize: "vertical",
          lineHeight: 1.5,
          background: "var(--fm-surface)",
        }}
      />
      {note.trim() && (
        <div
          className="print-only"
          style={{
            display: "none",
            fontSize: "11pt",
            lineHeight: 1.55,
            color: "#111",
            whiteSpace: "pre-wrap",
          }}
        >
          {note}
        </div>
      )}
    </>
  );
}
