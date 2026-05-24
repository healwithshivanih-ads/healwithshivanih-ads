"use server";

/**
 * Weekly WhatsApp check-in poll (v0.73 — self-hosted WhatsApp Cloud API).
 *
 * Coach clicks "Send weekly poll" on the dashboard → we WhatsApp every active
 * client a templated message with interactive reply buttons. Client taps a
 * button → the self-hosted whatsapp-server-shivani Fly app receives Meta's
 * webhook, forwards to /api/whatsapp-webhook here, we save the reply as a
 * tagged `quick_note` session and look across the last 3 polls to flag
 * adherence drops.
 *
 * Meta WABA side (one-time setup by coach in Business Manager):
 *   Campaign name: `fm_weekly_check_in_v1`
 *   Template body: "Hi {{1}} 👋 Quick weekly check-in from Shivani.
 *                   How's it going overall this week?"
 *   Quick reply buttons (3): "All good 🌿", "Some struggles", "Need help"
 *
 *   For supplement adherence (separate template `fm_weekly_supplement_v1`):
 *   "How are the supplements?" → buttons: "All taken", "Missed 1-2 days", "Stopped"
 *
 *   For meals (template `fm_weekly_meals_v1`):
 *   "Sticking to the meal plan?" → buttons: "Yes mostly", "Half the time", "Struggling"
 *
 *   For movement (template `fm_weekly_movement_v1`):
 *   "Movement this week?" → buttons: "Most days", "A few times", "None"
 *
 * The webhook (api/whatsapp-webhook/route.ts) recognises these button
 * labels via POLL_BUTTON_LABELS below and saves a structured
 * `poll_response` field on the session.
 *
 * NOTE: Templates must be approved by Meta and registered on the
 * self-hosted WhatsApp server before they'll send. That's the only step
 * the coach has to do manually outside this app.
 */

import { sendAndRecordOutboundAction } from "@/app/api/whatsapp/actions";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import type { PollDimension, PollScore, PillarKey } from "@/lib/poll-labels";
import {
  PILLAR_ROTATION,
  pillarToTemplateName,
} from "@/lib/poll-labels";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import yaml from "js-yaml";

const PLANS_ROOT =
  process.env.FMDB_PLANS_DIR ?? path.join(os.homedir(), "fm-plans");

// Pure label classifier lives in @/lib/poll-labels (see classifyPollReply there).

// ── Send weekly poll ───────────────────────────────────────────────────────

export interface SendWeeklyPollResult {
  ok: boolean;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
  sent_to: string[];
}

/**
 * Send the weekly poll to a list of clients (or auto-select active clients
 * if `clientIds` is empty). Each client gets ONE message — the overall
 * check-in template. If they reply, the webhook routes them through the
 * dimension-specific follow-up templates automatically (see webhook).
 */
