"use client";

/**
 * The pay button for /foundation/<token>. Opens in-app Razorpay Checkout for the
 * fixed foundation-session price. "Paid" is confirmed by the server webhook, not
 * here — after Checkout we show "confirming" and poll the route (router.refresh)
 * until the server re-renders the PAID branch (intake + booking). Mirrors the
 * lab-pay checkout pattern (ochre-lab-pay.tsx).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

export function FoundationPayClient({
  token,
  clientId,
  amountInr,
}: {
  token: string;
  clientId: string;
  amountInr: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // While "confirming", re-fetch the page every few seconds so the server can
  // flip us to the PAID branch as soon as the webhook lands. Give up after ~3min.
  useEffect(() => {
    if (!confirming) return;
    let ticks = 0;
    pollRef.current = setInterval(() => {
      ticks += 1;
      router.refresh();
      if (ticks >= 45 && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [confirming, router]);

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/foundation/${clientId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        razorpay_order_id?: string;
        amount_inr?: number;
        currency?: string;
        keyId?: string;
      };
      if (!j.ok) {
        // Already paid (e.g. a second tab) → refresh into the paid branch.
        if (j.error === "already paid") {
          setConfirming(true);
          return;
        }
        throw new Error(j.error || "could not start payment");
      }
      const loaded = await loadRazorpay();
      if (!loaded || !window.Razorpay) throw new Error("payment is unavailable right now");
      const rzp = new window.Razorpay({
        key: j.keyId,
        order_id: j.razorpay_order_id,
        amount: (j.amount_inr ?? amountInr) * 100,
        currency: j.currency ?? "INR",
        name: "The Ochre Tree",
        description: "Foundation Session",
        theme: { color: "#2d5a3d" },
        // Webhook is the source of truth; here we just start confirming.
        handler: () => setConfirming(true),
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "payment failed");
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center shadow-sm">
        <p className="text-sm font-medium text-emerald-800">Confirming your payment…</p>
        <p className="mt-1 text-xs text-emerald-700">
          This page will update on its own the moment it&apos;s through. You can keep it open.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="w-full rounded-xl bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {busy ? "Opening secure checkout…" : `Book my Foundation Session · ₹${amountInr.toLocaleString("en-IN")}`}
      </button>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
