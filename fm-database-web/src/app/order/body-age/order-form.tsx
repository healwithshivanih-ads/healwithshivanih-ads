"use client";

/**
 * The body age order form: choose the report, give each person's details and the home-visit address, tick the
 * consent box, pay. The price shown is for display; the server works out the real one. After Checkout the signed
 * receipt goes back to the server, which is what marks the order paid.
 */
import { useState } from "react";
import { COPY } from "./order-copy";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

type Kind = "standard" | "deeper";
type Person = { full_name: string; date_of_birth: string; sex: string; email: string; phone: string };
const EMPTY: Person = { full_name: "", date_of_birth: "", sex: "", email: "", phone: "" };
const INK = "#2A292D";
const HOT = "#A93860";
const MUTE = "#6F6A72";
const RULE = "#DDD5CC";
const SERIF = "Georgia,'Times New Roman',serif";
const input: React.CSSProperties = { width: "100%", padding: "11px 12px", border: `1px solid ${RULE}`, borderRadius: 6, background: "#fff", fontSize: 16, color: INK };
const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, margin: "14px 0 5px" };
const h2: React.CSSProperties = { fontSize: 12.5, letterSpacing: 1.6, textTransform: "uppercase", fontWeight: 700, borderBottom: `1.5px solid ${INK}`, padding: "0 0 7px", margin: "34px 0 0" };

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

function PersonFields({ id, p, set }: { id: string; p: Person; set: (p: Person) => void }) {
  const f = COPY.fields;
  const on = (k: keyof Person) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set({ ...p, [k]: e.target.value });
  return (
    <>
      <label style={label} htmlFor={`${id}-name`}>{f.full_name}</label>
      <input id={`${id}-name`} style={input} value={p.full_name} onChange={on("full_name")} autoComplete="name" required />
      <label style={label} htmlFor={`${id}-dob`}>{f.date_of_birth}</label>
      <input id={`${id}-dob`} style={input} type="date" value={p.date_of_birth} onChange={on("date_of_birth")} required />
      <label style={label} htmlFor={`${id}-sex`}>{f.sex}</label>
      <select id={`${id}-sex`} style={input} value={p.sex} onChange={on("sex")} required>
        <option value="" />
        <option value="F">{f.female}</option>
        <option value="M">{f.male}</option>
      </select>
      <label style={label} htmlFor={`${id}-email`}>{f.email}</label>
      <input id={`${id}-email`} style={input} type="email" value={p.email} onChange={on("email")} autoComplete="email" required />
      <label style={label} htmlFor={`${id}-phone`}>{f.phone}</label>
      <input id={`${id}-phone`} style={input} type="tel" value={p.phone} onChange={on("phone")} autoComplete="tel" required />
    </>
  );
}

