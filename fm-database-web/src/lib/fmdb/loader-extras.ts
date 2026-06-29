import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath, getPlansRoot, getResourcesRoot } from "./paths";
import type { Client, MindMap } from "./types";
import { withFsRetry } from "./fs-retry";

async function readYaml<T>(absPath: string): Promise<T | null> {
  try {
    const raw = await withFsRetry(() => fs.readFile(absPath, "utf-8"));
    return yaml.load(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    const names = await withFsRetry(() => fs.readdir(dir));
    return names
      .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
      .map((n) => path.join(dir, n));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// ---- Resources ----

export interface Resource {
  slug: string;
  title?: string;
  kind?: string;
  audience?: string;
  description?: string;
  file_path?: string | null;
  url?: string | null;
  text?: string | null;
  related_topics?: string[];
  related_mechanisms?: string[];
  related_supplements?: string[];
  related_symptoms?: string[];
  tags?: string[];
  shareable?: boolean;
  license_notes?: string;
  size_bytes?: number;
  mime_type?: string;
  version?: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  [key: string]: unknown;
}

export async function loadAllResources(): Promise<Resource[]> {
  const dir = path.join(getResourcesRoot(), "resources");
  const files = await listYamlFiles(dir);
  const out: Resource[] = [];
  for (const f of files) {
    const r = await readYaml<Resource>(f);
    if (r) out.push(r);
  }
  return out;
}

export async function loadResourceBySlug(slug: string): Promise<Resource | null> {
  const dir = path.join(getResourcesRoot(), "resources");
  return readYaml<Resource>(path.join(dir, `${slug}.yaml`));
}

// ---- Clients (extras: detail + sessions) ----

export interface ClientWithMeta extends Client {
  display_name?: string;
  current_medications?: string[];
  known_allergies?: string[];
  created_at?: string;
  updated_at?: string;
  status?: string;
}

export async function loadClientById(id: string): Promise<ClientWithMeta | null> {
  const root = getPlansRoot();
  const dirPath = path.join(root, "clients", id, "client.yaml");
  const data = await readYaml<ClientWithMeta>(dirPath);
  if (data) return data;
  // legacy flat
  return readYaml<ClientWithMeta>(path.join(root, "clients", `${id}.yaml`));
}

export interface ClientSession {
  session_id?: string;
  date?: string;
  presenting_complaints?: string;
  selected_symptoms?: string[];
  selected_topics?: string[];
  generated_plan_slug?: string | null;
  drivers_identified?: unknown[];
  supplements_suggested?: unknown[];
  synthesis_notes?: string;
  [key: string]: unknown;
}

// ── Recent inbound WhatsApp message count ─────────────────────────────────────

export interface InboundMessage {
  client_id: string;
  display_name?: string;
  /** YYYY-MM-DD session date — used for grouping + display. */
  date: string;
  /** ISO timestamp of the message. Compared against inbox read-state to
   *  decide if a message should appear in the unread banner. */
  created_at?: string;
  text: string;
}

/**
 * Inbox read-state file: `{[clientId]: ISO_timestamp}` — the latest
 * message timestamp the coach has acknowledged. A message in
 * client_id's sessions is "unread" iff its `created_at` is strictly
 * greater than `state[client_id]` (or `state[client_id]` is absent).
 *
 * Auto-mark-read fires when the coach visits
 *   /clients-v2/[id]/communicate
 * via markWhatsappInboxReadAction(id). One file, single yaml dict, no
 * migration needed for legacy data — missing entries just mean
 * "everything is unread", same as before this feature shipped.
 */
const INBOX_STATE_FILE_NAME = "_whatsapp_inbox_state.yaml";

async function readInboxState(): Promise<Record<string, string>> {
  const root = getPlansRoot();
  try {
    const raw = await withFsRetry(() => fs.readFile(path.join(root, INBOX_STATE_FILE_NAME), "utf-8"));
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* ENOENT or invalid YAML → empty state */
  }
  return {};
}

// ── Per-tab coach inbox state ────────────────────────────────────────────────
//
// Generalises the WhatsApp-only inbox state above to cover every kind of
// client activity that puts a chip on a client card (inbound WhatsApp,
// intake-form milestones, plan/system alerts, future Cal.com bookings).
//
// Shape of `~/fm-plans/_coach_inbox_state.yaml`:
//
//   cl-008:
//     sessions_seen_at:  '2026-05-17T11:00:00.000Z'   # clears whatsapp + intake
//     plan_seen_at:      '2026-05-15T09:00:00.000Z'   # clears recheck/follow-up
//     overview_seen_at:  '2026-05-17T11:00:00.000Z'   # clears everything else
//
// Tab→event mapping (so each tab clears only what's logically on it):
//   - sessions:  inbound WhatsApp + intake-form milestones
//   - plan:      plan/system alerts (recheck overdue, follow-up ≥12d)
//   - overview:  bookings (cal.com — placeholder), fallback for anything else
//
// `_whatsapp_inbox_state.yaml` is kept as a fallback read so historical
// markWhatsappInboxRead() calls aren't lost — see getRecentInboundMessages.
const COACH_INBOX_STATE_FILE_NAME = "_coach_inbox_state.yaml";

export type CoachTab = "overview" | "sessions" | "plan";

interface CoachInboxClientState {
  sessions_seen_at?: string;
  plan_seen_at?: string;
  overview_seen_at?: string;
}

async function readCoachInboxState(): Promise<Record<string, CoachInboxClientState>> {
  const root = getPlansRoot();
  try {
    const raw = await withFsRetry(() => fs.readFile(path.join(root, COACH_INBOX_STATE_FILE_NAME), "utf-8"));
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, CoachInboxClientState> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          out[k] = v as CoachInboxClientState;
        }
      }
      return out;
    }
  } catch {
    /* ENOENT or invalid YAML → empty state */
  }
  return {};
}

/** Stamp `now` into the seen-at field for (clientId, tab). Monotonic;
 *  later writes win. Crash-safe: read → update one key → write. */
export async function markCoachTabViewed(clientId: string, tab: CoachTab): Promise<void> {
  const root = getPlansRoot();
  const filePath = path.join(root, COACH_INBOX_STATE_FILE_NAME);
  const state = await readCoachInboxState();
  const slot: CoachInboxClientState = state[clientId] ?? {};
  const key = `${tab}_seen_at` as keyof CoachInboxClientState;
  slot[key] = new Date().toISOString();
  state[clientId] = slot;
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(filePath, yaml.dump(state, { sortKeys: true }), "utf-8");
  } catch {
    /* read-only filesystem etc. — silent. Badge just won't clear. */
  }
}

/** Strip the entire prefix of `[key: value]` tags off a session
 *  `presenting_complaints` string so the preview is human-readable. */
function stripSessionTags(complaints: string): string {
  return complaints.replace(/^(\s*\[[^\]]+\]\s*)+/, "").trim();
}

/**
 * WhatsApp inbound messages are appended into ONE rolling quick_note
 * session per client (a conversation thread). The session's `created_at`
 * is the FIRST message ever — so using it as "the message timestamp"
 * makes a brand-new message look days old.
 *
 * The webhook stamps each message into the body as
 *   `Received: D/M/YYYY, H:MM:SS am`  (IST wall-clock).
 * This finds the LATEST such line and returns it as an ISO string with
 * the +05:30 offset, so the inbox / dashboard show when the newest
 * message actually arrived. Returns null when the body has no
 * `Received:` lines (e.g. an outbound-only thread).
 */
