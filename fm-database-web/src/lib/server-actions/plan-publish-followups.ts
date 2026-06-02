"use server";

/**
 * Plan-publish follow-up sends.
 *
 * After a coach publishes a plan and the email letter goes out, fm-coach
 * fires two WhatsApp templates so clients don't have to dig through the
 * email:
 *
 *   1. fm_plan_letter_link_v1  — IMMEDIATE
 *      Phone-friendly link to the consolidated HTML letter
 *      (/letter/<token>). Sent right after publish.
 *
 *   2. fm_supplement_order_v1  — DELAYED (+6h, with 9am IST floor)
 *      Link to /supplements/<planSlug> so the client can order the
 *      supplements separately without scrolling through the long email.
 *
 * Why the floor: +6h after a published-at-evening plan would land
 * around midnight. Clients shouldn't get nudges at 2am. The floor
 * snaps any "would land before 9am IST" send forward to 9am IST.
 *
 * Storage of pending sends: ~/fm-plans/_pending_sends.yaml — array of
 * {id, send_at, kind, client_id, plan_slug, phone, template_name,
 *  template_params}. The cron sidecar reads this every minute, fires
 * any rows with send_at <= now, and removes them on success.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { ensureLetterToken } from "./letter-token";
import { sendWhatsAppAction } from "@/app/api/whatsapp/actions";

const PENDING_FILE = "_pending_sends.yaml";

interface PendingSend {
  id: string;
  send_at: string; // ISO
  kind: "plan_letter_link" | "supplement_order" | "no_join_check" | "appt_reminder_1h" | string;
  client_id: string;
  plan_slug: string;
  phone: string;
  name?: string;
  template_name: string;
  template_params: string[];
  /** For templates with a URL CTA button (e.g. appt_reminder_1h_zoom_client),
   *  the dynamic suffix appended to the button's base URL — e.g. the Zoom
   *  meeting ID + password string "85123456789?pwd=abc". */
  button_url_param?: string;
  created_at: string;
}

function publicOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com")
    .replace(/\/$/, "");
}

function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] || displayName || "there";
}

/**
 * 9am IST floor. If the candidate send time is at any earlier time
 * (in any tz, expressed as UTC) than the upcoming 9am-IST window, snap
 * forward. We treat 9am IST as 03:30 UTC.
 */
function applyIstFloor(candidate: Date): Date {
  const c = new Date(candidate);
  // 9am IST == 03:30 UTC. If c is in the wee hours (UTC < 03:30) on
  // the same UTC day, snap to 03:30 UTC the same day. Otherwise snap
  // to 03:30 UTC tomorrow only if c lands BEFORE 03:30 UTC tomorrow
  // AND after 18:30 UTC today (= after midnight IST = 24:00 IST).
  const utcHour = c.getUTCHours();
  const utcMin = c.getUTCMinutes();
  const minutes = utcHour * 60 + utcMin;
  const FLOOR = 3 * 60 + 30; // 03:30 UTC = 9:00 IST
  const NIGHT_CUT = 18 * 60 + 30; // 18:30 UTC = 24:00 IST
  if (minutes >= FLOOR && minutes < NIGHT_CUT) {
    return c; // 9am-midnight IST → fine
  }
  // Otherwise snap to the next 9am IST.
  const snapped = new Date(c);
  if (minutes >= NIGHT_CUT) {
    snapped.setUTCDate(snapped.getUTCDate() + 1);
  }
  snapped.setUTCHours(3, 30, 0, 0);
  return snapped;
}

async function readPending(): Promise<PendingSend[]> {
  try {
    const raw = await fs.readFile(path.join(getPlansRoot(), PENDING_FILE), "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed)) return parsed as PendingSend[];
  } catch {
    /* missing → empty */
  }
  return [];
}

async function writePending(rows: PendingSend[]): Promise<void> {
  const root = getPlansRoot();
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, PENDING_FILE),
    yaml.dump(rows),
    "utf-8",
  );
}

async function queuePending(row: Omit<PendingSend, "id" | "created_at">): Promise<void> {
  const rows = await readPending();
  rows.push({
    ...row,
    id: crypto.randomBytes(6).toString("base64url"),
    created_at: new Date().toISOString(),
  });
  await writePending(rows);
}

/**
 * Fired by the plan-publish UI flow. Wraps:
 *   - letter-token generation
 *   - immediate template 1 send
 *   - +6h-with-IST-floor scheduling of template 2
 *
 * Returns a summary so the UI can toast. Failures are reported but
 * never throw — a botched WhatsApp send shouldn't block the publish.
 */
