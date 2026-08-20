/**
 * POST /api/cron/graduation-notice — tell a client their programme is complete.
 *
 * Fired daily by scripts/cron-runner.js at 10:00 IST, after the morning's
 * roster jobs (06:30 renewal-sweep, 06:45 integrity) have settled, so the plans
 * and maintenance fields this reads are already correct for the day.
 *
 * The gap: `resolveAppMode` moves a client from REVIEW to LIBRARY silently, on
 * a date, with nothing announcing it. cl-017 opened her app the morning after
 * and found it changed with no word from anyone. This route is the word.
 *
 * Every rule lives in the pure module (lib/fmdb/graduation-notice.ts) and is
 * covered by graduation-notice.test.ts — this file only reads from disk, calls
 * the decision, and sends. Nothing here decides who is eligible.
 *
 * Idempotent: the "have we told them" state is the outbound WhatsApp record
 * already written by sendAndRecordOutboundAction, read back via
 * getLastSentAtAction. There is no parallel state file. A daily cron therefore
 * sends once per graduation, not once per day — see the module docstring for
 * why the comparison is date-scoped rather than a boolean.
 *
 * Auth: requires x-cron-secret matching CRON_SECRET, else 401.
 * Dry-run: POST {"apply": false} to see who WOULD be messaged, sending nothing.
 */
import { NextRequest, NextResponse } from "next/server";

import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { daysSinceLastOpen, readAppOpens } from "@/lib/fmdb/app-engagement";
import {
  graduationNoticeDecision,
  renderGraduationNotice,
} from "@/lib/fmdb/graduation-notice";
import type { AppModePlan } from "@/lib/fmdb/app-mode";
import type { RecheckOpts } from "@/lib/fmdb/plan-timing";
import {
  getLastSentAtAction,
  sendAndRecordOutboundAction,
} from "@/app/api/whatsapp/actions";

export const dynamic = "force-dynamic";

/**
 * PENDING META APPROVAL as of 2026-08-20. Registered in
 * whatsapp-server/scripts/submit-templates.js; until Meta approves it every
 * send here fails at the WA server and the client is retried tomorrow (the
 * send is only recorded on success, so a rejected send never marks the
 * graduation as announced). Param {{1}} = first name.
 */
const TEMPLATE = "fm_programme_complete_v1";

type Dict = Record<string, unknown>;

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * YYYY-MM-DD from a string or a Date. js-yaml parses bare `2026-09-03` into a
 * Date, and resolveAppMode's own guard only accepts strings — so a Date-valued
 * maintenance_paid_through would read as "no maintenance record" and route the
 * client down the plan-window branch. Normalise before handing it over.
 */
function asYmd(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/** Today in IST as YYYY-MM-DD — the app's own day boundary. */
function istTodayYmd(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Latest published plan per client. Same shape review-nudges.ts uses; that
 * copy is a "use server" module and can only export async functions, so it
 * cannot be shared without a refactor this change does not need.
 */
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

interface Candidate {
  clientId: string;
  name: string;
  firstName: string;
  phone: string;
  graduatedOn: string;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let apply = true;
  try {
    const body = (await req.json()) as { apply?: boolean } | null;
    if (body && typeof body.apply === "boolean") apply = body.apply;
  } catch {
    // cron-runner posts {source, ts}; anything unparseable keeps the default.
  }

  const today = istTodayYmd();
  const [clients, plans] = await Promise.all([
    loadAllClients() as Promise<Dict[]>,
    loadAllPlans() as Promise<Dict[]>,
  ]);
  const planByClient = latestPublishedByClient(plans);

  const due: Candidate[] = [];
  const skipped: Array<{ clientId: string; reason: string }> = [];

  for (const c of clients) {
    const clientId = asStr(c.client_id);
    if (!clientId) continue;

    const plan = (planByClient.get(clientId) ?? null) as AppModePlan | null;
    const wl = (c as { weight_loss?: { enabled?: boolean; week_overrides?: unknown[] } })
      .weight_loss;
    const recheckOpts: RecheckOpts = {
      overrides: wl?.week_overrides as RecheckOpts["overrides"],
      weightLossEnabled: wl?.enabled === true,
    };

    // Reading the open log is the only per-client I/O, and it is cheap. Do it
    // before the decision rather than lazily inside it: the decision stays pure.
    const since = daysSinceLastOpen(await readAppOpens(clientId));
    const phone = asStr(c.mobile_number);
    const last = await getLastSentAtAction(clientId, TEMPLATE).catch(() => ({
      sentAt: null as string | null,
    }));

    const decision = graduationNoticeDecision({
      todayYmd: today,
      appMode: {
        maintenance_status: asStr(c.maintenance_status) || null,
        maintenance_paid_through: asYmd(c.maintenance_paid_through),
        plan,
        recheckOpts,
      },
      hasPhone: phone.trim().length > 0,
      daysSinceLastOpen: since,
      lastSentAt: last.sentAt,
    });

    if (!decision.send) {
      // Only worth recording the near-misses — a roster of ACTIVE clients is
      // noise, and this log is read when someone asks "why wasn't X told?".
      if (decision.graduatedOn) skipped.push({ clientId, reason: decision.reason });
      continue;
    }

    const name = asStr(c.display_name) || clientId;
    due.push({
      clientId,
      name,
      firstName: (name.split(" ")[0] || "there").trim(),
      phone: phone.trim(),
      graduatedOn: decision.graduatedOn as string,
    });
  }

  if (!apply) {
    console.log(`[cron graduation-notice] dry run · due=${due.length} skipped=${skipped.length}`);
    return NextResponse.json({
      ok: true,
      applied: false,
      due: due.map((d) => ({ client_id: d.clientId, graduated_on: d.graduatedOn })),
      skipped,
    });
  }

  const sent: string[] = [];
  const failed: Array<{ client_id: string; error: string }> = [];

  for (const cand of due) {
    const r = await sendAndRecordOutboundAction({
      phone: cand.phone,
      clientId: cand.clientId,
      templateName: TEMPLATE,
      templateParams: [cand.firstName],
      renderedBody: renderGraduationNotice(cand.firstName),
      opts: { name: cand.name },
    });
    if (r.ok) {
      sent.push(cand.clientId);
      console.log(
        `[cron graduation-notice] SENT ${cand.clientId} (${cand.name}) · graduated ${cand.graduatedOn}`,
      );
    } else {
      // Nothing was recorded, so tomorrow's pass retries this client. That is
      // the intended behaviour while the template awaits Meta approval.
      failed.push({ client_id: cand.clientId, error: r.error || "send failed" });
      console.error(`[cron graduation-notice] FAILED ${cand.clientId}: ${r.error}`);
    }
  }

  // A quiet day still logs: silence here is indistinguishable from the cron
  // not running, which is the exact failure this feature exists to fix.
  console.log(
    `[cron graduation-notice] scanned=${clients.length} due=${due.length} ` +
      `sent=${sent.length} failed=${failed.length}`,
  );

  return NextResponse.json({
    ok: true,
    applied: true,
    scanned: clients.length,
    due: due.length,
    sent,
    failed,
    skipped,
  });
}
