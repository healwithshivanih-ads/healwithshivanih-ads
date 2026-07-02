/**
 * POST /api/lab-order/webhook
 *
 * Razorpay payment webhook — the ONLY source of truth for marking a lab order
 * `paid`. HMAC-verifies the signature against the raw body with
 * RAZORPAY_WEBHOOK_SECRET (timing-safe); on a verified `order.paid` /
 * `payment.captured`, flips the matching order `recommended → paid`. Idempotent on
 * razorpay_payment_id. Never trusts a client-side success callback.
 *
 * Returns 200 for unresolvable-but-valid events so Razorpay doesn't retry forever;
 * 400 only for a bad/absent signature.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { findOrderByRazorpayOrderId, loadOrder, transitionOrder, type LabOrder } from "@/lib/fmdb/lab-orders";
import { loadLabProvider } from "@/lib/fmdb/lab-providers";
import { buildPaymentEvent, clientJoinKeyFor, emitRevenueEvent } from "@/lib/fmdb/revenue-export";

/** Profile id → the label for its hormone/extra test block (v3 message). */
const HORMONE_HEADER: Record<number, string> = {
  2: "Reproductive hormones",
  3: "Perimenopause hormones",
  4: "Male hormones",
};

export const dynamic = "force-dynamic";

/**
 * Age + sex label for the lab-partner alert (e.g. "42F"), read from
 * clients/<id>/client.yaml. Age from date_of_birth, else the age_band
 * midpoint. Best-effort: returns "" on any miss so a booking still notifies
 * without it. Acumen wants age for reference ranges / tube selection.
 */
async function clientAgeSexLabel(clientId: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(getPlansRoot(), "clients", clientId, "client.yaml"), "utf8");
    const c = (yaml.load(raw) ?? {}) as Record<string, unknown>;
    const sex = typeof c.sex === "string" ? c.sex.trim().toUpperCase().slice(0, 1) : "";
    let age = "";
    const dob = typeof c.date_of_birth === "string" ? c.date_of_birth.trim() : "";
    if (dob) {
      const y = Math.floor((Date.now() - new Date(`${dob}T00:00:00Z`).getTime()) / (365.25 * 86_400_000));
      if (y > 0 && y < 130) age = String(y);
    }
    if (!age && typeof c.age_band === "string" && c.age_band.trim()) {
      const m = c.age_band.match(/(\d+)\s*-\s*(\d+)/);
      age = m ? String(Math.round((Number(m[1]) + Number(m[2])) / 2)) : c.age_band.trim();
    }
    return [age, sex].filter(Boolean).join(""); // "42F" | "42" | "F" | ""
  } catch {
    return "";
  }
}

/**
 * Best-effort: ping the lab partner (Abhinav) + the coach's own + admin numbers
 * on WhatsApp the moment a booking is paid, so they can arrange the home
 * collection. Self-contained (no "use server" import) so it runs from this route;
 * sends the Meta-approved template `fm_lab_booking_v1` via the self-hosted
 * WhatsApp server. Stays INERT until these env vars are set on Fly:
 * WHATSAPP_SERVER_URL, WHATSAPP_SERVER_API_KEY, and LAB_PARTNER_WHATSAPP (a
 * comma-separated list of recipients). Never throws into the webhook — the
 * payment is already recorded; a notify failure is logged, not surfaced.
 *
 * Meta rejects template params containing newlines / tabs / 4+ spaces, so every
 * param is flattened to single-spaced text.
 */
