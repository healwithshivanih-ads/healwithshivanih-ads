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
import { queueNoJoinNudge, queueOneHourReminder } from "@/lib/server-actions/plan-publish-followups";

// ── Coach notification ──────────────────────────────────────────────────────
const IST_TZ = "Asia/Kolkata";

/**
 * Notify the coach on every booking event.
 *
 * Primary: `coach_booking_alert_v1` WhatsApp to COACH_NOTIFY_PHONE.
 *   Params: [eventVerb, clientName, sessionType, dateStr, timeStr]
 *
 * Fallback: Gmail to GMAIL_USER when WhatsApp is not configured or fails.
 */
async function notifyCoachOfBooking(opts: {
  clientId: string;
  attendeeName?: string | null;
  startTime?: string | null;
  eventTitle?: string | null;
  joinUrl?: string | null;
  eventType: string;
}) {
  let dateLabel = "unknown date";
  let timeLabel = "";
  if (opts.startTime) {
    try {
      const d = new Date(opts.startTime);
      dateLabel = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: IST_TZ });
      timeLabel = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST_TZ }) + " IST";
    } catch { /* leave defaults */ }
  }

  const eventVerb =
    opts.eventType === "booking_rescheduled" ? "rescheduled booking" :
    opts.eventType === "booking_cancelled" ? "cancellation" : "new booking";
  const clientName = opts.attendeeName || opts.clientId;
  const sessionType = opts.eventTitle?.replace(/between.*/i, "").trim() || "Coaching Session";

  // ── Primary: WhatsApp coach alert ──────────────────────────────────────
  const coachPhone = process.env.COACH_NOTIFY_PHONE;
  if (coachPhone) {
    try {
      const { sendWhatsAppAction } = await import("@/app/api/whatsapp/actions");
      const r = await sendWhatsAppAction(
        coachPhone,
        "coach_booking_alert_v1",
        [eventVerb, clientName, sessionType, dateLabel, timeLabel],
        { name: process.env.COACH_NAME || "Shivani" },
      );
      if (r.ok) {
        console.log(`[cal-com-webhook] coach WA alert sent: ${eventVerb} · ${clientName}`);
        return; // WA succeeded — skip email fallback
      }
      console.warn(`[cal-com-webhook] coach WA alert failed: ${r.error}`);
    } catch (e) {
      console.warn(`[cal-com-webhook] coach WA alert threw:`, (e as Error).message);
    }
  }

  // ── Fallback: Gmail email ───────────────────────────────────────────────
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return;

  const subject = `📅 Session ${eventVerb}: ${clientName} — ${dateLabel} at ${timeLabel}`;
  const joinLine = opts.joinUrl ? `\nJoin link: ${opts.joinUrl}` : "\n(No video link)";
  const text =
    `${clientName} — ${eventVerb}.\n\nClient ID: ${opts.clientId}\n` +
    `Session: ${sessionType}\nDate: ${dateLabel}\nTime: ${timeLabel}` +
    joinLine + `\n\n— fm-coach auto-notification`;

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({ service: "gmail", auth: { user, pass } });
  await transporter.sendMail({ from: user, to: user, subject, text });
  console.log(`[cal-com-webhook] coach email fallback sent: ${subject}`);
}

export const dynamic = "force-dynamic";

// ── Mode A (slice 2) payload ────────────────────────────────────────────────
interface SliceTwoPayload {
  type?: "booking_created" | "booking_rescheduled" | "booking_cancelled" | "booking_no_show";
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
    /** Location string (e.g. "Zoom" / "Daily" / "In person — Mumbai"). */
    location?: string | null;
    /** Direct join URL for video meetings. WA server forwards this when
     *  cal.com provides it on the BOOKING_CREATED / RESCHEDULED payload. */
    join_url?: string | null;
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
    /** Cal.com encodes location as either a string (URL or label) or
     *  an object {type|name, link|url|address}. See pickLocation(). */
    location?: string | { type?: string; name?: string; link?: string; url?: string; address?: string };
    meetingUrl?: string;
    metadata?: { videoCallUrl?: string };
  };
}

