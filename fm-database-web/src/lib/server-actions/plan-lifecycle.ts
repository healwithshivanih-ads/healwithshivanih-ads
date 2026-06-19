"use server";

import { revalidatePath } from "next/cache";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { writePlan } from "@/lib/fmdb/writer";
import { getPlansRoot } from "@/lib/fmdb/paths";

const FMDB_ROOT = path.resolve(process.cwd(), "..", "fm-database");
const WEB_ROOT = process.cwd();
const TIMEOUT_MS = 60_000;

export interface LifecycleResult {
  ok: boolean;
  error?: string | null;
  plan?: Record<string, unknown> | null;
  written_path?: string | null;
  git_sha?: string | null;
}

export interface DiffResult {
  ok: boolean;
  diff?: string | null;
  error?: string | null;
}

export interface RenderResult {
  ok: boolean;
  content?: string | null;
  error?: string | null;
}

interface LifecyclePayload {
  action: "submit" | "publish" | "revoke" | "supersede" | "diff" | "graduate";
  slug: string;
  by?: string;
  reason?: string;
  slug_b?: string;
  dry_run?: boolean;
}

function runShim<T = unknown>(
  scriptName: string,
  payload: unknown,
  timeoutMs: number = TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve) => {
    const py = path.join(FMDB_ROOT, ".venv/bin/python");
    const script = path.join(WEB_ROOT, "scripts", scriptName);
    const child = spawn(py, [script], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      timer = null;
      resolve({ ok: false, error: String(err) } as T);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!stdout.trim()) {
        resolve({
          ok: false,
          error: `${scriptName} exited ${code} with no stdout: ${stderr.slice(0, 500)}`,
        } as T);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (e) {
        resolve({
          ok: false,
          error: `failed to parse ${scriptName} output: ${e}\nstdout: ${stdout.slice(0, 500)}`,
        } as T);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function lifecycle(payload: LifecyclePayload): Promise<LifecycleResult> {
  return runShim<LifecycleResult>("plan-lifecycle.py", payload);
}

function bust(slug: string) {
  revalidatePath("/plans");
  revalidatePath(`/plans/${slug}`, "page");
}

export async function submitPlan(
  slug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "submit", slug, reason });
  if (r.ok) bust(slug);
  return r;
}

export async function publishPlan(
  slug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "publish", slug, reason });
  if (r.ok) {
    bust(slug);
    // Fire plan-letter WhatsApp + queue +6h supplement nudge. Guarded by
    // FM_AUTO_PUBLISH_FOLLOWUPS so dev publishes don't spam clients.
    // Failures don't block the publish; they surface in logs.
    if (process.env.FM_AUTO_PUBLISH_FOLLOWUPS === "1") {
      try {
        await firePlanPublishFollowupsForSlug(slug);
      } catch (e) {
        console.warn(
          `[publish-followups] non-fatal failure for ${slug}: ${(e as Error).message}`,
        );
      }
    }
  }
  return r;
}

/** Remove a single supplement from an active (published) plan in-place
 *  without creating a successor. Coach UX shortcut (B6 from dry-run
 *  audit 2026-05-19) — the formal supersede flow is 4 steps, but for
 *  trivial mid-plan tweaks ("stop selenium, food source is enough") a
 *  direct edit is what the coach actually wants.
 *
 *  Trade-offs: the published YAML mutates in place, which technically
 *  breaks the "published is immutable" invariant. We mitigate by:
 *    1. Appending a `status_history` event recording what was removed.
 *    2. Bumping `updated_at` so the staleness detector can find it.
 *  Plans that need real lifecycle changes (protocol pivot, new phase)
 *  should still go through createSuccessor → publish → supersede. */
