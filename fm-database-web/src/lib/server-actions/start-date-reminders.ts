"use server";

/**
 * Start-date confirmation reminders.
 *
 * Lists clients whose plan was published more than `staleDays` ago but who
 * haven't yet confirmed their actual meal-plan start date
 * (`plan.meal_plan_started_on` is still null). Those clients are running on
 * the +3d default assumption, which is fine most of the time — but if they
 * actually started later, our recheck date is wrong AND our letter framing
 * doesn't match their lived experience.
 *
 * Coach pulls the list from the dashboard panel; per-client "📨 Send
 * reminder" button shoots a templated WhatsApp via the self-hosted WA server.
 *
 * Template the coach must register on the WhatsApp server (one-time):
 *   Name:    fm_start_date_check_v1
 *   Body:    "Hi {{1}} 👋 Quick check-in from Shivani — have you started
 *            your plan yet? If yes, just reply with the date you began
 *            (e.g. 'Started 19 May'). If you'd like more time, no rush!"
 *   Params:  {{1}} = display_name
 *
 * Inbound responses are picked up by the existing start-date parser
 * (src/lib/start-date-parser.ts) which auto-updates plan.meal_plan_started_on.
 */

import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { sendAndRecordOutboundAction } from "@/app/api/whatsapp/actions";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const PLANS_ROOT =
  process.env.FMDB_PLANS_DIR ??
  path.join(process.env.HOME ?? "", "fm-plans");

// v2 is the UTILITY-categorised version (Meta APPROVED 2026-06-18). v1 was
// re-classified MARKETING ("just checking in" = engagement) → throttled to
// clients who hadn't messaged (err 131049). v2 delivers regardless.
const START_REMINDER_TEMPLATE = "fm_start_date_check_v2";

/**
 * Scan a client's sessions for the most recent outbound segment tagged
 * `[template: <templateName>]` and return its `[sent_at: <ISO>]` value.
 * Returns null when no matching send exists yet. Used by the dashboard
 * reminder panel to persist "✓ Sent {when}" across refreshes (durable
 * rule: feedback_send_buttons_persist_state).
 */
async function lastTemplateSendAt(
  clientId: string,
  templateName: string,
): Promise<string | null> {
  const dir = path.join(PLANS_ROOT, "clients", clientId, "sessions");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  let bestIso: string | null = null;
  for (const name of names) {
    if (!(name.endsWith(".yaml") || name.endsWith(".yml"))) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      const data = yaml.load(raw) as Record<string, unknown>;
      const complaints = String(data?.presenting_complaints ?? "");
      if (!complaints.includes(`[template: ${templateName}]`)) continue;
      const segments = complaints.split(/\n\s*---\s*\n/);
      for (const seg of segments) {
        if (!seg.includes(`[template: ${templateName}]`)) continue;
        const m = seg.match(/\[sent_at:\s*([^\]]+)\]/);
        if (!m) continue;
        const iso = m[1].trim();
        if (!bestIso || iso > bestIso) bestIso = iso;
      }
    } catch {
      /* skip unreadable session */
    }
  }
  return bestIso;
}

export interface UnconfirmedStartFlag {
  client_id: string;
  display_name: string | null;
  mobile_number: string | null;
  plan_slug: string;
  plan_published_on: string | null;   // YYYY-MM-DD if known
  plan_period_start: string | null;
  days_since_published: number | null;
  assumed_meal_start: string | null;  // plan_period_start + 3d
  last_reminder_sent_at: string | null; // ISO; most recent fm_start_date_check_v1 send
}

/**
 * Scan all clients + their published plans. Return rows where:
 *   - plan status === "published"
 *   - plan.meal_plan_started_on IS NULL
 *   - plan_period_start (or status_history publish event) is at least
 *     `staleDays` days ago — gives the client time to actually start
 *     before we nag.
 */