export async function sendWeeklyPollAction(
  clientIds?: string[],
  campaignName: string = "fm_weekly_check_in_v1",
): Promise<SendWeeklyPollResult> {
  const errors: string[] = [];
  const sentTo: string[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const allClients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const allPlans = (await loadAllPlans()) as Array<Record<string, unknown>>;
  const publishedClientIds = new Set(
    allPlans
      .filter(
        (p) =>
          ((p.status as string) ?? (p._bucket as string)) === "published",
      )
      .map((p) => p.client_id as string),
  );

  const targetIds =
    clientIds && clientIds.length > 0
      ? clientIds
      : (allClients
          .filter((c) => publishedClientIds.has(c.client_id as string))
          .map((c) => c.client_id as string));

  for (const id of targetIds) {
    const c = allClients.find((x) => x.client_id === id);
    if (!c) {
      errors.push(`${id}: client not found`);
      failed++;
      continue;
    }
    const phone = (c.mobile_number as string | undefined) ?? "";
    if (!phone.trim()) {
      errors.push(`${id}: no mobile number on file`);
      skipped++;
      continue;
    }
    const name = (c.display_name as string | undefined) ?? "there";
    // Approximate body — Meta templates fm_weekly_check_in_v1 / supplement / meals / movement
    // all use the same "Hi {{1}} 👋 Quick weekly check-in…" preamble (per
    // CLAUDE.md v0.69 notes). The exact button copy is template-specific
    // but the chat-thread record only needs the body text.
    const renderedBody =
      `Hi ${name} 👋 Quick weekly check-in — how did the past 7 days go? ` +
      `Tap one of the buttons below to let me know.`;
    const r = await sendAndRecordOutboundAction({
      phone,
      clientId: id,
      templateName: campaignName,
      templateParams: [name],
      renderedBody,
    });
    if (r.ok) {
      sent++;
      sentTo.push(id);
    } else {
      errors.push(`${id}: ${r.error ?? "send failed"}`);
      failed++;
    }
  }

  // Audit log — append to ~/fm-plans/_weekly_poll_log.yaml
  try {
    const logFile = path.join(PLANS_ROOT, "_weekly_poll_log.yaml");
    let existing: unknown[] = [];
    try {
      const raw = await fs.readFile(logFile, "utf-8");
      const parsed = yaml.load(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      /* file doesn't exist yet */
    }
    existing.push({
      sent_at: new Date().toISOString(),
      campaign: campaignName,
      requested: targetIds.length,
      sent,
      skipped,
      failed,
      sent_to: sentTo,
      errors: errors.slice(0, 50),
    });
    await fs.mkdir(PLANS_ROOT, { recursive: true });
    await fs.writeFile(
      logFile,
      yaml.dump(existing, { lineWidth: 120 }),
      "utf-8",
    );
  } catch (err) {
    console.error("[weekly-poll] Failed to write audit log:", err);
  }

  return {
    ok: failed === 0,
    sent,
    skipped,
    failed,
    errors,
    sent_to: sentTo,
  };
}

// ── 3-strike adherence-drop check ──────────────────────────────────────────

export interface AdherenceDropFlag {
  client_id: string;
  display_name?: string;
  strikes: number;                        // count of "struggling" or "partial" replies in last N weeks
  dimensions_flagged: PollDimension[];    // which dims drove the flag
  last_response_at?: string;
}

/**
 * Scan recent quick_note sessions tagged `[source: weekly_check_in_poll]`
 * across all clients. Surface any client with 2+ "struggling" or 3+ "partial"
 * responses in the trailing 28-day window — these are candidates for a
 * plan rework via `assess-rework.py`.
 */
export async function detectAdherenceDropsAction(
  windowDays: number = 28,
): Promise<{ ok: true; flags: AdherenceDropFlag[] } | { ok: false; error: string }> {
  try {
    const allClients = (await loadAllClients()) as Array<
      Record<string, unknown>
    >;
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const flags: AdherenceDropFlag[] = [];

    for (const c of allClients) {
      const id = c.client_id as string;
      const sessionsDir = path.join(PLANS_ROOT, "clients", id, "sessions");
      let files: string[] = [];
      try {
        files = await fs.readdir(sessionsDir);
      } catch {
        continue;
      }
      let strikesStruggling = 0;
      let strikesPartial = 0;
      const dimsFlagged = new Set<PollDimension>();
      let lastResp: string | undefined;

      for (const fn of files) {
        if (!fn.endsWith(".yaml")) continue;
        // Filename starts with YYYY-MM-DD; cheap date filter before read.
        const datePart = fn.slice(0, 10);
        const ts = Date.parse(datePart);
        if (!isNaN(ts) && ts < cutoff) continue;

        try {
          const raw = await fs.readFile(path.join(sessionsDir, fn), "utf-8");
          const data = yaml.load(raw) as Record<string, unknown>;
          const presenting = (data.presenting_complaints as string) ?? "";
          if (!presenting.includes("[source: weekly_check_in_poll]")) continue;

          // poll_response field is set by the webhook
          const pr = data.poll_response as
            | { dim?: PollDimension; score?: PollScore }
            | undefined;
          if (!pr) continue;

          if (pr.score === "struggling") {
            strikesStruggling++;
            if (pr.dim) dimsFlagged.add(pr.dim);
          } else if (pr.score === "partial") {
            strikesPartial++;
            if (pr.dim) dimsFlagged.add(pr.dim);
          }
          const d = (data.date as string) ?? datePart;
          if (!lastResp || d > lastResp) lastResp = d;
        } catch {
          /* skip unreadable session */
        }
      }

      // 3-strike rule: 2+ struggling OR 3+ partial in trailing window.
      const strikes = strikesStruggling + strikesPartial;
      const trip = strikesStruggling >= 2 || strikesPartial >= 3;
      if (trip) {
        flags.push({
          client_id: id,
          display_name: c.display_name as string | undefined,
          strikes,
          dimensions_flagged: Array.from(dimsFlagged),
          last_response_at: lastResp,
        });
      }
    }

    return { ok: true, flags };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to scan poll responses" };
  }
}

// ── Tier 1: Five Pillars rotating poll (added 2026-05-24) ───────────────────
//
// Single weekly send per client, rotating through the 5 pillars: sleep →
// stress → movement → nutrition → connection → sleep ... Over 5 weeks a
// full Five Pillars snapshot fills out from button taps alone — no manual
// check-in form required. The 6th file (this rotation) doesn't supersede
// the manual FivePillarsCapture widget; it complements it for cadence.
//
// Rotation state is derived from the client's sessions on disk — we look
// for the most-recent outbound segment tagged [template: fm_weekly_<X>]
// among the 5 pillar templates, and advance to the next pillar in
// PILLAR_ROTATION. First-time clients (no prior pillar send) start at
// "sleep".

const PILLAR_TEMPLATE_NAMES = PILLAR_ROTATION.map(pillarToTemplateName);

/** Scan a client's sessions for the most recent outbound segment matching
 *  any of the pillar templates. Returns the pillar key + sent_at ISO.
 *  Used to pick the NEXT pillar in the rotation. */
async function lastPillarSent(
  clientId: string,
): Promise<{ pillar: PillarKey; sent_at: string } | null> {
  const dir = path.join(PLANS_ROOT, "clients", clientId, "sessions");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  let best: { pillar: PillarKey; sent_at: string } | null = null;
  for (const name of names) {
    if (!(name.endsWith(".yaml") || name.endsWith(".yml"))) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      const data = yaml.load(raw) as Record<string, unknown>;
      const complaints = String(data?.presenting_complaints ?? "");
      if (!complaints.includes("[template:")) continue;
      const segments = complaints.split(/\n\s*---\s*\n/);
      for (const seg of segments) {
        const tplMatch = seg.match(/\[template:\s*([^\]]+)\]/);
        if (!tplMatch) continue;
        const tpl = tplMatch[1].trim();
        const idx = PILLAR_TEMPLATE_NAMES.indexOf(tpl);
        if (idx < 0) continue;
        const atMatch = seg.match(/\[sent_at:\s*([^\]]+)\]/);
        if (!atMatch) continue;
        const at = atMatch[1].trim();
        if (!best || at > best.sent_at) {
          best = { pillar: PILLAR_ROTATION[idx], sent_at: at };
        }
      }
    } catch {
      /* skip unreadable */
    }
  }
  return best;
}

