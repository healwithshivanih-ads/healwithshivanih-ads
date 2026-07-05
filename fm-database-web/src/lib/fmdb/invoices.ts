/**
 * Payment receipts ("invoices") for client-facing payments.
 *
 * The practice is NOT GST-registered, so these are plain payment receipts —
 * biller name/contact, invoice number, line items, amount, payment reference.
 * No GSTIN, no tax breakup, no "Tax Invoice" label (that would misrepresent
 * GST compliance we don't have).
 *
 * One invoice number is minted per real payment, across BOTH payment sources
 * (lab orders + maintenance). A single global sequence (not per-client, not
 * per-source) matches ordinary small-business invoice-numbering convention —
 * gaps/resets per client would look wrong to an accountant. There is no DB in
 * this app, so the sequence lives in a single counter file
 * (`~/fm-plans/_invoice_counter.yaml`), mutated under an exclusive lock file
 * (the `wx`-flag-retry pattern already used elsewhere in this codebase for
 * order-id allocation, applied here to guard a read-modify-write instead of a
 * create-if-absent).
 *
 * Idempotent by design: generating "again" for an already-invoiced payment
 * never mints a second number — it just re-returns the existing one. This is
 * what makes it safe to call from BOTH the webhook (auto-generate on payment)
 * and a coach "resend" button (manual) without ever double-invoicing.
 *
 * Storage: the invoice number + issued-at timestamp are stamped directly onto
 * the existing order/maintenance YAML record (not a separate `invoices/`
 * directory) — that record already rides the Mac↔Fly staging sync
 * (app-staging-action.py §5c/§5d does a verbatim file copy), so a new field
 * on an existing file needs zero new staging plumbing. The tradeoff: there's
 * no single "list every invoice" view — invoices are always reached via their
 * source payment. Acceptable for a practice this size; revisit if a
 * dedicated billing-history surface is ever wanted.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { loadOrder, patchOrder, type LabOrder } from "./lab-orders";
import { loadMaintenanceOrder, patchMaintenanceOrder, type MaintenanceOrder } from "./maintenance-orders";
import {
  loadMaintenanceSubscription,
  patchMaintenanceSubscription,
  type MaintenanceChargeRecord,
} from "./maintenance-subscription";

/** Biller identity printed on every receipt. Env-overridable (mirrors the
 *  COACH_NAME pattern used elsewhere); defaults are the coach-confirmed values
 *  (2026-07-05) for the current practice. */
export const BUSINESS_IDENTITY = {
  name: process.env.INVOICE_BUSINESS_NAME || "Ochre Life",
  phone: process.env.INVOICE_BUSINESS_PHONE || "+91 89765 63971",
  email: process.env.INVOICE_BUSINESS_EMAIL || "admin@theochretree.com",
  address:
    process.env.INVOICE_BUSINESS_ADDRESS ||
    "1821 One Lodha Place, Lower Parel West, Mumbai 400013",
};

export interface InvoiceLine {
  label: string;
  inr: number;
}

export type InvoiceSourceType = "lab_order" | "maintenance_order" | "maintenance_subscription";

export interface InvoiceBiller {
  name: string;
  phone: string;
  email: string;
  address: string;
}

export interface Invoice {
  invoice_number: string;
  issued_at: string; // ISO
  client_id: string;
  client_name: string;
  source_type: InvoiceSourceType;
  /** order_id, maintenance order_id, or the specific charge's razorpay_payment_id
   *  (a subscription record is mutated in place across cycles, so the payment id
   *  — not the subscription id — is what uniquely identifies ONE billable event). */
  source_id: string;
  lines: InvoiceLine[];
  amount_inr: number;
  razorpay_payment_id: string | null;
  paid_at: string | null;
  note?: string | null;
  /** Snapshot of the biller identity AT ISSUE TIME — frozen onto the invoice
   *  itself rather than looked up live, so a later change to business details
   *  never retroactively rewrites a historical receipt. Also keeps this the
   *  ONLY value a "use client" receipt component needs from this (fs-touching,
   *  server-only) module — it imports `type Invoice` and nothing else, so
   *  Turbopack never has to bundle node:fs for the browser. */
  biller: InvoiceBiller;
}

// ── invoice numbering ─────────────────────────────────────────────────────

async function counterPaths(): Promise<{ counter: string; lock: string }> {
  const { getPlansRoot } = await import("@/lib/fmdb/paths");
  const counter = path.join(getPlansRoot(), "_invoice_counter.yaml");
  return { counter, lock: `${counter}.lock` };
}

/**
 * Mint the next sequential invoice number ("INV-000001", ...). Exclusive-lock
 * protected (create-lockfile-or-retry) so two near-simultaneous payments
 * across different clients never collide or skip a number.
 */
export async function nextInvoiceNumber(): Promise<string> {
  const { counter, lock } = await counterPaths();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const fh = await fs.open(lock, "wx");
      await fh.close();
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "EEXIST") {
        await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 80)));
        continue;
      }
      throw e;
    }
    try {
      let last = 0;
      try {
        const raw = yaml.load(await fs.readFile(counter, "utf8")) as { last_number?: unknown } | null;
        if (typeof raw?.last_number === "number" && Number.isFinite(raw.last_number)) last = raw.last_number;
      } catch {
        /* no counter file yet — first invoice ever */
      }
      const next = last + 1;
      await fs.writeFile(counter, yaml.dump({ last_number: next }, { sortKeys: false }), "utf8");
      return `INV-${String(next).padStart(6, "0")}`;
    } finally {
      await fs.unlink(lock).catch(() => {});
    }
  }
  throw new Error("could not allocate an invoice number — lock contention, try again");
}

