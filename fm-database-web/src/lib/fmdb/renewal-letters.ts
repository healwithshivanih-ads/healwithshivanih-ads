import "server-only";

/**
 * Renewal letters — the drafted-but-not-yet-sent record behind the "Plans
 * ending" queue.
 *
 * WHY THIS EXISTS: the daily digest has told the coach since 3 Aug 2026 to
 * "approve the letter here and it goes out on the day" — and there was nowhere
 * to read a letter, nowhere to approve one, and nothing that sent one. Letters
 * were authored in chat and dropped as loose `.txt` files in this same
 * directory that no code ever read. This is the structured record that closes
 * that loop: a letter is authored in chat (staged as `drafted`), the coach
 * reads and approves it on the dashboard (`approved`, with a send date), and a
 * daily cron mails it on the plan-end day (`sent`).
 *
 * Deliberately a sidecar keyed by plan slug, exactly like _renewal_decisions.
 * The decision ("did they renew?") and the letter ("what did we send and
 * when?") are two different facts about one plan ending, and separating them
 * keeps each store simple. When the cron sends a letter it records the
 * `offer_sent` decision — the value winbackDecision() already fails closed on —
 * so a sent letter drops out of the open queue AND holds off the win-back drip
 * until the coach records renewed/not_renewing.
 *
 * Nothing here sends anything. The cron does the sending; this only reads and
 * writes the record.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { dumpYaml } from "./yaml-dump";
import { getPlansRoot } from "./paths";

export type RenewalLetterStatus = "drafted" | "approved" | "sent";

export interface RenewalLetter {
  plan_slug: string;
  client_id: string;
  client_name: string;
  /** Recipient email captured at staging time. */
  to: string;
  subject: string;
  body: string;
  /** Human label for the offer, shown in the panel + digest, e.g.
   *  "Continue — 12 weeks · ₹85,000". Never parsed; display only. */
  offer_label: string;
  status: RenewalLetterStatus;
  /** YYYY-MM-DD the letter is due to send. Set on approval to the plan-end
   *  date; null while still a draft. */
  scheduled_for: string | null;
  drafted_at: string;
  approved_at: string | null;
  sent_at: string | null;
}

// Same slug shape the rest of the renewal code validates against.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/i;

function lettersDir(): string {
  return path.join(getPlansRoot(), "_renewal_letters");
}

function fileFor(planSlug: string): string {
  return path.join(lettersDir(), `${planSlug}.yaml`);
}

/** Lenient shape check — a hand-mangled file is skipped, never crashes a read. */
function asLetter(v: unknown): RenewalLetter | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.plan_slug !== "string" || typeof o.body !== "string") return null;
  const status = o.status;
  if (status !== "drafted" && status !== "approved" && status !== "sent") return null;
  return {
    plan_slug: o.plan_slug,
    client_id: String(o.client_id ?? ""),
    client_name: String(o.client_name ?? o.client_id ?? ""),
    to: String(o.to ?? ""),
    subject: String(o.subject ?? ""),
    body: o.body,
    offer_label: String(o.offer_label ?? ""),
    status,
    scheduled_for: typeof o.scheduled_for === "string" ? o.scheduled_for : null,
    drafted_at: String(o.drafted_at ?? ""),
    approved_at: typeof o.approved_at === "string" ? o.approved_at : null,
    sent_at: typeof o.sent_at === "string" ? o.sent_at : null,
  };
}

/** One letter by plan slug, or null when none is on file. */
export function loadRenewalLetter(planSlug: string): RenewalLetter | null {
  if (!SLUG_RE.test(planSlug)) return null;
  try {
    return asLetter(yaml.load(fs.readFileSync(fileFor(planSlug), "utf-8")));
  } catch {
    return null;
  }
}

/** Every letter on file, keyed by plan slug. Legacy loose `.txt` drops and any
 *  unparseable `.yaml` are silently ignored. */
export function loadAllRenewalLetters(): Record<string, RenewalLetter> {
  const out: Record<string, RenewalLetter> = {};
  let names: string[] = [];
  try {
    names = fs.readdirSync(lettersDir()).filter((f) => f.endsWith(".yaml"));
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      const letter = asLetter(yaml.load(fs.readFileSync(path.join(lettersDir(), n), "utf-8")));
      if (letter) out[letter.plan_slug] = letter;
    } catch {
      /* one bad file must not empty the map */
    }
  }
  return out;
}