/** Given the most recent pillar sent, return the NEXT pillar to send.
 *  null input → start of rotation. */
function nextPillarAfter(last: PillarKey | null): PillarKey {
  if (!last) return PILLAR_ROTATION[0];
  const idx = PILLAR_ROTATION.indexOf(last);
  if (idx < 0) return PILLAR_ROTATION[0];
  return PILLAR_ROTATION[(idx + 1) % PILLAR_ROTATION.length];
}

export interface RotationPreview {
  client_id: string;
  display_name: string | null;
  mobile_number: string | null;
  last_pillar: PillarKey | null;
  last_sent_at: string | null;
  next_pillar: PillarKey;
  next_template: string;
}

/**
 * Show what the rotating poll WOULD send to each client without actually
 * sending. Used by the dashboard UI to render the per-client preview row
 * before the coach confirms.
 */
export async function previewPillarRotationAction(
  clientIds: string[],
): Promise<{ ok: true; rows: RotationPreview[] } | { ok: false; error: string }> {
  try {
    const allClients = (await loadAllClients()) as Array<Record<string, unknown>>;
    const rows: RotationPreview[] = [];
    for (const id of clientIds) {
      const c = allClients.find((x) => x.client_id === id);
      if (!c) continue;
      const last = await lastPillarSent(id);
      const next = nextPillarAfter(last?.pillar ?? null);
      rows.push({
        client_id: id,
        display_name: (c.display_name as string | undefined) ?? null,
        mobile_number: (c.mobile_number as string | undefined) ?? null,
        last_pillar: last?.pillar ?? null,
        last_sent_at: last?.sent_at ?? null,
        next_pillar: next,
        next_template: pillarToTemplateName(next),
      });
    }
    return { ok: true, rows };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "preview failed" };
  }
}