function latestReceivedIso(body: string): string | null {
  const re =
    /Received:\s*(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)/gi;
  let best = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const [, dd, mm, yyyy, hhRaw, min, sec, ap] = m;
    let hh = parseInt(hhRaw, 10);
    const ampm = ap.toLowerCase();
    if (ampm === "pm" && hh !== 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;
    // Compose an ISO string with the IST offset — the "Received" time is
    // already IST wall-clock as captured by the webhook.
    const iso =
      `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}` +
      `T${String(hh).padStart(2, "0")}:${min}:${sec}+05:30`;
    // String compare works because all entries share the same offset.
    if (iso > best) best = iso;
  }
  return best || null;
}

// ── Recent intake-form activity ────────────────────────────────────────────

export type IntakeActivityKind = "submitted" | "started" | "opened";

export interface IntakeActivityEntry {
  client_id: string;
  display_name?: string;
  kind: IntakeActivityKind;
  /** ISO timestamp of the latest event that put this client in this kind. */
  at: string;
  /** For 'started' rows: how many fields the client has filled so far. */
  fields_filled?: number;
}

/** Count non-empty entries in a draft dict — matches the rule used in
 *  IntakeProgressCard so dashboard + Overview agree on "in progress". */
/**
 * Fields the server always prefills from coach-entered client data.
 * Mirrors _prefill_from_client() in scripts/intake-token-action.py.
 * Excluded from countDraftFields so a client who only ever loaded the
 * form (without typing) shows 0, not 12.
 */
const COACH_PREFILL_KEYS = new Set([
  "display_name", "date_of_birth", "sex", "email", "mobile_number",
  "city", "country", "active_conditions", "medical_history",
  "current_medications", "known_allergies", "goals",
  "dietary_preference", "animal_derived_supplements_ok",
  "foods_to_avoid", "non_negotiables", "family_history",
]);

function countDraftFields(draft: unknown): number {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(draft as Record<string, unknown>)) {
    if (COACH_PREFILL_KEYS.has(k)) continue; // skip coach-prefilled fields
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && Object.keys(v as object).length === 0) continue;
    if (typeof v === "boolean" && v === false) continue;
    n++;
  }
  return n;
}

/**
 * Scan all clients for fresh intake form activity in the last `daysBack`
 * days. Returns one entry per client; the most "advanced" stage wins
 * (submitted > started > opened), so a client who opened the form 5 days
 * ago and submitted yesterday appears once as `submitted`.
 *
 * Used by the dashboard banner so coach gets a passive heads-up when an
 * outstanding intake moves forward — no need to poll each client page.
 *
 * `clientLatestPlanUpdates` (optional) maps client_id → ISO timestamp of
 * the most-recent plan update. When a plan was updated AFTER the
 * client's intake submission, coach has clearly actioned the
 * submission — drop the chip so it doesn't linger as a stale "1
 * submitted" badge for days. Same logic for `intake_finalised_at` —
 * explicit coach-lock signals "I'm done with this intake".
 */
