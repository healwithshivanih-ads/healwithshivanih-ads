"use server";

/**
 * "Notify a client of a material supplement change" — one coach button that
 * does BOTH halves of telling a client "your supplements changed":
 *
 *   1. Sets the in-app "Plan updated" banner (plan.client_update_note) on the
 *      client's PUBLISHED plan, via the same published-safe in-place write +
 *      re-stage path that remedies.ts / weekly-menu.ts use (write the doc to
 *      published/<slug>-vN.yaml, stamp app_content_updated_at, revalidate; the
 *      client app is force-dynamic and reads the synced file).
 *
 *   2. Sends the client the supplement-order WhatsApp — the SAME
 *      fm_supplement_order_v2 UTILITY template the plan-publish follow-up
 *      fires ("Hi {name}, here's the link to order your supplements: {url}"),
 *      carrying a token-gated /supplements/<token> link. Then records the
 *      outbound message so it shows in the coach's WhatsApp thread.
 *
 * Reuses existing primitives ONLY: ensureLetterToken (letter-token.ts, which
 * also re-stages), sendWhatsAppAction + recordOutboundMessageAction
 * (@/app/api/whatsapp/actions). No new WhatsApp template, no new send
 * plumbing, no new staging path.
 *
 * NEVER throws — errors are collected and reported in the return shape so a
 * botched WhatsApp send (or a client with no phone on file) can never leave
 * the coach with an unhandled exception. The in-app banner is set even when
 * the WhatsApp half can't run.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { ensureLetterToken } from "./letter-token";
import { sendWhatsAppAction, recordOutboundMessageAction } from "@/app/api/whatsapp/actions";
import { sendClientEmailAction } from "@/app/api/email/actions";
import { buildSupplementEmail } from "@/lib/fmdb/supplement-email";
import type { OutboundChannel } from "@/lib/fmdb/session-utils";

type Dict = Record<string, unknown>;

/** publicOrigin() — mirrors plan-publish-followups.ts. Public host for the link. */
function publicOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/$/, "");
}

/** firstName() — mirrors plan-publish-followups.ts. */
function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] || displayName || "there";
}

const DEFAULT_NOTE =
  "Your supplement plan was updated — please order the new item from the Supplements tab.";

/** Read a client.yaml → dict (display_name + phone), null on failure. */
async function readClient(clientId: string): Promise<Dict | null> {
  const p = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
  try {
    const d = yaml.load(await fs.readFile(p, "utf-8"));
    return d && typeof d === "object" ? (d as Dict) : null;
  } catch {
    return null;
  }
}

/**
 * Locate the published plan file for a slug (versioned <slug>-vN.yaml, newest
 * version wins) and return its path + parsed doc. Mirrors the direct-file read
 * that remedies.ts / weekly-menu.ts / ensureLetterToken use — a fresh read at
 * write time, so we never clobber a concurrent edit with stale in-memory data.
 */
