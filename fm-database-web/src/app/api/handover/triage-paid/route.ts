/**
 * POST /api/handover/triage-paid — ochre-funnel reports a ₹999 short-call
 * payment, so the ₹999 credit toward the Foundation session lands on the
 * person's record without the coach having to remember it.
 *
 * Runs on the MAC (the authoritative fm-plans store), reached through the
 * public fmcoach host; /api/handover/ skips the Basic-auth wall
 * (middleware-policy.ts) and this route is the gate instead:
 *   - HMAC-SHA256 over the raw body, header `x-handover-signature: sha256=<hex>`,
 *     keyed by TRIAGE_NOTIFY_SECRET — its OWN secret, deliberately not
 *     HANDOVER_SECRET, so turning this on does not also enable the programme
 *     handover routes. Fails closed (503) while the secret is unset.
 *   - body.source must be "ochre-funnel".
 *
 * Idempotent on payment_id. Returns 200 for every TERMINAL outcome, including
 * a conflict (email and phone match different people) — retrying cannot fix
 * that, and the coach sees it in _triage_payments.yaml. Non-2xx only for a
 * transient failure, which the funnel's job queue retries.
 */
import { NextResponse } from "next/server";
import { verifySignedRequest } from "../_auth";
import { recordTriagePayment, type TriagePaymentNotice } from "@/lib/fmdb/triage-payment-intake";

export const dynamic = "force-dynamic";

const SOURCES = new Set(["ochre-funnel"]);

export async function POST(req: Request) {
  if (!process.env.TRIAGE_NOTIFY_SECRET) {
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  }
  const auth = await verifySignedRequest(req, process.env.TRIAGE_NOTIFY_SECRET, "TRIAGE_NOTIFY_SECRET", SOURCES);
  if (!auth.ok || !auth.body) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }
  const b = auth.body as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const notice: TriagePaymentNotice = {
    payment_id: str(b.payment_id, 60),
    paid_at: str(b.paid_at, 40) || new Date().toISOString(),
    amount_inr: Number(b.amount_inr) || 999,
    first_name: str(b.first_name, 120),
    last_name: str(b.last_name, 120) || null,
    email: str(b.email) || null,
    phone: str(b.phone, 20) || null,
  };
  try {
    const r = await recordTriagePayment(notice);
    return NextResponse.json(r, { status: r.ok || r.outcome !== "error" ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
