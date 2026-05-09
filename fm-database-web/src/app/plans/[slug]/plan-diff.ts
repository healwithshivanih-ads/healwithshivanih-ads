/**
 * plan-diff.ts — compute a human-readable list of changes between an
 * existing Plan and a patch returned by the AI Plan Assistant.
 *
 * The chat shim returns a patch where each list field is a *complete
 * replacement array* (per the system prompt). We compare each replaced
 * list against the old plan to surface what was added / removed / changed.
 *
 * Used by plan-chat-actions.ts → returned alongside `reply` so the UI
 * can render a structured "what changed" list under the assistant's
 * reply, instead of just a generic "✓ Plan updated" badge.
 */

import type { Plan } from "@/lib/fmdb/types";

export interface PlanChange {
  kind: "added" | "removed" | "changed";
  /** Top-level plan area, used for grouping in the UI. */
  area:
    | "supplement"
    | "lifestyle"
    | "education"
    | "lab"
    | "referral"
    | "topic"
    | "symptom"
    | "driver"
    | "tracking"
    | "nutrition"
    | "notes"
    | "lifecycle"
    | "other";
  /** One-line human-readable summary. */
  summary: string;
}

// ── small helpers ──────────────────────────────────────────────────────────

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function strLower(v: unknown): string {
  return String(v ?? "").toLowerCase().trim();
}