async function notifyLabPartner(order: LabOrder): Promise<void> {
  const url = (process.env.WHATSAPP_SERVER_URL ?? "").replace(/\/$/, "");
  const apiKey = process.env.WHATSAPP_SERVER_API_KEY ?? "";
  // Comma-separated list → clean each to "+digits", drop junk, de-dup. The alert
  // fans out to every number (lab partner + the coach's own + admin).
  const recipients = [
    ...new Set(
      (process.env.LAB_PARTNER_WHATSAPP ?? "")
        .split(",")
        .map((s) => s.replace(/[^\d+]/g, ""))
        .filter((s) => s.replace(/\D/g, "").length >= 8),
    ),
  ];
  if (!url || !apiKey || recipients.length === 0) return; // not configured → no-op

  const l = order.logistics;
  if (!l) return; // no collection details → nothing actionable to send
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const panel = order.lines[0]?.label ?? "Lab panel";
  const fasting = order.fasting_required ? " · fasting sample" : "";
  const slot = l.preferred_slot.replace(/_/g, " ");
  // Include the client's age/sex on the "Client:" line (e.g. "Meghana Dighe · 42F")
  // so Acumen has it for reference ranges. Folded into {{1}} to avoid a new
  // template placeholder (which would need Meta re-approval).
  const ageSex = await clientAgeSexLabel(order.client_id);
  const nameField = ageSex ? `${flat(l.full_name)} · ${ageSex}` : flat(l.full_name);
  // The gender/age profiles (ids 2–4) are "Base panel + <profile>" — the Base
  // panel is always included — so label the package that way for Acumen (e.g.
  // "Base + Perimenopause"). Base itself (id 1) and add-on-only orders stay as-is.
  const packageName =
    order.profile_id === 1 ? "Base Panel"
    : order.profile_id != null ? `Base + ${panel}`
    : panel;
  const listText = order.includes?.length ? order.includes.join("; ") : panel;
  // Our cost = what Acumen invoices us (order.our_cost_inr — profile cost + any
  // add-ons at 50% of catalogue). NOT the client MRP; Acumen never sees margin.
  const ourCost = `₹${(order.our_cost_inr ?? 0).toLocaleString("en-IN")}`;

  // v3 (fm_lab_booking_v3): the readable layout — bold labels + the tests split
  // into a Base-panel block and a hormones/add-ons block (bullet " · " within
  // each; true per-test line breaks aren't allowed inside a param). Split by
  // matching against the Base profile's includes from the catalogue.
  const provider = await loadLabProvider();
  const baseIncludes = new Set(provider?.profiles.find((p) => p.id === 1)?.includes ?? []);
  const allTests = order.includes?.length ? order.includes : [panel];
  const baseTests = baseIncludes.size ? allTests.filter((t) => baseIncludes.has(t)) : allTests;
  const extraTests = baseIncludes.size ? allTests.filter((t) => !baseIncludes.has(t)) : [];
  const groupHeader = (order.profile_id != null && HORMONE_HEADER[order.profile_id]) || "Hormones & add-ons";
  const collectionLine = `${l.preferred_date}, ${slot}${order.fasting_required ? " · fasting" : ""}`;
  const v3Params = [
    flat(nameField),                        // {{1}} Client (name · age/sex)
    flat(l.phone),                          // {{2}} Phone
    flat(packageName),                      // {{3}} Package (Base + <profile>)
    flat(ourCost),                          // {{4}} Our cost (to Acumen)
    flat(baseTests.join(" · ")) || "—",     // {{5}} Base panel markers
    flat(groupHeader),                      // {{6}} hormones/add-ons block header
    flat(extraTests.join(" · ")) || "—",    // {{7}} hormones/add-ons markers
    flat(collectionLine),                   // {{8}} Collection (+ fasting)
    flat(`${l.address}, ${l.pincode}`),     // {{9}} Address
  ];
  // v2 (fm_lab_booking_v2): clean labelled lines incl. Package + Our cost.
  // Params can't contain newlines, so the test list is one "; "-joined line.
  const v2Params = [
    flat(nameField),                        // {{1}} Client (name · age/sex)
    flat(l.phone),                          // {{2}} Phone
    flat(packageName),                      // {{3}} Package (Base + <profile>)
    flat(`${listText}${fasting}`),          // {{4}} Tests (full itemised list)
    flat(ourCost),                          // {{5}} Our cost (to Acumen)
    flat(`${l.address}, ${l.pincode}`),     // {{6}} Address
    flat(`${l.preferred_date}, ${slot}`),   // {{7}} Preferred collection
  ];
  // v1 (fm_lab_booking_v1): the original 5-field message — fallback while v2 is
  // awaiting Meta approval, so a booking is never left un-notified.
  const v1Params = [
    flat(nameField),
    flat(l.phone),
    flat(`${l.address}, ${l.pincode}`),
    flat(`${packageName}: ${listText}${fasting}`),
    flat(`${l.preferred_date}, ${slot}`),
  ];

  const postTemplate = async (to: string, templateName: string, templateParams: string[]): Promise<boolean> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`${url}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          phone: to,
          type: "template",
          templateName,
          templateLanguage: "en",
          templateParams,
          origin: "api",
          originRef: "lab-booking",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[lab-notify] WA ${templateName} → ${to} failed HTTP ${res.status}: ${detail.slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error(`[lab-notify] WA ${templateName} → ${to} threw:`, (e as Error).message);
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  // Prefer the richest approved template; fall back down the chain so a send
  // never fails just because a newer template is still pending Meta approval.
  const sendTo = async (to: string): Promise<void> => {
    if (await postTemplate(to, "fm_lab_booking_v3", v3Params)) return;
    if (await postTemplate(to, "fm_lab_booking_v2", v2Params)) return;
    await postTemplate(to, "fm_lab_booking_v1", v1Params);
  };

  // Independent sends — one bad number never blocks the others (or the webhook).
  await Promise.all(recipients.map(sendTo));
}

interface RzpEntity {
  id?: string;
  order_id?: string;
  notes?: { client_id?: string; order_id?: string };
}
interface RzpEvent {
  event?: string;
  payload?: { order?: { entity?: RzpEntity }; payment?: { entity?: RzpEntity } };
}

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 400 });
  }

  let event: RzpEvent;
  try {
    event = JSON.parse(raw) as RzpEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  if (event.event !== "order.paid" && event.event !== "payment.captured") {
    return NextResponse.json({ ok: true, ignored: event.event ?? null });
  }

  const orderEntity = event.payload?.order?.entity;
  const paymentEntity = event.payload?.payment?.entity;
  const rzpOrderId = orderEntity?.id ?? paymentEntity?.order_id ?? "";
  const rzpPaymentId = paymentEntity?.id ?? "";
  if (!rzpOrderId || !rzpPaymentId) return NextResponse.json({ ok: true, skipped: "missing ids" });

  // Resolve our order: prefer the notes we set at pay-time, else scan by rzp id.
  let clientId = orderEntity?.notes?.client_id ?? "";
  let orderId = orderEntity?.notes?.order_id ?? "";
  if (!clientId || !orderId) {
    const found = await findOrderByRazorpayOrderId(rzpOrderId);
    if (!found) return NextResponse.json({ ok: true, skipped: "order not found" });
    clientId = found.clientId;
    orderId = found.order.order_id;
  }

  const order = await loadOrder(clientId, orderId);
  if (!order) return NextResponse.json({ ok: true, skipped: "order gone" });
  // Defence: the order's razorpay_order_id must match the event's.
  if (order.razorpay_order_id && order.razorpay_order_id !== rzpOrderId) {
    return NextResponse.json({ ok: true, skipped: "rzp order mismatch" });
  }
  // Idempotent: a re-delivered webhook for an already-paid order is a no-op.
  if (order.status === "paid" && order.razorpay_payment_id === rzpPaymentId) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (order.status !== "recommended") {
    return NextResponse.json({ ok: true, skipped: `status ${order.status}` });
  }

  const res = await transitionOrder(clientId, orderId, "paid", {
    razorpay_payment_id: rzpPaymentId,
    paid_at: new Date().toISOString(),
  });
  // Booking is paid — ping the lab partner so they can arrange collection.
  // Best-effort + awaited (so failures log); never blocks the 200 to Razorpay.
  if (res.ok) await notifyLabPartner(order);
  // Revenue export (Loop 1) — best-effort; emitRevenueEvent never throws.
  if (res.ok) {
    await emitRevenueEvent(
      buildPaymentEvent({
        product: "lab",
        amountPaisa: (order.amount_inr ?? 0) * 100,
        razorpayPaymentId: rzpPaymentId,
        paidAt: new Date().toISOString(),
        client: await clientJoinKeyFor(clientId),
      }),
    );
  }
  return NextResponse.json({ ok: res.ok });
}
