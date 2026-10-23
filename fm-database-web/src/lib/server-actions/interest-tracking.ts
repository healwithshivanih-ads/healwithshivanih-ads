"use server";

/**
 * Interest tracking — the I/O half. Who has shown interest in what, the
 * "Interested people" dashboard panel, and the "thought of you" notes.
 *
 * NOTHING HERE SENDS BY ITSELF. `scanInterestNotesAction` (run by the 10:45
 * follow-up cron, after the call follow-up scan) only writes drafts.
 * `approveInterestNoteAction` is the one function that emails anyone, and only
 * from the coach's button.
 *
 * Rules live in the pure modules: concerns.ts (vocabulary), interests.ts
 * (signals), content-library.ts (what to send), interest-notes.ts (when).
 *
 * STATE: per person, `_interest_notes.yaml` next to client.yaml (clients/ or
 * prospects/ — resolvePersonDir).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { resolvePersonDir } from "@/lib/fmdb/person-dir";
import { clientsWithPlans } from "@/lib/fmdb/plan-index";
import { CONCERN_LABEL, isConcernId, type ConcernId } from "@/lib/fmdb/concerns";
import { activeConcerns, lastInterestAt, parseInterests } from "@/lib/fmdb/interests";
import { addInterestSignals, dismissInterest, setMarketingOptOut } from "@/lib/fmdb/interests-store";
import { newlyLiveFor, pickContent, type ContentItem } from "@/lib/fmdb/content-library";
import { loadContentLibrary, loadContentStatus } from "@/lib/fmdb/content-library-store";
import {
  checkNoteEmail,
  noteDecision,
  renderNoteEmail,
  NEW_ITEM_WINDOW_DAYS,
} from "@/lib/fmdb/interest-notes";
import { touchesFor, FOLLOWUP_BACKFILL_DAYS, type FollowupTrack } from "@/lib/fmdb/discovery-followup";
import { loadCommunicationThreadAction, recordOutboundMessageAction } from "@/app/api/whatsapp/actions";
import { sendClientEmailAction } from "@/app/api/email/actions";
import { gateForClient } from "@/lib/fmdb/contact-gate-server";
import { checkEmailLinks } from "@/lib/server-actions/discovery-followup";

type Dict = Record<string, unknown>;

const NOTES_FILE = "_interest_notes.yaml";
const FOLLOWUP_FILE = "_discovery_followup.yaml";
const THREAD_TEMPLATE = "fm_interest_note_email";
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
/** The panel lists people with activity this recent (or a note waiting). */
const PANEL_WINDOW_DAYS = 90;

interface NoteRecord {
  content_id: string;
  status: "pending" | "sent" | "skipped";
  drafted_at: string;
  sent_at?: string;
  skipped_at?: string;
  subject: string;
  body: string;
}

interface NotesState {
  client_id: string;
  notes: NoteRecord[];
}

interface FollowupFileTouch {
  track?: FollowupTrack;
  touch: number;
  status: string;
  sent_at?: string;
  content_id?: string;
  content_sent?: string[];
}

interface FollowupFile {
  track: FollowupTrack;
  call_date: string;
  exited?: boolean;
  touches?: FollowupFileTouch[];
}

// ── disk ───────────────────────────────────────────────────────────────────

async function readYaml<T = Dict>(f: string): Promise<T | null> {
  try {
    const d = yaml.load(await fs.readFile(f, "utf-8"));
    return d && typeof d === "object" ? (d as T) : null;
  } catch {
    return null;
  }
}

async function readNotes(id: string): Promise<NotesState> {
  const s = await readYaml<NotesState>(path.join(resolvePersonDir(id), NOTES_FILE));
  return { client_id: id, notes: Array.isArray(s?.notes) ? s!.notes : [] };
}

async function writeNotes(s: NotesState): Promise<void> {
  const f = path.join(resolvePersonDir(s.client_id), NOTES_FILE);
  const tmp = `${f}.tmp`;
  await fs.writeFile(tmp, yaml.dump(s, { lineWidth: -1, noRefs: true }), "utf-8");
  await fs.rename(tmp, f);
}

function todayIst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
}

function ymdOf(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

function maxYmd(...xs: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const x of xs) if (x && (best === null || x > best)) best = x;
  return best;
}

function humanYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function firstNameOf(doc: Dict, fallback: string): string {
  const n = String(doc.display_name ?? "").trim();
  return (n.split(/\s+/)[0] || fallback).replace(/[^\p{L}'-]/gu, "") || fallback;
}

// ── facts per person ───────────────────────────────────────────────────────

interface Person {
  clientId: string;
  bucket: "clients" | "prospects";
  doc: Dict;
  name: string;
  engagement: string;
  concerns: ConcernId[];
  /** Their own words, newest first, deduped. */
  words: string[];
  sources: string[];
  lastInterestOn: string | null;
  lastSessionOn: string | null;
  followup: FollowupFile | null;
  notes: NotesState;
}

async function lastSessionDate(dir: string): Promise<string | null> {
  try {
    const names = await fs.readdir(path.join(dir, "sessions"));
    return names.map((n) => n.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null).reduce<string | null>((a, b) => maxYmd(a, b), null);
  } catch {
    return null;
  }
}

/** Everyone not signed up, from both buckets. */
async function collectPeople(): Promise<Person[]> {
  const root = getPlansRoot();
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const bucket of ["clients", "prospects"] as const) {
    let ids: string[] = [];
    try {
      ids = await fs.readdir(path.join(root, bucket));
    } catch {
      continue;
    }
    for (const id of ids.sort()) {
      if (!SAFE_ID.test(id) || seen.has(id)) continue;
      seen.add(id);
      const dir = path.join(root, bucket, id);
      const doc = await readYaml(path.join(dir, "client.yaml"));
      if (!doc || doc.archived === true) continue;
      const engagement = String(doc.engagement_status ?? "").trim();
      if (engagement === "signed_up" || engagement === "lapsed") continue;
      const signals = parseInterests(doc.interests);
      const live = signals.filter((s) => !s.dismissed).sort((a, b) => b.at.localeCompare(a.at));
      out.push({
        clientId: id,
        bucket,
        doc,
        name: String(doc.display_name ?? id),
        engagement,
        concerns: activeConcerns(signals),
        words: [...new Set(live.map((s) => s.detail).filter((d): d is string => Boolean(d)))].slice(0, 3),
        sources: [...new Set(live.map((s) => s.source))],
        lastInterestOn: lastInterestAt(signals),
        lastSessionOn: await lastSessionDate(dir),
        followup: await readYaml<FollowupFile>(path.join(dir, FOLLOWUP_FILE)),
        notes: await readNotes(id),
      });
    }
  }
  return out;
}

function followupSentIds(f: FollowupFile | null): string[] {
  const out: string[] = [];
  for (const t of f?.touches ?? []) {
    out.push(...(t.content_sent ?? []));
    if (t.content_id && (t.status === "pending" || t.status === "sent")) out.push(t.content_id);
  }
  return out;
}

function sentIdsOf(p: Person): string[] {
  return [
    ...followupSentIds(p.followup),
    ...p.notes.notes.filter((n) => n.status !== "skipped").map((n) => n.content_id),
  ];
}

/**
 * Is their call follow-up still in progress? A sequence with touches left and
 * inside its window, or a draft waiting — the call follow-up asks, the notes
 * give, and the two must not land in the same fortnight.
 */
function followupRunning(f: FollowupFile | null, today: string): boolean {
  if (!f || f.exited) return false;
  const touches = f.touches ?? [];
  if (touches.some((t) => t.status === "pending")) return true;
  const seq = touchesFor(f.track);
  const handled = new Set(touches.filter((t) => (t.track ?? f.track) === f.track).map((t) => t.touch));
  if (seq.every((t) => handled.has(t.n))) return false;
  const last = seq[seq.length - 1];
  return daysBetween(f.call_date, today) <= last.day + FOLLOWUP_BACKFILL_DAYS;
}

function lastEmailedOn(p: Person): string | null {
  const fromFollowup = (p.followup?.touches ?? []).map((t) => (t.status === "sent" ? ymdOf(t.sent_at) : null));
  const fromNotes = p.notes.notes.map((n) => (n.status === "sent" ? ymdOf(n.sent_at) : null));
  return maxYmd(...fromFollowup, ...fromNotes);
}

async function lastInboundOn(id: string): Promise<string | null> {
  try {
    let best: string | null = null;
    for (const m of await loadCommunicationThreadAction(id, 45)) {
      if (m.direction === "inbound") best = maxYmd(best, ymdOf(m.date));
    }
    return best;
  } catch {
    return null;
  }
}

function lastActivityOf(p: Person): string | null {
  return maxYmd(p.lastInterestOn, p.lastSessionOn, ymdOf(p.doc.intake_date), p.followup?.call_date ?? null);
}

// ── the scan (cron) ────────────────────────────────────────────────────────

export interface NoteScanResult {
  ok: true;
  scanned: number;
  drafted: number;
  notes: string[];
}

/** Draft a "thought of you" note for everyone it is due for today. Idempotent. */
export async function scanInterestNotesAction(): Promise<NoteScanResult> {
  const today = todayIst();
  const [people, plans, library] = await Promise.all([collectPeople(), clientsWithPlans(), loadContentLibrary()]);
  const log: string[] = [];
  let drafted = 0;

  for (const p of people) {
    if (!p.concerns.length) continue;
    const fresh = newlyLiveFor(library, p.concerns, today, NEW_ITEM_WINDOW_DAYS, sentIdsOf(p));
    const decision = noteDecision({
      todayYmd: today,
      engagementStatus: p.engagement || null,
      hasPlan: plans.has(p.clientId),
      hasEmail: String(p.doc.email ?? "").trim() !== "",
      optedOut: p.doc.marketing_opt_out === true,
      followupStopped: p.followup?.exited === true,
      followupRunning: followupRunning(p.followup, today),
      lastContentEmailOn: lastEmailedOn(p),
      notePending: p.notes.notes.some((n) => n.status === "pending"),
      // Only looked up when everything else says yes — it reads the thread.
      lastInboundOn: null,
      lastActivityOn: lastActivityOf(p),
      item: fresh[0] ?? null,
    });
    if (!decision.draft) {
      log.push(`${p.name}: ${decision.reason}`);
      continue;
    }
    const inbound = await lastInboundOn(p.clientId);
    if (inbound && daysBetween(inbound, today) < 7) {
      log.push(`${p.name}: messaged on ${inbound} — reply personally`);
      continue;
    }
    const email = renderNoteEmail(firstNameOf(p.doc, p.name), decision.item);
    p.notes.notes.push({
      content_id: decision.item.id,
      status: "pending",
      drafted_at: new Date().toISOString(),
      subject: email.subject,
      body: email.body,
    });
    await writeNotes(p.notes);
    drafted++;
    log.push(`${p.name}: drafted note — ${decision.item.title}`);
  }
  if (drafted) revalidatePath("/dashboard-v2");
  return { ok: true, scanned: people.length, drafted, notes: log };
}

// ── panel ──────────────────────────────────────────────────────────────────

export interface InterestedPersonRow {
  clientId: string;
  name: string;
  parked: boolean;
  engagement: string;
  concerns: Array<{ id: ConcernId; label: string }>;
  /** Their own words (booking form / discovery), newest first. */
  words: string[];
  sources: string[];
  lastActivityOn: string | null;
  /** One line on where their call follow-up stands. */
  followupStatus: string;
  optedOut: boolean;
  /** Why they are opted out, when they are ("coach", "replied by email: …"). */
  optOutSource: string | null;
  /** The best library item for them right now, if one is live and unsent. */
  suggestion: { title: string; url: string; kind: string } | null;
  pendingNote: { subject: string; body: string; title: string } | null;
}

export async function loadInterestedPeopleAction(): Promise<{
  rows: InterestedPersonRow[];
  libraryLive: number;
  /** ISO time YouTube + guide pages were last checked, or null if never. */
  contentCheckedAt: string | null;
}> {
  const today = todayIst();
  const [people, library, status] = await Promise.all([collectPeople(), loadContentLibrary(), loadContentStatus()]);
  const titleOf = new Map(library.map((i) => [i.id, i]));
  const rows: InterestedPersonRow[] = [];
  for (const p of people) {
    if (p.engagement === "declined") continue;
    const activity = lastActivityOf(p);
    const pending = p.notes.notes.find((n) => n.status === "pending") ?? null;
    if (!pending && (!activity || daysBetween(activity, today) > PANEL_WINDOW_DAYS)) continue;
    const pick = p.concerns.length
      ? pickContent(library, { concerns: p.concerns, today, sentIds: sentIdsOf(p), prefer: "first" })
      : null;
    const f = p.followup;
    const followupStatus = !f
      ? "no call follow-up"
      : f.exited
        ? "follow-up stopped"
        : followupRunning(f, today)
          ? `call follow-up running (${f.track === "foundation" ? "paid Foundation" : f.track === "triage" ? "₹999 call" : "free call"} on ${humanYmd(f.call_date)})`
          : "call follow-up finished";
    rows.push({
      clientId: p.clientId,
      name: p.name,
      parked: p.bucket === "prospects",
      engagement: p.engagement || "pending",
      concerns: p.concerns.map((id) => ({ id, label: CONCERN_LABEL[id] })),
      words: p.words,
      sources: p.sources,
      lastActivityOn: activity,
      followupStatus,
      optedOut: p.doc.marketing_opt_out === true,
      optOutSource: p.doc.marketing_opt_out === true ? String(p.doc.marketing_opt_out_source ?? "coach") : null,
      suggestion: pick ? { title: pick.title, url: pick.url, kind: pick.kind } : null,
      pendingNote: pending
        ? { subject: pending.subject, body: pending.body, title: titleOf.get(pending.content_id)?.title ?? pending.content_id }
        : null,
    });
  }
  rows.sort((a, b) => {
    if (Boolean(a.pendingNote) !== Boolean(b.pendingNote)) return a.pendingNote ? -1 : 1;
    return (b.lastActivityOn ?? "").localeCompare(a.lastActivityOn ?? "");
  });
  return {
    rows,
    libraryLive: library.filter((i: ContentItem) => i.liveFrom <= today).length,
    contentCheckedAt: typeof status?.checked_at === "string" ? status.checked_at : null,
  };
}

// ── coach actions ──────────────────────────────────────────────────────────

/** Send an approved note — the only path here that reaches a person. */
export async function approveInterestNoteAction(
  clientId: string,
  input: { subject: string; body: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const notes = await readNotes(clientId);
  const note = notes.notes.find((n) => n.status === "pending");
  if (!note) return { ok: false, error: "no note waiting for them" };
  const doc = await readYaml(path.join(resolvePersonDir(clientId), "client.yaml"));
  if (!doc) return { ok: false, error: "client record not found" };
  // The send door decides who may get a note (prospect only, never opted out,
  // never declined) — it replaced this action's own engagement_status +
  // marketing_opt_out checks on 2026-10-23 so every sender agrees.
  const door = await gateForClient(clientId, "content_note");
  if (!door.ok) return { ok: false, error: door.reason };
  const inbound = await lastInboundOn(clientId);
  if (inbound && inbound > note.drafted_at.slice(0, 10)) {
    return { ok: false, error: `they got in touch on ${inbound}, after this was drafted — reply to them personally` };
  }

  const subject = (input.subject ?? "").trim();
  const body = (input.body ?? "").trim();
  const gate = checkNoteEmail(subject, body);
  if (!gate.ok) return { ok: false, error: gate.refuse.join(" · ") };
  const links = await checkEmailLinks(body);
  if (!links.ok) return { ok: false, error: links.error };

  const to = String(doc.email ?? "").trim();
  if (!to) return { ok: false, error: "no email address on file" };
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#2b2d42;white-space:pre-wrap;">${body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</div>`;
  const sent = await sendClientEmailAction({
    to,
    bcc: process.env.GMAIL_USER ?? undefined,
    subject,
    textBody: body,
    htmlBody: html,
    clientId,
    purpose: "content_note",
  });
  if (!sent.ok) return { ok: false, error: sent.error };

  const rec = await recordOutboundMessageAction({
    clientId,
    templateName: THREAD_TEMPLATE,
    renderedBody: `[subject: ${subject}]\n\n${body}`,
    channel: "email",
  });
  if (!rec.ok) console.error(`[interest-notes] emailed ${clientId} but could not record it: ${rec.error}`);

  note.status = "sent";
  note.sent_at = new Date().toISOString();
  note.subject = subject;
  note.body = body;
  // If the coach swapped the link, remember what actually went.
  if (links.contentIds.length && !links.contentIds.includes(note.content_id)) note.content_id = links.contentIds[0];
  await writeNotes(notes);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}

export async function skipInterestNoteAction(clientId: string): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const notes = await readNotes(clientId);
  const note = notes.notes.find((n) => n.status === "pending");
  if (!note) return { ok: false, error: "no note waiting" };
  note.status = "skipped";
  note.skipped_at = new Date().toISOString();
  await writeNotes(notes);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}

/** The coach tags a concern by hand. */
export async function addConcernAction(clientId: string, concern: string): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  if (!isConcernId(concern)) return { ok: false, error: "unknown concern" };
  const r = await addInterestSignals(clientId, [{ concern, source: "coach", at: todayIst() }]);
  revalidatePath("/dashboard-v2");
  return { ok: r.ok, error: r.error };
}

