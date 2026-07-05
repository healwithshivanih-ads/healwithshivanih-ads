"use client";

/**
 * LabOrdersCard — the client's lab-booking surface (shown atop the Labs tab).
 * Renders coach-recommended Acumen orders: a `recommended` order is payable
 * (in-app Razorpay Checkout); paid/booked/results show their status. "Paid" is
 * confirmed by the server webhook, not here — after Checkout we just show
 * "confirming". See docs/LAB_BOOKING_SPEC.md.
 *
 * Also carries the self-service rebook/reorder surface (`showReorderCta`,
 * default true) — a client whose orders are all done/results-in otherwise has
 * NO way to get more labs later except going around the app. Two tiers:
 *   1. RebookCta — when there's a past (non-cancelled) order, one tap calls
 *      POST /api/lab-order/rebook, which re-derives that same profile/add-on
 *      selection at CURRENT catalogue pricing and mints a fresh `recommended`
 *      order (same buildOrder() path a coach recommendation uses — see that
 *      route for the full contract). The new order is fed straight into the
 *      SAME booking form + Razorpay flow below — no separate pipeline, no
 *      coach round-trip.
 *   2. ReorderLabsCta — a plain "ask about labs" WhatsApp prompt, always
 *      available as the fallback (first-ever order, or something different
 *      than the last package).
 * Suppressed during pre-call onboarding (the `book_labs` stage in
 * ochre-discovery.tsx) — asking to "reorder" before the first order even
 * exists reads wrong.
 */

import { useState, type CSSProperties } from "react";
import { useOchre, Icon } from "./ochre-context";
import type { LabOrder, LabOrderStatus, LogisticsSlot } from "@/lib/fmdb/lab-orders";
import type { Invoice } from "@/lib/fmdb/invoices";
import { InvoiceReceipt } from "@/components/invoice-receipt";

function waHref(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

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

/** Earliest bookable collection day = the date ~36 hours out (lead time so the
 *  lab can arrange home collection). The server re-checks this against IST. */
function minCollectionYmd(): string {
  const d = new Date(Date.now() + 36 * 3600 * 1000);
  return d.toLocaleDateString("en-CA");
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

/** Price + deal. When the à-la-carte catalogue total (`listInr`) is higher than
 *  what we charge, show it struck through with a "Save ₹X · N% off" badge so the
 *  package reads as the deal it is. Falls back to a plain price with no anchor. */
function PriceBlock({ listInr, amountInr }: { listInr?: number | null; amountInr: number }) {
  const hasDeal = typeof listInr === "number" && listInr > amountInr;
  if (!hasDeal) return <strong style={{ fontSize: 17 }}>{inr(amountInr)}</strong>;
  const saved = listInr - amountInr;
  const pct = Math.round((saved / listInr) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 12, color: "var(--muted, #6f6a5d)", textDecoration: "line-through" }}>
        {inr(listInr)} if booked individually
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 21 }}>{inr(amountInr)}</strong>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.3,
            color: "var(--forest, #2d5a3d)",
            background: "rgba(45,90,61,0.1)",
            padding: "3px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          Save {inr(saved)} · {pct}% off
        </span>
      </div>
    </div>
  );
}

/** Self-service "ask for a reorder" prompt — always available, not tied to any
 *  order's status. Copy adapts to whether the client has ordered before, and
 *  shrinks to a single-line link when a RebookCta is already showing above it
 *  (so the two don't compete for attention). */
function ReorderLabsCta({ hasOrderedBefore, compact = false }: { hasOrderedBefore: boolean; compact?: boolean }) {
  const { coach } = useOchre();
  const waLink = (
    <a
      className={compact ? undefined : "wa-btn"}
      style={
        compact
          ? { fontSize: 12.5, color: "var(--forest, #2d5a3d)", display: "inline-flex", alignItems: "center", gap: 5 }
          : { width: "auto", padding: "9px 16px", marginTop: 10, display: "inline-flex" }
      }
      href={waHref(
        coach.whatsappNumber,
        hasOrderedBefore
          ? "Hi, I'd like to talk about getting some labs retested or added on."
          : "Hi, I'd like to talk about getting some labs done.",
      )}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon name="whatsapp" size={compact ? 14 : 16} /> {compact ? "Ask about something different" : "Ask about labs"}
    </a>
  );
  if (compact) return <div style={{ marginTop: 8, textAlign: "center" }}>{waLink}</div>;
  return (
    <div className="card" style={{ padding: "13px 15px", marginTop: 10 }}>
      <div style={{ fontSize: 13, color: "var(--ink, #2c2a24)", lineHeight: 1.5 }}>
        {hasOrderedBefore
          ? "Want to retest something, or add a lab down the line? Just ask — we'll set it up whenever you're ready."
          : "Want to talk about getting some labs done? We'll recommend what fits, whenever you're ready."}
      </div>
      {waLink}
    </div>
  );
}

/** One-tap self-service rebook of the client's last (non-cancelled) package.
 *  Creates a fresh `recommended` order at current pricing via the rebook API,
 *  then hands it straight to the caller to open in the same booking form the
 *  coach-recommended flow uses. */
