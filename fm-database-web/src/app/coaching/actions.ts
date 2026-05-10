"use server";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { loadAllClients } from "@/lib/fmdb/loader";
import { sendWhatsAppAction } from "@/app/api/aisensy-webhook/actions";

const PLANS_ROOT = process.env.FMDB_PLANS_DIR ?? path.join(os.homedir(), "fm-plans");
const SEQUENCES_DIR = path.join(PLANS_ROOT, "coaching_sequences");
const LOG_FILE = path.join(PLANS_ROOT, "_coaching_log.yaml");

// ── Types ────────────────────────────────────────────────────────────────────

export type Cadence = "weekly" | "biweekly" | "off";

export interface CoachingMessage {
  week: number;             // week number this message fires on (1-indexed)
  title: string;            // short label for coach
  body: string;             // message body — supports {{name}}, {{first_supplement}}, {{first_practice}}
  campaign_name?: string;   // override AiSensy template name; falls back to sequence default
}

export interface CoachingSequence {
  slug: string;
  name: string;
  description?: string;
  default_campaign_name: string;  // AiSensy template (single {{1}} param expected)
  messages: CoachingMessage[];
}

export interface CoachingLogEntry {
  client_id: string;
  sequence_slug: string;
  week: number;
  sent_at: string;          // ISO timestamp
  status: "sent" | "skipped" | "failed";
  rendered_body?: string;
  error?: string;
  reason?: string;          // for skips
}

export interface QueueItem {
  client_id: string;
  client_name: string;
  mobile_number?: string;
  sequence_slug: string;
  sequence_name: string;
  week: number;
  due_date: string;         // YYYY-MM-DD
  message_title: string;
  rendered_body: string;
  campaign_name: string;
  already_sent: boolean;
  context: { name: string; first_supplement: string; first_practice: string };
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SEQUENCE: CoachingSequence = {
  slug: "foundations",
  name: "Foundations (12 weeks)",
  description:
    "Generic weekly nudges for any FM client on a 12-week foundational protocol. Edit per-week before sending.",
  default_campaign_name: "fm_coaching_nudge",
  messages: [
    { week: 1,  title: "Week 1 — settling in",
      body: "Hi {{name}}! How is week 1 of the protocol landing? The first few days are about settling into the routine — no need to be perfect. Reply with one win and one struggle from this week 🌿" },
    { week: 2,  title: "Week 2 — supplement check",
      body: "Hi {{name}}, hope your week is going well! Quick check: are you taking {{first_supplement}} consistently? Even small gaps are normal — let me know if anything is hard to remember." },
    { week: 3,  title: "Week 3 — practice deepening",
      body: "Hi {{name}}! By now {{first_practice}} should feel a bit more natural. Notice anything shifting — sleep, energy, mood, digestion? Even small changes matter." },
    { week: 4,  title: "Week 4 — first month milestone",
      body: "{{name}}, you've made it through the first month — that's the hardest part! 💚 Take 2 minutes to reflect: what feels different vs day 1? Send me a quick voice note if easier." },
    { week: 5,  title: "Week 5 — keep going",
      body: "Hi {{name}}, halfway through the foundational protocol. This is where consistency really compounds. How are you doing with {{first_supplement}} timing?" },
    { week: 6,  title: "Week 6 — symptom check",
      body: "Hi {{name}}! Quick check-in: of the symptoms we discussed, which ones feel better, the same, or worse? Be honest — this helps me tune the next phase." },
    { week: 7,  title: "Week 7 — gentle nudge",
      body: "Hi {{name}}, just a gentle nudge to stay with {{first_practice}} this week. No pressure — small and consistent always beats perfect and short-lived 🌱" },
    { week: 8,  title: "Week 8 — pre-recheck prep",
      body: "Hi {{name}}, we're 4 weeks out from your recheck. Start thinking about what labs we discussed — happy to help you find a lab if needed." },
    { week: 9,  title: "Week 9 — habit reinforcement",
      body: "Hi {{name}}! Which of your daily habits feels most automatic now? Celebrate that — it means your nervous system has accepted the change 💪" },
    { week: 10, title: "Week 10 — final stretch",
      body: "Hi {{name}}, two weeks left in this phase. Anything you want to ask before our recheck? Send your questions whenever — no need to wait." },
    { week: 11, title: "Week 11 — labs reminder",
      body: "Hi {{name}}, gentle reminder to get the labs done this week if you haven't yet. Aim to share the report at least 2 days before our session 🙏" },
    { week: 12, title: "Week 12 — wrap-up",
      body: "Hi {{name}}, you've completed 12 weeks! 🎉 Take a moment to acknowledge that. We'll review everything in our recheck — looking forward to it." },
  ],
};

// ── Sequence CRUD ────────────────────────────────────────────────────────────

async function ensureSequencesDir(): Promise<void> {
  await fs.mkdir(SEQUENCES_DIR, { recursive: true });
}

async function writeSequence(seq: CoachingSequence): Promise<void> {
  await ensureSequencesDir();
  const file = path.join(SEQUENCES_DIR, `${seq.slug}.yaml`);
  await fs.writeFile(file, yaml.dump(seq, { lineWidth: 120 }), "utf-8");
}

export async function loadCoachingSequencesAction(): Promise<CoachingSequence[]> {
  await ensureSequencesDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(SEQUENCES_DIR);
  } catch {
    entries = [];
  }
  const out: CoachingSequence[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".yaml")) continue;
    try {
      const raw = await fs.readFile(path.join(SEQUENCES_DIR, entry), "utf-8");
      const parsed = yaml.load(raw) as CoachingSequence;
      if (parsed?.slug && Array.isArray(parsed.messages)) out.push(parsed);
    } catch { /* skip malformed */ }
  }
  if (out.length === 0) {
    await writeSequence(DEFAULT_SEQUENCE);
    out.push(DEFAULT_SEQUENCE);
  }
  return out;
}

