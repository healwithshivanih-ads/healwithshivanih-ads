"use client";

/* ======================================================================
   The Ochre Tree — checkout (UPI + card)
   ----------------------------------------------------------------------
   The payment surface shown on the graduation / review screen when a
   client chooses to Continue (Phase 2) or Maintain (₹2,000/mo). This is
   the UI ONLY — the actual Razorpay call is a single seam (`onPay`) to be
   wired in Phase 1b. Until then the button shows a gentle holding state
   ("Shivani will confirm"), never a fake "paid".

   Styling reuses the app design system (app.css, scoped under .ochre-app):
   .card / .eyebrow / .divider-ochre / .h-serif / .seg / .submit-btn.
   ====================================================================== */

import { useState } from "react";
import { Icon } from "./ochre-context";

export type CheckoutTrack = "maintain" | "continue";
export type PaymentMethod = "upi" | "card";

export interface OchreCheckoutProps {
  /** Which choice the client made on the review screen. */
  track: CheckoutTrack;
  /** Headline, e.g. "Maintenance plan" or "Continue — Phase 2". */
  title: string;
  /** One-line description under the title. */
  blurb?: string;
  /** What they'll pay now, e.g. "₹12,000". */
  amountLabel: string;
  /** Cadence / breakdown, e.g. "for 6 months · ₹2,000/mo". */
  cadenceLabel?: string;
  /** Coach first name for the holding-state copy. */
  coachFirstName?: string;
  /**
   * Razorpay seam — Phase 1b passes this to launch the real checkout.
   * When omitted (today), the button shows a holding state instead of
   * pretending payment happened. DO NOT fake a success here.
   */
  onPay?: (method: PaymentMethod) => void;
}

export function OchreCheckout({
  track,
  title,
  blurb,
  amountLabel,
  cadenceLabel,
  coachFirstName = "Shivani",
  onPay,
}: OchreCheckoutProps) {
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [holding, setHolding] = useState(false);

  const eyebrow = track === "maintain" ? "Ongoing support" : "Your next chapter";

  function handlePay() {
    if (onPay) {
      // Phase 1b: hand off to the real Razorpay checkout.
      onPay(method);
      return;
    }
    // Stub (pre-Razorpay): honest holding state, no fake success.
    setHolding(true);
  }

  return (
    <div className="card" style={{ padding: "18px 18px 20px", marginTop: 16 }}>
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="h-serif" style={{ fontSize: 22, margin: "7px 0 0", lineHeight: 1.2 }}>
        {title}
      </h2>
      {blurb && (
        <div className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
          {blurb}
        </div>
      )}

      <div className="divider-ochre" />

      {/* price block */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 2 }}>
        <span
          className="h-serif"
          style={{ fontSize: 30, color: "var(--forest-deep)", lineHeight: 1 }}
        >
          {amountLabel}
        </span>
        {cadenceLabel && (
          <span className="muted" style={{ fontSize: 13 }}>
            {cadenceLabel}
          </span>
        )}
      </div>

      {/* payment method toggle */}
      <div className="seg" style={{ marginTop: 16 }} role="tablist" aria-label="Payment method">
        <button
          type="button"
          className={method === "upi" ? "on" : ""}
          aria-pressed={method === "upi"}
          onClick={() => setMethod("upi")}
        >
          UPI
        </button>
        <button
          type="button"
          className={method === "card" ? "on" : ""}
          aria-pressed={method === "card"}
          onClick={() => setMethod("card")}
        >
          Card
        </button>
      </div>

      {/* primary pay button */}
      <button
        type="button"
        className="submit-btn"
        style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        onClick={handlePay}
        disabled={holding}
      >
        {holding ? (
          "One moment…"
        ) : (
          <>
            Pay {amountLabel} {method === "upi" ? "via UPI" : "by card"}
            <Icon name="arrowRight" size={18} />
          </>
        )}
      </button>

      {/* reassurance / holding state */}
      {holding ? (
        <div
          className="card-quiet soon"
          style={{ marginTop: 12 }}
        >
          <Icon name="check" size={16} style={{ color: "var(--forest)" }} />
          <span>
            Payment opens here shortly — <strong>{coachFirstName}</strong> will confirm your spot in the meantime.
          </span>
        </div>
      ) : (
        <div
          className="muted"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11.5, marginTop: 10 }}
        >
          <Icon name="check" size={13} />
          Secure UPI &amp; card payment
        </div>
      )}
    </div>
  );
}
