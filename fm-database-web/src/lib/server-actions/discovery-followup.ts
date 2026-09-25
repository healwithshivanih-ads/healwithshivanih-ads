"use server";

/**
 * Discovery follow-up — the I/O half. Finds everyone who has had a call and not
 * signed up, drafts the message that is due, and sends only what the coach
 * approves.
 *
 * NOTHING HERE SENDS BY ITSELF. `scanDiscoveryFollowupAction` (the cron's entry
 * point) writes drafts and stops. `approveFollowupDraftAction` is the only
 * function that contacts anyone, and it is reachable only from a button — the
 * same split as the win-back drip (winback-drip.ts), for the same reason: these
 * messages ask people for money.
 *
 * Every rule about WHO is owed WHAT lives in lib/fmdb/discovery-followup.ts,
 * pure and tested. This file resolves facts and does as little deciding as it
 * can.
 *
 * STATE lives per person at clients/<id>/_discovery_followup.yaml.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import {
  followupDecision,
  nextFollowupTouch,
  touchesFor,
  renderFollowupMessage,
  checkFollowupMessage,
  parseBookedCallDate,
  isFreeCallEventSlug,
  quotableConcern,
  addDaysYmd,
  creditExpiresOn,
  FOLLOWUP_BACKFILL_DAYS,
  type FollowupDecision,
  type FollowupTouchKind,
  type FollowupTrack,
} from "@/lib/fmdb/discovery-followup";
import {
  loadCommunicationThreadAction,
  recordOutboundMessageAction,
  sendWhatsAppAction,
} from "@/app/api/whatsapp/actions";

type Dict = Record<string, unknown>;

const STATE_FILE = "_discovery_followup.yaml";
/** The approved generic opener: "Hi {{1}}, a quick note from my side: {{2}}
 *  Reply here whenever you can and I'll update your record." */
const WA_TEMPLATE = "fm_coach_message_v1";
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type FollowupTouchStatus = "pending" | "sent" | "skipped" | "expired";

export interface FollowupTouchRecord {
  track: FollowupTrack;
  touch: number;
  kind: FollowupTouchKind;
  due_on: string;
  status: FollowupTouchStatus;
  drafted_at?: string;
  sent_at?: string;
  skipped_at?: string;
  message?: string;
}

export interface FollowupState {
  client_id: string;
  client_name: string;
  track: FollowupTrack;
  call_date: string;
  /** Set when the coach started or corrected this by hand. */
  manual?: { track: FollowupTrack; call_date: string; at: string } | null;
  exited: boolean;
  exited_at?: string;
  touches: FollowupTouchRecord[];
}

export interface FollowupDraftRow {
  clientId: string;
  clientName: string;
  track: FollowupTrack;
  callDate: string;
  daysSinceCall: number;
  touch: number;
  kind: FollowupTouchKind;
  message: string;
  /** Foundation track only — when the ₹12,000 credit lapses. */
  creditExpiresOn: string | null;
  /** Foundation recap with no Starting Map written yet. */
  missingStartingMap: boolean;
}

export interface FollowupScheduledRow {
  clientId: string;
  clientName: string;
  track: FollowupTrack;
  callDate: string;
  daysSinceCall: number;
  /** What happens next, or why nothing will — in words. */
  status: string;
  nextDueOn: string | null;
}

export interface FollowupUnanchoredRow {
  clientId: string;
  clientName: string;
  reason: string;
}

// ── disk ───────────────────────────────────────────────────────────────────

function clientDir(id: string) {
  return path.join(getPlansRoot(), "clients", id);
}

async function readState(id: string): Promise<FollowupState | null> {
  try {
    const doc = yaml.load(await fs.readFile(path.join(clientDir(id), STATE_FILE), "utf-8"));
    return doc && typeof doc === "object" ? (doc as FollowupState) : null;
  } catch {
    return null;
  }
}

async function writeState(s: FollowupState): Promise<void> {
  const f = path.join(clientDir(s.client_id), STATE_FILE);
  const tmp = `${f}.tmp`;
  // temp + rename: the cron and the panel both write here, and a half-written
  // file would read as "no follow-up" and restart someone's sequence.
  await fs.writeFile(tmp, yaml.dump(s, { lineWidth: -1, noRefs: true }), "utf-8");
  await fs.rename(tmp, f);
}

