import "server-only";

/**
 * A ₹999 short-call payment, reported by ochre-funnel, landing on the right
 * person's record.
 *
 * The ₹999 is sold and paid in ochre-funnel (its own Razorpay link + Postgres
 * `triage_paid` event). Until 2026-09-25 nothing told fm-coach, so the ₹999
 * credit toward the Foundation session depended on the coach remembering to
 * record it — and a forgotten one means the client is charged the full ₹12,000.
 *
 * What this does, for one payment:
 *   1. Idempotency — every notice is logged in `_triage_payments.yaml` by
 *      Razorpay payment id; a redelivery is a no-op.
 *   2. Find the person by email OR phone, in `clients/` AND `prospects/`. If
 *      the email and the phone point at DIFFERENT people it stops and records a
 *      conflict for the coach: guessing would put someone's credit on a
 *      stranger's record.
 *   3. Nobody found → create them as a prospect, exactly as a booking would
 *      (createProspectRecord), so their later 15-minute booking matches them.
 *   4. A parked prospect who just paid is back in conversation → moved back to
 *      `clients/` (the same move `fmdb prospects-restore` makes).
 *   5. Stamp `triage_paid_at` + `triage_payment_id` on client.yaml — the
 *      credit foundationPriceFor() reads — add a quick note, and re-stage so
 *      the Fly checkout charges ₹11,001.
 *
 * It never sets `triage_call_date`: paying is not having had the call. The
 * follow-up emails wait for the call itself (see discovery-followup.ts).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "./paths";
import { dumpYaml } from "./yaml-dump";

export interface TriagePaymentNotice {
  payment_id: string;
  /** ISO timestamp the payment cleared. */
  paid_at: string;
  amount_inr: number;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export type TriageIntakeOutcome =
  | { ok: true; outcome: "recorded" | "created" | "restored" | "already_recorded"; clientId: string }
  | { ok: false; outcome: "conflict" | "insufficient_contact" | "error"; error: string };

const LEDGER = "_triage_payments.yaml";

interface LedgerRow {
  payment_id: string;
  received_at: string;
  paid_at: string;
  amount_inr: number;
  name: string;
  email: string | null;
  phone_last4: string | null;
  outcome: string;
  client_id?: string;
  detail?: string;
  /** conflict rows: everyone the email or phone matched, for the dashboard. */
  candidates?: Array<{ client_id: string; name: string; matched_by: "email" | "phone" }>;
}

