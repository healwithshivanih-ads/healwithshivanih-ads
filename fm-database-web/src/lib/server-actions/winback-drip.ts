"use server";

/**
 * Win-back drip — the I/O half. Reads the roster, drafts what is due, and
 * sends only what the coach has approved.
 *
 * NOTHING HERE SENDS BY ITSELF. `scanWinbackDripAction` (the cron's entry
 * point) writes drafts to disk and stops. `approveWinbackDraftAction` is the
 * only function in this file that contacts a client, and it is reachable only
 * from a button. That split is the whole design: the drafting is automatic
 * because that is the work the coach never gets to, and the sending is manual
 * because these emails ask people for money.
 *
 * Every rule about WHO is eligible lives in lib/fmdb/winback-drip.ts, pure and
 * tested. This file resolves the facts that module needs and does as little
 * deciding as possible.
 *
 * STATE lives per client at clients/<id>/_winback_drip.yaml, beside their
 * sessions and maintenance records, rather than in one roster-wide file. A
 * client's drip is about them; a shared file would also make the panel's writes
 * contend with the cron's.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { loadDecisions, planEndDate, toDate } from "@/lib/fmdb/renewal-queue";
import {
  winbackDecision,
  nextTouch,
  WINBACK_TOUCHES,
  type WinbackDecision,
  type WinbackTouchKind,
} from "@/lib/fmdb/winback-drip";
import {
  renderWinbackEmail,
  maintenancePriceInr,
  PRICE_PLACEHOLDER,
  type WinbackFacts,
} from "@/lib/fmdb/winback-email";
import { checkWinbackEmail, briefingNumbers } from "@/lib/fmdb/winback-gate";
import { PYTHON, SCRIPTS_DIR } from "@/lib/fmdb/shim";
import {
  loadCommunicationThreadAction,
  recordOutboundMessageAction,
  getLastSentAtAction,
} from "@/app/api/whatsapp/actions";
import { sendClientEmailAction } from "@/app/api/email/actions";

type Dict = Record<string, unknown>;

const DRIP_FILE = "_winback_drip.yaml";
/** The template name the graduation notice records under. */
const GRADUATION_TEMPLATE = "fm_programme_complete_v1";
/** What this drip's sends are recorded as in the client's thread. */
const WINBACK_TEMPLATE = "fm_winback_email";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export type WinbackTouchStatus = "pending" | "sent" | "skipped" | "expired";

export interface WinbackTouchRecord {
  touch: number;
  kind: WinbackTouchKind;
  /** The day this touch became due, YYYY-MM-DD. */
  due_on: string;
  status: WinbackTouchStatus;
  drafted_at?: string;
  sent_at?: string;
  skipped_at?: string;
  subject?: string;
  body?: string;
  /** Only ever set for the offer touch, and only by the coach. */
  renewal_price_inr?: number | null;
}

export interface WinbackDripState {
  client_id: string;
  client_name: string;
  plan_slug: string;
  ends_on: string;
  exited: boolean;
  exited_at?: string;
  touches: WinbackTouchRecord[];
}

/** A pending draft as the panel renders it. */
export interface WinbackDraftRow {
  clientId: string;
  clientName: string;
  planSlug: string;
  endsOn: string;
  daysSinceEnd: number;
  touch: number;
  kind: WinbackTouchKind;
  subject: string;
  body: string;
  /** True when the body still holds the price placeholder. */
  needsPrice: boolean;
  renewalPriceInr: number | null;
}

/** A client in the drip whose next touch has not come due yet. */
export interface WinbackScheduledRow {
  clientId: string;
  clientName: string;
  endsOn: string;
  daysSinceEnd: number;
  nextTouch: number;
  nextTouchKind: WinbackTouchKind;
  dueOn: string;
  /** Why nothing was drafted today, in words. */
  reason: string;
}

// ── disk helpers ────────────────────────────────────────────────────────────

function dripFile(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, DRIP_FILE);
}

async function readDrip(clientId: string): Promise<WinbackDripState | null> {
  try {
    const raw = await fs.readFile(dripFile(clientId), "utf-8");
    const doc = yaml.load(raw);
    if (!doc || typeof doc !== "object") return null;
    return doc as WinbackDripState;
  } catch {
    return null;
  }
}

