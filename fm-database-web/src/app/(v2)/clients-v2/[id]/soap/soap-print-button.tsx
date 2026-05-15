"use client";

export function SoapPrintButton() {
  return (
    <div className="no-print" style={{ padding: "10px 28px 0", display: "flex", justifyContent: "flex-end", gap: 8, maxWidth: 820, margin: "0 auto" }}>
      <button
        onClick={() => window.print()}
        style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 700,
          background: "var(--fm-primary)",
          color: "#fff",
          border: 0,
          borderRadius: "var(--fm-radius-sm)",
          cursor: "pointer",
        }}
      >
        🖨 Print / Save as PDF
      </button>
    </div>
  );
}
