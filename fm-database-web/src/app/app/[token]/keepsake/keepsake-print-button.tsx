"use client";

/** Tiny client control — triggers the browser's print/save-as-PDF dialog for the
 *  recipe keepsake. Hidden on print itself (.no-print). */
export function KeepsakePrintButton() {
  return (
    <button
      className="no-print"
      onClick={() => window.print()}
      style={{
        fontSize: 14,
        fontWeight: 600,
        padding: "11px 22px",
        borderRadius: 999,
        border: "none",
        background: "#2d5a3d",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      Save as PDF
    </button>
  );
}
