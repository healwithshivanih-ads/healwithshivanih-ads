"use server";

/**
 * Coach-side receipt actions — view/resend a payment receipt for a lab
 * payment. (The maintenance-order / maintenance-charge getters were removed
 * 2026-10-23 — no caller.) Idempotent (see fm-database-web/src/lib/fmdb/invoices.ts):
 * calling this after the webhook already auto-generated one just re-fetches the
 * same invoice number, so this doubles as the manual "resend/reprint" path.
 */

import { loadOrder } from "@/lib/fmdb/lab-orders";
import { getOrCreateLabOrderInvoice, type Invoice } from "@/lib/fmdb/invoices";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const safeId = (id: unknown): id is string => typeof id === "string" && SAFE_ID.test(id);

const onPublicBox = (): boolean => process.env.FLY_INTAKE_ONLY === "1";

type Result = { ok: true; invoice: Invoice } | { ok: false; error: string };

export async function getLabOrderInvoiceAction(clientId: string, orderId: string): Promise<Result> {
  if (onPublicBox()) return { ok: false, error: "unavailable" };
  if (!safeId(clientId) || !safeId(orderId)) return { ok: false, error: "bad id" };
  const order = await loadOrder(clientId, orderId);
  if (!order) return { ok: false, error: "order not found" };
  const invoice = await getOrCreateLabOrderInvoice(clientId, orderId);
  if (!invoice) return { ok: false, error: `order is ${order.status} — a receipt needs a real payment` };
  return { ok: true, invoice };
}
