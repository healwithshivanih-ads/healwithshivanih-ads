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
 * Letters are scheduled SEND_LEAD_DAYS (2) before the plan end (renewal-offer.ts).
 * A `maintenance` letter gets a LIVE payment link minted here, at send time, via
 * Fly (the Mac holds only test keys) and written into the body. If the link
 * cannot be minted the letter is NOT sent — a maintenance offer with no way to
 * pay is worse than one a day late — and it retries on the next run. A client
 * already covered by maintenance is not sent an offer at all.
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
  unapproveRenewalLetter,
} from "@/lib/fmdb/renewal-letters";
import { setDecision } from "@/lib/fmdb/renewal-queue";
import { sendClientEmailAction } from "@/app/api/email/actions";
import { recordOutboundMessageAction } from "@/app/api/whatsapp/actions";
import { generateMaintenanceLinkAction } from "@/lib/server-actions/maintenance-link";
import {
  DEFAULT_MAINTENANCE_TERM_MONTHS,
  maintenancePrice,
  effectiveExistingThrough,
} from "@/lib/fmdb/maintenance-orders";
import { withPaymentLink } from "@/lib/fmdb/renewal-offer";

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
    paras
      .map(
        (p) =>
          `<p style="margin:0 0 1em 0">${esc(p)
            .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
            .replace(/\n/g, "<br>")}</p>`,
      )
      .join("") +
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
    let body = letter.body;
    if (letter.offer_kind === "maintenance") {
      const through = await effectiveExistingThrough(letter.client_id).catch(() => null);
      if (through && through >= today) {
        // Already paid — an offer now would ask her to pay twice.
        unapproveRenewalLetter(letter.plan_slug);
        setDecision(letter.plan_slug, "renewed", `already on maintenance through ${through} — renewal letter not sent`);
        notes.push(`${letter.client_name}: already on maintenance through ${through} — not sent`);
        continue;
      }
      const term = DEFAULT_MAINTENANCE_TERM_MONTHS;
      const link = await generateMaintenanceLinkAction(letter.client_id, term);
      const inr = link.amountInr ?? maintenancePrice(term);
      if (!link.ok || !link.shortUrl || !inr) {
        failed++;
        notes.push(`${letter.client_name}: payment link failed — ${link.error ?? "no link"} (not sent; will retry tomorrow)`);
        continue;
      }
      body = withPaymentLink(body, link.shortUrl, `₹${inr.toLocaleString("en-IN")} for ${term} months`);
    }
    const res = await sendClientEmailAction({
      to: letter.to,
      subject: letter.subject,
      htmlBody: bodyToHtml(body),
      textBody: body,
      clientId: letter.client_id,
      purpose: "renewal",
    });
    if (!res.ok) {
      failed++;
      notes.push(`${letter.client_name}: send failed — ${res.error} (will retry tomorrow)`);
      continue;
    }
    markRenewalLetterSent(letter.plan_slug);
    // Thread record (2026-10-23): the renewal letter was the one scheduled
    // client email with no bubble in the Communicate tab.
    try {
      const rec = await recordOutboundMessageAction({
        clientId: letter.client_id,
        templateName: "(renewal letter)",
        renderedBody: `[subject: ${letter.subject}]\n\n${body}`,
        channel: "email",
      });
      if (!rec.ok) console.error(`[renewal-send] emailed ${letter.client_id} but could not record it: ${rec.error}`);
    } catch (e) {
      console.error(`[renewal-send] emailed ${letter.client_id} but record threw: ${(e as Error).message}`);
    }
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
