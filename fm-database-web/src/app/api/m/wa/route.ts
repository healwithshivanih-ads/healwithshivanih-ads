/**
 * POST /api/m/wa — send a free-text WhatsApp from the BUSINESS number.
 *
 * The business number (+91 89765 63971) runs on the Meta Cloud API, so it can
 * never be used in the WhatsApp Business phone app. "Send from my business
 * WhatsApp" therefore has to mean "send through our own server" — which this
 * does, and which also gets the message logged against the client.
 *
 * Free text only works inside the 24-hour service window. Outside it Meta
 * returns 131047 and sendWhatsAppTextAction turns that into a plain-English
 * error, which is surfaced on the card rather than swallowed.
 *
 * Behind the session gate (any /api/m/* that isn't login/logout).
 */
import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppTextAction } from "@/app/api/whatsapp/actions";
import { loadAuth } from "@/lib/fmdb/coach-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!loadAuth()) return new NextResponse("Not Found", { status: 404 });

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();

  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/m/clients/${encodeURIComponent(clientId)}?${qs}`, req.url), 303);

  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(clientId)) {
    return NextResponse.json({ ok: false, error: "bad client_id" }, { status: 400 });
  }
  if (!phone || !text) {
    return back(`error=${encodeURIComponent("Message can't be empty.")}`);
  }

  const res = await sendWhatsAppTextAction(phone, text);
  return res.ok ? back("sent=1") : back(`error=${encodeURIComponent(res.error ?? "Send failed.")}`);
}
