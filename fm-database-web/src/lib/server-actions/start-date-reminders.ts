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
import { sendWhatsAppAction } from "@/app/api/whatsapp/actions";

export interface UnconfirmedStartFlag {
  client_id: string;
  display_name: string | null;
  mobile_number: string | null;
  plan_slug: string;
  plan_published_on: string | null;   // YYYY-MM-DD if known
  plan_period_start: string | null;
  days_since_published: number | null;
  assumed_meal_start: string | null;  // plan_period_start + 3d
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
  campaignName: string = "fm_start_date_check_v1",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
    const c = clients.find((x) => x.client_id === clientId);
    if (!c) return { ok: false, error: `Client ${clientId} not found` };
    const phone = (c.mobile_number as string | undefined) ?? "";
    if (!phone.trim()) return { ok: false, error: "No mobile number on file" };
    const name = (c.display_name as string | undefined) ?? "there";
    return await sendWhatsAppAction(phone, campaignName, [name]);
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Send failed" };
  }
}
