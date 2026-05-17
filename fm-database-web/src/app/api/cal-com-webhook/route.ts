/**
 * POST /api/cal-com-webhook
 *
 * Receives cal.com booking events directly (parallel to the existing
 * whatsapp-server-shivani.fly.dev/webhooks/cal-com subscription —
 * cal.com supports multiple webhook URLs per event). fm-coach owns its
 * own copy of booking events so the unread-activity badge on each
 * client card can light up the "bookings" bucket without cross-app
 * coupling to the WhatsApp server.
 *
 * Cal.com sends payloads like:
 *   {
 *     "triggerEvent": "BOOKING_CREATED" | "BOOKING_RESCHEDULED" |
 *                     "BOOKING_CANCELLED" | "BOOKING_CANCELED",
 *     "createdAt": "2026-05-17T...",
 *     "payload": {
 *       "attendees": [{ "email": "...", "name": "...", "phone"?: "..." }],
 *       "startTime": "...",
 *       "endTime": "...",
 *       "eventType": { "slug": "...", "title": "..." },
 *       ...
 *     }
 *   }
 *
 * Signature: HMAC-SHA256 of the raw body with CAL_COM_SIGNING_SECRET,
 * passed via `X-Cal-Signature-256` header. If the secret env var is
 * unset we skip verification (development). If set and the signature
 * fails we 401.
 *
 * On success we append to ~/fm-plans/_calcom_bookings.yaml, keyed by
 * client_id (matched on email first, then phone). The aggregator in
 * loader-extras.ts reads this file to surface the unread chip.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadAllClients } from "@/lib/fmdb/loader";

export const dynamic = "force-dynamic";

interface CalAttendee {
  email?: string;
  phoneNumber?: string;
  name?: string;
}
interface CalPayload {
  attendees?: CalAttendee[];
  startTime?: string;
  endTime?: string;
  uid?: string;
  eventType?: { slug?: string; title?: string };
  eventTypeId?: number;
  status?: string;
}
interface CalEvent {
  triggerEvent?: string;
  createdAt?: string;
  payload?: CalPayload;
}

interface StoredBooking {
  /** ISO timestamp of when this event landed in fm-coach. Drives unread. */
  received_at: string;
  /** Cal.com's `createdAt`. */
  cal_created_at?: string;
  trigger_event: string;
  start_time?: string;
  end_time?: string;
  event_slug?: string;
  event_title?: string;
  attendee_email?: string;
  attendee_phone?: string;
  uid?: string;
}

const BOOKINGS_FILE_NAME = "_calcom_bookings.yaml";

function verifyCalSignature(rawBody: string, header: string, secret: string): boolean {
  if (!secret || !header) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    // Tolerate `sha256=` prefix though cal.com normally sends raw hex.
    const got = header.replace(/^sha256=/, "").trim().toLowerCase();
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(got, "hex"));
  } catch {
    return false;
  }
}

function normalisePhone(p: string | undefined | null): string {
  return (p ?? "").replace(/\D/g, "").slice(-10);
}

async function matchClient(
  email: string | undefined,
  phone: string | undefined,
): Promise<string | null> {
  const clients = await loadAllClients();
  const e = (email ?? "").trim().toLowerCase();
  const p = normalisePhone(phone);

  for (const c of clients as Array<Record<string, unknown>>) {
    const cid = c.client_id as string | undefined;
    if (!cid) continue;
    const ce = ((c.email as string | undefined) ?? "").trim().toLowerCase();
    if (e && ce && e === ce) return cid;
  }
  if (p) {
    for (const c of clients as Array<Record<string, unknown>>) {
      const cid = c.client_id as string | undefined;
      if (!cid) continue;
      const cp = normalisePhone(c.mobile_number as string | undefined);
      if (cp && cp === p) return cid;
    }
  }
  return null;
}

interface BookingsFile {
  /** client_id → most-recent-first list of booking events for that client. */
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

export async function POST(req: Request) {
  const rawBody = await req.text();

  const secret = process.env.CAL_COM_SIGNING_SECRET || "";
  if (secret) {
    const sig = req.headers.get("x-cal-signature-256") ?? "";
    if (!verifyCalSignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  let body: CalEvent = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const trigger = (body.triggerEvent || "").toUpperCase();
  const payload = body.payload || {};
  const attendee = payload.attendees?.[0];

  // Always 200 OK after verification so cal.com doesn't retry; do the
  // matching + persistence inline since it's quick (one YAML read+write).
  const clientId = await matchClient(attendee?.email, attendee?.phoneNumber);
  if (!clientId) {
    // Log to an unmatched bucket so coach can review. Same pattern as
    // _aisensy_unmatched.yaml.
    try {
      const root = getPlansRoot();
      const unmatchedFile = path.join(root, "_calcom_unmatched.yaml");
      let arr: unknown[] = [];
      try {
        const raw = await fs.readFile(unmatchedFile, "utf-8");
        const parsed = yaml.load(raw);
        if (Array.isArray(parsed)) arr = parsed;
      } catch { /* missing file */ }
      arr.push({
        received_at: new Date().toISOString(),
        trigger_event: trigger,
        attendee_email: attendee?.email,
        attendee_phone: attendee?.phoneNumber,
        attendee_name: attendee?.name,
        event_slug: payload.eventType?.slug,
        start_time: payload.startTime,
      });
      await fs.writeFile(unmatchedFile, yaml.dump(arr), "utf-8");
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, matched: false });
  }

  const evt: StoredBooking = {
    received_at: new Date().toISOString(),
    cal_created_at: body.createdAt,
    trigger_event: trigger,
    start_time: payload.startTime,
    end_time: payload.endTime,
    event_slug: payload.eventType?.slug,
    event_title: payload.eventType?.title,
    attendee_email: attendee?.email,
    attendee_phone: attendee?.phoneNumber,
    uid: payload.uid,
  };

  const data = await readBookingsFile();
  const list = data[clientId] ?? [];
  list.unshift(evt);
  // Cap per-client history at 50 — keeps the file bounded.
  data[clientId] = list.slice(0, 50);
  await writeBookingsFile(data);

  return NextResponse.json({ ok: true, matched: true, client_id: clientId });
}

export async function GET() {
  // Setup verification endpoint — pasting the URL into cal.com's dashboard
  // and hitting it from a browser returns this status page.
  return NextResponse.json({
    ok: true,
    service: "fm-coach cal.com webhook receiver",
    setup:
      "Paste this URL into cal.com → Settings → Developer → Webhooks. " +
      "Set CAL_COM_SIGNING_SECRET in .env.local to enable HMAC verification.",
    accepts: ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED", "BOOKING_CANCELED"],
    storage: "~/fm-plans/_calcom_bookings.yaml (+ _calcom_unmatched.yaml for unknown attendees)",
  });
}