async function publishedFileForSlug(
  planSlug: string,
): Promise<{ file: string; doc: Dict } | null> {
  const dir = path.join(getPlansRoot(), "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const matches = entries
    .filter((n) => n.startsWith(`${planSlug}-v`) && (n.endsWith(".yaml") || n.endsWith(".yml")))
    .sort()
    .reverse();
  if (matches.length === 0) return null;
  const file = path.join(dir, matches[0]);
  try {
    const doc = (yaml.load(await fs.readFile(file, "utf-8")) as Dict) ?? {};
    return { file, doc };
  } catch {
    return null;
  }
}

export interface NotifySupplementChangeResult {
  ok: boolean;
  /** true if the in-app "Plan updated" banner was set on the published plan. */
  flagged: boolean;
  /** true if the WhatsApp actually went out (only when channel === "whatsapp"). */
  whatsapp_sent: boolean;
  /** true if the notification email actually went out (the default channel). */
  email_sent?: boolean;
  /** Which channel was attempted, so the caller can word its toast correctly. */
  channel?: OutboundChannel;
  error?: string;
}

/**
 * Notify a client that a material supplement change was made — a plan rework OR
 * a new supplement activating within an existing plan.
 *
 * @param input.clientId    the client whose published plan to flag.
 * @param input.planSlug    the published plan slug (e.g. "shivani-plan-2-…").
 * @param input.whatChanged plain-English "what changed this period" (WhatsApp
 *                          {{2}} + banner). Warm, no jargon, no "titrate".
 * @param input.why         plain-English "why" (WhatsApp {{3}}).
 * @param input.note        optional banner override; defaults to a summary of
 *                          whatChanged.
 *
 * WhatsApp: prefers fm_supplement_change_v1 (states WHAT changed + WHY + an
 * "Order supplements" button). Falls back to fm_supplement_order_v2 (bare order
 * link) when whatChanged/why are absent, OR while fm_supplement_change_v1 is
 * still pending Meta approval — so the button always works.
 */
export async function notifySupplementChangeAction(input: {
  clientId: string;
  planSlug: string;
  /** "change" = supplements were modified (swap / new / dose). "activate" = a
   *  supplement ALREADY in the plan is now due to start (phased start_week).
   *  Picks fm_supplement_change_v1 vs fm_supplement_activate_v1. Default "change". */
  mode?: "change" | "activate";
  /** Delivery channel. EMAIL IS THE DEFAULT (coach decision 2026-08-09) —
   *  WhatsApp only when she explicitly asks for it on this send. */
  channel?: OutboundChannel;
  whatChanged?: string;
  why?: string;
  note?: string;
}): Promise<NotifySupplementChangeResult> {
  const errors: string[] = [];
  let flagged = false;
  let whatsappSent = false;

  const clientId = (input.clientId || "").trim();
  const planSlug = (input.planSlug || "").trim();
  if (!clientId || !planSlug) {
    return { ok: false, flagged, whatsapp_sent: whatsappSent, error: "clientId + planSlug required" };
  }

  const mode = input.mode === "activate" ? "activate" : "change";
  const channel: OutboundChannel = input.channel === "whatsapp" ? "whatsapp" : "email";
  let emailSent = false;
  const whatChanged = input.whatChanged?.trim() || "";
  const why = input.why?.trim() || "";
  const bannerLead = !whatChanged
    ? ""
    : mode === "activate"
      ? `Time to start: ${whatChanged} — order it from the Supplements tab.`
      : `${whatChanged} — please order it from the Supplements tab.`;
  const note = input.note?.trim() || bannerLead || DEFAULT_NOTE;

  // ── 1. Set the in-app "Plan updated" banner (published-safe in-place write)
  const hit = await publishedFileForSlug(planSlug);
  if (!hit) {
    return {
      ok: false,
      flagged,
      whatsapp_sent: whatsappSent,
      error: `No published plan file for ${planSlug}.`,
    };
  }
  try {
    const doc = hit.doc;
    doc.client_update_note = note;
    doc.app_content_updated_at = new Date().toISOString();
    doc.updated_at = doc.app_content_updated_at;
    // Atomic temp + rename — mirrors weekly-menu.ts approve / dismiss, so a
    // crash mid-write can't truncate the PHI plan file. The client app is
    // force-dynamic and reads the synced published file, so the banner is live
    // as soon as this lands (staging sync happens out of band + on the
    // ensureLetterToken call below).
    const tmp = `${hit.file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 100 }), "utf-8");
    await fs.rename(tmp, hit.file);
    flagged = true;
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/plan`);
    revalidatePath(`/clients-v2/${clientId}/plan/edit/${planSlug}`);
    revalidatePath(`/plans/${planSlug}`);
  } catch (e) {
    errors.push(`flag: ${(e as Error).message}`);
  }

  // ── 2. Send the supplement-order WhatsApp (same primitives as plan-publish)
  const client = await readClient(clientId);
  const displayName = ((client?.display_name as string) || "").trim();
  const phone = ((client?.mobile_number as string) || "").trim();
  const email = ((client?.email as string) || "").trim();

  // Whichever channel is chosen needs its own address on file. Report the
  // MISSING one specifically — "no email on file" and "no mobile number on
  // file" send the coach to two different fixes.
  const missing =
    channel === "email"
      ? !email && "no email address on file"
      : !phone && "no mobile number on file";
  if (missing) {
    // Banner is still set (above); only the send is skipped.
    errors.push(`${channel}: ${missing} — banner set, message skipped`);
    return {
      ok: flagged,
      flagged,
      whatsapp_sent: false,
      email_sent: false,
      channel,
      error: errors.join("; ") || undefined,
    };
  }

  const fname = firstName(displayName);

  const tokRes = await ensureLetterToken(planSlug);
  if (!tokRes.ok) {
    errors.push(`whatsapp: letter_token ${tokRes.error}`);
    return {
      ok: flagged,
      flagged,
      whatsapp_sent: false,
      error: errors.join("; ") || undefined,
    };
  }

  // Token, never the slug — /supplements is token-gated (mirrors
  // plan-publish-followups.ts).
  const suppUrl = `${publicOrigin()}/supplements/${tokRes.token}`;

  const coach = process.env.COACH_NAME || "Shivani";
  let usedTemplate = "";

  // ── EMAIL (the default channel) ───────────────────────────────────────────
  // One message, no template params, no 24-hour window. Falls back to nothing:
  // if the email fails the coach is told, rather than silently rerouting to a
  // channel she did not choose.
  if (channel === "email") {
    const built = buildSupplementEmail({
      firstName: fname,
      mode,
      whatChanged: whatChanged || "Your supplement list has been updated.",
      why: why || "",
      orderUrl: suppUrl,
      appUrl: (client?.app_token as string)
        ? `${publicOrigin()}/app/${client?.app_token as string}`
        : undefined,
      coachName: coach,
    });
    try {
      const res = await sendClientEmailAction({
        to: email,
        subject: built.subject,
        htmlBody: built.html,
        textBody: built.text,
      });
      if (res.ok) {
        emailSent = true;
        usedTemplate = mode === "activate" ? "email_supplement_activate" : "email_supplement_change";
      } else {
        errors.push(`email: ${res.error || "send_failed"}`);
      }
    } catch (e) {
      errors.push(`email: ${(e as Error).message}`);
    }

    if (emailSent) {
      // Same rolling thread as a WhatsApp send, tagged email_outbound — so the
      // chat panel shows it and the button's "✓ Sent · Resend" state survives
      // a reload (feedback-send-buttons-persist-state).
      try {
        await recordOutboundMessageAction({
          clientId,
          templateName: usedTemplate,
          renderedBody: built.text,
          channel: "email",
        });
      } catch {
        /* audit-only — the send already succeeded */
      }
    }

    const okEmail = flagged && emailSent;
    return {
      ok: okEmail,
      flagged,
      whatsapp_sent: false,
      email_sent: emailSent,
      channel,
      error: errors.join("; ") || undefined,
    };
  }

  // ── WHATSAPP (only when explicitly requested) ─────────────────────────────

  // Prefer the detailed "what changed + why" template when we have both fields.
  // If it errors (e.g. still PENDING Meta approval), fall through to the bare
  // order-link template so the coach's click always reaches the client.
  const detailedTemplate =
    mode === "activate" ? "fm_supplement_activate_v1" : "fm_supplement_change_v1";
  if (whatChanged && why) {
    try {
      const res = await sendWhatsAppAction(
        phone,
        detailedTemplate,
        [fname, whatChanged, why],
        { name: displayName || fname, buttonUrlParam: tokRes.token },
      );
      if (res.ok) {
        whatsappSent = true;
        usedTemplate = detailedTemplate;
      } else {
        errors.push(`whatsapp(detailed): ${res.error || "send_failed"} — falling back to order link`);
      }
    } catch (e) {
      errors.push(`whatsapp(detailed): ${(e as Error).message} — falling back to order link`);
    }
  }

  if (!whatsappSent) {
    try {
      const res = await sendWhatsAppAction(
        phone,
        "fm_supplement_order_v2",
        [fname, suppUrl],
        { name: displayName || fname },
      );
      if (res.ok) {
        whatsappSent = true;
        usedTemplate = "fm_supplement_order_v2";
      } else {
        errors.push(`whatsapp: ${res.error || "send_failed"}`);
      }
    } catch (e) {
      errors.push(`whatsapp: ${(e as Error).message}`);
    }
  }

  if (whatsappSent) {
    // Persist a thread record so the send is visible in the WA panel + the coach
    // button can read its "✓ Sent · Resend" state on reload (durable rule
    // feedback-send-buttons-persist-state).
    let body: string;
    if (usedTemplate === "fm_supplement_change_v1") {
      body = `Hi ${fname} 👋 A quick update to your plan from ${coach}.\n\nWhat's changed this time:\n${whatChanged}\n\nWhy:\n${why}\n\nOrder your supplements:\n${suppUrl}\n\n— ${coach}`;
    } else if (usedTemplate === "fm_supplement_activate_v1") {
      body = `Hi ${fname} 👋 A note from ${coach}.\n\nAs planned, it's time to start the next supplement in your plan:\n${whatChanged}\n\n${why}\n\nOrder it here:\n${suppUrl}\n\n— ${coach}`;
    } else {
      body = `Hi ${fname}, here's the link to order your supplements:\n\n${suppUrl}\n\n— ${coach}`;
    }
    try {
      await recordOutboundMessageAction({ clientId, templateName: usedTemplate, renderedBody: body });
    } catch {
      /* audit-only — the send already succeeded */
    }
  }

  const ok = flagged && whatsappSent;
  return {
    ok,
    flagged,
    whatsapp_sent: whatsappSent,
    email_sent: false,
    channel,
    error: errors.length ? errors.join("; ") : undefined,
  };
}