export async function firePlanPublishFollowups(input: {
  clientId: string;
  planSlug: string;
  displayName: string;
  phone: string;
}): Promise<{
  ok: boolean;
  letter_sent: boolean;
  supplement_queued: boolean;
  supplement_send_at?: string;
  errors: string[];
}> {
  const errors: string[] = [];
  const fname = firstName(input.displayName);

  const tokRes = await ensureLetterToken(input.planSlug);
  if (!tokRes.ok) {
    errors.push(`letter_token: ${tokRes.error}`);
    return { ok: false, letter_sent: false, supplement_queued: false, errors };
  }

  const origin = publicOrigin();
  const letterUrl = `${origin}/letter/${tokRes.token}`;
  const suppUrl = `${origin}/supplements/${input.planSlug}`;

  // Template 1: fire now.
  let letterSent = false;
  try {
    const res = await sendWhatsAppAction(
      input.phone,
      "fm_plan_letter_link_v1",
      [fname, letterUrl],
      { name: input.displayName },
    );
    if (res.ok) {
      letterSent = true;
      // Persist a thread record so the coach can see proof the plan-link
      // WhatsApp actually went out (durable rule
      // feedback-send-buttons-persist-state). Without this the publish
      // path was silent — no entry in the WA panel, no "last sent" timestamp
      // anywhere on the client page.
      try {
        const { recordOutboundMessageAction } = await import("@/app/api/whatsapp/actions");
        await recordOutboundMessageAction({
          clientId: input.clientId,
          templateName: "fm_plan_letter_link_v1",
          renderedBody: `Hi ${fname}, your plan is ready: ${letterUrl}\n\n— Shivani`,
        });
      } catch { /* best-effort */ }
    } else {
      errors.push(`letter_send: ${res.error || "send_failed"}`);
    }
  } catch (e) {
    errors.push(`letter_send_exception: ${(e as Error).message}`);
  }

  // Template 2: queue +6h with IST floor.
  const sixHoursOut = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const floored = applyIstFloor(sixHoursOut);
  try {
    await queuePending({
      send_at: floored.toISOString(),
      kind: "supplement_order",
      client_id: input.clientId,
      plan_slug: input.planSlug,
      phone: input.phone,
      name: input.displayName,
      template_name: "fm_supplement_order_v1",
      template_params: [fname, suppUrl],
    });
  } catch (e) {
    errors.push(`supplement_queue_exception: ${(e as Error).message}`);
    return {
      ok: letterSent,
      letter_sent: letterSent,
      supplement_queued: false,
      errors,
    };
  }

  return {
    ok: letterSent,
    letter_sent: letterSent,
    supplement_queued: true,
    supplement_send_at: floored.toISOString(),
    errors,
  };
}

/**
 * Cron tick — drains any pending rows whose send_at is in the past.
 * Idempotent enough: each row is removed before sending; if the send
 * fails the failure is logged but the row is not re-queued (manual
 * retry via the bookings log if needed). Keep behaviour predictable
 * over clever.
 */
export async function tickPendingSends(): Promise<{
  fired: number;
  failed: number;
  errors: Array<{ id: string; kind: string; error: string }>;
}> {
  const all = await readPending();
  const now = Date.now();
  const due: PendingSend[] = [];
  const keep: PendingSend[] = [];
  for (const r of all) {
    if (Date.parse(r.send_at) <= now) due.push(r);
    else keep.push(r);
  }
  if (due.length === 0) return { fired: 0, failed: 0, errors: [] };

  // Remove the due rows from disk BEFORE sending so a crash mid-loop
  // doesn't double-send. Failures get logged + appended to a sidecar
  // _pending_sends_failed.yaml for coach review.
  await writePending(keep);

  let fired = 0;
  let failed = 0;
  const errors: Array<{ id: string; kind: string; error: string }> = [];
  const failedRows: Array<PendingSend & { error: string; failed_at: string }> = [];

  for (const r of due) {
    try {
      const res = await sendWhatsAppAction(
        r.phone,
        r.template_name,
        r.template_params,
        { name: r.name ?? "", buttonUrlParam: r.button_url_param },
      );
      if (res.ok) {
        fired++;
        // Persist a thread record (durable rule:
        // feedback-send-buttons-persist-state). Cron-fired messages were
        // invisible in WA threads + had no per-client timestamp anywhere.
        try {
          const { recordOutboundMessageAction } = await import("@/app/api/whatsapp/actions");
          await recordOutboundMessageAction({
            clientId: r.client_id,
            templateName: r.template_name,
            renderedBody: `[${r.kind}] params=[${r.template_params.join(" | ")}]`,
          });
        } catch { /* best-effort */ }
      } else {
        failed++;
        errors.push({ id: r.id, kind: r.kind, error: res.error || "send_failed" });
        failedRows.push({ ...r, error: res.error || "send_failed", failed_at: new Date().toISOString() });
      }
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      errors.push({ id: r.id, kind: r.kind, error: msg });
      failedRows.push({ ...r, error: msg, failed_at: new Date().toISOString() });
    }
  }

  if (failedRows.length > 0) {
    const root = getPlansRoot();
    const file = path.join(root, "_pending_sends_failed.yaml");
    let prior: unknown[] = [];
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = yaml.load(raw);
      if (Array.isArray(parsed)) prior = parsed;
    } catch { /* missing */ }
    await fs.writeFile(file, yaml.dump([...prior, ...failedRows]), "utf-8");
  }

  return { fired, failed, errors };
}

