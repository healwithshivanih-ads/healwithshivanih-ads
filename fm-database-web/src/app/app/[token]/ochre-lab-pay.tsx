"use client";

/**
 * LabOrdersCard — the client's lab-booking surface (shown atop the Labs tab).
 * Renders coach-recommended Acumen orders: a `recommended` order is payable
 * (in-app Razorpay Checkout); paid/booked/results show their status. "Paid" is
 * confirmed by the server webhook, not here — after Checkout we just show
 * "confirming". See docs/LAB_BOOKING_SPEC.md.
 */

import { useState, type CSSProperties } from "react";
import { useOchre } from "./ochre-context";
import type { LabOrder, LabOrderStatus, LogisticsSlot } from "@/lib/fmdb/lab-orders";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

/** Time-slot options — values MUST match LOGISTICS_SLOTS in lab-orders.ts. */
const SLOT_OPTIONS: { value: LogisticsSlot; label: string }[] = [
  { value: "morning", label: "Morning (7–10 am)" },
  { value: "late_morning", label: "Late morning (10 am–1 pm)" },
  { value: "afternoon", label: "Afternoon (1–4 pm)" },
  { value: "evening", label: "Evening (4–7 pm)" },
];

interface LogisticsForm {
  full_name: string;
  phone: string;
  address: string;
  pincode: string;
  preferred_date: string;
  preferred_slot: LogisticsSlot | "";
  notes: string;
}

const EMPTY_FORM: LogisticsForm = {
  full_name: "",
  phone: "",
  address: "",
  pincode: "",
  preferred_date: "",
  preferred_slot: "",
  notes: "",
};

/** Today (local device day) as YYYY-MM-DD — the date-picker floor. */
function todayLocalYmd(): string {
  return new Date().toLocaleDateString("en-CA");
}

const FIELD: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 13.5,
  fontFamily: "inherit",
  color: "var(--ink, #2c2a24)",
  background: "var(--bg, #fff)",
  border: "1px solid var(--line, #e6e1d6)",
  borderRadius: 10,
};

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
  // Which order's collection form is open, + the form values.
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [form, setForm] = useState<LogisticsForm>(EMPTY_FORM);

  const recommended = orders.filter((o) => o.status === "recommended");
  const inFlight = orders.filter((o) => o.status !== "recommended" && o.status !== "cancelled");
  if (recommended.length === 0 && inFlight.length === 0) return null;

  // Prefill name/phone from the account, then open the collection form.
  const startBooking = (order: LabOrder) => {
    setError("");
    const contact = (data.account?.contact ?? "").trim();
    const looksPhone = /\d{7,}/.test(contact.replace(/\D/g, ""));
    setForm({
      ...EMPTY_FORM,
      full_name: data.account?.name ?? "",
      phone: looksPhone ? contact : "",
    });
    setBookingId(order.order_id);
  };

  const setField = (k: keyof LogisticsForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const pay = async (order: LabOrder) => {
    setBusy(order.order_id);
    setError("");
    try {
      const res = await fetch(`/api/lab-order/${order.order_id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: data.clientId, logistics: form }),
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
            ) : bookingId !== o.order_id ? (
              <button className="submit-btn" style={{ width: "auto", padding: "10px 22px" }} onClick={() => startBooking(o)}>
                Book home collection →
              </button>
            ) : null}
          </div>

          {/* Collection logistics — shown once the client taps "Book". */}
          {bookingId === o.order_id && !confirming[o.order_id] && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--line, #e6e1d6)", display: "grid", gap: 9 }}>
              <div style={{ fontSize: 12.5, color: "var(--muted, #6f6a5d)", lineHeight: 1.4 }}>
                Where + when should we collect your sample at home?
              </div>
              <input style={FIELD} placeholder="Full name" value={form.full_name} onChange={(e) => setField("full_name", e.target.value)} />
              <input style={FIELD} placeholder="Phone for the collection" inputMode="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
              <textarea style={{ ...FIELD, minHeight: 56, resize: "vertical" }} placeholder="Collection address (flat, building, area, landmark)" value={form.address} onChange={(e) => setField("address", e.target.value)} />
              <div style={{ display: "flex", gap: 9 }}>
                <input style={{ ...FIELD, flex: 1 }} placeholder="Pincode" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => setField("pincode", e.target.value.replace(/\D/g, ""))} />
                <input style={{ ...FIELD, flex: 1 }} type="date" min={todayLocalYmd()} value={form.preferred_date} onChange={(e) => setField("preferred_date", e.target.value)} />
              </div>
              <select style={FIELD} value={form.preferred_slot} onChange={(e) => setField("preferred_slot", e.target.value)}>
                <option value="">Preferred time slot…</option>
                {SLOT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              {o.fasting_required && (
                <div style={{ fontSize: 11.5, color: "var(--ochre, #b07b1e)" }}>Fasting sample — a morning slot works best.</div>
              )}
              <textarea style={{ ...FIELD, minHeight: 44, resize: "vertical" }} placeholder="Anything we should know? (optional)" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 2 }}>
                <button className="submit-btn" style={{ flex: 1, padding: "11px 18px" }} onClick={() => pay(o)} disabled={busy === o.order_id}>
                  {busy === o.order_id ? "Opening…" : `Pay ${inr(o.amount_inr)}`}
                </button>
                <button
                  onClick={() => { setBookingId(null); setError(""); }}
                  style={{ background: "transparent", border: "none", color: "var(--muted, #6f6a5d)", fontSize: 13, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
