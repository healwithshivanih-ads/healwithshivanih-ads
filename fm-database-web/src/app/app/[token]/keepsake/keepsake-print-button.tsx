"use client";

/** Tiny client control — downloads the real PDF (keepsake.pdf). window.print() was
 *  a no-op in installed iOS home-screen apps. Hidden on print itself (.no-print). */
export function KeepsakePrintButton() {
  return (
    <a
      className="no-print"
      href="keepsake.pdf"
      download
      style={{
        fontSize: 14,
        fontWeight: 600,
        padding: "11px 22px",
        borderRadius: 999,
        border: "none",
        background: "#2d5a3d",
        color: "#fff",
        cursor: "pointer",
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      Download PDF
    </a>
  );
}
