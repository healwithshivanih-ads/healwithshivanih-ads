/**
 * POST /api/cal-com-webhook  —  slice 2 receiver
 *
 * fm-coach is a DOWNSTREAM subscriber, not a parallel cal.com webhook.
 * The cal.com → fm-coach data flow is:
 *
 *   cal.com  →  whatsapp-server-shivani.fly.dev/webhooks/cal-com
 *               (the SOLE cal.com subscriber; owns matching + dedup +
 *                appointments table + reminder scheduling)
 *                         ↓
 *               WA server forwards a resolved booking event to fm-coach
 *               via this endpoint, signed with WHATSAPP_WEBHOOK_SECRET
 *               (mirrors the existing forwardInbound pattern).
 *
 * Why this shape instead of subscribing fm-coach directly to cal.com:
 *  - Single source of truth for `appointments` (WA server's Postgres).
 *  - One matcher handles "client booked with a different phone".
 *  - Cancellation / reschedule consistency: WA server marks the row
 *    and skips reminders in one place.
 *
 * See ~/.claude/projects/-Users-shivani-code-healwithshivanih-ads/
 *     memory/project_calcom_integration.md  (slice 2 design).
 *
 * Expected payload (sent by WA server's forwardBookingToFmCoach()):
 *   {
 *     "type": "booking_created" | "booking_rescheduled" | "booking_cancelled",
 *     "booking": {
 *       "uid":         "cal.com booking uid (stable across reschedules)",
 *       "external_id": "cal_com:<uid>",
 *       "appointment_id": "<wa-server-uuid>",   // optional, for cross-system correlation
 *       "event_slug":  "programme-intake-session",
 *       "event_title": "Programme Intake Session",
 *       "start_time":  "ISO8601",
 *       "end_time":    "ISO8601",
 *       "status":      "confirmed" | "cancelled" | "rescheduled",
 *       "title":       "Programme Intake Session between Shivani and …"
 *     },
 *     "attendee": {
 *       "email": "...",
 *       "phone": "...",
 *       "name":  "..."
 *     }
 *   }
 *
 * fm-coach matches the attendee to its own client_id by email-then-phone
 * (fm-coach's clients have their own identifiers; the WA server's contact
 * IDs are separate). Unmatched events land in _calcom_unmatched.yaml for
 * coach to review.
 *
 * Signature: HMAC-SHA256(raw body, WHATSAPP_WEBHOOK_SECRET), passed in
 * `X-WhatsApp-Signature-256` header (same name as the WA-server forwarder
 * uses for inbound messages — keeps one secret, one verification path).
 *
 * Idempotency: keyed on `booking.uid`. A second event for the same uid
 * REPLACES the prior current-state row in the per-client list. The full
 * event history stays appended for audit; the dashboard's loader
 * (loadUpcomingBookings) collapses by uid at read time.
 */
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";

export const dynamic = "force-dynamic";

interface SliceTwoPayload {
  type?: "booking_created" | "booking_rescheduled" | "booking_cancelled";
  booking?: {
    uid?: string;
    external_id?: string;
    appointment_id?: string;
    event_slug?: string;
    event_title?: string;
    start_time?: string;
    end_time?: string;
    status?: string;
    title?: string;
  };
  attendee?: {
    email?: string;
    phone?: string;
    name?: string;
  };
}

interface StoredBooking {
  /** When fm-coach received this event. Drives the unread chip. */
  received_at: string;
  /** booking_created | booking_rescheduled | booking_cancelled */
  type: string;
  uid: string;
  external_id?: string;
  appointment_id?: string;
  start_time?: string;
  end_time?: string;
  event_slug?: string;
  event_title?: string;
  attendee_email?: string;
  attendee_phone?: string;
  attendee_name?: string;
  /** Which fm-coach client field resolved the match. */
  matched_by?: "email" | "phone" | null;
}

const BOOKINGS_FILE_NAME = "_calcom_bookings.yaml";

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

interface BookingsFile {
  [clientId: string]: StoredBooking[];
}

async function readBookingsFile(): Promise<BookingsFile> {
  const root = getPlansRoot();
  try {
    const raw = await fs.readFile(path.join(root, BOOKINGS_FILE_NAME), "utf-8");
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as BookingsFile;
    }
  } catch {
    /* ENOENT or invalid YAML → empty */
  }
  return {};
}

async function writeBookingsFile(data: BookingsFile): Promise<void> {
  const root = getPlansRoot();
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, BOOKINGS_FILE_NAME),
    yaml.dump(data, { sortKeys: true }),
    "utf-8",
  );
}