export async function getRecentIntakeActivity(
  clients: Array<Record<string, unknown>>,
  daysBack = 7,
  clientLatestPlanUpdates?: Map<string, string>,
): Promise<IntakeActivityEntry[]> {
  const cutoffMs = Date.now() - daysBack * 86_400_000;
  // Use a tighter 1-day window for "started" / "opened" — submissions
  // are rare, opens / drafts happen more often and become noise fast.
  const stickyCutoffMs = Date.now() - 1 * 86_400_000;

  const out: IntakeActivityEntry[] = [];
  for (const c of clients) {
    const clientId = c.client_id as string | undefined;
    if (!clientId) continue;
    const displayName = c.display_name as string | undefined;

    const submittedAt =
      (c.intake_last_submitted_at as string | undefined) ??
      (c.intake_submitted_at as string | undefined);
    const submittedMs = submittedAt ? Date.parse(submittedAt) : NaN;
    // Submitted has the longest window — coach almost always wants to
    // see "Sudarshan submitted" even if it was 5 days ago and they
    // haven't reviewed yet.
    if (!Number.isNaN(submittedMs) && submittedMs >= cutoffMs) {
      // BUT — if coach has already actioned the submission, drop it.
      // Two signals count as "actioned":
      //   1. intake_finalised_at is set → coach explicitly locked the
      //      form post-review.
      //   2. A plan exists for this client with updated_at AFTER the
      //      submission timestamp → coach has clearly used the intake
      //      data (regenerated / activated a plan from it).
      // Either signal drops the stale "1 submitted" chip — coach
      // doesn't need a reminder for clients she's already moved on.
      const finalisedAt = c.intake_finalised_at as string | undefined;
      if (finalisedAt) continue;
      const planUpdatedAt = clientLatestPlanUpdates?.get(clientId);
      if (planUpdatedAt && Date.parse(planUpdatedAt) >= submittedMs) {
        continue;
      }
      out.push({
        client_id: clientId,
        display_name: displayName,
        kind: "submitted",
        at: submittedAt!,
      });
      continue;
    }

    const draftSavedAt = c.intake_form_draft_saved_at as string | undefined;
    const draftMs = draftSavedAt ? Date.parse(draftSavedAt) : NaN;
    if (!Number.isNaN(draftMs) && draftMs >= stickyCutoffMs) {
      out.push({
        client_id: clientId,
        display_name: displayName,
        kind: "started",
        at: draftSavedAt!,
        fields_filled: countDraftFields(c.intake_form_draft),
      });
      continue;
    }

    const openedAt = c.intake_first_opened_at as string | undefined;
    const openedMs = openedAt ? Date.parse(openedAt) : NaN;
    if (!Number.isNaN(openedMs) && openedMs >= stickyCutoffMs) {
      out.push({
        client_id: clientId,
        display_name: displayName,
        kind: "opened",
        at: openedAt!,
      });
    }
  }

  // Newest first — coach skims top-to-bottom.
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// ── Stranded intake drafts ──────────────────────────────────────────────────

export interface StrandedIntakeDraft {
  client_id: string;
  display_name?: string;
  /** When the auto-save last fired — i.e. the last time they touched the form. */
  draft_saved_at: string;
  /** How many filled fields are sitting in the draft. */
  fields_filled: number;
  /** Hours since last edit. */
  hours_since_edit: number;
}

/**
 * Scan all clients for orphaned intake drafts — substantial data sitting
 * in `intake_form_draft` that was never promoted to top-level via Submit.
 *
 * Drives FmStrandedIntakeBanner on the dashboard so coach catches every
 * "filled the form, closed the tab" case without opening each client.
 * (Pranati cl-009 hit this 2026-05-23 — 63 fields stranded, never visible
 * until coach opened her Overview. This banner fixes that.)
 *
 * Criteria: draft has ≥ minFields filled AND
 *   (a) intake_submitted_at is null OR
 *   (b) draft was saved AFTER the latest submit (post-submit edits).
 * AND intake_finalised_at is null (once coach locks, action_promote_draft
 * refuses anyway).
 *
 * Sorted by `fields_filled` descending — most-filled drafts surface first
 * because they're the highest-value recoveries.
 */
export async function getStrandedIntakeDrafts(
  clients: Array<Record<string, unknown>>,
  minFields = 5,
): Promise<StrandedIntakeDraft[]> {
  const now = Date.now();
  const out: StrandedIntakeDraft[] = [];
  for (const c of clients) {
    const finalised = c.intake_finalised_at as string | undefined;
    if (finalised) continue;
    const draft = c.intake_form_draft;
    const filled = countDraftFields(draft);
    if (filled < minFields) continue;
    const submittedAt = (c.intake_submitted_at ?? c.intake_last_submitted_at) as string | undefined;
    const draftSavedAt = c.intake_form_draft_saved_at as string | undefined;
    if (!draftSavedAt) continue;
    if (submittedAt) {
      // Post-submit edits also count, but ONLY if the draft is newer.
      if (Date.parse(draftSavedAt) <= Date.parse(submittedAt)) continue;
    }
    const draftMs = Date.parse(draftSavedAt);
    if (Number.isNaN(draftMs)) continue;
    out.push({
      client_id: c.client_id as string,
      display_name: c.display_name as string | undefined,
      draft_saved_at: draftSavedAt,
      fields_filled: filled,
      hours_since_edit: Math.round((now - draftMs) / 3_600_000),
    });
  }
  // Most-filled drafts first — biggest recoveries at the top.
  return out.sort((a, b) => b.fields_filled - a.fields_filled);
}

/**
 * Scans all client session dirs for quick_note sessions tagged
 * `[source: whatsapp_webhook]` within the last `daysBack` days.
 *
 * Cheap: only reads files whose name encodes a date ≥ cutoff. The interface
 * All inbound data comes from the self-hosted WhatsApp Cloud API server
 * (whatsapp-server-shivani) → POST /api/whatsapp-webhook → session YAML.
 */
export async function getRecentInboundMessages(
  clientIds: string[],
  clientNames: Map<string, string>,
  daysBack = 7
): Promise<InboundMessage[]> {
  const root = getPlansRoot();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  // Read-state — filter out messages the coach has already acknowledged
  // by visiting the client's Communicate tab. State is per-client and
  // monotonically advancing (we only ever write `now` so the timestamp
  // moves forward).
  const inboxState = await readInboxState();
  const results: InboundMessage[] = [];

  await Promise.all(
    clientIds.map(async (id) => {
      const dir = path.join(root, "clients", id, "sessions");
      let names: string[];
      try {
        names = await withFsRetry(() => fs.readdir(dir));
      } catch {
        return;
      }

      // Session filenames encode date: e.g. "cl-001-2026-05-07-001.yaml"
      // Only read files whose name contains a date >= cutoffStr
      const recentFiles = names.filter((n) => {
        const m = n.match(/(\d{4}-\d{2}-\d{2})/);
        return m && m[1] >= cutoffStr && (n.endsWith(".yaml") || n.endsWith(".yml"));
      });

      const lastReadAt = inboxState[id];

      for (const name of recentFiles) {
        const data = await readYaml<Record<string, unknown>>(path.join(dir, name));
        if (!data) continue;
        const complaints = String(data.presenting_complaints ?? "");
        if (!complaints.includes("[source: whatsapp_webhook]")) continue;
        const sessionCreatedAt =
          typeof data.created_at === "string" ? data.created_at : undefined;
        // WhatsApp threads append every message into one session — the
        // session created_at is the FIRST message. Use the LATEST inbound
        // "Received:" line as the real message timestamp so a new message
        // doesn't show as days old. Falls back to session created_at.
        const effectiveAt = latestReceivedIso(complaints) ?? sessionCreatedAt;
        // Acknowledged? Compare via Date.parse — effectiveAt carries a
        // +05:30 offset while lastReadAt is a UTC `Z` stamp, so a plain
        // string compare across the two offsets would be wrong.
        if (effectiveAt && lastReadAt) {
          const eMs = Date.parse(effectiveAt);
          const rMs = Date.parse(lastReadAt);
          if (Number.isFinite(eMs) && Number.isFinite(rMs) && eMs <= rMs) {
            continue;
          }
        }
        const text = stripSessionTags(complaints).slice(0, 120);
        results.push({
          client_id: id,
          display_name: clientNames.get(id),
          date: (effectiveAt ?? String(data.date ?? "")).slice(0, 10),
          created_at: effectiveAt,
          text,
        });
      }
    })
  );

  return results.sort((a, b) => {
    const am = Date.parse(a.created_at ?? a.date);
    const bm = Date.parse(b.created_at ?? b.date);
    return (Number.isFinite(bm) ? bm : 0) - (Number.isFinite(am) ? am : 0);
  });
}

/** Inbox view of inbound WhatsApp messages — keeps FULL text (not the
 *  120-char preview that the dashboard banner uses) and an `is_unread`
 *  flag so the /messages page can render a real unread filter without
 *  refetching. Includes both unread + recently-read so the inbox feels
 *  like an inbox, not just a notification queue. */
export interface InboxMessage {
  client_id: string;
  display_name?: string;
  date: string;
  created_at?: string;
  /** Full message text — NOT truncated. UI is responsible for ellipsis
   *  rendering when displayed in compact list rows. */
  text: string;
  /** True iff this message arrived after the coach's last "read" stamp
   *  for this client. UI uses this for the bold/dim styling + counts. */
  is_unread: boolean;
  /** Session ID of the underlying quick_note YAML — used for the deep
   *  link into the History tab when coach wants more context. */
  session_id?: string;
}

export async function getInboxMessages(
  clientIds: string[],
  clientNames: Map<string, string>,
  daysBack = 30,
): Promise<InboxMessage[]> {
  const root = getPlansRoot();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const inboxState = await readInboxState();
  const results: InboxMessage[] = [];

  await Promise.all(
    clientIds.map(async (id) => {
      const dir = path.join(root, "clients", id, "sessions");
      let names: string[];
      try {
        names = await withFsRetry(() => fs.readdir(dir));
      } catch {
        return;
      }
      const recentFiles = names.filter((n) => {
        const m = n.match(/(\d{4}-\d{2}-\d{2})/);
        return m && m[1] >= cutoffStr && (n.endsWith(".yaml") || n.endsWith(".yml"));
      });
      const lastReadAt = inboxState[id];

      for (const name of recentFiles) {
        const data = await readYaml<Record<string, unknown>>(path.join(dir, name));
        if (!data) continue;
        const complaints = String(data.presenting_complaints ?? "");
        if (!complaints.includes("[source: whatsapp_webhook]")) continue;
        const sessionCreatedAt =
          typeof data.created_at === "string" ? data.created_at : undefined;
        // Use the LATEST inbound "Received:" line as the message
        // timestamp — the session created_at is the first message in the
        // rolling WhatsApp thread, not the newest. See latestReceivedIso.
        const effectiveAt = latestReceivedIso(complaints) ?? sessionCreatedAt;
        // Unread = newest message arrived after the coach's last read.
        // Compare via Date.parse (effectiveAt is +05:30, lastReadAt is Z).
        const isUnread = (() => {
          if (!lastReadAt || !effectiveAt) return true;
          const eMs = Date.parse(effectiveAt);
          const rMs = Date.parse(lastReadAt);
          if (!Number.isFinite(eMs) || !Number.isFinite(rMs)) return true;
          return eMs > rMs;
        })();
        const text = stripSessionTags(complaints);
        results.push({
          client_id: id,
          display_name: clientNames.get(id),
          date: (effectiveAt ?? String(data.date ?? "")).slice(0, 10),
          created_at: effectiveAt,
          text,
          is_unread: isUnread,
          session_id:
            typeof data.session_id === "string" ? data.session_id : undefined,
        });
      }
    }),
  );

  // Newest first. Date.parse handles the mixed +05:30 / Z offsets that a
  // plain string compare would mis-order.
  return results.sort((a, b) => {
    const am = Date.parse(a.created_at ?? a.date);
    const bm = Date.parse(b.created_at ?? b.date);
    return (Number.isFinite(bm) ? bm : 0) - (Number.isFinite(am) ? am : 0);
  });
}

/**
 * Mark all inbound WhatsApp messages for this client as read by stamping
 * the inbox state with `now`. Fired from the Communicate page (RSC), so
 * the very act of opening the conversation clears the unread badge.
 *
 * Idempotent and crash-safe: we read → update one key → write. Race
 * window is tiny; worst case is two near-simultaneous renders both
 * write `now` and the later one wins, which is fine — the state is
 * monotonically advancing.
 */
export async function markWhatsappInboxRead(clientId: string): Promise<void> {
  const root = getPlansRoot();
  const filePath = path.join(root, INBOX_STATE_FILE_NAME);
  const state = await readInboxState();
  state[clientId] = new Date().toISOString();
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(filePath, yaml.dump(state, { sortKeys: true }), "utf-8");
  } catch {
    /* read-only filesystem etc. — silent. Banner just won't clear. */
  }
}