interface StoredBooking {
  received_at: string;
  /** booking_created | booking_rescheduled | booking_cancelled | booking_no_show */
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
  /** Location string (e.g. "Zoom" / "Daily" / "In person — Mumbai") or
   *  null if cal.com didn't provide one. Captured 2026-05-17 so the
   *  upcoming-bookings panel can render a "Join call →" button. */
  location?: string | null;
  /** Direct meeting join URL when location is a video integration. */
  join_url?: string | null;
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

/**
 * Send an immediate "you didn't join" WhatsApp when cal.com fires
 * BOOKING_NO_SHOW. Best-effort — never throws.
 *
 * Sends the dedicated `appt_noshow_probe_client` template (APPROVED on Meta).
 */
async function sendNoShowNudge(opts: {
  clientId: string;
  phone: string;
  name: string;
  startTime?: string | null;
  joinUrl?: string | null;
  eventTitle?: string | null;
}): Promise<void> {
  const { sendAndRecordOutboundAction } = await import("@/app/api/whatsapp/actions");
  const firstName = opts.name.split(/\s+/)[0] || "there";
  const startDate = opts.startTime ? new Date(opts.startTime) : new Date();
  const dateStr = startDate.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: IST_TZ,
  });
  const timeStr =
    startDate.toLocaleTimeString("en-IN", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST_TZ,
    }) + " IST";
  const joinLine = opts.joinUrl
    ? `Here's the link to join now: ${opts.joinUrl}`
    : "Check your email for the Zoom link.";
  const sessionType = opts.eventTitle?.replace(/between.*/i, "").trim() || "Coaching Session";
  const renderedBody =
    `Hi ${firstName}, just checking in — I haven't seen you on Zoom yet for our ` +
    `${sessionType} session. Running late, or need to move it? ` +
    (opts.joinUrl ? `\n\nJoin: ${opts.joinUrl}` : "");
  // appt_noshow_probe_client: {{1}} firstName, {{2}} sessionType
  // Has 3 quick-reply buttons: "Be there in 5", "Be there in 15", "Need to reschedule"
  await sendAndRecordOutboundAction({
    phone: opts.phone,
    clientId: opts.clientId,
    templateName: "appt_noshow_probe_client",
    templateParams: [firstName, sessionType],
    renderedBody,
    opts: { name: opts.name },
  });
  console.log(`[cal-com-webhook] no-show nudge sent to ${opts.clientId}`);
}

/** Append (or dedup-replace) a booking event into the file. */
async function storeBooking(clientId: string, evt: StoredBooking): Promise<void> {
  const data = await readBookingsFile();
  const list = (data[clientId] ?? []).filter((r) => r.uid !== evt.uid);
  list.unshift(evt);
  data[clientId] = list.slice(0, 50);
  await writeBookingsFile(data);
}

/** Mirrors whatsapp-server-shivani's pickLocation() in
 *  src/routes/webhooks/cal-com.js — cal.com encodes the meeting location
 *  inconsistently across integrations, so we accept string-or-object
 *  and try the common variants. */
