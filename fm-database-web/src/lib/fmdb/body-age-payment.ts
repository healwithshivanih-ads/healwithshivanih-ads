/**
 * Marking a body age order paid, and telling the coach. Two verified doors lead here and both are safe to arrive
 * twice: the payment company's webhook, and the signed receipt the buyer's browser hands back after Checkout
 * (an HMAC only the holder of the key secret can produce, so it is not "the browser's word").
 *
 * The buyer is sent nothing from here (no automatic sends). The coach gets one plain email, best-effort.
 */
import crypto from "node:crypto";
import { loadBodyAgeOrder, patchBodyAgeOrder, type BodyAgeOrder } from "./body-age-orders";

/** Razorpay's Checkout receipt: HMAC-SHA256 of "<razorpay order id>|<payment id>" with the key secret. */
export function receiptIsGenuine(rzpOrderId: string, rzpPaymentId: string, signature: string, keySecret: string): boolean {
  if (!rzpOrderId || !rzpPaymentId || !signature || !keySecret) return false;
  const expected = crypto.createHmac("sha256", keySecret).update(`${rzpOrderId}|${rzpPaymentId}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type SettleResult =
  | { ok: true; order: BodyAgeOrder; already: boolean }
  | { ok: false; skipped: string };

/** pending → paid for one order, once. The caller has ALREADY verified the payment. */
export async function settleBodyAgePayment(input: {
  orderId: string;
  rzpOrderId: string;
  rzpPaymentId: string;
  nowIso?: string;
}): Promise<SettleResult> {
  const order = await loadBodyAgeOrder(input.orderId);
  if (!order) return { ok: false, skipped: "order not found" };
  if (!order.razorpay_order_id || order.razorpay_order_id !== input.rzpOrderId) {
    return { ok: false, skipped: "payment does not belong to this order" };
  }
  if (order.status !== "pending") {
    // Paid already (by the other door, or a redelivery) or moved on: nothing to do, and no second coach email.
    return order.razorpay_payment_id ? { ok: true, order, already: true } : { ok: false, skipped: `status ${order.status}` };
  }
  const next = await patchBodyAgeOrder(order.order_id, {
    status: "paid",
    razorpay_payment_id: input.rzpPaymentId,
    paid_at: input.nowIso ?? new Date().toISOString(),
  });
  if (!next) return { ok: false, skipped: "order gone" };
  await tellCoach(next).catch((e) => console.error("[body-age-order] coach email failed:", e));
  return { ok: true, order: next, already: false };
}

export function coachEmail(order: BodyAgeOrder): { subject: string; text: string } {
  const who = order.people.map((p) => p.full_name).join(" and ");
  const what = `${order.report_kind === "deeper" ? "Body age report with deeper tests" : "Body age report"}${order.people.length === 2 ? ", for two" : ""}`;
  const lines = [
    `${order.test ? "TEST ORDER (no real money, do not book the laboratory).\n\n" : ""}${who} paid ₹${order.amount_inr.toLocaleString("en-IN")} for: ${what}.`,
    "",
    `Home visit asked for: ${order.visit.preferred_date}, ${order.visit.preferred_slot.replace("_", " ")}`,
    `Address: ${order.visit.address}, ${order.visit.pincode}`,
    ...(order.visit.notes ? [`Their note: ${order.visit.notes}`] : []),
    "",
    ...order.people.map((p) => `${p.full_name} · ${p.sex} · born ${p.date_of_birth} · ${p.phone} · ${p.email}`),
    "",
    `Order ${order.order_id}. Nothing has been sent to them. Book the home visit, then mark it booked in the coach app.`,
  ];
  return { subject: `${order.test ? "[TEST] " : ""}Body age report ordered: ${who}`, text: lines.join("\n") };
}

/** One email to the coach herself (the ops mailbox to her digest address), never to the buyer. */
async function tellCoach(order: BodyAgeOrder): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return;
  const { subject, text } = coachEmail(order);
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({ service: "gmail", auth: { user, pass } });
  await transporter.sendMail({
    from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
    to: process.env.COACH_DIGEST_EMAIL || user,
    subject,
    text,
  });
}
