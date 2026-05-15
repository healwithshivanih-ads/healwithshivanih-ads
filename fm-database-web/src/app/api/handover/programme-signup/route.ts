/**
 * POST /api/handover/programme-signup
 *
 * Fired by ochre-followup after Razorpay programme-payment success.
 * Flips lifecycle_state prospect → programme_active and fires the
 * onboarding kit:
 *   - generate intake token + send fm_programme_welcome WhatsApp
 *     (combines intake URL + Cal.com Programme Intake Session URL)
 *   - append a handover audit quick_note session
 *
 * Requires that /api/handover/discovery-complete was called first for the
 * same client — returns 409 if no prospect record found. Idempotent on
 * razorpay_payment_id: same payment ID = 200 OK with already_handed_over.
 *
 * See docs/HANDOVER_SPEC.md.
 */
import { NextResponse } from "next/server";
import { verifyHandoverRequest } from "../_auth";
import { processProgrammeSignup, type ProgrammeSignupPayload } from "@/lib/server-actions/handover";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await verifyHandoverRequest(req);
  if (!auth.ok || !auth.body) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const result = await processProgrammeSignup(auth.body as ProgrammeSignupPayload);
  const status = result.ok
    ? 200
    : result.code === "phone_email_conflict"
      ? 409
      : result.code === "no_prospect_found"
        ? 409
        : 400;
  return NextResponse.json(result, { status });
}
