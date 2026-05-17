/**
 * POST /api/cron/intake-reminders — auto-nudge clients with open intake links.
 *
 * Fired daily by scripts/cron-runner.js at 08:30 IST.
 *
 * Rules (slice a — Path A questionnaire):
 *   - Client has intake_token set (link still active)
 *   - intake_finalised_at NOT set (coach hasn't locked yet)
 *   - intake_token_expires_at in the future (link not expired)
 *   - Last reminder (or token generation) ≥5d ago — no spam
 *   - Cap at 2 reminders per token, then stop (coach must intervene)
 *
 * Sends via `fm_intake_reminder` Meta-approved template:
 *   "Hi {{1}}, gentle nudge — your intake form is still open. Expires
 *    {{2}}. Link: {{3}}"
 *
 * Each send appends to client.intake_reminders_sent_at[] so the cron
 * never re-nags the same day. Idempotent — same call same day is a no-op.
 *
 * Auth: requires x-cron-secret header matching CRON_SECRET env. Anything
 * else returns 401 so the endpoint can't be hit from the public internet.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { loadAllClients } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { sendWhatsAppAction } from "@/app/api/whatsapp/actions";

export const dynamic = "force-dynamic";

const TEMPLATE_NAME = "fm_intake_reminder";
const MIN_DAYS_BETWEEN_REMINDERS = 5;
const MAX_REMINDERS_PER_TOKEN = 2;

function buildPublicUrl(token: string): string | null {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (!origin || /localhost|127\.0\.0\.1/.test(origin)) return null;
  return `${origin}/intake/${token}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const todayIso = new Date().toISOString();
  const today = new Date(todayIso);

  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const candidates: Array<{
    client_id: string;
    display_name: string;
    mobile: string;
    token: string;
    expires_at: string;
    last_nudge_at: string | null;
    reminders_sent: number;
  }> = [];

  for (const c of clients) {
    const token = c.intake_token as string | undefined;
    if (!token) continue;
    if (c.intake_finalised_at) continue;
    // Coach-opt-in: only nudge clients where the coach explicitly
    // generated a fresh intake link via the SendIntakeFormButton (which
    // sets intake_reminder_enabled=true). Legacy clients onboarded
    // before the intake form existed, or those who don't need to fill it,
    // are skipped. Coach can also flip the flag off via the UI to stop
    // future reminders mid-cycle.
    if (c.intake_reminder_enabled !== true) continue;

    const expiresIso = c.intake_token_expires_at as string | undefined;
    if (expiresIso) {
      const exp = new Date(expiresIso);
      if (!Number.isNaN(exp.getTime()) && exp < today) continue; // expired
    }

    const remindersSentAt = (c.intake_reminders_sent_at as string[] | undefined) ?? [];
    if (remindersSentAt.length >= MAX_REMINDERS_PER_TOKEN) continue;

    // Anchor for "days since last nudge" = most recent of (token issued,
    // last reminder sent, last submit). If anything happened in the last
    // 5d, skip.
    const anchorCandidates: string[] = [];
    if (typeof c.intake_token_expires_at === "string") {
      // Derive token-issue-at: expires_at - default TTL (14d). Coarse but ok.
      const exp = new Date(c.intake_token_expires_at as string);
      if (!Number.isNaN(exp.getTime())) {
        const issued = new Date(exp.getTime() - 14 * 86_400_000);
        anchorCandidates.push(issued.toISOString());
      }
    }
    if (remindersSentAt.length > 0) anchorCandidates.push(remindersSentAt[remindersSentAt.length - 1]);
    if (typeof c.intake_last_submitted_at === "string") {
      anchorCandidates.push(c.intake_last_submitted_at as string);
    }

    const anchor = anchorCandidates
      .map((s) => new Date(s))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (anchor && daysBetween(anchor, today) < MIN_DAYS_BETWEEN_REMINDERS) continue;

    const mobile = (c.mobile_number as string | undefined) || (c.mobile as string | undefined) || "";
    if (!mobile.trim()) continue; // no number to nudge

    candidates.push({
      client_id: c.client_id as string,
      display_name: (c.display_name as string | undefined) || (c.client_id as string),
      mobile: mobile.trim(),
      token,
      expires_at: expiresIso || "",
      last_nudge_at: anchor ? anchor.toISOString() : null,
      reminders_sent: remindersSentAt.length,
    });
  }

  const sent: string[] = [];
  const failed: Array<{ client_id: string; error: string }> = [];

  for (const cand of candidates) {
    const firstName = cand.display_name.split(" ")[0] || cand.display_name;
    const url = buildPublicUrl(cand.token);
    if (!url) {
      failed.push({
        client_id: cand.client_id,
        error: "NEXT_PUBLIC_APP_URL unset or localhost — refusing to send unreachable link",
      });
      continue;
    }
    const expiresLabel = cand.expires_at
      ? new Date(cand.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : "soon";

    const r = await sendWhatsAppAction(
      cand.mobile,
      TEMPLATE_NAME,
      [firstName, expiresLabel, url],
      { name: cand.display_name },
    );

    if (!r.ok) {
      failed.push({ client_id: cand.client_id, error: r.error || "send failed" });
      continue;
    }

    // Append to intake_reminders_sent_at on the client YAML
    try {
      const yamlPath = path.join(getPlansRoot(), "clients", cand.client_id, "client.yaml");
      const raw = await fs.readFile(yamlPath, "utf8");
      const data = yaml.load(raw) as Record<string, unknown>;
      const list = (data.intake_reminders_sent_at as string[] | undefined) ?? [];
      list.push(todayIso);
      data.intake_reminders_sent_at = list;
      data.updated_at = todayIso;
      await fs.writeFile(yamlPath, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf8");
      sent.push(cand.client_id);
    } catch (err) {
      // Send succeeded but logging failed — still count it as sent but flag
      failed.push({
        client_id: cand.client_id,
        error: `sent but failed to log: ${(err as Error).message}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: clients.length,
    candidates: candidates.length,
    sent: sent.length,
    failed: failed.length,
    detail: { sent, failed },
  });
}
