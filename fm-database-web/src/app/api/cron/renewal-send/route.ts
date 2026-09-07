/**
 * POST /api/cron/renewal-send — mail the renewal letters that come due today.
 *
 * The other half of the "Plans ending" flow. A letter is authored in chat,
 * staged as `drafted`, and approved by the coach on the dashboard — approval
 * sets a send date (the plan-end day) but sends nothing. This cron is what
 * "goes out on the day" actually means: each morning it finds every APPROVED
 * letter whose scheduled_for has arrived, mails it from the coach's own
 * address (the same path SendPackageButton uses), marks it `sent`, and records
 * the `offer_sent` decision so the plan drops out of the renewal queue and the
 * win-back drip leaves it alone until the coach records renewed/not_renewing.
 *
 * Idempotent: a sent letter is no longer `approved`, so a repeat run mails
 * nothing. A send failure leaves the letter `approved` to retry tomorrow.
 *
 * Auth: x-cron-secret must match CRON_SECRET. Fired daily by cron-runner.js.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  loadAllRenewalLetters,
  renewalLettersDue,
  markRenewalLetterSent,
} from "@/lib/fmdb/renewal-letters";
import { setDecision } from "@/lib/fmdb/renewal-queue";
import { sendClientEmailAction } from "@/app/api/email/actions";

export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Same warm serif rendering the manual renewal send uses. */
function bodyToHtml(body: string): string {
  const paras = body
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#2b2b2b;max-width:620px">` +
    paras.map((p) => `<p style="margin:0 0 1em 0">${esc(p).replace(/\n/g, "<br>")}</p>`).join("") +
    `</div>`
  );
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
  const due = renewalLettersDue(Object.values(loadAllRenewalLetters()), today);

  let sent = 0;
  let failed = 0;
  const notes: string[] = [];

  for (const letter of due) {
    if (!letter.to) {
      failed++;
      notes.push(`${letter.client_name}: no recipient on the letter — skipped`);
      continue;
    }
    const res = await sendClientEmailAction({
      to: letter.to,
      subject: letter.subject,
      htmlBody: bodyToHtml(letter.body),
      textBody: letter.body,
    });
    if (!res.ok) {
      failed++;
      notes.push(`${letter.client_name}: send failed — ${res.error} (will retry tomorrow)`);
      continue;
    }
    markRenewalLetterSent(letter.plan_slug);
    // offer_sent: winbackDecision() fails closed on it and openRenewals() drops
    // any non-null decision, so the plan leaves the queue and the drip stays off
    // until the coach records renewed / not_renewing.
    setDecision(
      letter.plan_slug,
      "offer_sent",
      `renewal letter sent ${today} to ${letter.to}; awaiting reply`,
    );
    sent++;
    notes.push(`${letter.client_name}: renewal letter sent to ${letter.to}`);
  }

  return NextResponse.json({ ok: true, due: due.length, sent, failed, notes });
}
