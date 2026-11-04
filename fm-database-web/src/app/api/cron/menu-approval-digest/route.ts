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
import { openRenewals, loadDecisions as loadRenewalDecisions } from "@/lib/fmdb/renewal-queue";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { resolveLifecycles } from "@/lib/fmdb/lifecycle";
import { collectDecisions } from "@/lib/fmdb/decisions";
import { describeChange } from "@/lib/fmdb/plan-change-diff";
import { loadAllRenewalLetters } from "@/lib/fmdb/renewal-letters";
import { loadHeldMonthlyCards } from "@/lib/fmdb/monthly-cards-store";
import { splitByDraftWindow, draftDayLabel } from "@/lib/fmdb/menu-cadence";
import {
  scanPlanChangesAction,
  listPlanChangeDraftsAction,
} from "@/lib/server-actions/plan-change-notify";
import { listWinbackDraftsAction, listWinbackScheduledAction } from "@/lib/server-actions/winback-drip";

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
  const openRows = openRenewals();
  const renewalLetters = loadAllRenewalLetters();
  // Monthly cards the cron held because something stood out. Rare, and a held
  // card is invisible to the client until she acts, so it forces the mail.
  const heldCards = await loadHeldMonthlyCards();

  // Scan for plan edits the client has to act on. Runs BEFORE the quiet-day
  // guard for the same reason renewals do: a week with no menus due is exactly
  // when a quick-edit goes unannounced. The scan is idempotent — it advances a
  // per-plan snapshot, so a change is drafted once and never re-raised.
  await scanPlanChangesAction();
  const allPlanChanges = await listPlanChangeDraftsAction();

  // ── win-back drafts ─────────────────────────────────────────────────────
  // Read only — the 10:30 winback-drip cron does the drafting. Folded in here
  // for the same reason renewals are: this is the mail she opens in order to
  // approve things, and these emails are the ones most easily forgotten,
  // because by definition they are for clients who have already gone quiet.
  const [allWinback, winbackScheduled] = await Promise.all([
    listWinbackDraftsAction(),
    listWinbackScheduledAction(),
  ]);

  // Every row below must be one the dashboard will show with a button next to
  // it. The email used to list the raw queues while the dashboard filtered by
  // lifecycle, age and live plan, so the coach was told about renewals,
  // win-backs and plan updates she then could not find (2026-11-04). Running
  // the inbox's own rules here makes the two the same list by construction.
  const todayYmd = new Date().toISOString().slice(0, 10);
  const [allClients, allPlans] = await Promise.all([loadAllClients(), loadAllPlans()]);
  const liveClients = allClients.filter((c) => (c as { archived?: boolean }).archived !== true);
  const lifecycle = resolveLifecycles(
    liveClients as unknown as Parameters<typeof resolveLifecycles>[0],
    allPlans as unknown as Parameters<typeof resolveLifecycles>[1],
    todayYmd,
    { decisions: loadRenewalDecisions() },
  );
  const inbox = collectDecisions({
    todayYmd,
    lifecycle,
    nameOf: (id) => id,
    inbound: [],
    repliedTo: new Set(),
    renewals: openRows,
    followupDrafts: [],
    followupScheduled: [],
    followupUnanchored: [],
    winbackDrafts: allWinback,
    winbackScheduled,
    notes: [],
    plateaued: [],
    regressed: [],
    feedback: [],
    archiveCandidates: [],
    planUpdates: allPlanChanges,
    onboardingStep: new Map(),
  });
  const renewals = inbox.filtered.renewals as typeof openRows;
  const winback = inbox.filtered.winbackDrafts as typeof allWinback;
  const planChanges = inbox.filtered.planUpdates as typeof allPlanChanges;

  const ready = actionable.filter((r) => r.pending);
  // Rows with no draft are two different things and must not share a heading.
  // `stalled` is a real failure worth chasing (the drafter ran at 07:00, half
  // an hour ago, and produced nothing). `scheduled` is simply not due yet —
  // the digest looks 7 days out, the drafter acts within 3. Calling the second
  // one a possible API-cap failure is what taught the coach to skim the
  // section, which is how the first one gets missed.
  const { stalled, scheduled } = splitByDraftWindow(actionable.filter((r) => !r.pending));
  const count = actionable.length;
  // What the subject line and opening sentence should count: only the rows
  // that actually want a decision from her. `scheduled` rows are reported, not
  // asked about.
  const needsYou = ready.length + stalled.length;

  // Quiet-day guard, evaluated on `needsYou` rather than on the raw queue: a
  // morning whose only menu rows are ones the drafter will handle by itself is
  // a quiet morning, and mailing about it is the nag this whole section exists
  // to stop. Renewals and plan-changes still force the mail — those are
  // time-critical and nothing else watches them.
  if (
    needsYou === 0 &&
    renewals.length === 0 &&
    planChanges.length === 0 &&
    winback.length === 0 &&
    heldCards.length === 0
  ) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      reason: "nothing needs the coach (queue empty, paused, or drafting on its own)",
      scheduled: scheduled.length,
    });
  }

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
    const link = `${appUrl}/clients-v2/${encodeURIComponent(r.clientId)}/plan`;
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
  if (stalled.length) {
    sections.push(
      `<p><strong>⚠️ Needs attention (${stalled.length})</strong> — due now but no draft came through (generation failed, or the API cap was hit):</p><ul>${stalled
        .map(row)
        .join("")}</ul>`,
    );
  }
  if (scheduled.length) {
    sections.push(
      `<p style="margin-top:22px;"><strong>🕒 Drafting on their own (${scheduled.length})</strong> — nothing to do; they're just not due yet:</p><ul>${scheduled
        .map(
          (r) =>
            `<li>${esc(nameOf.get(r.clientId) || r.clientId)} — wk ${r.targetWeek} · drafts ${draftDayLabel(
              r.daysToNextWeek,
            )}</li>`,
        )
        .join("")}</ul>`,
    );
  }

  // Folded into this email rather than sent as its own: a separate weekly mail
  // is one more thing to notice, and this is already the message she opens in
  // order to approve things.
  const renewalLink = `${appUrl}/dashboard-v2#renewals`;
  const renewalHtml = renewals.length
    ? `<p style="margin-top:22px;"><strong>📩 Plans ending (${renewals.length})</strong> — read and approve each letter on the dashboard; approved letters send two days before the plan ends:</p><ul>${renewals
        .map((r) => {
          const when =
            r.daysLeft < 0
              ? `<span style="color:#b3402a;">ended ${Math.abs(r.daysLeft)}d ago</span>`
              : r.daysLeft === 0
                ? `<span style="color:#b3402a;">ends today</span>`
                : `in ${r.daysLeft}d`;
          // What the coach actually has to DO, driven by the letter's state.
          const letter = renewalLetters[r.planSlug];
          const status =
            letter?.status === "approved"
              ? `<span style="color:#4a6b4a;">✅ letter approved · sends ${esc(letter.scheduled_for || "two days before the end")}</span>`
              : letter?.status === "drafted"
                ? `<span style="color:#4a6b4a;">📝 draft ready — read &amp; approve</span>`
                : `<span style="color:#b3402a;">no letter yet — write it in chat: <code>/author-renewal ${esc(r.clientName)}</code></span>`;
          const house = r.household.length
            ? ` <span style="color:#b3402a;">· also renewing: ${esc(r.household.join(", "))}</span>`
            : "";
          return `<li><a href="${renewalLink}"><strong>${esc(r.clientName)}</strong></a> — ${when} (${r.weeks}wk) · ${status}${house}</li>`;
        })
        .join("")}</ul>
       <p style="color:#8d99ae;font-size:12px;">On the dashboard each name has the buttons: read &amp; approve a drafted letter (it sends two days before the plan ends), or mark Renewed / Not renewing / Deferred. A letter that does not exist yet is written in chat with the command shown, then appears there as a draft.</p>`
    : "";

  // Plan-change emails awaiting approval. Folded in here for the same reason
  // renewals are: this is already the message she opens in order to approve
  // things, and a separate mail is one more thing to notice.
  //
  // Nothing here has been sent. Each row is a DRAFT built from a real edit to
  // a published plan; approving it hands the email to the pending-sends queue.
  // Rows that stop something are held until she types a line of context.
  const planChangeHtml = planChanges.length
    ? `<p style="margin-top:22px;"><strong>✏️ Plan updates to send (${planChanges.length})</strong> — a live plan changed in a way the client has to act on. <a href="${appUrl}/dashboard-v2#plan-updates">Read and send them on the dashboard</a>:</p><ul>${planChanges
        .map((d) => {
          const what = d.changes.map((c) => esc(describeChange(c))).join(", ");
          const held = d.needs_reason
            ? ` <span style="color:#b3402a;">· needs a line of context before it can go</span>`
            : "";
          return `<li><a href="${appUrl}/dashboard-v2#plan-updates"><strong>${esc(d.client_name)}</strong></a> — ${what}${held}</li>`;
        })
        .join("")}</ul>
       <p style="color:#8d99ae;font-size:12px;">Nothing is sent automatically. Preview and approve each one; anything that stops a supplement or practice is held until you add a reason.</p>`
    : "";

  // Win-back drafts. Each row names the touch so she can see at a glance
  // whether it is the soft check-in or the one that asks for money — and the
  // offer touch says outright that it needs a price, because that is the one
  // thing she has to supply before it can go.
  const winbackHtml = winback.length
    ? `<p style="margin-top:22px;"><strong>✉️ Win-back drafts (${winback.length})</strong> — plans that ended and were never picked up. Read each one, then send:</p><ul>${winback
        .map((d) => {
          const what =
            d.kind === "check_in"
              ? "check-in, no price"
              : d.kind === "offer"
                ? "next phase + maintenance"
                : "final — maintenance only";
          const price = d.needsPrice
            ? ` <span style="color:#b3402a;">· needs a price before it can go</span>`
            : "";
          return `<li><a href="${appUrl}/dashboard-v2#winback"><strong>${esc(d.clientName)}</strong></a> — touch ${d.touch} of 3 (${what}) · ended ${d.daysSinceEnd}d ago${price}</li>`;
        })
        .join("")}</ul>
       <p style="color:#8d99ae;font-size:12px;">Drafted automatically; nothing is sent until you approve it on the dashboard.</p>`
    : "";

  const htmlBody = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#2b2d42;">
      <p>Good morning 🌿</p>
      ${
        isApprovalDay
          ? `<p style="background:#d98324;color:#fff;padding:10px 14px;border-radius:8px;font-weight:600;">🗓 It's your weekly approval day — set aside 5 minutes to review and Approve all.</p>`
          : ""
      }
      <p>${needsYou} client menu${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} you today${
        scheduled.length ? `, and ${scheduled.length} more draft${scheduled.length === 1 ? "s" : ""} on its own this week` : ""
      }.</p>
      ${sections.join("")}
      ${renewalHtml}
      ${winbackHtml}
      ${planChangeHtml}
      ${
        heldCards.length
          ? `<p style="margin-top:22px;"><strong>🗓 Monthly cards to check (${heldCards.length})</strong>, held back because something stood out. Everyone else's went out on their own:</p><ul>${heldCards
              .map((h) => `<li><strong>${esc(h.clientName)}</strong> (${esc(h.month)}): ${esc((h.card.flags ?? []).join(" "))}</li>`)
              .join("")}</ul>`
          : ""
      }
      <p style="margin-top:18px;"><a href="${appUrl}/dashboard-v2"
        style="background:#6b8e6b;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;">Open the dashboard →</a></p>
      <p style="color:#8d99ae;font-size:12px;margin-top:20px;">Automated digest from your FM coach app · nothing reaches a client until you approve.</p>
    </div>`;

  const textBody =
    (isApprovalDay ? `🗓 MONDAY APPROVAL DAY — review and Approve all.\n\n` : "") +
    `${needsYou} client menu(s) need you.\n\n` +
    (ready.length
      ? `READY TO APPROVE:\n${ready
          .map((r) => `  - ${nameOf.get(r.clientId) || r.clientId} (wk ${r.targetWeek})`)
          .join("\n")}\n\n`
      : "") +
    (stalled.length
      ? `NEEDS ATTENTION (due now, no draft came through):\n${stalled
          .map((r) => `  - ${nameOf.get(r.clientId) || r.clientId} (wk ${r.targetWeek})${r.behind ? " — current week missing" : ""}`)
          .join("\n")}\n\n`
      : "") +
    (scheduled.length
      ? `DRAFTING ON THEIR OWN (nothing to do):\n${scheduled
          .map(
            (r) =>
              `  - ${nameOf.get(r.clientId) || r.clientId} (wk ${r.targetWeek}) — drafts ${draftDayLabel(r.daysToNextWeek)}`,
          )
          .join("\n")}\n\n`
      : "") +
    (renewals.length
      ? `PLANS ENDING (read & approve on the dashboard; approved letters send two days before the plan ends):\n${renewals
          .map((r) => {
            const letter = renewalLetters[r.planSlug];
            const status =
              letter?.status === "approved"
                ? `letter approved · sends ${letter.scheduled_for || "two days before the end"}`
                : letter?.status === "drafted"
                  ? "draft ready — read & approve"
                  : `no letter yet — write it in chat: /author-renewal ${r.clientName}`;
            return (
              `  - ${r.clientName} — ${r.daysLeft < 0 ? `ended ${Math.abs(r.daysLeft)}d ago` : r.daysLeft === 0 ? "ends today" : `in ${r.daysLeft}d`} (${r.weeks}wk) · ${status}` +
              (r.household.length ? ` [also renewing: ${r.household.join(", ")}]` : "")
            );
          })
          .join("\n")}\n\n`
      : "") +
    (winback.length
      ? `WIN-BACK DRAFTS (nothing sent until you approve):\n${winback
          .map(
            (d) =>
              `  - ${d.clientName} — touch ${d.touch} of 3 (${d.kind.replace("_", " ")}) · ended ${d.daysSinceEnd}d ago` +
              (d.needsPrice ? " [needs a price]" : ""),
          )
          .join("\n")}\n\n`
      : "") +
    (planChanges.length
      ? `PLAN UPDATES TO SEND (read & send on the dashboard):\n${planChanges
          .map((d) => `  - ${d.client_name} — ${d.changes.map(describeChange).join(", ")}${d.needs_reason ? " [needs a line of context]" : ""}`)
          .join("\n")}\n\n`
      : "") +
    (heldCards.length
      ? `MONTHLY CARDS TO CHECK (held because something stood out):\n${heldCards
          .map((h) => `  - ${h.clientName} (${h.month}): ${(h.card.flags ?? []).join(" ")}`)
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
        ? `🗓 Monday approval day — ${needsYou} menu${needsYou === 1 ? "" : "s"} to approve`
        : `🗓 ${needsYou} weekly menu${needsYou === 1 ? "" : "s"} awaiting your approval`,
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
    attention: stalled.length,
    scheduled: scheduled.length,
  });
}