function pickLocation(payload: NonNullable<CalDirectPayload["payload"]>): {
  location: string | null;
  joinUrl: string | null;
} {
  const loc = payload.location;
  const fallbackUrl = payload.meetingUrl || payload.metadata?.videoCallUrl || null;
  if (!loc) {
    return { location: null, joinUrl: fallbackUrl };
  }
  if (typeof loc === "string") {
    const isUrl = /^https?:\/\//i.test(loc);
    return isUrl
      ? { location: "video", joinUrl: loc }
      : { location: loc, joinUrl: fallbackUrl };
  }
  if (typeof loc === "object") {
    return {
      location: loc.type || loc.name || null,
      joinUrl: loc.link || loc.url || loc.address || fallbackUrl,
    };
  }
  return { location: null, joinUrl: fallbackUrl };
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
    BOOKING_NO_SHOW: "booking_no_show",
  };
  const type = typeMap[trigger];
  if (!type) return null;
  const p = body.payload ?? {};
  const uid = String(p.uid || p.bookingId || p.id || "");
  if (!uid) return null;
  const a = (p.attendees && p.attendees[0]) || {};
  const { location, joinUrl } = pickLocation(p);
  return {
    evt: {
      type,
      uid,
      external_id: `cal_com:${uid}`,
      start_time: p.startTime,
      end_time: p.endTime,
      event_slug: p.type || p.eventTypeSlug,
      event_title: p.title || p.eventTitle,
      location,
      join_url: joinUrl,
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
  } else {
    // Fail CLOSED (audit Phase-1b): no matching configured+verified secret →
    // reject. The previous "no secrets set → process unverified" branch let a
    // forged signature header through in production (booking spoofing).
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
      location: booking.location ?? null,
      join_url: booking.join_url ?? null,
      attendee_email: body.attendee?.email,
      attendee_phone: body.attendee?.phone,
      attendee_name: body.attendee?.name,
      matched_by: match.matchedBy,
    };
    await storeBooking(match.clientId, evt);

    if (body.type === "booking_created" || body.type === "booking_rescheduled") {
      // Notify coach immediately
      notifyCoachOfBooking({
        clientId: match.clientId,
        attendeeName: evt.attendee_name,
        startTime: evt.start_time,
        eventTitle: evt.event_title,
        joinUrl: evt.join_url,
        eventType: body.type,
      }).catch((e: Error) => console.error("[cal-com-webhook] coach notify failed:", e.message));
      // Queue 1h-before reminder + 5-min no-join nudge
      const clientPhone = evt.attendee_phone || body.attendee?.phone;
      const clientName = evt.attendee_name || body.attendee?.name || match.clientId;
      const sessionType = evt.event_title?.replace(/between.*/i, "").trim() || "Coaching Session";
      if (clientPhone && evt.start_time) {
        queueOneHourReminder({
          clientId: match.clientId,
          bookingUid: evt.uid,
          phone: clientPhone,
          name: clientName,
          startTimeIso: evt.start_time,
          joinUrl: evt.join_url,
          sessionType,
        }).catch((e: Error) => console.error("[cal-com-webhook] 1h reminder queue failed:", e.message));
        queueNoJoinNudge({
          clientId: match.clientId,
          bookingUid: evt.uid,
          phone: clientPhone,
          name: clientName,
          startTimeIso: evt.start_time,
          joinUrl: evt.join_url,
          sessionType,
        }).catch((e: Error) => console.error("[cal-com-webhook] no-join queue failed:", e.message));
      }
    }

    // BOOKING_NO_SHOW fired by cal.com — send immediate nudge
    if (body.type === "booking_no_show") {
      const clientPhone = evt.attendee_phone || body.attendee?.phone;
      if (clientPhone) {
        sendNoShowNudge({
          clientId: match.clientId,
          phone: clientPhone,
          name: evt.attendee_name || body.attendee?.name || match.clientId,
          startTime: evt.start_time,
          joinUrl: evt.join_url,
          eventTitle: evt.event_title,
        }).catch((e: Error) => console.error("[cal-com-webhook] no-show nudge failed:", e.message));
      }
    }

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

    if (converted.evt.type === "booking_created" || converted.evt.type === "booking_rescheduled") {
      // Notify coach immediately
      notifyCoachOfBooking({
        clientId: match.clientId,
        attendeeName: evt.attendee_name,
        startTime: evt.start_time,
        eventTitle: evt.event_title,
        joinUrl: evt.join_url,
        eventType: converted.evt.type,
      }).catch((e: Error) => console.error("[cal-com-webhook] coach notify failed:", e.message));
      // Queue 1h-before reminder + 5-min no-join nudge
      const clientPhone = evt.attendee_phone || converted.attendee.phone;
      const clientName = evt.attendee_name || converted.attendee.name || match.clientId;
      const sessionType = evt.event_title?.replace(/between.*/i, "").trim() || "Coaching Session";
      if (clientPhone && evt.start_time) {
        queueOneHourReminder({
          clientId: match.clientId,
          bookingUid: evt.uid,
          phone: clientPhone,
          name: clientName,
          startTimeIso: evt.start_time,
          joinUrl: evt.join_url,
          sessionType,
        }).catch((e: Error) => console.error("[cal-com-webhook] 1h reminder queue failed:", e.message));
        queueNoJoinNudge({
          clientId: match.clientId,
          bookingUid: evt.uid,
          phone: clientPhone,
          name: clientName,
          startTimeIso: evt.start_time,
          joinUrl: evt.join_url,
          sessionType,
        }).catch((e: Error) => console.error("[cal-com-webhook] no-join queue failed:", e.message));
      }
    }

    // BOOKING_NO_SHOW fired by cal.com — send immediate nudge
    if (converted.evt.type === "booking_no_show") {
      const clientPhone = evt.attendee_phone || converted.attendee.phone;
      if (clientPhone) {
        sendNoShowNudge({
          clientId: match.clientId,
          phone: clientPhone,
          name: evt.attendee_name || converted.attendee.name || match.clientId,
          startTime: evt.start_time,
          joinUrl: evt.join_url,
          eventTitle: evt.event_title,
        }).catch((e: Error) => console.error("[cal-com-webhook] no-show nudge failed:", e.message));
      }
    }

    return NextResponse.json({
      ok: true,
      matched: true,
      client_id: match.clientId,
      matched_by: match.matchedBy,
      type: converted.evt.type,
      mode: "calcom_direct",
    });
  }

  // Fall-through: the event was signature-VERIFIED but didn't match either
  // known payload shape. Persist it (so a real booking that deviates is never
  // silently lost — audit Phase-1b #5) and return 200 so cal.com doesn't retry
  // over the already-flaky pipe. The coach can recover it from _calcom_unmatched.
  try {
    await appendUnmatched({
      at: new Date().toISOString(),
      reason: "verified_but_unknown_shape",
      mode,
      raw: body as unknown as Record<string, unknown>,
    });
  } catch (e) {
    console.error("[cal-com-webhook] failed to persist unmatched verified event:", e);
  }
  return NextResponse.json({ ok: true, persisted: "unmatched_verified" }, { status: 200 });
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