function last10(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D+/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

async function readLedger(): Promise<LedgerRow[]> {
  try {
    const d = yaml.load(await fs.readFile(path.join(getPlansRoot(), LEDGER), "utf8"));
    return Array.isArray(d) ? (d as LedgerRow[]) : [];
  } catch {
    return [];
  }
}

async function appendLedger(row: LedgerRow): Promise<void> {
  const rows = await readLedger();
  rows.push(row);
  const f = path.join(getPlansRoot(), LEDGER);
  const tmp = `${f}.tmp`;
  await fs.writeFile(tmp, dumpYaml(rows, { sortKeys: false }), "utf8");
  await fs.rename(tmp, f);
}

interface Found {
  clientId: string;
  bucket: "clients" | "prospects";
  name: string;
}

/** Every person in both buckets whose email or phone matches. */
async function findPeople(email: string, phone10: string): Promise<{ byEmail: Found[]; byPhone: Found[] }> {
  const byEmail: Found[] = [];
  const byPhone: Found[] = [];
  for (const bucket of ["clients", "prospects"] as const) {
    let ids: string[] = [];
    try {
      ids = await fs.readdir(path.join(getPlansRoot(), bucket));
    } catch {
      continue;
    }
    for (const id of ids) {
      let doc: Record<string, unknown>;
      try {
        doc = (yaml.load(
          await fs.readFile(path.join(getPlansRoot(), bucket, id, "client.yaml"), "utf8"),
        ) ?? {}) as Record<string, unknown>;
      } catch {
        continue;
      }
      const name = String(doc.display_name ?? id);
      if (email && String(doc.email ?? "").trim().toLowerCase() === email) byEmail.push({ clientId: id, bucket, name });
      if (phone10 && last10(String(doc.mobile_number ?? doc.mobile ?? "")) === phone10) {
        byPhone.push({ clientId: id, bucket, name });
      }
    }
  }
  return { byEmail, byPhone };
}

export async function recordTriagePayment(n: TriagePaymentNotice): Promise<TriageIntakeOutcome> {
  const paymentId = String(n.payment_id ?? "").trim();
  if (!/^[A-Za-z0-9_]{6,60}$/.test(paymentId)) {
    return { ok: false, outcome: "error", error: "payment_id missing or malformed" };
  }
  const ledger = await readLedger();
  const prior = ledger.find((r) => r.payment_id === paymentId && r.client_id);
  if (prior?.client_id) return { ok: true, outcome: "already_recorded", clientId: prior.client_id };

  const email = String(n.email ?? "").trim().toLowerCase();
  const phone10 = last10(n.phone);
  const name = [n.first_name, n.last_name].filter(Boolean).join(" ").trim();
  const base: LedgerRow = {
    payment_id: paymentId,
    received_at: new Date().toISOString(),
    paid_at: n.paid_at,
    amount_inr: n.amount_inr,
    name,
    email: email || null,
    phone_last4: phone10 ? phone10.slice(-4) : null,
    outcome: "",
  };

  if (!name || (!email && !phone10)) {
    await appendLedger({ ...base, outcome: "insufficient_contact" });
    return { ok: false, outcome: "insufficient_contact", error: "need a name and an email or phone" };
  }

  const { byEmail, byPhone } = await findPeople(email, phone10);
  const ids = new Set([...byEmail, ...byPhone].map((f) => f.clientId));
  if (ids.size > 1) {
    const detail = `email → ${byEmail.map((f) => f.clientId).join(",") || "none"}; phone → ${
      byPhone.map((f) => f.clientId).join(",") || "none"
    }`;
    await appendLedger({
      ...base,
      outcome: "conflict",
      detail,
      candidates: [
        ...byEmail.map((f) => ({ client_id: f.clientId, name: f.name, matched_by: "email" as const })),
        ...byPhone.map((f) => ({ client_id: f.clientId, name: f.name, matched_by: "phone" as const })),
      ],
    });
    return {
      ok: false,
      outcome: "conflict",
      error: `email and phone match different people (${detail}) — record the ₹999 by hand on the right one`,
    };
  }

  let outcome: "recorded" | "created" | "restored";
  let clientId: string;
  const hit = byEmail[0] ?? byPhone[0];
  if (!hit) {
    const { createProspectRecord } = await import("./booking-lead-intake");
    clientId = await createProspectRecord({
      name,
      email: email || null,
      phone: n.phone ?? null,
      leadSource: "funnel_triage_payment",
      origin: "₹999 short-call payment",
    });
    outcome = "created";
  } else {
    clientId = hit.clientId;
    outcome = "recorded";
    if (hit.bucket === "prospects") {
      await fs.mkdir(path.join(getPlansRoot(), "clients"), { recursive: true });
      await fs.rename(
        path.join(getPlansRoot(), "prospects", clientId),
        path.join(getPlansRoot(), "clients", clientId),
      );
      outcome = "restored";
    }
  }

  await stampCredit(clientId, paymentId, n.paid_at, n.amount_inr);
  await appendLedger({ ...base, outcome, client_id: clientId });
  return { ok: true, outcome, clientId };
}

/** Put the ₹999 credit on a person already in clients/: fields, note, re-stage. */
async function stampCredit(clientId: string, paymentId: string, paidAt: string, amountInr: number): Promise<void> {
  const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  const doc = (yaml.load(await fs.readFile(file, "utf8")) ?? {}) as Record<string, unknown>;
  if (!doc.triage_paid_at) doc.triage_paid_at = paidAt;
  if (!doc.triage_payment_id) doc.triage_payment_id = paymentId;
  await fs.writeFile(file, dumpYaml(doc, { sortKeys: false }), "utf8");

  try {
    const { saveSessionAction } = await import("@/lib/server-actions/assess");
    await saveSessionAction({
      client_id: clientId,
      session_type: "quick_note",
      session_date: (paidAt || new Date().toISOString()).slice(0, 10),
      presenting_complaints: "[source: funnel_triage_payment]",
      coach_notes:
        `Paid ₹${amountInr} for the short call (Razorpay ${paymentId}). ` +
        `The ₹999 comes off their Foundation session — it now costs them ₹11,001.`,
    });
  } catch {
    /* the credit is on client.yaml either way; the note is a courtesy */
  }

  try {
    const { stageDiscoveryClientArtifacts } = await import("@/lib/server-actions/letter-token");
    await stageDiscoveryClientArtifacts(clientId);
  } catch {
    /* best-effort; the cron refresh re-stages */
  }
}

// ── the coach's side of a payment that could not be placed ──────────────────

export interface UnplacedTriagePayment {
  paymentId: string;
  paidAt: string;
  amountInr: number;
  name: string;
  email: string | null;
  phoneLast4: string | null;
  outcome: "conflict" | "insufficient_contact";
  candidates: Array<{ clientId: string; name: string; matchedBy: "email" | "phone" }>;
}

/**
 * ₹999 payments the pipe could not put on anyone — a conflict (email and phone
 * name different people) or too little contact detail — and which the coach
 * has not yet resolved or dismissed. Latest row per payment wins.
 */
export async function listUnplacedTriagePayments(): Promise<UnplacedTriagePayment[]> {
  const latest = new Map<string, LedgerRow>();
  for (const r of await readLedger()) latest.set(r.payment_id, r);
  const out: UnplacedTriagePayment[] = [];
  for (const r of latest.values()) {
    if (r.outcome !== "conflict" && r.outcome !== "insufficient_contact") continue;
    out.push({
      paymentId: r.payment_id,
      paidAt: r.paid_at,
      amountInr: r.amount_inr,
      name: r.name,
      email: r.email,
      phoneLast4: r.phone_last4,
      outcome: r.outcome,
      candidates: (r.candidates ?? []).map((c) => ({ clientId: c.client_id, name: c.name, matchedBy: c.matched_by })),
    });
  }
  return out.sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

/**
 * The coach says which person an unplaced ₹999 payment belongs to. Any client
 * id is accepted (not only the candidates): with "insufficient contact" there
 * are no candidates, and she may know who it was from the payment itself.
 */
export async function resolveTriagePayment(
  paymentId: string,
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[A-Za-z0-9_-]+$/.test(clientId)) return { ok: false, error: "bad client id" };
  const row = (await listUnplacedTriagePayments()).find((p) => p.paymentId === paymentId);
  if (!row) return { ok: false, error: "that payment is not waiting on you (already placed or dismissed)" };
  const ledgerRow = (await readLedger()).filter((r) => r.payment_id === paymentId).pop()!;
  try {
    await fs.access(path.join(getPlansRoot(), "clients", clientId, "client.yaml"));
  } catch {
    try {
      await fs.access(path.join(getPlansRoot(), "prospects", clientId, "client.yaml"));
      await fs.rename(
        path.join(getPlansRoot(), "prospects", clientId),
        path.join(getPlansRoot(), "clients", clientId),
      );
    } catch {
      return { ok: false, error: `no client ${clientId}` };
    }
  }
  await stampCredit(clientId, paymentId, row.paidAt, row.amountInr);
  const { candidates: _c, ...rest } = ledgerRow;
  await appendLedger({
    ...rest,
    received_at: new Date().toISOString(),
    outcome: "resolved_by_coach",
    client_id: clientId,
  });
  return { ok: true };
}

/** The coach says this payment needs no credit placed (refunded, test, …). */
export async function dismissTriagePayment(paymentId: string): Promise<{ ok: boolean; error?: string }> {
  const ledgerRow = (await readLedger()).filter((r) => r.payment_id === paymentId).pop();
  if (!ledgerRow) return { ok: false, error: "unknown payment" };
  const { candidates: _c, ...rest } = ledgerRow;
  await appendLedger({
    ...rest,
    received_at: new Date().toISOString(),
    outcome: "dismissed_by_coach",
  });
  return { ok: true };
}
