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
import { openRenewals } from "@/lib/fmdb/renewal-queue";
import {
  scanPlanChangesAction,
  listPlanChangeDraftsAction,
} from "@/lib/server-actions/plan-change-notify";

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
  // approve a menu for a holiday week. Same for app-dormant clients: we've
  // deliberately stopped drafting for them, so nagging her to approve their
  // menu would undo the point of the pause.
  const actionable = queue.filter((r) => !r.onTravel && !r.dormantDays);

  // ── plans ending ────────────────────────────────────────────────────────
  // Computed BEFORE the quiet-day return. A week with no menus due is exactly
  // when a plan quietly runs out, and the guard below would otherwise swallow
  // the one thing that is time-critical.
  const renewals = openRenewals();

  // Scan for plan edits the client has to act on. Runs BEFORE the quiet-day
  // guard for the same reason renewals do: a week with no menus due is exactly
  // when a quick-edit goes unannounced. The scan is idempotent — it advances a
  // per-plan snapshot, so a change is drafted once and never re-raised.
  await scanPlanChangesAction();
  const planChanges = await listPlanChangeDraftsAction();

  if (actionable.length === 0 && renewals.length === 0 && planChanges.length === 0) {
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

  // Folded into this email rather than sent as its own: a separate weekly mail
  // is one more thing to notice, and this is already the message she opens in
  // order to approve things.
  const renewalHtml = renewals.length
    ? `<p style="margin-top:22px;"><strong>📩 Plans ending (${renewals.length})</strong> — approve the letter here and it goes out on the day:</p><ul>${renewals
        .map((r) => {
          const when =
            r.daysLeft < 0
              ? `<span style="color:#b3402a;">ended ${Math.abs(r.daysLeft)}d ago</span>`
              : r.daysLeft === 0
                ? `<span style="color:#b3402a;">ends today</span>`
                : `in ${r.daysLeft}d`;
          const stage =
            r.stage === "offer" ? "renewal letter" : r.stage === "overdue" ? "overdue" : "labs + heads-up";
          const house = r.household.length
            ? ` <span style="color:#b3402a;">· also renewing: ${esc(r.household.join(", "))}</span>`
            : "";
          return `<li><strong>${esc(r.clientName)}</strong> — ${when} (${r.weeks}wk) · ${stage}${house}</li>`;
        })
        .join("")}</ul>
       <p style="color:#8d99ae;font-size:12px;">Nothing is drafted or sent automatically. Mark anyone who has decided not to continue and they stop appearing.</p>`
    : "";

  // Plan-change emails awaiting approval. Folded in here for the same reason
  // renewals are: this is already the message she opens in order to approve
  // things, and a separate mail is one more thing to notice.
  //
  // Nothing here has been sent. Each row is a DRAFT built from a real edit to
  // a published plan; approving it hands the email to the pending-sends queue.
  // Rows that stop something are held until she types a line of context.
  const planChangeHtml = planChanges.length
    ? `<p style="margin-top:22px;"><strong>✉️ Plan updates to send (${planChanges.length})</strong> — a published plan changed in a way the client has to act on:</p><ul>${planChanges
        .map((d) => {
          const what = d.changes
            .map((c) => {
              switch (c.kind) {
                case "supplement_added":
                  return `+ ${esc(c.label)}`;
                case "supplement_stopped":
                  return `− ${esc(c.label)}`;
                case "supplement_dose_changed":
                  return `${esc(c.label)} — new amount`;
                case "supplement_timing_changed":
                  return `${esc(c.label)} — new timing`;
                case "practice_added":
                  return `+ ${esc(c.label)}`;
                case "practice_stopped":
                  return `− ${esc(c.label)}`;
              }
            })
            .join(", ");
          const held = d.needs_reason
            ? ` <span style="color:#b3402a;">· needs a line of context before it can go</span>`
            : "";
          return `<li><strong>${esc(d.client_name)}</strong> — ${what}${held}</li>`;
        })
        .join("")}</ul>
       <p style="color:#8d99ae;font-size:12px;">Nothing is sent automatically. Preview and approve each one; anything that stops a supplement or practice is held until you add a reason.</p>`
    : "";

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
      ${renewalHtml}
      ${planChangeHtml}
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
    (renewals.length
      ? `PLANS ENDING:\n${renewals
          .map(
            (r) =>
              `  - ${r.clientName} — ${r.daysLeft < 0 ? `ended ${Math.abs(r.daysLeft)}d ago` : r.daysLeft === 0 ? "ends today" : `in ${r.daysLeft}d`} (${r.weeks}wk)` +
              (r.household.length ? ` [also renewing: ${r.household.join(", ")}]` : ""),
          )
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
