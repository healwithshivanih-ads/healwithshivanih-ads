"use server";

/**
 * WhatsApp cycle-date collector.
 *
 * Closes the loop on Piece B. The cycle-aware test recommender needs a
 * CURRENT period-start date; a one-time intake field goes stale. So:
 *
 *   1. listCycleDateAsksDueAction() — scans clients whose next period is
 *      due/overdue and who haven't been asked this cycle. Surfaced on the
 *      dashboard ("actions due") and per-client on the cycle widget.
 *   2. sendCycleDateCheckAction() — coach approves → sends the templated
 *      WhatsApp (fm_cycle_date_check_v1) and stamps last_cycle_ask_sent.
 *   3. recordInboundCycleDate() — the WhatsApp webhook calls this when a
 *      client replies; if they were recently asked and the message carries
 *      a plausible date, last_menstrual_period is auto-updated.
 *
 * Coach-approval-gated by design — nothing auto-sends.
 */

import path from "path";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import yaml from "js-yaml";
import { loadAllClients } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { sendWhatsAppAction } from "@/app/api/whatsapp/actions";
import { extractDate } from "@/lib/start-date-parser";

const CYCLE_TEMPLATE = "fm_cycle_date_check_v1";

function clientYamlPath(clientId: string): string {
  return path.join(getPlansRoot(), "clients", clientId, "client.yaml");
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(isoFrom: string, isoTo: string): number | null {
  const a = Date.parse(isoFrom + "T00:00:00");
  const b = Date.parse(isoTo + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
function addDays(iso: string, n: number): string | null {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── 1. Due detection ────────────────────────────────────────────────────────

export interface CycleAskDueFlag {
  client_id: string;
  display_name: string | null;
  mobile_number: string | null;
  last_menstrual_period: string;
  cycle_length_days: number;
  next_expected: string; // LMP + cycle length
  days_overdue: number; // today − next_expected
  last_cycle_ask_sent: string | null;
}

/**
 * A client is "due for a cycle-date ask" when her next period (LMP +
 * cycle length) is today-or-past AND she hasn't been asked since that
 * LMP. Once she replies with a fresh date, LMP advances and she drops
 * off the list until the next cycle.
 */
export async function listCycleDateAsksDueAction(): Promise<
  { ok: true; flags: CycleAskDueFlag[] } | { ok: false; error: string }
> {
  try {
    const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
    const today = todayIso();
    const flags: CycleAskDueFlag[] = [];
    for (const c of clients) {
      const status = c.cycle_status as string | undefined;
      if (status !== "menstruating" && status !== "perimenopausal") continue;
      const lmpRaw = c.last_menstrual_period as string | undefined;
      const len = c.cycle_length_days as number | undefined;
      if (!lmpRaw || !len || len <= 0) continue;
      const lmp = String(lmpRaw).slice(0, 10);
      const next = addDays(lmp, len);
      if (!next) continue;
      const overdue = daysBetween(next, today);
      if (overdue == null || overdue < 0) continue; // period not due yet
      const lmpAge = daysBetween(lmp, today);
      if (lmpAge != null && lmpAge > 120) continue; // absurdly stale — other problem
      const askRaw = c.last_cycle_ask_sent as string | undefined;
      const ask = askRaw ? String(askRaw).slice(0, 10) : null;
      if (ask && ask >= lmp) continue; // already asked this cycle
      flags.push({
        client_id: c.client_id as string,
        display_name: (c.display_name as string) ?? null,
        mobile_number: (c.mobile_number as string) ?? null,
        last_menstrual_period: lmp,
        cycle_length_days: len,
        next_expected: next,
        days_overdue: overdue,
        last_cycle_ask_sent: ask,
      });
    }
    flags.sort((a, b) => b.days_overdue - a.days_overdue);
    return { ok: true, flags };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to scan clients" };
  }
}

// ── 2. Send (coach-approved) ────────────────────────────────────────────────

/**
 * Send the templated cycle-date check to one client and stamp
 * last_cycle_ask_sent. Coach triggers this from the client page or the
 * dashboard actions-due list.
 */
export async function sendCycleDateCheckAction(
  clientId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const clients = (await loadAllClients()) as Array<Record<string, unknown>>;
    const c = clients.find((x) => x.client_id === clientId);
    if (!c) return { ok: false, error: `Client ${clientId} not found` };
    const phone = ((c.mobile_number as string) ?? "").trim();
    if (!phone) return { ok: false, error: "No mobile number on file" };
    const name = (c.display_name as string) ?? "there";
    const firstName = name.split(/\s+/)[0] || name;

    const sent = await sendWhatsAppAction(phone, CYCLE_TEMPLATE, [firstName]);
    if (!sent.ok) return { ok: false, error: sent.error ?? "WhatsApp send failed" };

    const p = clientYamlPath(clientId);
    const data = yaml.load(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    data.last_cycle_ask_sent = todayIso();
    data.updated_at = new Date().toISOString();
    await fs.writeFile(p, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf8");

    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath("/dashboard-v2");
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Send failed" };
  }
}

// ── 3. Inbound — auto-fill from the client's reply ──────────────────────────

export interface InboundCycleDateResult {
  ok: boolean;
  applied?: boolean;
  date?: string;
  previous?: string | null;
  error?: string;
}

/**
 * Called by the WhatsApp webhook. If this client was sent a cycle-date
 * check in the last 21 days and her reply carries a plausible date, set
 * it as the new last_menstrual_period. Returns null when the message is
 * not a cycle-date reply (so the webhook falls through to its other
 * handlers).
 */
export async function recordInboundCycleDate(
  clientId: string,
  rawText: string
): Promise<InboundCycleDateResult | null> {
  try {
    const p = clientYamlPath(clientId);
    const data = yaml.load(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    const askRaw = data.last_cycle_ask_sent as string | undefined;
    if (!askRaw) return null; // never asked → not a cycle reply
    const askAge = daysBetween(String(askRaw).slice(0, 10), todayIso());
    if (askAge == null || askAge < 0 || askAge > 21) return null; // ask not recent

    const date = extractDate(rawText);
    if (!date) return null; // no date in the reply

    // Sanity — a period start the client is reporting now: within ~45 days
    // past and not more than a week into the future (typo tolerance).
    const diff = daysBetween(date, todayIso());
    if (diff == null || diff < -7 || diff > 45) return null;

    const prev = (data.last_menstrual_period as string | undefined) ?? null;
    data.last_menstrual_period = date;
    data.updated_at = new Date().toISOString();
    await fs.writeFile(p, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf8");

    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath("/dashboard-v2");
    return { ok: true, applied: true, date, previous: prev ? String(prev).slice(0, 10) : null };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? "Failed to record cycle date" };
  }
}