export async function removeSupplementFromActivePlan(
  planSlug: string,
  supplementSlug: string,
  reason?: string,
): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> {
  if (!planSlug) return { ok: false, error: "planSlug required" };
  if (!supplementSlug) return { ok: false, error: "supplementSlug required" };

  try {
    const root = getPlansRoot();
    // Find the published plan file. Pattern: published/<slug>-vN.yaml
    const dir = path.join(root, "published");
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const match = names.find((n) =>
      n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml"),
    );
    if (!match) {
      return {
        ok: false,
        error: `No published plan found matching slug ${planSlug}.`,
      };
    }
    const planPath = path.join(dir, match);
    const raw = await fs.readFile(planPath, "utf-8");
    const { default: yaml } = await import("js-yaml");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const supplements = (data.supplement_protocol as Array<Record<string, unknown>>) ?? [];
    const before = supplements.length;
    const filtered = supplements.filter(
      (s) => (s.supplement_slug as string | undefined) !== supplementSlug,
    );
    if (filtered.length === before) {
      return { ok: true, removed: false };
    }
    data.supplement_protocol = filtered;
    data.updated_at = new Date().toISOString();

    // Audit: append a status_history event capturing what changed.
    const history = (data.status_history as Array<Record<string, unknown>>) ?? [];
    history.push({
      state: "published",
      by: process.env.FMDB_USER || "shivani",
      at: new Date().toISOString(),
      reason: `Removed supplement: ${supplementSlug}${reason ? ` — ${reason}` : ""}`,
    });
    data.status_history = history;

    await fs.writeFile(
      planPath,
      yaml.dump(data, { noRefs: true, sortKeys: false }),
      "utf-8",
    );

    // Revalidate everywhere the plan + downstream letter status surface.
    const clientId = (data.client_id as string | undefined) ?? "";
    if (clientId) {
      revalidatePath(`/clients-v2/${clientId}`);
      revalidatePath(`/clients-v2/${clientId}/plan`);
      revalidatePath(`/clients-v2/${clientId}/communicate`);
    }
    revalidatePath(`/plans/${planSlug}`);
    return { ok: true, removed: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Quick-edit a single supplement on an ACTIVE (published) plan in place
 *  — adjust its dose and/or timing, or remove it — WITHOUT the 4-step
 *  supersede flow. For trivial mid-plan tweaks ("drop omega-3 to 1 g")
 *  a direct edit is what the coach wants; the formal createSuccessor →
 *  publish → supersede route stays for protocol pivots / new phases.
 *
 *  Same immutability trade-off + mitigation as removeSupplementFromActivePlan:
 *    1. Appends a status_history audit event capturing exactly what
 *       changed (old value → new value) + the coach's reason.
 *    2. Bumps updated_at so the letter-staleness detector flags any
 *       already-sent letters with a "regenerate" prompt.
 *  Future phase letters / meal plans regenerate from the live plan, so
 *  the change flows into every further letter automatically. */
export interface QuickSupplementEdit {
  /** add a brand-new supplement to the active plan */
  add?: boolean;
  dose?: string;
  timing?: string;
  remove?: boolean;
  reason?: string;
  /** add-only: client-facing name (drives display + buy-link name-match) */
  displayName?: string;
  /** add-only: phase the supplement starts in (default 1) */
  startWeek?: number;
  /** add-only: how many weeks it runs (null = ongoing) */
  durationWeeks?: number | null;
  /** add-only: coach rationale ("why") */
  coachRationale?: string;
}

export async function quickEditActivePlanSupplement(
  planSlug: string,
  supplementSlug: string,
  edit: QuickSupplementEdit,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  if (!planSlug) return { ok: false, error: "planSlug required" };
  if (!supplementSlug) return { ok: false, error: "supplementSlug required" };

  try {
    const root = getPlansRoot();
    const dir = path.join(root, "published");
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const match = names.find(
      (n) => n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml"),
    );
    if (!match) {
      return {
        ok: false,
        error: `No published plan found matching slug ${planSlug}.`,
      };
    }
    const planPath = path.join(dir, match);
    const raw = await fs.readFile(planPath, "utf-8");
    const { default: yaml } = await import("js-yaml");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const supplements =
      (data.supplement_protocol as Array<Record<string, unknown>>) ?? [];

    const idx = supplements.findIndex(
      (s) => (s.supplement_slug as string | undefined) === supplementSlug,
    );

    let summary: string;
    if (edit.add) {
      if (idx !== -1) {
        return {
          ok: false,
          error: `Supplement ${supplementSlug} is already in plan ${planSlug}.`,
        };
      }
      const label = edit.displayName?.trim();
      supplements.push({
        supplement_slug: supplementSlug,
        form: "capsule",
        dose: edit.dose?.trim() ?? "",
        timing: edit.timing?.trim() ?? "",
        take_with_food: "",
        duration_weeks:
          typeof edit.durationWeeks === "number" ? edit.durationWeeks : null,
        start_week: edit.startWeek && edit.startWeek > 0 ? edit.startWeek : 1,
        titration: "",
        coach_rationale: edit.coachRationale?.trim() ?? "",
        intake_evidence: [],
        display_name: label || null,
        buy_link: null,
      });
      data.supplement_protocol = supplements;
      summary = `Added supplement: ${label || supplementSlug}`;
    } else if (idx === -1) {
      return {
        ok: false,
        error: `Supplement ${supplementSlug} is not in plan ${planSlug}.`,
      };
    } else if (edit.remove) {
      supplements.splice(idx, 1);
      data.supplement_protocol = supplements;
      summary = `Removed supplement: ${supplementSlug}`;
    } else {
      const item = supplements[idx];
      const changes: string[] = [];
      const newDose = edit.dose?.trim();
      const newTiming = edit.timing?.trim();
      if (newDose && newDose !== item.dose) {
        changes.push(`dose "${item.dose ?? "—"}" → "${newDose}"`);
        item.dose = newDose;
      }
      if (newTiming && newTiming !== item.timing) {
        changes.push(`timing "${item.timing ?? "—"}" → "${newTiming}"`);
        item.timing = newTiming;
      }
      if (changes.length === 0) return { ok: true, changed: false };
      summary = `Adjusted ${supplementSlug} — ${changes.join("; ")}`;
    }

    data.updated_at = new Date().toISOString();
    const history =
      (data.status_history as Array<Record<string, unknown>>) ?? [];
    history.push({
      state: "published",
      by: process.env.FMDB_USER || "shivani",
      at: new Date().toISOString(),
      reason: `Quick edit — ${summary}${edit.reason ? ` — ${edit.reason}` : ""}`,
    });
    data.status_history = history;

    await fs.writeFile(
      planPath,
      yaml.dump(data, { noRefs: true, sortKeys: false }),
      "utf-8",
    );

    const clientId = (data.client_id as string | undefined) ?? "";
    if (clientId) {
      revalidatePath(`/clients-v2/${clientId}`);
      revalidatePath(`/clients-v2/${clientId}/plan`);
      revalidatePath(`/clients-v2/${clientId}/communicate`);
    }
    revalidatePath(`/plans/${planSlug}`);
    return { ok: true, changed: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Apply an AI-chat patch to a PUBLISHED plan IN PLACE — same bypass philosophy
 *  as the quick-edit panels (published is normally frozen, but the coach drives
 *  these mid-plan tweaks directly). Shallow-merges the patch over the published
 *  YAML (the AI returns whole arrays for list fields, so replace is correct),
 *  keeps status `published`, appends a status_history audit line, bumps
 *  updated_at, and re-stages flow through the per-minute reconciler. Used only
 *  for published plans; drafts still go through updatePlanForChat. */
export async function applyChatPatchToPublishedPlan(
  planSlug: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true; changedKeys: string[] } | { ok: false; error: string }> {
  if (!planSlug) return { ok: false, error: "planSlug required" };
  const keys = Object.keys(patch ?? {}).filter(
    // never let an AI patch flip lifecycle / identity / audit fields
    (k) =>
      ![
        "status",
        "status_history",
        "slug",
        "client_id",
        "version",
        "catalogue_snapshot",
        "_bucket",
        "_file",
      ].includes(k),
  );
  if (keys.length === 0) return { ok: true, changedKeys: [] };
  try {
    const root = getPlansRoot();
    const dir = path.join(root, "published");
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const match = names.find((n) => n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml"));
    if (!match) return { ok: false, error: `No published plan found matching slug ${planSlug}.` };
    const planPath = path.join(dir, match);
    const raw = await fs.readFile(planPath, "utf-8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};

    for (const k of keys) data[k] = patch[k];
    data.updated_at = new Date().toISOString();
    const history = (data.status_history as Array<Record<string, unknown>>) ?? [];
    history.push({
      state: "published",
      by: process.env.FMDB_USER || "shivani",
      at: new Date().toISOString(),
      reason: `AI plan-chat edit — updated ${keys.join(", ")}`,
    });
    data.status_history = history;

    await fs.writeFile(planPath, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf-8");

    const clientId = (data.client_id as string | undefined) ?? "";
    if (clientId) {
      revalidatePath(`/clients-v2/${clientId}`);
      revalidatePath(`/clients-v2/${clientId}/plan`);
      revalidatePath(`/clients-v2/${clientId}/communicate`);
    }
    revalidatePath(`/plans/${planSlug}`);
    return { ok: true, changedKeys: keys };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface CoachRecommendationInput {
  title: string;
  forWhat?: string;
  note?: string;
  buyUrl?: string;
}

/** Add or remove a free-form coach pick (off-catalogue product/remedy tip) on
 *  the active plan, in place. Same direct-write + audit pattern as the
 *  supplement quick-edit; the per-minute reconciler re-stages it to the app. */
export async function editCoachRecommendation(
  planSlug: string,
  op: { add?: CoachRecommendationInput; removeIndex?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!planSlug) return { ok: false, error: "planSlug required" };
  try {
    const root = getPlansRoot();
    // Active plan can be in any non-archived bucket; published is the common case.
    let planPath = "";
    for (const bucket of ["published", "ready", "drafts"]) {
      const dir = path.join(root, bucket);
      const names = await fs.readdir(dir).catch(() => [] as string[]);
      const match = names.find(
        (n) =>
          (n.startsWith(`${planSlug}-v`) || n === `${planSlug}.yaml`) &&
          n.endsWith(".yaml"),
      );
      if (match) {
        planPath = path.join(dir, match);
        break;
      }
    }
    if (!planPath) return { ok: false, error: `No active plan found for ${planSlug}.` };

    const raw = await fs.readFile(planPath, "utf-8");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const recs = Array.isArray(data.coach_recommendations)
      ? (data.coach_recommendations as Array<Record<string, unknown>>)
      : [];

    let summary: string;
    if (op.add) {
      const title = op.add.title?.trim();
      if (!title) return { ok: false, error: "A title is required." };
      recs.push({
        title,
        for_what: op.add.forWhat?.trim() ?? "",
        note: op.add.note?.trim() ?? "",
        buy_url: op.add.buyUrl?.trim() ?? "",
      });
      summary = `Added recommendation: ${title}`;
    } else if (typeof op.removeIndex === "number") {
      if (op.removeIndex < 0 || op.removeIndex >= recs.length) {
        return { ok: false, error: "Recommendation not found." };
      }
      const [removed] = recs.splice(op.removeIndex, 1);
      summary = `Removed recommendation: ${(removed?.title as string) ?? ""}`;
    } else {
      return { ok: false, error: "Nothing to do." };
    }

    data.coach_recommendations = recs;
    data.updated_at = new Date().toISOString();
    const history = (data.status_history as Array<Record<string, unknown>>) ?? [];
    history.push({
      state: (data.status as string) ?? "published",
      by: process.env.FMDB_USER || "shivani",
      at: new Date().toISOString(),
      reason: `Coach pick — ${summary}`,
    });
    data.status_history = history;

    await fs.writeFile(planPath, yaml.dump(data, { noRefs: true, sortKeys: false }), "utf-8");

    const clientId = (data.client_id as string | undefined) ?? "";
    if (clientId) {
      revalidatePath(`/clients-v2/${clientId}`);
      revalidatePath(`/clients-v2/${clientId}/plan`);
    }
    revalidatePath(`/plans/${planSlug}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface QuickPracticeEdit {
  /** add a brand-new practice */
  add?: boolean;
  /** row position in lifestyle_practices for edit/remove */
  index?: number;
  /** optimistic-concurrency guard: the name we rendered at that index */
  originalName?: string;
  name?: string;
  cadence?: string;
  details?: string;
  remove?: boolean;
  reason?: string;
}

/**
 * quickEditActivePlanPractice — in-place add / edit / remove of a single
 * lifestyle practice on a PUBLISHED plan, same posture as the supplement
 * quick-edit above. Published plans are otherwise frozen; this is the
 * everyday "fix a duplicate / tweak the wording / drop one" path so the
 * coach isn't forced through createSuccessor→publish→supersede for a small
 * change. Mutates the published YAML in place, appends a status_history
 * audit line, bumps updated_at. The companion app + letters read the live
 * plan, so the change flows through on the next load.
 *
 * Practices have no stable slug, so edit/remove target a row INDEX with an
 * originalName guard — if the list shifted under us (another edit landed),
 * we refuse rather than touch the wrong row.
 */
export async function quickEditActivePlanPractice(
  planSlug: string,
  edit: QuickPracticeEdit,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  if (!planSlug) return { ok: false, error: "planSlug required" };

  try {
    const root = getPlansRoot();
    const dir = path.join(root, "published");
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const match = names.find(
      (n) => n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml"),
    );
    if (!match) {
      return { ok: false, error: `No published plan found matching slug ${planSlug}.` };
    }
    const planPath = path.join(dir, match);
    const raw = await fs.readFile(planPath, "utf-8");
    const { default: yaml } = await import("js-yaml");
    const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
    const practices =
      (data.lifestyle_practices as Array<Record<string, unknown>>) ?? [];

    let summary: string;

    if (edit.add) {
      const name = (edit.name ?? "").trim();
      if (!name) return { ok: false, error: "A practice name is required." };
      practices.push({
        name,
        cadence: (edit.cadence ?? "").trim() || "daily",
        details: (edit.details ?? "").trim(),
      });
      data.lifestyle_practices = practices;
      summary = `Added practice: ${name}`;
    } else {
      const idx = edit.index ?? -1;
      if (idx < 0 || idx >= practices.length) {
        return { ok: false, error: "That practice is no longer there — refresh and try again." };
      }
      const item = practices[idx];
      // Optimistic guard: the row at idx must still be the one we rendered.
      if (
        edit.originalName !== undefined &&
        (item.name as string | undefined) !== edit.originalName
      ) {
        return {
          ok: false,
          error: "The practices list changed since you opened it — refresh and try again.",
        };
      }

      if (edit.remove) {
        practices.splice(idx, 1);
        data.lifestyle_practices = practices;
        summary = `Removed practice: ${edit.originalName ?? (item.name as string) ?? `#${idx}`}`;
      } else {
        const changes: string[] = [];
        const newName = edit.name?.trim();
        const newCadence = edit.cadence?.trim();
        const newDetails = edit.details?.trim();
        if (newName !== undefined && newName !== "" && newName !== item.name) {
          changes.push(`name "${item.name ?? "—"}" → "${newName}"`);
          item.name = newName;
        }
        if (newCadence !== undefined && newCadence !== item.cadence) {
          changes.push(`cadence "${item.cadence ?? "—"}" → "${newCadence}"`);
          item.cadence = newCadence;
        }
        if (newDetails !== undefined && newDetails !== item.details) {
          changes.push("details edited");
          item.details = newDetails;
        }
        if (changes.length === 0) return { ok: true, changed: false };
        summary = `Adjusted practice "${item.name}" — ${changes.join("; ")}`;
      }
    }

    data.updated_at = new Date().toISOString();
    const history = (data.status_history as Array<Record<string, unknown>>) ?? [];
    history.push({
      state: "published",
      by: process.env.FMDB_USER || "shivani",
      at: new Date().toISOString(),
      reason: `Quick edit — ${summary}${edit.reason ? ` — ${edit.reason}` : ""}`,
    });
    data.status_history = history;

    await fs.writeFile(
      planPath,
      yaml.dump(data, { noRefs: true, sortKeys: false }),
      "utf-8",
    );

    const clientId = (data.client_id as string | undefined) ?? "";
    if (clientId) {
      revalidatePath(`/clients-v2/${clientId}`);
      revalidatePath(`/clients-v2/${clientId}/plan`);
      revalidatePath(`/clients-v2/${clientId}/reference`);
      revalidatePath(`/clients-v2/${clientId}/communicate`);
    }
    revalidatePath(`/plans/${planSlug}`);
    return { ok: true, changed: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Look up client info for a freshly-published plan, then fire the
 *  follow-up sends. Separate function so the publishPlan happy-path
 *  stays linear and easy to read. */
async function firePlanPublishFollowupsForSlug(slug: string): Promise<void> {
  const { loadPlanBySlug, loadAllClients } = await import("@/lib/fmdb/loader");
  const plan = await loadPlanBySlug(slug);
  if (!plan) return;
  const clientId = plan.client_id;
  if (!clientId) return;
  const clients = await loadAllClients();
  const client = clients.find(
    (c) => (c as Record<string, unknown>).client_id === clientId,
  ) as Record<string, unknown> | undefined;
  if (!client) return;
  const phone = (client.mobile_number as string | undefined) ?? "";
  const displayName = (client.display_name as string | undefined) ?? clientId;
  if (!phone) {
    console.warn(`[publish-followups] no mobile_number for ${clientId}, skipping`);
    return;
  }
  const { firePlanPublishFollowups } = await import("./plan-publish-followups");
  const res = await firePlanPublishFollowups({
    clientId,
    planSlug: slug,
    displayName,
    phone,
  });
  if (res.errors.length > 0) {
    console.warn(`[publish-followups] ${slug}: ${res.errors.join("; ")}`);
  }
}

export async function revokePlan(
  slug: string,
  reason: string
): Promise<LifecycleResult> {
  if (!reason || !reason.trim()) {
    return { ok: false, error: "Revoke requires a non-empty reason." };
  }
  const r = await lifecycle({ action: "revoke", slug, reason });
  if (r.ok) bust(slug);
  return r;
}

/** Graduate a published plan — terminal-success state, distinct from
 *  revoke (which is a withdrawal). Used when client has completed the
 *  protocol and is moving to maintenance / alumni. Dashboard counts +
 *  triage exclude graduated plans; they show under the 🎓 Alumni filter
 *  on /clients-v2. */
export async function graduatePlan(
  slug: string,
  reason?: string,
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "graduate", slug, reason });
  if (r.ok) {
    bust(slug);
    // Also revalidate the v2 surfaces so the client list + dashboard
    // reflect the new state immediately.
    revalidatePath("/clients-v2");
    revalidatePath("/dashboard-v2");
  }
  return r;
}

export async function supersedePlan(
  newSlug: string,
  reason?: string
): Promise<LifecycleResult> {
  const r = await lifecycle({ action: "supersede", slug: newSlug, reason });
  if (r.ok) bust(newSlug);
  return r;
}

export async function diffPlans(
  slugA: string,
  slugB: string
): Promise<DiffResult> {
  const r = await lifecycle({ action: "diff", slug: slugA, slug_b: slugB });
  return { ok: r.ok, diff: (r as unknown as DiffResult).diff, error: r.error };
}

/**
 * Structured diff of two plan versions — replaces the unified-diff text
 * with section-grouped, field-by-field cards for the "Compare versions"
 * UI in the v2 plan editor.
 *
 * Reads both plans as YAML objects directly (no Python shim) and runs the
 * pure-TypeScript compareTwoPlanVersions() walker.
 */
import { compareTwoPlanVersions, type SectionDiff } from "@/lib/fmdb/plan-version-compare";

export interface ComparePlansResult {
  ok: boolean;
  sections?: SectionDiff[];
  error?: string;
}

export async function comparePlanVersions(
  slugA: string,
  slugB: string
): Promise<ComparePlansResult> {
  if (!slugA || !slugB) {
    return { ok: false, error: "Both plan slugs are required." };
  }
  if (slugA === slugB) {
    return { ok: false, error: "Plan A and Plan B must be different plans." };
  }
  const [a, b] = await Promise.all([loadPlanBySlug(slugA), loadPlanBySlug(slugB)]);
  if (!a) return { ok: false, error: `Plan A (${slugA}) not found.` };
  if (!b) return { ok: false, error: `Plan B (${slugB}) not found.` };
  const sections = compareTwoPlanVersions(
    a as unknown as Record<string, unknown>,
    b as unknown as Record<string, unknown>
  );
  return { ok: true, sections };
}

export async function renderPlan(
  slug: string,
  format: "markdown" | "html"
): Promise<RenderResult> {
  return runShim<RenderResult>("plan-render.py", { slug, format });
}

export async function renderLabOrders(
  slug: string,
  format: "markdown" | "html"
): Promise<RenderResult> {
  const plan = await loadPlanBySlug(slug);
  if (!plan) return { ok: false, error: `Plan ${slug} not found.` };

  interface LabOrder { test: string; reason?: string }
  const labs = (plan.lab_orders as LabOrder[] | undefined) ?? [];
  if (labs.length === 0) {
    return { ok: false, error: "No lab orders on this plan yet." };
  }

  const clientName = (plan.client_id as string | undefined) ?? "Client";
  const date = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  const md = [
    `# Lab Order Sheet — ${clientName}`,
    `*Prepared by Functional Health Coach ${process.env.COACH_NAME || "Shivani Hari"} · ${date}*`,
    "",
    "Please get the following tests done **before your next session**.",
    "You can use whichever diagnostic lab you prefer.",
    "",
    "---",
    "",
    "## Tests to order",
    "",
    ...labs.map((l: LabOrder) => {
      const reason = l.reason ? `\n  > *${l.reason}*` : "";
      return `- **${l.test}**${reason}`;
    }),
    "",
    "---",
    "",
    "**Important:**",
    "- Most tests require a **fasting blood draw** (10–12 hours, water only). Check with your lab.",
    "- If you have your period, note it on the requisition — some hormone tests need cycle-day context.",
    "- Share the soft copy report with me as soon as you receive it.",
    "",
    "*Questions? WhatsApp me directly.*",
  ].join("\n");

  if (format === "markdown") {
    return { ok: true, content: md };
  }

  // Simple HTML version
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lab Order Sheet — ${clientName}</title>
<style>
  body { font-family: Georgia, serif; max-width: 720px; margin: 48px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.7; }
  h1 { font-size: 1.6rem; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 24px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
  h2 { font-size: 1.15rem; margin-bottom: 12px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 10px; }
  li strong { font-size: 1rem; }
  .reason { display: block; color: #555; font-size: 0.875rem; font-style: italic; margin-top: 2px; }
  .note { background: #fafaf8; border: 1px solid #e5e5e0; border-radius: 6px; padding: 16px 20px; font-size: 0.9rem; }
  .note ul { margin: 8px 0 0 0; }
  @media print { body { margin: 24px; } }
</style>
</head>
<body>
  <h1>Lab Order Sheet — ${clientName}</h1>
  <p class="subtitle">Prepared by Functional Health Coach ${process.env.COACH_NAME || "Shivani Hari"} &middot; ${date}</p>
  <p>Please get the following tests done <strong>before your next session</strong>.<br>
  You can use whichever diagnostic lab you prefer.</p>
  <hr>
  <h2>Tests to order</h2>
  <ul>
    ${labs.map((l: LabOrder) => `<li><strong>${l.test}</strong>${l.reason ? `<span class="reason">${l.reason}</span>` : ""}</li>`).join("\n    ")}
  </ul>
  <hr>
  <div class="note">
    <strong>Important:</strong>
    <ul>
      <li>Most tests require a <strong>fasting blood draw</strong> (10–12 hours, water only). Check with your lab.</li>
      <li>If you have your period, note it on the requisition — some hormone tests need cycle-day context.</li>
      <li>Share the soft copy report with me as soon as you receive it.</li>
    </ul>
    <p style="margin-bottom:0"><em>Questions? WhatsApp me directly.</em></p>
  </div>
</body>
</html>`;

  return { ok: true, content: html };
}

/**
 * Create a successor draft plan from an existing published plan. Loads the
 * old plan, clones its YAML into drafts/<newSlug>.yaml with `supersedes`
 * pointing back at the old slug, status reset to draft, version reset to 0.
 *
 * The coach can then edit the new draft, run plan-check, submit, and
 * supersede via the published-state action panel on the NEW slug.
 */
export async function createSuccessor(
  oldSlug: string,
  newSlug: string
): Promise<{ ok: boolean; error?: string }> {
  if (!newSlug || !newSlug.trim()) {
    return { ok: false, error: "New slug is required." };
  }
  if (newSlug === oldSlug) {
    return { ok: false, error: "New slug must differ from old slug." };
  }
  const old = await loadPlanBySlug(oldSlug);
  if (!old) return { ok: false, error: `Plan ${oldSlug} not found.` };

  // Make sure the new slug is not already taken
  const existing = await loadPlanBySlug(newSlug);
  if (existing) return { ok: false, error: `Plan ${newSlug} already exists.` };

  const root = getPlansRoot();
  const draftsDir = path.join(root, "drafts");
  await fs.mkdir(draftsDir, { recursive: true });

  // Clone, strip loader-only fields, reset lifecycle
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _bucket, _file, ...rest } = old;
  const successor: Record<string, unknown> = {
    ...rest,
    slug: newSlug,
    status: "draft",
    version: 0,
    supersedes: oldSlug,
    status_history: [],
    catalogue_snapshot: undefined,
  };
  // Use writePlan if it routes by status; otherwise write directly to drafts/
  try {
    await writePlan(successor as Parameters<typeof writePlan>[0]);
  } catch {
    // Fallback: write directly to drafts/<newSlug>.yaml
    const filePath = path.join(draftsDir, `${newSlug}.yaml`);
    await fs.writeFile(
      filePath,
      yaml.dump(successor, { noRefs: true, sortKeys: false }),
      "utf-8"
    );
  }
  bust(newSlug);
  revalidatePath("/plans");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Generate AI follow-up plan (next phase, adjusted from previous plan)
// ---------------------------------------------------------------------------

const FMDB_PLANS_DIR = process.env.FMDB_PLANS_DIR ?? `${process.env.HOME}/fm-plans`;

async function loadClientData(clientId: string): Promise<Record<string, unknown>> {
  try {
    const clientFile = path.join(FMDB_PLANS_DIR, "clients", clientId, "client.yaml");
    const raw = await fs.readFile(clientFile, "utf-8");
    return (yaml.load(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export interface FollowUpResult {
  ok: boolean;
  newSlug?: string;
  adjustmentSummary?: string;
  error?: string;
}

/**
 * Clone old plan → run AI to adjust for next phase → save as new draft.
 * The AI reads the previous plan + check-in notes from notes_for_coach
 * and returns a patch (changed fields only) for the follow-up phase.
 */
/** "next_phase" = continue active care with adjustments (default).
 *  "maintenance" = graduation; lighter plan with anchored habits + quarterly
 *  check-ins. Branches the AI prompt to apply different rules. */
export type FollowUpIntent = "next_phase" | "maintenance";

export async function generateFollowUpPlan(
  oldSlug: string,
  newSlug: string,
  phaseWeeks: string,
  clientId: string,
  intent: FollowUpIntent = "next_phase",
): Promise<FollowUpResult> {
  if (!newSlug?.trim()) return { ok: false, error: "New plan slug is required." };
  if (newSlug === oldSlug) return { ok: false, error: "New slug must differ from old slug." };

  const old = await loadPlanBySlug(oldSlug);
  if (!old) return { ok: false, error: `Plan ${oldSlug} not found.` };

  const existing = await loadPlanBySlug(newSlug);
  if (existing) return { ok: false, error: `Plan ${newSlug} already exists.` };

  const clientData = await loadClientData(clientId);

  // Strip loader-only fields
  const { _bucket, _file, ...oldRest } = old;
  void _bucket; void _file;

  // Call AI to generate adjustments
  const shimResult = await runShim("generate-follow-up.py", {
    old_plan_data: oldRest,
    client_data: clientData,
    new_slug: newSlug,
    phase_weeks: phaseWeeks,
    check_in_notes: "", // AI will extract from notes_for_coach
    intent,
  }, 120_000);

  const result = shimResult as {
    ok: boolean;
    plan_patch?: Record<string, unknown>;
    adjustment_summary?: string;
    error?: string;
  };

  if (!result.ok) return { ok: false, error: result.error ?? "AI generation failed" };

  const patch = result.plan_patch ?? {};
  const summary = result.adjustment_summary ?? "";

  // Build successor: clone old plan + apply AI patch
  const today = new Date().toISOString().slice(0, 10);

  // ── Attached protocols inheritance ───────────────────────────────────
  // The spread of `oldRest` carries `attached_protocols` implicitly, but
  // the audit found that the field was sometimes missing on the new
  // draft (likely because the AI tool-call returned an empty array in
  // `patch` for adjacent fields and a downstream merge clobbered it).
  // Make the carry-over explicit + record it in notes_for_coach so the
  // coach can see what was inherited and rotate if needed.
  //
  // For `maintenance` intent the previous protocols are usually dropped
  // — client is graduating off the active protocol. We still carry them
  // so coach can see what they were on, then she can detach via the
  // AttachedProtocolsPanel on the draft.
  const inheritedProtocols = Array.isArray(oldRest.attached_protocols)
    ? (oldRest.attached_protocols as string[])
    : [];
  const protocolsNote =
    inheritedProtocols.length > 0
      ? `[Inherited protocols] ${inheritedProtocols.join(", ")} — carried from ${oldSlug}. ${intent === "maintenance" ? "Detach via the 🧭 Healing programs panel if maintenance no longer needs them." : "Rotate via the 🧭 Healing programs panel if phase 2 needs different protocols."}`
      : "";

  const successor: Record<string, unknown> = {
    ...oldRest,
    ...patch,
    slug: newSlug,
    status: "draft",
    version: 0,
    supersedes: oldSlug,
    status_history: [],
    catalogue_snapshot: undefined,
    updated_at: today,
    // EXPLICIT carry — defensive, in case `patch` shadows it.
    attached_protocols: inheritedProtocols,
    // Prepend AI summary + protocols-carried note to notes_for_coach.
    // Header reflects intent so coach can scan and see whether this
    // draft is a next-phase continuation or a maintenance graduation.
    notes_for_coach: [
      summary
        ? `[${intent === "maintenance" ? "Maintenance graduation" : `Next phase (${phaseWeeks})`} adjustments]\n${summary}`
        : "",
      protocolsNote,
      "---",
      (oldRest.notes_for_coach as string) ?? "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  const root = getPlansRoot();
  const draftsDir = path.join(root, "drafts");
  await fs.mkdir(draftsDir, { recursive: true });

  try {
    await writePlan(successor as Parameters<typeof writePlan>[0]);
  } catch {
    const filePath = path.join(draftsDir, `${newSlug}.yaml`);
    await fs.writeFile(
      filePath,
      yaml.dump(successor, { noRefs: true, sortKeys: false }),
      "utf-8"
    );
  }

  revalidatePath("/plans");
  revalidatePath(`/plans/${newSlug}`);
  return { ok: true, newSlug, adjustmentSummary: summary };
}

// ---------------------------------------------------------------------------
// Generate AI client letter (friendly, personalised, meal-plan + recipes)
// ---------------------------------------------------------------------------

export interface LetterValidationChange {
  original_tip: string;
  score: number;
  reason: string;
  rewrite?: string;
}

export interface ClientLetterResult {
  ok: boolean;
  markdown?: string | null;
  html?: string | null;
  validation_report?: LetterValidationChange[] | null;
  /** Recipe pack sidecar — populated for phase letters (meal_plan_phase /
   *  meal_plan). When non-null, save the content alongside the main letter
   *  as `<stem>-recipes.md/.html`. The main letter's markdown already has
   *  a `## 📎 Recipes — attached separately` pointer; the sidecar file
   *  is what coach attaches to the email. */
  recipes_markdown?: string | null;
  recipes_html?: string | null;
  error?: string | null;
}

export interface WeightLossParams {
  enabled: boolean;
  goal_kg?: number;
  goal_weeks?: number;
  activity_level?: "sedentary" | "light" | "moderate" | "active";
  pace?: "slow" | "moderate" | "faster";
  exercise_current?: string;
  exercise_open_to?: string;
  exercise_days_per_week?: number;
  exercise_limitations?: string;
}

export interface RefinedLetterResult {
  ok: boolean;
  /** "discuss" — chat-only, no save. "finalise" — full rewrite + save. */
  mode?: "discuss" | "finalise";
  markdown?: string | null;
  html?: string | null;
  reply?: string | null;
  /** Pending-edits list maintained by the discuss prompt. Empty in finalise mode. */
  pending?: string[];
  /** True when we deliberately didn't write to disk (discuss reply, or
   *  finalise that came back too short to trust). */
  no_update?: boolean;
  error?: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function refineLetter(
  currentMarkdown: string,
  message: string,
  history: ChatTurn[],
  planSlug?: string,
  clientId?: string,
  mode: "discuss" | "finalise" = "discuss",
): Promise<RefinedLetterResult> {
  const result = await runShim<RefinedLetterResult>(
    "refine-letter.py",
    {
      markdown: currentMarkdown,
      message,
      history,
      mode,
      plan_slug: planSlug ?? "",
      client_id: clientId ?? "",
    },
    180_000
  );
  // Only saves on finalise mode AND when a real document came back.
  if (
    result.ok &&
    result.mode === "finalise" &&
    result.markdown &&
    !result.no_update &&
    planSlug &&
    clientId
  ) {
    await saveMealPlan(planSlug, clientId, result.markdown, result.html ?? null);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Meal plan persistence — save/load to clients/<id>/meal-plans/<slug>.md|html
// ---------------------------------------------------------------------------

export interface MealPlanData {
  ok: boolean;
  markdown?: string;
  html?: string;
  savedAt?: string;   // ISO timestamp of last save
  validationReport?: LetterValidationChange[];
  error?: string;
}

async function getMealPlanDir(clientId: string): Promise<string> {
  const root = getPlansRoot();
  const dir = path.join(root, "clients", clientId, "meal-plans");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export type LetterType =
  | "consolidated"
  | "meal_plan"
  | "meal_plan_phase"
  | "supplement_plan"
  | "lifestyle_guide"
  | "exercise_plan"
  // Standalone recipe pack — full ingredients + method for every ✦ dish.
  // Served publicly at /recipes/<planSlug>. Split out of the consolidated
  // letter (post-reformat) so the main letter stays under 7 pages.
  | "recipes";

/** File stem for a given letter type — consolidated keeps the bare planSlug for backwards compat.
 *  Phase letters get a -wk{start}-{end} suffix so each phase has its own file. */
function letterFileStem(
  planSlug: string,
  letterType: LetterType,
  phase?: { startWeek: number; endWeek: number } | null,
): string {
  if (letterType === "consolidated") return planSlug;
  if (letterType === "meal_plan_phase" && phase) {
    return `${planSlug}-meal_plan-wk${phase.startWeek}-${phase.endWeek}`;
  }
  return `${planSlug}-${letterType}`;
}

export async function saveMealPlan(
  planSlug: string,
  clientId: string,
  markdown: string,
  html: string | null,
  letterType: LetterType = "consolidated",
  validationReport?: LetterValidationChange[] | null,
  /** For letterType === "meal_plan_phase" — writes to the per-phase
   *  filename `${planSlug}-meal_plan-wk<start>-<end>.md` instead of
   *  `${planSlug}-meal_plan_phase.md`. Edits made in the letter editor
   *  would previously land at the wrong path. */
  phase?: { startWeek: number; endWeek: number } | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = await getMealPlanDir(clientId);
    const stem = letterFileStem(planSlug, letterType, phase);
    await fs.writeFile(path.join(dir, `${stem}.md`), markdown, "utf-8");
    if (html) {
      await fs.writeFile(path.join(dir, `${stem}.html`), html, "utf-8");
    }
    // Persist the Haiku QA report alongside the letter so the rewrites
    // survive a page reload. Empty/null report → delete any stale file.
    const reportPath = path.join(dir, `${stem}.validation.json`);
    if (validationReport && validationReport.length > 0) {
      await fs.writeFile(reportPath, JSON.stringify(validationReport, null, 2), "utf-8");
    } else {
      try { await fs.unlink(reportPath); } catch { /* not present is fine */ }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function loadMealPlan(
  planSlug: string,
  clientId: string,
  letterType: LetterType = "consolidated",
  /** For letterType === "meal_plan_phase" — selects which phase letter
   *  to load. Files on disk follow `<planSlug>-meal_plan-wk<start>-<end>.md`.
   *  Without this argument the stem would resolve to `<planSlug>-meal_plan_phase.md`
   *  which doesn't exist — so the editor would always fall through to
   *  "Letter not generated yet" even for freshly-generated phase letters. */
  phase?: { startWeek: number; endWeek: number } | null,
): Promise<MealPlanData> {
  try {
    const root = getPlansRoot();
    const stem = letterFileStem(planSlug, letterType, phase);
    const mdPath = path.join(root, "clients", clientId, "meal-plans", `${stem}.md`);
    const htmlPath = path.join(root, "clients", clientId, "meal-plans", `${stem}.html`);
    const reportPath = path.join(root, "clients", clientId, "meal-plans", `${stem}.validation.json`);

    const markdown = await fs.readFile(mdPath, "utf-8");
    const stat = await fs.stat(mdPath);
    let html: string | undefined;
    try { html = await fs.readFile(htmlPath, "utf-8"); } catch { /* html optional */ }

    let validationReport: LetterValidationChange[] | undefined;
    try {
      const raw = await fs.readFile(reportPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) validationReport = parsed as LetterValidationChange[];
    } catch { /* report optional — older letters won't have one */ }

    return { ok: true, markdown, html, savedAt: stat.mtime.toISOString(), validationReport };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Phase / continuation meal-plan letters — generate mid-cycle meal plan for
// weeks N–M of an active published plan WITHOUT creating a successor.
// Supplements + protocol stay locked; the AI just produces a fresh 7-day
// meal-plan grid for the requested phase.
// ---------------------------------------------------------------------------

export interface PhaseMealPlanData {
  ok: boolean;
  markdown?: string;
  html?: string;
  savedAt?: string;
  startWeek: number;
  endWeek: number;
  error?: string;
}

export interface SavedPhase {
  startWeek: number;
  endWeek: number;
  savedAt: string; // ISO mtime
  /** True when a session (check-in, WhatsApp, coach note) was logged for
   *  this client AFTER the phase letter was generated. Surfaces the UX
   *  cue that the letter doesn't reflect the latest clinical state and
   *  the coach should regenerate before sending. */
  stale?: boolean;
  /** ISO date of the newest session that triggered staleness, if any. */
  latestSessionAt?: string;
}

/** Path stem helper exposed so the UI can build deep-links to a phase
 *  letter when needed. Internal to this module otherwise. */
function phaseStem(planSlug: string, startWeek: number, endWeek: number): string {
  return `${planSlug}-meal_plan-wk${startWeek}-${endWeek}`;
}

/**
 * Generate a phase meal-plan letter for the active plan. Same caching
 * pattern as generateClientLetter — cache hit returns existing file
 * unless forceRegenerate=true. Python letter_type="meal_plan_phase"
 * builds a focused prompt that references the active routine but only
 * outputs meal tables for the requested week range.
 */
export async function generatePhaseMealPlanAction(
  planSlug: string,
  clientId: string,
  startWeek: number,
  endWeek: number,
  coachNotes?: string,
  forceRegenerate = false,
): Promise<PhaseMealPlanData> {
  if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek)) {
    return {
      ok: false,
      startWeek,
      endWeek,
      error: "startWeek and endWeek must be numbers",
    };
  }
  if (startWeek < 1 || endWeek < startWeek || endWeek - startWeek > 4) {
    return {
      ok: false,
      startWeek,
      endWeek,
      error:
        "Phase must span 1–5 weeks. For a longer continuation, generate two phases.",
    };
  }

  const dir = await getMealPlanDir(clientId);
  const stem = phaseStem(planSlug, startWeek, endWeek);
  const mdPath = path.join(dir, `${stem}.md`);
  const htmlPath = path.join(dir, `${stem}.html`);

  // 1. Cache hit
  if (!forceRegenerate) {
    try {
      const cached = await fs.readFile(mdPath, "utf-8");
      let cachedHtml: string | undefined;
      try {
        cachedHtml = await fs.readFile(htmlPath, "utf-8");
      } catch {
        /* html optional */
      }
      const stat = await fs.stat(mdPath);
      return {
        ok: true,
        markdown: cached,
        html: cachedHtml,
        savedAt: stat.mtime.toISOString(),
        startWeek,
        endWeek,
      };
    } catch {
      /* cache miss — generate fresh */
    }
  }

  // 2. Fresh AI generation
  const result = await runShim<ClientLetterResult>(
    "render-client-letter.py",
    {
      plan_slug: planSlug,
      client_id: clientId,
      letter_type: "meal_plan_phase",
      phase_start: startWeek,
      phase_end: endWeek,
      coach_notes: coachNotes ?? "",
      weight_loss: null, // pulled from plan metadata if needed
    },
    600_000, // 10 min
  );

  if (!result.ok || !result.markdown) {
    return {
      ok: false,
      startWeek,
      endWeek,
      error: result.error ?? "Phase letter generation failed",
    };
  }

  // 3. Persist md + html
  await fs.writeFile(mdPath, result.markdown, "utf-8");
  if (result.html) {
    await fs.writeFile(htmlPath, result.html, "utf-8");
  }
  // 3b. Recipe pack sidecar — phase letters strip the recipe appendix
  // out of the main markdown and save it as `<stem>-recipes.md/.html`
  // so it can ride along as an email attachment. Keeps the main letter
  // under 7 pages.
  if (result.recipes_markdown) {
    const recipesMdPath = path.join(dir, `${stem}-recipes.md`);
    await fs.writeFile(recipesMdPath, result.recipes_markdown, "utf-8");
    if (result.recipes_html) {
      const recipesHtmlPath = path.join(dir, `${stem}-recipes.html`);
      await fs.writeFile(recipesHtmlPath, result.recipes_html, "utf-8");
    }
    // Also write the recipe pack under the CANONICAL `<planSlug>-recipes`
    // name — that's exactly what the public /recipes/<planSlug> page
    // reads. Phase letters use a phase-stamped stem
    // (`<planSlug>-meal_plan-wk3-4`), so without this copy the live page
    // can't find the file and shows an empty "not published" state.
    // The newest phase's recipes become the current pack at
    // /recipes/<planSlug>. For consolidated, stem === planSlug already,
    // so this branch is skipped (the file above is already canonical).
    if (stem !== planSlug) {
      await fs.writeFile(
        path.join(dir, `${planSlug}-recipes.md`),
        result.recipes_markdown,
        "utf-8",
      );
      if (result.recipes_html) {
        await fs.writeFile(
          path.join(dir, `${planSlug}-recipes.html`),
          result.recipes_html,
          "utf-8",
        );
      }
    }
  }
  const stat = await fs.stat(mdPath);

  revalidatePath(`/clients-v2/${clientId}/communicate`);
  return {
    ok: true,
    markdown: result.markdown,
    html: result.html ?? undefined,
    savedAt: stat.mtime.toISOString(),
    startWeek,
    endWeek,
  };
}

/**
 * List every saved phase meal-plan letter on disk for this plan.
 * Reads filenames matching `<planSlug>-meal_plan-wk{N}-{M}.md` and
 * pulls the mtime as savedAt. Sorted by start week ascending so the
 * UI can render in protocol order.
 */
export async function listSavedPhasesAction(
  planSlug: string,
  clientId: string,
): Promise<SavedPhase[]> {
  const dir = path.join(getPlansRoot(), "clients", clientId, "meal-plans");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  // Filename pattern: <planSlug>-meal_plan-wk<start>-<end>.md
  const re = new RegExp(
    `^${planSlug.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}-meal_plan-wk(\\d+)-(\\d+)\\.md$`,
  );
  const out: SavedPhase[] = [];
  for (const name of entries) {
    const m = name.match(re);
    if (!m) continue;
    const startWeek = parseInt(m[1], 10);
    const endWeek = parseInt(m[2], 10);
    if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek)) continue;
    try {
      const stat = await fs.stat(path.join(dir, name));
      out.push({
        startWeek,
        endWeek,
        savedAt: stat.mtime.toISOString(),
      });
    } catch {
      /* skip if stat fails */
    }
  }
  out.sort((a, b) => a.startWeek - b.startWeek);

  // Mark phases stale if any session was logged AFTER the letter was saved.
  // Even a quick_note from a WhatsApp message should trigger this — the
  // _recent_client_voice_block injection at letter generation time means a
  // regeneration will pick it up. Surface the cue so coach doesn't accidentally
  // send a stale letter.
  if (out.length > 0) {
    const sessionsDir = path.join(getPlansRoot(), "clients", clientId, "sessions");
    let sessionFiles: string[] = [];
    try {
      sessionFiles = await fs.readdir(sessionsDir);
    } catch {
      return out;
    }
    let latestSessionMs = 0;
    let latestSessionIso = "";
    for (const sf of sessionFiles) {
      if (!sf.endsWith(".yaml")) continue;
      try {
        const stat = await fs.stat(path.join(sessionsDir, sf));
        if (stat.mtime.getTime() > latestSessionMs) {
          latestSessionMs = stat.mtime.getTime();
          latestSessionIso = stat.mtime.toISOString();
        }
      } catch {
        /* skip */
      }
    }
    if (latestSessionMs > 0) {
      for (const phase of out) {
        const phaseMs = new Date(phase.savedAt).getTime();
        // Same 2-second slack as getLetterStalenessAction to avoid false
        // positives from races between letter save + session save.
        if (latestSessionMs > phaseMs + 2000) {
          phase.stale = true;
          phase.latestSessionAt = latestSessionIso;
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Letter staleness — has the plan been edited since the letter was saved?
// ---------------------------------------------------------------------------

export interface LetterStalenessEntry {
  type: LetterType;
  savedAt: string; // ISO
  stale: boolean;
}

export interface LetterStalenessResult {
  ok: true;
  anyStale: boolean;
  staleCount: number;
  entries: LetterStalenessEntry[];
  planUpdatedAt: string | null;
}

const ALL_LETTER_TYPES: LetterType[] = [
  "consolidated",
  "meal_plan",
  "supplement_plan",
  "lifestyle_guide",
  "exercise_plan",
  "recipes",
];

/**
 * For a given plan, walk all 5 letter file stems and check whether each saved
 * letter's mtime is older than the plan's updated_at. Returns the list of
 * existing letters with a stale flag per type.
 *
 * "Stale" = the plan YAML was edited after the letter was generated, so the
 * letter content no longer reflects the current plan. The coach should
 * regenerate before sending.
 */
export async function getLetterStalenessAction(
  planSlug: string,
  clientId: string,
): Promise<LetterStalenessResult> {
  const plan = await loadPlanBySlug(planSlug);
  const planUpdatedRaw =
    (plan?.updated_at as string | undefined) ??
    (plan?.created_at as string | undefined) ??
    null;
  const planUpdatedAt = planUpdatedRaw ? new Date(planUpdatedRaw).toISOString() : null;
  const planUpdatedMs = planUpdatedAt ? new Date(planUpdatedAt).getTime() : 0;

  // NB: travel / maintenance overrides on client.weight_loss do NOT flip
  // staleness here. Coach's product call 2026-05-19: existing letters
  // were already sent to the client — silently mass-regenerating them
  // would resend the same period with surprise edits. Instead, the
  // AddOverride flow asks the coach whether to mint a dedicated
  // vacation/travel letter (uses plan + override + recent notes) on
  // top of the existing letters. Saves disk + API spend + client trust.
  const entries: LetterStalenessEntry[] = [];
  for (const t of ALL_LETTER_TYPES) {
    const data = await loadMealPlan(planSlug, clientId, t);
    if (!data.ok || !data.savedAt) continue;
    const savedMs = new Date(data.savedAt).getTime();
    entries.push({
      type: t,
      savedAt: data.savedAt,
      // Allow 2-second slack — saveMealPlan + plan write may race on the same
      // user action, and filesystem mtime resolution can produce a false
      // positive of < 1s. Real edits are typically minutes apart.
      stale: planUpdatedMs > 0 && savedMs + 2000 < planUpdatedMs,
    });
  }

  const staleCount = entries.filter((e) => e.stale).length;
  return {
    ok: true,
    anyStale: staleCount > 0,
    staleCount,
    entries,
    planUpdatedAt,
  };
}

/**
 * Pull the content of one section out of a consolidated markdown letter.
 * Section markers look like:
 *   <!-- SECTION_BEGIN: meal_plan -->
 *   ...content...
 *   <!-- SECTION_END: meal_plan -->
 * Returns the inner content trimmed, or null if the markers aren't present.
 */
function extractSectionFromConsolidated(md: string, section: string): string | null {
  // [\s\S] = "any char including newline" (no /s flag in this TS target)
  const re = new RegExp(
    `<!--\\s*SECTION_BEGIN:\\s*${section}\\s*-->([\\s\\S]*?)<!--\\s*SECTION_END:\\s*${section}\\s*-->`,
    "i",
  );
  const m = md.match(re);
  if (!m) return null;
  const inner = m[1].trim();
  return inner.length > 20 ? inner : null;
}

const PARTIAL_TYPES: Exclude<LetterType, "consolidated">[] = [
  "meal_plan",
  "supplement_plan",
  "lifestyle_guide",
];

/**
 * Generate (or return cached) a letter for one of the four types.
 *
 * Cross-reference rules:
 *   - If the requested file already exists on disk → return it (cache hit, no AI call).
 *   - Requested partial AND consolidated exists with section markers → extract
 *     the relevant section, save as the partial, return without AI call.
 *   - Requested consolidated AND any partials exist → load them and pass into
 *     the AI prompt as "use verbatim" instructions for those sections.
 *   - Otherwise → fresh AI generation.
 *
 * After a fresh consolidated generation, the rendered markdown is also scanned
 * for section markers and any extractable section is saved as a sidecar
 * partial file — keeping the four documents in sync automatically.
 */
export async function generateClientLetter(
  planSlug: string,
  clientId: string,
  weightLoss?: WeightLossParams,
  letterType: LetterType = "consolidated",
  coachNotes?: string,
  forceRegenerate = false,
): Promise<ClientLetterResult & { fromCache?: boolean; extractedFromConsolidated?: boolean }> {
  const dir = await getMealPlanDir(clientId);
  const stem = letterFileStem(planSlug, letterType);
  const targetMdPath = path.join(dir, `${stem}.md`);

  // 1. Cache hit — file already on disk. (Skipped when forceRegenerate=true.)
  if (!forceRegenerate) {
    try {
      const cached = await fs.readFile(targetMdPath, "utf-8");
      let cachedHtml: string | null = null;
      try { cachedHtml = await fs.readFile(path.join(dir, `${stem}.html`), "utf-8"); } catch { /* missing html is ok */ }
      return { ok: true, markdown: cached, html: cachedHtml ?? undefined, fromCache: true };
    } catch { /* not in cache, continue */ }
  }

  // 2. Cross-reference: requested partial, consolidated already exists with markers.
  // Skipped when forceRegenerate=true so the AI rebuilds the partial from scratch.
  if (!forceRegenerate && letterType !== "consolidated") {
    const consolidatedPath = path.join(dir, `${planSlug}.md`);
    try {
      const consolidatedMd = await fs.readFile(consolidatedPath, "utf-8");
      const extracted = extractSectionFromConsolidated(consolidatedMd, letterType);
      if (extracted) {
        await saveMealPlan(planSlug, clientId, extracted, null, letterType);
        return {
          ok: true,
          markdown: extracted,
          extractedFromConsolidated: true,
        };
      }
    } catch { /* consolidated doesn't exist or unreadable — fall through */ }
  }

  // 3. Cross-reference: generating consolidated, partials exist. Load them.
  // Always done (even when forceRegenerate=true) — consolidated still
  // benefits from finalised partial content.
  let existingPartials: Record<string, string> = {};
  let hasExercisePlan = false;
  if (letterType === "consolidated") {
    for (const partial of PARTIAL_TYPES) {
      const partialPath = path.join(dir, `${planSlug}-${partial}.md`);
      try {
        const md = await fs.readFile(partialPath, "utf-8");
        if (md.trim().length > 0) existingPartials[partial] = md;
      } catch { /* missing partial is fine */ }
    }
    // exercise_plan is NOT a partial (different content from consolidated's
    // simple inline schedule) — but we tell the AI whether one exists so it
    // can add the "See your detailed exercise plan" cross-reference.
    try {
      const exPath = path.join(dir, `${planSlug}-exercise_plan.md`);
      const exMd = await fs.readFile(exPath, "utf-8");
      hasExercisePlan = exMd.trim().length > 0;
    } catch { /* no exercise plan */ }
  }

  // 4. Fresh AI generation.
  const result = await runShim<ClientLetterResult>(
    "render-client-letter.py",
    {
      plan_slug: planSlug,
      client_id: clientId,
      weight_loss: weightLoss ?? null,
      letter_type: letterType,
      coach_notes: coachNotes ?? "",
      existing_partials: existingPartials,
      has_exercise_plan: hasExercisePlan,
    },
    600_000, // 10-min ceiling — Sonnet streaming on a 12-week plan can run 3–5 min
  );

  if (!result.ok || !result.markdown) return result;

  // 5. Persist the requested file (with validation report sidecar).
  await saveMealPlan(
    planSlug,
    clientId,
    result.markdown,
    result.html ?? null,
    letterType,
    result.validation_report ?? null,
  );

  // 6. After a successful consolidated generation, extract each section and
  // save as a sidecar partial — keeps the four docs in sync.
  if (letterType === "consolidated") {
    for (const partial of PARTIAL_TYPES) {
      const extracted = extractSectionFromConsolidated(result.markdown, partial);
      if (extracted) {
        try { await saveMealPlan(planSlug, clientId, extracted, null, partial); } catch { /* best-effort */ }
      }
    }
    // B10 audit (2026-05-19): mark the recipes letter stale on
    // consolidated regen so coach sees a "regenerate recipes" prompt
    // next time she opens /recipes/<planSlug>. Touch a sentinel file
    // alongside the recipes letter to record the consolidated mtime.
    try {
      const recipesPath = path.join(dir, `${planSlug}-recipes.md`);
      const sentinelPath = path.join(dir, `${planSlug}-recipes.stale-marker`);
      // If recipes letter exists, mark it stale by writing a marker
      // file whose presence the recipes-page reader can detect.
      await fs.stat(recipesPath).then(
        async () => {
          await fs.writeFile(
            sentinelPath,
            JSON.stringify({
              stale_since: new Date().toISOString(),
              reason: "consolidated letter regenerated",
            }, null, 2),
          );
        },
        () => undefined,
      );
    } catch {
      /* best-effort */
    }
  }

  return result;
}


/**
 * Re-render a letter's HTML from the already-saved markdown — NO API, $0.
 *
 * Reuses the existing/edited `.md` and re-runs ONLY the deterministic
 * post-processing (brand HTML wrap, portion plate, supplement schedule with
 * current plan timing, print buttons). Use this after a manual markdown edit
 * or after a rendering rule / plan-data change, instead of paying Sonnet to
 * regenerate the prose. Skips Sonnet AND the Haiku validation pass.
 *
 * Returns ok:false if no saved markdown exists for this letter type yet.
 */
export async function reRenderClientLetter(
  planSlug: string,
  clientId: string,
  letterType: LetterType = "consolidated",
): Promise<ClientLetterResult> {
  const dir = await getMealPlanDir(clientId);
  const stem = letterFileStem(planSlug, letterType);
  let markdown: string;
  try {
    markdown = await fs.readFile(path.join(dir, `${stem}.md`), "utf-8");
  } catch {
    return { ok: false, markdown: "", error: "No saved letter to re-render — generate it first." };
  }
  if (!markdown.trim()) {
    return { ok: false, markdown: "", error: "Saved letter is empty — nothing to re-render." };
  }

  const result = await runShim<ClientLetterResult>(
    "render-client-letter.py",
    {
      plan_slug: planSlug,
      client_id: clientId,
      letter_type: letterType,
      reuse_markdown: markdown,
    },
    120_000, // generous; no API call, just post-processing
  );
  if (!result.ok || !result.markdown) return result;

  await saveMealPlan(
    planSlug,
    clientId,
    result.markdown,
    result.html ?? null,
    letterType,
    result.validation_report ?? null,
  );
  return result;
}


// ---------------------------------------------------------------------------
// v0.73 — Letter inline section extraction.
//
// The plan tab's GeneratedLettersPanel now embeds each week's meal grid +
// the supplement schedule directly in collapsible iframes (no detour to a
// new tab). This action reads the saved branded HTML once and reports the
// section IDs present so the client component can render one iframe per
// section, each scoped via `body[data-print-week="N"]` or
// `body[data-print-supplement]` to leverage the existing brand-CSS
// isolation rules in scripts/brand_html.py.
//
// Returns the full HTML untouched. The client component injects the body
// attribute per iframe at render time — see
// app/letter/[token]/auto-sized-letter-iframe.tsx.
// ---------------------------------------------------------------------------

/**
 * One slot in the inline viewer — either a week (with its source HTML
 * for the iframe srcdoc) or the supplement schedule. `sourceLabel` is a
 * coach-readable tag like "consolidated" / "weeks 3–4 phase letter" so
 * the UI can show provenance per section.
 */
export interface LetterWeekSource {
  weekNumber: number;             // 1, 2, 3, …
  html: string;                   // the full HTML doc this week lives in
  sourceLabel: string;            // "consolidated" | "phase weeks 3–4" | …
  savedAt: string;                // ISO mtime of the source file
}

export interface LetterSupplementsSource {
  html: string;                   // typically from the consolidated letter
  sourceLabel: string;
  savedAt: string;
}

export interface LetterSectionsResult {
  ok: boolean;
  /** All week-N sections aggregated from consolidated + every phase letter,
   *  deduped so each weekNumber appears at most once (phase letter wins on
   *  conflict — it's the more recent / specific edit). Sorted ascending. */
  weekSources?: LetterWeekSource[];
  supplements?: LetterSupplementsSource | null;
  /** When `ok=false` AND the consolidated letter exists as markdown-only,
   *  caller can still link out. */
  consolidatedSavedAt?: string;
  error?: string;
}

/**
 * Helper — extract week IDs (1, 2, …) present in a letter HTML string by
 * scanning for `id="print-week-N"` anchors emitted by brand_html.py.
 */
function extractWeekIds(html: string): number[] {
  return Array.from(
    new Set(
      Array.from(html.matchAll(/id="print-week-(\d+)"/g)).map((m) => parseInt(m[1], 10)),
    ),
  )
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export async function getLetterSectionsAction(
  planSlug: string,
  clientId: string,
  letterType: LetterType = "consolidated",
): Promise<LetterSectionsResult> {
  // 1. Load the primary letter (consolidated, by default). This is the
  //    canonical source of the supplement schedule + weeks 1-2.
  const primary = await loadMealPlan(planSlug, clientId, letterType);
  if (!primary.ok || !primary.html) {
    return {
      ok: false,
      error: primary.ok ? "No HTML letter saved (markdown-only)" : "Letter not found",
      consolidatedSavedAt: primary.savedAt,
    };
  }

  // 2. Seed weekSources from the consolidated letter.
  const weekMap = new Map<number, LetterWeekSource>();
  for (const n of extractWeekIds(primary.html)) {
    weekMap.set(n, {
      weekNumber: n,
      html: primary.html,
      sourceLabel: "consolidated letter",
      savedAt: primary.savedAt ?? "",
    });
  }

  // 3. Discover phase letters (weeks 3-4, 5-6, …) and merge their week
  //    HTMLs in. Phase letters live on disk as
  //    `{planSlug}-meal_plan-wk{N}-{M}.html` — read each one directly so
  //    we don't have to special-case loadMealPlan's phase signature.
  try {
    const phases = await listSavedPhasesAction(planSlug, clientId);
    const dir = path.join(getPlansRoot(), "clients", clientId, "meal-plans");
    for (const phase of phases) {
      const stem = `${planSlug}-meal_plan-wk${phase.startWeek}-${phase.endWeek}`;
      const htmlPath = path.join(dir, `${stem}.html`);
      let phaseHtml: string;
      try {
        phaseHtml = await fs.readFile(htmlPath, "utf-8");
      } catch {
        // No HTML for this phase (markdown-only generation) — skip.
        continue;
      }
      const label = `phase ${phase.startWeek}–${phase.endWeek}`;
      for (const n of extractWeekIds(phaseHtml)) {
        // Phase letter wins over consolidated for the same week (phase
        // letters are the most recent / targeted regeneration).
        weekMap.set(n, {
          weekNumber: n,
          html: phaseHtml,
          sourceLabel: label,
          savedAt: phase.savedAt,
        });
      }
    }
  } catch (e) {
    // Phase-discovery failure is non-fatal — coach still gets weeks 1-2.
    console.error("getLetterSectionsAction: phase discovery failed", e);
  }

  // 4. Supplements section — comes from the consolidated letter only.
  //    Phase letters intentionally don't restate the schedule (it
  //    shouldn't drift between phases).
  const supplements: LetterSupplementsSource | null = /id="supplement-schedule"/.test(primary.html)
    ? {
        html: primary.html,
        sourceLabel: "consolidated letter",
        savedAt: primary.savedAt ?? "",
      }
    : null;

  const weekSources = Array.from(weekMap.values()).sort(
    (a, b) => a.weekNumber - b.weekNumber,
  );

  return {
    ok: true,
    weekSources,
    supplements,
    consolidatedSavedAt: primary.savedAt,
  };
}