// ── Cal.com bookings — current-state view for dashboard ─────────────────────
//
// Raw events are append-only in _calcom_bookings.yaml (one row per
// cal.com event). For a "what's coming up?" dashboard widget the coach
// wants the CURRENT state per booking (uid): the latest CANCELLED row
// wins (drops the booking), otherwise the latest CREATED/RESCHEDULED row.
//
// Cost: one file read + an O(N) reduce. With the 50-events-per-client
// cap on the raw file this stays cheap even at thousands of bookings.

export interface UpcomingBooking {
  client_id: string;
  display_name?: string;
  start_time: string;
  end_time?: string;
  event_slug?: string;
  event_title?: string;
  /** "CREATED" | "RESCHEDULED" — never CANCELLED (those are filtered out). */
  current_state: string;
  uid: string;
  /** Cal.com location string when known (e.g. "video", "Zoom"). Falls
   *  back to null when the integration doesn't expose it. */
  location?: string | null;
  /** Direct join URL for video meetings — used by the "Join call →"
   *  button in the upcoming-bookings panel. */
  join_url?: string | null;
  /** When fm-coach received this event. Drives the dashboard's
   *  acknowledge-on-view filter. */
  received_at?: string;
}

/** Slim summary of a recent cancellation — surfaced in the dashboard's
 *  cancellation alert and on each client's upcoming-bookings section. */
export interface CancelledBooking {
  client_id: string;
  display_name?: string;
  uid: string;
  start_time?: string;
  event_slug?: string;
  event_title?: string;
  /** When fm-coach received the CANCELLED event. */
  received_at?: string;
}

interface RawBookingEvent {
  received_at?: string;
  /** Slice-2 contract: "booking_created" | "booking_rescheduled" | "booking_cancelled". */
  type?: string;
  start_time?: string;
  end_time?: string;
  event_slug?: string;
  event_title?: string;
  uid?: string;
  location?: string | null;
  join_url?: string | null;
  // Legacy fields from the brief parallel-cal.com experiment — kept so any
  // remaining rows from before the slice-2 pivot still parse.
  trigger_event?: string;
}

/**
 * Reads _calcom_bookings.yaml and returns one row per booking-uid,
 * showing the current state. Defaults to upcoming-only (start_time > now);
 * pass `includePast` to see recently-passed sessions too.
 *
 * Sorted by start_time ascending — soonest first, which is what the
 * coach wants to scan in the morning.
 *
 * `clientNames` maps client_id → display_name so the widget can render
 * names without re-loading client.yaml per row. Caller supplies it
 * from the existing clients fetch.
 */
export async function loadUpcomingBookings(
  clientNames: Map<string, string>,
  options?: {
    includePast?: boolean;
    /** Look back this many days for "recent past" rows. Default 1. */
    pastDays?: number;
    /** Maximum rows returned. Default 20 — fits a dashboard panel. */
    limit?: number;
    /** When true, skip the dismiss filter and show every upcoming row.
     *  Used by future "show me everything" toggles. Default false:
     *  rows already acknowledged (coach has visited the client's Overview
     *  since the booking event landed) get filtered out so the panel
     *  doesn't keep nagging. */
    includeAcknowledged?: boolean;
  },
): Promise<UpcomingBooking[]> {
  const root = getPlansRoot();
  let raw: Record<string, RawBookingEvent[]> = {};
  try {
    const text = await withFsRetry(() => fs.readFile(path.join(root, "_calcom_bookings.yaml"), "utf-8"));
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, RawBookingEvent[]>;
    }
  } catch {
    return [];
  }

  const includePast = options?.includePast ?? false;
  const includeAcknowledged = options?.includeAcknowledged ?? false;
  const pastCutoffMs = Date.now() - (options?.pastDays ?? 1) * 86_400_000;
  const limit = options?.limit ?? 20;
  const nowMs = Date.now();

  // Per-client acknowledged-at: latest `overview_seen_at` from the coach
  // inbox state. A booking row is hidden iff its `received_at <= overview_seen_at`
  // (coach has visited the client since the booking landed → they've seen it).
  // Reschedules naturally re-surface because `received_at` advances.
  const inboxState = includeAcknowledged ? null : await readCoachInboxState();

  const rows: UpcomingBooking[] = [];

  for (const [clientId, events] of Object.entries(raw)) {
    if (!Array.isArray(events)) continue;
    // Group by uid; latest event per uid wins. received_at is what we sort
    // by (when fm-coach received the event). cal.com sends RESCHEDULED with
    // the SAME uid as the original CREATED so this naturally collapses.
    const byUid = new Map<string, RawBookingEvent>();
    for (const e of events) {
      const uid = e.uid;
      if (!uid) continue;
      const prev = byUid.get(uid);
      if (!prev || (e.received_at ?? "") > (prev.received_at ?? "")) {
        byUid.set(uid, e);
      }
    }

    // Dismiss filter: if coach has visited this client's Overview AFTER
    // the booking landed, treat the booking as acknowledged and skip it.
    const overviewSeenAt = inboxState?.[clientId]?.overview_seen_at;
    const overviewSeenMs = overviewSeenAt ? Date.parse(overviewSeenAt) : 0;

    for (const e of byUid.values()) {
      // Slice-2 contract uses `type` ("booking_cancelled"); legacy parallel
      // experiment used `trigger_event` ("BOOKING_CANCELLED"). Accept both.
      const stateRaw = (e.type ?? e.trigger_event ?? "").toUpperCase().replace(/^BOOKING_/, "");
      if (stateRaw === "CANCELLED" || stateRaw === "CANCELED") continue;
      if (!e.start_time || !e.uid) continue;
      const startMs = Date.parse(e.start_time);
      if (Number.isNaN(startMs)) continue;
      if (!includePast && startMs < nowMs) continue;
      if (includePast && startMs < pastCutoffMs) continue;
      // Acknowledged-dismiss filter — applies ONLY to past-bucket rows
      // ("includePast" callers showing cancellation/recent-history feeds).
      // For the dashboard's upcoming-bookings panel (the default mode,
      // `includePast === false`), the row represents a FUTURE session
      // that the coach needs to keep seeing until it actually happens —
      // not a one-shot notification that fades after a single client
      // visit. Coach bug 2026-05-19: Archana's booking for tomorrow
      // disappeared because the coach opened her Overview once after
      // the booking landed. Fixed by gating dismiss to past-only.
      if (
        includePast &&
        !includeAcknowledged &&
        overviewSeenMs > 0
      ) {
        const receivedMs = e.received_at ? Date.parse(e.received_at) : 0;
        if (receivedMs > 0 && receivedMs <= overviewSeenMs) continue;
      }

      rows.push({
        client_id: clientId,
        display_name: clientNames.get(clientId),
        start_time: e.start_time,
        end_time: e.end_time,
        event_slug: e.event_slug,
        event_title: e.event_title,
        current_state: stateRaw || "CREATED",
        uid: e.uid,
        location: e.location ?? null,
        join_url: e.join_url ?? null,
        received_at: e.received_at,
      });
    }
  }

  rows.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return rows.slice(0, limit);
}

/**
 * Recently-cancelled bookings (`type: booking_cancelled` events received
 * in the last `hoursBack` window, default 48h). Same dismiss filter as
 * upcoming bookings: a cancellation drops out once the coach has visited
 * the client's Overview tab after the cancellation event landed.
 */
