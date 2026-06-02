/**
 * POST /api/cron/appointment-reminders — morning-of session reminder to clients.
 *
 * Fired daily at 09:00 IST by scripts/cron-runner.js.
 *
 * For each upcoming booking TODAY that hasn't already been reminded:
 *   - Sends `appt_confirmation` WhatsApp template (name, date, time, session type)
 *   - If a join_url is on the booking, appends it to the message text
 *   - Marks `reminder_sent_at` on the booking row (idempotent — same call
 *     same day is a no-op for already-reminded rows)
 *   - Skips cancelled bookings, already-past sessions, and sessions starting
 *     in < 30 min (no point reminding seconds before)
 *
 * Uses the `appt_confirmation` Meta-approved template (4 params):
 *   {{1}} firstName  {{2}} dateStr  {{3}} timeStr  {{4}} sessionType
 *
 * Auth: x-cron-secret header must match CRON_SECRET env — same pattern
 * as all other /api/cron/* routes.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { sendAndRecordOutboundAction } from "@/app/api/whatsapp/actions";

export const dynamic = "force-dynamic";

const IST_TZ = "Asia/Kolkata";
const TEMPLATE_NAME = "appt_confirmation";
/** Don't send reminders for sessions starting within this many minutes. */
const MIN_MINUTES_BEFORE = 30;

// ── Types mirrored from cal-com-webhook/route.ts ────────────────────────────
interface StoredBooking {
  received_at: string;
  type: string;
  uid: string;
  start_time?: string;
  end_time?: string;
  event_slug?: string;
  event_title?: string;
  attendee_email?: string;
  attendee_phone?: string;
  attendee_name?: string;
  matched_by?: "email" | "phone" | null;
  source: "slice2" | "calcom_direct";
  location?: string | null;
  join_url?: string | null;
  /** Set by this cron once the reminder has fired — prevents re-send. */
  reminder_sent_at?: string;
}

type BookingsFile = Record<string, StoredBooking[]>;

async function readBookingsFile(): Promise<BookingsFile> {
  const root = getPlansRoot();
  try {
    const raw = await fs.readFile(path.join(root, "_calcom_bookings.yaml"), "utf-8");
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as BookingsFile;
    }
  } catch { /* ENOENT or bad YAML */ }
  return {};
}

async function writeBookingsFile(data: BookingsFile): Promise<void> {
  const root = getPlansRoot();
  await fs.writeFile(
    path.join(root, "_calcom_bookings.yaml"),
    yaml.dump(data, { sortKeys: true }),
    "utf-8",
  );
}

/** Returns "2026-06-01" in IST for any UTC ISO string. */
function toISTDate(isoUtc: string): string {
  try {
    return new Date(isoUtc).toLocaleDateString("sv-SE", { timeZone: IST_TZ });
  } catch {
    return "";
  }
}

/** Today's date in IST as "YYYY-MM-DD". */
function todayIST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: IST_TZ });
}