export async function listUnconfirmedStartDatesAction(
  staleDays: number = 5,
): Promise<{ ok: true; flags: UnconfirmedStartFlag[] } | { ok: false; error: string }> {
  try {
    const [clients, plans] = await Promise.all([
      loadAllClients(),
      loadAllPlans(),
    ]);
    const clientMap = new Map(
      (clients as Array<Record<string, unknown>>).map((c) => [
        c.client_id as string,
        c,
      ]),
    );

    const today = Date.now();
    const flags: UnconfirmedStartFlag[] = [];

    for (const p of plans as Array<Record<string, unknown>>) {
      const status = (p.status as string) ?? (p._bucket as string);
      if (status !== "published") continue;
      if (p.meal_plan_started_on) continue;          // already confirmed
      if (p.start_confirmation_used_at) continue;    // confirmed via /start/[token]

      const clientId = p.client_id as string | undefined;
      if (!clientId) continue;

      const periodStart = (p.plan_period_start as string | undefined) ?? null;
      let publishedOn: string | null = null;
      const history = (p.status_history as Array<{ state?: string; at?: string }> | undefined) ?? [];
      const publishEvent = history.find((h) => h.state === "published");
      if (publishEvent?.at) {
        publishedOn = (publishEvent.at as string).slice(0, 10);
      } else if (periodStart) {
        publishedOn = periodStart;
      }
      if (!publishedOn) continue;

      const publishedTs = Date.parse(publishedOn + "T00:00:00");
      if (isNaN(publishedTs)) continue;
      const daysSince = Math.round((today - publishedTs) / (1000 * 60 * 60 * 24));
      if (daysSince < staleDays) continue;

      // Compute assumed meal-plan start (period_start + 3d) for display
      let assumedStart: string | null = null;
      if (periodStart) {
        const d = new Date(periodStart + "T00:00:00");
        d.setDate(d.getDate() + 3);
        assumedStart = d.toISOString().slice(0, 10);
      }

      const c = clientMap.get(clientId);
      flags.push({
        client_id: clientId,
        display_name: (c?.display_name as string | undefined) ?? null,
        mobile_number: (c?.mobile_number as string | undefined) ?? null,
        plan_slug: p.slug as string,
        plan_published_on: publishedOn,
        plan_period_start: periodStart,
        days_since_published: daysSince,
        assumed_meal_start: assumedStart,
        last_reminder_sent_at: null, // filled below after dedupe
      });
    }

    // Dedupe by client_id — when a coach publishes a new plan without
    // superseding the old one, the same client surfaces N times in this
    // list, one row per stale published plan. Keep only the most-recent
    // plan per client (highest plan_published_on; tiebreak by plan_slug).
    // The older plans are a separate data-hygiene problem (they should be
    // superseded), surfaced via the supersede-suggestion panel — not
    // duplicated as reminder nags.
    const byClient = new Map<string, UnconfirmedStartFlag>();
    for (const f of flags) {
      const existing = byClient.get(f.client_id);
      if (!existing) {
        byClient.set(f.client_id, f);
        continue;
      }
      const aDate = f.plan_published_on ?? "";
      const bDate = existing.plan_published_on ?? "";
      if (aDate > bDate || (aDate === bDate && f.plan_slug > existing.plan_slug)) {
        byClient.set(f.client_id, f);
      }
    }
    const deduped = Array.from(byClient.values());

    // Most stale first
    deduped.sort(
      (a, b) => (b.days_since_published ?? 0) - (a.days_since_published ?? 0),
    );

    // Fill last_reminder_sent_at in parallel so the dashboard panel can
    // render "✓ Sent {when}" instead of a transient local-only chip.
    await Promise.all(
      deduped.map(async (f) => {
        f.last_reminder_sent_at = await lastTemplateSendAt(
          f.client_id,
          START_REMINDER_TEMPLATE,
        );
      }),
    );

    return { ok: true, flags: deduped };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to scan plans" };
  }
}

/**
 * Send the templated WhatsApp reminder for one client. Returns the
 * standard sendWhatsAppAction shape. Coach can use this per-row from
 * the dashboard panel.
 */
export async function sendStartDateReminderAction(
  clientId: string,
  campaignName: string = "fm_start_date_check_v2",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
    const c = clients.find((x) => x.client_id === clientId);
    if (!c) return { ok: false, error: `Client ${clientId} not found` };
    const phone = (c.mobile_number as string | undefined) ?? "";
    if (!phone.trim()) return { ok: false, error: "No mobile number on file" };
    const name = (c.display_name as string | undefined) ?? "there";
    // Mirror the Meta-approved fm_start_date_check_v2 body (UTILITY) for the
    // chat-thread record.
    const renderedBody =
      `Hi ${name}, a quick note about your plan. Have you started it yet? ` +
      `If yes, please reply with the date you began (for example: 19 May) ` +
      `so I can set your plan timeline and recheck dates correctly. ` +
      `If you need more time, just let me know.`;
    return await sendAndRecordOutboundAction({
      phone,
      clientId,
      templateName: campaignName,
      templateParams: [name],
      renderedBody,
    });
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Send failed" };
  }
}