/** The coach takes a concern off. It stays recorded as dismissed. */
export async function removeConcernAction(clientId: string, concern: string): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  if (!isConcernId(concern)) return { ok: false, error: "unknown concern" };
  const r = await dismissInterest(clientId, concern);
  revalidatePath("/dashboard-v2");
  return r;
}

/**
 * "Stop these" — no more content notes. Also clears a note waiting.
 *
 * `source` says why ("coach" for the dashboard button; the email-replies job
 * passes `replied by email: "<their words>"`). Undoing an opt-out that came
 * from an email reply also restarts the call follow-up the reply stopped —
 * the undo exists for the case where the reply was misread.
 */
export async function setNotesOptOutAction(
  clientId: string,
  optOut: boolean,
  source = "coach",
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const before = await readYaml(path.join(resolvePersonDir(clientId), "client.yaml"));
  const r = await setMarketingOptOut(clientId, optOut, source);
  if (r.ok && !optOut && String(before?.marketing_opt_out_source ?? "").startsWith("replied by email")) {
    const { resumeFollowupAction } = await import("@/lib/server-actions/discovery-followup");
    await resumeFollowupAction(clientId).catch(() => ({ ok: false }));
  }
  if (r.ok && optOut) {
    const notes = await readNotes(clientId);
    let changed = false;
    for (const n of notes.notes) {
      if (n.status === "pending") {
        n.status = "skipped";
        n.skipped_at = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await writeNotes(notes);
  }
  revalidatePath("/dashboard-v2");
  return r;
}