async function readYaml(file: string): Promise<Dict | null> {
  try {
    const d = yaml.load(await fs.readFile(file, "utf-8"));
    return d && typeof d === "object" ? (d as Dict) : null;
  } catch {
    return null;
  }
}

function todayIst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
}

function istYmdOf(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
}

/** js-yaml turns an unquoted date into a Date — normalise either shape. */
function asYmd(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && YMD.test(v.trim())) return v.trim();
  return null;
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

// ── facts ──────────────────────────────────────────────────────────────────

/** client_ids with ANY plan (draft, ready, published). */
async function clientsWithPlans(): Promise<Set<string>> {
  const root = getPlansRoot();
  const out = new Set<string>();
  for (const bucket of ["drafts", "ready", "published"]) {
    let files: string[] = [];
    try {
      files = await fs.readdir(path.join(root, bucket));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!/\.ya?ml$/.test(f)) continue;
      try {
        // client_id sits near the top of every plan; a regex read avoids
        // parsing ~50 large YAML files on every scan.
        const head = (await fs.readFile(path.join(root, bucket, f), "utf-8")).slice(0, 4000);
        const m = head.match(/^client_id:\s*['"]?([A-Za-z0-9_-]+)/m);
        if (m) out.add(m[1]);
      } catch {
        /* one unreadable plan must not empty the scan */
      }
    }
  }
  return out;
}

async function loadCalcomBookings(): Promise<Record<string, Dict[]>> {
  const d = await readYaml(path.join(getPlansRoot(), "_calcom_bookings.yaml"));
  return (d as Record<string, Dict[]>) ?? {};
}

interface SessionFacts {
  /** Free-call dates parsed from booking-form notes. */
  bookedFreeCalls: string[];
  /** The concern they wrote on the booking form. */
  concern: string | null;
}

async function sessionFacts(id: string): Promise<SessionFacts> {
  const out: SessionFacts = { bookedFreeCalls: [], concern: null };
  let names: string[] = [];
  try {
    names = (await fs.readdir(path.join(clientDir(id), "sessions"))).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    if (!/\.ya?ml$/.test(n)) continue;
    const s = await readYaml(path.join(clientDir(id), "sessions", n));
    if (!s) continue;
    const pc = String(s.presenting_complaints ?? "");
    if (!pc.includes("[source: booking_form]")) continue;
    const d = parseBookedCallDate(String(s.coach_notes ?? ""));
    if (d) out.bookedFreeCalls.push(d);
    const concern = pc.replace(/\[[^\]]*\]/g, "").trim();
    if (concern) out.concern = concern;
  }
  return out;
}

async function lastInbound(id: string): Promise<string | null> {
  let latest: string | null = null;
  try {
    for (const m of await loadCommunicationThreadAction(id, 45)) {
      if (m.direction !== "inbound") continue;
      if (latest === null || m.date > latest) latest = m.date;
    }
  } catch {
    /* unreadable thread → treated as silence; the coach still reads every draft */
  }
  return latest;
}

function appUrlFor(doc: Dict): string | null {
  const tok = typeof doc.app_token === "string" ? doc.app_token : "";
  const hasMap = doc.discovery_summary && typeof doc.discovery_summary === "object";
  if (!tok || !hasMap) return null;
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/+$/, "");
  return `${origin}/app/${tok}`;
}

