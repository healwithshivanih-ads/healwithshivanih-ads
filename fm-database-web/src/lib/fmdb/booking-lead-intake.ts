/**
 * Turn a booking into a client record.
 *
 * Until 2026-09-20 a booking from someone who wasn't already a client was
 * appended to `_calcom_unmatched.yaml` and forgotten. Thirteen bookings
 * accumulated there — four of them real discovery-call leads with name,
 * email and phone, and one (Rashmi N, via Wix) who had typed out her health
 * history in the booking form. None of them existed in the database.
 *
 * So: an FM booking now creates the client record, and whatever the person
 * wrote in the booking form is saved verbatim as a note on that record.
 *
 * Deliberately narrow:
 *   - only FM services (FM_EVENT_SLUGS). The pranic-healing bookings that
 *     share the same Wix site are a different business and must NOT land in
 *     the coaching database.
 *   - only on create/reschedule, never on a cancellation.
 *   - never without a name AND at least one of email/phone.
 *   - `engagement_status` stays "pending" — a booking is an enquiry, not a
 *     sign-up. See the engagement_status memory note.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { PYTHON } from "@/lib/fmdb/shim";

const execFileP = promisify(execFile);
const FMDB_REPO = path.resolve(process.cwd(), "..", "fm-database");

/**
 * Services that belong to the FM coaching practice. Anything else on the
 * same Wix site / cal.com account (pranic healing, family constellation,
 * facilitation) is another business and is ignored here.
 *
 * Matched case-insensitively against the event slug AND the event title, so
 * both `15min` (cal.com slug) and `Discovery Call` (Wix title) resolve.
 */
const FM_EVENT_SLUGS = [
  "15min",
  "discovery-call",
  "discovery-consultation",
  "programme-intake-session",
  "programme-intro-call",
  "coaching-session",
];

export interface BookingFormField {
  question: string;
  answer: string;
}

export interface BookingLead {
  uid: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  eventSlug?: string | null;
  eventTitle?: string | null;
  startTime?: string | null;
  source: "wix" | "calcom";
  formFields?: BookingFormField[];
}

export interface LeadIntakeResult {
  clientId: string | null;
  created: boolean;
  noteSaved: boolean;
  skipped?: "not_fm_service" | "insufficient_contact" | "already_noted";
  error?: string;
}

/** Is this booking for an FM coaching service? */
export function isFmBooking(lead: Pick<BookingLead, "eventSlug" | "eventTitle">): boolean {
  const hay = `${lead.eventSlug ?? ""} ${lead.eventTitle ?? ""}`.toLowerCase();
  if (!hay.trim()) return false;
  return FM_EVENT_SLUGS.some((slug) => {
    if (hay.includes(slug)) return true;
    // "discovery-call" should also match the title "Discovery Call".
    return hay.includes(slug.replace(/-/g, " "));
  });
}

function normalisePhone(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * The note body. Kept deliberately plain-text and verbatim — these are the
 * client's own words and the whole point is not to lose or paraphrase them.
 */
export function buildBookingNote(lead: BookingLead): string {
  const lines: string[] = [];
  const when = lead.startTime ? formatIst(lead.startTime) : "date unknown";
  lines.push(`Booked ${lead.eventTitle || lead.eventSlug || "a session"} for ${when}.`);
  lines.push(`Booked via ${lead.source === "wix" ? "the website (Wix)" : "Cal.com"}.`);
  const contact: string[] = [];
  if (lead.email) contact.push(lead.email);
  if (lead.phone) contact.push(lead.phone);
  if (contact.length) lines.push(`Contact given at booking: ${contact.join(" · ")}`);

  if (lead.formFields?.length) {
    lines.push("");
    lines.push("What they told us on the booking form:");
    for (const f of lead.formFields) {
      lines.push(`- ${f.question}`);
      lines.push(`  ${f.answer}`);
    }
  }
  // The uid makes the note self-identifying, which is also how we dedupe
  // when the same booking fires created → confirmed → rescheduled events.
  lines.push("");
  lines.push(`[booking: ${lead.uid}]`);
  return lines.join("\n");
}

function formatIst(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
    }) + " IST";
  } catch {
    return iso;
  }
}

/** Has this booking's note already been written for this client? */
async function alreadyNoted(clientId: string, uid: string): Promise<boolean> {
  const dir = path.join(getPlansRoot(), "clients", clientId, "sessions");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".yaml")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry), "utf-8");
      // Parse rather than grep the raw text: PyYAML writes coach_notes as a
      // folded double-quoted scalar, so `[booking: <uid>]` is physically
      // split across lines ("[booking:\\\n  \\ e43ef28d-...]") and a
      // substring match on the file silently never fires — which would mean
      // a second note for every confirm/reschedule event.
      const doc = yaml.load(raw) as { coach_notes?: unknown } | null;
      const notes = typeof doc?.coach_notes === "string" ? doc.coach_notes : "";
      if (notes.includes(uid)) return true;
    } catch { /* unreadable / invalid YAML — treat as not noted */ }
  }
  return false;
}