async function writeDrip(state: WinbackDripState): Promise<void> {
  const f = dripFile(state.client_id);
  await fs.mkdir(path.dirname(f), { recursive: true });
  // Written via a temp file + rename: the cron and the coach's panel can both
  // touch this, and a half-written state file would read as "no drip" — which
  // silently restarts someone's sequence from touch 1.
  const tmp = `${f}.tmp`;
  await fs.writeFile(tmp, yaml.dump(state, { lineWidth: -1, noRefs: true }), "utf-8");
  await fs.rename(tmp, f);
}

async function readClientDoc(clientId: string): Promise<Dict | null> {
  try {
    const f = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    return ((yaml.load(await fs.readFile(f, "utf-8")) as Dict) ?? {}) as Dict;
  } catch {
    return null;
  }
}

/** Today in IST, YYYY-MM-DD — the zone every client-facing date uses. */
function todayIst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── roster scan ─────────────────────────────────────────────────────────────

interface PlanRow {
  slug: string;
  clientId: string;
  end: Date;
  bucket: string;
}

/**
 * Every datable plan across the buckets that can prove or disprove a renewal.
 *
 * `superseded` and `revoked` are excluded for the reasons fmdb/plan/renewals.py
 * documents: a superseded plan's successor is counted in its own right, and a
 * revoked plan was explicitly withdrawn — leaving a revoked future-dated plan
 * in the maximum once made a genuinely lapsed client read as active.
 */
async function loadPlanRows(): Promise<PlanRow[]> {
  const root = getPlansRoot();
  const rows: PlanRow[] = [];
  for (const bucket of ["published", "ready", "drafts"]) {
    let files: string[] = [];
    try {
      files = await fs.readdir(path.join(root, bucket));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!(f.endsWith(".yaml") || f.endsWith(".yml"))) continue;
      let plan: Dict;
      try {
        plan = ((yaml.load(await fs.readFile(path.join(root, bucket, f), "utf-8")) as Dict) ??
          {}) as Dict;
      } catch {
        continue; // one unreadable plan must not empty the scan
      }
      const clientId = String(plan.client_id ?? "");
      const weeks = Number(plan.plan_period_weeks ?? 0);
      if (!clientId || !weeks) continue;
      const end = planEndDate(
        toDate(plan.meal_plan_started_on),
        toDate(plan.plan_period_start),
        weeks,
      );
      if (!end) continue;
      rows.push({
        slug: f.replace(/-v\d+\.ya?ml$/, "").replace(/\.ya?ml$/, ""),
        clientId,
        end,
        bucket,
      });
    }
  }
  return rows;
}

/**
 * The most recent sign of life since a date — an inbound message on any
 * channel, or a booking.
 *
 * Anyone here is already back in conversation with the coach, and generic
 * win-back copy landing on top of that is worse than sending nothing.
 */
async function lastEngagementSince(clientId: string, sinceYmd: string): Promise<string | null> {
  let latest: string | null = null;

  try {
    const thread = await loadCommunicationThreadAction(clientId, 120);
    for (const m of thread) {
      if (m.direction !== "inbound") continue;
      if (m.date.slice(0, 10) < sinceYmd) continue;
      if (latest === null || m.date > latest) latest = m.date;
    }
  } catch {
    /* a thread we cannot read must not be treated as silence — see below */
  }

  try {
    const raw = await fs.readFile(path.join(getPlansRoot(), "_calcom_bookings.yaml"), "utf-8");
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const list = (parsed as Record<string, Dict[]>)[clientId] ?? [];
      for (const b of list) {
        const when = String(b?.start_time ?? b?.received_at ?? "");
        if (!when || when.slice(0, 10) < sinceYmd) continue;
        if (latest === null || when > latest) latest = when;
      }
    }
  } catch {
    /* no bookings file yet */
  }

  return latest;
}

/**
 * The deterministic briefing for one client, from renewal-brief.py.
 *
 * The same facts the hand-authored renewal letter is built from. Returns null
 * when the shim fails — and a null briefing STOPS the draft rather than
 * producing a letter with no facts in it, because a win-back email whose
 * opening sentence knows nothing about the person is exactly the automated
 * thing this drip must never send.
 */