async function appendUnmatched(evt: SliceTwoPayload): Promise<void> {
  const root = getPlansRoot();
  const file = path.join(root, "_calcom_unmatched.yaml");
  let arr: unknown[] = [];
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed)) arr = parsed;
  } catch { /* missing */ }
  arr.push({
    received_at: new Date().toISOString(),
    type: evt.type,
    uid: evt.booking?.uid,
    attendee_email: evt.attendee?.email,
    attendee_phone: evt.attendee?.phone,
    attendee_name: evt.attendee?.name,
    event_slug: evt.booking?.event_slug,
    start_time: evt.booking?.start_time,
    note: "no fm-coach client matched on email or phone — review and update client.yaml if needed",
  });
  await fs.writeFile(file, yaml.dump(arr), "utf-8");
}

function normalisePhone(p: string | undefined | null): string {
  return (p ?? "").replace(/\D/g, "").slice(-10);
}

async function matchClient(
  email: string | undefined,
  phone: string | undefined,
): Promise<{ clientId: string; matchedBy: "email" | "phone" } | null> {
  const { loadAllClients } = await import("@/lib/fmdb/loader");
  const clients = await loadAllClients();
  const e = (email ?? "").trim().toLowerCase();
  const p = normalisePhone(phone);
  if (e) {
    for (const c of clients as Array<Record<string, unknown>>) {
      const cid = c.client_id as string | undefined;
      if (!cid) continue;
      const ce = ((c.email as string | undefined) ?? "").trim().toLowerCase();
      if (ce && ce === e) return { clientId: cid, matchedBy: "email" };
    }
  }
  if (p) {
    for (const c of clients as Array<Record<string, unknown>>) {
      const cid = c.client_id as string | undefined;
      if (!cid) continue;
      const cp = normalisePhone(c.mobile_number as string | undefined);
      if (cp && cp === p) return { clientId: cid, matchedBy: "phone" };
    }
  }
  return null;
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-whatsapp-signature-256");
    if (!verifySignature(rawBody, sig, secret)) {
      console.warn("[cal-com-webhook] invalid signature");
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }
  }

  let body: SliceTwoPayload = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const type = body.type;
  const booking = body.booking;

  if (!type || !booking?.uid) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  // Always 2xx after this point so the WA server's forwarder doesn't retry.
  // fm-coach matches the attendee to its own client_id (the WA server's
  // contact ID is irrelevant — separate identifier space).
  const match = await matchClient(body.attendee?.email, body.attendee?.phone);
  if (!match) {
    await appendUnmatched(body).catch(() => { /* best-effort */ });
    return NextResponse.json({ ok: true, matched: false });
  }

  const evt: StoredBooking = {
    received_at: new Date().toISOString(),
    type,
    uid: booking.uid,
    external_id: booking.external_id,
    appointment_id: booking.appointment_id,
    start_time: booking.start_time,
    end_time: booking.end_time,
    event_slug: booking.event_slug,
    event_title: booking.event_title,
    attendee_email: body.attendee?.email,
    attendee_phone: body.attendee?.phone,
    attendee_name: body.attendee?.name,
    matched_by: match.matchedBy,
  };

  const data = await readBookingsFile();
  const list = data[match.clientId] ?? [];
  list.unshift(evt);
  // Cap per-client history at 50 events. loadUpcomingBookings collapses
  // by uid at read time, so this only ever caps audit depth, not the
  // current-state view.
  data[match.clientId] = list.slice(0, 50);
  await writeBookingsFile(data);

  return NextResponse.json({
    ok: true,
    matched: true,
    client_id: match.clientId,
    matched_by: match.matchedBy,
    type,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "fm-coach booking-event subscriber (slice 2)",
    contract: {
      method: "POST",
      auth: "X-WhatsApp-Signature-256 = HMAC-SHA256(rawBody, WHATSAPP_WEBHOOK_SECRET)",
      sent_by: "whatsapp-server-shivani's forwardBookingToFmCoach()",
      payload_schema: {
        type: "booking_created | booking_rescheduled | booking_cancelled",
        booking: "{ uid, external_id, appointment_id, start_time, end_time, event_slug, event_title, status, title }",
        attendee: "{ email, phone, name } — fm-coach matches against client.yaml email then mobile_number",
      },
    },
    storage: "~/fm-plans/_calcom_bookings.yaml (+ _calcom_unmatched.yaml for fm_client_id=null)",
    note:
      "fm-coach does NOT subscribe to cal.com directly. The WA server owns cal.com handling " +
      "(matching, dedup, reminders) and forwards resolved booking events here. See " +
      "project_calcom_integration.md slice 2.",
  });
}
