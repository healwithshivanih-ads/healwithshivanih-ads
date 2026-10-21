"use server";

/**
 * Prospects' email replies — the I/O half (pure rules: lib/fmdb/email-replies.ts).
 *
 * Hourly (`email-replies` cron, :05): reads the coach's mailbox READ-ONLY for
 * mail from anyone who has not signed up, and for each new message:
 *   1. records it in their thread as an inbound email — so the call follow-up
 *      and the content notes hold while they are in conversation, and the
 *      coach sees the reply on their page;
 *   2. if it asks us to stop ("no more", "unsubscribe", "stop sending…"),
 *      opts them out of content notes AND stops their call follow-up, skipping
 *      anything waiting. The reason is written on the record, and the coach
 *      can undo it from the dashboard.
 *
 * Nothing is sent. State: ~/fm-plans/_email_replies.yaml (message ids seen).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { runShim } from "@/lib/fmdb/shim";
import { optOutPhrase, replyBody } from "@/lib/fmdb/email-replies";
import { recordInboundEmailAction } from "@/app/api/whatsapp/actions";
import { stopFollowupAction } from "@/lib/server-actions/discovery-followup";
import { setNotesOptOutAction } from "@/lib/server-actions/interest-tracking";

const STATE_FILE = "_email_replies.yaml";
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
/** How far back each run looks. Seen ids make re-reads free. */
const LOOKBACK_DAYS = 14;
/** Seen ids kept — far more than two weeks of replies. */
const MAX_SEEN = 2000;

interface SeenEntry {
  client_id: string;
  at: string;
  opt_out?: string;
}

interface ReplyState {
  seen: Record<string, SeenEntry>;
  last_run?: string;
}

interface FetchedMessage {
  message_id: string;
  from: string;
  subject: string;
  date: string;
  text: string;
}

async function readState(): Promise<ReplyState> {
  try {
    const d = yaml.load(await fs.readFile(path.join(getPlansRoot(), STATE_FILE), "utf-8")) as ReplyState | null;
    return { seen: d?.seen && typeof d.seen === "object" ? d.seen : {}, last_run: d?.last_run };
  } catch {
    return { seen: {} };
  }
}

async function writeState(s: ReplyState): Promise<void> {
  const entries = Object.entries(s.seen).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_SEEN);
  const f = path.join(getPlansRoot(), STATE_FILE);
  await fs.writeFile(`${f}.tmp`, yaml.dump({ last_run: s.last_run, seen: Object.fromEntries(entries) }, { lineWidth: -1 }), "utf-8");
  await fs.rename(`${f}.tmp`, f);
}

/** email (lower-case) → client id, for everyone not signed up, both buckets. */
async function prospectsByEmail(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const bucket of ["clients", "prospects"]) {
    let ids: string[] = [];
    try {
      ids = await fs.readdir(path.join(getPlansRoot(), bucket));
    } catch {
      continue;
    }
    for (const id of ids) {
      if (!SAFE_ID.test(id)) continue;
      try {
        const doc = yaml.load(await fs.readFile(path.join(getPlansRoot(), bucket, id, "client.yaml"), "utf-8")) as Record<string, unknown> | null;
        if (!doc) continue;
        const es = String(doc.engagement_status ?? "").trim();
        if (es === "signed_up" || es === "lapsed") continue;
        const email = String(doc.email ?? "").trim().toLowerCase();
        if (email.includes("@") && !out.has(email)) out.set(email, id);
      } catch {
        /* unreadable record — skip */
      }
    }
  }
  return out;
}

export interface ReplyScanResult {
  ok: boolean;
  recorded: number;
  optedOut: Array<{ clientId: string; phrase: string }>;
  error?: string;
}

/**
 * The hourly job. `apply: false` reads and decides but writes nothing — the
 * dry run used to check it against the real mailbox before it went live.
 */
export async function scanEmailRepliesAction(opts: { apply?: boolean } = {}): Promise<ReplyScanResult> {
  const apply = opts.apply ?? true;
  const state = await readState();
  const byEmail = await prospectsByEmail();
  const res: ReplyScanResult = { ok: true, recorded: 0, optedOut: [] };
  if (byEmail.size === 0) return res;

  const out = (await runShim(
    "fetch-email-replies.py",
    { addresses: [...byEmail.keys()], since_days: LOOKBACK_DAYS, skip_ids: Object.keys(state.seen) },
    120_000,
  )) as { ok: boolean; messages?: FetchedMessage[]; error?: string | null };
  if (!out?.ok) {
    // A mailbox that cannot be read is an error to see, not a quiet hour.
    return { ok: false, recorded: 0, optedOut: [], error: out?.error ?? "mailbox read failed" };
  }

  const msgs = (out.messages ?? []).sort((a, b) => a.date.localeCompare(b.date));
  for (const m of msgs) {
    const clientId = byEmail.get(m.from.toLowerCase());
    if (!clientId || state.seen[m.message_id]) continue;
    const body = replyBody(m.text);
    const phrase = optOutPhrase(body);
    if (apply) {
      const rec = await recordInboundEmailAction({
        clientId,
        subject: m.subject,
        body: body || "(empty reply)",
        receivedAt: m.date,
      });
      if (!rec.ok) {
        // Not marked seen: the next hour tries again.
        console.error(`[email-replies] could not record ${m.message_id} for ${clientId}: ${rec.error}`);
        continue;
      }
      if (phrase) {
        await setNotesOptOutAction(clientId, true, `replied by email: "${phrase}"`);
        await stopFollowupAction(clientId);
      }
      state.seen[m.message_id] = { client_id: clientId, at: m.date, ...(phrase ? { opt_out: phrase } : {}) };
    }
    res.recorded++;
    if (phrase) res.optedOut.push({ clientId, phrase });
  }
  if (apply) {
    state.last_run = new Date().toISOString();
    await writeState(state);
    if (res.recorded) revalidatePath("/dashboard-v2");
  }
  return res;
}