async function clientDisplayName(clientId: string): Promise<string> {
  try {
    const { getPlansRoot } = await import("@/lib/fmdb/paths");
    const raw = await fs.readFile(path.join(getPlansRoot(), "clients", clientId, "client.yaml"), "utf8");
    const c = yaml.load(raw) as Record<string, unknown> | null;
    const name = typeof c?.display_name === "string" ? c.display_name.trim() : "";
    return name || clientId;
  } catch {
    return clientId;
  }
}

function labOrderInvoiceLines(order: LabOrder): InvoiceLine[] {
  return order.lines.length > 0 ? order.lines.map((l) => ({ label: l.label, inr: l.inr })) : [
    { label: order.includes?.join(", ") || "Lab tests", inr: order.amount_inr },
  ];
}

// ── lab orders ────────────────────────────────────────────────────────────

/**
 * Generate (or re-fetch) the receipt for a lab order. Refuses orders that
 * haven't actually been paid (recommended / cancelled) — an invoice must
 * correspond to a real payment. Idempotent: returns the existing invoice
 * number on a second call rather than minting a new one.
 */
export async function getOrCreateLabOrderInvoice(clientId: string, orderId: string): Promise<Invoice | null> {
  const order = await loadOrder(clientId, orderId);
  if (!order) return null;
  if (order.status === "recommended" || order.status === "cancelled") return null;

  let invoiceNumber = order.invoice_number ?? null;
  let issuedAt = order.invoice_generated_at ?? null;
  if (!invoiceNumber) {
    invoiceNumber = await nextInvoiceNumber();
    issuedAt = new Date().toISOString();
    await patchOrder(clientId, orderId, {
      invoice_number: invoiceNumber,
      invoice_generated_at: issuedAt,
    } as Partial<LabOrder>);
  }

  return {
    invoice_number: invoiceNumber,
    issued_at: issuedAt ?? new Date().toISOString(),
    client_id: clientId,
    client_name: await clientDisplayName(clientId),
    source_type: "lab_order",
    source_id: orderId,
    lines: labOrderInvoiceLines(order),
    amount_inr: order.amount_inr,
    razorpay_payment_id: order.razorpay_payment_id,
    paid_at: order.paid_at,
    note: order.coach_note,
    biller: BUSINESS_IDENTITY,
  };
}

// ── maintenance: one-time order ──────────────────────────────────────────

export async function getOrCreateMaintenanceOrderInvoice(
  clientId: string,
  orderId: string,
): Promise<Invoice | null> {
  const order = await loadMaintenanceOrder(clientId, orderId);
  if (!order || order.status !== "paid") return null;

  let invoiceNumber = order.invoice_number ?? null;
  let issuedAt = order.invoice_generated_at ?? null;
  if (!invoiceNumber) {
    invoiceNumber = await nextInvoiceNumber();
    issuedAt = new Date().toISOString();
    await patchMaintenanceOrder(clientId, orderId, {
      invoice_number: invoiceNumber,
      invoice_generated_at: issuedAt,
    } as Partial<MaintenanceOrder>);
  }

  return {
    invoice_number: invoiceNumber,
    issued_at: issuedAt ?? new Date().toISOString(),
    client_id: clientId,
    client_name: await clientDisplayName(clientId),
    source_type: "maintenance_order",
    source_id: orderId,
    lines: [{ label: `Maintenance — ${order.term_months} month block`, inr: order.amount_inr }],
    amount_inr: order.amount_inr,
    razorpay_payment_id: order.razorpay_payment_id ?? null,
    paid_at: order.paid_at ?? null,
    note: null,
    biller: BUSINESS_IDENTITY,
  };
}

// ── maintenance: quarterly subscription charge ───────────────────────────

/**
 * A subscription record is mutated in place every cycle (see
 * maintenance-subscription.ts), so it can't carry a single invoice_number the
 * way an order can — each charge needs its OWN number. The webhook is
 * responsible for appending a `charge_history` entry (payment_id, amount,
 * charged_at, paid_through) BEFORE calling this; this function then finds
 * that entry by payment id and stamps an invoice number onto it in place
 * (idempotent — a second call for the same payment id returns the same
 * number instead of minting a new one).
 */
export async function getOrCreateMaintenanceChargeInvoice(
  clientId: string,
  subscriptionId: string,
  paymentId: string,
): Promise<Invoice | null> {
  const sub = await loadMaintenanceSubscription(clientId, subscriptionId);
  if (!sub) return null;
  const history = sub.charge_history ?? [];
  const idx = history.findIndex((c) => c.payment_id === paymentId);
  if (idx === -1) return null; // webhook must append the charge record first

  let record = history[idx];
  if (!record.invoice_number) {
    const invoiceNumber = await nextInvoiceNumber();
    const issuedAt = new Date().toISOString();
    const nextHistory = [...history];
    record = { ...record, invoice_number: invoiceNumber, invoice_generated_at: issuedAt };
    nextHistory[idx] = record;
    await patchMaintenanceSubscription(clientId, subscriptionId, { charge_history: nextHistory });
  }

  return {
    invoice_number: record.invoice_number!,
    issued_at: record.invoice_generated_at ?? new Date().toISOString(),
    client_id: clientId,
    client_name: await clientDisplayName(clientId),
    source_type: "maintenance_subscription",
    source_id: paymentId,
    lines: [{ label: "Maintenance — quarterly", inr: record.amount_inr }],
    amount_inr: record.amount_inr,
    razorpay_payment_id: record.payment_id,
    paid_at: record.charged_at,
    note: null,
    biller: BUSINESS_IDENTITY,
  };
}

export type { MaintenanceChargeRecord };
