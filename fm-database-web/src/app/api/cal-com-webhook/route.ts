/**
 * POST /api/cal-com-webhook  —  dual-shape booking-event receiver
 *
 * Accepts TWO payload shapes / two signing-secret paths in parallel:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ Mode A — slice 2 (WA server forwarder)                          │
 *   │   Sent by whatsapp-server-shivani's forwardBookingToFmCoach()   │
 *   │   Header:  X-WhatsApp-Signature-256                             │
 *   │   Secret:  WHATSAPP_WEBHOOK_SECRET                              │
 *   │   Shape:   { type, booking, attendee }                          │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ Mode B — direct cal.com subscriber                              │
 *   │   Sent by cal.com when fm-coach is registered as a webhook URL  │
 *   │   Header:  X-Cal-Signature-256                                  │
 *   │   Secret:  CAL_COM_SIGNING_SECRET                               │
 *   │   Shape:   { triggerEvent, createdAt, payload: {...} }          │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Why both? Designed for slice 2 originally — Fly → Tailscale Funnel
 * to the Mac mini has an ECONNRESET issue (Fly bom egress can't TLS-
 * handshake into Tailscale Funnel reliably). Adding cal.com as a
 * second subscriber bypasses that hop entirely; the slice 2 forwarder
 * still tries and self-heals when the network is fixed. Dedup on
 * `booking.uid` keeps both pipes safe to fire in parallel — same
 * booking from both pipes = one stored row per uid (the slice 2 path
 * wins because its `received_at` is newer when slice 2 is healthy;
 * cal.com wins when slice 2 is broken).
 *
 * Signature priority:
 *   1. If X-WhatsApp-Signature-256 header present → verify with
 *      WHATSAPP_WEBHOOK_SECRET → treat as Mode A
 *   2. Else if X-Cal-Signature-256 present → verify with
 *      CAL_COM_SIGNING_SECRET → treat as Mode B
 *   3. Else: 401
 *
 * Storage: ~/fm-plans/_calcom_bookings.yaml, keyed by client_id, list
 * of events newest-first, capped at 50 per client. Dedup: if a row
 * with the same uid already exists for that client, the newer event
 * REPLACES it (the old one is removed from the list before unshift).
 * The dashboard's loadUpcomingBookings() further collapses by uid at
 * read time as a belt-and-braces safety.
 */
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";

export const dynamic = "force-dynamic";

// ── Mode A (slice 2) payload ────────────────────────────────────────────────
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

// ── Mode B (raw cal.com) payload ────────────────────────────────────────────
interface CalAttendee {
  email?: string;
  phoneNumber?: string;
  smsReminderNumber?: string;
  name?: string;
}
interface CalDirectPayload {
  triggerEvent?: string;
  createdAt?: string;
  payload?: {
    uid?: string;
    bookingId?: string | number;
    id?: string | number;
    startTime?: string;
    endTime?: string;
    title?: string;
    type?: string;
    eventTypeSlug?: string;
    eventTitle?: string;
    attendees?: CalAttendee[];
    responses?: { email?: string; phone?: string; name?: string };
  };
}

interface StoredBooking {
  received_at: string;
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
  matched_by?: "email" | "phone" | null;
  /** Which pipe delivered this row. Useful for debugging when one pipe
   *  is up and the other isn't. */
  source: "slice2" | "calcom_direct";
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

type BookingsFile = Record<string, StoredBooking[]>;

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

async function appendUnmatched(snapshot: Record<string, unknown>): Promise<void> {
  const root = getPlansRoot();
  const file = path.join(root, "_calcom_unmatched.yaml");
  let arr: unknown[] = [];
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed)) arr = parsed;
  } catch { /* missing */ }
  arr.push({ received_at: new Date().toISOString(), ...snapshot });
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

/** Append (or dedup-replace) a booking event into the file. */
async function storeBooking(clientId: string, evt: StoredBooking): Promise<void> {
  const data = await readBookingsFile();
  const list = (data[clientId] ?? []).filter((r) => r.uid !== evt.uid);
  list.unshift(evt);
  data[clientId] = list.slice(0, 50);
  await writeBookingsFile(data);
}

