/**
 * POST /api/m/ask — the per-client AI chat, from the phone.
 *
 * THREE OUTCOMES, in order:
 *   1. The authoritative store is on THIS host (the Mac) → answer locally by
 *      calling the same action the desktop coach UI uses.
 *   2. It isn't (we're on Fly) but COACH_MAC_URL + COACH_BRIDGE_SECRET are set
 *      → bridge the question to the Mac.
 *   3. Neither → return a REASON. The AI answer needs the full client record,
 *      and Tier A+B deliberately does not put that on the public box. Saying so
 *      is better than a generic failure that invites a retry.
 *
 * Behind the session gate (any /api/m/* that isn't login/logout).
 */
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadAuth } from "@/lib/fmdb/coach-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/** True when the FULL record for this person is on this host — i.e. we're on
 *  the Mac. The staging tree on Fly has client.yaml too, so check for a
 *  sessions dir, which staging only ever partially mirrors. */
function hasAuthoritativeRecord(clientId: string): boolean {
  const root = getPlansRoot();
  for (const bucket of ["clients", "prospects"]) {
    const dir = path.join(root, bucket, clientId);
    if (fs.existsSync(path.join(dir, "client.yaml")) && fs.existsSync(path.join(dir, "sessions"))) {
      return true;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  if (!loadAuth()) return new NextResponse("Not Found", { status: 404 });

  let body: { client_id?: string; question?: string; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const clientId = String(body.client_id ?? "");
  const question = String(body.question ?? "").trim();
  const history = Array.isArray(body.history) ? body.history : [];

  if (!SAFE_ID.test(clientId) || !question) {
    return NextResponse.json({ ok: false, error: "A question is required." }, { status: 400 });
  }

  // 1 — answer locally
  if (hasAuthoritativeRecord(clientId)) {
    const { clientQuickChatAction } = await import("@/lib/server-actions/client-quick-chat");
    const res = await clientQuickChatAction(clientId, question, history as never);
    return NextResponse.json(res);
  }

  // 2 — bridge to the Mac
  const macUrl = (process.env.COACH_MAC_URL ?? "").replace(/\/$/, "");
  const secret = process.env.COACH_BRIDGE_SECRET ?? "";
  if (macUrl && secret) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const res = await fetch(`${macUrl}/api/m-bridge/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-coach-bridge": secret },
        body: JSON.stringify({ client_id: clientId, question, history }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return NextResponse.json({
          ok: false,
          error:
            res.status === 502 || res.status === 504
              ? "Your Mac isn't reachable right now — the answer needs the full record that lives there."
              : `The Mac replied ${res.status}.`,
        });
      }
      return NextResponse.json(await res.json());
    } catch {
      return NextResponse.json({
        ok: false,
        error:
          "Couldn't reach your Mac. AI answers need the full client record, which stays on your machine — everything else on this page still works.",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // 3 — say why, plainly
  return NextResponse.json({
    ok: false,
    error:
      "AI answers need the full client record, which is deliberately kept on your Mac and not on this server. Open the client on your Mac, or set COACH_MAC_URL to bridge.",
  });
}