/** Pretty-print a supplement row's dose + timing for the diff summary. */
function suppDoseTiming(s: Record<string, unknown>): string {
  const dose = (s.dose ?? "") as string;
  const timing = (s.timing ?? "") as string;
  const form = (s.form ?? "") as string;
  const parts: string[] = [];
  if (dose) parts.push(dose);
  if (form) parts.push(form);
  if (timing) parts.push(timing);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function diffStringList(
  area: PlanChange["area"],
  noun: string,
  oldList: string[],
  newList: string[]
): PlanChange[] {
  const changes: PlanChange[] = [];
  const oldSet = new Set(oldList.map(strLower));
  const newSet = new Set(newList.map(strLower));
  for (const v of newList) {
    if (!oldSet.has(strLower(v))) {
      changes.push({ kind: "added", area, summary: `Added ${noun}: ${v}` });
    }
  }
  for (const v of oldList) {
    if (!newSet.has(strLower(v))) {
      changes.push({ kind: "removed", area, summary: `Removed ${noun}: ${v}` });
    }
  }
  return changes;
}

/**
 * Diff two arrays of objects keyed by some identifier field. Detects
 * adds, removes, and intra-item changes (whatever the `summarise` callback
 * produces). The matcher returns the canonical key for an item.
 */
function diffObjectListByKey<T extends Record<string, unknown>>(
  area: PlanChange["area"],
  oldList: T[],
  newList: T[],
  keyOf: (item: T) => string,
  describe: (item: T) => string,
  detectIntraChanges: (oldItem: T, newItem: T) => string[]
): PlanChange[] {
  const changes: PlanChange[] = [];
  const oldByKey = new Map<string, T>();
  for (const o of oldList) {
    const k = keyOf(o);
    if (k) oldByKey.set(k, o);
  }
  const seenKeys = new Set<string>();
  for (const n of newList) {
    const k = keyOf(n);
    if (!k) continue;
    seenKeys.add(k);
    const o = oldByKey.get(k);
    if (!o) {
      changes.push({ kind: "added", area, summary: `Added ${describe(n)}` });
    } else {
      const intra = detectIntraChanges(o, n);
      for (const change of intra) {
        changes.push({ kind: "changed", area, summary: change });
      }
    }
  }
  for (const o of oldList) {
    const k = keyOf(o);
    if (k && !seenKeys.has(k)) {
      changes.push({ kind: "removed", area, summary: `Removed ${describe(o)}` });
    }
  }
  return changes;
}

// ── per-field diffs ────────────────────────────────────────────────────────

function diffSupplements(oldList: Record<string, unknown>[], newList: Record<string, unknown>[]): PlanChange[] {
  return diffObjectListByKey(
    "supplement",
    oldList,
    newList,
    (s) => strLower(s.supplement_slug ?? s.name),
    (s) => `supplement ${s.supplement_slug ?? s.name ?? "(unnamed)"}${suppDoseTiming(s)}`,
    (oldS, newS) => {
      const intra: string[] = [];
      const slug = String(oldS.supplement_slug ?? oldS.name ?? "supplement");
      for (const f of ["dose", "timing", "form", "duration_weeks"] as const) {
        const oldV = oldS[f];
        const newV = newS[f];
        if (oldV !== newV && (oldV ?? "") !== (newV ?? "")) {
          intra.push(`${slug}: ${f.replace("_", " ")} ${oldV ?? "—"} → ${newV ?? "—"}`);
        }
      }
      const oldRat = strLower(oldS.rationale);
      const newRat = strLower(newS.rationale);
      if (oldRat !== newRat && newS.rationale) {
        intra.push(`${slug}: rationale updated`);
      }
      return intra;
    }
  );
}

function diffLifestyle(oldList: Record<string, unknown>[], newList: Record<string, unknown>[]): PlanChange[] {
  return diffObjectListByKey(
    "lifestyle",
    oldList,
    newList,
    (p) => strLower(p.name),
    (p) => `lifestyle: ${p.name ?? "(unnamed)"}${p.cadence ? ` (${p.cadence})` : ""}`,
    (oldP, newP) => {
      const intra: string[] = [];
      const name = String(oldP.name ?? "practice");
      for (const f of ["cadence", "details"] as const) {
        if ((oldP[f] ?? "") !== (newP[f] ?? "")) {
          intra.push(`${name}: ${f} ${oldP[f] ?? "—"} → ${newP[f] ?? "—"}`);
        }
      }
      return intra;
    }
  );
}

function diffEducation(oldList: Record<string, unknown>[], newList: Record<string, unknown>[]): PlanChange[] {
  return diffObjectListByKey(
    "education",
    oldList,
    newList,
    (e) => `${strLower(e.target_kind)}::${strLower(e.target_slug)}`,
    (e) => `education ${e.target_kind ?? ""} ${e.target_slug ?? ""}`.trim(),
    () => []
  );
}

function diffLabOrders(oldList: Record<string, unknown>[], newList: Record<string, unknown>[]): PlanChange[] {
  return diffObjectListByKey(
    "lab",
    oldList,
    newList,
    (l) => strLower(l.test),
    (l) => `lab order: ${l.test ?? "(unnamed)"}`,
    () => []
  );
}

function diffReferrals(oldList: Record<string, unknown>[], newList: Record<string, unknown>[]): PlanChange[] {
  return diffObjectListByKey(
    "referral",
    oldList,
    newList,
    (r) => strLower(r.to),
    (r) => `referral to ${r.to ?? "(unnamed)"}${r.urgency ? ` (${r.urgency})` : ""}`,
    () => []
  );
}

function diffDrivers(oldList: Record<string, unknown>[], newList: Record<string, unknown>[]): PlanChange[] {
  return diffObjectListByKey(
    "driver",
    oldList,
    newList,
    (d) => strLower(d.mechanism ?? d.mechanism_slug),
    (d) => `driver: ${d.mechanism ?? d.mechanism_slug ?? "(unnamed)"}`,
    () => []
  );
}

function diffNutrition(oldNut: Record<string, unknown>, newNut: Record<string, unknown>): PlanChange[] {
  const out: PlanChange[] = [];
  if ((oldNut.pattern ?? "") !== (newNut.pattern ?? "") && newNut.pattern !== undefined) {
    out.push({
      kind: "changed",
      area: "nutrition",
      summary: `Nutrition pattern: ${oldNut.pattern || "—"} → ${newNut.pattern || "—"}`,
    });
  }
  if ((oldNut.meal_timing ?? "") !== (newNut.meal_timing ?? "") && newNut.meal_timing !== undefined) {
    out.push({
      kind: "changed",
      area: "nutrition",
      summary: `Meal timing: ${oldNut.meal_timing || "—"} → ${newNut.meal_timing || "—"}`,
    });
  }
  if (Array.isArray(newNut.add)) {
    out.push(...diffStringList("nutrition", "food to add", asArr<string>(oldNut.add), newNut.add as string[]));
  }
  if (Array.isArray(newNut.reduce)) {
    out.push(
      ...diffStringList("nutrition", "food to reduce", asArr<string>(oldNut.reduce), newNut.reduce as string[]),
    );
  }
  return out;
}

function diffTracking(
  oldT: Record<string, unknown> | undefined,
  newT: Record<string, unknown>
): PlanChange[] {
  const out: PlanChange[] = [];
  const old = oldT ?? {};
  const oldHabits = asArr<Record<string, unknown>>(old.habits);
  const newHabits = asArr<Record<string, unknown>>(newT.habits);
  if (newT.habits !== undefined) {
    out.push(
      ...diffObjectListByKey(
        "tracking",
        oldHabits,
        newHabits,
        (h) => strLower(h.name),
        (h) => `tracking habit: ${h.name ?? "(unnamed)"}`,
        () => [],
      ),
    );
  }
  if (Array.isArray(newT.symptoms_to_monitor)) {
    out.push(
      ...diffStringList(
        "tracking",
        "symptom to monitor",
        asArr<string>(old.symptoms_to_monitor),
        newT.symptoms_to_monitor as string[],
      ),
    );
  }
  if (Array.isArray(newT.recheck_questions)) {
    out.push(
      ...diffStringList(
        "tracking",
        "recheck question",
        asArr<string>(old.recheck_questions),
        newT.recheck_questions as string[],
      ),
    );
  }
  return out;
}

// ── public entry point ────────────────────────────────────────────────────

/**
 * Compare an existing plan to a patch (partial-Plan dict the AI returned)
 * and produce a structured change list suitable for rendering in the chat
 * UI. Returns an empty array when the patch is empty or makes no
 * detectable change.
 */
export function computePlanChanges(plan: Plan, patch: Record<string, unknown>): PlanChange[] {
  const out: PlanChange[] = [];
  if (!patch || Object.keys(patch).length === 0) return out;

  const p = plan as unknown as Record<string, unknown>;

  // String list fields
  if (Array.isArray(patch.primary_topics)) {
    out.push(...diffStringList("topic", "primary topic", asArr<string>(p.primary_topics), patch.primary_topics as string[]));
  }
  if (Array.isArray(patch.contributing_topics)) {
    out.push(...diffStringList("topic", "contributing topic", asArr<string>(p.contributing_topics), patch.contributing_topics as string[]));
  }
  if (Array.isArray(patch.symptoms_addressed)) {
    out.push(...diffStringList("symptom", "symptom addressed", asArr<string>(p.symptoms_addressed), patch.symptoms_addressed as string[]));
  }
  if (Array.isArray(patch.attached_resources)) {
    out.push(...diffStringList("other", "attached resource", asArr<string>(p.attached_resources), patch.attached_resources as string[]));
  }

  // Object-list fields
  if (Array.isArray(patch.supplement_protocol)) {
    out.push(...diffSupplements(asArr<Record<string, unknown>>(p.supplement_protocol), patch.supplement_protocol as Record<string, unknown>[]));
  }
  if (Array.isArray(patch.lifestyle_practices)) {
    out.push(...diffLifestyle(asArr<Record<string, unknown>>(p.lifestyle_practices), patch.lifestyle_practices as Record<string, unknown>[]));
  }
  if (Array.isArray(patch.hypothesized_drivers)) {
    out.push(...diffDrivers(asArr<Record<string, unknown>>(p.hypothesized_drivers), patch.hypothesized_drivers as Record<string, unknown>[]));
  }
  if (Array.isArray(patch.education_modules)) {
    out.push(...diffEducation(asArr<Record<string, unknown>>(p.education_modules), patch.education_modules as Record<string, unknown>[]));
  }
  if (Array.isArray(patch.lab_orders)) {
    out.push(...diffLabOrders(asArr<Record<string, unknown>>(p.lab_orders), patch.lab_orders as Record<string, unknown>[]));
  }
  if (Array.isArray(patch.referrals)) {
    out.push(...diffReferrals(asArr<Record<string, unknown>>(p.referrals), patch.referrals as Record<string, unknown>[]));
  }

  // Nested objects
  if (patch.nutrition && typeof patch.nutrition === "object") {
    out.push(...diffNutrition((p.nutrition as Record<string, unknown>) ?? {}, patch.nutrition as Record<string, unknown>));
  }
  if (patch.tracking && typeof patch.tracking === "object") {
    out.push(...diffTracking(p.tracking as Record<string, unknown> | undefined, patch.tracking as Record<string, unknown>));
  }

  // Free-text fields
  for (const f of ["notes_for_coach", "notes_for_client", "plan_period_weeks"] as const) {
    if (f in patch && patch[f] !== p[f]) {
      out.push({
        kind: "changed",
        area: f === "notes_for_coach" || f === "notes_for_client" ? "notes" : "lifecycle",
        summary:
          f === "plan_period_weeks"
            ? `Plan period: ${p[f] ?? "—"} → ${patch[f]} weeks`
            : `${f.replace(/_/g, " ")} updated`,
      });
    }
  }

  return out;
}