/** Find an existing client by email, then by last-10-digits of phone. */
export async function findClientForLead(
  email?: string | null,
  phone?: string | null,
): Promise<{ clientId: string; matchedBy: "email" | "phone" } | null> {
  const { loadAllClients } = await import("@/lib/fmdb/loader");
  const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const e = (email ?? "").trim().toLowerCase();
  const p = normalisePhone(phone);
  if (e) {
    for (const c of clients) {
      const cid = c.client_id as string | undefined;
      if (!cid) continue;
      if (((c.email as string | undefined) ?? "").trim().toLowerCase() === e) {
        return { clientId: cid, matchedBy: "email" };
      }
    }
  }
  if (p) {
    for (const c of clients) {
      const cid = c.client_id as string | undefined;
      if (!cid) continue;
      if (normalisePhone(c.mobile_number as string | undefined) === p) {
        return { clientId: cid, matchedBy: "phone" };
      }
    }
  }
  return null;
}

/**
 * Match-or-create the client record, then save the booking-form answers as
 * a note. Never throws — a failure here must not fail the webhook.
 */
export async function ensureClientForBooking(lead: BookingLead): Promise<LeadIntakeResult> {
  try {
    if (!isFmBooking(lead)) {
      return { clientId: null, created: false, noteSaved: false, skipped: "not_fm_service" };
    }
    const name = (lead.name ?? "").trim();
    if (!name || (!lead.email && !lead.phone)) {
      return { clientId: null, created: false, noteSaved: false, skipped: "insufficient_contact" };
    }

    const existing = await findClientForLead(lead.email, lead.phone);
    let clientId = existing?.clientId ?? null;
    let created = false;

    if (!clientId) {
      clientId = await createLeadRecord(lead, name);
      created = true;
    }

    let noteSaved = false;
    if (await alreadyNoted(clientId, lead.uid)) {
      return { clientId, created, noteSaved: false, skipped: "already_noted" };
    }
    noteSaved = await saveBookingNote(clientId, lead);
    return { clientId, created, noteSaved };
  } catch (err) {
    return {
      clientId: null, created: false, noteSaved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** `fmdb client-new` + the fields the CLI has no flags for. */
async function createLeadRecord(lead: BookingLead, name: string): Promise<string> {
  const { nextClientId } = await import("@/lib/server-actions/clients");
  const clientId = await nextClientId();
  const today = new Date().toISOString().slice(0, 10);

  const args = [
    "-m", "fmdb.cli", "client-new", clientId,
    "--intake-date", today,
    // The CLI requires a sex and a booking does not capture one. "other" is
    // the honest placeholder; the note says to confirm it on the call, and
    // every sex-gated surface (MRS, cycle) stays hidden until she sets it.
    "--sex", "other",
    "--display-name", name,
  ];
  if (lead.phone) args.push("--mobile", lead.phone);
  args.push("--notes", `Created automatically from a ${lead.source === "wix" ? "website" : "Cal.com"} booking on ${today}. Sex not captured at booking — confirm on the call.`);

  await execFileP(PYTHON, args, { cwd: FMDB_REPO, timeout: 20000 });

  // Fields client-new has no flags for.
  const file = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  const raw = await fs.readFile(file, "utf-8");
  const doc = (yaml.load(raw) ?? {}) as Record<string, unknown>;
  if (lead.email) doc.email = lead.email.trim();
  doc.engagement_status = "pending";
  // `fmdb client-new` defaults lifecycle_state to "programme_active" for
  // back-compat with manually-created clients. That is wrong for someone who
  // has only booked a call: revenue-export.ts counts programme_active as
  // active paid care, so a free discovery lead would inflate the capacity
  // signal. "prospect" is the model's own word for a record that exists but
  // fires nothing outbound.
  doc.lifecycle_state = "prospect";
  doc.lead_source = lead.source === "wix" ? "wix_booking" : "calcom_booking";
  await fs.writeFile(file, yaml.dump(doc, { sortKeys: false }), "utf-8");

  return clientId;
}

/** Write the booking-form answers as a quick note on the client record. */
async function saveBookingNote(clientId: string, lead: BookingLead): Promise<boolean> {
  const { saveSessionAction } = await import("@/lib/server-actions/assess");
  const primary = lead.formFields?.[0]?.answer?.trim();
  const res = await saveSessionAction({
    client_id: clientId,
    session_type: "quick_note",
    session_date: new Date().toISOString().slice(0, 10),
    presenting_complaints: `[source: booking_form]${primary ? ` ${primary}` : ""}`,
    coach_notes: buildBookingNote(lead),
  });
  return Boolean(res?.ok);
}
