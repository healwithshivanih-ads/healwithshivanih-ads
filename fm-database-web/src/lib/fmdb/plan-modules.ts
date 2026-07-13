/**
 * Plan modules / layers registry — the single source of truth for the optional
 * layers a coach can switch on per client so they're never missed when a plan
 * is built. Surfaced by <PlanModulesPanel> on the client Overview.
 *
 * Fixed in code by design (coach decision 2026-06-13): adding a new module is a
 * quick edit here + (when ready) the downstream generation wiring. Keeping the
 * list in code keeps labels/icons consistent and lets each module declare HOW
 * far it's wired.
 *
 * Two storage shapes:
 *   - "ayurveda_enabled" / "meal_plan_style" — the two ALREADY-wired layers.
 *     Their canonical state stays on its own dedicated client field (so the
 *     existing assess/letter/app wiring is untouched). The panel just renders
 *     their native control.
 *   - "plan_modules" — newer modules. Their on-state is membership in the
 *     client's `plan_modules: string[]`. The flag persists + surfaces as a
 *     coach reminder today; full assess/letter/app wiring is a per-module
 *     follow-on build (status: "scaffold").
 *
 * `status`:
 *   - "wired"    — flipping this genuinely changes assessment / plan / letters
 *                  / app today (Ayurveda, meal-plan type).
 *   - "scaffold" — the flag is saved on the client and shown as a reminder, but
 *                  it does NOT yet drive AI generation. Deliberate: we don't
 *                  feed un-grounded modules into letter prompts (no-hallucination
 *                  rule) — the coach adds the content manually until the module
 *                  has catalogue grounding.
 */

export type PlanModuleStatus = "wired" | "scaffold";
export type PlanModuleStorage =
  | "ayurveda_enabled"
  | "meal_plan_style"
  | "plan_modules";

export interface PlanModuleDef {
  /** Stable id. For "plan_modules" modules this is the value stored in the list. */
  id: string;
  label: string;
  icon: string;
  /** One-line description of what enabling it does. */
  blurb: string;
  status: PlanModuleStatus;
  storage: PlanModuleStorage;
}

export const PLAN_MODULES: PlanModuleDef[] = [
  {
    id: "ayurveda",
    label: "Ayurveda layer",
    icon: "🪔",
    blurb:
      "Constitution scoring in assessments + an Ayurvedic section in the plan & app.",
    status: "wired",
    storage: "ayurveda_enabled",
  },
  {
    id: "meal_plan_type",
    label: "Meal plan type",
    icon: "🍽",
    blurb:
      "How the meal plan is shaped in the app menu — full tables, principles only, or a hybrid.",
    status: "wired",
    storage: "meal_plan_style",
  },
  {
    id: "schussler_salts",
    label: "Schüssler's salts (cell salts)",
    icon: "🧂",
    blurb:
      "Schüssler tissue salts woven through assessment → plan → app. The AI suggests catalogue cell salts for the client's issues; coach edits on the plan's 🧂 section.",
    status: "wired",
    storage: "plan_modules",
  },
  {
    id: "peptides",
    label: "Peptides",
    icon: "🧬",
    blurb:
      "Peptide protocol layer. Flag is saved now; full plan + app wiring is a follow-on build.",
    status: "scaffold",
    storage: "plan_modules",
  },
];

/** Modules stored as membership in client.plan_modules (the toggle-able ones). */
export const PLAN_MODULE_LIST_IDS: string[] = PLAN_MODULES.filter(
  (m) => m.storage === "plan_modules",
).map((m) => m.id);

/**
 * Toggle-style modules that are currently ON for a client — used to render the
 * reminder chip-row. The meal-plan-type module is excluded (it's an always-set
 * choice, not an on/off toggle).
 */
export function enabledPlanModules(client: {
  ayurveda_enabled?: boolean;
  plan_modules?: string[];
}): PlanModuleDef[] {
  const list = new Set(client.plan_modules ?? []);
  return PLAN_MODULES.filter((m) => {
    if (m.storage === "ayurveda_enabled") return Boolean(client.ayurveda_enabled);
    if (m.storage === "plan_modules") return list.has(m.id);
    return false; // meal_plan_style is always set; not a toggle chip
  });
}
