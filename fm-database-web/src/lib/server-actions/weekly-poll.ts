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

import { sendWhatsAppAction } from "@/app/api/whatsapp/actions";
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import type { PollDimension, PollScore } from "@/lib/poll-labels";
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
    const r = await sendWhatsAppAction(phone, campaignName, [name]);
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