function firstNameOf(doc: Dict, fallback: string): string {
  const n = String(doc.display_name ?? "").trim();
  return (n.split(/\s+/)[0] || fallback).replace(/[^\p{L}'-]/gu, "") || fallback;
}

// ── candidates ─────────────────────────────────────────────────────────────

interface Candidate {
  clientId: string;
  clientName: string;
  doc: Dict;
  track: FollowupTrack;
  callDate: string;
  state: FollowupState | null;
  handled: number[];
  concern: string | null;
  upcomingBookingAt: string | null;
  hasPlan: boolean;
  decision: FollowupDecision;
}

interface Collected {
  candidates: Candidate[];
  unanchored: FollowupUnanchoredRow[];
}

/**
 * Everyone not signed up who has had (or booked) a call, with the cheap half of
 * the decision made. Shared by the scan and the panel so they cannot disagree
 * about who is in the follow-up.
 *
 * TRACK RESOLUTION, in order:
 *   1. discovery_call_date set → foundation. It is what the client's app counts
 *      the credit from, so nothing may override it.
 *   2. the coach's manual start → whatever she chose.
 *   3. a past free-call booking (booking-form notes or a cal.com 15-min event)
 *      → free, from the latest such call.
 */
async function collect(today: string): Promise<Collected> {
  const root = path.join(getPlansRoot(), "clients");
  let ids: string[] = [];
  try {
    ids = await fs.readdir(root);
  } catch {
    return { candidates: [], unanchored: [] };
  }
  const [plans, bookings] = await Promise.all([clientsWithPlans(), loadCalcomBookings()]);
  const nowIso = new Date().toISOString();

  const candidates: Candidate[] = [];
  const unanchored: FollowupUnanchoredRow[] = [];

  for (const id of ids) {
    if (!SAFE_ID.test(id)) continue;
    const doc = await readYaml(path.join(root, id, "client.yaml"));
    if (!doc) continue;
    if (doc.archived === true) continue;
    const es = String(doc.engagement_status ?? "").trim();
    // Only prospects are ever in scope. Checked here as well as in the pure
    // decision so enrolled clients never cost a session scan.
    if (es !== "" && es !== "pending") continue;
    const hasPlan = plans.has(id);
    if (hasPlan) continue;

    const clientName = String(doc.display_name ?? id);
    const state = await readState(id);
    const sf = await sessionFacts(id);

    const calRows = bookings[id] ?? [];
    const freeFromCal: string[] = [];
    let upcoming: string | null = null;
    for (const b of calRows) {
      if (b?.type === "booking_cancelled" || b?.status === "cancelled") continue;
      const start = String(b?.start_time ?? "");
      if (!start) continue;
      if (start > nowIso) {
        if (upcoming === null || start < upcoming) upcoming = start;
      } else if (isFreeCallEventSlug(String(b?.event_slug ?? ""))) {
        const d = istYmdOf(start);
        if (d) freeFromCal.push(d);
      }
    }
    const pastBooked = sf.bookedFreeCalls.filter((d) => d <= today);
    const futureBooked = sf.bookedFreeCalls.filter((d) => d > today).sort();
    if (!upcoming && futureBooked.length) upcoming = `${futureBooked[0]}T00:00:00Z`;

    let track: FollowupTrack | null = null;
    let callDate: string | null = null;
    const dcall = asYmd(doc.discovery_call_date);
    if (dcall) {
      track = "foundation";
      callDate = dcall;
    } else if (state?.manual && YMD.test(state.manual.call_date)) {
      track = state.manual.track;
      callDate = state.manual.call_date;
    } else {
      const free = [...pastBooked, ...freeFromCal].sort();
      if (free.length) {
        track = "free";
        callDate = free[free.length - 1];
      }
    }

    if (!track || !callDate) {
      unanchored.push({
        clientId: id,
        clientName,
        reason: upcoming
          ? `call booked for ${upcoming.slice(0, 10)} — follow-up starts after it`
          : "no call date found — start it by hand if they had a call",
      });
      continue;
    }

    const handled = (state?.touches ?? [])
      .filter((t) => (t.track ?? state?.track) === track)
      .map((t) => t.touch);

    candidates.push({
      clientId: id,
      clientName,
      doc,
      track,
      callDate,
      state,
      handled,
      concern: quotableConcern(sf.concern),
      upcomingBookingAt: upcoming,
      hasPlan,
      decision: followupDecision({
        todayYmd: today,
        track,
        callDate,
        engagementStatus: es || null,
        hasPlan,
        hasPhone: String(doc.mobile_number ?? "").trim() !== "",
        lastInboundAt: null,
        upcomingBookingAt: upcoming,
        touchesHandled: handled,
        exited: state?.exited ?? false,
      }),
    });
  }
  return { candidates, unanchored };
}

/**
 * A track switch (free caller who then bought the Foundation session) closes
 * anything still pending on the old track: a free-call "shall I send the
 * Foundation link?" must never go to someone who has since had it.
 */
function reconcileTrack(state: FollowupState, track: FollowupTrack, callDate: string, name: string) {
  state.client_name = name;
  if (state.track !== track || state.call_date !== callDate) {
    for (const t of state.touches) {
      if (t.status === "pending") {
        t.status = "expired";
      }
      t.track = t.track ?? state.track;
    }
    state.track = track;
    state.call_date = callDate;
  }
}

// ── the scan (what the cron calls) ─────────────────────────────────────────

export interface FollowupScanResult {
  ok: true;
  scanned: number;
  drafted: number;
  notes: string[];
}

/** Draft every follow-up that has come due today. Idempotent. */
export async function scanDiscoveryFollowupAction(): Promise<FollowupScanResult> {
  const today = todayIst();
  const { candidates } = await collect(today);
  const notes: string[] = [];
  let drafted = 0;

  for (const c of candidates) {
    // Keep state files in step with the resolved track even on quiet days, so
    // a Foundation purchase expires a pending free-call draft the same morning.
    if (c.state && (c.state.track !== c.track || c.state.call_date !== c.callDate)) {
      reconcileTrack(c.state, c.track, c.callDate, c.clientName);
      await writeState(c.state);
    }
    if (!c.decision.draft) {
      notes.push(`${c.clientName} [${c.track}]: ${c.decision.reason}`);
      continue;
    }

    const inbound = await lastInbound(c.clientId);
    const decision = followupDecision({
      todayYmd: today,
      track: c.track,
      callDate: c.callDate,
      engagementStatus: String(c.doc.engagement_status ?? "").trim() || null,
      hasPlan: c.hasPlan,
      hasPhone: true,
      lastInboundAt: inbound,
      upcomingBookingAt: c.upcomingBookingAt,
      touchesHandled: c.handled,
      exited: c.state?.exited ?? false,
    });
    if (!decision.draft) {
      notes.push(`${c.clientName} [${c.track}]: ${decision.reason}`);
      continue;
    }

    const message = renderFollowupMessage(
      decision.touch.kind,
      {
        firstName: firstNameOf(c.doc, c.clientName),
        concern: c.concern,
        appUrl: appUrlFor(c.doc),
        callDate: c.callDate,
      },
      c.track,
    );

    const state: FollowupState = c.state ?? {
      client_id: c.clientId,
      client_name: c.clientName,
      track: c.track,
      call_date: c.callDate,
      manual: null,
      exited: false,
      touches: [],
    };
    reconcileTrack(state, c.track, c.callDate, c.clientName);

    for (const t of touchesFor(c.track)) {
      if (t.n >= decision.touch.n) continue;
      if (state.touches.some((x) => x.track === c.track && x.touch === t.n)) continue;
      state.touches.push({
        track: c.track,
        touch: t.n,
        kind: t.kind,
        due_on: addDaysYmd(c.callDate, t.day),
        status: "expired",
      });
    }
    state.touches.push({
      track: c.track,
      touch: decision.touch.n,
      kind: decision.touch.kind,
      due_on: addDaysYmd(c.callDate, decision.touch.day),
      status: "pending",
      drafted_at: new Date().toISOString(),
      message,
    });
    await writeState(state);
    drafted++;
    notes.push(`${c.clientName} [${c.track}]: drafted touch ${decision.touch.n} (${decision.touch.kind})`);
  }

  if (drafted > 0) revalidatePath("/dashboard-v2");
  return { ok: true, scanned: candidates.length, drafted, notes };
}

// ── panel reads ────────────────────────────────────────────────────────────

export interface FollowupOverview {
  drafts: FollowupDraftRow[];
  scheduled: FollowupScheduledRow[];
  unanchored: FollowupUnanchoredRow[];
}

export async function loadDiscoveryFollowupAction(): Promise<FollowupOverview> {
  const today = todayIst();
  const { candidates, unanchored } = await collect(today);
  const drafts: FollowupDraftRow[] = [];
  const scheduled: FollowupScheduledRow[] = [];

  for (const c of candidates) {
    const pending = (c.state?.touches ?? []).find(
      (t) => t.status === "pending" && t.track === c.track,
    );
    const daysSinceCall = daysBetween(c.callDate, today);
    if (pending && !c.state?.exited) {
      drafts.push({
        clientId: c.clientId,
        clientName: c.clientName,
        track: c.track,
        callDate: c.callDate,
        daysSinceCall,
        touch: pending.touch,
        kind: pending.kind,
        message: pending.message ?? "",
        creditExpiresOn: c.track === "foundation" ? creditExpiresOn(c.callDate) : null,
        missingStartingMap: c.track === "foundation" && pending.kind === "fdn_recap" && !appUrlFor(c.doc),
      });
      continue;
    }
    const next = nextFollowupTouch(c.track, c.handled);
    const last = touchesFor(c.track)[touchesFor(c.track).length - 1];
    const windowPassed = daysSinceCall > last.day + FOLLOWUP_BACKFILL_DAYS;
    const nextDue = next ? addDaysYmd(c.callDate, next.day) : null;
    scheduled.push({
      clientId: c.clientId,
      clientName: c.clientName,
      track: c.track,
      callDate: c.callDate,
      daysSinceCall,
      status: c.state?.exited
        ? "stopped by you"
        : windowPassed
          ? "went quiet before this follow-up existed — reach out personally if you want to"
          : c.decision.draft
            ? "draft due at the next scan"
            : c.decision.reason,
      nextDueOn:
        next && !c.state?.exited && !windowPassed && nextDue ? (nextDue < today ? today : nextDue) : null,
    });
  }
  drafts.sort((a, b) => a.callDate.localeCompare(b.callDate));
  scheduled.sort((a, b) => (a.nextDueOn ?? "9999").localeCompare(b.nextDueOn ?? "9999"));
  return { drafts, scheduled, unanchored };
}

// ── coach actions ──────────────────────────────────────────────────────────

/**
 * Send one approved draft — the ONLY path here that reaches a person.
 *
 * Re-checks eligibility at approval, because a draft can sit for days: someone
 * who signed up this morning, or messaged yesterday, must not get a nudge that
 * was queued before either happened.
 */
export async function approveFollowupDraftAction(
  clientId: string,
  touchN: number,
  message: string,
): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readState(clientId);
  if (!state) return { ok: false, error: "no follow-up on file" };
  if (state.exited) return { ok: false, error: "this follow-up has been stopped" };
  const t = state.touches.find(
    (x) => x.touch === touchN && x.status === "pending" && (x.track ?? state.track) === state.track,
  );
  if (!t) return { ok: false, error: "no pending draft for that touch" };

  const doc = await readYaml(path.join(clientDir(clientId), "client.yaml"));
  if (!doc) return { ok: false, error: "client record not found" };
  const es = String(doc.engagement_status ?? "").trim();
  if (es !== "" && es !== "pending") {
    return { ok: false, error: `they are now "${es}" — this follow-up no longer applies` };
  }
  if ((await clientsWithPlans()).has(clientId)) {
    return { ok: false, error: "a plan exists for them now — nothing should be sent" };
  }
  // The track the record implies NOW must match the draft's — a free-call
  // draft must not go to someone whose Foundation session has since happened.
  const nowTrack: FollowupTrack = asYmd(doc.discovery_call_date) ? "foundation" : state.track;
  if (nowTrack !== state.track) {
    return { ok: false, error: "they have had their Foundation session since this was drafted — the next scan will redraft" };
  }
  const inbound = await lastInbound(clientId);
  if (inbound && t.drafted_at && inbound > t.drafted_at) {
    return {
      ok: false,
      error: `they messaged on ${inbound.slice(0, 10)}, after this was drafted — reply to them personally`,
    };
  }

  const body = (message ?? "").trim();
  const gate = checkFollowupMessage(body, state.track);
  if (!gate.ok) return { ok: false, error: gate.refuse.join(" · ") };

  const phone = String(doc.mobile_number ?? "").trim();
  if (!phone) return { ok: false, error: "no mobile number on file" };
  const firstName = firstNameOf(doc, state.client_name);

  const sent = await sendWhatsAppAction(phone, WA_TEMPLATE, [firstName, body], {
    name: String(doc.display_name ?? ""),
  });
  if (!sent.ok) return { ok: false, error: sent.error || "WhatsApp send failed" };

  // Recorded only after a successful send, so a failure never shows in the
  // thread as though it went.
  const rec = await recordOutboundMessageAction({
    clientId,
    templateName: WA_TEMPLATE,
    renderedBody: `Hi ${firstName}, a quick note from my side: ${body} Reply here whenever you can and I'll update your record.`,
  });
  if (!rec.ok) {
    console.error(`[discovery-followup] sent touch ${touchN} to ${clientId} but could not record it: ${rec.error}`);
  }

  t.status = "sent";
  t.sent_at = new Date().toISOString();
  t.message = body;
  await writeState(state);
  revalidatePath("/dashboard-v2");
  revalidatePath(`/clients-v2/${clientId}`);
  return { ok: true, warnings: gate.warn.length ? gate.warn : undefined };
}

/** Skip one touch. The sequence carries on to the next. */
export async function skipFollowupTouchAction(
  clientId: string,
  touchN: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readState(clientId);
  if (!state) return { ok: false, error: "no follow-up on file" };
  const t = state.touches.find((x) => x.touch === touchN && x.status === "pending");
  if (!t) return { ok: false, error: "no pending draft for that touch" };
  t.status = "skipped";
  t.skipped_at = new Date().toISOString();
  await writeState(state);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}

/** Stop this person's follow-up entirely (not a fit, asked not to be contacted, …). */
export async function stopFollowupAction(clientId: string): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readState(clientId);
  const doc = await readYaml(path.join(clientDir(clientId), "client.yaml"));
  if (!doc) return { ok: false, error: "client record not found" };
  const now = new Date().toISOString();
  const next: FollowupState = state ?? {
    client_id: clientId,
    client_name: String(doc.display_name ?? clientId),
    track: asYmd(doc.discovery_call_date) ? "foundation" : "free",
    call_date: asYmd(doc.discovery_call_date) ?? todayIst(),
    manual: null,
    exited: false,
    touches: [],
  };
  next.exited = true;
  next.exited_at = now;
  for (const t of next.touches) {
    if (t.status === "pending") {
      t.status = "skipped";
      t.skipped_at = now;
    }
  }
  await writeState(next);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}

