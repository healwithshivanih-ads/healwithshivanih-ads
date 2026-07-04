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
      // Welcome email (static, no-API) — once, on FIRST publish only.
      try {
        const dir = path.join(getPlansRoot(), "published");
        const names = await fs.readdir(dir).catch(() => [] as string[]);
        const match = names.find((n) => n.startsWith(`${slug}-v`) && n.endsWith(".yaml"));
        if (match) {
          const { default: yaml } = await import("js-yaml");
          const data = (yaml.load(await fs.readFile(path.join(dir, match), "utf-8")) as Record<string, unknown>) ?? {};
          if (Number(data.version) === 1 && data.client_id) {
            const { sendWelcomeEmailAction } = await import("./welcome-email");
            await sendWelcomeEmailAction(String(data.client_id), slug);
          }
        }
      } catch (e) {
        console.warn(`[welcome-email] non-fatal failure for ${slug}: ${(e as Error).message}`);
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
    // Revenue export (Loop 1): announce the completion + a fresh capacity
    // snapshot — a graduation frees a slot. Best-effort; never blocks the UI.
    try {
      const { buildProgrammeCompletedEvent, clientJoinKeyFor, emitRevenueEvent, emitActiveClientCount } =
        await import("@/lib/fmdb/revenue-export");
      const plan = await loadPlanBySlug(slug);
      if (plan?.client_id) {
        await emitRevenueEvent(
          buildProgrammeCompletedEvent({
            planSlug: slug,
            completedAt: new Date().toISOString(),
            client: await clientJoinKeyFor(plan.client_id as string),
          }),
        );
      }
      await emitActiveClientCount();
    } catch (e) {
      console.error("[revenue-export] graduation emit failed:", (e as Error).message);
    }
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

// ── Letters retired (2026-07-04) ────────────────────────────────────────
// The entire client-letter machinery (LetterType, generate/save/load,
// phase letters, staleness, refinement — ~900 lines) was removed. The
// welcome email (src/lib/server-actions/welcome-email.ts) + the client
// app are the only client-facing deliverables now.
