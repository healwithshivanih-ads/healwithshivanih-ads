/**
 * In-app refund request for a paid course buyer (Calm Gut: 7-day, no
 * questions; automatic, Shivani 22 Nov 2026 "Yes, automate it").
 *
 * The app never touches money. It asks ochre-funnel, which owns the
 * Razorpay payment, to refund it:
 *
 *   POST  CALM_GUT_REFUND_URL   (ochre-funnel /api/calm-gut/refund)
 *   x-guided-secret: COURSE_REFUND_SECRET || GUIDED_ENROLL_SECRET
 *   { payment_id, subscriber_id, course, requested_at }
 *   → 2xx with { ok: true } = the refund was started.
 *
 * ok → access ends here, once (markGuidedRefunded is idempotent, so the
 *      funnel calling /api/guided-enroll/deactivate as well is harmless).
 * anything else (unset URL, timeout, 4xx/5xx, ok:false) → the request is
 *      noted on the record, access stays on, and it is done by hand
 *      ("within 2 working days").
 * Who tells Shivani: when the funnel ANSWERED (any JSON reply, ok:false
 *      included) it has already put a "refund by hand" to-do on her phone,
 *      so the app stays quiet. Only when the funnel could not be reached
 *      (unset URL, network error, timeout, a reply with no JSON body) does
 *      the app email her, once.
 */

import type { GuidedSubscriber } from "./guided-tier";

export const REFUND_WINDOW_MS = 7 * 86_400_000;

export interface RefundOffer {
  /** The link shows (paid, in the window, not yet ended). */
  eligible: boolean;
  amountPaise: number;
  /** ISO end of the 7-day window. */
  until: string;
  /** A request is waiting to be done by hand. */
  pendingSince: string | null;
}

/** Paid course buyers only (never a gift), for 7 days from purchase. */
export function refundOffer(sub: GuidedSubscriber, now: Date = new Date()): RefundOffer {
  const bought = Date.parse(sub.purchased_at || sub.created_at);
  const until = Number.isFinite(bought) ? new Date(bought + REFUND_WINDOW_MS).toISOString() : new Date(0).toISOString();
  const paid = sub.product === "course" && sub.reason !== "gift" && sub.amount_paisa > 0 && !sub.payment_id.startsWith("gift-");
  const inWindow = Number.isFinite(bought) && now.getTime() <= bought + REFUND_WINDOW_MS;
  return {
    eligible: paid && inWindow && sub.status === "active",
    amountPaise: paid ? sub.amount_paisa : 0,
    until,
    pendingSince: sub.refund_requested_at ?? null,
  };
}

/** "₹1,999" (whole rupees; paise shown only when there are any). */
export function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** `reached`: the funnel answered with JSON (so it knows, and alerts
 *  Shivani itself). False: it never got the request, or its reply was not
 *  JSON (a crash / proxy error page). */
export type FunnelRefundResult = { ok: true } | { ok: false; why: string; reached: boolean };

/** Ask ochre-funnel to refund. Never throws; 15 s timeout. */
export async function requestFunnelRefund(
  sub: GuidedSubscriber,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<FunnelRefundResult> {
  const env = opts.env ?? process.env;
  const url = env.CALM_GUT_REFUND_URL || "";
  const secret = env.COURSE_REFUND_SECRET || env.GUIDED_ENROLL_SECRET || "";
  if (!url || !secret) return { ok: false, why: "refund URL or secret not set", reached: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-guided-secret": secret },
      body: JSON.stringify({
        payment_id: sub.payment_id,
        subscriber_id: sub.subscriber_id,
        course: sub.courses[0] ?? "calm-gut",
        requested_at: (opts.now ?? new Date()).toISOString(),
      }),
      signal: ctrl.signal,
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && j?.ok === true) return { ok: true };
    return { ok: false, why: `HTTP ${res.status}${j?.error ? `: ${j.error}` : ""}`, reached: j !== null && typeof j === "object" };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : "request failed", reached: false };
  } finally {
    clearTimeout(timer);
  }
}

/** One email to Shivani (ops mailbox → her digest address) when a refund has
 *  to be done by hand. Internal alert, never to the buyer. */
export async function tellCoachRefundPending(sub: GuidedSubscriber, why: string): Promise<boolean> {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return false;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.default.createTransport({ service: "gmail", auth: { user, pass } });
  await t.sendMail({
    from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
    to: process.env.COACH_DIGEST_EMAIL || user,
    subject: `Calm Gut refund to do by hand: ${sub.display_name || sub.email}`,
    text: [
      `${sub.display_name || "A buyer"} (${sub.email || sub.phone}) asked for a refund in the app, and the automatic refund didn't go through (${why}).`,
      "",
      `Payment: ${sub.payment_id} · ${rupees(sub.amount_paisa)} · bought ${sub.purchased_at.slice(0, 10)}`,
      "",
      "The app told them it will be done within 2 working days. Refund it in Razorpay, then turn off their access (the funnel's \"Refunded: turn off access\" button). Their access stays on until then.",
    ].join("\n"),
  });
  return true;
}
