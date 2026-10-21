/**
 * POST /api/cron/monthly-cards — write each maintenance client's monthly
 * do's & don'ts card, and only ask the coach when something stands out.
 *
 * Fired daily by scripts/cron-runner.js. For every client on a published
 * maintenance plan (not lapsed), it writes the card for this month if it is
 * missing and, from the 25th, next month's too — so it is on the app on the
 * 1st. The card is deterministic (generate-monthly-card.py, no API).
 *
 * `review: true` makes the script check the card against the client
 * (review_flags: lives outside India, a "do" names a food on their avoid /
 * allergy / trigger list or one their diet rules out, a food caution for their
 * condition, pregnancy, a repeat of last month). A clean card goes LIVE; a
 * flagged one is held as `pending_review`, which the app never shows, and
 * appears on the dashboard and in the morning digest until she approves or
 * skips it.
 *
 * Idempotent: `only_if_missing` — a card in any state is never rewritten.
 * Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { runShim } from "@/lib/fmdb/shim";
import { maintenanceCardClients } from "@/lib/fmdb/monthly-cards-store";
import { monthsOwed } from "@/lib/fmdb/monthly-cards";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
  const clients = await maintenanceCardClients();

  const live: string[] = [];
  const held: { client: string; month: string; flags: string[] }[] = [];
  const failed: { client: string; month: string; error: string }[] = [];

  for (const c of clients) {
    for (const month of monthsOwed(today, c.cards, c.paidThrough, c.planStart)) {
      try {
        const out = (await runShim(
          "generate-monthly-card.py",
          { client_id: c.clientId, plan_slug: c.planSlug, month, review: true, only_if_missing: true },
          60_000,
        )) as { ok: boolean; status?: string; flags?: string[]; error?: string | null };
        if (!out?.ok) failed.push({ client: c.clientName, month, error: out?.error || "failed" });
        else if (out.status === "pending_review") held.push({ client: c.clientName, month, flags: out.flags ?? [] });
        else live.push(`${c.clientName} ${month}`);
      } catch (e) {
        failed.push({ client: c.clientName, month, error: e instanceof Error ? e.message : "shim failed" });
      }
    }
  }

  return NextResponse.json({ ok: true, scanned: clients.length, live, held, failed });
}
