/**
 * POST /api/cron/menu-approval-digest — email the coach a daily digest of
 * weekly menus waiting for her approval, so the queue never goes silent.
 *
 * Fired daily by scripts/cron-runner.js at 07:30 IST (after weekly-menu-drafts
 * at 07:00, so freshly-drafted menus are included).
 *
 * Behaviour:
 *   - Pulls the same queue the dashboard "Weekly menus due" panel shows.
 *   - Splits into "ready to approve" (a draft is waiting) vs "needs attention"
 *     (the current week's menu is missing and no draft exists yet — e.g. a
 *     generation failure or API cap).
 *   - Sends ONE email to COACH_DIGEST_EMAIL (default GMAIL_USER) only when the
 *     queue is non-empty — no nag on quiet days.
 *   - Idempotent + side-effect-free beyond the email; safe to fire repeatedly.
 *
 * Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import nodemailer from "nodemailer";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { weeklyMenuQueueAction } from "@/lib/server-actions/weekly-menu";

export const dynamic = "force-dynamic";

async function displayName(clientId: string): Promise<string> {
  try {
    const f = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    const doc = (yaml.load(await fs.readFile(f, "utf-8")) as { display_name?: string }) ?? {};
    return doc.display_name?.trim() || clientId;
  } catch {
    return clientId;
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Wider than the cron's 3-day draft window: surface everything actionable,
  // including catch-up rows whose draft hasn't generated yet.
  const queue = await weeklyMenuQueueAction(7);
  // Travel/maintenance-window clients are paused — never ask the coach to
  // approve a menu for a holiday week.
  const actionable = queue.filter((r) => !r.onTravel);
  if (actionable.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: "nothing actionable (queue empty or all on travel)" });
  }

  const ready = actionable.filter((r) => r.pending);
  const attention = actionable.filter((r) => !r.pending); // behind / due but not drafted
  const count = actionable.length;

  // Monday (IST) is the coach's fixed approval day (2026-07-01) — emphasise it.
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const isApprovalDay = nowIst.getUTCDay() === 1;

  // Links go in an EMAIL the coach opens on her phone, so they must be the
  // PUBLIC coach URL (cloudflared → fmcoach.shivanihari.com), NOT APP_URL
  // (localhost, which the cron uses for its internal calls) and NOT
  // NEXT_PUBLIC_APP_URL (that's the Fly intake host, which 404s coach routes).
  const appUrl = (
    process.env.COACH_PUBLIC_URL ||
    process.env.APP_URL ||
    "http://localhost:3002"
  ).replace(/\/$/, "");
  const named = await Promise.all(
    actionable.map(async (r) => [r.clientId, await displayName(r.clientId)] as const),
  );
  const nameOf = new Map(named);

  const row = (r: (typeof queue)[number]) => {
    const name = esc(nameOf.get(r.clientId) || r.clientId);
    const link = `${appUrl}/clients-v2/${encodeURIComponent(r.clientId)}?tab=plan`;
    const wk = `wk ${r.targetWeek}`;
    const tag = r.behind ? " · ⚠️ current week missing" : "";
    const note = r.changeNote ? ` — ${esc(r.changeNote.slice(0, 90))}` : "";
    return `<li><a href="${link}">${name}</a> — ${wk}${tag}${note}</li>`;
  };

  const sections: string[] = [];
  if (ready.length) {
    sections.push(
      `<p><strong>✅ Ready to approve (${ready.length})</strong> — review in the Plan-tab studio, then Approve to push to the client:</p><ul>${ready
        .map(row)
        .join("")}</ul>`,
    );
  }
  if (attention.length) {
    sections.push(
      `<p><strong>⏳ Needs attention (${attention.length})</strong> — due soon but no draft yet (may have failed or hit the API cap):</p><ul>${attention
        .map(row)
        .join("")}</ul>`,
    );
  }

  const htmlBody = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#2b2d42;">
      <p>Good morning 🌿</p>
      ${
        isApprovalDay
          ? `<p style="background:#d98324;color:#fff;padding:10px 14px;border-radius:8px;font-weight:600;">🗓 It's your weekly approval day — set aside 5 minutes to review and Approve all.</p>`
          : ""
      }
      <p>${count} client menu${count === 1 ? "" : "s"} need your attention today.</p>
      ${sections.join("")}
      <p style="margin-top:18px;"><a href="${appUrl}/dashboard-v2"
        style="background:#6b8e6b;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;">Open the dashboard →</a></p>
      <p style="color:#8d99ae;font-size:12px;margin-top:20px;">Automated digest from your FM coach app · nothing reaches a client until you approve.</p>
    </div>`;

  const textBody =
    (isApprovalDay ? `🗓 MONDAY APPROVAL DAY — review and Approve all.\n\n` : "") +
    `${count} client menu(s) need attention.\n\n` +
    (ready.length
      ? `READY TO APPROVE:\n${ready
          .map((r) => `  - ${nameOf.get(r.clientId) || r.clientId} (wk ${r.targetWeek})`)
          .join("\n")}\n\n`
      : "") +
    (attention.length
      ? `NEEDS ATTENTION (no draft yet):\n${attention
          .map((r) => `  - ${nameOf.get(r.clientId) || r.clientId} (wk ${r.targetWeek})${r.behind ? " — current week missing" : ""}`)
          .join("\n")}\n\n`
      : "") +
    `Dashboard: ${appUrl}/dashboard-v2`;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return NextResponse.json(
      { ok: false, error: "Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)", queued: count },
      { status: 200 },
    );
  }
  const to = process.env.COACH_DIGEST_EMAIL || user;

  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await transporter.sendMail({
      from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
      to,
      subject: isApprovalDay
        ? `🗓 Monday approval day — ${count} menu${count === 1 ? "" : "s"} to approve`
        : `🗓 ${count} weekly menu${count === 1 ? "" : "s"} awaiting your approval`,
      html: htmlBody,
      text: textBody,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), queued: count }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    sent: 1,
    to,
    base: appUrl,
    queued: count,
    ready: ready.length,
    attention: attention.length,
  });
}
