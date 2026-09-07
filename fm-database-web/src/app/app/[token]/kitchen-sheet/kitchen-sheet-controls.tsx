"use client";

/** Client controls for the kitchen sheet — the print / Save-as-PDF button.
 *  Hidden on print itself (.no-print). Language switching is plain server links
 *  in the page, so this stays a one-purpose control. */
export function KitchenSheetPrintButton({ label }: { label: string }) {
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
      {label}
    </button>
  );
}