export async function loadRecentCancellations(
  clientNames: Map<string, string>,
  options?: {
    hoursBack?: number;
    /** Bypass the dismiss filter — always return every recent cancellation. */
    includeAcknowledged?: boolean;
  },
): Promise<CancelledBooking[]> {
  const root = getPlansRoot();
  let raw: Record<string, RawBookingEvent[]> = {};
  try {
    const text = await withFsRetry(() => fs.readFile(path.join(root, "_calcom_bookings.yaml"), "utf-8"));
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, RawBookingEvent[]>;
    }
  } catch {
    return [];
  }
  const hoursBack = options?.hoursBack ?? 48;
  const cutoffMs = Date.now() - hoursBack * 3_600_000;
  const includeAcknowledged = options?.includeAcknowledged ?? false;
  const inboxState = includeAcknowledged ? null : await readCoachInboxState();

  const out: CancelledBooking[] = [];
  for (const [clientId, events] of Object.entries(raw)) {
    if (!Array.isArray(events)) continue;
    const seenAt = inboxState?.[clientId]?.overview_seen_at;
    const seenMs = seenAt ? Date.parse(seenAt) : 0;

    // Collapse by uid; only count the LATEST event per uid. So a CREATED
    // → RESCHEDULED → CANCELLED chain surfaces as one cancellation.
    const byUid = new Map<string, RawBookingEvent>();
    for (const e of events) {
      if (!e.uid) continue;
      const prev = byUid.get(e.uid);
      if (!prev || (e.received_at ?? "") > (prev.received_at ?? "")) {
        byUid.set(e.uid, e);
      }
    }
    for (const e of byUid.values()) {
      const stateRaw = (e.type ?? e.trigger_event ?? "").toUpperCase().replace(/^BOOKING_/, "");
      if (stateRaw !== "CANCELLED" && stateRaw !== "CANCELED") continue;
      const rcvMs = e.received_at ? Date.parse(e.received_at) : 0;
      if (rcvMs <= 0 || rcvMs < cutoffMs) continue;
      if (!includeAcknowledged && seenMs > 0 && rcvMs <= seenMs) continue;
      out.push({
        client_id: clientId,
        display_name: clientNames.get(clientId),
        uid: e.uid!,
        start_time: e.start_time,
        event_slug: e.event_slug,
        event_title: e.event_title,
        received_at: e.received_at,
      });
    }
  }
  out.sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
  return out;
}

/** Per-client bookings — full history (no dismiss filter), used by the
 *  client overview page's "Upcoming sessions" + "Recent" sections. */
export async function loadClientBookings(clientId: string): Promise<UpcomingBooking[]> {
  const root = getPlansRoot();
  let raw: Record<string, RawBookingEvent[]> = {};
  try {
    const text = await withFsRetry(() => fs.readFile(path.join(root, "_calcom_bookings.yaml"), "utf-8"));
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, RawBookingEvent[]>;
    }
  } catch {
    return [];
  }
  const events = raw[clientId];
  if (!Array.isArray(events)) return [];
  const byUid = new Map<string, RawBookingEvent>();
  for (const e of events) {
    if (!e.uid) continue;
    const prev = byUid.get(e.uid);
    if (!prev || (e.received_at ?? "") > (prev.received_at ?? "")) byUid.set(e.uid, e);
  }
  const rows: UpcomingBooking[] = [];
  for (const e of byUid.values()) {
    if (!e.start_time || !e.uid) continue;
    const stateRaw = (e.type ?? e.trigger_event ?? "").toUpperCase().replace(/^BOOKING_/, "");
    rows.push({
      client_id: clientId,
      start_time: e.start_time,
      end_time: e.end_time,
      event_slug: e.event_slug,
      event_title: e.event_title,
      current_state: stateRaw || "CREATED",
      uid: e.uid,
      location: e.location ?? null,
      join_url: e.join_url ?? null,
      received_at: e.received_at,
    });
  }
  // Soonest upcoming first; cancelled / past at the end.
  rows.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return rows;
}

// ── Per-client unread counts (badge backend) ─────────────────────────────────
//
// Computes how many fresh activity items each client has since the coach
// last viewed the relevant tab. Bucketed by tab so each tab clears only
// the items shown there.
//
// Bulk by design — the dashboard renders many client rows; doing per-row
// session-dir scans would be slow. Caller passes the already-loaded client
// list; we do one directory walk over recently-active client dirs.
//
// Cost model: O(N clients × M recent session files per client). Filename
// pre-filter on the YYYY-MM-DD date prefix keeps M to days in the lookback
// window (default 14). For a normal dashboard load this is ~50 file
// reads — well under 100ms.

export interface ClientUnreadCounts {
  /** Inbound WhatsApp messages since `sessions_seen_at`. */
  whatsapp: number;
  /** Intake-form milestone events (opened / draft-saved / submitted) since
   *  `sessions_seen_at`. At most one per client; the latest milestone wins. */
  intake: number;
  /** Plan/system alerts (recheck overdue, follow-up ≥12d) currently active
   *  AND newer than `plan_seen_at`. Placeholder count = 1 if any alert; we
   *  don't break it down further yet. */
  alerts: number;
  /** Cal.com bookings since `overview_seen_at`. Placeholder — always 0
   *  until a cal.com webhook lands. */
  bookings: number;
  /** Sum across all buckets. The chip on the client card shows this. */
  total: number;
  /** Each bucket's most recent event timestamp, so a hover popover can
   *  show "WhatsApp · 2h ago". Optional — undefined if bucket is 0. */
  latest_at?: {
    whatsapp?: string;
    intake?: string;
    alerts?: string;
    bookings?: string;
  };
}

