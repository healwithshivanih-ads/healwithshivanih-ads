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
 */
export async function getRecentIntakeActivity(
  clients: Array<Record<string, unknown>>,
  daysBack = 7,
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