function write(letter: RenewalLetter): boolean {
  if (!SLUG_RE.test(letter.plan_slug)) return false;
  try {
    fs.mkdirSync(lettersDir(), { recursive: true });
    const f = fileFor(letter.plan_slug);
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, dumpYaml(letter, { noRefs: true, lineWidth: 100 }), { mode: 0o600 });
    fs.renameSync(tmp, f);
    return true;
  } catch {
    return false;
  }
}

export interface StageRenewalLetterInput {
  planSlug: string;
  clientId: string;
  clientName: string;
  to: string;
  subject: string;
  body: string;
  offerLabel: string;
}

/**
 * Write (or replace) a drafted letter. Re-staging a plan overwrites the draft —
 * a re-authored letter should replace the old one, not pile up — but refuses to
 * clobber a letter that has already been sent.
 */
export function stageRenewalLetter(input: StageRenewalLetterInput): { ok: boolean; error?: string } {
  const existing = loadRenewalLetter(input.planSlug);
  if (existing?.status === "sent") {
    return { ok: false, error: "letter already sent — record the decision instead" };
  }
  const ok = write({
    plan_slug: input.planSlug,
    client_id: input.clientId,
    client_name: input.clientName,
    to: input.to,
    subject: input.subject,
    body: input.body,
    offer_label: input.offerLabel,
    status: "drafted",
    scheduled_for: null,
    drafted_at: new Date().toISOString(),
    approved_at: null,
    sent_at: null,
  });
  return ok ? { ok: true } : { ok: false, error: "could not write the letter" };
}

/**
 * Approve a drafted letter for sending on `scheduledFor` (YYYY-MM-DD — the
 * plan-end date). Idempotent on an already-approved letter (updates the date).
 */
export function approveRenewalLetter(
  planSlug: string,
  scheduledFor: string,
): { ok: boolean; error?: string } {
  const letter = loadRenewalLetter(planSlug);
  if (!letter) return { ok: false, error: "no letter on file to approve" };
  if (letter.status === "sent") return { ok: false, error: "letter already sent" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) {
    return { ok: false, error: "scheduled_for must be YYYY-MM-DD" };
  }
  const ok = write({
    ...letter,
    status: "approved",
    scheduled_for: scheduledFor,
    approved_at: letter.approved_at ?? new Date().toISOString(),
  });
  return ok ? { ok: true } : { ok: false, error: "could not write the approval" };
}

/** Move an approved letter back to a draft — undoes an approval before it sends. */
export function unapproveRenewalLetter(planSlug: string): { ok: boolean; error?: string } {
  const letter = loadRenewalLetter(planSlug);
  if (!letter) return { ok: false, error: "no letter on file" };
  if (letter.status === "sent") return { ok: false, error: "letter already sent" };
  const ok = write({ ...letter, status: "drafted", scheduled_for: null, approved_at: null });
  return ok ? { ok: true } : { ok: false, error: "could not write" };
}

/** Mark an approved letter sent. Called by the send cron after the mail goes. */
export function markRenewalLetterSent(planSlug: string): { ok: boolean; error?: string } {
  const letter = loadRenewalLetter(planSlug);
  if (!letter) return { ok: false, error: "no letter on file" };
  const ok = write({ ...letter, status: "sent", sent_at: new Date().toISOString() });
  return ok ? { ok: true } : { ok: false, error: "could not write" };
}

/**
 * The approved letters whose send date has arrived — what the cron mails today.
 *
 * Pure (takes the letters + today), so the cron's "who sends now" rule is unit
 * tested without touching disk. An approved letter with no date never sends —
 * the date is the whole safety of "goes out on the DAY", not the moment of
 * approval.
 */
export function renewalLettersDue(
  letters: RenewalLetter[],
  todayYmd: string,
): RenewalLetter[] {
  return letters.filter(
    (l) => l.status === "approved" && !!l.scheduled_for && l.scheduled_for <= todayYmd,
  );
}