// ── Appointment reminders ────────────────────────────────────────────────────
const IST_TZ_PF = "Asia/Kolkata";

/** Extract the Zoom meeting ID + password suffix from a join URL.
 *  e.g. "https://us06web.zoom.us/j/85123456789?pwd=abc" → "85123456789?pwd=abc"
 *  The WA server appends this to https://zoom.us/j/ in the template button URL. */
function extractZoomSuffix(joinUrl: string | null | undefined): string | null {
  if (!joinUrl) return null;
  const m = joinUrl.match(/zoom\.us\/j\/(.+)/i);
  return m ? m[1] : null;
}

/**
 * Queue a "haven't seen you on Zoom yet" probe for 5 minutes after a
 * booking starts.
 *
 * Uses `appt_noshow_probe_client` (2 params: firstName, sessionType) with
 * 3 quick-reply buttons: "Be there in 5" / "Be there in 15" / "Need to reschedule".
 *
 * Idempotent — deduped by booking uid.
 */
export async function queueNoJoinNudge(opts: {
  clientId: string;
  bookingUid: string;
  phone: string;
  name: string;
  startTimeIso: string;
  joinUrl?: string | null;
  sessionType?: string;
}): Promise<void> {
  const startMs = Date.parse(opts.startTimeIso);
  if (Number.isNaN(startMs)) return;

  const sendAt = new Date(startMs + 5 * 60 * 1000);

  const existing = await readPending();
  if (existing.some((r) => r.kind === "no_join_check" && r.plan_slug === opts.bookingUid)) return;

  const firstName = opts.name.split(/\s+/)[0] || "there";
  const sessionType = opts.sessionType || "Coaching Session";

  await queuePending({
    send_at: sendAt.toISOString(),
    kind: "no_join_check",
    client_id: opts.clientId,
    plan_slug: opts.bookingUid,
    phone: opts.phone,
    name: opts.name,
    template_name: "appt_noshow_probe_client",
    template_params: [firstName, sessionType],
    // No buttonUrlParam — appt_noshow_probe_client uses quick-reply buttons, not URL buttons
  });
}

/**
 * Queue a 1-hour-before Zoom session reminder.
 *
 * Uses `appt_reminder_1h_zoom_client` (3 params: firstName, timeStr, sessionType)
 * with a "Join Zoom" URL button. buttonUrlParam = the Zoom meeting ID suffix
 * extracted from join_url (e.g. "85123456789?pwd=abc").
 *
 * Falls back to `appt_reminder_2h` (4 params: name, date, time, sessionType)
 * when no Zoom join URL is available (phone / in-person sessions).
 *
 * Idempotent — deduped by booking uid.
 */
export async function queueOneHourReminder(opts: {
  clientId: string;
  bookingUid: string;
  phone: string;
  name: string;
  startTimeIso: string;
  joinUrl?: string | null;
  sessionType?: string;
}): Promise<void> {
  const startMs = Date.parse(opts.startTimeIso);
  if (Number.isNaN(startMs)) return;

  const sendAt = new Date(startMs - 60 * 60 * 1000); // T-1h
  // Don't queue if the reminder time has already passed
  if (sendAt.getTime() <= Date.now()) return;

  const existing = await readPending();
  if (existing.some((r) => r.kind === "appt_reminder_1h" && r.plan_slug === opts.bookingUid)) return;

  const firstName = opts.name.split(/\s+/)[0] || "there";
  const sessionType = opts.sessionType || "Coaching Session";
  const startDate = new Date(opts.startTimeIso);
  const timeStr =
    startDate.toLocaleTimeString("en-IN", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST_TZ_PF,
    }) + " IST";
  const dateStr = startDate.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: IST_TZ_PF,
  });

  const zoomSuffix = extractZoomSuffix(opts.joinUrl);

  if (zoomSuffix) {
    // appt_reminder_1h_zoom_client: {{1}} firstName, {{2}} timeStr, {{3}} sessionType
    // + URL button with buttonUrlParam = zoomSuffix
    await queuePending({
      send_at: sendAt.toISOString(),
      kind: "appt_reminder_1h",
      client_id: opts.clientId,
      plan_slug: opts.bookingUid,
      phone: opts.phone,
      name: opts.name,
      template_name: "appt_reminder_1h_zoom_client",
      template_params: [firstName, timeStr, sessionType],
      button_url_param: zoomSuffix,
    });
  } else {
    // appt_reminder_2h: {{1}} name, {{2}} date, {{3}} time, {{4}} sessionType
    // (no button — used for non-Zoom sessions)
    await queuePending({
      send_at: sendAt.toISOString(),
      kind: "appt_reminder_1h",
      client_id: opts.clientId,
      plan_slug: opts.bookingUid,
      phone: opts.phone,
      name: opts.name,
      template_name: "appt_reminder_2h",
      template_params: [firstName, dateStr, timeStr, sessionType],
    });
  }
}
