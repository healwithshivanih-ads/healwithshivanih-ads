/**
 * POST /api/handover/discovery-complete
 *
 * Fired by ochre-followup after a Discovery call completes (regardless of
 * whether the prospect goes on to pay). Creates / updates a client.yaml
 * in lifecycle_state=prospect — fm-coach holds the data but takes NO
 * outbound action (no intake form, no reminders, no Cal.com processing)
 * until the programme-signup endpoint flips lifecycle_state to
 * programme_active.
 *
 * See docs/HANDOVER_SPEC.md for the full contract.
 */
import { NextResponse } from "next/server";
import { verifyHandoverRequest } from "../_auth";
import { processDiscoveryComplete, type DiscoveryCompletePayload } from "@/lib/server-actions/handover";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await verifyHandoverRequest(req);
  if (!auth.ok || !auth.body) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const result = await processDiscoveryComplete(auth.body as DiscoveryCompletePayload);
  const status = result.ok ? 200 : (result.code === "phone_email_conflict" ? 409 : 400);
  return NextResponse.json(result, { status });
}
