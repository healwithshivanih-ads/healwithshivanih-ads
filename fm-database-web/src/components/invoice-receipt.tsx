"use client";

/**
 * InvoiceReceipt — a plain payment receipt (no GST — the practice isn't
 * registered, so this deliberately never says "Tax Invoice" or shows a
 * GSTIN/tax breakup). Shared between the coach dashboard and the client app,
 * so it uses its own explicit brand colors rather than either surface's CSS
 * custom-property system.
 *
 * Print pattern copied from soap-note-panel.tsx: the content renders TWICE —
 * once inline for on-screen review, once always-mounted-but-hidden for print
 * isolation (`body > * { display: none }` then un-hide just the print root).
 * window.print() → the browser's native "Save as PDF" is the export path, no
 * PDF library dependency.
 */

// Type-only import — erased at compile time. Do NOT import any runtime value
// from "@/lib/fmdb/invoices" here: that module (and its lab-orders /
// maintenance-* dependencies) touches node:fs at module scope, which breaks
// the client bundle. The biller identity is snapshotted onto invoice.biller
// at generation time for exactly this reason — see invoices.ts.
import type { Invoice } from "@/lib/fmdb/invoices";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

const PRINT_CSS = `
.inv-print-only { display: none; }
@media print {
  body > * { display: none !important; }
  body > #invoice-print-root { display: block !important; }
  #invoice-print-root > * { display: block !important; }
  .inv-no-print { display: none !important; }
  .inv-print-only { display: block !important; }
  .inv-content {
    font-family: Georgia, serif !important;
    font-size: 11pt !important;
    color: #2c2a24 !important;
    padding: 18mm !important;
    max-width: 100% !important;
  }
}
`;

function ReceiptBody({ invoice }: { invoice: Invoice }) {
  return (
    <div className="inv-content" style={{ fontFamily: "Georgia, serif", color: "#2c2a24" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2d5a3d" }}>{invoice.biller.name}</div>
          <div style={{ fontSize: 12, color: "#6f6a5d", marginTop: 4, lineHeight: 1.5 }}>
            {invoice.biller.address}
            <br />
            {invoice.biller.phone} · {invoice.biller.email}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#b07b1e" }}>
            Payment Receipt
          </div>
          <div style={{ fontSize: 12, color: "#6f6a5d", marginTop: 4 }}>{invoice.invoice_number}</div>
          <div style={{ fontSize: 12, color: "#6f6a5d" }}>{fmtDate(invoice.issued_at)}</div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid #e6e1d6", borderBottom: "1px solid #e6e1d6", padding: "12px 0", marginBottom: 20 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "#8a8378", marginBottom: 2 }}>
          Received from
        </div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{invoice.client_name}</div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e6e1d6" }}>
            <th style={{ textAlign: "left", padding: "6px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "#8a8378" }}>
              Description
            </th>
            <th style={{ textAlign: "right", padding: "6px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "#8a8378" }}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f2efe8" }}>
              <td style={{ padding: "8px 0", fontSize: 13 }}>{l.label}</td>
              <td style={{ padding: "8px 0", fontSize: 13, textAlign: "right" }}>{inr(l.inr)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ padding: "10px 0", fontSize: 14, fontWeight: 700 }}>Total paid</td>
            <td style={{ padding: "10px 0", fontSize: 14, fontWeight: 700, textAlign: "right" }}>{inr(invoice.amount_inr)}</td>
          </tr>
        </tfoot>
      </table>

      <div style={{ fontSize: 12, color: "#6f6a5d", lineHeight: 1.6 }}>
        <div>
          <strong>Payment method:</strong> Razorpay
          {invoice.razorpay_payment_id?.startsWith("pay_") ? ` · Ref ${invoice.razorpay_payment_id}` : ""}
        </div>
        <div>
          <strong>Paid on:</strong> {fmtDate(invoice.paid_at)}
        </div>
        {invoice.note && (
          <div style={{ marginTop: 8 }}>
            <strong>Note:</strong> {invoice.note}
          </div>
        )}
      </div>

      <div style={{ marginTop: 32, fontSize: 10.5, color: "#8a8378", borderTop: "1px solid #e6e1d6", paddingTop: 10 }}>
        This is a payment receipt, not a GST tax invoice — {invoice.biller.name} is not GST-registered.
      </div>
    </div>
  );
}

export function InvoiceReceipt({ invoice }: { invoice: Invoice }) {
  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="inv-no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => window.print()}
          title="Cmd/Ctrl+P → Save as PDF"
          style={{
            background: "#2d5a3d",
            color: "#fff",
            border: 0,
            padding: "8px 16px",
            fontSize: 12.5,
            fontWeight: 700,
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          🖨 Print / Save as PDF
        </button>
      </div>

      <div className="inv-no-print" style={{ border: "1px solid #e6e1d6", borderRadius: 10, background: "#fff" }}>
        <ReceiptBody invoice={invoice} />
      </div>

      {/* Always rendered for print isolation — hidden from screen via CSS. */}
      <div id="invoice-print-root" className="inv-print-only">
        <ReceiptBody invoice={invoice} />
      </div>
    </div>
  );
}