function RebookCta({
  lastOrder,
  onRebooked,
}: {
  lastOrder: LabOrder;
  onRebooked: (order: LabOrder) => void;
}) {
  const data = useOchre();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = lastOrder.lines[0]?.label ?? "your last package";
  const addonCount = lastOrder.addon_slugs?.length ?? 0;

  const rebook = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/lab-order/rebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; order?: LabOrder };
      if (!j.ok || !j.order) throw new Error(j.error || "could not rebook");
      onRebooked(j.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not rebook");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: "13px 15px", marginTop: 10 }}>
      <div style={{ fontSize: 13, color: "var(--ink, #2c2a24)", lineHeight: 1.5 }}>
        Want to retest the same panel — <strong>{label}</strong>
        {addonCount > 0 ? ` +${addonCount}` : ""}? Book it again below, right in the app (current pricing applies).
      </div>
      <button
        type="button"
        className="submit-btn"
        style={{ width: "auto", padding: "10px 20px", marginTop: 10 }}
        onClick={rebook}
        disabled={busy}
      >
        {busy ? "Setting it up…" : `Rebook ${label} →`}
      </button>
      {error && <div style={{ fontSize: 12.5, color: "#b3402a", marginTop: 8 }}>{error}</div>}
    </div>
  );
}

export function LabOrdersCard({ showReorderCta = true }: { showReorderCta?: boolean } = {}) {
  const data = useOchre();
  // Orders just self-service-created via /api/lab-order/rebook — not yet in
  // data.labOrders (that's a page-load snapshot). Prepended so they render +
  // become bookable immediately, no reload needed.
  const [rebookedOrders, setRebookedOrders] = useState<LabOrder[]>([]);
  const orders: LabOrder[] = [...rebookedOrders, ...(data.labOrders ?? [])];
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  // Which order's collection form is open, + the form values.
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [form, setForm] = useState<LogisticsForm>(EMPTY_FORM);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState<string | null>(null);

  const viewInvoice = async (order: LabOrder) => {
    setInvoiceBusy(order.order_id);
    setError("");
    try {
      const params = new URLSearchParams({ token: data.token, clientId: data.clientId });
      const res = await fetch(`/api/invoice/lab-order/${order.order_id}?${params}`);
      const j = (await res.json()) as { ok: boolean; invoice?: Invoice; error?: string };
      if (!j.ok || !j.invoice) throw new Error(j.error || "couldn't load your receipt");
      setInvoice(j.invoice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't load your receipt");
    } finally {
      setInvoiceBusy(null);
    }
  };

  const recommended = orders.filter((o) => o.status === "recommended");
  const inFlight = orders.filter((o) => o.status !== "recommended" && o.status !== "cancelled");
  const hasAny = recommended.length > 0 || inFlight.length > 0;
  // The most recent non-cancelled order — the "package they were last tested
  // for", offered as a one-tap rebook. Mirrors the server route's own lookup.
  const lastBookable = orders.find((o) => o.status !== "cancelled") ?? null;
  // Never fully disappears when showReorderCta is on — a client with no active
  // order still needs the self-service "ask about labs" prompt below.
  if (!hasAny && !showReorderCta) return null;

  // Prefill name/phone + saved collection address from the account, then open the
  // collection form. The address comes from a prior order (saved to the record),
  // so a returning client doesn't re-type it.
  const startBooking = (order: LabOrder) => {
    setError("");
    const contact = (data.account?.contact ?? "").trim();
    const looksPhone = /\d{7,}/.test(contact.replace(/\D/g, ""));
    setForm({
      ...EMPTY_FORM,
      full_name: data.account?.name ?? "",
      phone: looksPhone ? contact : "",
      address: data.account?.collectionAddress ?? "",
      pincode: data.account?.collectionPincode ?? "",
    });
    setBookingId(order.order_id);
  };

  // A rebook just minted this order server-side — surface it immediately (no
  // reload) and drop straight into the same booking form as any other
  // recommended order.
  const handleRebooked = (order: LabOrder) => {
    setRebookedOrders((r) => [order, ...r]);
    startBooking(order);
  };

  const setField = (k: keyof LogisticsForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const pay = async (order: LabOrder) => {
    setBusy(order.order_id);
    setError("");
    try {
      const res = await fetch(`/api/lab-order/${order.order_id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, clientId: data.clientId, logistics: form }),
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
      {hasAny && (
        <div className="section-head">
          <h2>Your lab tests</h2>
        </div>
      )}

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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line, #e6e1d6)" }}>
            <PriceBlock listInr={o.list_inr} amountInr={o.amount_inr} />
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
                <input style={{ ...FIELD, flex: 1 }} type="date" min={minCollectionYmd()} value={form.preferred_date} onChange={(e) => setField("preferred_date", e.target.value)} />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted, #6f6a5d)", marginTop: -3 }}>
                We need about 36 hours&apos; notice to arrange your home visit.
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 3 }}>
            <div style={{ fontSize: 11.5, color: "var(--forest, #2d5a3d)" }}>{STATUS_LABEL[o.status]}</div>
            <button
              onClick={() => viewInvoice(o)}
              disabled={invoiceBusy === o.order_id}
              style={{ background: "transparent", border: "none", color: "var(--muted, #6f6a5d)", fontSize: 11.5, textDecoration: "underline", cursor: "pointer", padding: 0 }}
            >
              {invoiceBusy === o.order_id ? "Loading…" : "📄 Receipt"}
            </button>
          </div>
        </div>
      ))}

      {invoice && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "5vh 16px",
            zIndex: 1000,
            overflowY: "auto",
          }}
          onClick={() => setInvoice(null)}
        >
          <div style={{ maxWidth: 480, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setInvoice(null)}
              style={{ marginBottom: 8, background: "#fff", border: "1px solid var(--line, #e6e1d6)", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}
            >
              ✕ Close
            </button>
            <InvoiceReceipt invoice={invoice} />
          </div>
        </div>
      )}
      {showReorderCta && recommended.length === 0 && (
        <>
          {lastBookable && <RebookCta lastOrder={lastBookable} onRebooked={handleRebooked} />}
          <ReorderLabsCta hasOrderedBefore={hasAny} compact={!!lastBookable} />
        </>
      )}
    </section>
  );
}