export async function getClientUnreadCounts(
  clients: Array<Record<string, unknown>>,
  options?: {
    /** Lookback window for scanning session files. Default 14 days. */
    daysBack?: number;
    /** Optional pre-computed `Set<client_id>` of clients with active
     *  plan/system alerts (recheck overdue, follow-up ≥12d). Lets the
     *  caller reuse work from getSchedulingDueRows etc. Empty set is
     *  fine — alerts bucket stays 0. */
    alertClientIds?: Set<string>;
    /** Optional map of client_id → ISO timestamp of when the alert
     *  first became applicable (e.g. last_session_date + 12d, or
     *  plan_period_recheck_date). If provided, the alerts bucket
     *  clears only when `plan_seen_at >= triggered_at`. Without
     *  this map the bucket falls back to a 1-day-granularity
     *  proxy (today's midnight). */
    alertTriggeredAt?: Map<string, string>;
  },
): Promise<Map<string, ClientUnreadCounts>> {
  const daysBack = options?.daysBack ?? 14;
  const alertSet = options?.alertClientIds ?? new Set<string>();
  const alertTriggeredAt = options?.alertTriggeredAt ?? new Map<string, string>();
  const root = getPlansRoot();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  const state = await readCoachInboxState();
  // Fallback: pull historical _whatsapp_inbox_state.yaml so coaches who
  // marked WhatsApp read pre-v0.63 don't see "unread" chips light up.
  const legacyWhatsappState = await readInboxState();

  // Cal.com bookings (written by /api/cal-com-webhook). Empty if file
  // doesn't exist — bookings bucket simply stays 0 in that case.
  let calBookings: Record<string, Array<{ received_at?: string }>> = {};
  try {
    const raw = await withFsRetry(() => fs.readFile(path.join(root, "_calcom_bookings.yaml"), "utf-8"));
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      calBookings = parsed as Record<string, Array<{ received_at?: string }>>;
    }
  } catch {
    /* ENOENT → no bookings yet */
  }

  const out = new Map<string, ClientUnreadCounts>();

  await Promise.all(
    clients.map(async (c) => {
      const clientId = c.client_id as string | undefined;
      if (!clientId) return;
      const slot = state[clientId] ?? {};
      const sessionsSeen = slot.sessions_seen_at ?? legacyWhatsappState[clientId];
      const planSeen = slot.plan_seen_at;
      const overviewSeen = slot.overview_seen_at;
      const sessionsSeenMs = sessionsSeen ? Date.parse(sessionsSeen) : 0;
      const planSeenMs = planSeen ? Date.parse(planSeen) : 0;
      const overviewSeenMs = overviewSeen ? Date.parse(overviewSeen) : 0;

      const counts: ClientUnreadCounts = {
        whatsapp: 0,
        intake: 0,
        alerts: 0,
        bookings: 0,
        total: 0,
      };
      const latest: ClientUnreadCounts["latest_at"] = {};

      // ── WhatsApp inbound (session YAMLs tagged [source: whatsapp_webhook]) ──
      const sessDir = path.join(root, "clients", clientId, "sessions");
      try {
        const names = await withFsRetry(() => fs.readdir(sessDir));
        const recent = names.filter((n) => {
          const m = n.match(/(\d{4}-\d{2}-\d{2})/);
          return m && m[1] >= cutoffStr && (n.endsWith(".yaml") || n.endsWith(".yml"));
        });
        for (const n of recent) {
          const data = await readYaml<Record<string, unknown>>(path.join(sessDir, n));
          if (!data) continue;
          const complaints = String(data.presenting_complaints ?? "");
          if (!complaints.includes("[source: whatsapp_webhook]")) continue;
          const createdAt = typeof data.created_at === "string" ? data.created_at : undefined;
          if (!createdAt) continue;
          if (Date.parse(createdAt) <= sessionsSeenMs) continue;
          counts.whatsapp++;
          if (!latest.whatsapp || createdAt > latest.whatsapp) latest.whatsapp = createdAt;
        }
      } catch {
        /* no sessions dir → 0 */
      }

      // ── Intake milestones (latest wins; one chip max) ──
      // Picks the most-recent of: last submit, draft save, first open.
      // Each is a distinct coach-visible event. We only count it if it's
      // newer than sessions_seen_at AND newer than any plan update that
      // would mark it "actioned" (mirrors getRecentIntakeActivity).
      const intakeCandidates: string[] = [];
      const sub = (c.intake_last_submitted_at ?? c.intake_submitted_at) as string | undefined;
      const draft = c.intake_form_draft_saved_at as string | undefined;
      const opened = c.intake_first_opened_at as string | undefined;
      if (sub) intakeCandidates.push(sub);
      if (draft) intakeCandidates.push(draft);
      if (opened) intakeCandidates.push(opened);
      const latestIntake = intakeCandidates
        .filter((t) => !!t)
        .sort((a, b) => b.localeCompare(a))[0];
      if (latestIntake && Date.parse(latestIntake) > sessionsSeenMs) {
        // Coach-actioned signal: intake_finalised_at clears it.
        const finalisedAt = c.intake_finalised_at as string | undefined;
        if (!finalisedAt) {
          counts.intake = 1;
          latest.intake = latestIntake;
        }
      }

      // ── Plan/system alerts ──
      // Caller passes the set of client_ids currently in scheduling-due
      // state PLUS a map of client_id → ISO triggered_at (when the alert
      // first became applicable — e.g. last_session_date + 12d, or
      // plan_period_recheck_date). We count 1 iff:
      //   client is in alertSet AND plan_seen_at < triggered_at.
      // Without a triggered_at we fall back to today's midnight as a
      // 1-day-granularity proxy (legacy behaviour).
      if (alertSet.has(clientId)) {
        const triggeredAt = alertTriggeredAt.get(clientId);
        const triggeredMs = triggeredAt
          ? Date.parse(triggeredAt)
          : Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
        if (planSeenMs < triggeredMs) {
          counts.alerts = 1;
          latest.alerts = triggeredAt ?? new Date().toISOString();
        }
      }

      // ── Cal.com bookings (written by /api/cal-com-webhook) ──
      const bookings = calBookings[clientId];
      if (Array.isArray(bookings)) {
        let mostRecent: string | undefined;
        for (const b of bookings) {
          const r = b?.received_at;
          if (!r) continue;
          const ms = Date.parse(r);
          if (ms > overviewSeenMs) {
            counts.bookings++;
            if (!mostRecent || r > mostRecent) mostRecent = r;
          }
        }
        if (mostRecent) latest.bookings = mostRecent;
      }

      counts.total = counts.whatsapp + counts.intake + counts.alerts + counts.bookings;
      if (counts.total > 0) counts.latest_at = latest;
      out.set(clientId, counts);
    }),
  );

  return out;
}

export async function loadClientSessions(id: string): Promise<ClientSession[]> {
  const root = getPlansRoot();
  const dir = path.join(root, "clients", id, "sessions");
  const files = await listYamlFiles(dir);
  const out: ClientSession[] = [];
  for (const f of files) {
    const data = await readYaml<ClientSession>(f);
    if (data) {
      out.push({ ...data, _file: f } as ClientSession);
    }
  }
  // Sort newest first by filename (which encodes date)
  return out.sort((a, b) =>
    String((b as { _file?: string })._file ?? "").localeCompare(
      String((a as { _file?: string })._file ?? "")
    )
  );
}

// ---- MindMaps ----

export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
  linked_kind?: string | null;
  linked_slug?: string | null;
  notes?: string;
}

export interface MindMapFull extends MindMap {
  tree?: MindMapNode[];
}

export async function loadAllMindMaps(): Promise<MindMapFull[]> {
  const dir = path.join(getCataloguePath(), "mindmaps");
  const files = await listYamlFiles(dir);
  const out: MindMapFull[] = [];
  for (const f of files) {
    const data = await readYaml<MindMapFull>(f);
    if (data) out.push(data);
  }
  return out;
}

export async function loadMindMapBySlug(slug: string): Promise<MindMapFull | null> {
  const dir = path.join(getCataloguePath(), "mindmaps");
  return readYaml<MindMapFull>(path.join(dir, `${slug}.yaml`));
}

export function countMindMapNodes(tree: MindMapNode[] | undefined): {
  total: number;
  linked: number;
} {
  let total = 0;
  let linked = 0;
  function walk(nodes: MindMapNode[] | undefined) {
    if (!nodes) return;
    for (const n of nodes) {
      total++;
      if (n.linked_slug) linked++;
      if (n.children && n.children.length) walk(n.children);
    }
  }
  walk(tree);
  return { total, linked };
}

// ---- MindMap Pathway Finder ----

export interface MindMapMatch {
  /** Breadcrumb path from the top-level branch down to the matched node */
  path: string[];
  nodeLabel: string;
  linkedKind: string;
  linkedSlug: string;
}

export interface MindMapPathwayResult {
  mindmapSlug: string;
  mindmapName: string;
  /** Nodes matched by the selected symptoms / topics */
  matches: MindMapMatch[];
  /** Labels of each top-level branch (for at-a-glance summary) */
  topLevelBranches: string[];
}

function walkForMatches(
  nodes: MindMapNode[],
  matchSlugs: Set<string>,
  matchKinds: Set<string>,
  pathSoFar: string[]
): MindMapMatch[] {
  const results: MindMapMatch[] = [];
  for (const node of nodes) {
    const currentPath = [...pathSoFar, node.label];
    if (
      node.linked_kind &&
      node.linked_slug &&
      matchKinds.has(node.linked_kind) &&
      matchSlugs.has(node.linked_slug)
    ) {
      results.push({
        path: currentPath,
        nodeLabel: node.label,
        linkedKind: node.linked_kind,
        linkedSlug: node.linked_slug,
      });
    }
    if (node.children?.length) {
      results.push(...walkForMatches(node.children, matchSlugs, matchKinds, currentPath));
    }
  }
  return results;
}