export async function saveCoachingSequenceAction(
  seq: CoachingSequence
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!seq.slug?.trim()) return { ok: false, error: "Sequence slug is required" };
    await writeSequence(seq);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Per-client coaching config ───────────────────────────────────────────────

export interface ClientCoachingConfig {
  coaching_cadence?: Cadence;
  coaching_sequence_slug?: string;
  coaching_started_at?: string;  // YYYY-MM-DD
}

function clientYamlPath(clientId: string): string {
  return path.join(PLANS_ROOT, "clients", clientId, "client.yaml");
}

export async function updateClientCoachingAction(
  clientId: string,
  config: ClientCoachingConfig
): Promise<{ ok: boolean; error?: string }> {
  try {
    const file = clientYamlPath(clientId);
    const raw = await fs.readFile(file, "utf-8");
    const data = (yaml.load(raw) ?? {}) as Record<string, unknown>;
    if (config.coaching_cadence !== undefined) data.coaching_cadence = config.coaching_cadence;
    if (config.coaching_sequence_slug !== undefined) data.coaching_sequence_slug = config.coaching_sequence_slug;
    if (config.coaching_started_at !== undefined) data.coaching_started_at = config.coaching_started_at;
    await fs.writeFile(file, yaml.dump(data, { lineWidth: 120 }), "utf-8");
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Logging ──────────────────────────────────────────────────────────────────

async function loadLog(): Promise<CoachingLogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    const parsed = yaml.load(raw);
    return Array.isArray(parsed) ? (parsed as CoachingLogEntry[]) : [];
  } catch {
    return [];
  }
}

async function appendLog(entry: CoachingLogEntry): Promise<void> {
  const log = await loadLog();
  log.push(entry);
  await fs.mkdir(PLANS_ROOT, { recursive: true });
  await fs.writeFile(LOG_FILE, yaml.dump(log, { lineWidth: 120 }), "utf-8");
}

export async function loadCoachingLogAction(clientId?: string): Promise<CoachingLogEntry[]> {
  const log = await loadLog();
  return clientId ? log.filter((e) => e.client_id === clientId) : log;
}

// ── Queue computation ────────────────────────────────────────────────────────

interface RawClient {
  client_id: string;
  display_name?: string;
  mobile_number?: string;
  coaching_cadence?: Cadence;
  coaching_sequence_slug?: string;
  coaching_started_at?: string;
}

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function renderTemplate(body: string, ctx: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => ctx[key] ?? `{{${key}}}`);
}

async function loadFirstSupplementAndPractice(clientId: string): Promise<{ supp: string; practice: string }> {
  // Walk client plan files — pick first published plan
  const root = path.join(PLANS_ROOT, "published");
  let files: string[] = [];
  try { files = await fs.readdir(root); } catch { return { supp: "your supplements", practice: "your daily practices" }; }
  for (const f of files) {
    if (!f.endsWith(".yaml")) continue;
    try {
      const raw = await fs.readFile(path.join(root, f), "utf-8");
      const plan = yaml.load(raw) as Record<string, unknown>;
      if (plan.client_id !== clientId) continue;
      const supps = plan.supplement_protocol as Array<Record<string, unknown>> | undefined;
      const practices = plan.lifestyle_practices as Array<Record<string, unknown>> | undefined;
      const supp = supps?.[0]?.display_name as string ?? supps?.[0]?.supplement_slug as string ?? "your supplements";
      const practice = practices?.[0]?.title as string ?? practices?.[0]?.name as string ?? "your daily practices";
      return { supp, practice };
    } catch { /* next */ }
  }
  return { supp: "your supplements", practice: "your daily practices" };
}

