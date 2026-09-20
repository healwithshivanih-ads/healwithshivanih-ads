/**
 * A booking from someone who isn't in the database yet must CREATE the
 * client record and keep what they wrote on the booking form.
 *
 * The 2026-09-20 incident this pins: Rashmi N booked a Discovery Call on the
 * Wix site, typed four answers about her migraines, iron deficiency and sleep
 * into the booking form — and none of it reached the coaching database. The
 * booking was appended to _calcom_unmatched.yaml, where twelve earlier
 * bookings (four of them real leads) were already sitting unread.
 *
 * Runs against a real temp FMDB_PLANS_DIR and really shells out to
 * `fmdb client-new` — the Python wiring is exactly the part that breaks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildBookingNote,
  ensureClientForBooking,
  isFmBooking,
  type BookingLead,
} from "./booking-lead-intake";

let root: string;
let prevPlansDir: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "booking-lead-"));
  fs.mkdirSync(path.join(root, "clients"), { recursive: true });
  prevPlansDir = process.env.FMDB_PLANS_DIR;
  process.env.FMDB_PLANS_DIR = root;
});

afterEach(() => {
  if (prevPlansDir === undefined) delete process.env.FMDB_PLANS_DIR;
  else process.env.FMDB_PLANS_DIR = prevPlansDir;
  fs.rmSync(root, { recursive: true, force: true });
});

/** The real booking, as Wix sent it on 2026-09-20. */
const RASHMI: BookingLead = {
  uid: "e43ef28d-00c0-4249-bf52-dd547772f14e",
  name: "Rashmi N",
  email: "rushme1992@yahoo.co.in",
  phone: "+917069151092",
  eventSlug: "discovery-call",
  eventTitle: "Discovery Call",
  startTime: "2026-09-22T09:15:00Z",
  source: "wix",
  formFields: [
    { question: "What's the main health concern you'd like to work on?", answer: "Migraine, iron and vitamin deficiency, sleep" },
    { question: "How long have you been dealing with it?", answer: "1–3 years" },
    { question: "What have you already tried?", answer: "Doctors & tests, Medications, Supplements" },
    { question: "Real change is a commitment of time, effort and money. The 12-week programme is an investment of ₹85,000 (or ₹35,000 × 3). Where are you with that right now?", answer: "Yes, if it's the right fit" },
  ],
};

function readClient(clientId: string): Record<string, unknown> {
  const file = path.join(root, "clients", clientId, "client.yaml");
  return yaml.load(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
}

function readSessions(clientId: string): string[] {
  const dir = path.join(root, "clients", clientId, "sessions");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf-8"));
}

describe("isFmBooking", () => {
  it("accepts FM services by slug and by title", () => {
    expect(isFmBooking({ eventSlug: "discovery-call", eventTitle: "Discovery Call" })).toBe(true);
    expect(isFmBooking({ eventSlug: "15min", eventTitle: "15 min Discover call" })).toBe(true);
    expect(isFmBooking({ eventSlug: null, eventTitle: "Programme Intake Session" })).toBe(true);
  });

  it("rejects the pranic-healing services that share the same Wix site", () => {
    // These are a different business. They must never reach the coaching DB.
    expect(isFmBooking({ eventSlug: null, eventTitle: "Intuitive Healing with Senior Healer" })).toBe(false);
    expect(isFmBooking({ eventSlug: null, eventTitle: "Online Healing Session" })).toBe(false);
    expect(isFmBooking({ eventSlug: null, eventTitle: "Distance Healing" })).toBe(false);
    expect(isFmBooking({ eventSlug: null, eventTitle: "Family Constellation" })).toBe(false);
    expect(isFmBooking({ eventSlug: "facilitation-session", eventTitle: "Facilitation" })).toBe(false);
  });

  it("rejects an empty event", () => {
    expect(isFmBooking({ eventSlug: null, eventTitle: null })).toBe(false);
  });
});

describe("buildBookingNote", () => {
  it("keeps every answer verbatim", () => {
    const note = buildBookingNote(RASHMI);
    for (const f of RASHMI.formFields!) {
      expect(note).toContain(f.question);
      expect(note).toContain(f.answer);
    }
  });

  it("carries the booking uid so the note is self-identifying", () => {
    expect(buildBookingNote(RASHMI)).toContain(`[booking: ${RASHMI.uid}]`);
  });
});

describe("ensureClientForBooking", () => {
  it("creates the client record and saves the form answers", { timeout: 40000 }, async () => {
    const res = await ensureClientForBooking(RASHMI);

    expect(res.error).toBeUndefined();
    expect(res.created).toBe(true);
    expect(res.clientId).toMatch(/^cl-\d+$/);

    const client = readClient(res.clientId!);
    expect(client.display_name).toBe("Rashmi N");
    expect(client.email).toBe("rushme1992@yahoo.co.in");
    expect(String(client.mobile_number)).toContain("7069151092");
    // A booking is an enquiry, not a sign-up.
    expect(client.engagement_status).toBe("pending");
    expect(client.lead_source).toBe("wix_booking");

    expect(res.noteSaved).toBe(true);
    const sessions = readSessions(res.clientId!);
    expect(sessions.length).toBe(1);
    expect(sessions[0]).toContain("Migraine, iron and vitamin deficiency");
    expect(sessions[0]).toContain("booking_form");
  });

  it("does not write the same booking's note twice", { timeout: 40000 }, async () => {
    // Wix fires created → pending → confirmed for one booking.
    const first = await ensureClientForBooking(RASHMI);
    const second = await ensureClientForBooking(RASHMI);

    expect(second.clientId).toBe(first.clientId);
    expect(second.created).toBe(false);
    expect(second.skipped).toBe("already_noted");
    expect(readSessions(first.clientId!).length).toBe(1);
  });

  it("skips a pranic-healing booking entirely", async () => {
    const res = await ensureClientForBooking({
      ...RASHMI,
      uid: "pranic-1",
      eventSlug: null,
      eventTitle: "Intuitive Healing with Senior Healer",
    });
    expect(res.skipped).toBe("not_fm_service");
    expect(res.clientId).toBeNull();
    expect(fs.readdirSync(path.join(root, "clients"))).toHaveLength(0);
  });

  it("refuses to create a record with no way to contact the person", async () => {
    const res = await ensureClientForBooking({ ...RASHMI, email: null, phone: null });
    expect(res.skipped).toBe("insufficient_contact");
    expect(fs.readdirSync(path.join(root, "clients"))).toHaveLength(0);
  });

  it("matches an existing client by phone instead of creating a duplicate", { timeout: 40000 }, async () => {
    const first = await ensureClientForBooking(RASHMI);
    // Same person books again from cal.com, with a differently-formatted number.
    const again = await ensureClientForBooking({
      ...RASHMI,
      uid: "second-booking",
      email: null,
      phone: "07069151092",
      source: "calcom",
      eventSlug: "15min",
    });
    expect(again.created).toBe(false);
    expect(again.clientId).toBe(first.clientId);
    expect(fs.readdirSync(path.join(root, "clients"))).toHaveLength(1);
    expect(readSessions(first.clientId!).length).toBe(2);
  });
});
