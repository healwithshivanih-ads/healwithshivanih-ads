"use server";

/**
 * plan-change-notify — queue a client email whenever a published plan changes
 * in a way the client has to act on, and hold it for coach approval.
 *
 * WHY SNAPSHOT-BASED rather than hooking the edit sites: published plans are
 * written in place by at least four different paths (quick-edit practices,
 * remedies.ts, weekly-menu.ts, supplement-change-notify.ts) and more will be
 * added. Hooking each one means every future write path silently opts out of
 * notifying. Instead we keep a per-plan snapshot of the client-visible surface
 * and diff it on a schedule, so a change is caught no matter who made it.
 *
 * NOTHING IS EVER SENT FROM HERE. A detected change becomes a DRAFT. The
 * coach approves it, and approval hands the email to the existing
 * _pending_sends.yaml queue that the pending-sends cron already drains — no
 * new send plumbing, no new transport, no second dispatcher to keep alive.
 *
 * Stops are held until the coach types a reason. "Stop taking X" arriving
 * cold reads as something went wrong.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { diffPlanForClient, requiresReason, type MaterialChange } from "@/lib/fmdb/plan-change-diff";
import { renderPlanChangeEmail } from "@/lib/fmdb/plan-change-email";

type Dict = Record<string, unknown>;

const SEEN_FILE = "_plan_change_seen.yaml";
const DRAFTS_FILE = "_plan_change_drafts.yaml";
const PENDING_FILE = "_pending_sends.yaml";
const BODY_DIR = "_plan_change_emails";

export interface PlanChangeDraft {
  id: string;
  client_id: string;
  client_name: string;
  plan_slug: string;
  created_at: string;
  changes: MaterialChange[];
  /** True when anything is being stopped — approval is blocked without a reason. */
  needs_reason: boolean;
  reason?: string;
  status: "pending" | "approved" | "dismissed";
  /** Set once approved, so the row is auditable after the fact. */
  approved_at?: string;
}

