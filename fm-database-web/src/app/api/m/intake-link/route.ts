/**
 * POST /api/m/intake-link — issue (and send) a client's intake link from the phone.
 *
 * THREE OUTCOMES, in order — same shape as /api/m/ask:
 *   1. The authoritative store is on THIS host (the Mac) → issue locally.
 *   2. It isn't (we're on Fly) but COACH_MAC_URL + COACH_BRIDGE_SECRET are set
 *      → bridge to the Mac, which owns the write.
 *   3. Neither → say why. Issuing a token writes client.yaml, and that file
 *      deliberately does not live on the public box.
 *
 * WHY: on 2026-08-15 a client's intake link was dead, the coach was away from
 * her Mac, and nothing on the phone could re-issue one — `/m` could read a
 * client but not write one, and the desktop tunnel was down. Someone had to be
 * physically at the machine. This closes that.
 *
 * Behind the session gate (any /api/m/* that isn't login/logout).
 */
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadAuth } from "@/lib/fmdb/coach-auth";
import { relativeRedirect } from "@/lib/fmdb/http-redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/** True when the FULL record is on this host — i.e. we're on the Mac. Staging
 *  on Fly has client.yaml too, so key off a sessions dir, which staging only
 *  ever partially mirrors. Same test as /api/m/ask. */
function hasAuthoritativeRecord(clientId: string): boolean {
  const root = getPlansRoot();
  for (const bucket of ["clients", "prospects"]) {
    const dir = path.join(root, bucket, clientId);
    if (
      fs.existsSync(path.join(dir, "client.yaml")) &&
      fs.existsSync(path.join(dir, "sessions"))
    ) {
      return true;
    }
  }
  return false;
}

interface Outcome {
  ok: boolean;
  url?: string;
  sent?: boolean;
  error?: string;
}

/** Redirect back to the page the form came from, carrying a short status. The
 *  URL itself is never put in the query string — it is a live credential, and
 *  query strings end up in logs and history. The coach reads it off the client
 *  card, which renders the current token. */
function back(req: NextRequest, form: FormData, outcome: Outcome): NextResponse {
  const next = form.get("next");
  if (typeof next === "string" && next.startsWith("/m/") && !next.startsWith("//")) {
    const status = outcome.ok
      ? outcome.sent
        ? "intake=sent"
        : "intake=issued"
      : `intake=failed&why=${encodeURIComponent((outcome.error ?? "").slice(0, 120))}`;
    return relativeRedirect(`${next}?${status}`, 303);
  }
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}

export async function POST(req: NextRequest) {
  if (!loadAuth()) return new NextResponse("Not Found", { status: 404 });

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "").trim();
  if (!SAFE_ID.test(clientId)) {
    return back(req, form, { ok: false, error: "bad client id" });
  }

  // 1 — issue locally (we're on the Mac)
  if (hasAuthoritativeRecord(clientId)) {
    try {
      const { generateIntakeToken, sendIntakeInviteViaApi } = await import(
        "@/lib/server-actions/intake"
      );
      const gen = await generateIntakeToken(clientId);
      if (!gen.ok) return back(req, form, { ok: false, error: gen.error });
      let sent = false;
      try {
        sent = (await sendIntakeInviteViaApi(clientId)).ok;
      } catch {
        sent = false;
      }
      return back(req, form, { ok: true, sent });
    } catch (e) {
      return back(req, form, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2 — bridge to the Mac
  const macUrl = (process.env.COACH_MAC_URL ?? "").replace(/\/$/, "");
  const secret = process.env.COACH_BRIDGE_SECRET ?? "";
  if (macUrl && secret) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(`${macUrl}/api/m-bridge/intake-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-coach-bridge": secret },
        body: JSON.stringify({ client_id: clientId }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return back(req, form, {
          ok: false,
          error:
            res.status === 502 || res.status === 504
              ? "your Mac isn't reachable"
              : `the Mac replied ${res.status}`,
        });
      }
      const data = (await res.json()) as { ok: boolean; sent?: boolean; error?: string };
      return back(req, form, { ok: data.ok, sent: data.sent, error: data.error });
    } catch {
      return back(req, form, { ok: false, error: "couldn't reach your Mac" });
    } finally {
      clearTimeout(timer);
    }
  }

  // 3 — no route to the authoritative store
  return back(req, form, {
    ok: false,
    error: "no link to your Mac — issuing a form writes the record that lives there",
  });
}
