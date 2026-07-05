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
  /** true if the fm_supplement_order_v2 WhatsApp actually went out. */
  whatsapp_sent: boolean;
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

  const whatChanged = input.whatChanged?.trim() || "";
  const why = input.why?.trim() || "";
  const note =
    input.note?.trim() ||
    (whatChanged ? `${whatChanged} — please order it from the Supplements tab.` : DEFAULT_NOTE);

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

  if (!phone) {
    // No phone → banner is still set (above); skip WA, report clearly.
    errors.push("whatsapp: no mobile number on file — banner set, WhatsApp skipped");
    return {
      ok: flagged,
      flagged,
      whatsapp_sent: false,
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

  // Prefer the detailed "what changed + why" template when we have both fields.
  // If it errors (e.g. still PENDING Meta approval), fall through to the bare
  // order-link template so the coach's click always reaches the client.
  if (whatChanged && why) {
    try {
      const res = await sendWhatsAppAction(
        phone,
        "fm_supplement_change_v1",
        [fname, whatChanged, why],
        { name: displayName || fname, buttonUrlParam: tokRes.token },
      );
      if (res.ok) {
        whatsappSent = true;
        usedTemplate = "fm_supplement_change_v1";
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
    const body =
      usedTemplate === "fm_supplement_change_v1"
        ? `Hi ${fname} 👋 A quick update to your plan from ${coach}.\n\nWhat's changed this time:\n${whatChanged}\n\nWhy:\n${why}\n\nOrder your supplements:\n${suppUrl}\n\n— ${coach}`
        : `Hi ${fname}, here's the link to order your supplements:\n\n${suppUrl}\n\n— ${coach}`;
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
    error: errors.length ? errors.join("; ") : undefined,
  };
}