export async function findMindMapPathways(
  symptomSlugs: string[],
  topicSlugs: string[]
): Promise<MindMapPathwayResult[]> {
  if (!symptomSlugs.length && !topicSlugs.length) return [];

  const matchSlugs = new Set([...symptomSlugs, ...topicSlugs]);
  const matchKinds = new Set<string>();
  if (symptomSlugs.length) matchKinds.add("symptom");
  if (topicSlugs.length) matchKinds.add("topic");

  const maps = await loadAllMindMaps();
  const results: MindMapPathwayResult[] = [];

  for (const m of maps) {
    if (!m.tree?.length) continue;
    const matches = walkForMatches(m.tree, matchSlugs, matchKinds, []);
    if (!matches.length) continue;
    results.push({
      mindmapSlug: m.slug,
      mindmapName: m.display_name ?? m.slug,
      matches,
      topLevelBranches: m.tree.map((n) => n.label),
    });
  }

  // Most matches first
  results.sort((a, b) => b.matches.length - a.matches.length);
  return results;
}

// ---- Backlog ----

export interface BacklogItem {
  id: string;
  kind: string;
  name: string;
  why?: string;
  status: "open" | "added" | "rejected" | "attached" | string;
  suggested_by?: string;
  created_at?: string;
  last_seen_at?: string;
  seen_count?: number;
  session_refs?: unknown[];
  status_changed_at?: string;
  status_note?: string;
  // set by the attach action: "claim" | "alias" | "notes"
  attached_as?: string;
  // set by the attach action: "<kind>/<slug>"
  attached_to?: string;
  extra?: Record<string, unknown>;
}