/** Convert a raw cal.com payload to the canonical StoredBooking shape. */
function fromCalcom(body: CalDirectPayload): {
  evt: Omit<StoredBooking, "received_at" | "source" | "matched_by">;
  attendee: { email?: string; phone?: string; name?: string };
} | null {
  const trigger = (body.triggerEvent || "").toUpperCase();
  const typeMap: Record<string, StoredBooking["type"]> = {
    BOOKING_CREATED: "booking_created",
    BOOKING_RESCHEDULED: "booking_rescheduled",
    BOOKING_CANCELLED: "booking_cancelled",
    BOOKING_CANCELED: "booking_cancelled",
  };
  const type = typeMap[trigger];
  if (!type) return null;
  const p = body.payload ?? {};
  const uid = String(p.uid || p.bookingId || p.id || "");
  if (!uid) return null;
  const a = (p.attendees && p.attendees[0]) || {};
  return {
    evt: {
      type,
      uid,
      external_id: `cal_com:${uid}`,
      start_time: p.startTime,
      end_time: p.endTime,
      event_slug: p.type || p.eventTypeSlug,
      event_title: p.title || p.eventTitle,
    },
    attendee: {
      email: a.email || p.responses?.email,
      phone: a.phoneNumber || a.smsReminderNumber || p.responses?.phone,
      name: a.name || p.responses?.name,
    },
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  // ── Auth: try slice 2 secret first, then cal.com direct ─────────────────
  const waSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const calSecret = process.env.CAL_COM_SIGNING_SECRET;
  const waSig = req.headers.get("x-whatsapp-signature-256");
  const calSig = req.headers.get("x-cal-signature-256");

  // Temporary diagnostic logging (cal.com ping debugging 2026-05-17).
  // Remove once both pipes are confirmed flowing in production.
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => { allHeaders[k] = v; });
  console.log("[cal-com-webhook] incoming", {
    has_wa_sig: !!waSig,
    has_cal_sig: !!calSig,
    body_len: rawBody.length,
    body_preview: rawBody.slice(0, 300),
    sig_headers: Object.keys(allHeaders).filter((k) => k.includes("signature")),
    user_agent: allHeaders["user-agent"] || "",
  });

  // Ping / health-check fast path: cal.com's "test webhook" button sends
  // an UNSIGNED POST and expects 2xx to mark the endpoint reachable. We
  // can't verify auth so we don't process the body — just return 200.
  // Real bookings always carry a signature and skip this branch.
  if (!waSig && !calSig) {
    return NextResponse.json({
      ok: true,
      ping_accepted: true,
      note: "no signature header — body not processed. real bookings must include X-Cal-Signature-256.",
    });
  }

  let mode: "slice2" | "calcom_direct" | null = null;
  if (waSecret && waSig) {
    if (!verifySignature(rawBody, waSig, waSecret)) {
      return NextResponse.json({ ok: false, error: "invalid_signature_slice2" }, { status: 401 });
    }
    mode = "slice2";
  } else if (calSecret && calSig) {
    if (!verifySignature(rawBody, calSig, calSecret)) {
      return NextResponse.json({ ok: false, error: "invalid_signature_calcom" }, { status: 401 });
    }
    mode = "calcom_direct";
  } else if (!waSecret && !calSecret) {
    // Dev: no secrets set but a signature header IS present. Allow but
    // skip verification — used in tests where we mock signatures.
    mode = waSig ? "slice2" : "calcom_direct";
  } else {
    return NextResponse.json({ ok: false, error: "no_matching_secret" }, { status: 401 });
  }

  let body: SliceTwoPayload & CalDirectPayload;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // ── Mode A: slice 2 (resolved shape) ────────────────────────────────────
  if (mode === "slice2" && body.type && body.booking?.uid) {
    const booking = body.booking;
    const match = await matchClient(body.attendee?.email, body.attendee?.phone);
    if (!match) {
      await appendUnmatched({
        mode: "slice2",
        type: body.type,
        uid: booking.uid,
        attendee_email: body.attendee?.email,
        attendee_phone: body.attendee?.phone,
        attendee_name: body.attendee?.name,
        event_slug: booking.event_slug,
        start_time: booking.start_time,
      }).catch(() => { /* best-effort */ });
      return NextResponse.json({ ok: true, matched: false, mode: "slice2" });
    }
    const evt: StoredBooking = {
      received_at: new Date().toISOString(),
      source: "slice2",
      type: body.type as string,
      uid: booking.uid as string,
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
    await storeBooking(match.clientId, evt);
    return NextResponse.json({
      ok: true,
      matched: true,
      client_id: match.clientId,
      matched_by: match.matchedBy,
      type: body.type,
      mode: "slice2",
    });
  }

  // ── Mode B: raw cal.com (parallel subscriber) ───────────────────────────
  if (mode === "calcom_direct" && body.triggerEvent) {
    const converted = fromCalcom(body);
    if (!converted) {
      return NextResponse.json({ ok: false, error: "unhandled_event_type" }, { status: 200 });
    }
    const match = await matchClient(converted.attendee.email, converted.attendee.phone);
    if (!match) {
      await appendUnmatched({
        mode: "calcom_direct",
        type: converted.evt.type,
        uid: converted.evt.uid,
        attendee_email: converted.attendee.email,
        attendee_phone: converted.attendee.phone,
        attendee_name: converted.attendee.name,
        event_slug: converted.evt.event_slug,
        start_time: converted.evt.start_time,
      }).catch(() => { /* best-effort */ });
      return NextResponse.json({ ok: true, matched: false, mode: "calcom_direct" });
    }
    const evt: StoredBooking = {
      received_at: new Date().toISOString(),
      source: "calcom_direct",
      ...converted.evt,
      attendee_email: converted.attendee.email,
      attendee_phone: converted.attendee.phone,
      attendee_name: converted.attendee.name,
      matched_by: match.matchedBy,
    };
    await storeBooking(match.clientId, evt);
    return NextResponse.json({
      ok: true,
      matched: true,
      client_id: match.clientId,
      matched_by: match.matchedBy,
      type: converted.evt.type,
      mode: "calcom_direct",
    });
  }

  return NextResponse.json({ ok: false, error: "missing_fields_or_unknown_mode" }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "fm-coach booking-event subscriber (dual-shape)",
    modes: {
      slice2: {
        sent_by: "whatsapp-server-shivani's forwardBookingToFmCoach()",
        header: "X-WhatsApp-Signature-256",
        secret: "WHATSAPP_WEBHOOK_SECRET",
        payload: "{ type, booking: {uid, …}, attendee: {email, phone, name} }",
      },
      calcom_direct: {
        sent_by: "cal.com directly (parallel subscriber, fallback for Fly→Funnel issues)",
        header: "X-Cal-Signature-256",
        secret: "CAL_COM_SIGNING_SECRET",
        payload: "{ triggerEvent, createdAt, payload: { uid, attendees: [...], … } }",
      },
    },
    storage:
      "~/fm-plans/_calcom_bookings.yaml (+ _calcom_unmatched.yaml). " +
      "Dedup on booking.uid — both pipes can fire safely; newer received_at wins.",
  });
}