export async function computeCoachingQueueAction(
  daysAhead: number = 7
): Promise<QueueItem[]> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoffStr = addDays(todayStr, daysAhead);

  const sequences = await loadCoachingSequencesAction();
  const seqMap = new Map(sequences.map((s) => [s.slug, s]));
  const log = await loadLog();

  const clients = (await loadAllClients()) as unknown as RawClient[];
  const out: QueueItem[] = [];

  for (const c of clients) {
    if (!c.coaching_cadence || c.coaching_cadence === "off") continue;
    if (!c.coaching_started_at) continue;
    const seqSlug = c.coaching_sequence_slug ?? "foundations";
    const seq = seqMap.get(seqSlug);
    if (!seq) continue;

    const stride = c.coaching_cadence === "biweekly" ? 14 : 7;
    const elapsedDays = daysBetween(c.coaching_started_at, todayStr);
    const cutoffElapsed = daysBetween(c.coaching_started_at, cutoffStr);

    const { supp, practice } = await loadFirstSupplementAndPractice(c.client_id);
    const ctx = {
      name: (c.display_name ?? c.client_id).split(" ")[0],
      first_supplement: supp,
      first_practice: practice,
    };

    for (const msg of seq.messages) {
      const dueOffsetDays = (msg.week - 1) * stride;
      // Include if due in window [today, cutoff] or already overdue (still pending)
      if (dueOffsetDays > cutoffElapsed) continue;
      const dueDate = addDays(c.coaching_started_at, dueOffsetDays);
      const alreadySent = log.some(
        (e) => e.client_id === c.client_id && e.sequence_slug === seqSlug && e.week === msg.week && e.status !== "failed"
      );
      // Hide if already sent AND was due more than 1 day ago (avoid clutter)
      if (alreadySent && dueOffsetDays + 1 < elapsedDays) continue;

      out.push({
        client_id: c.client_id,
        client_name: c.display_name ?? c.client_id,
        mobile_number: c.mobile_number,
        sequence_slug: seqSlug,
        sequence_name: seq.name,
        week: msg.week,
        due_date: dueDate,
        message_title: msg.title,
        rendered_body: renderTemplate(msg.body, ctx),
        campaign_name: msg.campaign_name ?? seq.default_campaign_name,
        already_sent: alreadySent,
        context: ctx,
      });
    }
  }

  // Sort by due date ascending, then client name
  out.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.client_name.localeCompare(b.client_name));
  return out;
}

// ── Send / skip ──────────────────────────────────────────────────────────────

export async function sendCoachingNudgeAction(input: {
  client_id: string;
  sequence_slug: string;
  week: number;
  rendered_body: string;
  campaign_name: string;
  mobile_number?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.mobile_number?.trim()) {
    const entry: CoachingLogEntry = {
      client_id: input.client_id, sequence_slug: input.sequence_slug, week: input.week,
      sent_at: new Date().toISOString(), status: "failed",
      rendered_body: input.rendered_body, error: "no mobile number on file",
    };
    await appendLog(entry);
    return { ok: false, error: "no mobile number on file" };
  }

  const result = await sendWhatsAppAction(input.mobile_number, input.campaign_name, [input.rendered_body]);
  const entry: CoachingLogEntry = {
    client_id: input.client_id, sequence_slug: input.sequence_slug, week: input.week,
    sent_at: new Date().toISOString(),
    status: result.ok ? "sent" : "failed",
    rendered_body: input.rendered_body,
    error: result.ok ? undefined : result.error,
  };
  await appendLog(entry);
  revalidatePath("/");
  return result;
}

export async function skipCoachingNudgeAction(input: {
  client_id: string;
  sequence_slug: string;
  week: number;
  reason?: string;
}): Promise<{ ok: boolean }> {
  await appendLog({
    client_id: input.client_id, sequence_slug: input.sequence_slug, week: input.week,
    sent_at: new Date().toISOString(), status: "skipped", reason: input.reason,
  });
  revalidatePath("/");
  return { ok: true };
}
