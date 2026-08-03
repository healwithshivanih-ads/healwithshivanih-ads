/**
 * POST /api/push-receipt — a device confirming it drew a notification.
 *
 * Called by the service worker as it shows the notification, on both apps.
 * This is the ONLY honest delivery signal we have: a push service returning
 * 201 means the message left our hands, not that a phone ever displayed it.
 * Hariharan's phone accepts every send with a 201 and shows none of them,
 * and until now there was no way to tell a push that never arrived from one
 * that arrived and was swallowed by a battery setting — which have entirely
 * different fixes.
 *
 * PUBLIC BY NECESSITY: a service worker carries no session and no app token.
 * The blast radius is bounded to match — the only thing a caller can do is
 * mark a message they already know the id of as delivered, which is a tick
 * in a UI. It cannot read anything, and it cannot un-deliver.
 */
import { NextRequest, NextResponse } from "next/server";
import { markDelivered } from "@/lib/fmdb/client-thread";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const SAFE_MSG = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const client = typeof body.client === "string" ? body.client : "";
  const id = typeof body.id === "string" ? body.id : "";
  if (!SAFE_ID.test(client) || !SAFE_MSG.test(id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // Logged either way: "the push reached the device" is the fact that has
  // been missing from every diagnosis this week.
  const marked = markDelivered(client, id);
  console.log(`[push-receipt] ${client}/${id} arrived on device (new=${marked})`);
  return NextResponse.json({ ok: true });
}
