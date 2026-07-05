"use server";

/**
 * Coach-side receipt actions — view/resend a payment receipt for any lab or
 * maintenance payment. Idempotent (see fm-database-web/src/lib/fmdb/invoices.ts):
 * calling this after the webhook already auto-generated one just re-fetches the
 * same invoice number, so this doubles as the manual "resend/reprint" path.
 */

import { loadOrder } from "@/lib/fmdb/lab-orders";
import { loadMaintenanceOrder } from "@/lib/fmdb/maintenance-orders";
import { loadMaintenanceSubscription } from "@/lib/fmdb/maintenance-subscription";
import {
  getOrCreateLabOrderInvoice,
  getOrCreateMaintenanceOrderInvoice,
  getOrCreateMaintenanceChargeInvoice,
  type Invoice,
} from "@/lib/fmdb/invoices";

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

export async function getMaintenanceOrderInvoiceAction(clientId: string, orderId: string): Promise<Result> {
  if (onPublicBox()) return { ok: false, error: "unavailable" };
  if (!safeId(clientId) || !safeId(orderId)) return { ok: false, error: "bad id" };
  const order = await loadMaintenanceOrder(clientId, orderId);
  if (!order) return { ok: false, error: "order not found" };
  const invoice = await getOrCreateMaintenanceOrderInvoice(clientId, orderId);
  if (!invoice) return { ok: false, error: `order is ${order.status} — a receipt needs a real payment` };
  return { ok: true, invoice };
}

export async function getMaintenanceChargeInvoiceAction(
  clientId: string,
  subscriptionId: string,
  paymentId: string,
): Promise<Result> {
  if (onPublicBox()) return { ok: false, error: "unavailable" };
  if (!safeId(clientId) || !safeId(subscriptionId) || !safeId(paymentId)) return { ok: false, error: "bad id" };
  const sub = await loadMaintenanceSubscription(clientId, subscriptionId);
  if (!sub) return { ok: false, error: "subscription not found" };
  const invoice = await getOrCreateMaintenanceChargeInvoice(clientId, subscriptionId, paymentId);
  if (!invoice) return { ok: false, error: "no charge on file for that payment id" };
  return { ok: true, invoice };
}