export async function resumeFollowupAction(clientId: string): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readState(clientId);
  if (!state) return { ok: false, error: "no follow-up on file" };
  state.exited = false;
  delete state.exited_at;
  await writeState(state);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}

/**
 * Start (or correct) a follow-up by hand — for a call the system could not
 * date, e.g. a call arranged on WhatsApp.
 *
 * A FOUNDATION start is refused here on purpose: the foundation track must
 * count from discovery_call_date, which the client's app uses for the credit.
 * Use "Mark discovery call done" on their overview instead, so the message and
 * the app agree.
 */
export async function startFollowupAction(
  clientId: string,
  callDate: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  if (!YMD.test(callDate)) return { ok: false, error: "call date must be YYYY-MM-DD" };
  const today = todayIst();
  if (callDate > today) return { ok: false, error: "that call has not happened yet" };
  const doc = await readYaml(path.join(clientDir(clientId), "client.yaml"));
  if (!doc) return { ok: false, error: "client record not found" };
  if (asYmd(doc.discovery_call_date)) {
    return { ok: false, error: "they have a Foundation call date already — they are on the Foundation follow-up" };
  }
  const state = (await readState(clientId)) ?? {
    client_id: clientId,
    client_name: String(doc.display_name ?? clientId),
    track: "free" as FollowupTrack,
    call_date: callDate,
    manual: null,
    exited: false,
    touches: [],
  };
  state.manual = { track: "free", call_date: callDate, at: new Date().toISOString() };
  reconcileTrack(state, "free", callDate, String(doc.display_name ?? clientId));
  state.exited = false;
  delete state.exited_at;
  await writeState(state);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}