async function readYaml<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(getPlansRoot(), file), "utf-8");
    return (yaml.load(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeYaml(file: string, data: unknown): Promise<void> {
  const p = path.join(getPlansRoot(), file);
  // lineWidth -1 keeps long instruction strings on one line rather than
  // folding them, which round-trips more predictably through PyYAML.
  await fs.writeFile(p, yaml.dump(data, { lineWidth: -1, noRefs: true }), "utf-8");
}

/** Newest published version of a slug. Mirrors supplement-change-notify.ts. */
async function publishedDoc(slug: string): Promise<Dict | null> {
  const dir = path.join(getPlansRoot(), "published");
  try {
    const entries = await fs.readdir(dir);
    const match = entries
      .filter((n) => n.startsWith(`${slug}-v`) && (n.endsWith(".yaml") || n.endsWith(".yml")))
      .sort()
      .reverse()[0];
    if (!match) return null;
    return ((yaml.load(await fs.readFile(path.join(dir, match), "utf-8")) as Dict) ?? {}) as Dict;
  } catch {
    return null;
  }
}

async function readClient(clientId: string): Promise<Dict | null> {
  try {
    const f = path.join(getPlansRoot(), "clients", clientId, "client.yaml");
    return ((yaml.load(await fs.readFile(f, "utf-8")) as Dict) ?? {}) as Dict;
  } catch {
    return null;
  }
}

/**
 * The client-visible surface of a plan, and nothing else. Stored rather than a
 * hash so the diff can report what actually changed.
 */
function snapshot(plan: Dict): Dict {
  return {
    supplement_protocol: ((plan.supplement_protocol as Dict[] | undefined) ?? []).map((s) => ({
      supplement_slug: s?.supplement_slug ?? s?.name ?? "",
      display_name: s?.display_name ?? "",
      dose: s?.dose ?? "",
      timing: s?.timing ?? "",
    })),
    lifestyle_practices: ((plan.lifestyle_practices as Dict[] | undefined) ?? []).map((p) => ({
      name: p?.name ?? "",
    })),
  };
}

/**
 * Scan every published plan for client-material changes since the last scan.
 *
 * Idempotent: the snapshot is advanced whether or not a draft was raised, so a
 * change is only ever drafted once. Dismissing a draft therefore does not
 * cause it to reappear on the next scan.
 *
 * First sight of a plan records the snapshot and raises nothing — a plan's
 * initial contents are delivered by the plan, not by a change email.
 */
export async function scanPlanChangesAction(): Promise<{
  ok: true;
  drafted: number;
  scanned: number;
}> {
  const dir = path.join(getPlansRoot(), "published");
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return { ok: true, drafted: 0, scanned: 0 };
  }

  const slugs = Array.from(
    new Set(
      files
        .filter((n) => /-v\d+\.ya?ml$/.test(n))
        .map((n) => n.replace(/-v\d+\.ya?ml$/, "")),
    ),
  );

  const seen = await readYaml<Record<string, Dict>>(SEEN_FILE, {});
  const drafts = await readYaml<PlanChangeDraft[]>(DRAFTS_FILE, []);
  let drafted = 0;

  for (const slug of slugs) {
    const plan = await publishedDoc(slug);
    if (!plan) continue;
    const current = snapshot(plan);
    const previous = seen[slug] ?? null;
    seen[slug] = current;

    if (!previous) continue; // first sight — record only

    const changes = diffPlanForClient(previous, current);
    if (changes.length === 0) continue;

    const clientId = String(plan.client_id ?? "");
    if (!clientId) continue;
    const client = await readClient(clientId);

    drafts.push({
      id: `pc-${slug}-${crypto.randomBytes(4).toString("hex")}`,
      client_id: clientId,
      client_name: String(client?.display_name ?? clientId),
      plan_slug: slug,
      created_at: new Date().toISOString(),
      changes,
      needs_reason: requiresReason(changes),
      status: "pending",
    });
    drafted++;
  }

  await writeYaml(SEEN_FILE, seen);
  if (drafted > 0) await writeYaml(DRAFTS_FILE, drafts);
  return { ok: true, drafted, scanned: slugs.length };
}

/** Pending drafts, newest first — what the digest and the coach panel render. */
export async function listPlanChangeDraftsAction(): Promise<PlanChangeDraft[]> {
  const drafts = await readYaml<PlanChangeDraft[]>(DRAFTS_FILE, []);
  return drafts
    .filter((d) => d.status === "pending")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * Approve a draft → hand it to the existing _pending_sends.yaml queue.
 *
 * Refuses when the draft stops something and no reason has been supplied.
 * send_at is now, so the next pending-sends tick (every minute) delivers it.
 */
export async function approvePlanChangeDraftAction(
  id: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const drafts = await readYaml<PlanChangeDraft[]>(DRAFTS_FILE, []);
  const draft = drafts.find((d) => d.id === id && d.status === "pending");
  if (!draft) return { ok: false, error: "draft_not_found" };

  const finalReason = (reason ?? draft.reason ?? "").trim();
  if (draft.needs_reason && !finalReason) {
    return {
      ok: false,
      error:
        "This update stops something. Add a line of context first — a bare " +
        "'stop taking X' reads as though something went wrong.",
    };
  }

  const client = await readClient(draft.client_id);
  const to = String(client?.email ?? "").trim();
  if (!to) return { ok: false, error: "client_has_no_email" };

  const { subject, body } = renderPlanChangeEmail({
    displayName: draft.client_name,
    changes: draft.changes,
    reason: finalReason || undefined,
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/$/, ""),
  });

  const bodyDir = path.join(getPlansRoot(), BODY_DIR);
  await fs.mkdir(bodyDir, { recursive: true });
  const bodyFile = path.join(bodyDir, `${draft.id}.txt`);
  await fs.writeFile(bodyFile, body, "utf-8");

  const pending = await readYaml<Dict[]>(PENDING_FILE, []);
  pending.push({
    id: draft.id,
    send_at: new Date().toISOString(),
    kind: "email",
    client_id: draft.client_id,
    plan_slug: draft.plan_slug,
    email: { to, bcc: process.env.GMAIL_USER ?? "", subject, body_file: bodyFile },
    created_at: new Date().toISOString(),
  });
  await writeYaml(PENDING_FILE, pending);

  draft.status = "approved";
  draft.reason = finalReason || undefined;
  draft.approved_at = new Date().toISOString();
  await writeYaml(DRAFTS_FILE, drafts);
  return { ok: true };
}

/** Dismiss without sending. The snapshot already moved, so it will not return. */
export async function dismissPlanChangeDraftAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const drafts = await readYaml<PlanChangeDraft[]>(DRAFTS_FILE, []);
  const draft = drafts.find((d) => d.id === id && d.status === "pending");
  if (!draft) return { ok: false, error: "draft_not_found" };
  draft.status = "dismissed";
  await writeYaml(DRAFTS_FILE, drafts);
  return { ok: true };
}

/** Preview exactly what would be sent, without approving. */
export async function previewPlanChangeDraftAction(
  id: string,
  reason?: string,
): Promise<{ ok: boolean; subject?: string; body?: string; error?: string }> {
  const drafts = await readYaml<PlanChangeDraft[]>(DRAFTS_FILE, []);
  const draft = drafts.find((d) => d.id === id);
  if (!draft) return { ok: false, error: "draft_not_found" };
  const { subject, body } = renderPlanChangeEmail({
    displayName: draft.client_name,
    changes: draft.changes,
    reason: (reason ?? draft.reason ?? "").trim() || undefined,
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || "https://intake.theochretree.com").replace(/\/$/, ""),
  });
  return { ok: true, subject, body };
}
