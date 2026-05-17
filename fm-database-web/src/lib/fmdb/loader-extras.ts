import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath, getPlansRoot, getResourcesRoot } from "./paths";
import type { Client, MindMap } from "./types";

async function readYaml<T>(absPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absPath, "utf-8");
    return yaml.load(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
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
    const raw = await fs.readFile(path.join(root, INBOX_STATE_FILE_NAME), "utf-8");
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
    const raw = await fs.readFile(path.join(root, COACH_INBOX_STATE_FILE_NAME), "utf-8");
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
function countDraftFields(draft: unknown): number {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return 0;
  let n = 0;
  for (const v of Object.values(draft as Record<string, unknown>)) {
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
        names = await fs.readdir(dir);
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
        const createdAt = typeof data.created_at === "string" ? data.created_at : undefined;
        // Acknowledged? If we have both a read-state timestamp and a
        // message timestamp and the message is <= read-state, drop it.
        // Missing created_at on the session → treat as unread (better to
        // surface a stale notification than silently swallow a real one).
        if (createdAt && lastReadAt && createdAt <= lastReadAt) continue;
        const text = stripSessionTags(complaints).slice(0, 120);
        results.push({
          client_id: id,
          display_name: clientNames.get(id),
          date: String(data.date ?? "").slice(0, 10),
          created_at: createdAt,
          text,
        });
      }
    })
  );

  return results.sort((a, b) =>
    (b.created_at ?? b.date).localeCompare(a.created_at ?? a.date),
  );
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
  },
): Promise<UpcomingBooking[]> {
  const root = getPlansRoot();
  let raw: Record<string, RawBookingEvent[]> = {};
  try {
    const text = await fs.readFile(path.join(root, "_calcom_bookings.yaml"), "utf-8");
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, RawBookingEvent[]>;
    }
  } catch {
    return [];
  }

  const includePast = options?.includePast ?? false;
  const pastCutoffMs = Date.now() - (options?.pastDays ?? 1) * 86_400_000;
  const limit = options?.limit ?? 20;
  const nowMs = Date.now();

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

      rows.push({
        client_id: clientId,
        display_name: clientNames.get(clientId),
        start_time: e.start_time,
        end_time: e.end_time,
        event_slug: e.event_slug,
        event_title: e.event_title,
        current_state: stateRaw || "CREATED",
        uid: e.uid,
      });
    }
  }

  rows.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return rows.slice(0, limit);
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
    const raw = await fs.readFile(path.join(root, "_calcom_bookings.yaml"), "utf-8");
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
        const names = await fs.readdir(sessDir);
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
    const raw = await fs.readFile(file, "utf-8");
    const data = yaml.load(raw);
    if (Array.isArray(data)) return data as BacklogItem[];
    return [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