export async function loadBacklog(): Promise<BacklogItem[]> {
  const file = path.join(getCataloguePath(), "_backlog.yaml");
  try {
    const raw = await withFsRetry(() => fs.readFile(file, "utf-8"));
    const data = yaml.load(raw);
    if (Array.isArray(data)) return data as BacklogItem[];
    return [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// ───────────────────────────────────────────────────────────────────
// Proactive client health detectors — dormancy, plateau, regression.
// Surfaced as banner strips on the dashboard above the per-client
// triage cards so coach sees "3 clients haven't checked in for 2 weeks"
// without eyeballing every sparkline. Added 2026-05-19 from the dry-run
// audit (gap B1).
//
// All three operate purely off existing client.yaml data (sessions/
// directory + measurements_log array). No new fields, no migration.
// ───────────────────────────────────────────────────────────────────

export interface DormantClient {
  client_id: string;
  display_name: string;
  daysSilent: number;
  lastSignalAt?: string;        // ISO date of the most recent session, if any
}

/** Clients with no recorded contact (any session type — check_in,
 *  quick_note, full_assessment, whatsapp webhook quick_note, etc.) in
 *  the last `daysThreshold` days. Excludes brand-new clients (intake
 *  within the last N days) so first-touch onboarding doesn't flag.
 *
 *  Reads `~/fm-plans/clients/<id>/sessions/` directly (cheap fs.readdir
 *  on session filenames which are ISO-prefixed). */
export async function getDormantClients(
  clientIds: string[],
  daysThreshold: number = 14,
): Promise<DormantClient[]> {
  if (clientIds.length === 0) return [];
  const root = getPlansRoot();
  const today = new Date();
  const cutoff = new Date(today.getTime() - daysThreshold * 86_400_000);
  const intakeGrace = new Date(today.getTime() - 7 * 86_400_000);

  const out: DormantClient[] = [];
  await Promise.all(
    clientIds.map(async (id) => {
      const sessionsDir = path.join(root, "clients", id, "sessions");
      let lastDate: string | undefined;
      try {
        const names = await withFsRetry(() => fs.readdir(sessionsDir));
        // Session filenames start with a YYYY-MM-DD date prefix —
        // whichever sorts last is the most recent. Cheap path.
        const dated = names
          .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
          .map((n) => {
            const m = n.match(/(\d{4}-\d{2}-\d{2})/);
            return m ? m[1] : null;
          })
          .filter((d): d is string => !!d)
          .sort();
        lastDate = dated[dated.length - 1];
      } catch {
        // No sessions dir at all — newer client; skip the intake-grace
        // check below and fall through to "no recent" if intake is
        // also stale.
      }

      // Pull intake date for the grace check + display.
      const clientYamlPath = path.join(root, "clients", id, "client.yaml");
      let intakeDate: string | undefined;
      let displayName = id;
      try {
        const raw = await withFsRetry(() => fs.readFile(clientYamlPath, "utf-8"));
        const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
        intakeDate = data.intake_date as string | undefined;
        displayName = (data.display_name as string | undefined) ?? id;
      } catch {
        return; // Bad client — skip silently
      }

      // Grace period: don't flag a client whose intake was within the
      // last 7 days even if they haven't logged any sessions yet.
      if (intakeDate) {
        try {
          if (new Date(intakeDate) > intakeGrace) return;
        } catch {
          /* malformed intake_date — fall through to dormancy check */
        }
      }

      // If we have a recent session, no flag.
      if (lastDate && new Date(lastDate) > cutoff) return;

      const daysSilent = Math.max(
        0,
        Math.round(
          (today.getTime() -
            (lastDate ? new Date(lastDate).getTime() : new Date(intakeDate ?? today).getTime())) /
            86_400_000,
        ),
      );
      out.push({ client_id: id, display_name: displayName, daysSilent, lastSignalAt: lastDate });
    }),
  );
  // Most-overdue first so coach sees the worst cases at the top.
  out.sort((a, b) => b.daysSilent - a.daysSilent);
  return out;
}

export interface PlateauedClient {
  client_id: string;
  display_name: string;
  consecutiveStaticReadings: number;
  rangeKg: number;            // max-min across the static window
  latestWeightKg: number;
  latestDate: string;
}

/** Clients with N consecutive measurements_log entries whose weight
 *  values all fall within ±threshold kg of each other. Default: 3
 *  consecutive readings within ±0.3kg = "weight has stalled".
 *
 *  Only fires when the client has a weight_loss.enabled goal — there's
 *  no point flagging a maintenance client as plateaued. */
export async function getPlateauedClients(
  clientIds: string[],
  thresholdKg: number = 0.3,
  minReadings: number = 3,
): Promise<PlateauedClient[]> {
  if (clientIds.length === 0) return [];
  const root = getPlansRoot();
  const out: PlateauedClient[] = [];

  await Promise.all(
    clientIds.map(async (id) => {
      try {
        const raw = await withFsRetry(() => fs.readFile(
          path.join(root, "clients", id, "client.yaml"),
          "utf-8",
        ));
        const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
        const wl = data.weight_loss as Record<string, unknown> | undefined;
        if (!wl || wl.enabled !== true) return;

        const log = (data.measurements_log as Array<Record<string, unknown>>) ?? [];
        // measurements_log is sorted newest-first; pull weight entries.
        const weights = log
          .map((e) => {
            const w = e.weight_kg;
            const d = e.date as string | undefined;
            return typeof w === "number" && d ? { date: d, kg: w } : null;
          })
          .filter((x): x is { date: string; kg: number } => !!x);
        if (weights.length < minReadings) return;

        // Take the most recent `minReadings` entries and check if they
        // all fit inside a ±thresholdKg window.
        const recent = weights.slice(0, minReadings);
        const ks = recent.map((r) => r.kg);
        const range = Math.max(...ks) - Math.min(...ks);
        if (range > 2 * thresholdKg) return;

        out.push({
          client_id: id,
          display_name: (data.display_name as string | undefined) ?? id,
          consecutiveStaticReadings: minReadings,
          rangeKg: +range.toFixed(2),
          latestWeightKg: recent[0].kg,
          latestDate: recent[0].date,
        });
      } catch {
        /* skip clients with no/unreadable yaml */
      }
    }),
  );
  return out;
}

export interface RegressedClient {
  client_id: string;
  display_name: string;
  startingKg: number;
  latestKg: number;
  gainedKg: number;
  latestDate: string;
}

/** Clients whose latest measurement is ≥thresholdKg higher than their
 *  starting weight in weight_loss config. Indicates the protocol may
 *  not be working OR client has fallen off — either way coach should
 *  see them surfaced. */
export async function getRegressedClients(
  clientIds: string[],
  thresholdKg: number = 1.0,
): Promise<RegressedClient[]> {
  if (clientIds.length === 0) return [];
  const root = getPlansRoot();
  const out: RegressedClient[] = [];

  await Promise.all(
    clientIds.map(async (id) => {
      try {
        const raw = await withFsRetry(() => fs.readFile(
          path.join(root, "clients", id, "client.yaml"),
          "utf-8",
        ));
        const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
        const wl = data.weight_loss as Record<string, unknown> | undefined;
        if (!wl || wl.enabled !== true) return;
        const startingKg = wl.starting_weight_kg;
        if (typeof startingKg !== "number") return;

        const log = (data.measurements_log as Array<Record<string, unknown>>) ?? [];
        const latest = log.find((e) => typeof e.weight_kg === "number");
        if (!latest) return;
        const latestKg = latest.weight_kg as number;
        const latestDate = latest.date as string;
        const gainedKg = +(latestKg - startingKg).toFixed(2);
        if (gainedKg < thresholdKg) return;

        out.push({
          client_id: id,
          display_name: (data.display_name as string | undefined) ?? id,
          startingKg,
          latestKg,
          gainedKg,
          latestDate,
        });
      } catch {
        /* skip */
      }
    }),
  );
  // Worst regression first.
  out.sort((a, b) => b.gainedKg - a.gainedKg);
  return out;
}

/**
 * Combined client-health scanner. Reads each client.yaml + sessions dir
 * EXACTLY ONCE per client (versus 3 separate fs walks when calling the
 * three legacy `get*Clients` functions individually). Returns the same
 * three buckets the dashboard uses.
 *
 * Perf win on a 50+ client deployment: ~50 client.yaml reads instead of
 * 100+ (each of plateaued + regressed used to read every client.yaml
 * independently). Dormant still needs the sessions/ readdir but that's
 * a separate path. ~30% faster dashboard render in practice.
 */
export interface ClientHealthSignalsResult {
  dormant: DormantClient[];
  plateaued: PlateauedClient[];
  regressed: RegressedClient[];
}

export async function getClientHealthSignals(
  clientIds: string[],
  options?: {
    dormantDays?: number;
    plateauThresholdKg?: number;
    plateauMinReadings?: number;
    regressedThresholdKg?: number;
  },
): Promise<ClientHealthSignalsResult> {
  const dormantDays = options?.dormantDays ?? 14;
  const plateauThreshold = options?.plateauThresholdKg ?? 0.3;
  const plateauMinReadings = options?.plateauMinReadings ?? 3;
  const regressedThreshold = options?.regressedThresholdKg ?? 1.0;

  if (clientIds.length === 0) {
    return { dormant: [], plateaued: [], regressed: [] };
  }

  const root = getPlansRoot();
  const today = new Date();
  const dormantCutoff = new Date(today.getTime() - dormantDays * 86_400_000);
  const intakeGrace = new Date(today.getTime() - 7 * 86_400_000);

  const dormant: DormantClient[] = [];
  const plateaued: PlateauedClient[] = [];
  const regressed: RegressedClient[] = [];

  await Promise.all(
    clientIds.map(async (id) => {
      // ─── Single read of client.yaml ────────────────────────────────
      let data: Record<string, unknown> = {};
      try {
        const raw = await withFsRetry(() => fs.readFile(
          path.join(root, "clients", id, "client.yaml"),
          "utf-8",
        ));
        data = (yaml.load(raw) as Record<string, unknown>) ?? {};
      } catch {
        return; // unreadable client.yaml → skip all three checks
      }

      const displayName = (data.display_name as string | undefined) ?? id;
      const intakeDate = data.intake_date as string | undefined;
      const wl = data.weight_loss as Record<string, unknown> | undefined;
      const log = (data.measurements_log as Array<Record<string, unknown>>) ?? [];

      // ─── Dormant check (needs sessions/ readdir) ───────────────────
      let lastSessionDate: string | undefined;
      try {
        const names = await withFsRetry(() => fs.readdir(
          path.join(root, "clients", id, "sessions"),
        ));
        const dated = names
          .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
          .map((n) => {
            const m = n.match(/(\d{4}-\d{2}-\d{2})/);
            return m ? m[1] : null;
          })
          .filter((d): d is string => !!d)
          .sort();
        lastSessionDate = dated[dated.length - 1];
      } catch {
        /* no sessions dir — newer client */
      }
      const intakeRecent = (() => {
        if (!intakeDate) return false;
        try {
          return new Date(intakeDate) > intakeGrace;
        } catch {
          return false;
        }
      })();
      const hasRecentSession = !!(
        lastSessionDate && new Date(lastSessionDate) > dormantCutoff
      );
      if (!intakeRecent && !hasRecentSession) {
        const daysSilent = Math.max(
          0,
          Math.round(
            (today.getTime() -
              (lastSessionDate
                ? new Date(lastSessionDate).getTime()
                : new Date(intakeDate ?? today).getTime())) /
              86_400_000,
          ),
        );
        dormant.push({
          client_id: id,
          display_name: displayName,
          daysSilent,
          lastSignalAt: lastSessionDate,
        });
      }

      // ─── Weight-based checks: only if weight_loss.enabled ──────────
      if (!wl || wl.enabled !== true) return;

      const weights = log
        .map((e) => {
          const w = e.weight_kg;
          const d = e.date as string | undefined;
          return typeof w === "number" && d ? { date: d, kg: w } : null;
        })
        .filter((x): x is { date: string; kg: number } => !!x);

      // ─── Plateau check ─────────────────────────────────────────────
      if (weights.length >= plateauMinReadings) {
        const recent = weights.slice(0, plateauMinReadings);
        const ks = recent.map((r) => r.kg);
        const range = Math.max(...ks) - Math.min(...ks);
        if (range <= 2 * plateauThreshold) {
          plateaued.push({
            client_id: id,
            display_name: displayName,
            consecutiveStaticReadings: plateauMinReadings,
            rangeKg: +range.toFixed(2),
            latestWeightKg: recent[0].kg,
            latestDate: recent[0].date,
          });
        }
      }

      // ─── Regression check ──────────────────────────────────────────
      const startingKg = wl.starting_weight_kg;
      if (typeof startingKg === "number" && weights.length > 0) {
        const latest = weights[0];
        const gainedKg = +(latest.kg - startingKg).toFixed(2);
        if (gainedKg >= regressedThreshold) {
          regressed.push({
            client_id: id,
            display_name: displayName,
            startingKg,
            latestKg: latest.kg,
            gainedKg,
            latestDate: latest.date,
          });
        }
      }
    }),
  );

  // Sort to match the legacy single-scan return order
  dormant.sort((a, b) => b.daysSilent - a.daysSilent);
  regressed.sort((a, b) => b.gainedKg - a.gainedKg);

  return { dormant, plateaued, regressed };
}
