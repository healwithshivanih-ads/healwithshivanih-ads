/**
 * POST /api/intake  — stable HTTP endpoint for intake form save_draft + submit.
 *
 * Why this exists instead of Server Actions:
 *   Next.js Server Actions are identified by a hash that regenerates on every
 *   `next build`. Any browser tab that was open before a server restart hits
 *   "Failed to find Server Action" on submit — the error surfaces to the client
 *   as "Couldn't reach the server" and their filled data is stranded in the
 *   browser. This broke Shruti and Niti's submissions on 2026-06-01.
 *
 *   API route URLs (/api/intake) are stable across builds. A client who filled
 *   the form yesterday and submits today will always reach this handler.
 *
 * Actions (via JSON body { action, token, ... }):
 *   save_draft  — autosave the current form state; called ~every 30s
 *   submit      — final submission; validates token + persists to client.yaml
 *
 * Security: the token is a long random string (32 hex bytes) that is the only
 * auth. No session or cookie needed — the token IS the credential. The
 * Python script validates it server-side (expiry + used-only-once for submit).
 *
 * No CRON_SECRET or other header auth — this is a public endpoint, intentionally,
 * so clients can reach it from any network without extra config.
 */
import { NextRequest, NextResponse } from "next/server";
import { saveIntakeDraft, submitIntakeForm } from "@/lib/server-actions/intake";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { action, token, ...rest } = body;

  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, error: "token_required" }, { status: 400 });
  }

  if (action === "save_draft") {
    const draft = rest.draft as Record<string, unknown> | undefined;
    if (!draft || typeof draft !== "object") {
      return NextResponse.json({ ok: false, error: "draft_required" }, { status: 400 });
    }
    const result = await saveIntakeDraft(token, draft);
    return NextResponse.json(result);
  }

  if (action === "submit") {
    const payload = rest.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ ok: false, error: "payload_required" }, { status: 400 });
    }
    const result = await submitIntakeForm(token, payload);
    return NextResponse.json(result);
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
