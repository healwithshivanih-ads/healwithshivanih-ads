"use server";

/**
 * Plan end-game nudges — prompts a client when their programme is wrapping up.
 *
 * Two kinds, both computed from data already on disk:
 *   - "review"  : the plan's effective recheck is within the REVIEW window
 *                 (recheck −14d, or −7d for short plans ≤6 weeks … +15d,
 *                 mirroring app-mode.ts reviewLeadDays) — time to decide
 *                 Continue / Maintain before the app drops to the library floor.
 *   - "renewal" : a client on the maintenance tier whose `maintenance_paid_through`
 *                 is within the next 14 days — time to renew.
 *   - "lapse"   : a maintenance client whose coverage has JUST lapsed but who is
 *                 still inside the 15-day grace window — last call before the app
 *                 drops to the library floor.
 *
 * Coach pulls the list from the dashboard panel; a per-client "Send nudge" button
 * fires the Meta-approved `fm_review_checkin_v1` template via the WA server.
 *
 * Template (registered via whatsapp-server/scripts/submit-templates.js):
 *   Name:  fm_review_checkin_v1   Params: {{1}} = display_name
 */

import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { daysSinceLastOpen, readAppOpens } from "@/lib/fmdb/app-engagement";
import { effectiveRecheckDate } from "@/lib/fmdb/plan-timing";
import { reviewLeadDays } from "@/lib/fmdb/app-mode";
import { sendAndRecordOutboundAction } from "@/app/api/whatsapp/actions";
import { getLastSentAtAction } from "@/app/api/whatsapp/actions";

const REVIEW_GRACE_DAYS = 15;
const RENEWAL_LEAD_DAYS = 14;
const GRACE_DAYS = 15; // mirrors app-mode.ts GRACE_DAYS

/** How recently a graduated client must have opened the app to still count as
 *  warm. A client on the LIBRARY floor who is STILL opening it is the strongest
 *  renewal signal there is — and until 2026-08-20 they were invisible here:
 *  the review branch drops them the day they pass recheck+15, so cl-017 fell
 *  off this list while opening the app most days, 17 days after her plan
 *  ended. Nobody was told. */
const LIBRARY_WARM_DAYS = 21;
const TEMPLATE = "fm_review_checkin_v1";

function istTodayYmd(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function asYmd(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}
function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface ReviewNudgeFlag {
  clientId: string;
  name: string;
  phone: string;
  kind: "review" | "renewal" | "lapse" | "library_active";
  /** library_active only: days since their most recent app open. */
  daysSinceOpen?: number;
  /** YYYY-MM-DD — the recheck (review) or paid-through (renewal/lapse) date. */
  date: string;
  /** Most recent time this nudge template went out, if ever. */
  lastSentAt: string | null;
}

type Dict = Record<string, unknown>;

/** Latest published plan per client_id, keyed for quick lookup. */
function latestPublishedByClient(plans: Dict[]): Map<string, Dict> {
  const byClient = new Map<string, { plan: Dict; v: number }>();
  for (const p of plans) {
    if (asStr(p.status) !== "published") continue;
    const cid = asStr(p.client_id);
    if (!cid) continue;
    const v = typeof p.version === "number" ? p.version : 0;
    const cur = byClient.get(cid);
    if (!cur || v >= cur.v) byClient.set(cid, { plan: p, v });
  }
  return new Map([...byClient].map(([k, x]) => [k, x.plan]));
}

export async function listReviewNudgesAction(): Promise<ReviewNudgeFlag[]> {
  const today = istTodayYmd();
  const [clients, plans] = await Promise.all([
    loadAllClients() as Promise<Dict[]>,
    loadAllPlans() as Promise<Dict[]>,
  ]);
  const planByClient = latestPublishedByClient(plans);

  const flags: ReviewNudgeFlag[] = [];
  for (const c of clients) {
    const clientId = asStr(c.client_id);
    if (!clientId) continue;
    const phone = asStr(c.mobile_number);
    const name = asStr(c.display_name) || clientId;

    // ── renewal: on maintenance, paid_through within the lead window ──────────
    const paidThrough = asYmd(c.maintenance_paid_through);
    const onMaintenance = asStr(c.maintenance_status) === "active" || paidThrough != null;
    if (onMaintenance && paidThrough && today <= paidThrough && paidThrough <= addDaysYmd(today, RENEWAL_LEAD_DAYS)) {
      flags.push({ clientId, name, phone, kind: "renewal", date: paidThrough, lastSentAt: null });
      continue; // maintenance takes precedence over the plan window
    }
    // lapse: coverage expired but still inside the grace window → last call.
    if (onMaintenance && paidThrough && today > paidThrough && today <= addDaysYmd(paidThrough, GRACE_DAYS)) {
      flags.push({ clientId, name, phone, kind: "lapse", date: paidThrough, lastSentAt: null });
      continue;
    }
    if (onMaintenance) continue; // active maintenance, not near renewal / past grace → no nudge

    // ── review: effective recheck inside the REVIEW window ────────────────────
    const plan = planByClient.get(clientId);
    if (!plan) continue;
    // Travel/illness pause + weight-loss buffer — don't nudge a review ~2 weeks
    // early for a client who was travelling.
    const wl = (c as { weight_loss?: { enabled?: boolean; week_overrides?: unknown[] } }).weight_loss;
    const recheck = effectiveRecheckDate(plan as never, {
      overrides: wl?.week_overrides as never,
      weightLossEnabled: wl?.enabled === true,
    });
    if (!recheck) continue;
    const reviewStart = addDaysYmd(recheck, -reviewLeadDays(plan as { plan_period_weeks?: number }));
    const reviewEnd = addDaysYmd(recheck, REVIEW_GRACE_DAYS);
    if (today >= reviewStart && today <= reviewEnd) {
      flags.push({ clientId, name, phone, kind: "review", date: recheck, lastSentAt: null });
      continue;
    }
    // Past the review window → the app has dropped them to the LIBRARY floor.
    // If they are STILL opening it, surface them: they have not drifted away,
    // they simply have not been asked. Silence here is a lost renewal, not a
    // closed one.
    if (today > reviewEnd) {
      const opens = await readAppOpens(clientId);
      const since = daysSinceLastOpen(opens);
      if (since !== null && since <= LIBRARY_WARM_DAYS) {
        flags.push({
          clientId, name, phone,
          kind: "library_active", date: recheck, lastSentAt: null, daysSinceOpen: since,
        });
      }
    }
  }

  // Attach last-sent for the "✓ Sent" persistence (durable send-state rule).
  await Promise.all(
    flags.map(async (f) => {
      const r = await getLastSentAtAction(f.clientId, TEMPLATE).catch(() => ({ sentAt: null }));
      f.lastSentAt = r.sentAt;
    }),
  );
  // Soonest date first.
  flags.sort((a, b) => a.date.localeCompare(b.date));
  return flags;
}

export async function sendReviewNudgeAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!clientId) return { ok: false, error: "clientId required" };
  const clients = (await loadAllClients()) as Dict[];
  const c = clients.find((x) => asStr(x.client_id) === clientId);
  if (!c) return { ok: false, error: "client not found" };
  const phone = asStr(c.mobile_number);
  if (!phone) return { ok: false, error: "no mobile number on file" };
  const first = (asStr(c.display_name).split(" ")[0] || "there").trim();

  return sendAndRecordOutboundAction({
    phone,
    clientId,
    templateName: TEMPLATE,
    templateParams: [first],
    renderedBody: `Hi ${first} 👋 Your plan is reaching its recheck point — time to review your progress with Shivani and decide your next step. Reply here or open your app to see how far you've come. 🌿`,
  });
}