export function OrderForm({ test, minDate, prices }: { test: boolean; minDate: string; prices: Record<Kind, Record<1 | 2, number>> }) {
  const [kind, setKind] = useState<Kind>("standard");
  const [two, setTwo] = useState(false);
  const [a, setA] = useState<Person>(EMPTY);
  const [b, setB] = useState<Person>(EMPTY);
  const [visit, setVisit] = useState({ address: "", pincode: "", preferred_date: "", preferred_slot: "morning", notes: "" });
  const [consent, setConsent] = useState(false);
  const [voucher, setVoucher] = useState("");
  const [onWhatsApp, setOnWhatsApp] = useState(false);
  const [pin, setPin] = useState<"" | "yes" | "no" | "unknown">("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"form" | "confirming" | "done">("form");
  const [error, setError] = useState("");
  const amount = prices[kind][two ? 2 : 1];
  const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const onVisit = (k: keyof typeof visit) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setVisit({ ...visit, [k]: e.target.value });

  // Ask as soon as six digits are in, so someone outside the laboratory's area finds out before paying.
  const onPincode = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setVisit({ ...visit, pincode: value });
    setPin("");
    if (value.length !== 6) return;
    void fetch("/api/body-age/pincode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pincode: value }) })
      .then((r) => r.json())
      .then((j: { covered?: "yes" | "no" | "unknown" }) => setPin(j.covered ?? "unknown"))
      .catch(() => setPin("unknown"));
  };

  const waitForPaid = async (orderId: string, key: string) => {
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const j = (await fetch(`/api/body-age/order/${orderId}?key=${encodeURIComponent(key)}`).then((r) => r.json()).catch(() => null)) as { paid?: boolean } | null;
      if (j?.paid) return setState("done");
    }
  };

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/body-age/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_kind: kind, people: two ? [a, b] : [a], visit, consent, voucher_code: two ? "" : voucher, report_on_whatsapp: onWhatsApp }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; order_id: string; access_key: string; razorpay_order_id: string; amount_inr: number; keyId: string };
      if (!j.ok) throw new Error(j.error || "Payment could not be started. Please try again.");
      if (!(await loadRazorpay()) || !window.Razorpay) throw new Error("Payment is not available right now.");
      new window.Razorpay({
        key: j.keyId,
        order_id: j.razorpay_order_id,
        amount: j.amount_inr * 100,
        currency: "INR",
        name: "Shivani Hari",
        description: COPY.kinds[kind].name,
        prefill: { name: a.full_name, email: a.email, contact: a.phone },
        theme: { color: HOT },
        handler: async (r: { razorpay_payment_id?: string; razorpay_signature?: string }) => {
          setState("confirming");
          const c = (await fetch(`/api/body-age/order/${j.order_id}/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature }),
          }).then((x) => x.json()).catch(() => null)) as { paid?: boolean } | null;
          if (c?.paid) setState("done");
          else void waitForPaid(j.order_id, j.access_key); // the webhook will settle it
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment could not be started. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const banner = test && (
    <p role="status" style={{ background: "#fff", border: `1px solid ${HOT}`, color: HOT, padding: "9px 12px", fontSize: 13, fontWeight: 700, margin: "0 0 20px" }}>
      {COPY.testBanner}
    </p>
  );

  if (state !== "form") {
    return (
      <div>
        {banner}
        <h1 style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.2, margin: 0 }}>{state === "done" ? COPY.doneTitle : COPY.confirming}</h1>
        {state === "done" && (
          <ol style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.55, paddingLeft: 22, marginTop: 18, listStyle: "decimal" }}>
            {COPY.done.map((d) => (
              <li key={d} style={{ marginTop: 8 }}>{d}</li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={pay}>
      {banner}
      <h1 style={{ fontFamily: SERIF, fontSize: 34, lineHeight: 1.15, margin: 0 }}>{COPY.title}</h1>
      <p style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1.5, margin: "12px 0 0" }}>{COPY.lead}</p>
      <ol style={{ fontFamily: SERIF, fontSize: 16.5, lineHeight: 1.5, paddingLeft: 22, margin: "16px 0 0", listStyle: "decimal" }}>
        {COPY.how.map((x) => (
          <li key={x} style={{ marginTop: 5 }}>{x}</li>
        ))}
      </ol>

      <fieldset style={{ border: 0, padding: 0, margin: "26px 0 0" }}>
        {(["standard", "deeper"] as const).map((k) => (
          <label key={k} style={{ display: "flex", gap: 12, padding: "14px", marginTop: 10, background: "#fff", border: `1.5px solid ${kind === k ? HOT : RULE}`, borderRadius: 8, cursor: "pointer" }}>
            <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} style={{ marginTop: 5 }} />
            <span>
              <span style={{ fontFamily: SERIF, fontSize: 19, display: "block" }}>
                {COPY.kinds[k].name} <b style={{ color: HOT, whiteSpace: "nowrap" }}>{rupees(prices[k][two ? 2 : 1])}</b>
              </span>
              <span style={{ fontSize: 14, color: MUTE, lineHeight: 1.45, display: "block", marginTop: 4 }}>{COPY.kinds[k].about}</span>
            </span>
          </label>
        ))}
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, fontSize: 15 }}>
          <input type="checkbox" checked={two} onChange={(e) => setTwo(e.target.checked)} style={{ marginTop: 4 }} />
          <span>
            <b>{COPY.forTwo}</b> <span style={{ color: MUTE }}>· {COPY.forTwoAbout}</span>
          </span>
        </label>
        <p style={{ fontSize: 13, color: MUTE, margin: "10px 0 0" }}>{COPY.priceNote}</p>
      </fieldset>

      <h2 style={h2}>{COPY.sections.who}</h2>
      <PersonFields id="a" p={a} set={setA} />
      {two && (
        <>
          <h2 style={h2}>{COPY.sections.second}</h2>
          <PersonFields id="b" p={b} set={setB} />
        </>
      )}

      <h2 style={h2}>{COPY.sections.visit}</h2>
      <label style={label} htmlFor="v-address">{COPY.fields.address}</label>
      <textarea id="v-address" style={{ ...input, minHeight: 84 }} value={visit.address} onChange={onVisit("address")} autoComplete="street-address" required />
      <label style={label} htmlFor="v-pin">{COPY.fields.pincode}</label>
      <input id="v-pin" style={input} inputMode="numeric" pattern="\d{6}" maxLength={6} value={visit.pincode} onChange={onPincode} autoComplete="postal-code" required />
      {pin === "yes" && <p style={{ fontSize: 13, color: MUTE, margin: "6px 0 0" }}>{COPY.pin.yes}</p>}
      {pin === "no" && <p role="alert" style={{ fontSize: 14, color: HOT, margin: "6px 0 0" }}>{COPY.pin.no}</p>}
      <label style={label} htmlFor="v-date">{COPY.fields.preferred_date}</label>
      <input id="v-date" style={input} type="date" min={minDate} value={visit.preferred_date} onChange={onVisit("preferred_date")} required />
      <label style={label} htmlFor="v-slot">{COPY.fields.preferred_slot}</label>
      <select id="v-slot" style={input} value={visit.preferred_slot} onChange={onVisit("preferred_slot")}>
        <option value="morning">{COPY.slots.morning}</option>
        <option value="late_morning">{COPY.slots.late_morning}</option>
      </select>
      <label style={label} htmlFor="v-notes">{COPY.fields.notes}</label>
      <input id="v-notes" style={input} value={visit.notes} onChange={onVisit("notes")} maxLength={300} />
      {!two && (
        <>
          <label style={label} htmlFor="v-voucher">{COPY.fields.voucher}</label>
          <input id="v-voucher" style={input} value={voucher} onChange={(e) => setVoucher(e.target.value)} maxLength={24} autoCapitalize="characters" autoComplete="off" />
          <p style={{ fontSize: 13, color: MUTE, margin: "6px 0 0" }}>{COPY.voucherNote}</p>
        </>
      )}
      <p style={{ fontSize: 13, color: MUTE, margin: "10px 0 0" }}>{COPY.visitNote}</p>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "22px 0 0", fontSize: 14.5, lineHeight: 1.45 }}>
        <input type="checkbox" checked={onWhatsApp} onChange={(e) => setOnWhatsApp(e.target.checked)} style={{ marginTop: 4 }} />
        <span>{COPY.whatsappTick}</span>
      </label>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "26px 0 0", fontSize: 14.5, lineHeight: 1.45 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 4 }} required />
        <span>{COPY.consent}</span>
      </label>

      {error && (
        <p role="alert" style={{ color: HOT, fontSize: 14.5, margin: "16px 0 0" }}>{error}</p>
      )}
      <button type="submit" disabled={busy || pin === "no"} style={{ width: "100%", margin: "18px 0 0", padding: "15px 20px", background: HOT, color: "#fff", border: 0, borderRadius: 6, fontSize: 17, fontWeight: 700, cursor: "pointer", opacity: busy || pin === "no" ? 0.6 : 1 }}>
        {busy ? COPY.paying : `${COPY.pay} ${rupees(amount)}`}
      </button>
    </form>
  );
}
