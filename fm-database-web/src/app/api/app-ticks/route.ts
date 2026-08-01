/**
 * POST /api/app-ticks — the client's daily checklist, ticked off in her app.
 *
 * Supplements, remedies and practices were ticked into localStorage and never
 * left the phone, so the single richest adherence signal the app produces was
 * discarded every day. The coach could not tell whether a client was actually
 * taking what was prescribed.
 *
 * The app posts the WHOLE of today's checklist (debounced), not a delta, and
 * the shim upserts one row per local day — so an untick is recorded as
 * faithfully as a tick, and a day's row can never drift out of step with what
 * the client sees on her screen.
 *
 * Auth: body.token must resolve to a published plan's letter_token (the same
 * token that opened the app). The client is derived server-side — never
 * trusted from the request. Same shape as /api/app-practice.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAppToken } from "@/lib/server-actions/letter-token";
import { runShim } from "@/lib/fmdb/shim";
import { allowDaily } from "@/lib/fmdb/rate-limit";

export const dynamic = "force-dynamic";

const KINDS = new Set(["supplement", "remedy", "practice"]);
/** Debounced posts coalesce a day's ticking into a handful of writes; the cap
 *  is generous headroom, not a target. Past it the client simply keeps her
 *  local ticks — nothing in the app breaks. */
const DAILY_POST_LIMIT = 120;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!token || token.length < 16) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
  if (!(await allowDaily("app-ticks", token, DAILY_POST_LIMIT)).ok) {
    return NextResponse.json({ ok: false, error: "too many logs today" }, { status: 429 });
  }
  const lookup = await resolveAppToken(token);
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, error: "invalid or expired link" }, { status: 401 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .filter((i) => typeof i.kind === "string" && KINDS.has(i.kind))
    .filter((i) => typeof i.id === "string" && i.id.length > 0)
    .slice(0, 80)
    .map((i) => ({
      kind: i.kind as string,
      id: (i.id as string).slice(0, 120),
      name: typeof i.name === "string" ? i.name.slice(0, 160) : "",
      done: i.done === true,
      at: typeof i.at === "string" ? i.at.slice(0, 20) : null,
    }));
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "no items" }, { status: 400 });
  }

  try {
    const out = (await runShim("save-app-ticks.py", {
      client_id: lookup.client_id,
      date,
      plan_slug: typeof body.plan_slug === "string" ? body.plan_slug.slice(0, 160) : null,
      week: typeof body.week === "number" && Number.isFinite(body.week) ? Math.round(body.week) : null,
      items,
    })) as { ok?: boolean; error?: string };
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error ?? "log failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[app-ticks] log failed:", err);
    return NextResponse.json({ ok: false, error: "log failed" }, { status: 500 });
  }
}
