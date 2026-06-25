"use client";

/**
 * LabOrdersCard — the client's lab-booking surface (shown atop the Labs tab).
 * Renders coach-recommended Acumen orders: a `recommended` order is payable
 * (in-app Razorpay Checkout); paid/booked/results show their status. "Paid" is
 * confirmed by the server webhook, not here — after Checkout we just show
 * "confirming". See docs/LAB_BOOKING_SPEC.md.
 */

import { useState } from "react";
import { useOchre } from "./ochre-context";
import type { LabOrder, LabOrderStatus } from "@/lib/fmdb/lab-orders";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const STATUS_LABEL: Record<LabOrderStatus, string> = {
  recommended: "Ready to book",
  paid: "Paid · we're arranging your home collection",
  booked: "Booked",
  sample_collected: "Sample collected",
  results_in: "Results are in your vault below",
  cancelled: "Cancelled",
};

export function LabOrdersCard() {
  const data = useOchre();
  const orders: LabOrder[] = data.labOrders ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const recommended = orders.filter((o) => o.status === "recommended");
  const inFlight = orders.filter((o) => o.status !== "recommended" && o.status !== "cancelled");
  if (recommended.length === 0 && inFlight.length === 0) return null;

  const pay = async (order: LabOrder) => {
    setBusy(order.order_id);
    setError("");
    try {
      const res = await fetch(`/api/lab-order/${order.order_id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: data.clientId }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        razorpay_order_id?: string;
        amount_inr?: number;
        currency?: string;
        keyId?: string;
      };
      if (!j.ok) throw new Error(j.error || "could not start payment");
      const loaded = await loadRazorpay();
      if (!loaded || !window.Razorpay) throw new Error("payment is unavailable right now");
      const rzp = new window.Razorpay({
        key: j.keyId,
        order_id: j.razorpay_order_id,
        amount: (j.amount_inr ?? order.amount_inr) * 100,
        currency: j.currency ?? "INR",
        name: "The Ochre Tree",
        description: order.lines.map((l) => l.label).join(", "),
        theme: { color: "#2d5a3d" },
        // Webhook is the source of truth; here we just acknowledge.
        handler: () => setConfirming((c) => ({ ...c, [order.order_id]: true })),
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "payment failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section" style={{ marginBottom: 4 }}>
      <div className="section-head">
        <h2>Your lab tests</h2>
      </div>

      {recommended.map((o) => (
        <div className="card" key={o.order_id} style={{ padding: "14px 15px", marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--forest, #2d5a3d)" }}>
            Recommended for you
          </div>
          {/* lead with the personalised reason — why these tests, for this client */}
          {o.coach_note && (
            <div className="h-serif" style={{ fontSize: 15.5, color: "var(--ink, #2c2a24)", marginTop: 7, lineHeight: 1.45 }}>{o.coach_note}</div>
          )}
          {/* the actual markers — so it reads as a tailored check, not a package */}
          {o.includes && o.includes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted, #6f6a5d)" }}>
                What we&apos;ll check
              </div>
              <ul style={{ margin: "7px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 5 }}>
                {o.includes.map((it, i) => (
                  <li key={i} style={{ fontSize: 12.8, color: "var(--ink, #2c2a24)", display: "flex", gap: 7, lineHeight: 1.4 }}>
                    <span style={{ color: "var(--forest, #2d5a3d)", flexShrink: 0 }}>✓</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {o.fasting_required && (
            <div style={{ fontSize: 11.5, color: "var(--ochre, #b07b1e)", marginTop: 10 }}>Fasting sample · we&apos;ll arrange home collection</div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line, #e6e1d6)" }}>
            <strong style={{ fontSize: 17 }}>{inr(o.amount_inr)}</strong>
            {confirming[o.order_id] ? (
              <span style={{ fontSize: 13, color: "var(--forest, #2d5a3d)" }}>Confirming your payment…</span>
            ) : (
              <button className="submit-btn" style={{ width: "auto", padding: "10px 22px" }} onClick={() => pay(o)} disabled={busy === o.order_id}>
                {busy === o.order_id ? "Opening…" : `Pay ${inr(o.amount_inr)}`}
              </button>
            )}
          </div>
        </div>
      ))}

      {error && <div style={{ fontSize: 12.5, color: "#b3402a", margin: "2px 2px 8px" }}>{error}</div>}

      {inFlight.map((o) => (
        <div className="card" key={o.order_id} style={{ padding: "11px 14px", marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>{o.lines[0]?.label ?? "Lab order"}{o.addon_slugs.length ? ` +${o.addon_slugs.length}` : ""}</span>
            <strong>{inr(o.amount_inr)}</strong>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--forest, #2d5a3d)", marginTop: 3 }}>{STATUS_LABEL[o.status]}</div>
        </div>
      ))}
    </section>
  );
}