async function loadBrief(clientId: string): Promise<Dict | null> {
  try {
    // renewal-brief.py takes the client id as argv, not stdin, so it cannot go
    // through runShim's JSON contract. Kept as a direct spawn with the same
    // interpreter resolution.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run(PYTHON, [path.join(SCRIPTS_DIR, "renewal-brief.py"), clientId], {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as Dict;
    if (parsed.error) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Narrow a briefing to the fields the letters are allowed to use. */
function factsFrom(brief: Dict, fallbackName: string): WinbackFacts {
  const msqRaw = Array.isArray(brief.msq) ? (brief.msq as Dict[]) : [];
  const msq = msqRaw
    .map((m) => ({
      week: typeof m?.week === "number" ? m.week : null,
      total: Number(m?.total),
    }))
    .filter((m) => Number.isFinite(m.total));
  const plan = (brief.plan ?? {}) as Dict;
  const asStrings = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  return {
    name: String(brief.name ?? fallbackName),
    weeks: Number.isFinite(Number(plan.weeks)) ? Number(plan.weeks) : null,
    msq,
    goals: asStrings(brief.goals),
    conditions: asStrings(brief.conditions),
  };
}

// ── the scan (what the cron calls) ──────────────────────────────────────────

export interface WinbackScanResult {
  ok: true;
  scanned: number;
  drafted: number;
  /** One line per client considered, so a quiet day stays legible. */
  notes: string[];
}

/**
 * Draft every win-back touch that has come due today.
 *
 * Idempotent: a touch is written once and thereafter carries a status, so
 * re-running the cron on the same day changes nothing. Safe to fire repeatedly.
 */
/**
 * Everyone whose latest published plan has ended, with the cheap half of the
 * decision already made.
 *
 * Shared by the scan and the scheduled list so the two can never disagree about
 * who is in the drip. "Cheap" means files and dates only — the engagement and
 * graduation lookups cost a directory walk each and are deferred to the scan,
 * which is the only caller that needs them.
 */
interface WinbackCandidate {
  clientId: string;
  clientName: string;
  planSlug: string;
  endsOn: string;
  hasEmail: boolean;
  hasSuccessor: boolean;
  decisionRec: { decision: string; at: string } | null;
  state: WinbackDripState | null;
  touchesHandled: number[];
  decision: WinbackDecision;
}

async function collectCandidates(today: string): Promise<WinbackCandidate[]> {
  const plans = await loadPlanRows();
  const decisions = loadDecisions();

  // The latest-ending PUBLISHED plan per client is the one whose expiry starts
  // a drip. Drafts and ready plans never start one — they only suppress.
  const latestPublished = new Map<string, PlanRow>();
  for (const p of plans) {
    if (p.bucket !== "published") continue;
    const cur = latestPublished.get(p.clientId);
    if (!cur || p.end > cur.end) latestPublished.set(p.clientId, p);
  }

  const out: WinbackCandidate[] = [];
  for (const [clientId, plan] of latestPublished) {
    const endsOn = plan.end.toISOString().slice(0, 10);
    if (endsOn >= today) continue; // still running

    const state = await readDrip(clientId);
    // A touch already drafted and awaiting approval counts as handled too —
    // otherwise the next day's scan would draft it a second time.
    const touchesHandled = (state?.touches ?? []).map((t) => t.touch);

    const clientDoc = await readClientDoc(clientId);
    const clientName = String(clientDoc?.display_name ?? clientId);
    const hasEmail = String(clientDoc?.email ?? "").trim().length > 0;

    // Successor: any draft/ready plan at all, or a published plan ending later.
    const hasSuccessor = plans.some(
      (p) =>
        p.clientId === clientId &&
        p.slug !== plan.slug &&
        (p.bucket !== "published" || p.end > plan.end),
    );

    const decisionRec = decisions[plan.slug]
      ? { decision: String(decisions[plan.slug].decision), at: decisions[plan.slug].at }
      : null;

    out.push({
      clientId,
      clientName,
      planSlug: plan.slug,
      endsOn,
      hasEmail,
      hasSuccessor,
      decisionRec,
      state,
      touchesHandled,
      decision: winbackDecision({
        todayYmd: today,
        endsOn,
        decision: decisionRec,
        hasSuccessor,
        hasEmail,
        lastEngagementAt: null,
        graduationSentAt: null,
        touchesHandled,
        exited: state?.exited ?? false,
      }),
    });
  }
  return out;
}

export async function scanWinbackDripAction(): Promise<WinbackScanResult> {
  const today = todayIst();
  const candidates = await collectCandidates(today);
  const notes: string[] = [];
  let drafted = 0;

  for (const cand of candidates) {
    const { clientId, clientName, endsOn, state, touchesHandled } = cand;

    // Only pay for the engagement + graduation lookups once the cheap rules
    // have already agreed this client could plausibly be drafted for.
    if (!cand.decision.draft) {
      notes.push(`${clientName}: ${cand.decision.reason}`);
      continue;
    }

    const [lastEngagementAt, graduation] = await Promise.all([
      lastEngagementSince(clientId, endsOn),
      getLastSentAtAction(clientId, GRADUATION_TEMPLATE, { daysBack: 120 }),
    ]);

    const decision = winbackDecision({
      todayYmd: today,
      endsOn,
      decision: cand.decisionRec,
      hasSuccessor: cand.hasSuccessor,
      hasEmail: cand.hasEmail,
      lastEngagementAt,
      graduationSentAt: graduation.sentAt,
      touchesHandled,
      exited: state?.exited ?? false,
    });
    if (!decision.draft) {
      notes.push(`${clientName}: ${decision.reason}`);
      continue;
    }

    const brief = await loadBrief(clientId);
    if (!brief) {
      notes.push(`${clientName}: briefing unavailable — not drafting a letter with no facts in it`);
      continue;
    }

    const facts = factsFrom(brief, clientName);
    const { subject, body } = renderWinbackEmail(decision.touch.kind, facts, null);

    const next: WinbackDripState = state ?? {
      client_id: clientId,
      client_name: clientName,
      plan_slug: cand.planSlug,
      ends_on: endsOn,
      exited: false,
      touches: [],
    };
    next.client_name = clientName;
    next.plan_slug = cand.planSlug;
    next.ends_on = endsOn;

    // Touches passed over on the way here are recorded as expired rather than
    // left pending, so the panel never offers to send a month-old check-in.
    for (const t of WINBACK_TOUCHES) {
      if (t.n >= decision.touch.n) continue;
      if (next.touches.some((x) => x.touch === t.n)) continue;
      next.touches.push({
        touch: t.n,
        kind: t.kind,
        due_on: addDaysYmd(endsOn, t.day),
        status: "expired",
      });
    }

    next.touches.push({
      touch: decision.touch.n,
      kind: decision.touch.kind,
      due_on: addDaysYmd(endsOn, decision.touch.day),
      status: "pending",
      drafted_at: new Date().toISOString(),
      subject,
      body,
      renewal_price_inr: null,
    });
    next.touches.sort((a, b) => a.touch - b.touch);

    await writeDrip(next);
    drafted++;
    notes.push(`${clientName}: drafted touch ${decision.touch.n} (${decision.touch.kind})`);
  }

  if (drafted > 0) revalidatePath("/dashboard-v2");
  return { ok: true, scanned: candidates.length, drafted, notes };
}

// ── panel reads ─────────────────────────────────────────────────────────────

async function allDripStates(): Promise<WinbackDripState[]> {
  const root = path.join(getPlansRoot(), "clients");
  let ids: string[] = [];
  try {
    ids = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: WinbackDripState[] = [];
  for (const id of ids) {
    const s = await readDrip(id);
    if (s) out.push(s);
  }
  return out;
}

const daysBetween = (fromYmd: string, toYmd: string) =>
  Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 864e5);

/** Drafts awaiting approval — what the panel and the digest render. */
export async function listWinbackDraftsAction(): Promise<WinbackDraftRow[]> {
  const today = todayIst();
  const rows: WinbackDraftRow[] = [];
  for (const s of await allDripStates()) {
    if (s.exited) continue;
    for (const t of s.touches) {
      if (t.status !== "pending") continue;
      rows.push({
        clientId: s.client_id,
        clientName: s.client_name,
        planSlug: s.plan_slug,
        endsOn: s.ends_on,
        daysSinceEnd: daysBetween(s.ends_on, today),
        touch: t.touch,
        kind: t.kind,
        subject: t.subject ?? "",
        body: t.body ?? "",
        needsPrice: (t.body ?? "").includes(PRICE_PLACEHOLDER),
        renewalPriceInr: t.renewal_price_inr ?? null,
      });
    }
  }
  rows.sort((a, b) => b.daysSinceEnd - a.daysSinceEnd);
  return rows;
}

/**
 * Clients on track for a win-back touch that has not come due yet.
 *
 * Exists because shortening the renewal queue's tail to 14 days would otherwise
 * leave the week before touch 1 with no coach-facing surface at all — a client
 * would drop out of the queue and reappear a week later with a drafted email,
 * having been invisible in between.
 *
 * COMPUTED FROM THE ROSTER, not from existing drip files. An earlier version
 * read only clients who already had a _winback_drip.yaml, which meant the
 * people this list exists for — those between leaving the queue and their first
 * draft, who by definition have no file yet — were precisely the ones it could
 * not show. The real-data dry run on 2026-08-28 rendered an empty list while
 * cl-008 sat 12 days past his plan end, invisible on both surfaces.
 */
export async function listWinbackScheduledAction(): Promise<WinbackScheduledRow[]> {
  const today = todayIst();
  const rows: WinbackScheduledRow[] = [];
  for (const c of await collectCandidates(today)) {
    if (c.state?.exited) continue;
    // Anything with a draft waiting is shown by listWinbackDraftsAction.
    if (c.state?.touches.some((t) => t.status === "pending")) continue;
    // Only rows the drip would genuinely act on later. A client blocked by a
    // decision, a successor or a live conversation is not "scheduled" — they
    // are finished, and listing them would rebuild the noise the renewal
    // queue's decisions were introduced to remove.
    if (!c.decision.draft && !/is due at day/.test(c.decision.reason)) continue;
    const handled = (c.state?.touches ?? []).map((t) => t.touch);
    const nt = nextTouch(handled);
    if (!nt) continue;
    rows.push({
      clientId: c.clientId,
      clientName: c.clientName,
      endsOn: c.endsOn,
      daysSinceEnd: daysBetween(c.endsOn, today),
      nextTouch: nt.n,
      nextTouchKind: nt.kind,
      dueOn: addDaysYmd(c.endsOn, nt.day),
      reason: `touch ${nt.n} drafts on ${addDaysYmd(c.endsOn, nt.day)}`,
    });
  }
  rows.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return rows;
}

// ── coach actions ───────────────────────────────────────────────────────────

function findTouch(
  state: WinbackDripState,
  touchN: number,
): WinbackTouchRecord | undefined {
  return state.touches.find((t) => t.touch === touchN && t.status === "pending");
}

/**
 * Re-render a draft with a price the coach has supplied, without sending.
 *
 * The price is applied by re-rendering from the template rather than by string
 * substitution into an edited body, so a coach who has rewritten the letter
 * does not silently lose her edits to a re-render — hence `body` is returned
 * for her to see, and `approve` takes whatever she finally has on screen.
 */
export async function previewWinbackDraftAction(
  clientId: string,
  touchN: number,
  renewalPriceInr: number | null,
): Promise<{ ok: boolean; subject?: string; body?: string; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readDrip(clientId);
  if (!state) return { ok: false, error: "no drip on file" };
  const t = findTouch(state, touchN);
  if (!t) return { ok: false, error: "no pending draft for that touch" };

  const brief = await loadBrief(clientId);
  if (!brief) return { ok: false, error: "briefing unavailable" };
  const facts = factsFrom(brief, state.client_name);
  const { subject, body } = renderWinbackEmail(t.kind, facts, renewalPriceInr);
  return { ok: true, subject, body };
}

/**
 * Approve one drafted touch — the ONLY path in this file that reaches a client.
 *
 * Gated three ways before anything leaves: the price placeholder must be gone,
 * every figure must be sourceable from the deterministic briefing, and the
 * client must still be eligible at approval time. That last check matters
 * because a draft can sit for days: a client who replied yesterday, or whose
 * next phase was published this morning, must not receive a win-back email
 * because it was queued before either happened.
 */
export async function approveWinbackDraftAction(
  clientId: string,
  touchN: number,
  input: { subject: string; body: string; renewalPriceInr?: number | null },
): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readDrip(clientId);
  if (!state) return { ok: false, error: "no drip on file" };
  if (state.exited) return { ok: false, error: "this drip has been stopped" };
  const t = findTouch(state, touchN);
  if (!t) return { ok: false, error: "no pending draft for that touch" };

  const subject = (input.subject ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!subject || !body) return { ok: false, error: "subject and body are both required" };

  const clientDoc = await readClientDoc(clientId);
  const to = String(clientDoc?.email ?? "").trim();
  if (!to) return { ok: false, error: "client has no email address on file" };

  // ── still eligible? ──────────────────────────────────────────────────────
  // Re-checked at approval, not just at drafting, because a draft can sit for
  // days: a client who replied yesterday, or whose next phase was published
  // this morning, must not get a win-back email because it was queued before
  // either happened. Deliberately NOT the full winbackDecision — the backfill
  // and graduation-quiet rules govern when to DRAFT, and should not overrule a
  // coach who has opened this letter and read it.
  const plans = await loadPlanRows();
  const thisPlan = plans.find((p) => p.slug === state.plan_slug);
  const hasSuccessor = plans.some(
    (p) =>
      p.clientId === clientId &&
      p.slug !== state.plan_slug &&
      (p.bucket !== "published" || (thisPlan ? p.end > thisPlan.end : false)),
  );
  if (hasSuccessor) {
    return {
      ok: false,
      error: "a newer plan exists for this client now — they have renewed, so nothing should be sent",
    };
  }
  const decisions = loadDecisions();
  const rec = decisions[state.plan_slug];
  if (rec && (rec.decision === "renewed" || rec.decision === "not_renewing")) {
    return { ok: false, error: `you recorded "${rec.decision.replace("_", " ")}" for this plan` };
  }
  const engaged = await lastEngagementSince(clientId, state.ends_on);
  if (engaged) {
    return {
      ok: false,
      error: `they have been back in touch since the plan ended (${engaged.slice(0, 10)}) — reply to them personally instead`,
    };
  }

  // ── the gate ─────────────────────────────────────────────────────────────
  const brief = await loadBrief(clientId);
  if (!brief) return { ok: false, error: "briefing unavailable — cannot verify the figures" };
  const weights = new Set(
    (Array.isArray(brief.weights) ? (brief.weights as Dict[]) : [])
      .map((w) => String(w?.weight_kg ?? ""))
      .filter(Boolean),
  );
  const maint = maintenancePriceInr();
  const allowedPrices = [
    ...(maint !== null ? [maint] : []),
    ...(typeof input.renewalPriceInr === "number" ? [input.renewalPriceInr] : []),
  ];
  const gate = checkWinbackEmail({
    body,
    name: state.client_name,
    sourceNumbers: briefingNumbers(brief),
    allowedPrices,
    weightValues: weights,
  });
  if (!gate.ok) {
    return { ok: false, error: gate.refuse.join(" · ") };
  }

  // ── send ─────────────────────────────────────────────────────────────────
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
  });
  if (!sent.ok) return { ok: false, error: sent.error };

  // Recorded only AFTER a successful send, so a failed send never shows in the
  // thread as though it went. The record is what makes this email visible in
  // the client's Communicate tab alongside everything else.
  const recorded = await recordOutboundMessageAction({
    clientId,
    templateName: `${WINBACK_TEMPLATE}_${touchN}`,
    renderedBody: `[subject: ${subject}]\n\n${body}`,
    channel: "email",
  });
  if (!recorded.ok) {
    console.error(
      `[winback] sent touch ${touchN} to ${clientId} but failed to record it in the thread: ${recorded.error}`,
    );
  }

  t.status = "sent";
  t.sent_at = new Date().toISOString();
  t.subject = subject;
  t.body = body;
  t.renewal_price_inr = input.renewalPriceInr ?? null;
  await writeDrip(state);
  revalidatePath("/dashboard-v2");
  revalidatePath(`/clients-v2/${clientId}`);
  return { ok: true, warnings: gate.warn.length ? gate.warn : undefined };
}

