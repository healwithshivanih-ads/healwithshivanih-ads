/**
 * POST /api/maintenance/[clientId]/payment-link
 *
 * Coach-triggered: creates a SHAREABLE Razorpay Payment Link for a maintenance
 * block (so a graduate/lapsed client can pay from an email or WhatsApp, no app
 * needed) and returns its short_url. The amount is the server constant
 * (MAINTENANCE_PRICING) — never trusted from the caller.
 *
 * Uses the default RAZORPAY_* account — the same keys as the in-app maintenance
 * checkout and lab payments. Point those Fly secrets at the Ochre Life account
 * to route all client payments there (coach decision 2026-09-07). Must run where
 * the LIVE keys live (Fly).
 *
 * Auth: server-to-server, x-coach-secret must match CRON_SECRET (the coach's
 * existing shared secret). Not client-token auth — the coach initiates this.
 *
 * "Paid" is still set ONLY by the verified webhook (payment_link.paid /
 * payment.captured) — see ../webhook/route.ts. This route only mints the link
 * and a pending order.
 */
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import Razorpay from "razorpay";
import { getPlansRoot } from "@/lib/fmdb/paths";
import {
  maintenancePrice,
  buildMaintenanceOrder,
  createMaintenanceOrder,
  patchMaintenanceOrder,
  nextMaintenanceOrderId,
  DEFAULT_MAINTENANCE_TERM_MONTHS,
} from "@/lib/fmdb/maintenance-orders";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Last-10-digit → E.164-ish contact Razorpay accepts (India). */
function normalizeContact(mobile: string): string | undefined {
  const digits = (mobile || "").replace(/\D/g, "");
  if (digits.length < 10) return undefined;
  const last10 = digits.slice(-10);
  return `+91${last10}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-coach-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { clientId } = await ctx.params;
  if (!SAFE_ID.test(clientId)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as { termMonths?: number } | null;
  const termMonths = Number(body?.termMonths ?? DEFAULT_MAINTENANCE_TERM_MONTHS);
  if (maintenancePrice(termMonths) == null) {
    return NextResponse.json({ ok: false, error: "term not offered" }, { status: 400 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return NextResponse.json({ ok: false, error: "payments not configured" }, { status: 503 });
  }

  // Client contact for the link (best-effort — Razorpay is fine without them).
  let name = "";
  let email = "";
  let contact: string | undefined;
  try {
    const raw = await fs.readFile(
      path.join(getPlansRoot(), "clients", clientId, "client.yaml"),
      "utf-8",
    );
    const c = (yaml.load(raw) as Record<string, unknown>) ?? {};
    name = String(c.display_name ?? "").trim();
    email = String(c.email ?? "").trim();
    contact = normalizeContact(String(c.mobile_number ?? ""));
  } catch {
    return NextResponse.json({ ok: false, error: "client not found" }, { status: 404 });
  }

  const built = buildMaintenanceOrder(
    await nextMaintenanceOrderId(clientId, istToday()),
    clientId,
    termMonths,
    new Date().toISOString(),
  );
  if (!built.ok) return NextResponse.json({ ok: false, error: built.error }, { status: 400 });
  await createMaintenanceOrder(built.order);

  let shortUrl: string;
  let linkId: string;
  try {
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const link = await rzp.paymentLink.create({
      amount: Math.round(built.order.amount_inr * 100), // paise
      currency: "INR",
      accept_partial: false,
      description: `The Ochre Tree — maintenance (${termMonths} months)`,
      reference_id: built.order.order_id, // unique; echoed back on payment_link.paid
      customer: { name: name || undefined, email: email || undefined, contact },
      notify: { email: !!email, sms: !!contact },
      reminder_enable: true,
      notes: { client_id: clientId, order_id: built.order.order_id, kind: "maintenance" },
    });
    shortUrl = String(link.short_url);
    linkId = String(link.id);
  } catch (e) {
    const rzp = e as { statusCode?: number; error?: { code?: string; description?: string } };
    const detail = rzp?.error?.description ?? (e instanceof Error ? e.message : String(e));
    console.error(
      `[maint-link] razorpay payment link failed (status ${rzp?.statusCode ?? "?"}, code ${rzp?.error?.code ?? "?"}): ${detail}`,
    );
    return NextResponse.json({ ok: false, error: "could not create payment link" }, { status: 502 });
  }

  await patchMaintenanceOrder(clientId, built.order.order_id, {
    razorpay_payment_link_id: linkId,
    payment_link_short_url: shortUrl,
  });

  return NextResponse.json({
    ok: true,
    short_url: shortUrl,
    payment_link_id: linkId,
    amount_inr: built.order.amount_inr,
    term_months: termMonths,
    order_id: built.order.order_id,
    live: keyId.startsWith("rzp_live_"),
  });
}