/**
 * Send the rotating Five Pillars poll to a list of clients. Each client
 * gets ONE message — the next pillar in their rotation. If `clientIds` is
 * empty, auto-selects all clients with a published plan (same default as
 * sendWeeklyPollAction).
 *
 * Returns per-client outcome so the UI can show "Hariharan: sent sleep
 * poll ✓ / Dhanishta: skipped (no mobile)".
 */
export interface PillarSendOutcome {
  client_id: string;
  pillar: PillarKey | null;
  template: string | null;
  ok: boolean;
  error?: string;
  skipped_reason?: string;
}

export interface SendPillarRotationResult {
  ok: boolean;
  sent: number;
  skipped: number;
  failed: number;
  outcomes: PillarSendOutcome[];
}

export async function sendPillarRotationAction(
  clientIds?: string[],
): Promise<SendPillarRotationResult> {
  const allClients = (await loadAllClients()) as Array<Record<string, unknown>>;
  const allPlans = (await loadAllPlans()) as Array<Record<string, unknown>>;
  const publishedClientIds = new Set(
    allPlans
      .filter(
        (p) =>
          ((p.status as string) ?? (p._bucket as string)) === "published",
      )
      .map((p) => p.client_id as string),
  );

  const targetIds =
    clientIds && clientIds.length > 0
      ? clientIds
      : allClients
          .filter((c) => publishedClientIds.has(c.client_id as string))
          .map((c) => c.client_id as string);

  const outcomes: PillarSendOutcome[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const sentTo: string[] = [];

  for (const id of targetIds) {
    const c = allClients.find((x) => x.client_id === id);
    if (!c) {
      outcomes.push({ client_id: id, pillar: null, template: null, ok: false, error: "client not found" });
      failed++;
      continue;
    }
    const phone = (c.mobile_number as string | undefined) ?? "";
    if (!phone.trim()) {
      outcomes.push({ client_id: id, pillar: null, template: null, ok: false, skipped_reason: "no mobile" });
      skipped++;
      continue;
    }
    const name = (c.display_name as string | undefined) ?? "there";
    const last = await lastPillarSent(id);
    const pillar = nextPillarAfter(last?.pillar ?? null);
    const template = pillarToTemplateName(pillar);

    // Body mirrors the approved Meta template body so the rolling-thread
    // record reads naturally in the chat panel.
    // Mirror the Meta-approved template bodies so the rolling-thread
    // record reads identically to what the client received. v2 bodies
    // for sleep/stress/connection (MARKETING, warm); v1 bodies for
    // movement/nutrition (UTILITY, dry). Keep these in sync with
    // whatsapp-server/scripts/submit-templates.js.
    const bodyByPillar: Record<PillarKey, string> = {
      sleep:
        `*Your weekly sleep check-in* 🌙\n\n` +
        `Hi ${name}, taking a moment to feel into how this week went for sleep.\n\n` +
        `Was it:\n` +
        `• *Restorative* — falling asleep easily, waking refreshed\n` +
        `• *Patchy* — some nights great, some restless\n` +
        `• *Hard* — struggling to fall or stay asleep\n\n` +
        `Tap below — your answer flows into next week's adjustments.\n\n` +
        `— Shivani`,
      stress:
        `*Your weekly stress check-in* 🌿\n\n` +
        `Hi ${name}, how is your nervous system doing this week?\n\n` +
        `Was the load:\n` +
        `• *Manageable* — handled what came up, came back to baseline\n` +
        `• *Some pressure* — felt it, mostly stayed steady\n` +
        `• *Overwhelming* — full, hard to come down\n\n` +
        `Tap below — your answer shapes which practices we lean on next week.\n\n` +
        `— Shivani`,
      movement:
        `*Your weekly movement check-in* 🏃\n\n` +
        `Hi ${name}, how did your body get to move this week?\n\n` +
        `Movement happened:\n` +
        `• *Most days* — walks, workouts, stretching woven through the week\n` +
        `• *A few times* — a couple of sessions or active days\n` +
        `• *None* — felt too full, too tired, too stretched\n\n` +
        `Tap below — your answer shapes what we lean into next week.\n\n` +
        `— Shivani`,
      nutrition:
        `*Your weekly nutrition check-in* 🍽\n\n` +
        `Hi ${name}, how did meals + food feel this week?\n\n` +
        `Was eating:\n` +
        `• *Yes mostly* — aligned with the plan, recipes came together\n` +
        `• *Half the time* — some meals on track, others off\n` +
        `• *Struggling* — hard to plan, eat, or stay with it\n\n` +
        `Tap below — your answer guides next week's meal focus.\n\n` +
        `— Shivani`,
      connection:
        `*Your weekly connection check-in* 🤝\n\n` +
        `Hi ${name}, checking in on how connected you've felt this week — to people, routine, yourself.\n\n` +
        `Did you feel:\n` +
        `• *Connected* — present, anchored in routine\n` +
        `• *Some of the time* — moments of both\n` +
        `• *Disconnected* — pulled away, hard to land\n\n` +
        `Tap below — your answer guides where we lean next.\n\n` +
        `— Shivani`,
    };
    const renderedBody = bodyByPillar[pillar];

    const r = await sendAndRecordOutboundAction({
      phone,
      clientId: id,
      templateName: template,
      templateParams: [name],
      renderedBody,
    });
    if (r.ok) {
      sent++;
      sentTo.push(id);
      outcomes.push({ client_id: id, pillar, template, ok: true });
    } else {
      failed++;
      outcomes.push({ client_id: id, pillar, template, ok: false, error: r.error ?? "send failed" });
    }
  }

  // Audit row in the same _weekly_poll_log.yaml file so the dashboard's
  // lastSentByCampaign loader can read pillar sends alongside the legacy
  // overall poll. campaign = "fm_pillar_rotation_v1" (logical name; the
  // actual Meta template varies per client).
  try {
    const logFile = path.join(PLANS_ROOT, "_weekly_poll_log.yaml");
    let existing: unknown[] = [];
    try {
      const raw = await fs.readFile(logFile, "utf-8");
      const parsed = yaml.load(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      /* file doesn't exist yet */
    }
    existing.push({
      sent_at: new Date().toISOString(),
      campaign: "fm_pillar_rotation_v1",
      requested: targetIds.length,
      sent,
      skipped,
      failed,
      sent_to: sentTo,
      pillar_breakdown: outcomes
        .filter((o) => o.ok && o.pillar)
        .reduce<Record<string, number>>((acc, o) => {
          acc[o.pillar!] = (acc[o.pillar!] ?? 0) + 1;
          return acc;
        }, {}),
    });
    await fs.mkdir(PLANS_ROOT, { recursive: true });
    await fs.writeFile(
      logFile,
      yaml.dump(existing, { lineWidth: 120 }),
      "utf-8",
    );
  } catch (err) {
    console.error("[pillar-rotation] audit log write failed:", err);
  }

  return { ok: failed === 0, sent, skipped, failed, outcomes };
}