/**
 * Skip one touch without sending.
 *
 * Deliberately does NOT end the drip: a skipped check-in should not cancel the
 * offer three weeks later. Ending it entirely is `exitWinbackDripAction`, which
 * is a different button because it is a different decision.
 */
export async function skipWinbackTouchAction(
  clientId: string,
  touchN: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readDrip(clientId);
  if (!state) return { ok: false, error: "no drip on file" };
  const t = findTouch(state, touchN);
  if (!t) return { ok: false, error: "no pending draft for that touch" };
  t.status = "skipped";
  t.skipped_at = new Date().toISOString();
  await writeDrip(state);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}

/** Stop this client's drip entirely. Every remaining touch is closed. */
export async function exitWinbackDripAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readDrip(clientId);
  if (!state) return { ok: false, error: "no drip on file" };
  state.exited = true;
  state.exited_at = new Date().toISOString();
  for (const t of state.touches) {
    if (t.status === "pending") {
      t.status = "skipped";
      t.skipped_at = state.exited_at;
    }
  }
  await writeDrip(state);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}

/** Put a stopped drip back. The mirror of the renewal queue's Undo, and there
 *  for the same reason: a mis-click that silently hides someone forever. */
export async function resumeWinbackDripAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_ID.test(clientId)) return { ok: false, error: "bad client id" };
  const state = await readDrip(clientId);
  if (!state) return { ok: false, error: "no drip on file" };
  state.exited = false;
  delete state.exited_at;
  await writeDrip(state);
  revalidatePath("/dashboard-v2");
  return { ok: true };
}