/** Dedup bookings by uid — for each uid keep the latest received_at. */
function dedupByUid(bookings: StoredBooking[]): StoredBooking[] {
  const map = new Map<string, StoredBooking>();
  for (const b of bookings) {
    const prev = map.get(b.uid);
    if (!prev || b.received_at > prev.received_at) map.set(b.uid, b);
  }
  return Array.from(map.values());
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const nowMs = Date.now();
  const today = todayIST();
  const data = await readBookingsFile();

  type ReminderResult = { clientId: string; uid: string; attendee?: string; error?: string };
  const sent: ReminderResult[] = [];
  const skipped: Array<{ clientId: string; uid: string; reason: string }> = [];
  const failed: Array<{ clientId: string; uid: string; error: string }> = [];

  // We'll collect mutations and write once at the end.
  const mutations: Array<{ clientId: string; uid: string; sentAt: string }> = [];

  for (const [clientId, rawBookings] of Object.entries(data)) {
    const bookings = dedupByUid(rawBookings);

    for (const booking of bookings) {
      const uid = booking.uid;

      // Skip cancellations
      if (booking.type === "booking_cancelled") {
        skipped.push({ clientId, uid, reason: "cancelled" });
        continue;
      }

      // Must have a start_time
      if (!booking.start_time) {
        skipped.push({ clientId, uid, reason: "no_start_time" });
        continue;
      }

      // Must be TODAY in IST
      const bookingDate = toISTDate(booking.start_time);
      if (bookingDate !== today) {
        // Not today — silently skip (most bookings won't be today)
        continue;
      }

      // Must still be in the future with at least MIN_MINUTES_BEFORE minutes to go
      const startMs = Date.parse(booking.start_time);
      if (Number.isNaN(startMs)) {
        skipped.push({ clientId, uid, reason: "unparseable_start_time" });
        continue;
      }
      const minutesUntil = (startMs - nowMs) / 60_000;
      if (minutesUntil < MIN_MINUTES_BEFORE) {
        skipped.push({ clientId, uid, reason: `too_soon (${Math.round(minutesUntil)}min away)` });
        continue;
      }

      // Already reminded?
      if (booking.reminder_sent_at) {
        skipped.push({ clientId, uid, reason: `already_reminded_at_${booking.reminder_sent_at}` });
        continue;
      }

      // Get client mobile number
      let mobile: string | undefined;
      let displayName: string | undefined;
      try {
        const yamlPath = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
        const raw = await fs.readFile(yamlPath, "utf-8");
        const c = yaml.load(raw) as Record<string, unknown>;
        mobile = ((c.mobile_number as string | undefined) || (c.mobile as string | undefined) || "").trim() || undefined;
        displayName = (c.display_name as string | undefined) || undefined;
      } catch {
        skipped.push({ clientId, uid, reason: "client_yaml_not_found" });
        continue;
      }

      if (!mobile) {
        skipped.push({ clientId, uid, reason: "no_mobile_number" });
        continue;
      }

      // Build template params
      const firstName = (displayName || booking.attendee_name || "there").split(" ")[0];
      const startDate = new Date(booking.start_time);
      const dateStr = startDate.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: IST_TZ,
      });
      const timeStr = startDate.toLocaleTimeString("en-IN", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: IST_TZ,
      }) + " IST";
      const sessionType = booking.event_slug?.replace(/-/g, " ") ||
        booking.event_title?.replace(/between.*/i, "").trim() ||
        "coaching";

      // Rendered body mirrors the appt_confirmation approved template body.
      // If we have a join URL, append it so the client can tap it directly.
      const joinLine = booking.join_url
        ? `\n\nJoin: ${booking.join_url}`
        : "\n\nCal.com will have sent you the calendar invite with the join link.";
      const renderedBody =
        `Hi ${firstName} ✅ Just a reminder — your ${sessionType} session ` +
        `is today at ${timeStr}. Looking forward to it!` +
        joinLine +
        `\n\n— Shivani`;

      const r = await sendAndRecordOutboundAction({
        phone: mobile,
        clientId,
        templateName: TEMPLATE_NAME,
        templateParams: [firstName, dateStr, timeStr, sessionType],
        renderedBody,
        opts: { name: displayName || firstName },
      });

      const sentAt = new Date().toISOString();
      if (r.ok) {
        sent.push({ clientId, uid, attendee: displayName || booking.attendee_name });
        mutations.push({ clientId, uid, sentAt });
      } else {
        failed.push({ clientId, uid, error: r.error || "send_failed" });
      }
    }
  }

  // Persist reminder_sent_at on every sent row
  if (mutations.length > 0) {
    const freshData = await readBookingsFile();
    for (const { clientId, uid, sentAt } of mutations) {
      const list = freshData[clientId];
      if (!list) continue;
      for (const b of list) {
        if (b.uid === uid) b.reminder_sent_at = sentAt;
      }
    }
    await writeBookingsFile(freshData).catch((e) =>
      console.error("[appointment-reminders] failed to persist reminder_sent_at:", e.message),
    );
  }

  return NextResponse.json({
    ok: true,
    today,
    sent: sent.length,
    skipped: skipped.length,
    failed: failed.length,
    detail: { sent, skipped, failed },
  });
}
