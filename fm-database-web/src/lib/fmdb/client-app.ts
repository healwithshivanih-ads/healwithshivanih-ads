import "server-only";

/**
 * Client companion app ("The Ochre Tree" PWA) — server-side data assembly.
 *
 * Builds the app payload the /app/[token] screens render, entirely from
 * REAL coach-authored sources. Nothing clinical is invented here:
 *
 *   - published plan YAML        → supplements, practices, nutrition tiers,
 *                                  education lessons, lab orders, phases,
 *                                  assigned remedies, ayurveda block
 *   - the plan's letter (.md)    → meal week tables, recipes, per-supplement
 *                                  client-voiced "why" + buy links, remedies
 *                                  blurbs, roadmap phase notes, watch list
 *   - client.yaml                → identity, dosha constitution, goals,
 *                                  dietary preference, contact
 *   - catalogue home_remedies/   → the 198-remedy library (route/dosha/virya)
 *   - catalogue cooking_adjustments/ → cooking guidance cards
 *   - sessions/                  → weekly check-in / poll history → journey +
 *                                  symptom-score points
 *
 * Auth: the caller resolves a plan letter_token first (lookupLetterToken) —
 * same public-token posture as /letter/<token>.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot, getCataloguePath } from "@/lib/fmdb/paths";
import { collectMeasurementSnapshots, latestMeasurements } from "@/lib/fmdb/measurements";
import { resolveTravelGuide, coerceGuide, type TravelGuide } from "@/lib/fmdb/travel-foods";
import { stripBrand } from "@/lib/fmdb/supplement-display";
import { isInternationalClient } from "@/lib/server-actions/supplement-links-match";
import { estimateDayKcal, estimateDishKcal, calorieAdherence, buildRecipeKcalLookup } from "@/lib/fmdb/calorie-estimate";
import { buildLabVault, type LabVault, type LabSnapshot } from "@/lib/fmdb/lab-vault";
import {
  resolveAppTier,
  resolveDiscoveryStage,
  type AppTier,
  type DiscoveryCredit,
  type DiscoverySummary,
  type DiscoveryStage,
} from "@/lib/fmdb/discovery-tier";
import { resolveAppMode, GRACE_DAYS, REVIEW_LEAD_DAYS, type AppMode, type AppModePlan } from "@/lib/fmdb/app-mode";
import { MAINTENANCE_PRICING, latestPaidMaintenanceThrough } from "@/lib/fmdb/maintenance-orders";
import { hasLiveSubscription } from "@/lib/fmdb/maintenance-subscription";
import {
  effectiveRecheckDate,
  effectiveMealPlanStart,
  travelExtensionDays,
  type TravelOverrideLike,
  type RecheckOpts,
} from "@/lib/fmdb/plan-timing";
import { formatLongDate } from "@/lib/fmdb/format-date";
import { loadClientOrders, type LabOrder } from "@/lib/fmdb/lab-orders";
import { loadLabProvider } from "@/lib/fmdb/lab-providers";
import type { CatalogueLabRange, LabReferenceRanges } from "@/lib/server-actions/clients";

/** Project stored lab orders for the client app: (1) redact `our_cost_inr` (the
 *  coach's wholesale cost must never reach the client payload), (2) attach
 *  `list_inr` — the à-la-carte catalogue total — so the app can show the deal
 *  (strike-through "regular price" + savings). `list_inr` is display-only and
 *  never written to disk. One provider load per call; fails soft to no-deal. */
async function projectClientLabOrders(clientId: string): Promise<LabOrder[]> {
  const orders = (await loadClientOrders(clientId)).map((o) => ({ ...o, our_cost_inr: 0 }));
  if (orders.length === 0) return orders;
  const provider = await loadLabProvider().catch(() => null);
  if (!provider) return orders;
  const profileCat = new Map(provider.profiles.map((p) => [p.id, p.catalogueInr] as const));
  const addonCat = new Map(provider.addons.map((a) => [a.slug, a.catalogueInr] as const));
  return orders.map((o) => {
    const base = o.profile_id != null ? profileCat.get(o.profile_id) ?? null : null;
    if (base == null) return { ...o, list_inr: null };
    const addons = o.addon_slugs.reduce((sum, s) => sum + (addonCat.get(s) ?? 0), 0);
    return { ...o, list_inr: base + addons };
  });
}

// ── contract types (mirror the design prototype's data shape) ───────────────

export interface AppMeal {
  slot: string;
  timeHint: string;
  glyph: string;
  pills: string[];
  /** pills broken into clean title + lifted portion per component (display). */
  components: DishComponent[];
  note?: string;
  /** estimated calories for this meal (recipe-accurate where matched) */
  kcal?: number;
  /** dish is a classic Ayurvedic preparation → "Ayurveda recommends" badge */
  ayurveda?: boolean;
}

/** Classic Ayurvedic preparations — drives the "Ayurveda recommends" badge
 *  on menu items and recipe-pack entries. Exported for the /recipes page. */
export const AYURVEDIC_DISH_RE =
  /khichdi|khichri|kanji\b|kashayam|churan|golden milk|haldi doodh|turmeric milk|ccf tea|cumin[- ]coriander[- ]fennel|buttermilk|chaas|lassi|methi water|jeera water|triphala|amla|haldi milk/i;

/** A portion-shaped "(…)" — a count or a household/metric unit. Lets the app
 *  lift the portion off a dish component and show it as a clean muted token
 *  instead of raw inline parens. Kept deliberately in sync with dish-picker's
 *  PORTION_RE (coach authoring) — both sides must agree on what counts as a
 *  portion. Non-portion parens like "(new)" or "(fermented)" carry no digit or
 *  unit, so they're left untouched in the title. Global flag: a component can
 *  carry more than one (we keep the first, drop accidental doubles). */
const DISH_PORTION_RE =
  /\(\s*([^)]*?(?:\d|½|¼|¾|⅓|⅔|bowls?|cups?|glass(?:es)?|katori|tbsp|tsp|teaspoons?|tablespoons?|pieces?|small|large|medium|\bml\b|grams?|\bg\b|slices?|handful|palm)[^)]*?)\s*\)/gi;

/** One component of a dish — a clean title plus the portion lifted off it. */
export interface DishComponent {
  title: string;
  /** household portion, e.g. "2", "2 tbsp", "½ cup". Absent when none stated. */
  portion?: string;
}

/** Break a composite dish ("Ragi dosa (2) + chutney (2 tbsp)") into clean
 *  components, lifting each portion-shaped "(…)" out of the title wherever it
 *  sits — trailing ("dosa (2)"), leading ("(2) eggs"), or standalone
 *  ("(1) amla") — and dropping accidental doubles ("(1 cup) (1 bowl)" keeps the
 *  first). Tolerant by design: the generators and coach edits place portions
 *  inconsistently, so the DISPLAY is where they get normalised. */
export function splitDishComponents(dish: string): DishComponent[] {
  return (dish ?? "")
    .split(/\s\+\s/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((comp) => {
      const portions: string[] = [];
      const title = comp
        .replace(DISH_PORTION_RE, (_m, p) => {
          const v = String(p).trim();
          if (v) portions.push(v);
          return " ";
        })
        .replace(/\s+,/g, ",")
        .replace(/\s+/g, " ")
        .trim();
      return { title: title || comp, portion: portions[0] || undefined };
    });
}

/** One slot of one day in the full-week menu view. */
export interface WeekMenuSlot {
  slot: string;
  dish: string;
  /** dish broken into clean title + lifted portion per component (display). */
  components?: DishComponent[];
  ayurveda?: boolean;
}
export interface WeekMenuDay {
  dow: string;
  /** real date when the letter carries one ("8 Jun") */
  dateLabel?: string;
  today?: boolean;
  slots: WeekMenuSlot[];
}
export interface AppWeekMenu {
  week: number;
  /** the rotation week the client is currently in */
  current: boolean;
  days: WeekMenuDay[];
}

/** One line on the shopping list. Generated per fortnight by
 *  scripts/generate-grocery-list.py (Haiku, coach-triggered) and stored at
 *  meal-plans/<planSlug>-grocery.yaml — the app only ever READS it. */
export interface GroceryItem {
  item: string;
  qty?: string;
  /** shopping-trip grouping: "Grains & atta" | "Dals & legumes" |
   *  "Vegetables & fresh" | "Dairy" | "Nuts, seeds & dry fruit" |
   *  "Spices & masala" | "Other" */
  category: string;
  /** pantry staple the household almost certainly has */
  staple?: boolean;
  /** dish names this item is for (shown on tap) */
  for?: string[];
}
export interface AppGrocery {
  generated_at?: string;
  weeks: { week: number; items: GroceryItem[] }[];
}

// Swap types + matcher live in the PURE module ./swaps (no server-only) so
// the client-side app components can share the exact same logic.
export type { AppSwapGroup, SwapMember } from "./swaps";

/** One full recipe from the plan's recipe pack, rendered IN-APP (letters
 *  are being retired — the app is the system of record). */
export interface AppRecipe {
  title: string;
  serves?: string;
  time?: string;
  ingredients: string[];
  /** structured quantities — power the "cook for N people" scaler */
  ingredientsStructured?: { qty: string; unit: string; item: string }[];
  /** serving count the quantities are written for (for scaling) */
  servingsNum?: number;
  /** accurate kcal/serving (AI-precomputed for library recipes) */
  kcalPerServing?: number;
  method: string[];
  tip?: string;
  ayurveda?: boolean;
  imageUrl?: string;
}

/** One scored MSQ submission (written by scripts/save-app-msq.py). */
export interface AppMsqEntry {
  date: string;
  week: number;
  total: number;
  band: string; // optimal | mild | moderate | high
  categoryTotals: Record<string, number>;
}
// eslint-disable-next-line no-duplicate-imports
import { swapTermMatches, type AppSwapGroup as SwapGroupT, type SwapMember as SwapMemberT } from "./swaps";
import { deriveReminders, effectiveReminders } from "./reminders-derive";
import { readOverrides } from "./reminders-server";
import {
  isNonVegPref,
  isVegetarianPref,
  fmtDay,
  humanize,
  firstSentence,
  shortDose,
  timingRank,
  slotFromRank,
  shortTiming,
  displayTiming,
} from "./client-app-format";
import { SUPP_NAME_OVERRIDES, suppKey } from "./client-app-supplements";

export interface AppMealExtra {
  grad: string;
  imageUrl?: string;
  mins?: string;
  serves?: string;
  ingredients: string[];
  recipe: string[];
  swaps: { name: string; note: string; kcal?: number }[];
}

export interface AppSupplement {
  id: string;
  name: string;
  dose: string;
  slot: "Morning" | "With meals" | "Bedtime";
  timing: string;
  /** Fine-grained chronological order through the day (10 = empty-stomach on
   *  waking … 70 = bedtime, 100 = as-needed). Every supplement surface sorts
   *  by this so the schedule always reads in the order they're actually taken
   *  — empty-stomach before with-breakfast before mid-morning, and so on. */
  chronoRank: number;
  why: string;
  buyUrl?: string;
  buyLabel?: string;
  /** VitaOne supplement-facts label thumbnail (from supplement_links.yaml),
   *  shown beside the Reorder link. */
  imageUrl?: string;
  /** True when timing is situational (as-needed, at-risk meals, PRN). Excluded from daily log. */
  asNeeded?: boolean;
  /** True when supplement should be taken on an empty stomach — sorts before with-food supplements. */
  emptyStomach?: boolean;
  /** True when the coach's rationale marks this as a primary/driver-targeting
   *  supplement (auto-detected). Surfaced as a "Core" tier on the Plan tab. */
  core?: boolean;
  /** True when this supplement begins NEXT week — shown with a "Starts next
   *  week" heads-up so the client can order it in time. Not part of today's
   *  routine until it actually starts. */
  startsNextWeek?: boolean;
  /** Phase metadata — drives the Plan tab's "whole plan, by week" grouping. */
  startWeek?: number;
  durationWeeks?: number | null;
  status?: "current" | "upcoming" | "later" | "past";
}

export interface AppRemedy {
  slug: string;
  name: string;
  also: string;
  category: string;
  route: "internal" | "external";
  icon: string;
  /** coach-referral purchase link when the remedy needs buying (e.g.
   *  punarnava) — resolved from supplement_links.yaml, never a search URL */
  buyUrl?: string;
  summary: string;
  prepSteps: string[];
  dose: string;
  duration: string;
  timing: string;
  cautions: string[];
  indications: string[];
  bal: string[];
  agg: string[];
  virya: string | null;
  stub: boolean;
  // demographic gates (from the catalogue's suitable_sex / suitable_stages /
  // avoid_in — enforced server-side before anything reaches the phone)
  suitableSex: "any" | "female" | "male";
  suitableStages: string[];
  avoidIn: string[];
  /** Shelf cards only: the short client-specific "why this remedy" line. */
  whyFor?: string;
  // assignment overlay
  assigned?: boolean;
  daily?: boolean;
  supplementLike?: boolean;
  /** demoted duplicate: same timing slot as a primary drink — shown as a
   *  clearly-labelled swap option, never on the daily log */
  alternative?: boolean;
  alternativeTo?: string;
  suppSlot?: string;
  suppTiming?: string;
  when?: string;
  why?: string;
  /** True when the remedy should appear BEFORE the first meal (empty-stomach drinks like methi water). */
  beforeBreakfast?: boolean;
}

export interface JourneyItem {
  kind: "start" | "update" | "checkin";
  week: number;
  when: string;
  title: string;
  summary?: string;
  note?: { who: string; text: string };
}

export interface PlateItem {
  key: string;
  label: string;
  portion: string;
  pct: number;
  tone: string;
  icon?: string;
  examples: string[];
  note: string;
}

export interface AppLesson {
  id: string;
  title: string;
  kind: string;
  mins: string;
  summary: string;
  body: string;
}

export interface AppResource {
  id: string;
  title: string;
  kind: string;
  icon: string;
  desc: string;
  body: string;
  url?: string;
}

/** A guided breathing session, paced exactly to the prescribed technique. */
export interface AppBreathwork {
  /** Short display name, e.g. "4-7-8 breathing". */
  name: string;
  /** id of the matching row in practices[] (gets the inline Guide chip). */
  practiceId: string;
  when: string;
  /** One-or-two sentence client-friendly why, shown under the session. */
  why: string;
  rounds: number;
  phases: {
    key: string;
    label: string;
    cue: string;
    secs: number;
    action: "expand" | "hold" | "shrink";
  }[];
}

/** Computed seed-cycling guidance — the app works out which seeds to eat
 *  TODAY from the client's cycle data so she doesn't have to track the phase
 *  herself. `mode: "phased"` uses last_menstrual_period + cycle length to pick
 *  the follicular (flax + pumpkin) or luteal (sesame + sunflower) seeds;
 *  `mode: "daily"` (cycle suppressed / post-menopausal) shows all four every
 *  day. `needsDate` = phased but no period date on file → prompt the client. */
export interface AppSeedCycling {
  mode: "phased" | "daily";
  phase: "follicular" | "luteal" | null;
  dayInCycle: number | null;
  cycleLength: number;
  lastPeriodStart: string | null; // ISO YYYY-MM-DD
  needsDate: boolean;
  /** Today's seeds — the headline. */
  today: { seeds: string[]; line: string; note: string };
  /** The full two-phase schedule, for the "see the whole rhythm" disclosure. */
  schedule: { follicular: string; luteal: string };
}

/** Cycle-timed cramp support — shows a ginger-tea prompt (with the tea
 *  quantities) ONLY on the dates that matter: the ~2 days before the client's
 *  expected period and the first few crampy days. null the rest of the month. */
export interface AppPeriodCare {
  heading: string;
  line: string;
  recipe: string;
}

/** A guided EFT (tapping) session — a fixed point sequence with per-point
 *  phrases. Phase 1 uses a coach-authored library script chosen by theme; the
 *  plan can later carry an approved, per-client (Haiku-filled) script. The 7
 *  point coordinates live in the overlay; this config carries only the words. */
/** One tapping script for a single issue (cravings / sleep / anxiety / stress).
 *  A client can have several — the app lets them pick which to tap on. */
export interface AppEftTheme {
  theme: string;
  themeLabel: string;
  /** setup statement, tapped on the side of the hand ×3 */
  setup: string;
  /** 8 points in order: crown, eyebrow, side of eye, under eye, under nose, chin, collarbone, under arm */
  points: { key: string; label: string; phrase: string }[];
  /** the rating question, worded for this issue (e.g. sleep → "How wound-up
   *  does your mind feel?") — clearer than a generic "how strong". */
  sudsBeforeQ: string;
  sudsAfterQ: string;
  why: string;
}

export interface AppEft {
  /** Primary issue — drives the mind-body drip ordering + the card title.
   *  Always equals themes[0].theme. */
  theme: string;
  themeLabel: string;
  practiceId: string;
  when: string;
  /** ask for a 0–10 distress rating before + after */
  suds: boolean;
  /** Every issue this client can tap on, primary first. Derived from the case
   *  (goals + conditions + reported triggers) — a cravings client who also
   *  reports poor sleep gets both scripts. Single-element for most clients.
   *  The primary's script also lives on the flat fields below for back-compat. */
  themes: AppEftTheme[];
  /** setup statement, tapped on the side of the hand ×3 (primary issue) */
  setup: string;
  points: { key: string; label: string; phrase: string }[];
  sudsBeforeQ: string;
  sudsAfterQ: string;
  why: string;
}

/** Guided sleep wind-down — a lie-down progressive relaxation (slow breathing →
 *  head-to-toe release → drift-off). Technique #3 in the mind-body drip. No SUDS;
 *  sleep isn't a distress rating. Steps drive the dark immersive overlay. */
export interface AppSleep {
  practiceId: string;
  when: string;
  why: string;
  steps: { kind: "settle" | "breath" | "release" | "drift"; label: string; cue: string; secs: number }[];
}

type EftScript = {
  themeLabel: string;
  setup: string;
  why: string;
  sudsBeforeQ: string;
  sudsAfterQ: string;
  points: AppEft["points"];
};

const _eftPts = (
  setup: string,
  why: string,
  themeLabel: string,
  sudsBeforeQ: string,
  sudsAfterQ: string,
  phrases: [string, string, string, string, string, string, string, string],
): EftScript => ({
  themeLabel,
  setup,
  why,
  sudsBeforeQ,
  sudsAfterQ,
  points: [
    { key: "crown", label: "Top of head", phrase: phrases[0] },
    { key: "eyebrow", label: "Eyebrow", phrase: phrases[1] },
    { key: "side_eye", label: "Side of eye", phrase: phrases[2] },
    { key: "under_eye", label: "Under eye", phrase: phrases[3] },
    { key: "under_nose", label: "Under nose", phrase: phrases[4] },
    { key: "chin", label: "Chin", phrase: phrases[5] },
    { key: "collarbone", label: "Collarbone", phrase: phrases[6] },
    { key: "under_arm", label: "Under arm", phrase: phrases[7] },
  ],
});

/** Coach-voiced default scripts (Phase 1). Phase 2 swaps in a per-client script
 *  the coach has approved. */
const EFT_LIBRARY: Record<string, EftScript> = {
  cravings: _eftPts(
    "Even though I get these cravings when I'm stressed or tired, I deeply and completely accept myself.",
    "Tapping settles the stress signal underneath a craving, so the urge softens on its own.",
    "Cravings",
    "How strong is the craving right now?",
    "And now — how strong is the craving?",
    [
      "All this craving I'm feeling right now",
      "This urge that shows up at the end of the day",
      "I don't have to act on it",
      "It's just my body asking for comfort",
      "I can give myself calm instead",
      "I'm safe — this craving can pass",
      "Choosing what truly nourishes me",
      "Kind to my body, this is enough",
    ],
  ),
  anxiety: _eftPts(
    "Even though I feel this anxiety in my body, I deeply and completely accept myself.",
    "Tapping while you name the feeling tells your nervous system it's safe to settle.",
    "Anxiety & overwhelm",
    "How anxious do you feel right now?",
    "And now — how anxious do you feel?",
    [
      "All this worry I've been carrying",
      "This tightness in my chest",
      "It's safe to let my shoulders drop",
      "I don't have to fix everything right now",
      "I can breathe a little slower",
      "This feeling is allowed to ease",
      "Coming back to calm, one breath at a time",
      "Safe, steady, and held right now",
    ],
  ),
  sleep: _eftPts(
    "Even though my mind is still busy, I deeply and completely accept myself.",
    "Tapping downshifts the wind-up that keeps you awake, so sleep can arrive.",
    "Winding down for sleep",
    "How wound-up does your mind feel right now?",
    "And now — how wound-up does your mind feel?",
    [
      "All the thoughts from today",
      "This busy, racing mind",
      "There's nothing to solve right now",
      "My body is allowed to rest",
      "I can let the day go",
      "Sinking a little softer into the bed",
      "Ready to let sleep come",
      "Soft and heavy, ready to drift off",
    ],
  ),
  stress: _eftPts(
    "Even though I'm carrying a lot right now, I deeply and completely accept myself.",
    "A round of tapping lowers the stress signal in the body — a reset in two minutes.",
    "Stress reset",
    "How stressed do you feel right now?",
    "And now — how stressed do you feel?",
    [
      "All this stress I've been holding",
      "Everything I've been carrying today",
      "It's okay to set some of it down",
      "I'm doing the best I can",
      "I can soften, just for a moment",
      "Letting my body unclench",
      "Coming back to steady ground",
      "Carrying it all a little more lightly",
    ],
  ),
};

/** Every issue we have an authored tapping script for, in priority order
 *  (the first present one becomes the client's primary issue, which drives the
 *  mind-body drip ordering). Exported so the coach UI can offer the full set. */
export const EFT_THEME_KEYS = ["cravings", "sleep", "anxiety", "stress"] as const;
export const EFT_THEME_LABELS: Record<string, string> = {
  cravings: "Cravings",
  sleep: "Winding down for sleep",
  anxiety: "Anxiety & overwhelm",
  stress: "Stress reset",
};

/** Auto-detect which issues a case touches from its signals (goals +
 *  conditions + reported triggers). Returns the matched theme keys, or
 *  ["stress"] as the general fallback when nothing specific appears. Shared by
 *  deriveEft and the coach's EFT-issues control so both read the same default.
 *
 *  Sleep = explicit sleep words OR genuinely nocturnal waking. Bare "wake" is
 *  deliberately NOT a sleep signal — "wake up tired in the morning" is a
 *  fatigue/energy complaint (thyroid, low iron), not insomnia. Only count a
 *  "wake" token when it sits next to a nocturnal cue. */
export function autoDetectEftThemes(signals: string): string[] {
  const blob = (signals || "").toLowerCase();
  const isSleep =
    /\b(sleep|insomnia|sleepless)\b/.test(blob) ||
    (/\bwak\w*/.test(blob) && /\bnight\b|\b[1-4]\s?am\b|middle of the night|back to sleep/.test(blob));
  const matched: string[] = [];
  if (/sugar|craving|weight|snack|binge|sweet/.test(blob)) matched.push("cravings");
  if (isSleep) matched.push("sleep");
  if (/anx|panic|overwhelm|stress|worry/.test(blob)) matched.push("anxiety");
  return matched.length ? matched : ["stress"];
}

/**
 * Derive a guided EFT session from the plan's lifestyle practices — surfaces
 * only when the coach has prescribed a tapping / EFT practice. Theme is inferred
 * from the practice text + the client's goals, conditions, and reported triggers,
 * else "stress".
 *
 * `clientSignals` should include goals + active_conditions + reported_triggers —
 * the trigger field is where stated patterns like "sugar cravings during PMS"
 * live, and they carry the strongest theme signal of all.
 */
export function deriveEft(
  practices: { id: string; name: string; when: string }[],
  practiceRaw: Dict[],
  clientSignals: string,
  themesOverride?: string[],
): AppEft | null {
  let pid = "";
  let when = "";
  let practiceText = "";
  for (let i = 0; i < practiceRaw.length; i++) {
    const p = practiceRaw[i] || {};
    const text = `${asStr(p.name)} ${asStr(p.details)}`.toLowerCase();
    if (/\beft\b|tapping|emotional freedom/.test(text)) {
      pid = practices[i]?.id || asStr(p.id) || `eft-${i}`;
      when = practices[i]?.when || asStr(p.when);
      practiceText = text;
      break;
    }
  }
  if (!pid) return null;
  const blob = `${practiceText} ${clientSignals}`.toLowerCase();
  // Which issues to surface: a coach override (client.eft_themes) wins outright;
  // otherwise auto-detect from the case. Either way, normalise to known scripts
  // in priority order so the primary (themes[0], which drives the drip) is
  // deterministic. An override of only-invalid keys falls back to auto-detect.
  const override = (themesOverride || []).filter((t) => !!EFT_LIBRARY[t]);
  const chosen = override.length ? override : autoDetectEftThemes(blob);
  const keys = EFT_THEME_KEYS.filter((k) => chosen.includes(k));
  const themes: AppEftTheme[] = keys.map((key) => {
    const s = EFT_LIBRARY[key] || EFT_LIBRARY.stress;
    return {
      theme: EFT_LIBRARY[key] ? key : "stress",
      themeLabel: s.themeLabel,
      setup: s.setup,
      points: s.points,
      sudsBeforeQ: s.sudsBeforeQ,
      sudsAfterQ: s.sudsAfterQ,
      why: s.why,
    };
  });
  const primary = themes[0];
  return {
    theme: primary.theme,
    themeLabel: primary.themeLabel,
    practiceId: pid,
    when: when || "Anytime you feel the pull",
    suds: true,
    themes,
    setup: primary.setup,
    points: primary.points,
    sudsBeforeQ: primary.sudsBeforeQ,
    sudsAfterQ: primary.sudsAfterQ,
    why: primary.why,
  };
}

/* Default guided wind-down (Phase 1, coach-voiced). Slow breathing → head-to-toe
   release → drift-off close. Her-voice narration is the Phase-2 upgrade. */
const SLEEP_STEPS: AppSleep["steps"] = [
  { kind: "settle", label: "Settle in", cue: "Lie down and let yourself be heavy. Nothing to fix, nothing to try — we're just going to let go.", secs: 18 },
  { kind: "breath", label: "Slow your breath", cue: "Breathe in for four… and out, long and slow, for six. A few easy rounds — let each exhale loosen you.", secs: 36 },
  { kind: "release", label: "Your feet & legs", cue: "Let them grow heavy, sinking into the bed. Nowhere to be.", secs: 28 },
  { kind: "release", label: "Your hips & belly", cue: "Soften your belly. Let your hips spread and settle.", secs: 28 },
  { kind: "release", label: "Your back", cue: "Let the whole day's weight melt off your back, into the bed.", secs: 28 },
  { kind: "release", label: "Your hands & arms", cue: "Heavy and still. Let your fingers uncurl.", secs: 26 },
  { kind: "release", label: "Your shoulders & neck", cue: "Let your shoulders drop away from your ears. Lengthen the back of your neck.", secs: 28 },
  { kind: "release", label: "Your jaw & face", cue: "Unclench your jaw. Soften your brow, your eyes, your tongue.", secs: 28 },
  { kind: "release", label: "Your whole body", cue: "Heavy, warm, sinking. Held by the bed.", secs: 24 },
  { kind: "drift", label: "Drift off", cue: "Nothing to do now. Each breath a little deeper. Let sleep come to you.", secs: 34 },
];

/** Derive the guided sleep wind-down — surfaces when the coach has prescribed a
 *  wind-down / body-scan / relaxation-for-sleep practice. */
export function deriveSleep(
  practices: { id: string; name: string; when: string }[],
  practiceRaw: Dict[],
): AppSleep | null {
  let pid = "";
  let when = "";
  for (let i = 0; i < practiceRaw.length; i++) {
    const p = practiceRaw[i] || {};
    // Match the practice NAME only — "wind down" appears casually in other
    // practices' DETAILS (e.g. "4-7-8 breathing … to wind down before bed").
    const text = asStr(p.name).toLowerCase();
    if (/wind.?down|body scan|sleep relaxation|relaxation for sleep|yoga nidra|progressive relaxation|sleep meditation|bedtime relaxation/.test(text)) {
      pid = practices[i]?.id || asStr(p.id) || `sleep-${i}`;
      when = practices[i]?.when || asStr(p.when);
      break;
    }
  }
  if (!pid) return null;
  return {
    practiceId: pid,
    when: when || "Tonight, as you get into bed",
    why: "A few minutes of guided letting-go downshifts the body into sleep — slower than a racing mind can keep up with.",
    steps: SLEEP_STEPS,
  };
}

/**
 * Derive the guided-breathing config from the plan's lifestyle practices.
 *
 * Pattern parsing, most-specific first:
 *   "4-7-8"            → in 4 / hold 7 / out 8        (digits win, always)
 *   "box breathing"    → in 4 / hold 4 / out 4 / hold 4
 *   "extended exhale"  → in 4 / out 8
 *   generic breathwork → in 4 / out 6 (slow breathing)
 *
 * Rounds: "N rounds" verbatim, else "N min" ÷ cycle length, else 5.
 * Mentions like mouth-taping ("nasal breathing") are not paced sessions.
 */
function deriveBreathwork(
  practices: { id: string; name: string; when: string }[],
  practiceRaw: Dict[],
): AppBreathwork | null {
  for (let i = 0; i < practices.length; i++) {
    const name = practices[i].name;
    const details = asStr(practiceRaw[i]?.details);
    const text = `${name} ${details}`;
    if (!/breath|pranayam/i.test(text)) continue;
    // not a paced session — taping / posture references only
    if (/mouth.?tap|nasal breathing|nose breathing|mouth breathing/i.test(text) && !/\d\s*[-–]\s*\d\s*[-–]\s*\d/.test(text))
      continue;
    // name must reference the practice itself unless details prescribe a count
    if (!/breath|pranayam/i.test(name) && !/\d\s*[-–]\s*\d\s*[-–]\s*\d|breathwork|slow .{0,12}breath/i.test(details))
      continue;

    // ---- phases ----
    type Phase = AppBreathwork["phases"][number];
    const IN: Phase = { key: "in", label: "Breathe in", cue: "In through your nose", secs: 4, action: "expand" };
    const HOLD = (secs: number): Phase => ({ key: "hold", label: "Hold", cue: "Hold it gently", secs, action: "hold" });
    const OUT = (secs: number, mouth: boolean): Phase => ({
      key: "out",
      label: "Breathe out",
      cue: mouth ? "Out through your mouth" : "Out slowly and fully",
      secs,
      action: "shrink",
    });
    let phases: Phase[];
    let shortName: string;
    const m = text.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/);
    if (m) {
      const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map((n) => (n ? parseInt(n, 10) : 0));
      phases = [{ ...IN, secs: a }, HOLD(b), OUT(c, a === 4 && b === 7 && c === 8)];
      if (d) phases.push({ ...HOLD(d), key: "hold2", cue: "Lungs empty, stay soft" });
      shortName = `${m[0].replace(/\s+/g, "")} breathing`;
    } else if (/box breathing/i.test(text)) {
      phases = [IN, HOLD(4), OUT(4, false), { ...HOLD(4), key: "hold2", cue: "Lungs empty, stay soft" }];
      shortName = "Box breathing";
    } else if (/extended exhale/i.test(text)) {
      phases = [IN, OUT(8, false)];
      shortName = "Extended exhale breathing";
    } else {
      phases = [IN, OUT(6, false)];
      shortName = "Slow breathing";
    }
    const cycleSecs = phases.reduce((s, p) => s + p.secs, 0);

    // ---- rounds ----
    let rounds = 5;
    const rm = text.match(/(\d{1,2})\s*(?:rounds?|times|cycles|breaths)\b/i);
    const mm = text.match(/(\d{1,2})\s*(?:min\b|mins\b|minutes?)/i);
    if (rm) rounds = parseInt(rm[1], 10);
    else if (mm) rounds = Math.min(10, Math.max(3, Math.round((parseInt(mm[1], 10) * 60) / cycleSecs)));

    // ---- why (client-friendly; strip coach stamps) ----
    let why = details
      .replace(/^\[[^\]]*\]\s*/g, "")
      .replace(/^NEW\s*\([^)]*\)\.?\s*/i, "")
      .split(/(?<=[.!?])\s+/)
      .slice(0, 2)
      .join(" ")
      .trim();
    if (why.length < 30)
      why =
        "Slow, counted rounds calm the nervous system and switch on “rest and digest”. Sit comfortably, shoulders soft.";

    return {
      name: shortName,
      practiceId: practices[i].id,
      when: practices[i].when,
      why,
      rounds: Math.min(12, Math.max(1, rounds)),
      phases,
    };
  }
  return null;
}

/** A self-serve "flare reset" card — coach-authored at graduation, shown in the
 *  maintenance + library floors so a graduate can steady a wobble themselves. */
export interface BackOnTrack {
  title: string;
  intro: string;
  steps: string[];
  /** Non-optional "this is beyond a reset — seek care" triggers. The spec
   *  (PLAN_END_GAME_SPEC.md) makes these mandatory; parseBackOnTrack injects a
   *  default set when a stored card predates the field, so every rendered reset
   *  carries them. */
  redFlags: string[];
}

/** The month's do's & don'ts — the one living thing in maintenance. Cached per
 *  YYYY-MM on the plan (plan.monthly_cards), regenerated monthly. */
export interface MonthlyCard {
  month: string; // YYYY-MM
  title: string;
  dos: string[];
  donts: string[];
}

/** Data the end-game screens (REVIEW / MAINTENANCE / GRACE / LIBRARY) render.
 *  Non-null only when `mode !== "ACTIVE"`. */
export interface EndgameInfo {
  mode: Exclude<AppMode, "ACTIVE">;
  /** Telemetry / coach-chip "why". */
  reason: string;
  /** The 12-week effective recheck (graduation) date + a human label. */
  recheckDate: string | null;
  recheckLabel: string | null;
  /** REVIEW only: true BEFORE the recheck date (client is approaching the end),
   *  false on/after it (actually reached). Drives "final stretch" vs "finish
   *  line" copy so we never tell an in-protocol client they're done early. */
  approaching: boolean;
  /** MAINTENANCE / GRACE: paid-through date + human label. */
  paidThrough: string | null;
  paidThroughLabel: string | null;
  /** GRACE: last day of full access before dropping to the library floor. */
  graceUntilLabel: string | null;
  /** The flare-reset card (from client.back_on_track_plan), if authored. */
  backOnTrack: BackOnTrack | null;
  /** This month's do's & don'ts (from plan.monthly_cards[YYYY-MM]), if generated. */
  monthlyCard: MonthlyCard | null;
  /** Offered ONE-TIME maintenance blocks (manual, e.g. 6 months ₹10,000).
   *  Server-fixed prices — the pay route re-derives, never trusts the client. */
  pricing: { termMonths: number; inr: number }[];
  /** The quarterly AUTO-DEBIT subscription offer, when the Razorpay plan is
   *  configured (RAZORPAY_QUARTERLY_PLAN_ID set); null otherwise (UI hides it). */
  subscriptionOffer: { intervalMonths: number; inr: number } | null;
  /** True when the client already has a live (active/authenticated) subscription —
   *  the UI shows "auto-renew on" instead of re-offering it. */
  subscriptionActive: boolean;
  /** Non-null in MAINTENANCE when coverage runs out within the renewal window —
   *  a human label for the "renew soon" nudge. */
  renewalDueLabel: string | null;
}

/** Add n days to a YYYY-MM-DD in UTC (mirrors app-mode.ts' UTC discipline). */
function addDaysUtcYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Non-optional flare-reset safety triggers (mirrors generate-back-on-track.py
 *  _RED_FLAGS). Injected when a stored card predates the red_flags field so
 *  every rendered reset still carries them — the spec makes them mandatory. */
const DEFAULT_FLARE_RED_FLAGS = [
  "Chest pain, trouble breathing, fainting, or sudden one-sided weakness — call your local emergency number now. This is not a reset situation.",
  "A high fever that won't settle, severe or fast-worsening pain, persistent vomiting, or blood where there shouldn't be — please see a doctor.",
  "If things are getting sharply worse instead of easing, you're frightened, or you're pregnant and unsure — reach out to Shivani or a doctor rather than finishing the reset on your own.",
];

/** Parse client.back_on_track_plan (coach-authored dict) into the flare card. */
function parseBackOnTrack(raw: unknown): BackOnTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = asStr(r.title).trim();
  const intro = asStr(r.intro).trim();
  const steps = asStrArr(r.steps).map((s) => s.trim()).filter(Boolean);
  const redFlags = asStrArr(r.red_flags).map((s) => s.trim()).filter(Boolean);
  if (!title && !intro && steps.length === 0) return null;
  return {
    title: title || "Back on track",
    intro,
    steps,
    // Mandatory: a stored card with no red_flags (authored before this field)
    // still renders the default safety triggers rather than nothing.
    redFlags: redFlags.length ? redFlags : DEFAULT_FLARE_RED_FLAGS,
  };
}

/** Pick this month's do's/don'ts from plan.monthly_cards (keyed YYYY-MM). */
function parseMonthlyCard(raw: unknown, ym: string): MonthlyCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = (raw as Record<string, unknown>)[ym];
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const dos = asStrArr(o.dos).map((s) => s.trim()).filter(Boolean);
  const donts = asStrArr(o.donts).map((s) => s.trim()).filter(Boolean);
  if (dos.length === 0 && donts.length === 0) return null;
  return { month: ym, title: asStr(o.title).trim() || "This month", dos, donts };
}

/** Resolve the end-game app mode + the data its screens read. "ACTIVE" → no
 *  endgame block (the app renders the normal in-protocol experience). */
const MAINTENANCE_PRICING_LIST = Object.entries(MAINTENANCE_PRICING)
  .map(([term, inr]) => ({ termMonths: Number(term), inr }))
  .sort((a, b) => b.termMonths - a.termMonths);

function buildEndgame(
  client: Record<string, unknown>,
  plan: AppModePlan | null,
  todayYmd: string,
  monthlyCards: unknown = null,
  /** record-derived paid-through (from PAID maintenance orders) — folded in so
   *  the app reflects a fresh payment before the Mac reconcile updates client.yaml */
  recordThrough: string | null = null,
  /** quarterly auto-debit subscription wiring (env-gated) + whether one is live */
  sub: { available: boolean; inr: number; active: boolean } = { available: false, inr: 6000, active: false },
  /** travel/illness pause + weight-loss buffer so graduation timing extends. */
  recheckOpts: RecheckOpts = {},
): { mode: AppMode; endgame: EndgameInfo | null } {
  // Effective window = the later of client.yaml + the latest PAID record.
  const fromClient = asYmd(client.maintenance_paid_through) || null;
  const paidThrough =
    fromClient && recordThrough ? (recordThrough > fromClient ? recordThrough : fromClient) : recordThrough || fromClient;

  const res = resolveAppMode(
    {
      maintenance_status: asStr(client.maintenance_status) || null,
      maintenance_paid_through: paidThrough,
      plan,
      recheckOpts,
    },
    todayYmd,
  );
  if (res.mode === "ACTIVE") return { mode: "ACTIVE", endgame: null };

  const recheck = plan ? effectiveRecheckDate(plan, recheckOpts) : null;
  const graceUntil =
    res.mode === "GRACE" && paidThrough ? addDaysUtcYmd(paidThrough, GRACE_DAYS) : null;

  // Renewal nudge: in MAINTENANCE, flag when coverage runs out within the window.
  const renewalThreshold = addDaysUtcYmd(todayYmd, REVIEW_LEAD_DAYS);
  const renewalDueLabel =
    res.mode === "MAINTENANCE" && paidThrough && paidThrough <= renewalThreshold
      ? formatLongDate(paidThrough)
      : null;

  return {
    mode: res.mode,
    endgame: {
      mode: res.mode,
      reason: res.reason,
      recheckDate: recheck,
      recheckLabel: recheck ? formatLongDate(recheck) : null,
      approaching: !!recheck && todayYmd < recheck,
      paidThrough,
      paidThroughLabel: paidThrough ? formatLongDate(paidThrough) : null,
      graceUntilLabel: graceUntil ? formatLongDate(graceUntil) : null,
      backOnTrack: parseBackOnTrack(client.back_on_track_plan),
      monthlyCard: parseMonthlyCard(monthlyCards, todayYmd.slice(0, 7)),
      pricing: MAINTENANCE_PRICING_LIST,
      subscriptionOffer: sub.available ? { intervalMonths: 3, inr: sub.inr } : null,
      subscriptionActive: sub.active,
      renewalDueLabel,
    },
  };
}

export interface ClientAppData {
  clientId: string;
  planSlug: string;
  token: string;
  /** IANA timezone all server-side "today" math used for this render — device
   *  cookie → client.yaml#timezone → IST. The app shell compares it against
   *  the browser tz and self-corrects via the ochre_tz cookie. */
  timezone: string;
  /** Commercial tier. "package" is the full app (every existing client). A
   *  consult-only client with no published plan resolves to "discovery" — a
   *  read-only Lab Vault + Summary, Plan/Progress locked. See discovery-tier.ts
   *  + docs/DISCOVERY_TIER_SPEC.md. */
  tier: AppTier;
  /** Upgrade-credit-window state — non-null only for tier === "discovery". */
  discoveryCredit: DiscoveryCredit | null;
  /** The "Your Starting Map" artifact — non-null only for tier === "discovery". */
  discoverySummary: DiscoverySummary | null;
  /** Discovery onboarding stage — non-null only for tier === "discovery". Gates
   *  the app: recommendations + countdown show only at `post_call`. */
  discoveryStage: DiscoveryStage | null;
  /** The client's intake form URL (so the app can launch intake) — discovery
   *  onboarding only; null once submitted / not applicable. */
  intakeUrl: string | null;
  /** End-game app mode (package tier). "ACTIVE" = in-protocol (current app, no
   *  change). REVIEW/MAINTENANCE/GRACE/LIBRARY drive the graduation → maintenance
   *  → frozen-floor screens. Discovery tier is always "ACTIVE" here (the `tier`
   *  field gates it first). See app-mode.ts. */
  mode: AppMode;
  /** Non-null only when mode !== "ACTIVE" — the data the end-game screens read. */
  endgame: EndgameInfo | null;
  /** Coach-recommended lab orders (Acumen). `recommended` ones are payable in
   *  app; others show status. Universal across tiers (booking works in any mode). */
  labOrders: LabOrder[];
  client: {
    firstName: string;
    program: string;
    week: number;
    totalWeeks: number;
    startDateLabel: string;
    /** true when the coach has set a meal-plan start date in the future —
     *  the plan is "on hold" and the app shows a pre-start screen until then */
    notStarted: boolean;
    /** days until the plan starts (0 once it has begun) */
    startsInDays: number;
    dosha: string[];
    doshaLabel: string;
    coachLine: string;
  };
  coach: {
    name: string;
    role: string;
    initials: string;
    whatsappNumber: string;
    whatsappPrefill: string;
    nextSession: string | null;
  };
  today: { dow: string; dateLabel: string; idx: number };
  weekStrip: { dow: string; num: number; today?: boolean }[];
  meals: AppMeal[];
  /** full-week menu grid(s) for the current fortnight — drives the
   *  "This week's menu" view + grocery shopping window */
  weekMenus: AppWeekMenu[];
  /** hybrid/principle plans carry ONE illustrative week — label it
   *  "Sample menu" (mix-and-match), never "This week's menu" */
  menuIsSample: boolean;
  /** every parsed recipe from the pack — rendered in-app */
  recipePack: AppRecipe[];
  /** structured shopping list, null until the coach generates one */
  grocery: AppGrocery | null;
  /** ingredient equivalence groups, pre-gated for this client */
  swapGroups: SwapGroupT[];
  /** MSQ submissions, oldest → newest (empty until the first check) */
  msqEntries: AppMsqEntry[];
  /** Active travel window flagged by the client (null when home).
   *  Drives the rules-based travel card + pauses the grocery list;
   *  generate-week-menu.py reads the same session as feedback.
   *  `kind` distinguishes travel / festival / illness; `location` is the
   *  destination (e.g. "Sydney, Australia") that drives the local-foods
   *  render cascade. */
  travel: {
    from: string;
    to: string;
    kind: "travel" | "festival" | "illness";
    location: string;
    context: string;
    active: boolean;
    /** Weight-loss clients only: reframe the card as "hold, don't lose" (the
     *  goal on holiday is to maintain) instead of any deficit/scale nudge. */
    holdNotLose?: boolean;
    /** Curated, plan-gated food guide for the destination/festival/situation
     *  (null when no dataset match — card falls back to generic rules). */
    localFoods?: TravelGuide | null;
  } | null;
  mealExtra: Record<string, AppMealExtra>;
  supplements: AppSupplement[];
  /** Supplements that begin NEXT week — a heads-up so the client can order
   *  ahead. NOT part of today's routine / counts / check-in. */
  upcomingSupplements: AppSupplement[];
  /** EVERY supplement in the plan, tagged with start week + status — the Plan
   *  tab's "whole plan, by week" view. Today's surfaces use `supplements`. */
  allSupplements: AppSupplement[];
  slotOrder: string[];
  practices: { id: string; name: string; when: string; details?: string }[];
  /** Computed seed-cycling section (which seeds today) — its own section
   *  under the menu. null when the plan doesn't prescribe seed cycling. */
  seedCycling: AppSeedCycling | null;
  /** Cycle-timed cramp support (ginger tea) — non-null only on the dates
   *  around the client's period; null the rest of the month. */
  periodCare: AppPeriodCare | null;
  /** Guided breathing config when the plan prescribes a breathing practice. */
  breathwork: AppBreathwork | null;
  /** Guided EFT (tapping) config when the plan prescribes a tapping practice
   *  AND it has been unlocked (mind-body drip — see `mindBody`). */
  eft: AppEft | null;
  /** Guided sleep wind-down config when prescribed AND unlocked (drip). */
  sleep: AppSleep | null;
  /** Mind-body drip nudge — non-null when the NEXT technique in this client's
   *  sequence is prescribed but not yet unlocked, so the app shows a gentle
   *  "keep practising to unlock" hint (priorLabel = what to keep doing,
   *  doneCount/needed = progress). null when nothing's waiting. */
  mindBody: { nextUp: string; priorLabel: string; doneCount: number; needed: number; locked: boolean } | null;
  principles: { t: string; b: string }[];
  labs: { name: string; meta: string; tone: string }[];
  /** client-facing lab vault — results vs FM-optimal + standard ranges (Phase 2 of LAB_VAULT_SPEC) */
  labVault: LabVault | null;
  journey: JourneyItem[];
  faq: { q: string; a: string }[];
  symptomScore: {
    goodAt: number;
    points: { wk: number; v: number }[];
    deltaLabel: string;
    next: string;
    caption: string;
  } | null;
  watchList: { name: string; note: string }[];
  labCheckpoints: {
    note: string;
    list: { label: string; sub: string; value: string; state: "done" | "next" | "todo" }[];
  };
  movementGoalMins: number;
  remedies: AppRemedy[];
  /** Eligible library (hard gates already applied) — what search browses. */
  remedyLib: AppRemedy[];
  /** Top 3–5 most relevant eligible remedies, each with a whyFor line. */
  remedyShelf: AppRemedy[];
  /** Schüssler tissue-salt suggestions — present only when the client is on the
   *  schussler_salts module AND the plan carries an authored tissue_salts
   *  section. null otherwise. A gentle optional adjunct. */
  tissueSalts: { overview: string; list: { name: string; reason: string; how: string; buyUrl: string }[] } | null;
  /** Free-form coach picks (off-catalogue product/remedy tips) — "Aquaphor for
   *  dry lips". Shown in the app's "Shivani's picks" section. */
  coachPicks: { title: string; forWhat: string; note: string; buyUrl: string }[];
  planRef: {
    pattern: string;
    authoredBy: string;
    forNote: string;
    phase: { currentIdx: number; list: { name: string; weeks: string; note: string }[] };
    plate: PlateItem[];
    accents: PlateItem[];
    oils: { use: string[]; avoid: string[]; note: string };
    foods: { eat: string[]; sometimes: string[]; avoid: string[] };
    /** when the issued letter spells out its own food groups, render THOSE
     *  verbatim (letter parity) instead of the 3-tier paraphrase */
    letterFoods?: LetterFoods | null;
    avoidWhy: string;
    cooking: { t: string; b: string }[];
    /** plain-language explanation for the top of the Plan tab — what this
     *  plan is and why this client is on it. Built from on-file conditions +
     *  eating pattern (no fabrication). */
    focus: { why: string; conditions: string[] };
    /** the client's Ayurvedic assessment (when they have one) + a short,
     *  client-friendly line on how the plan works with it. null when the
     *  client isn't on the Ayurveda track. */
    ayurveda: { constitution: string; imbalance?: string; how: string } | null;
    /** dietary highlights shown as chips, each optionally linked to a
     *  resource cheat-sheet (e.g. "Gluten-free" → hidden-sources sheet). */
    flags: { label: string; detail: string; resourceId?: string }[];
  };
  /** the letter's "sample week — swap like for like" guidance, verbatim */
  mealsNote: string;
  lessons: AppLesson[];
  resources: AppResource[];
  aiSuggested: { q: string; a: string }[];
  account: {
    name: string;
    contact: string;
    plan: string;
    member: string;
    /** initials fallback, shown when photoUrl is null or fails to load */
    avatar: string;
    /** token-scoped avatar URL when a photo exists on disk (the client's own
     *  in-app photo, or the coach/intake photo flowing through). null → use
     *  initials. */
    photoUrl: string | null;
    /** Saved lab home-collection address (from a prior order) — pre-fills the
     *  pay form so the client doesn't re-type it. "" when never entered. */
    collectionAddress: string;
    collectionPincode: string;
  };
  /** Body composition: read-only height/age from the coach dashboard +
   *  client-editable weight/waist/hip, plus the snapshot history that drives
   *  the progress charts. The app computes BMI/BMR/ratios client-side. */
  body: {
    heightCm: number | null;
    ageYears: number | null;
    sex: "M" | "F" | "";
    latest: {
      weightKg: number | null;
      waistCm: number | null;
      hipCm: number | null;
      bpSystolic: number | null;
      bpDiastolic: number | null;
      measuredOn: string | null;
    };
    /** oldest → newest; only entries that carry at least one of the tracked fields */
    history: {
      date: string;
      weightKg: number | null;
      waistCm: number | null;
      hipCm: number | null;
      bpSystolic: number | null;
      bpDiastolic: number | null;
      /** 1-5, from the daily energy sheet — not a body measurement, carried
       *  through the same snapshot so the vitals card can chart it alongside. */
      moodScore: number | null;
    }[];
  };
  reminders: {
    id: string;
    label: string;
    time: string;
    on: boolean;
    cadence: "daily" | "weekly";
    /** 0=Sun … 6=Sat — only meaningful when cadence === "weekly". */
    weekday?: number;
    /** client has pinned their own time (survives plan regeneration) */
    timeCustom: boolean;
  }[];
  /** Daily calorie guide for weight-loss clients — computed the same way the
   *  letter generator does (Mifflin-St Jeor → TDEE → phased deficit, current
   *  week), plus a rough estimate of what THIS week's menu actually delivers
   *  and whether it's tracking the target. null when the client has no
   *  weight-loss goal or lacks body data. */
  weightLoss: {
    dailyTarget: number;
    tdee: number;
    phaseNote: string;
    /** estimated avg kcal/day of the current week's menu (null if no menu) */
    estimatedDailyKcal: number | null;
    adherence: "on_track" | "high" | "low" | null;
    /** the coach-set goal — drives the Body screen's weight-vs-goal trendline.
     *  null when no structured goal is on file. */
    goal: { startKg: number; startDate: string; targetKg: number; targetDate: string } | null;
  } | null;
  /** ISO timestamp of when this plan was last published — shown in the "Plan updated" banner. */
  planUpdatedAt: string | null;
  /** Coach note to the client about what changed in this plan update. */
  clientUpdateNote: string | null;
}

// ── small utils ──────────────────────────────────────────────────────────────

type Dict = Record<string, unknown>;

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Address to pre-fill the lab home-collection form with. Priority:
 *   1. the client's saved lab collection address (from a prior order), else
 *   2. the structured address on the record (coach-entered at client creation —
 *      the intake form does NOT collect address, so this is the only other source).
 * Returns "" for each part when nothing is on file.
 */
function resolveCollectionAddress(client: Record<string, unknown>): { address: string; pincode: string } {
  const saved = asStr(client.collection_address).trim();
  if (saved) return { address: saved, pincode: asStr(client.collection_pincode).trim() };
  const composed = [client.address_line1, client.address_line2, client.city, client.state]
    .map((v) => asStr(v).trim())
    .filter(Boolean)
    .join(", ");
  return { address: composed, pincode: asStr(client.collection_pincode).trim() || asStr(client.pincode).trim() };
}
function asStrArr(v: unknown): string[] {
  return asArr(v).filter((x): x is string => typeof x === "string");
}

const IST = "Asia/Kolkata";

/** Returns tz when it's an IANA name Intl can resolve, else null. */
function validTz(tz: string | null | undefined): string | null {
  const t = (tz ?? "").trim();
  if (!t) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t });
    return t;
  } catch {
    return null;
  }
}

/** The timezone the app renders "today" in: the client's device (ochre_tz
 *  cookie, auto-detected by the app shell) wins, then a coach-set
 *  client.yaml#timezone, then IST. A US client must not have her menu flip
 *  at India midnight (Krittika, 2026-07-07). */
function resolveAppTz(client: Dict, deviceTz?: string | null): string {
  return validTz(deviceTz) ?? validTz(asStr(client.timezone)) ?? IST;
}

function tzNow(tz: string): Date {
  const s = new Date().toLocaleString("en-US", { timeZone: tz });
  return new Date(s);
}

async function readYamlIfExists(p: string): Promise<Dict | null> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    const d = yaml.load(raw);
    return d && typeof d === "object" ? (d as Dict) : null;
  } catch {
    return null;
  }
}

/** Count distinct days a client completed a given practice kind in the trailing
 *  N-day window — drives the mind-body drip (gate the next technique on
 *  consistency, not total count). Reads the per-client _practice_log.jsonl. */
async function practiceDaysInWindow(clientDir: string, kind: string, days = 7): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(clientDir, "_practice_log.jsonl"), "utf-8");
  } catch {
    return 0;
  }
  const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { kind?: string; date?: string };
      if (r.kind === kind && typeof r.date === "string" && r.date >= cutoff) seen.add(r.date);
    } catch {
      /* skip a malformed line */
    }
  }
  return seen.size;
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

// ── letter (.md) parsing ─────────────────────────────────────────────────────

interface WeekTable {
  week: number;
  /** unified shape: rows = slots, cells = Mon..Sun (7 columns) */
  rows: { slot: string; cells: string[] }[];
  /** format-B letters carry real dates per day column, "8 Jun" etc. */
  dayDates?: (string | null)[];
}

const DOW_SHORT = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Normalise a meal cell: drop recipe markers (✦/✨/⭐) + bold, and blank
 *  out filler cells ("Same", "Same as Week 1", "—") so they never render
 *  as dishes. */
function cleanDishCell(raw: string): string {
  const c = raw.replace(/[✦✨⭐]/g, "").replace(/\*\*/g, "").trim();
  if (/^same\b/i.test(c) || /^[-–—]+$/.test(c)) return "";
  return c;
}


/** Format-B letters spell out the eating pattern as labelled food groups
 *  ("**Protein, every meal:** dal, rajma, …") under "Foods to enjoy" /
 *  "Foods to go easy on" headings. When present, the app renders THESE
 *  verbatim (letter parity) instead of paraphrasing plan YAML fields. */
export interface LetterFoodGroup {
  label: string;
  items: string[];
}
export interface LetterFoods {
  enjoyTitle: string;
  enjoy: LetterFoodGroup[];
  easyTitle: string;
  easy: string[];
  note: string;
}

// Heading shapes vary by letter generation: bold paragraphs ("**Foods to
// enjoy — build your meals around these**"), ## / ### sections ("## 🍽 Foods
// to emphasise", "### What to add — your \"yes\" list"). Items vary too:
// labelled groups ("**Protein, every meal:** dal, rajma, …"), bold-lead
// bullets ("**Amla 1–2 daily** — why…"), or 2-column tables (| Food | Why |).
const ENJOY_HEAD_RE =
  /^(?:#{2,4}\s+)?[^\w\n]{0,6}\s*\**((?:Foods to (?:enjoy|emphasise|emphasize)|What to add)[^*\n]*)\**\s*$/im;
const EASY_HEAD_RE =
  /^(?:#{2,4}\s+)?[^\w\n]{0,6}\s*\**((?:Foods to (?:go easy on|limit|reduce|avoid)|What to (?:reduce|avoid|go easy on))[^*\n]*)\**\s*$/im;


// ── send-log gating ──────────────────────────────────────────────────────────
// The app shows ONLY content from letters the coach actually ISSUED.
// meal-plans/_send_log.yaml is the record of truth (written by the send
// buttons): one entry per send with letter_types + plan_slug (+ phase
// window for fortnight letters). A generated-but-never-sent draft sitting
// in the folder must never feed the app — coach rule 2026-06-10, after
// Hariharan's unsent May-5 draft surfaced a meal plan he was never given.






interface LetterRecipe {
  title: string;
  serves?: string;
  time?: string;
  /** recipe diet tags ('vegetarian'|'vegan'|'eggetarian'|'non_vegetarian'…) +
   *  main ingredients — drive the per-client dietary safety filter */
  diet?: string[];
  mains?: string[];
  ingredients: string[];
  /** structured ingredients (library recipes only) — drive the cook-for-N
   *  scaler + the deterministic calorie fallback */
  ingredientsStructured?: { qty: string; unit: string; item: string }[];
  /** numeric serving count the quantities are written for */
  servingsNum?: number;
  /** accurate kcal/serving (AI-precomputed for library recipes) */
  kcalPerServing?: number;
  method: string[];
  tip?: string;
  imageUrl?: string;
}

/** The structured recipe library (fm-database/data/_recipes/) — the plan-side
 *  source of truth for recipe methods. Detailed plans no longer need a
 *  generated recipes letter: any menu dish that matches a library recipe (or
 *  a coach-pinned plan.nutrition.recipes slug) gets its full method from
 *  here. Letter-parsed recipes still take precedence when they exist —
 *  they're personalised to the client. */
export async function loadLibraryRecipes(): Promise<{ slug: string; recipe: LetterRecipe }[]> {
  const dir = path.join(getCataloguePath(), "_recipes");
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: { slug: string; recipe: LetterRecipe }[] = [];
  for (const f of files) {
    if (!f.endsWith(".yaml") || f.startsWith("_")) continue;
    try {
      const r = yaml.load((await fs.readFile(path.join(dir, f), "utf8")) ?? "") as Dict;
      if (!r || !asStr(r.name) || !Array.isArray(r.steps) || !r.steps.length) continue;
      const ingStruct = (asArr(r.ingredients) as Dict[])
        .map((i) => ({ qty: asStr(i.qty), unit: asStr(i.unit), item: asStr(i.item) }))
        .filter((i) => i.item);
      const ingredients = ingStruct.map((i) => [i.qty, i.unit, i.item].filter(Boolean).join(" ").trim()).filter(Boolean);
      const prep = Number(r.prep_time_min) || 0;
      const cook = Number(r.cook_time_min) || 0;
      const mins = prep + cook;
      const imgRaw = r.image as Dict | undefined;
      const imgFile = imgRaw ? asStr(imgRaw.file) : "";
      const imgUrl =
        imgFile && asStr(imgRaw?.rights_status) !== "none"
          ? `/recipe-images/${imgFile}`
          : undefined;
      out.push({
        slug: asStr(r.slug) || f.replace(/\.yaml$/, ""),
        recipe: {
          title: asStr(r.name),
          serves: asStr(r.servings) || undefined,
          servingsNum: Number(r.servings) || undefined,
          kcalPerServing: Number(r.kcal_per_serving) || undefined,
          diet: asStrArr(r.diet),
          mains: asStrArr(r.main_ingredients),
          time: mins ? `${mins} min` : undefined,
          ingredients,
          ingredientsStructured: ingStruct.length ? ingStruct : undefined,
          method: (asArr(r.steps) as unknown[]).map((s) => String(s)),
          tip: asStr(r.one_line) || asStr(r.headnote) || undefined,
          imageUrl: imgUrl,
        },
      });
    } catch {
      /* one malformed library file never breaks the app */
    }
  }
  return out;
}

/** Stop-words ignored when token-matching a dish to a library recipe title. */
const RECIPE_LIB_STOP = new Set(["with", "and", "tbsp", "tsp", "cup", "roasted", "soaked", "ground", "fresh", "everyday", "style"]);
/** Normalize a dish/recipe name for matching: drop "(portion)" annotations and
 *  punctuation so "Paneer sabzi (1 bowl)" keys the same as "Paneer sabzi" —
 *  the real reason menu photos vanished once dishes carried explicit portions
 *  (2026-06-15). */
export const recipeLibKey = (s: string) =>
  s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const recipeLibToks = (s: string) =>
  recipeLibKey(s).split(" ").filter((t) => t.length > 3 && !RECIPE_LIB_STOP.has(t));

/**
 * Build the dish → library-recipe resolver. An exact normalized-title match
 * wins outright (the Plan-tab DishPicker composes dishes from EXACT recipe
 * titles, so a picked dish resolves deterministically to its recipe — and
 * photo — with none of the token-threshold fragility); otherwise a strict
 * token near-equality scan handles legacy letter-parsed dish text ("mint
 * chutney" → Cilantro Mint Chutney, but a "raita-free bowl" never gets the
 * Cucumber Mint Raita method).
 *
 * Extracted to module scope so the dashboard's menu-image coverage scan
 * resolves dishes EXACTLY as the client app does — one source of truth, no
 * drift. Pass a diet-filtered list to match what a given client can see, or
 * the full library for a coverage flag.
 */
export function buildLibraryRecipeResolver(
  libraryRecipes: { slug: string; recipe: LetterRecipe }[],
): (dish: string) => LetterRecipe | undefined {
  const byExactKey = new Map<string, LetterRecipe>();
  for (const l of libraryRecipes) {
    const k = recipeLibKey(l.recipe.title);
    if (k && !byExactKey.has(k)) byExactKey.set(k, l.recipe);
  }
  return (dish: string): LetterRecipe | undefined => {
    // Component separators used across menus: " + ", "→", "⇒", ":". The "⇒"
    // (U+21D2) is what the multi-component dinner menus actually use ("Green
    // moong sabzi ⇒ masoor dal ⇒ sama millet") — omitting it meant those whole
    // dishes never split, so the first component's recipe (and photo) was lost.
    const pills = dish.split(/\s\+\s|→|⇒|:/).map((s) => s.trim()).filter(Boolean);
    for (let pi = 0; pi < pills.length; pi++) {
      const pill = pills[pi];
      const exact = byExactKey.get(recipeLibKey(pill));
      if (exact) return exact;
      const pt = recipeLibToks(pill);
      if (!pt.length) continue;
      const pk = recipeLibKey(pill);
      let best: { r: LetterRecipe; hit: number; slack: number; pos: number } | undefined;
      for (const l of libraryRecipes) {
        const rt = recipeLibToks(l.recipe.title);
        if (!rt.length) continue;
        const hit = rt.filter((t) => pk.includes(t)).length;
        const rk = recipeLibKey(l.recipe.title);
        const extra = pt.filter((t) => !rk.includes(t)).length;
        // (a) near-equality (≥2 title tokens hit, ≤1 missed, ≤1 extra), or
        // (b) the ENTIRE multi-token recipe title appears in the FIRST pill —
        //     a dish that is "<recipe> with <sides>" (e.g. "Besan chilla with
        //     onion + capsicum") IS that recipe plus additions. Restricted to
        //     pill 0 (the main dish) so a trailing SIDE can't hijack the photo:
        //     "Masala egg scramble … + jowar roti" must not resolve to the
        //     jowar-roti recipe just because that side's title is fully present.
        // (c) single-token title matched by a single-token dish.
        const ok =
          (hit >= 2 && rt.length - hit <= 1 && extra <= 1) ||
          (pi === 0 && hit === rt.length && rt.length >= 2) ||
          (rt.length === 1 && hit === 1 && pt.length === 1);
        // slack = how far from an exact match (unmatched recipe tokens + extra
        // dish tokens). Prefer more hits, then the CLOSEST title — so
        // "Vegetable poha" wins over "Chicken and vegetable poha".
        const slack = rt.length - hit + extra;
        // pos = where the title first appears among the dish's tokens. On an
        // otherwise-tied match, the title that starts EARLIEST wins — the head
        // dish, not a trailing medium: "Ragi-oats porridge in almond milk" →
        // Ragi porridge, not Almond Milk.
        const pos = Math.min(...rt.map((t) => { const i = pt.indexOf(t); return i < 0 ? 1e9 : i; }));
        if (
          ok &&
          (!best ||
            hit > best.hit ||
            (hit === best.hit && (slack < best.slack || (slack === best.slack && pos < best.pos))))
        )
          best = { r: l.recipe, hit, slack, pos };
      }
      if (best) return best.r;
    }
    return undefined;
  };
}

// Snack/drink category fallback. Most no-recipe menu slots are simple assemblies
// (nuts + fruit, buttermilk, herbal tea, curd) that don't warrant a unique
// recipe — but should still show a suitable real photo rather than a bare tile.
// Each maps to a representative image in public/recipe-images/categories/. Order
// is priority: the defining item (a drink, makhana, sprouts, curd) wins over a
// trailing garnish. Classified on the FIRST component first, then the whole
// dish, so "apple + almonds" reads as fruit (the lead), "almonds + apple" as
// nuts. Keep in sync with the categories/ image set + the dashboard scan.
const SNACK_CATEGORIES: [string, RegExp][] = [
  ["buttermilk", /\b(buttermilk|chaas|chhaas|lassi)\b/i],
  ["herbal-tea", /\b(ccf|tea|kadha|kashayam|infusion|tisane)\b/i],
  ["infused-water", /\b((jeera|methi|ajwain|cumin|lemon|warm|saunf|fennel|coriander)\s+water)\b/i],
  ["coconut-water", /\b(coconut water|tender coconut|nariyal pani)\b/i],
  ["sherbet", /\b(kokum|aam panna|sherbet|sharbat|panna)\b/i],
  ["protein-shake", /\b(protein|collagen|whey|smoothie|milkshake|shake)\b/i],
  ["makhana", /\b(makhana|makhane|fox.?nut|phool makhana)\b/i],
  ["sprouts", /\bsprout/i],
  ["curd-yogurt", /\b(curd|yogurt|yoghurt|dahi|raita|hung.?curd)\b/i],
  ["hummus", /\bhummus\b/i],
  ["chivda", /\b(chivda|chiwda|chidwa|namkeen|puffs?)\b/i],
  ["nuts", /\b(almonds?|walnuts?|cashews?|pistachios?|brazil|peanuts?|nuts?)\b/i],
  ["seeds", /\b((pumpkin|sunflower|water.?melon)\s+seeds?|flax|chia|sesame|\btil\b|seeds?)\b/i],
  ["dry-fruit", /\b(dates?|raisins?|anjeer|figs?|dry fruit|dried fruit|prunes?|apricots?)\b/i],
  ["fruit", /\b(apple|banana|pear|guava|papaya|orange|kiwi|berr|melon|pomegranate|amla|grapes?|chikoo|sapota|mosambi|fruit)\b/i],
  ["veg-sticks", /\b(cucumber|carrot|radish|veggie stick|crudit|salad|chaat)\b/i],
];

function categoryFor(text: string): string | null {
  for (const [cat, re] of SNACK_CATEGORIES) if (re.test(text)) return cat;
  return null;
}

/** A representative category photo for a snack/drink dish that doesn't resolve
 *  to a recipe — first component first, then the whole dish. Returns null when
 *  nothing matches (the caller then falls back to the labelled tile). Exported
 *  so the dashboard coverage scan counts category-covered dishes as covered. */
export function snackCategoryImage(dish: string): string | undefined {
  const firstPill = dish.split(/\s\+\s|→|⇒|:/)[0] ?? dish;
  const cat = categoryFor(firstPill) ?? categoryFor(dish);
  return cat ? `/recipe-images/categories/${cat}.jpg` : undefined;
}

function parseRecipes(md: string): LetterRecipe[] {
  const out: LetterRecipe[] = [];
  // Letter generations drifted on the recipe marker (✦ / ✨ / ⭐) — accept
  // all three, same as cleanDishCell does for menu cells (fix 2026-06-11:
  // Dhanishta's ⭐-era sidecars parsed to zero recipes, so her dishes had
  // no methods and the recipe-pack resource vanished).
  const parts = md.split(/^### [✦✨⭐] /m).slice(1);
  for (const part of parts) {
    const lines = part.split("\n");
    const title = lines[0].trim();
    const body = lines.slice(1).join("\n");
    const meta = body.match(/\*\*Serves:\*\*\s*([^|]+)\|\s*\*\*Time:\*\*\s*(.+)/);
    const ingredients: string[] = [];
    // Letters often split a dish into qualified groups, e.g.
    // "**Method (Eggs):**" + "**Method (Ragi Roti):**" — collect per
    // group so multi-part dishes read clearly in the overlay.
    const methodGroups: { qual: string; steps: string[] }[] = [];
    let tip: string | undefined;
    let mode: "none" | "ing" | "meth" = "none";
    for (const line of body.split("\n")) {
      const t = line.trim();
      const ingM = t.match(/^\*\*Ingredients\s*(?:\(([^)]+)\))?:?\*\*/i);
      if (ingM) { mode = "ing"; continue; }
      const methM = t.match(/^\*\*Method\s*(?:\(([^)]+)\))?:?\*\*/i);
      if (methM) {
        mode = "meth";
        methodGroups.push({ qual: methM[1]?.trim() ?? "", steps: [] });
        continue;
      }
      if (/^\*\*Tip:?\*\*/i.test(t)) { tip = t.replace(/^\*\*Tip:?\*\*\s*/i, ""); mode = "none"; continue; }
      if (t.startsWith("## ") || t.startsWith("### ")) break;
      if (mode === "ing" && t.startsWith("- ")) ingredients.push(t.slice(2).trim());
      if (mode === "meth" && /^\d+\./.test(t) && methodGroups.length) {
        methodGroups[methodGroups.length - 1].steps.push(t.replace(/^\d+\.\s*/, "").trim());
      }
    }
    const multi = methodGroups.filter((g) => g.steps.length).length > 1;
    const method = methodGroups.flatMap((g) =>
      g.steps.map((s, i) => (multi && g.qual && i === 0 ? `${g.qual}: ${s}` : s)),
    );
    // FALLBACK (2026-06-11): the ⭐-era sidecars use a looser shape — bold
    // group headers ("**For the bhakri:**"), bare bullet ingredients, and
    // METHOD AS PROSE PARAGRAPHS with no "Method:" marker or numbering.
    // When the structured pass found nothing, read that shape instead so
    // every recipe renders fully in-app.
    if (!ingredients.length && !method.length) {
      for (const rawLine of body.split("\n")) {
        const t = rawLine.trim();
        if (!t || t === "---" || t.startsWith("## ") || t.startsWith("### ")) continue;
        const groupM = t.match(/^\*\*(.+?)\*\*$/);
        if (groupM) {
          ingredients.push(`— ${groupM[1].replace(/:$/, "").trim()} —`);
          continue;
        }
        if (t.startsWith("- ") || t.startsWith("• ")) {
          ingredients.push(t.replace(/^[-•]\s*/, ""));
          continue;
        }
        // prose paragraph → one method step
        if (t.length > 30) method.push(t.replace(/\*\*/g, ""));
      }
    }
    out.push({
      title,
      serves: meta ? meta[1].trim() : undefined,
      time: meta ? meta[2].trim() : undefined,
      ingredients,
      method,
      tip,
    });
  }
  return out;
}


interface LetterRemedyBlurb {
  title: string;
  how: string;
  what: string;
}



interface LetterPhase {
  name: string;
  weekFrom: number;
  weekTo: number;
  note: string;
}



// ── remedy catalogue ─────────────────────────────────────────────────────────

/** Strip author attributions from client-facing remedy prose. The catalogue
 *  keeps them (provenance matters coach-side); the client should read
 *  tradition, not citations — "Lad's universal menstrual-pain remedy" reads
 *  as silly name-dropping in the app. */
const AUTHOR_RE = /\b(?:Dr\.?\s+)?(?:Vasant\s+)?(?:Lad|Frawley|Svoboda|Welch|O['’]Neill|Thurlow)\b/g;

function scrubAuthors(text: string): string {
  if (!text) return text;
  let s = text
    // "Lad's Agni Tea kindles…" → "Agni Tea kindles…"
    .replace(/\b(?:Dr\.?\s+)?(?:Vasant\s+)?(?:Lad|Frawley|Svoboda|Welch|O['’]Neill|Thurlow)['’]s\s+/g, "")
    // "Lad recommends / describes / identifies / lists …" and bare mentions
    .replace(AUTHOR_RE, "Ayurvedic tradition");
  // tidy double-spaces and capitalize a now-leading lowercase letter
  s = s.replace(/\s{2,}/g, " ").trim();
  if (/^[a-z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

const CAT_ICON: Record<string, string> = {
  kitchen_remedy: "bowl",
  infused_water: "water",
  ayurvedic_churan: "leaf",
  herbal_tea: "leaf",
  vegetable_juice: "droplet",
  kashayam: "droplet",
  spice_blend: "sparkle",
  other: "leaf",
};

function remedyIcon(category: string, route: string, slug: string): string {
  if (route !== "external") return CAT_ICON[category] || "leaf";
  if (/steam|inhal/.test(slug)) return "steam";
  if (/gargle|rinse|swish|wash|eyewash|nasal|drops|pulling|gum/.test(slug)) return "droplet";
  return "hand";
}

let remedyCache: AppRemedy[] | null = null;
let remedyCacheAt = 0;

let tsSaltCache: Map<string, { name: string; how: string; buyUrl: string }> | null = null;
let tsSaltCacheAt = 0;
/** slug → {client-friendly name, typical-use, buy link} for the tissue_salt
 *  catalogue. Clients order cell salts by the SHORT biochemic name (Nat Mur,
 *  Kali Mur) + number, so we surface that — "Nat Mur (No. 8)" — not the chemical
 *  name. Buy link is an Amazon India search for the SBL 6X product (specific
 *  ASINs go out of stock; a search always resolves and lets them pick a brand). */
async function loadTissueSaltMap(): Promise<Map<string, { name: string; how: string; buyUrl: string }>> {
  if (tsSaltCache && Date.now() - tsSaltCacheAt < 60_000) return tsSaltCache;
  const dir = path.join(getCataloguePath(), "tissue_salts");
  const map = new Map<string, { name: string; how: string; buyUrl: string }>();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return map;
  }
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    const d = await readYamlIfExists(path.join(dir, name));
    if (!d) continue;
    const slug = asStr(d.slug) || name.replace(/\.ya?ml$/, "");
    // aliases[0] is the short biochemic order-name ("Nat Mur", "Kali Mur").
    const aliases = Array.isArray(d.aliases) ? (d.aliases as unknown[]).map(asStr) : [];
    const abbrev = aliases[0] || asStr(d.display_name) || humanize(slug);
    const num = d.salt_number;
    const displayName = num != null && `${num}`.trim() ? `${abbrev} (No. ${num})` : abbrev;
    const buyUrl = `https://www.amazon.in/s?k=${encodeURIComponent(`SBL ${abbrev} 6X tablets`)}`;
    map.set(slug, {
      name: displayName,
      how: asStr(d.typical_use).replace(/\s+/g, " ").trim(),
      buyUrl,
    });
  }
  tsSaltCache = map;
  tsSaltCacheAt = Date.now();
  return map;
}


async function loadRemedyLibrary(): Promise<AppRemedy[]> {
  if (remedyCache && Date.now() - remedyCacheAt < 60_000) return remedyCache;
  const dir = path.join(getCataloguePath(), "home_remedies");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: AppRemedy[] = [];
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    const d = await readYamlIfExists(path.join(dir, name));
    if (!d) continue;
    const slug = asStr(d.slug) || name.replace(/\.ya?ml$/, "");
    const category = asStr(d.category) || "other";
    const route = asStr(d.route) === "external" ? "external" : "internal";
    const prep = asStr(d.preparation).trim();
    const summary = scrubAuthors(asStr(d.summary).replace(/\s+/g, " ").trim());
    const stub = !prep || /flesh out before clinical use/i.test(summary);
    const aliases = asStrArr(d.aliases);
    const prepSteps = prep
      ? prep
          .split(/\n(?=\d+[.)]\s)|(?<=\.)\s+(?=\d+[.)]\s)/)
          .flatMap((chunk) => chunk.split(/\n{2,}/))
          .map((s) => scrubAuthors(s.replace(/^\d+[.)]\s*/, "").replace(/\s+/g, " ").trim()))
          .filter(Boolean)
      : [];
    out.push({
      slug,
      name: asStr(d.display_name) || humanize(slug),
      also: aliases.slice(0, 2).map(humanize).join(" · "),
      category,
      route,
      icon: remedyIcon(category, route, slug),
      summary,
      prepSteps,
      dose: scrubAuthors(asStr(d.typical_dose).replace(/\s+/g, " ").trim()),
      duration: scrubAuthors(asStr(d.duration).replace(/\s+/g, " ").trim()),
      timing: scrubAuthors(asStr(d.timing_notes).replace(/\s+/g, " ").trim()),
      cautions: asStrArr(d.contraindications).map(scrubAuthors),
      indications: asStrArr(d.indications),
      bal: asStrArr(d.balances_dosha),
      agg: asStrArr(d.aggravates_dosha),
      virya: asStr(d.virya) || null,
      stub,
      suitableSex: (asStr(d.suitable_sex) as "any" | "female" | "male") || "any",
      suitableStages: asStrArr(d.suitable_stages),
      avoidIn: asStrArr(d.avoid_in),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  remedyCache = out;
  remedyCacheAt = Date.now();
  return out;
}

// ── nutrition tier parsing ───────────────────────────────────────────────────

/** "Eggs (2–3 daily): excellent source of …" → "Eggs (2–3 daily)".
 *  No mid-phrase truncation — pills wrap, and the "is this okay?"
 *  lookup needs every food word intact (e.g. maida inside a paren). */
function shortFoodName(item: string): string {
  let s = item.split(":")[0].trim();
  s = s.replace(/\s*[—–-]\s*\d.*$/, "").trim();
  return s;
}

// ════ Option A: structured app_menu ⇆ WeekTable conversion ════════════════

/** plan.app_menu → the loader's internal WeekTable shape. */
function appMenuToWeekTables(menu: Dict): WeekTable[] {
  const weeks = (menu.weeks as Dict[]) ?? [];
  return weeks.map((w) => {
    const days = (w.days as Dict[]) ?? [];
    // slot order = first-seen order across the week
    const slotOrder: string[] = [];
    for (const d of days)
      for (const s of (d.slots as Dict[]) ?? []) {
        const name = asStr(s.slot);
        if (name && !slotOrder.includes(name)) slotOrder.push(name);
      }
    return {
      week: Number(w.week) || 1,
      dayDates: Array.isArray(w.day_dates) ? (w.day_dates as (string | null)[]) : undefined,
      rows: slotOrder.map((slot) => ({
        slot,
        cells: Array.from({ length: 7 }, (_, di) => {
          const d = days[di];
          const hit = ((d?.slots as Dict[]) ?? []).find((s) => asStr(s.slot) === slot);
          return hit ? asStr(hit.dish) : "";
        }),
      })),
    };
  });
}




/** Soften a coach_rationale into client-facing copy (mobile audit
 *  2026-06-11: raw rationales leaked lab readouts — "LDL 130, HDL 49,
 *  Lp(a) 32", "(204 ng/dL, below range)" — and coach-speak like
 *  "mandatory correction" / "gap in prior protocol" into the app).
 *  Letter-provided why-lines are already client-voiced and skip this. */
/** Practice `details` are multi-sentence instructions (unlike the one-line
 *  supplement "why"), so this is a LIGHT scrub — strip a leading coach
 *  change-log stamp / [tag] / bare ISO date and tidy spacing, but PRESERVE the
 *  full instructional text and its line breaks (bulleted steps render on their
 *  own lines via white-space: pre-wrap). Never rephrase or truncate. */
function clientifyPracticeDetail(raw: string): string {
  let s = raw || "";
  s = s.replace(
    /^\s*(?:FORM\s+SWAP|SWAP|UPDATE|CHANGE|REVISED|NOTE)\b[^—–\n:]*?(?:[—–-]\s*|:\s*)/i,
    "",
  );
  s = s.replace(/^\s*\[[^\]]*\]\s*/g, "");
  s = s.replace(/\b20\d\d-\d\d-\d\d\b/g, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  // tidy whitespace around newlines but keep the line breaks themselves
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Cycle-timed cramp support: surface a ginger-tea prompt only on the dates
 *  that help — from ~2 days before the expected period through the first few
 *  crampy days — so the client never has to work out when to start it. Returns
 *  null outside that window (nothing shows). Pure + reuses the cycle math. */
function computePeriodCare(
  enabled: boolean,
  client: Dict,
  todayUTC: Date,
): AppPeriodCare | null {
  if (!enabled) return null;
  const cs = String(client.cycle_status ?? "").toLowerCase();
  if (cs === "postmenopausal" || cs === "not_applicable") return null;
  const lmpStr = asStr(client.last_menstrual_period);
  const lmp = lmpStr ? new Date(`${lmpStr}T00:00:00Z`) : null;
  if (!lmp || isNaN(lmp.getTime())) return null;
  const rawLen = Number(client.cycle_length_days);
  const cycleLength =
    Number.isFinite(rawLen) && rawLen >= 20 && rawLen <= 45 ? Math.round(rawLen) : 28;
  const daysSince = Math.floor((todayUTC.getTime() - lmp.getTime()) / 86_400_000);
  const dayInCycle = (((daysSince % cycleLength) + cycleLength) % cycleLength) + 1;
  const isPre = dayInCycle >= cycleLength - 2; // ~2 days before the next period
  const isDuring = dayInCycle <= 4; // the first few days (cramps peak days 2-3)
  if (!isPre && !isDuring) return null;
  const recipe =
    "Simmer a 1-inch piece of fresh ginger (sliced or lightly smashed) in 1½ cups water for 7-8 minutes, strain, and add a squeeze of lemon. Have 2-3 cups through the day. A heat pad on your lower tummy helps alongside it.";
  if (isPre) {
    const daysToPeriod = cycleLength - dayInCycle + 1;
    return {
      heading: "Your period's due soon",
      line: `About ${daysToPeriod} day${daysToPeriod === 1 ? "" : "s"} to go — start your ginger tea now to get ahead of the cramps.`,
      recipe,
    };
  }
  return {
    heading: "Ginger tea for cramps",
    line: `Day ${dayInCycle} — keep the ginger tea going while the cramps are around.`,
    recipe,
  };
}

/** Work out which seeds the client should eat TODAY from her cycle data, so
 *  she never has to count cycle days herself. Pure + unit-testable. */
function computeSeedCycling(
  enabled: boolean,
  client: Dict,
  todayUTC: Date,
): AppSeedCycling | null {
  if (!enabled) return null;
  const FOLLICULAR = ["flaxseed", "pumpkin seed"];
  const LUTEAL = ["sesame (til)", "sunflower seed"];
  const schedule = {
    follicular: "1 tbsp ground flaxseed + 1 tbsp ground pumpkin seed daily",
    luteal: "1 tbsp ground sesame (til) + 1 tbsp ground sunflower seed daily",
  };
  const cycleStatus = String(client.cycle_status ?? "").toLowerCase();
  const suppressed =
    cycleStatus === "postmenopausal" || cycleStatus === "not_applicable";
  const rawLen = Number(client.cycle_length_days);
  const cycleLength =
    Number.isFinite(rawLen) && rawLen >= 20 && rawLen <= 45 ? Math.round(rawLen) : 28;

  // DAILY mode — no ovulatory cycle to phase to → all four seeds every day.
  if (suppressed) {
    return {
      mode: "daily",
      phase: null,
      dayInCycle: null,
      cycleLength,
      lastPeriodStart: null,
      needsDate: false,
      today: {
        seeds: [...FOLLICULAR, ...LUTEAL],
        line: "All four seeds today",
        note: "Grind about 1 tbsp each of flaxseed, pumpkin, sesame and sunflower (≈2 tbsp total) into your food. Take them together every day for the nutrients.",
      },
      schedule,
    };
  }

  // PHASED mode — needs the period start date.
  const lmpStr = asStr(client.last_menstrual_period);
  const lmp = lmpStr ? new Date(`${lmpStr}T00:00:00Z`) : null;
  if (!lmp || isNaN(lmp.getTime())) {
    return {
      mode: "phased",
      phase: null,
      dayInCycle: null,
      cycleLength,
      lastPeriodStart: null,
      needsDate: true,
      today: {
        seeds: [],
        line: "Tell me when your period started",
        note: "Tap “My period started today” on the first day of your next period and I'll pick the right seeds for you each day.",
      },
      schedule,
    };
  }

  const daysSince = Math.floor((todayUTC.getTime() - lmp.getTime()) / 86_400_000);
  // 1-indexed day within the cycle, robust to a stale or future date.
  const dayInCycle = (((daysSince % cycleLength) + cycleLength) % cycleLength) + 1;
  const ovulation = Math.round(cycleLength / 2);
  const phase: "follicular" | "luteal" = dayInCycle <= ovulation ? "follicular" : "luteal";
  const seeds = phase === "follicular" ? FOLLICULAR : LUTEAL;
  const note =
    phase === "follicular"
      ? "Grind 1 tbsp flaxseed + 1 tbsp pumpkin seed into your food today (curd, a smoothie or dal). These support the first half of your cycle."
      : "Grind 1 tbsp sesame (til) + 1 tbsp sunflower seed into your food today (curd, a smoothie or dal). These support the second half of your cycle.";
  return {
    mode: "phased",
    phase,
    dayInCycle,
    cycleLength,
    lastPeriodStart: lmpStr,
    needsDate: false,
    today: {
      seeds,
      line: `${phase === "follicular" ? "Follicular half" : "Luteal half"} · day ${dayInCycle}`,
      note,
    },
    schedule,
  };
}

function clientifyWhy(raw: string): string {
  let s = raw;
  // strip leading coach change-log stamps: "FORM SWAP 2026-05-24 — …",
  // "[2026-05-24] …", "UPDATE: …" (the dated clause is the coach's audit note)
  s = s.replace(/^\s*(?:FORM\s+SWAP|SWAP|UPDATE|CHANGE|REVISED|NOTE)\b[^—–\n]*?(?:[—–-]\s*|:\s*)/i, "");
  s = s.replace(/^\s*\[[^\]]*\]\s*/g, "");
  s = s.replace(/\b20\d\d-\d\d-\d\d\b/g, "");
  // Drug-nutrient depletion clauses name the client's actual medication +
  // class — "Telma 40 (ARB) depletes magnesium", "ARB (Telma 40) depletes
  // zinc". Rephrase to a generic, client-voiced line BEFORE other scrubs so
  // the brand/class never reaches the phone (mobile audit 2026-06-13).
  if (/\bdeplet(?:e|es|ing|ion)\b/i.test(s)) {
    // capture the nutrient right after "depletes", up to the first clause
    // break ("magnesium — mandatory correction" → "magnesium")
    const m = s.match(/deplet(?:es?|ing|ion of)\s+([a-z][a-z ]*?)(?=\s*[—–,.;:-]|\s+and\b|\s*$)/i);
    const nutrient = m && m[1] ? m[1].trim().toLowerCase() : "";
    return nutrient && nutrient.length <= 30
      ? `Replaces ${nutrient} — medications can lower it over time.`
      : "Replaces a nutrient your medication can lower over time.";
  }
  // coach-only phrasing after a dash
  s = s.replace(
    /\s*[—–-]\s*(mandatory correction|non-negotiable[^.;]*|gap in (?:the )?prior protocol[^.;]*|hard rule[^.;]*)\.?/gi,
    ".",
  );
  // bare lab readouts with clinical units anywhere ("22.10 µg/dL", "4.19 g/dL")
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:µg|mcg|ng|pg|mg|nmol|pmol|mIU|µIU|IU)\s*\/\s*(?:dL|mL|L)\b/gi, "");
  // "(far) below/above FM-optimal of 50–80" comparison fragments
  s = s.replace(/\b(?:is\s+)?(?:far\s+)?(?:below|above|under|over)?\s*FM[- ]?optimal(?:\s+of)?\s*[\d.,–-]*\s*(?:ng\/mL|µg\/dL|g\/dL)?/gi, "");
  // "(above|below) the reference range (upper|lower) limit"
  s = s.replace(/\b(?:above|below)?\s*(?:the\s+)?reference range(?:\s+(?:upper|lower)\s+limit)?(?:\s+at)?/gi, "");
  // parenthetical lab readouts / conversion arrows
  s = s.replace(/\s*\([^)]*(?:\d[^)]*(?:ng|mg|nmol|pmol|mIU|mcg|µg|iu\b)[^)]*|below range|above range|→[^)]*)\)/gi, "");
  // bare "MARKER 123" readout lists
  s = s.replace(/\(?\b(?:LDL|HDL|Lp\(a\)|TSH|fT[34]|HbA1c|hsCRP|homocysteine|ferritin|B12|vitamin D)\s*[:=]?\s*\d+(?:\.\d+)?%?\)?,?/gi, "");
  // trailing "= MTHFR pattern" style equations
  s = s.replace(/\s*=\s*[A-Za-z][^.]*pattern/gi, "");
  // a readout removal can leave a dangling comparison clause
  // ("— despite normal B12/folate strongly implicates…") — drop it
  s = s.replace(/\s*[—–-]\s*despite[^.]*\.?/gi, ".");
  // tidy what the removals left behind
  s = s
    .replace(/\s*,\s*([,.])/g, "$1")
    .replace(/,\s*\./g, ".")
    .replace(/:\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/[,:]\s*$/g, "")
    .trim();
  // Final guard: coach_rationale is clinical/coach-facing. If softening left
  // anything that still reads like a lab report or coach note — a specific
  // result, a marker + verdict, a reference-range / FM-optimal comparison, a
  // named drug class, or an antibody — drop the why entirely. A supplement
  // card with no rationale is strictly safer than one leaking the client's
  // labs or medications (mobile audit 2026-06-13).
  const CLINICAL_LEAK = new RegExp(
    [
      String.raw`\d(?:\.\d+)?\s*(?:µg|mcg|ng|pg|mg|nmol|pmol|mIU|µIU|IU)\s*\/\s*(?:dL|mL|L)`,
      String.raw`\breference range\b`,
      String.raw`\bFM[- ]?optimal\b`,
      String.raw`\b(?:elevated|low|high|normal|deficient|insufficient|sub-?optimal)\s+(?:serum\s+)?(?:homocysteine|folate|ferritin|cortisol|tsh|ft[34]|b12|albumin|vitamin\s*d|hs-?crp)\b`,
      String.raw`\b(?:homocysteine|ferritin|tsh|ft[34]|hs-?crp|hba1c|albumin|cortisol)\b[^.]*\d`,
      String.raw`=\s*(?:insufficient|deficient|elevated|sub-?optimal|low|high)\b`,
      String.raw`\b(?:anti-?TPO|TPO antibod|antibod(?:y|ies)|deiodinase|Lp\(a\))\b`,
      String.raw`\b(?:ARB|ACE[- ]?inhibitors?|beta[- ]?blockers?|PPIs?|statins?|SSRIs?|SNRIs?)\b`,
      String.raw`\b(?:client reported|FORM SWAP|prior protocol|coach note|per coach)\b`,
    ].join("|"),
    "i",
  );
  if (CLINICAL_LEAK.test(s)) return "";
  return s;
}

// ── main loader ──────────────────────────────────────────────────────────────

/** Find the highest-versioned published plan for a given client. */
/** Order two published plans for the same client so the CURRENT phase wins:
 *  newest publish event, then latest plan_period_start, then highest version.
 *  Guards against a superseded plan lingering in the published bucket — e.g. a
 *  Mutagen delete that didn't propagate to the Fly replica stranded cl-005 on
 *  an old plan whose recheck window was open, so the app showed "finish line"
 *  for a plan the coach had already replaced (2026-07-02). Picking by version
 *  alone kept the alphabetically-first file on a tie. */
function isNewerPublishedPlan(a: Dict, b: Dict): boolean {
  const pa = extractPublishedAt(a) || "";
  const pb = extractPublishedAt(b) || "";
  if (pa !== pb) return pa > pb;
  const sa = asYmd(a.plan_period_start) || "";
  const sb = asYmd(b.plan_period_start) || "";
  if (sa !== sb) return sa > sb;
  const va = typeof a.version === "number" ? a.version : 0;
  const vb = typeof b.version === "number" ? b.version : 0;
  return va > vb;
}

async function latestPublishedPlanForClient(
  clientId: string,
): Promise<{ plan: Dict } | null> {
  const dir = path.join(getPlansRoot(), "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  let best: Dict | null = null;
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    const d = await readYamlIfExists(path.join(dir, name));
    if (!d || d.client_id !== clientId) continue;
    if (!best || isNewerPublishedPlan(d, best)) best = d;
  }
  return best ? { plan: best } : null;
}

/**
 * Resolve a stable client-level app_token → { plan, clientId }.
 * Scans clients/<id>/client.yaml for app_token === token.
 */
async function resolveClientAppToken(
  token: string,
): Promise<{ plan: Dict; clientId: string } | null> {
  const clientsDir = path.join(getPlansRoot(), "clients");
  let subdirs: string[];
  try {
    subdirs = await fs.readdir(clientsDir);
  } catch {
    return null;
  }
  for (const id of subdirs) {
    const yml = path.join(clientsDir, id, "client.yaml");
    const d = await readYamlIfExists(yml);
    if (!d || d.app_token !== token) continue;
    const found = await latestPublishedPlanForClient(id);
    if (!found) return null;
    return { plan: found.plan, clientId: id };
  }
  return null;
}

/** Extract the ISO timestamp of the most recent content change the client
 *  should be told about — the later of the publish event and any post-publish
 *  in-place edit (e.g. the coach's quick remedy toggle stamps
 *  `app_content_updated_at`). Drives the "Plan updated" banner. */
function extractPublishedAt(plan: Dict): string | null {
  const history = Array.isArray(plan.status_history) ? plan.status_history : [];
  let latest: string | null = null;
  for (const ev of history as Dict[]) {
    const state = asStr(ev.to ?? ev.state ?? "");
    if (state !== "published") continue;
    const at = asStr(ev.at ?? ev.timestamp ?? "");
    if (!at) continue;
    if (!latest || at > latest) latest = at;
  }
  // Post-publish in-place edits (remedy toggle) advance this past the publish.
  const contentAt = asStr(plan.app_content_updated_at);
  if (contentAt && (!latest || contentAt > latest)) latest = contentAt;
  // Fall back to plan updated_at
  if (!latest && typeof plan.updated_at === "string") latest = plan.updated_at;
  return latest;
}

async function loadPublishedPlan(slugOrToken: { token: string }): Promise<{ plan: Dict; file: string } | null> {
  const dir = path.join(getPlansRoot(), "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    const d = await readYamlIfExists(path.join(dir, name));
    if (!d) continue;
    if (d.letter_token === slugOrToken.token) return { plan: d, file: name };
  }
  return null;
}

const DOSHA_LABEL: Record<string, string> = { vata: "Vata", pitta: "Pitta", kapha: "Kapha" };

// Lab-test catalogue loader (self-contained — mirrors loadLabTestsCatalogueAction
// but stays inside this server-only module rather than importing the action).
let _labCatCache: CatalogueLabRange[] | null = null;
async function loadLabCatalogue(): Promise<CatalogueLabRange[]> {
  if (_labCatCache) return _labCatCache;
  const dir = path.join(getCataloguePath(), "lab_tests");
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".yaml"));
  } catch {
    return [];
  }
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null;
  const out: CatalogueLabRange[] = [];
  for (const f of files) {
    try {
      const t = (yaml.load(await fs.readFile(path.join(dir, f), "utf8")) as Dict) ?? {};
      const keys = new Set<string>();
      const add = (s: unknown) => {
        if (typeof s === "string" && s.trim()) keys.add(s.trim().toLowerCase());
      };
      add(t.slug);
      add(t.display_name);
      add(t.full_name);
      for (const a of asArr(t.aliases)) add(a);
      out.push({
        slug: asStr(t.slug),
        display_name: asStr(t.display_name) || asStr(t.slug),
        full_name: asStr(t.full_name) || undefined,
        units: asStr(t.units) || undefined,
        conventional_low: numOrNull(t.conventional_low),
        conventional_high: numOrNull(t.conventional_high),
        fm_optimal_low: numOrNull(t.fm_optimal_low),
        fm_optimal_high: numOrNull(t.fm_optimal_high),
        interpretation_low: asStr(t.interpretation_low) || undefined,
        interpretation_high: asStr(t.interpretation_high) || undefined,
        client_visible: t.client_visible !== false,
        match_keys: Array.from(keys).filter(Boolean),
      });
    } catch {
      /* skip a malformed lab_test file */
    }
  }
  _labCatCache = out;
  return out;
}

/** Scan clients/<id>/client.yaml for app_token === token, returning the client
 *  dict REGARDLESS of whether a plan exists. resolveClientAppToken() returns
 *  null for a plan-less client; this is the consult-tier (discovery) path's
 *  resolver. Mirrors resolveClientAppToken's scan exactly. */
async function resolveDiscoveryClientByToken(
  token: string,
): Promise<{ client: Dict; clientId: string } | null> {
  const clientsDir = path.join(getPlansRoot(), "clients");
  let subdirs: string[];
  try {
    subdirs = await fs.readdir(clientsDir);
  } catch {
    return null;
  }
  for (const id of subdirs) {
    const d = await readYamlIfExists(path.join(clientsDir, id, "client.yaml"));
    if (!d || d.app_token !== token) continue;
    return { client: d, clientId: id };
  }
  return null;
}

/** Today in the given timezone as YYYY-MM-DD (en-CA formats that way) — for
 *  the credit-window / endgame resolvers, which compare day strings. */
function tzTodayYmd(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

/** Coerce a YAML date field to YYYY-MM-DD. js-yaml auto-parses an unquoted
 *  `2026-06-25` into a JS Date (YAML 1.1 timestamp), so asStr() would drop it —
 *  handle both the Date and string forms. Returns "" when unusable. */
function asYmd(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : "";
  }
  return "";
}

/** Parse the coach-authored `discovery_summary` block off client.yaml into the
 *  Starting Map view-model. Every section is optional; empties render as
 *  graceful placeholders in the Summary screen. */
function parseDiscoverySummary(client: Dict, firstName: string): DiscoverySummary {
  const raw = (client.discovery_summary as Dict) ?? {};
  const points = (v: unknown): { title: string; note: string }[] =>
    asArr(v)
      .map((it) => {
        const o = (it ?? {}) as Dict;
        return { title: asStr(o.title).trim(), note: asStr(o.note).trim() };
      })
      .filter((p) => p.title || p.note);
  return {
    headline: asStr(raw.headline).trim() || `Here's your starting map, ${firstName}`,
    hypotheses: points(raw.hypotheses),
    foundationalChanges: points(raw.foundational_changes),
    journeyPreview: asStrArr(raw.journey_preview),
  };
}

/**
 * Build the consult-tier ("discovery") app payload — a client with an app_token
 * but NO published plan. Read-only: Lab Vault (discovery mode) + the Starting Map
 * summary; every plan-derived field is empty, and the app shell locks
 * Plan/Progress. Returns null when the client is actually package-tier (signed
 * up) so the caller falls through to the same null it would have returned.
 */
async function buildDiscoveryAppData(
  client: Dict,
  clientId: string,
  token: string,
  tz: string,
): Promise<ClientAppData | null> {
  // A signed_up client (enrol→build gap) is NOT discovery even with no plan yet
  // — leave them on the existing null path (status quo: OchreAppError).
  const tierRes = resolveAppTier(
    {
      engagementStatus: asStr(client.engagement_status) || null,
      hasPublishedPlan: false,
      discoveryCallDate: asYmd(client.discovery_call_date) || null,
    },
    tzTodayYmd(tz),
  );
  if (tierRes.tier !== "discovery") return null;

  const displayName = asStr(client.display_name) || clientId;
  const firstName = displayName.split(/\s+/)[0] || displayName;
  const initials =
    displayName
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "·";
  const sex: "M" | "F" | "" = asStr(client.sex).toUpperCase().startsWith("M")
    ? "M"
    : asStr(client.sex).toUpperCase().startsWith("F")
      ? "F"
      : "";

  // Lab Vault in DISCOVERY mode — pins out-of-optimal markers ("worth exploring
  // together"). No plan, so no plan-targeted markers.
  const labCatalogue = await loadLabCatalogue();
  const concernTerms = [
    ...asStrArr(client.active_conditions),
    ...asStrArr(client.goals),
    ...asStrArr(client.medical_history),
  ];
  // Normalise hand-authored snapshots: js-yaml turns an unquoted `date:
  // 2026-06-20` into a Date and `value: 34` into a number — coerce both to
  // strings so the Lab Vault (and its renderer) never sees a non-string.
  const snaps: LabSnapshot[] = (asArr(client.health_snapshots) as Dict[]).map((s) => ({
    date: asYmd(s.date) || asStr(s.date),
    source: asStr(s.source) || undefined,
    lab_values: (asArr(s.lab_values) as Dict[]).map((lv) => ({
      test_name: asStr(lv.test_name),
      value: typeof lv.value === "string" ? lv.value : String(lv.value ?? ""),
      unit: asStr(lv.unit) || undefined,
    })),
  })) as unknown as LabSnapshot[];
  const labVault = buildLabVault(
    snaps,
    labCatalogue,
    (client.lab_reference_ranges as LabReferenceRanges | undefined) ?? {},
    { mode: "discovery", targetedMarkers: [], concernTerms },
  );
  // Redact our_cost_inr — never expose the coach's wholesale cost to the client.
  const discoveryLabOrders = await projectClientLabOrders(clientId);

  // today (client tz) — only the chrome reads this; weekStrip is empty in discovery.
  const now = new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    now.toLocaleDateString("en-GB", { ...o, timeZone: tz });
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dowName = fmt({ weekday: "long" });

  // Onboarding stage — recommendations + countdown gate on `post_call` (coach
  // rule 2026-06-25: no recommendations until the labs are in and the discovery
  // call is done). The app renders an onboarding flow for every pre-call stage.
  const intakeSubmitted = !!asStr(client.intake_submitted_at).trim();
  const hasRecommendedOrder = discoveryLabOrders.some((o) => o.status === "recommended");
  const hasActiveOrder = discoveryLabOrders.some(
    (o) => o.status === "paid" || o.status === "booked" || o.status === "sample_collected",
  );
  const hasResults =
    snaps.length > 0 || discoveryLabOrders.some((o) => o.status === "results_in");
  const callDone = !!asYmd(client.discovery_call_date);
  const discoveryStage = resolveDiscoveryStage({
    intakeSubmitted,
    hasRecommendedOrder,
    hasActiveOrder,
    hasResults,
    callDone,
  });
  // One app link, intake inside: surface the intake form URL until it's
  // submitted. Token lives on client.yaml#intake_token (issued at share time).
  const intakeTok = asStr(client.intake_token).trim();
  const intakeUrl = !intakeSubmitted && intakeTok ? `/intake/${intakeTok}` : null;

  return {
    clientId,
    planSlug: "",
    token,
    timezone: tz,
    tier: "discovery",
    discoveryCredit: tierRes.credit,
    discoverySummary: parseDiscoverySummary(client, firstName),
    discoveryStage,
    intakeUrl,
    mode: "ACTIVE",
    endgame: null,
    labOrders: discoveryLabOrders,
    client: {
      firstName,
      program: "Discovery consult",
      week: 0,
      totalWeeks: 0,
      startDateLabel: "",
      notStarted: false,
      startsInDays: 0,
      dosha: [],
      doshaLabel: "",
      coachLine: "",
    },
    coach: {
      name: "Shivani",
      role: "Functional medicine coach",
      initials: "SH",
      whatsappNumber: "918976563971",
      whatsappPrefill: `Hi Shivani, a question after my discovery call —`,
      nextSession: null,
    },
    today: { dow: dowName, dateLabel: fmt({ day: "numeric", month: "long" }), idx: Math.max(0, DOW.indexOf(dowName)) },
    weekStrip: [],
    meals: [],
    weekMenus: [],
    menuIsSample: false,
    recipePack: [],
    grocery: null,
    swapGroups: [],
    msqEntries: [],
    travel: null,
    mealExtra: {},
    supplements: [],
    upcomingSupplements: [],
    allSupplements: [],
    slotOrder: ["Morning", "With meals", "Bedtime"],
    practices: [],
    seedCycling: null,
    periodCare: null,
    breathwork: null,
    eft: null,
    sleep: null,
    mindBody: null,
    principles: [],
    labs: [],
    labVault,
    journey: [],
    faq: [],
    symptomScore: null,
    watchList: [],
    labCheckpoints: { note: "", list: [] },
    movementGoalMins: 180,
    remedies: [],
    remedyLib: [],
    remedyShelf: [],
    tissueSalts: null,
    coachPicks: [],
    planRef: {
      pattern: "",
      authoredBy: "Shivani",
      forNote: "",
      phase: { currentIdx: 0, list: [] },
      plate: [],
      accents: [],
      oils: { use: [], avoid: [], note: "" },
      foods: { eat: [], sometimes: [], avoid: [] },
      avoidWhy: "",
      cooking: [],
      focus: { why: "", conditions: [] },
      ayurveda: null,
      flags: [],
    },
    mealsNote: "",
    lessons: [],
    resources: [],
    aiSuggested: [],
    account: {
      name: displayName,
      contact: asStr(client.mobile_number) || asStr(client.email),
      plan: "Discovery consult",
      member: "",
      avatar: initials,
      photoUrl: null,
      collectionAddress: resolveCollectionAddress(client).address,
      collectionPincode: resolveCollectionAddress(client).pincode,
    },
    body: {
      heightCm: null,
      ageYears: null,
      sex,
      latest: { weightKg: null, waistCm: null, hipCm: null, bpSystolic: null, bpDiastolic: null, measuredOn: null },
      history: [],
    },
    reminders: [],
    weightLoss: null,
    planUpdatedAt: null,
    clientUpdateNote: null,
  };
}

export async function loadClientAppData(
  token: string,
  opts?: { deviceTz?: string | null },
): Promise<ClientAppData | null> {
  if (!token || token.length < 16) return null;

  // 1. Try stable client-level app_token (survives plan superseding)
  let plan: Dict;
  let clientId: string;
  const clientMatch = await resolveClientAppToken(token);
  if (clientMatch) {
    plan = clientMatch.plan;
    clientId = clientMatch.clientId;
  } else {
    // 2. Fall back to per-plan letter_token (backward compat for old shared links)
    const found = await loadPublishedPlan({ token });
    if (!found) {
      // 3. Consult tier: an app_token with NO published plan → the read-only
      //    "discovery" app. Additive — only reached where we'd have returned
      //    null, so every package client is byte-for-byte unaffected.
      const disc = await resolveDiscoveryClientByToken(token);
      if (disc) {
        const discoveryData = await buildDiscoveryAppData(
          disc.client,
          disc.clientId,
          token,
          resolveAppTz(disc.client, opts?.deviceTz),
        );
        if (discoveryData) return discoveryData;
      }
      return null;
    }
    plan = found.plan;
    clientId = asStr(plan.client_id);
  }

  const planSlug = asStr(plan.slug);
  if (!clientId || !planSlug) return null;

  const clientDir = path.join(getPlansRoot(), "clients", clientId);
  const client = (await readYamlIfExists(path.join(clientDir, "client.yaml"))) ?? {};
  const appTz = resolveAppTz(client, opts?.deviceTz);

  // Non-India client → every buy link must ship to their country. Restricts
  // supplement/remedy link resolution to international retailers (iHerb) and
  // swaps the India search fallbacks for iHerb keyword searches. Empty
  // country = India default (US_CLIENT_AFFILIATE_SYSTEM.md).
  const international = isInternationalClient(client.country);

  // Travel/illness pause inputs (coach 2026-07-05). week_overrides lives under
  // weight_loss (the panel is generic — non-weight-loss clients still get travel
  // rows there). Genuine travel/illness freezes the week counter + extends the
  // recheck; weight-loss clients also get the post-travel weigh-in buffer.
  const wlForTravel = client.weight_loss as
    | { enabled?: boolean; week_overrides?: TravelOverrideLike[] }
    | undefined;
  const travelOverrides = wlForTravel?.week_overrides ?? undefined;
  const weightLossEnabled = wlForTravel?.enabled === true;

  // ---- letters: the issued letters ARE the content contract ---------------
  // Base letter = `<slug>.md` (consolidated) or `<slug>-meal_plan.md`.
  // Meals come from the PHASE letter covering the current week when one has
  // been issued (`<slug>-meal_plan-wkA-B.md`) — exactly what the client was
  // sent for this fortnight. Recipes merge the base letter's appendix with
  // every `-recipes.md` sidecar (the post-reformat home of recipe packs).
  const mealPlansDir = path.join(clientDir, "meal-plans");
  let allLetterFiles: string[] = [];
  try {
    allLetterFiles = await fs.readdir(mealPlansDir);
  } catch {
    /* no letters dir */
  }
  // LETTERS RETIRED (2026-07-04): the plan YAML + the recipe library ARE the
  // content contract. The only file still read from meal-plans/ is the
  // `-recipes.md` sidecar — the ACTIVE weekly recipe pipeline's output
  // (generate-week-recipes.py via recipes.ts), coach-managed plan content,
  // not a client letter. Everything the worded letters used to personalise
  // (supplement why/dose/buy, menus, phases, food tiers, coach note) now
  // renders from the plan's own fields — the same fallback path every
  // never-sent client already exercised.
  const recipeFiles = new Set<string>();
  for (const n of allLetterFiles) {
    if (n.endsWith("-recipes.md") && n.startsWith(planSlug)) recipeFiles.add(n);
  }
  let recipesMd = "";
  for (const n of recipeFiles) {
    recipesMd += "\n\n" + ((await readIfExists(path.join(mealPlansDir, n))) ?? "");
  }

  const recipes = parseRecipes(recipesMd);
  // Structured library = plan-side recipe source (no recipes letter needed).
  // Letter recipes stay the personalised first choice; the library fills
  // gaps via a STRICT name match (the letter pack was authored for these
  // exact dishes so loose matching is safe there — the library is 124
  // unrelated recipes, so a loose match would attach wrong methods).
  const libraryRecipesAll = await loadLibraryRecipes();
  // ── DIETARY SAFETY ────────────────────────────────────────────────────────
  // A client must NEVER be shown a recipe outside their diet (the bug: an
  // eggetarian saw "Chicken and vegetable poha" under "Vegetable poha"). Filter
  // the WHOLE library to what this client can eat BEFORE any matching, recipe
  // pack, or calorie pricing — one gate, applied everywhere downstream.
  const dietPrefForRecipes = asStr(client.dietary_preference).toLowerCase();
  const MEAT_RE = /\b(chicken|mutton|lamb|beef|pork|fish|prawn|shrimp|crab|seafood|\bmeat\b|keema|kheema|bacon|ham\b|turkey|egg whites?\b)\b/i;
  const EGG_RE = /\begg(s|y)?\b|omelette|omelet|bhurji|shakshuka|frittata/i;
  const JAIN_RE = /\b(onion|garlic|potato|aloo|ginger.?garlic|beetroot|radish|mooli|sweet potato|\byam\b|arbi|colocasia|shallot|spring onion|leek)\b/i;
  // client tolerance: 0 vegan · 1 vegetarian · 2 eggetarian · 3 omnivore
  const clientDietLevel = /vegan/.test(dietPrefForRecipes)
    ? 0
    : /egg/.test(dietPrefForRecipes) && !/no.?egg|egg.?free/.test(dietPrefForRecipes)
      ? 2
      : /non.?veg|pescat|fish|chicken|\bmeat\b|omnivore/.test(dietPrefForRecipes)
        ? 3
        : /vegetarian|jain|\bveg\b/.test(dietPrefForRecipes)
          ? 1
          : 3; // no/unknown preference → assume omnivore (don't over-filter)
  const clientIsJain = /jain/.test(dietPrefForRecipes);
  const recipeDietLevel = (r: LetterRecipe): number => {
    const d = (r.diet ?? []).map((x) => x.toLowerCase());
    const text = `${r.title} ${(r.mains ?? []).join(" ")} ${(r.ingredients ?? []).join(" ")}`;
    if (d.some((x) => /non.?veg/.test(x)) || MEAT_RE.test(text)) return 3;
    if (d.includes("eggetarian") || EGG_RE.test(text)) return 2;
    if (d.includes("vegan")) return 0;
    return 1; // vegetarian default
  };
  const recipeAllowed = (r: LetterRecipe): boolean => {
    if (recipeDietLevel(r) > clientDietLevel) return false;
    if (clientIsJain) {
      const jt = `${r.title} ${(r.mains ?? []).join(" ")}`;
      const negated = /no.?onion|no.?garlic|without (onion|garlic)|onion.?free|garlic.?free/i.test(jt);
      if (JAIN_RE.test(jt) && !negated) return false;
    }
    return true;
  };
  const libraryRecipes = libraryRecipesAll.filter((l) => recipeAllowed(l.recipe));
  // recipe-name → accurate kcal/serving (drives per-meal calories + swap maths)
  const recipeKcalLookup = buildRecipeKcalLookup(
    libraryRecipes.map((l) => ({ title: l.recipe.title, kcalPerServing: l.recipe.kcalPerServing })),
  );
  const dishKcal = (dish: string): number | undefined => {
    const k = estimateDishKcal(dish, recipeKcalLookup);
    return k > 0 ? k : undefined;
  };
  const pinnedSlugs = new Set(
    (asArr((plan.nutrition as Dict | undefined)?.recipes) as unknown[]).map((s) => String(s)),
  );
  // Dish → library-recipe resolver (exact-identity first, fuzzy fallback).
  // Built from the diet-filtered library so a client never resolves a dish to
  // an out-of-diet recipe. Shared with the dashboard menu-image coverage scan
  // via buildLibraryRecipeResolver — one source of truth, no drift.
  const libraryRecipeFor = buildLibraryRecipeResolver(libraryRecipes);
  // Letter-derived personalisation layers are gone; the payload keeps their
  // (empty) shapes so no app screen changes contract.
  const watchList: { name: string; note: string }[] = [];

  // ---- dates / week math (12-week clock anchored on meal_plan_started_on) --
  // Single source of truth (plan-timing.ts) so the client's week counter and
  // the coach's retest dates can't drift: meal_plan_started_on when confirmed,
  // else plan_period_start + the 3-day adoption lag (same floor the dashboard
  // recheck uses). The notStarted/hold gate below is independent and still
  // keys on meal_plan_started_on directly.
  const startStr = effectiveMealPlanStart({
    meal_plan_started_on: plan.meal_plan_started_on as string | Date | null | undefined,
    plan_period_start: plan.plan_period_start as string | Date | undefined,
  });
  const startDate = startStr ? new Date(`${startStr}T00:00:00Z`) : null;
  const now = tzNow(appTz);
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // "Effective today" for plan CONTENT (which day's menu, week number, the
  // header date + week strip). Before the start date we clamp FORWARD to the
  // start date, so the app renders the Day-1 view frozen — exactly as it will
  // look on the start morning — and then advances with the real date once the
  // plan begins. The notStarted / startsInDays flags further below still use
  // the REAL todayUTC so the "starts on" banner is accurate.
  const refUTC =
    startDate && todayUTC.getTime() < startDate.getTime() ? startDate : todayUTC;
  // Journey length — read from the plan (12-week default, but some plans run
  // 16). Drives the week counter, progress arc, lab checkpoints, the coach
  // line, and the "X-week reset" labels. Day 1 is immutable once set.
  const pw = Number(plan.plan_period_weeks);
  const totalWeeks = Number.isFinite(pw) && pw >= 1 && pw <= 52 ? Math.round(pw) : 12;
  let week = 1;
  if (startDate) {
    const days = Math.floor((refUTC.getTime() - startDate.getTime()) / 86_400_000);
    // Travel/illness freezes the counter: subtract paused days already elapsed
    // (start → today, capped 14) so she doesn't tick through her trip — she
    // resumes at the same week on return. Mirrors the recheck extension.
    const paused = travelExtensionDays(
      travelOverrides,
      startDate.toISOString().slice(0, 10),
      refUTC.toISOString().slice(0, 10),
    );
    week = Math.min(Math.max(Math.floor((days - paused) / 7) + 1, 1), totalWeeks);
  }

  // week strip: Sunday-start calendar week around today
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayDow = refUTC.getUTCDay();
  const weekStrip = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(refUTC.getTime() + (i - todayDow) * 86_400_000);
    return { dow: dows[d.getUTCDay()], num: d.getUTCDate(), today: i === todayDow };
  });

  // ---- meals for today ------------------------------------------------------
  // Source: the phase letter covering the current week (what the client was
  // actually sent for this fortnight), falling back to the base letter.
  // ---- coach app-overrides (read once; used for remedies further down).
  // Written by the "What the client sees" panel. The legacy meal_overrides
  // patch layer died with letter-parsed menus — plan.app_menu carries every
  // coach edit directly now. -------------------------------------------------
  let appOverrides: {
    hidden_remedies?: string[];
    approved_suggestions?: string[];
  } = {};
  try {
    const ovRaw = await readIfExists(path.join(clientDir, "app-overrides.yaml"));
    if (ovRaw) appOverrides = (yaml.load(ovRaw) as typeof appOverrides) ?? {};
  } catch {
    /* none yet */
  }

  // ════ plan.app_menu is THE (only) menu source ════ Letters retired; a
  // plan without app_menu renders the principle-based framework instead.
  const planMenuRaw = plan.app_menu as Dict | undefined;
  const weekTables: WeekTable[] =
    planMenuRaw && Array.isArray(planMenuRaw.weeks) && (planMenuRaw.weeks as Dict[]).length
      ? appMenuToWeekTables(planMenuRaw)
      : [];

  const mealLetterFoods: LetterFoods | null = null;
  const sampleWeekNote = "";

  // Pick today's column: REAL DATE match first (format-B tables carry dates
  // per day, e.g. "Mon 8 Jun"); otherwise weekday within the rotation week.
  const todayLabel = `${refUTC.getUTCDate()} ${refUTC.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
  let table = undefined as WeekTable | undefined;
  let colIdx = (todayDow + 6) % 7; // table columns are Mon..Sun
  for (const t of weekTables) {
    const di = (t.dayDates ?? []).findIndex((d) => d && d.toLowerCase() === todayLabel.toLowerCase());
    if (di >= 0) {
      table = t;
      colIdx = di;
      break;
    }
  }
  // Weekly cadence (2026-06-12): approved weeks carry ABSOLUTE week numbers
  // — prefer the table for the client's actual plan week before falling
  // back to the legacy fortnight rotation.
  if (!table) table = weekTables.find((t) => t.week === week);
  if (!table) {
    const rotationWeek = weekTables.length >= 2 ? ((week - 1) % weekTables.length) + 1 : weekTables[0]?.week ?? 1;
    table = weekTables.find((t) => t.week === rotationWeek) ?? weekTables[weekTables.length - 1];
  }
  const SLOT_GLYPH: Record<string, string> = {
    "on waking": "sun",
    breakfast: "sun",
    "mid-morning": "leaf",
    lunch: "bowl",
    snack: "leaf",
    "evening snack": "leaf",
    dinner: "moon",
  };
  const mealTiming = asStr((plan.nutrition as Dict | undefined)?.meal_timing);
  const slotTime = (slot: string): string => {
    const s = slot.toLowerCase();
    if (s.includes("breakfast")) return "Within an hour of waking";
    if (s.includes("mid")) return "After breakfast — never on an empty stomach";
    if (s.includes("lunch")) return "Midday — protein + fibre on the plate";
    if (s.includes("evening") || s.includes("snack")) return "Late afternoon, if genuinely hungry";
    if (s.includes("dinner")) return "Finish by 7–8 pm";
    return "";
  };
  const slotNote = (slot: string): string | undefined => {
    const s = slot.toLowerCase();
    if (s.includes("breakfast") && /breakfast within/i.test(mealTiming))
      return "Eat breakfast within an hour of waking — it anchors your blood sugar and cortisol rhythm for the whole day.";
    if (s.includes("dinner") && /bedtime|overnight fast|dinner by/i.test(mealTiming))
      return "Keep dinner light and early — aim to finish by 7–8 pm so your body gets its 12-hour overnight rest.";
    return undefined;
  };
  const meals: AppMeal[] = [];
  const mealExtra: Record<string, AppMealExtra> = {};
  const SLOT_GRAD: Record<string, string> = {
    breakfast: "linear-gradient(140deg,#edcf93 0%,#d8a257 60%,#bf872f 100%)",
    "mid-morning": "linear-gradient(140deg,#e3cf9a 0%,#c3b06f 60%,#9a8a4f 100%)",
    lunch: "linear-gradient(140deg,#cdbf86 0%,#9aa05c 55%,#6f8350 100%)",
    "evening snack": "linear-gradient(140deg,#e8dcc0 0%,#cdbf86 60%,#a89a63 100%)",
    dinner: "linear-gradient(140deg,#c9a98a 0%,#9a7e63 55%,#6f5a44 100%)",
  };
  // A dish only gets a recipe it actually NAMES: (almost) every meaningful
  // token of the recipe TITLE must appear in the dish. The old any-shared-token
  // rule served "Sautéed Methi Greens" for "Methi water" (Geetika, 2026-07-07)
  // — no recipe (→ category card) beats a wrong recipe on a client's phone.
  // Tokens ≥3 chars so "dal"/"egg" still count ("Chana Dal" must not shrink to
  // just "chana"); long titles tolerate floor(n/3) missing tokens so decorated
  // names ("Spiced Buttermilk / Chaas") still match their dish. Ranked by
  // hits−misses, then fewer misses — so "Steamed Fish" beats "Grilled Rohu or
  // Surmai Fish" for a steamed-fish dish.
  const LETTER_TITLE_STOP = new Set(["with", "and", "the", "for", "style"]);
  const recipeFor = (dish: string): LetterRecipe | undefined => {
    const dk = suppKey(dish);
    let best: { r: LetterRecipe; score: number; misses: number } | undefined;
    for (const r of recipes) {
      const rk = suppKey(r.title);
      if (rk === dk) return r; // exact name — always wins
      const rToks = rk.split(" ").filter((t) => t.length >= 3 && !LETTER_TITLE_STOP.has(t));
      if (!rToks.length) continue;
      const misses = rToks.filter((t) => !dk.includes(t)).length;
      if (misses > (rToks.length >= 3 ? Math.floor(rToks.length / 3) : 0)) continue;
      const score = rToks.length - 2 * misses; // hits − misses
      if (!best || score > best.score || (score === best.score && misses < best.misses))
        best = { r, score, misses };
    }
    // letter recipes (personalised) win; the structured library fills gaps
    return best?.r ?? libraryRecipeFor(dish);
  };
  if (table) {
    for (const row of table.rows) {
      const slotL = row.slot.toLowerCase();
      if (slotL.includes("bedtime")) continue; // bedtime drinks are remedies, folded in separately
      const cell = row.cells[colIdx] ?? row.cells[0] ?? "";
      if (!cell) continue;
      const pills = cell.split(/\s\+\s/).map((p) => p.trim()).filter(Boolean);
      // strip header qualifiers like "Breakfast (≥25 g protein)" for the label
      const slotName = row.slot.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const slotKey = slotName.toLowerCase();
      meals.push({
        slot: slotName,
        timeHint: slotKey.includes("waking") ? "First thing, before tea" : slotTime(slotL),
        glyph:
          SLOT_GLYPH[slotKey] ??
          (slotKey.includes("waking") || slotKey.includes("breakfast")
            ? "sun"
            : slotKey.includes("dinner")
              ? "moon"
              : slotKey.includes("snack") || slotKey.includes("mid")
                ? "leaf"
                : "bowl"),
        pills,
        components: splitDishComponents(cell),
        note: slotNote(slotL),
        kcal: dishKcal(cell),
        ayurveda: pills.some((p) => AYURVEDIC_DISH_RE.test(p)),
      });
      const rec = recipeFor(pills[0] ?? cell);
      const swaps: { name: string; note: string; kcal?: number }[] = [];
      const seen = new Set<string>([cell]);
      // coach-approved swaps = the other dishes this plan serves in the SAME slot
      for (const wt of weekTables) {
        const r2 = wt.rows.find((r) => r.slot.toLowerCase() === slotL);
        if (!r2) continue;
        for (const c of r2.cells) {
          if (!c || seen.has(c) || swaps.length >= 3) continue;
          seen.add(c);
          swaps.push({ name: c, note: `On your plan — week ${wt.week} rotation`, kcal: dishKcal(c) });
        }
      }
      mealExtra[slotName] = {
        grad: SLOT_GRAD[slotL] ?? "linear-gradient(140deg,#e3cf9a,#9a8a4f)",
        // Letter recipes (personalised) win the method match but carry no
        // photo — fall back to the library recipe's image so the thumbnail
        // shows a picture instead of the gradient (mirrors the recipe-card
        // fix below; fixes "all the food pictures disappeared" 2026-06-15).
        imageUrl: rec?.imageUrl ?? libraryRecipeFor(pills[0] ?? cell)?.imageUrl ?? snackCategoryImage(cell),
        mins: rec?.time,
        serves: rec?.serves,
        ingredients: rec?.ingredients ?? [],
        recipe: rec?.method ?? [],
        swaps,
      };
    }
  }

  // ---- full-week menus + grocery list ---------------------------------------
  // The week×slot×day matrix is already parsed (weekTables) — expose it so
  // the app can show the whole week for grocery shopping, not just today.
  const DOW_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekMenus: AppWeekMenu[] = weekTables.map((t) => ({
    week: t.week,
    current: t === table,
    days: DOW_FULL.map((dow, di) => ({
      dow,
      dateLabel: t.dayDates?.[di] ?? undefined,
      today: t === table && di === colIdx ? true : undefined,
      slots: t.rows
        .filter((r) => !r.slot.toLowerCase().includes("bedtime"))
        .map((r) => {
          const dish = r.cells[di] ?? "";
          return {
            slot: r.slot.replace(/\s*\([^)]*\)\s*$/, "").trim(),
            dish,
            components: splitDishComponents(dish),
            ayurveda: AYURVEDIC_DISH_RE.test(dish) || undefined,
          };
        })
        .filter((s) => s.dish),
    })),
  }));

  // Hybrid/principle plans carry ONE illustrative week — present it as a
  // mix-and-match "Sample menu", not a prescriptive week-by-week schedule
  // (coach rule 2026-06-11). Source of truth is the STORED app_menu.is_sample
  // flag — NOT the week count. A real fortnight plan can legitimately carry a
  // single live week (e.g. the current week after a catch-up relabel), and
  // must NOT be mislabelled "Sample menu". Fall back to the 1-week heuristic
  // only when the flag was never set (legacy).
  const storedSample = (plan.app_menu as { is_sample?: boolean } | undefined)?.is_sample;
  const menuIsSample = storedSample ?? weekMenus.length === 1;

  // The full recipe pack, exposed for IN-APP rendering (letters are being
  // retired; the dish overlay and Plan → Resources both render from this).
  // Letter-parsed recipes all ship; library recipes ship when the coach
  // pinned them on the plan OR a dish on the live menu matches them — the
  // plan tab is the source of truth, no recipes letter required.
  const usedLibrary = new Set<LetterRecipe>();
  for (const l of libraryRecipes) if (pinnedSlugs.has(l.slug)) usedLibrary.add(l.recipe);
  for (const w of weekMenus)
    for (const d of w.days)
      for (const s of d.slots)
        // per component, not the whole cell — matching the joined string lets
        // tokens from DIFFERENT components combine into a recipe nothing on
        // the menu actually is ("methi water + amla …" ⇏ "Amla Water").
        for (const c of splitDishComponents(s.dish)) {
          const r = recipeFor(c.title);
          if (r && !recipes.includes(r)) usedLibrary.add(r);
        }
  const packRecipes = [...recipes, ...usedLibrary];
  // Legacy letter-parsed recipes have no structured quantities / kcal. Borrow
  // them from a same-named library recipe so the cook-for-N scaler + calories
  // light up wherever the dish exists in the library.
  const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const libByTitle = new Map(libraryRecipes.map((l) => [normTitle(l.recipe.title), l.recipe]));
  const recipePack: AppRecipe[] = packRecipes.map((r) => {
    const lib = r.kcalPerServing ? undefined : libByTitle.get(normTitle(r.title));
    return {
      title: r.title,
      serves: r.serves ?? (lib?.servingsNum ? String(lib.servingsNum) : undefined),
      servingsNum: r.servingsNum ?? lib?.servingsNum,
      kcalPerServing: r.kcalPerServing ?? lib?.kcalPerServing,
      time: r.time ?? lib?.time,
      ingredients: r.ingredients,
      ingredientsStructured: r.ingredientsStructured ?? lib?.ingredientsStructured,
      method: r.method,
      tip: r.tip,
      imageUrl: r.imageUrl ?? lib?.imageUrl, // was dropped here → recipe cards never showed a photo
      ayurveda: AYURVEDIC_DISH_RE.test(r.title) || undefined,
    };
  });

  // Shopping list — written by scripts/generate-grocery-list.py; read-only here.
  let grocery: AppGrocery | null = null;
  const groceryRaw = await readIfExists(path.join(mealPlansDir, `${planSlug}-grocery.yaml`));
  if (groceryRaw) {
    try {
      const g = yaml.load(groceryRaw) as AppGrocery;
      if (g && Array.isArray(g.weeks) && g.weeks.length) grocery = g;
    } catch {
      /* malformed file — app simply shows no list */
    }
  }

  // ---- ingredient swap groups (compliance-gated per client) -----------------
  // Curated equivalences from fm-database/data/swap_groups.yaml. A member is
  // dropped when its match words appear in the client's "leave out" tier or
  // when it's animal-derived and the client is vegan — so the app can never
  // offer a swap the plan forbids. Groups need ≥2 survivors to be useful.
  let swapGroups: SwapGroupT[] = [];
  try {
    const raw = await readIfExists(path.join(getCataloguePath(), "swap_groups.yaml"));
    if (raw) {
      const doc = yaml.load(raw) as {
        groups?: { id?: string; label?: string; note?: string; members?: Dict[] }[];
      };
      // The avoid tier, from every source the plan uses: nutrition.reduce
      // (plan YAML) + the client's own foods_to_avoid memory field.
      const avoidTexts = [
        ...asStrArr(((plan.nutrition as Dict) ?? {}).reduce),
        ...asStr(client.foods_to_avoid).split(/[,\n]/),
      ]
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const isVegan = /vegan/i.test(asStr(client.dietary_preference));
      for (const g of doc?.groups ?? []) {
        const members: SwapMemberT[] = [];
        for (const m of g.members ?? []) {
          const name = asStr(m.name);
          const match = asStrArr(m.match).map((t) => t.toLowerCase());
          if (!name || !match.length) continue;
          if (isVegan && m.vegan_excluded) continue;
          // gated out when ANY avoid-tier entry mentions this ingredient
          if (avoidTexts.some((a) => match.some((t) => swapTermMatches(a, t)))) continue;
          members.push({ name, match, note: asStr(m.note) || undefined });
        }
        if (members.length >= 2 && g.id && g.label)
          swapGroups.push({ id: g.id, label: g.label, note: asStr(g.note) || undefined, members });
      }
    }
  } catch {
    swapGroups = []; // malformed file — swaps simply don't appear
  }

  // ---- supplements ----------------------------------------------------------
  // Dose/timing/why: the PLAN YAML is canonical; buy links resolve from the
  // coach-curated supplement_links.yaml catalogue (retailer-priority).
  const supplements: AppSupplement[] = [];
  const upcomingSupplements: AppSupplement[] = [];
  // Every supplement in the protocol, tagged with its phase + status — drives
  // the Plan tab's "whole plan, by week" view. Today's routine reads the gated
  // `supplements` (status === 'current') only.
  const allSupplements: AppSupplement[] = [];
  const protocol = asArr(plan.supplement_protocol) as Dict[];
  for (let i = 0; i < protocol.length; i++) {
    const p = protocol[i];
    // Phase status against the client's current week. 'current' = on it now;
    // 'upcoming' = starts next week (heads-up to order ahead); 'later' = a
    // future phase; 'past' = course finished. Today's surfaces use 'current'
    // only; the Plan tab shows the whole arc grouped by start week.
    const startWeek = Number(p.start_week) || 1;
    const durWeeks = Number(p.duration_weeks) || 0;
    const status: "current" | "upcoming" | "later" | "past" =
      durWeeks > 0 && week >= startWeek + durWeeks
        ? "past"
        : week >= startWeek
          ? "current"
          : startWeek === week + 1
            ? "upcoming"
            : "later";
    const startsNextWeek = status === "upcoming";
    const slug = asStr(p.supplement_slug);
    // Prefer the coach-set display_name (e.g. "Vegetarian Omega-3"), then a
    // known override, then the humanised slug. Strip the brand prefix either
    // way so clients see the supplement, not the seller — "Vitaone Magnesium
    // Glycinate" → "Magnesium Glycinate", "vitaone-d3" → "D3". (Brand
    // attribution belongs on the buy-link badge.)
    const name = stripBrand(asStr(p.display_name) || SUPP_NAME_OVERRIDES[slug] || humanize(slug));
    const timing = asStr(p.timing);
    const dose = asStr(p.dose);
    let buyUrl: string | undefined;
    let suppImageUrl: string | undefined;
    {
      // No issued letter carrying buy links (e.g. nothing sent yet) — fall
      // back to the coach-curated supplement_links.yaml catalogue. Only a
      // real entry counts; the generic "browse the shop" fallback is noise.
      // resolveSupplementLink applies the retailer priority VitaOne →
      // fmnutrition → amazon, so the client's Reorder button lands on the
      // preferred store. International clients resolve against the iHerb
      // pool only — never an India-only storefront.
      try {
        const { resolveSupplementLink } = await import("@/lib/server-actions/supplement-links");
        // Pass the catalogue slug so the product binds deterministically by
        // `covers`/slug — never by a coincidental name substring.
        const link = await resolveSupplementLink(name, slug, { international });
        if (link.source !== "search") {
          buyUrl = link.url;
          suppImageUrl = link.image_url;
        } else if (international) {
          // The international search fallback is a targeted iHerb keyword
          // search on the ingredient — fail-safe (right ingredient, referral
          // attached), unlike the generic VitaOne shop link, so keep it.
          buyUrl = link.url;
        }
      } catch {
        /* no link — Reorder button simply hides */
      }
    }
    const asNeeded = /as.?needed|at.?risk meals?|prn\b|immediately before at.?risk|as a precaution|precaution only/i.test(timing);
    const emptyStomach = !asNeeded && /empty stomach|before breakfast|first thing in the morning|on empty|upon waking/i.test(timing);
    const chronoRank = timingRank(timing, dose, emptyStomach, asNeeded);
    // Auto-tier: a supplement is "core" when the coach's rationale frames it as
    // a primary, driver-targeting therapeutic (not a continuation/top-up).
    const rawRationale = asStr(p.coach_rationale);
    const core =
      !asNeeded &&
      /\b(critical gap|critical|central driver|main driver|key driver|primary (driver|fuel|target)|directly targets?|single biggest|biggest (gap|driver)|foundational|cornerstone|first.?line|non.?negotiable|essential|most important|the priority|highest priority)\b/i.test(
        rawRationale,
      );
    const suppItem = {
      id: `s-${slug || i}`,
      name,
      dose: shortDose(dose),
      slot: slotFromRank(chronoRank),
      chronoRank,
      timing: displayTiming(timing),
      why: clientifyWhy(
        firstSentence(asStr(p.coach_rationale).replace(/^\[[^\]]*\]\s*/g, ""))
          .replace(/^CRITICAL GAP[^:]*:\s*/i, "")
          .replace(/^CONTINUE[^.]*\.\s*/i, ""),
      ),
      buyUrl,
      imageUrl: suppImageUrl,
      ...(asNeeded ? { asNeeded: true } : {}),
      ...(emptyStomach ? { emptyStomach: true } : {}),
      ...(core ? { core: true } : {}),
      ...(startsNextWeek ? { startsNextWeek: true } : {}),
      startWeek,
      durationWeeks: durWeeks || null,
      status,
    };
    // Full arc → allSupplements (Plan tab, by week). Today's routine reads only
    // 'current'; the next-week heads-up reads 'upcoming'. 'later'/'past' live in
    // allSupplements so the Plan tab can show the whole plan but they never leak
    // into today's slots / check-in / counts.
    allSupplements.push(suppItem);
    if (status === "current") supplements.push(suppItem);
    else if (status === "upcoming") upcomingSupplements.push(suppItem);
  }
  // Order each list by when it's taken (stable: authored order is kept within
  // the same time). Every downstream surface — Today's slots, the Plan tabs,
  // the order page, counts — reads this single chronological order.
  supplements.sort((a, b) => a.chronoRank - b.chronoRank);
  upcomingSupplements.sort((a, b) => a.chronoRank - b.chronoRank);
  // Plan-tab order: by start week, then by daily timing within a week.
  allSupplements.sort((a, b) => (a.startWeek ?? 1) - (b.startWeek ?? 1) || a.chronoRank - b.chronoRank);

  // ---- demographic + dosha context (drives the remedy gates) ---------------
  const sexRaw = asStr(client.sex).trim().toUpperCase().slice(0, 1); // 'M' | 'F' | ''
  const dobStr = asStr(client.date_of_birth);
  let ageYears: number | null = null;
  if (dobStr) {
    ageYears = Math.floor((todayUTC.getTime() - new Date(`${dobStr}T00:00:00Z`).getTime()) / (365.25 * 86_400_000));
  } else {
    const band = asStr(client.age_band).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (band) ageYears = Math.round((parseInt(band[1], 10) + parseInt(band[2], 10)) / 2);
  }
  const pregnancyStatus = asStr(client.pregnancy_status);
  const isPregnant = /^pregnant/.test(pregnancyStatus);
  const isLactating = pregnancyStatus === "lactating" || !!asStr(client.lactation_started);
  const cycleStatus = asStr(client.cycle_status);
  // Life stage: explicit fields win (pregnancy > lactation > cycle_status,
  // which the cycle-tracking panel maintains and the coach can edit); age
  // fallback only when nothing is on file.
  const stages: string[] = [];
  if (sexRaw === "F") {
    if (isPregnant) stages.push("pregnancy");
    else if (isLactating) stages.push("lactation");
    else if (cycleStatus === "menstruating") stages.push("menstruating");
    else if (cycleStatus === "perimenopausal") stages.push("perimenopausal");
    else if (cycleStatus === "postmenopausal") stages.push("postmenopausal");
    else if (cycleStatus !== "not_applicable" && ageYears != null) {
      if (ageYears < 45) stages.push("menstruating");
      else if (ageYears < 55) stages.push("perimenopausal");
      else stages.push("postmenopausal");
    }
  }
  const stageSet = new Set(stages);

  const ayurAssessment = (client.ayurveda_assessment as Dict) ?? {};
  const prakrutiLabel = asStr(client.ayurveda_constitution) || asStr(ayurAssessment.prakruti_label);
  let dosha: string[] = [];
  if (/vata/i.test(prakrutiLabel)) dosha.push("vata");
  if (/pitta/i.test(prakrutiLabel)) dosha.push("pitta");
  if (/kapha/i.test(prakrutiLabel)) dosha.push("kapha");
  if (!dosha.length) dosha = asStrArr(ayurAssessment.vikruti_doshas);
  const doshaLabel = dosha.map((d) => DOSHA_LABEL[d] ?? humanize(d)).join("–");
  const vikruti = asStrArr(ayurAssessment.vikruti_doshas);

  // ---- remedies: assigned (plan letter + ayurveda block) + library ----------
  const remedyLib = await loadRemedyLibrary();
  const bySlug = new Map(remedyLib.map((r) => [r.slug, r]));
  const nutrition = (plan.nutrition as Dict) ?? {};
  const dailyRemedySlugs = asStrArr(nutrition.home_remedies);
  const ayur = (plan.ayurveda as Dict) ?? {};
  const ayurRemedySlugs = asStrArr(ayur.remedies);
  const assignedSlugs = [...new Set([...dailyRemedySlugs, ...ayurRemedySlugs])];
  // Letter remedy blurbs retired — catalogue copy (preparation/timing/benefit
  // on the remedy record) is the client-facing text.
  const blurbFor = (_r: AppRemedy): LetterRemedyBlurb | undefined => undefined;
  const remedies: AppRemedy[] = [];
  for (const slug of assignedSlugs) {
    const base = bySlug.get(slug);
    if (!base) continue;
    const daily = dailyRemedySlugs.includes(slug) || slug === "triphala-churan";
    const blurb = blurbFor(base);
    const isChuran = base.category === "ayurvedic_churan";
    const bedtime = /bed|night/i.test(base.timing) || /bed|night/i.test(blurb?.how ?? "");
    const beforeBreakfast = /empty stomach|before breakfast|first thing in the morning|on empty|upon waking|20.?30 minutes before breakfast/i.test(`${base.timing} ${blurb?.how ?? ""}`);
    remedies.push({
      ...base,
      assigned: true,
      daily,
      supplementLike: isChuran && daily,
      suppSlot: bedtime ? "Bedtime" : "Morning",
      suppTiming: bedtime ? "Before bed" : "Morning",
      when: bedtime ? "Bedtime" : /between meals|through the day/i.test(`${base.timing} ${blurb?.how ?? ""}`) ? "Between meals" : /morning/i.test(base.timing) ? "Morning" : "Daily",
      why: blurb?.what || firstSentence(base.summary),
      ...(beforeBreakfast ? { beforeBreakfast: true } : {}),
    });
  }

  // ── one drink per slot (coach rule 2026-06-10) ─────────────────────────
  // The plan + ayurveda block can stack several remedies into the same
  // moment (Hariharan: golden milk + ghee-milk + jatamansi tea, ALL at
  // bedtime) — a client reads "Picked for you" on each and thinks she must
  // take all three. Keep ONE primary drinkable remedy per timing slot;
  // the rest stay visible as clearly-labelled swap options and never hit
  // the daily log. Priority: mentioned in the issued letter > in the plan's
  // nutrition protocol > ayurveda-block order. Churans folded into the
  // supplement schedule and external remedies are different surfaces —
  // they don't compete with drinks.
  {
    const drinkPriority = (r: AppRemedy): number =>
      blurbFor(r) ? 0 : dailyRemedySlugs.includes(r.slug) ? 1 : 2;
    const bySlot = new Map<string, AppRemedy[]>();
    for (const r of remedies) {
      if (!r.assigned || r.route === "external" || r.supplementLike) continue;
      const key = r.when ?? "Daily";
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key)!.push(r);
    }
    for (const group of bySlot.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => drinkPriority(a) - drinkPriority(b));
      const primary = group[0];
      for (const r of group.slice(1)) {
        r.alternative = true;
        r.alternativeTo = primary.name.split(" (")[0].trim();
        r.daily = false;
        r.why = `A swap option for ${r.alternativeTo.toLowerCase()} — ${firstSentence(r.why ?? r.summary).toLowerCase()}`;
      }
    }
    // primaries first, alternatives after, original order otherwise
    remedies.sort((a, b) => Number(a.alternative ?? false) - Number(b.alternative ?? false));
  }

  // ---- remedy eligibility (hard gates) + relevance shelf --------------------
  // Gates run SERVER-SIDE so an ineligible remedy never reaches the phone:
  //   sex-specific remedies only for that sex; stage-specific remedies only
  //   when the client's life stage matches (no period tea for a man or a
  //   postmenopausal woman); avoid_in (pregnancy/lactation) is an outright
  //   hide; dosha-aggravating remedies stay excluded as before.
  // Coach-assigned remedies bypass relevance (she prescribed them) — they
  // come from `bySlug` above, untouched by this filter.
  const assignedSet = new Set(assignedSlugs);
  const eligibleLib = remedyLib.filter((r) => {
    if (r.suitableSex === "female" && sexRaw !== "F") return false;
    if (r.suitableSex === "male" && sexRaw !== "M") return false;
    if (r.suitableStages.length && !r.suitableStages.some((s) => stageSet.has(s))) return false;
    if (r.avoidIn.some((s) => stageSet.has(s))) return false;
    if (dosha.length) {
      if ((r.agg ?? []).some((d) => dosha.includes(d))) return false;
      if (!(r.bal ?? []).some((d) => dosha.includes(d))) return false;
    }
    return true;
  });

  // Relevance: match remedy indications against what the client actually
  // came in with (conditions, goals, plan topics). A remedy with no match
  // doesn't make the shelf no matter how well it suits the constitution.
  const NEED_RULES: { re: RegExp; ind: RegExp; label: string }[] = [
    { re: /anxiet|stress|panic/i, ind: /anxiet|stress|nervous|tension|calm/i, label: "anxiety" },
    { re: /sleep|insomnia/i, ind: /insomnia|sleep/i, label: "sleep" },
    { re: /hypertension|blood pressure|\bbp\b/i, ind: /hypertens|blood pressure|cardiovascular|heart/i, label: "blood pressure" },
    { re: /constipation/i, ind: /constipat|sluggish bowel|elimination/i, label: "constipation" },
    { re: /dry skin/i, ind: /dry.{0,12}skin|skin (?:dryness|nourish)/i, label: "dry skin" },
    { re: /scalp|hair/i, ind: /scalp|hair|dandruff/i, label: "scalp & hair" },
    { re: /knee|joint|tendon|arthrit/i, ind: /joint|knee|tendon|arthrit|stiffness/i, label: "joints" },
    { re: /bloat/i, ind: /bloat|\bgas\b|flatulence/i, label: "bloating" },
    { re: /diabet|blood sugar|insulin|glucose/i, ind: /blood sugar|glucose|diabet|insulin/i, label: "blood sugar" },
    { re: /cholesterol|lipid/i, ind: /cholesterol|lipid|triglycer/i, label: "cholesterol" },
    { re: /thyroid|hashimoto/i, ind: /thyroid/i, label: "thyroid" },
    { re: /migraine|headache/i, ind: /migraine|headache/i, label: "headaches" },
    { re: /acidity|gerd|heartburn|reflux/i, ind: /\bacid|heartburn|reflux|gerd|hyperacid/i, label: "acidity" },
    { re: /fatigue|energy|tired/i, ind: /fatigue|energy|debility|vitality/i, label: "energy" },
    { re: /depress|low mood|mood/i, ind: /depress|low mood|mood/i, label: "mood" },
    { re: /memory|brain fog|concentrat/i, ind: /memory|cognit|concentrat|brain fog/i, label: "memory & focus" },
    { re: /\bgut\b|digest|ibs|dysbiosis/i, ind: /digest|\bgut\b|dysbiosis|ibs/i, label: "digestion" },
    { re: /immun|frequent cold/i, ind: /immun|\bcold\b|cough/i, label: "immunity" },
    { re: /period|menstrual|cramps|pms/i, ind: /menstrua|period|pms|dysmenorrh|cramp/i, label: "period comfort" },
    { re: /menopaus|hot flash|hot flush/i, ind: /menopaus|hot flash|hot flush/i, label: "menopause comfort" },
    { re: /anaemia|anemia|\biron\b/i, ind: /\biron\b|an(?:a)?emia/i, label: "iron" },
  ];
  const clientConditionTerms = [...asStrArr(client.active_conditions), ...asStrArr(client.goals)].join(" | ");
  const clientTerms = [
    clientConditionTerms,
    ...asStrArr(plan.primary_topics).map(humanize),
    ...asStrArr(plan.contributing_topics).map(humanize),
  ].join(" | ");
  const needs = NEED_RULES.filter((rule) => rule.re.test(clientTerms));
  // Condition-contraindication gate: if a remedy's cautions name one of the
  // client's OWN conditions (licorice ↔ hypertension), it's not self-serve —
  // it disappears from the client's library entirely. The coach can still
  // assign it deliberately (assigned remedies bypass this filter).
  const conditionNeeds = NEED_RULES.filter((rule) => rule.re.test(clientConditionTerms));
  const contraindicatedForClient = (r: AppRemedy): boolean => {
    const cautions = r.cautions.join(" | ");
    return conditionNeeds.some((n) => n.ind.test(cautions));
  };
  // Dietary gate for edible remedies — an eggetarian must never be offered
  // bone broth. Indian convention: vegetarian = no meat/fish/egg;
  // eggetarian = vegetarian + eggs; jain additionally no onion/garlic/roots;
  // vegan additionally no dairy/honey.
  const diet = asStr(client.dietary_preference).toLowerCase();
  const dietExcludes: RegExp[] = [];
  if (isVegetarianPref(diet)) {
    dietExcludes.push(/\bbone broth|\bchicken|\bmutton|\bfish\b|\bmeat\b|\bprawn|\bliver\b/i);
  }
  if (isVegetarianPref(diet) && !/eggetarian/.test(diet)) {
    dietExcludes.push(/\begg\b|\beggs\b/i);
  }
  if (/vegan/.test(diet)) {
    dietExcludes.push(/\bmilk\b|\bghee\b|\bcurd\b|\byogh?urt\b|\bbuttermilk\b|\bpaneer\b|\bhoney\b/i);
  }
  if (/jain/.test(diet)) {
    dietExcludes.push(/\bgarlic\b|\bonion\b/i);
  }
  const dietBlocked = (r: AppRemedy): boolean => {
    if (r.route === "external" || !dietExcludes.length) return false;
    const text = r.name + " | " + r.summary + " | " + r.prepSteps.join(" | ");
    return dietExcludes.some((re) => re.test(text));
  };
  const safeLib = eligibleLib.filter((r) => !contraindicatedForClient(r) && !dietBlocked(r));

  // Antagonist gate (shelf only): don't recommend a remedy built for the
  // OPPOSITE problem — a colitis/loose-stool remedy to a constipated client.
  const ANTAGONISTS: { has: RegExp; not: RegExp }[] = [
    { has: /constipation/i, not: /diarrh|loose stool|colitis|\bibs-d\b/i },
    { has: /diarrh|loose stool/i, not: /constipat|laxative/i },
    { has: /hypertension|high blood pressure/i, not: /hypotension|low blood pressure|raises blood pressure/i },
    { has: /insomnia|sleepless/i, not: /daytime drowsiness cure|stimulant|keeps you alert/i },
  ];
  const activeAntagonists = ANTAGONISTS.filter((a) => a.has.test(clientConditionTerms));
  const antagonistic = (r: AppRemedy): boolean => {
    const text = r.name + " | " + r.indications.join(" | ");
    return activeAntagonists.some((a) => a.not.test(text));
  };

  // Meal-food gate (coach directive 2026-06-15): on a DETAILED plan (a real
  // multi-week menu, not a one-week sample), foods you eat as a dish —
  // kitchari, buttermilk, lassi, vegetable juices — are delivered IN the
  // weekly menu, so they must not ALSO surface as standalone "remedies".
  // Principle/hybrid plans keep them: the shelf is their ONLY food-as-medicine
  // surface. The menu generators weave the condition-relevant ones into meals.
  // Coach-assigned remedies bypass the shelf entirely, so an explicit
  // prescription is never suppressed.
  const MEAL_FOOD_CATEGORIES = new Set(["kitchen_remedy", "vegetable_juice"]);
  const hasDetailedMenu = weekMenus.length > 0 && !menuIsSample;
  const scored = safeLib
    .filter(
      (r) =>
        !assignedSet.has(r.slug) &&
        !r.stub &&
        !antagonistic(r) &&
        !(hasDetailedMenu && MEAL_FOOD_CATEGORIES.has(r.category)),
    )
    .map((r) => {
      // Match against INDICATIONS only — the remedy's stated purpose. The
      // summary prose inflates matches (an earache compress whose summary
      // praises asafoetida's digestive properties is not a digestion remedy).
      const indText = r.indications.join(" | ");
      const matched = needs.filter((n) => n.ind.test(indText));
      // A shelf match must hit the remedy's PRIMARY purpose (first two
      // indications) — castor-oil EYE DROPS list "cataract prevention in
      // diabetics" third, which is not a blood-sugar recommendation.
      const primary = r.indications.slice(0, 2).join(" | ");
      if (!matched.some((n) => n.ind.test(primary))) matched.length = 0;
      const balHit = (r.bal ?? []).filter((d) => dosha.includes(d));
      const vikrutiHit = (r.bal ?? []).some((d) => vikruti.includes(d));
      const score = matched.length * 10 + (vikrutiHit ? 3 : 0) + balHit.length;
      let whyFor = "";
      if (matched.length) {
        const labels = matched.map((m) => m.label);
        whyFor =
          `For your ${labels.slice(0, 2).join(" and ")}` +
          (labels.length > 2 ? ` (and ${labels.length - 2} more)` : "") +
          (balHit.length ? ` — and it settles ${balHit.map((d) => DOSHA_LABEL[d] ?? d).join("–")}` : "") +
          ".";
      }
      return { remedy: { ...r, whyFor }, score, matched: matched.length };
    })
    .filter((x) => x.matched >= 1) // the relevance cut-off
    .sort((a, b) => b.score - a.score || a.remedy.name.localeCompare(b.remedy.name));

  // Diversity pass: don't stack three brahmi/jatamansi variations — and skip
  // anything herbally redundant with what the coach already assigned. Greedy
  // pick by score, skipping candidates that share a distinctive herb word
  // with an earlier pick or an assigned remedy (relaxed only if the shelf
  // would otherwise come up short).
  const GENERIC_WORDS = new Set([
    "water", "drink", "juice", "tonic", "churan", "tea", "milk", "formula", "remedy",
    "application", "massage", "compress", "pack", "stress", "relief", "sleep",
    "morning", "night", "bedtime", "daily", "warm", "fresh", "roasted", "soaked",
  ]);
  const herbWords = (name: string): string[] =>
    name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5 && !GENERIC_WORDS.has(w));
  const usedHerbs = new Set<string>();
  for (const slug of assignedSlugs) {
    const a = bySlug.get(slug);
    if (a) herbWords(a.name).forEach((w) => usedHerbs.add(w));
  }
  const remedyShelf: AppRemedy[] = [];
  const skipped: typeof scored = [];
  for (const cand of scored) {
    if (remedyShelf.length >= 5) break;
    const words = herbWords(cand.remedy.name);
    if (words.some((w) => usedHerbs.has(w))) {
      skipped.push(cand);
      continue;
    }
    words.forEach((w) => usedHerbs.add(w));
    remedyShelf.push(cand.remedy);
  }
  for (const cand of skipped) {
    if (remedyShelf.length >= 3) break;
    remedyShelf.push(cand.remedy);
  }

  // ---- coach app-overrides: hidden suggestions (read above, with meals) ----
  // Anything the coach hides never reaches the app's shelf or search.
  // Assigned remedies are managed via the plan (ManageRemedies).
  const hiddenRemedies = new Set((appOverrides.hidden_remedies ?? []).map(String));
  const visibleShelf = remedyShelf.filter((r) => !hiddenRemedies.has(r.slug));
  const visibleLib = safeLib.filter((r) => !hiddenRemedies.has(r.slug));

  // Purchase links for remedies that need buying (punarnava, triphala…) —
  // curated supplement_links.yaml only, never a search URL. International
  // clients match against the iHerb pool only; with no curated iHerb entry
  // the Get-it button hides rather than pointing at an India-only store.
  try {
    const { resolveSupplementLink } = await import("@/lib/server-actions/supplement-links");
    for (const r of [...remedies, ...visibleShelf]) {
      const link = await resolveSupplementLink(r.name.split("(")[0].trim(), undefined, {
        international,
      });
      if (link.source !== "search") r.buyUrl = link.url;
    }
  } catch {
    /* links file unavailable — Get-it buttons simply hide */
  }

  // ---- practices (exclude the remedy drinks — they live with meals) --------
  const practices: { id: string; name: string; when: string; details?: string }[] = [];
  const lifestyle = asArr(plan.lifestyle_practices) as Dict[];
  // A weekly-frequency phrase anywhere in the name or cadence — "2 sessions
  // per week", "3x/week", "3× week", "2x weekly". Group 1 = the count.
  const FREQ_RE = /(\d+)\s*(?:x|times|sessions?|days?)\s*(?:\/|per|a|each)?\s*(?:week|wk)/i;
  const practiceWhen = (name: string, cadence: string): string => {
    const text = `${name} ${cadence}`;
    const n = name.toLowerCase();
    // an explicit weekly cadence ALWAYS wins over a "Daily" default — this was
    // the bug: strength training ("2 sessions per week") showed a "Daily" chip.
    const fm = text.match(FREQ_RE);
    if (fm) return `${fm[1]}× / week`;
    if (/alternate days?|every other day/i.test(text)) return "Alternate days";
    if (n.includes("sunlight")) return "Morning";
    if (n.includes("breath")) return "Morning & night";
    if (n.includes("sleep schedule") || n.includes("lights out")) return "Night";
    if (n.includes("journal")) return "Evening";
    if (n.includes("screen") || n.includes("digital")) return "Night";
    if (n.includes("stretch")) return "Morning";
    if (/\bweekly\b/i.test(cadence) || /\bweekly\b/i.test(name)) return "Weekly";
    return "Daily";
  };
  // Drop a frequency phrase from the displayed name so it isn't redundant with
  // the chip ("Strength training — 2 sessions per week" → "Strength training").
  const cleanPracticeName = (name: string): string =>
    name
      .replace(new RegExp(`\\s*[—–-]\\s*${FREQ_RE.source}.*$`, "i"), "")
      .replace(new RegExp(`\\s*\\(\\s*${FREQ_RE.source}\\s*\\)`, "i"), "")
      .replace(new RegExp(`\\s*${FREQ_RE.source}`, "i"), "")
      .replace(/\s*\(([^)]{25,})\)/, "")
      .replace(/\s+/g, " ")
      .trim();
  // Order the day the way it's lived: waking → meals → daytime → evening →
  // bedtime. Practices with no time-of-day cue get a neutral mid rank and,
  // because the sort below is stable, keep their authored order ("where
  // possible"). A practice that's both morning AND night (e.g. breathwork
  // "morning and before bed") anchors to the morning so it leads the day.
  const practiceTimeRank = (name: string, cadence: string): number => {
    const t = `${name} ${cadence}`.toLowerCase();
    if (/wak(e|ing)|on rising|first thing|sunrise|sunlight|morning sun/.test(t)) return 10;
    if (/\bmorning\b|\bam\b|a\.m\./.test(t)) return 15; // incl. "morning & night"
    if (/post-?meal|after (each |every )?meals?|after lunch|after dinner|with meals|with food/.test(t)) return 30;
    if (/midday|noon|lunch|afternoon/.test(t)) return 40;
    if (/night|bed|bedtime|sleep|lights out|nightly|screens?|digital|wind-?down|before sleep|\bpm\b|p\.m\./.test(t)) return 70;
    if (/evening|sunset|journal|after work/.test(t)) return 60;
    return 50; // anytime / weekly / no cue — stays mid, original order preserved
  };
  let pIdx = 0;
  const practiceRaw: Dict[] = []; // index-aligned with practices[]
  // Collect first so we can stable-sort by time of day before assigning ids.
  const collected: { name: string; when: string; rank: number; raw: Dict }[] = [];
  // Seed cycling gets its OWN computed section under the menu (which seeds
  // today), so it's pulled out of the flat practices list here.
  let seedCyclingPrescribed = false;
  // Ginger-tea-for-cramps is a cycle-timed prompt, not a daily practice — it's
  // pulled out here and surfaced only on the relevant period dates.
  let gingerCrampPrescribed = false;
  for (const p of lifestyle) {
    const name = asStr(p.name);
    if (!name) continue;
    if (/ccf tea|golden milk|haldi doodh/i.test(name)) continue;
    if (/seed.?cycl/i.test(name)) { seedCyclingPrescribed = true; continue; }
    if (/ginger/i.test(name) && /cramp|period|menstru/i.test(name)) { gingerCrampPrescribed = true; continue; }
    const cadence = asStr(p.cadence);
    collected.push({
      name: cleanPracticeName(name),
      when: practiceWhen(name, cadence),
      rank: practiceTimeRank(name, cadence),
      raw: p,
    });
  }
  // Array.prototype.sort is stable (ES2019+), so equal-rank practices keep
  // their authored order — only the clearly time-anchored ones move.
  collected.sort((a, b) => a.rank - b.rank);
  for (const c of collected) {
    // Surface the coach's instructions to the client (e.g. seed-cycling's
    // follicular-vs-luteal steps) — the card shows name + cadence, tap "How"
    // to read the full details. Light-scrubbed; omitted when empty.
    const rawDetails = asStr(c.raw.details);
    const details = rawDetails ? clientifyPracticeDetail(rawDetails) : "";
    practices.push({
      id: `p${pIdx++}`,
      name: c.name,
      when: c.when,
      ...(details ? { details } : {}),
    });
    practiceRaw.push(c.raw);
  }

  // ---- seed cycling: its own computed section under the menu ----------------
  // Works out today's seeds from the client's cycle data so she never has to
  // count cycle days herself.
  const seedCycling = computeSeedCycling(seedCyclingPrescribed, client, todayUTC);
  const periodCare = computePeriodCare(gingerCrampPrescribed, client, todayUTC);

  // ---- guided breathwork (paced exactly to the prescribed technique) -------
  // The animation is driven entirely from these numbers, so it can never
  // drift from what the coach prescribed in the plan.
  const breathwork = deriveBreathwork(practices, practiceRaw);
  const eft = deriveEft(
    practices,
    practiceRaw,
    `${asStrArr(client.goals).join(" ")} ${asStrArr(client.active_conditions).join(" ")} ${asStr(client.reported_triggers)}`,
    Array.isArray((client as Record<string, unknown>).eft_themes)
      ? ((client as Record<string, unknown>).eft_themes as string[])
      : undefined,
  );
  const sleep = deriveSleep(practices, practiceRaw);

  // ---- mind-body drip: graduated techniques (EFT, sleep wind-down) unlock ONE
  // AT A TIME as the prior one becomes a habit. Breathing (#1) is always open.
  // Order: the client's primary issue goes first after breathing — sleep-primary
  // clients get the wind-down at #2. Foundation gate = ≥3 distinct breathing days
  // in the trailing week; each later technique gates on the prior being used ≥2
  // distinct days (lighter — these are as-needed). Per-technique coach override
  // via client.mindbody_<tech> = auto | unlocked | locked.
  type DripTech = { key: "eft" | "sleep"; practiceId: string; label: string };
  const sleepPrimary = eft?.theme === "sleep";
  const order: ("eft" | "sleep")[] = sleepPrimary ? ["sleep", "eft"] : ["eft", "sleep"];
  const seq: DripTech[] = order
    .map((k): DripTech | null =>
      k === "eft" && eft
        ? { key: "eft", practiceId: eft.practiceId, label: "EFT tapping" }
        : k === "sleep" && sleep
          ? { key: "sleep", practiceId: sleep.practiceId, label: "Sleep wind-down" }
          : null,
    )
    .filter((t): t is DripTech => t !== null);

  const cli = client as Record<string, unknown>;
  const breathDays = breathwork && seq.length ? await practiceDaysInWindow(clientDir, "breath", 7) : 0;
  let eftVisible: AppEft | null = null;
  let sleepVisible: AppSleep | null = null;
  let mindBody: ClientAppData["mindBody"] = null;
  const hideIds: string[] = [];
  // frontier: is the prior step established enough to open the next?
  let priorSatisfied = breathwork ? breathDays >= 3 : true;
  let priorLabel = "breathing";
  let priorDone = breathDays;
  let priorNeeded = 3;

  for (const tech of seq) {
    const override = asStr(cli[`mindbody_${tech.key}`]).toLowerCase();
    const unlocked = override === "unlocked" ? true : override === "locked" ? false : priorSatisfied;
    if (unlocked) {
      if (tech.key === "eft") eftVisible = eft;
      else sleepVisible = sleep;
      const days = await practiceDaysInWindow(clientDir, tech.key, 14);
      priorSatisfied = days >= 2;
      priorLabel = tech.key === "eft" ? "tapping" : "your wind-down";
      priorDone = days;
      priorNeeded = 2;
    } else {
      hideIds.push(tech.practiceId);
      if (!mindBody && override !== "locked") {
        mindBody = { nextUp: tech.label, priorLabel, doneCount: priorDone, needed: priorNeeded, locked: true };
      }
      priorSatisfied = false; // everything after a locked step stays locked
    }
  }
  // Drop any locked technique from the daily checklist too — don't surface a
  // to-do the client has no way to do yet.
  const practicesVisible = hideIds.length ? practices.filter((p) => !hideIds.includes(p.id)) : practices;

  // ---- principles (from the letter's meals note + plan meal_timing) --------
  const principles: { t: string; b: string }[] = [];
  if (mealTiming) {
    principles.push({
      t: "Protein and rhythm at every meal",
      b: mealTiming.replace(/\s+/g, " ").trim(),
    });
  }

  // ---- labs we're watching ---------------------------------------------------
  const recheck = asStr(plan.plan_period_recheck_date);
  const recheckLabel = recheck
    ? new Date(`${recheck}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : "your recheck";
  const labs = (asArr(plan.lab_orders) as Dict[]).map((l, i) => {
    let name = asStr(l.test);
    name = name.split(/ \(|\+ |, /)[0].trim();
    if (name.length > 30) name = name.slice(0, 28) + "…";
    return { name, meta: `Retest around ${recheckLabel}`, tone: i % 3 === 0 ? "ochre" : "forest" };
  });

  // ---- journey ----------------------------------------------------------------
  const coachName = "Shivani Hari";
  const journey: JourneyItem[] = [];
  const weekOf = (d: Date): number =>
    startDate ? Math.max(Math.floor((d.getTime() - startDate.getTime()) / 86_400_000 / 7) + 1, 0) : 0;
  if (startDate) {
    journey.push({
      kind: "start",
      week: 0,
      when: fmtDay(startDate),
      title: "Your plan began",
      note: { who: coachName, text: `Twelve weeks, one day at a time. I'm with you.` },
    });
  }
  // real plan edits from status_history (skip the initial activation noise)
  for (const ev of asArr(plan.status_history) as Dict[]) {
    const reason = asStr(ev.reason);
    const at = asStr(ev.at);
    if (!reason || !at || /^activated/i.test(reason)) continue;
    const d = new Date(at);
    const clean = reason
      .replace(/\(see quick note[^)]*\)\.?/i, "")
      .replace(/^Quick edit\s*[—-]\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    journey.push({
      kind: "update",
      week: weekOf(d),
      when: fmtDay(d),
      title: "Plan updated",
      note: { who: coachName, text: clean },
    });
  }
  // weekly check-in / poll replies from sessions (+ MSQ submissions)
  const sessionPoints: { wk: number; v: number }[] = [];
  const msqEntries: AppMsqEntry[] = [];
  // latest travel flag wins (a later "cancelled" entry clears the window)
  let latestTravel: { from: string; to: string; kind: string; location: string; context: string; cancelled: boolean; at: string; localFoodsRaw: unknown } | null = null;
  try {
    const sessDir = path.join(clientDir, "sessions");
    const names = (await fs.readdir(sessDir)).filter((n) => n.endsWith(".yaml"));
    for (const n of names) {
      const s = await readYamlIfExists(path.join(sessDir, n));
      if (!s) continue;
      const poll = s.poll_response as Dict | undefined;
      const checkin = s.checkin_response as Dict | undefined;
      const msq = s.msq_response as Dict | undefined;
      const travelResp = s.travel_response as Dict | undefined;
      const dateStr = asStr(s.date);
      if (!dateStr) continue;
      if (travelResp) {
        const at = asStr(travelResp.received_at) || dateStr;
        if (!latestTravel || at > latestTravel.at) {
          latestTravel = {
            from: asStr(travelResp.from),
            to: asStr(travelResp.to),
            kind: asStr(travelResp.kind) || "travel",
            location: asStr(travelResp.location),
            localFoodsRaw: travelResp.local_foods,
            context: asStr(travelResp.context),
            cancelled: travelResp.cancelled === true,
            at,
          };
        }
        continue;
      }
      const d = new Date(`${dateStr}T00:00:00Z`);
      if (msq && Number(msq.total) >= 0) {
        msqEntries.push({
          date: dateStr,
          week: Number(msq.week) || weekOf(d),
          total: Number(msq.total) || 0,
          band: asStr(msq.band) || "mild",
          categoryTotals: (msq.category_totals as Record<string, number>) ?? {},
        });
        journey.push({
          kind: "checkin",
          week: weekOf(d),
          when: fmtDay(d),
          title: "Symptom check (MSQ)",
          summary: `You scored ${Number(msq.total) || 0} — every retake shows the trend.`,
        });
        continue;
      }
      if (poll) {
        const score = asStr(poll.score);
        const raw = asStr(poll.raw_text);
        const v = score === "good" ? 4 : score === "partial" ? 3 : 2;
        sessionPoints.push({ wk: weekOf(d), v: v * 20 });
        journey.push({
          kind: "checkin",
          week: weekOf(d),
          when: fmtDay(d),
          title: "Weekly check-in",
          summary: raw ? `You replied: “${raw}”` : "You checked in over WhatsApp.",
        });
      } else if (checkin) {
        const rating = Number(checkin.rating) || 0;
        if (rating > 0) sessionPoints.push({ wk: weekOf(d), v: rating * 20 });
        journey.push({
          kind: "checkin",
          week: weekOf(d),
          when: fmtDay(d),
          title: "Weekly check-in",
          summary: asStr(checkin.feel) || `You rated the week ${rating} of 5.`,
        });
      }
    }
  } catch {
    /* no sessions dir */
  }
  journey.sort((a, b) => b.week - a.week || (a.kind === "start" ? 1 : -1));
  msqEntries.sort((a, b) => a.date.localeCompare(b.date));

  // ---- symptom score (only from real check-ins; null until ≥2 points) --------
  sessionPoints.sort((a, b) => a.wk - b.wk);
  const symptomScore =
    sessionPoints.length >= 2
      ? {
          goodAt: 70,
          points: sessionPoints,
          deltaLabel:
            sessionPoints[sessionPoints.length - 1].v - sessionPoints[0].v >= 0
              ? `+${sessionPoints[sessionPoints.length - 1].v - sessionPoints[0].v} since start`
              : `${sessionPoints[sessionPoints.length - 1].v - sessionPoints[0].v} since start`,
          next: "Updates at your weekly check-in",
          caption: "Built from your weekly check-ins — how you feel is the proof of progress.",
        }
      : null;

  // ---- travel window (client-flagged from the app) ---------------------------
  // Active when today ∈ [from, to] and the latest flag isn't a cancellation.
  // Window shown a touch early (from − 2d) so the client sees the travel
  // card while packing; expires silently the day after return.
  let travel: ClientAppData["travel"] = null;
  const travelTodayYmd = new Date().toISOString().slice(0, 10);
  const travelSoonYmd = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  if (latestTravel && !latestTravel.cancelled && latestTravel.from && latestTravel.to) {
    if (latestTravel.from <= travelSoonYmd && travelTodayYmd <= latestTravel.to) {
      const tkind = latestTravel.kind;
      travel = {
        from: latestTravel.from,
        to: latestTravel.to,
        kind:
          tkind === "festival" || tkind === "illness" ? tkind : "travel",
        location: latestTravel.location,
        context: latestTravel.context,
        active: latestTravel.from <= travelTodayYmd,
        ...(weightLossEnabled ? { holdNotLose: true } : {}),
      };
    }
  }
  // Fallback: COACH-set travel/illness/festival from weight_loss.week_overrides
  // (the Communicate travel panel). The client-flagged travel_response above
  // wins; this ensures a coach-entered trip drives the card too — the gap that
  // left Dhanishta's app blank during her Australia holiday (2026-07-05).
  if (!travel && travelOverrides?.length) {
    const active = travelOverrides
      .filter((o) => !o.cancelled && o.date_from && o.date_to)
      .map((o) => ({
        from: String(o.date_from).slice(0, 10),
        to: String(o.date_to).slice(0, 10),
        context: o.context ?? "travel",
        location: o.location ?? "",
      }))
      .filter((o) => o.from <= travelSoonYmd && travelTodayYmd <= o.to)
      // latest-returning active window wins if several overlap
      .sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0))[0];
    if (active) {
      const ctx = active.context;
      travel = {
        from: active.from,
        to: active.to,
        kind: ctx === "festival" || ctx === "illness" ? ctx : "travel",
        location: active.location,
        context: ctx,
        active: active.from <= travelTodayYmd,
        ...(weightLossEnabled ? { holdNotLose: true } : {}),
      };
    }
  }

  // ---- lab checkpoints ---------------------------------------------------------
  const baseline = (plan.baseline_snapshot as Dict) ?? {};
  const baseMarkers = asArr(baseline.lab_markers) as Dict[];
  const pickMarker = (frag: string) =>
    baseMarkers.find((m) => asStr(m.marker_name).toLowerCase().includes(frag));
  const homo = pickMarker("homocysteine");
  const tsh = pickMarker("tsh");
  const baselineVal = [homo, tsh]
    .filter(Boolean)
    .map((m) => `${asStr(m!.marker_name).split(" ")[0]} ${m!.value}`)
    .join(" · ");
  const labShort = labs.slice(0, 3).map((l) => l.name.split(" ")[0]).join(" · ");
  const recheckWeek = startDate && recheck
    ? Math.max(Math.round((new Date(`${recheck}T00:00:00Z`).getTime() - startDate.getTime()) / 86_400_000 / 7), 1)
    : 8;
  const labCheckpoints = {
    note: "Bloods are only occasional — we confirm the picture at these points.",
    list: [
      { label: "Week 0", sub: "Baseline", value: baselineVal || "On file", state: "done" as const },
      {
        label: `Week ${recheckWeek}`,
        sub: "First retest",
        value: labShort || "Key markers",
        state: week >= recheckWeek ? ("next" as const) : ("next" as const),
      },
      { label: `Week ${totalWeeks}`, sub: "Full panel", value: "Full review with Shivani", state: "todo" as const },
    ],
  };

  // ---- plan reference (plate, tiers, oils, cooking) ----------------------------
  const addList = asStrArr(nutrition.add);
  const reduceList = asStrArr(nutrition.reduce);
  const addShort = addList.map(shortFoodName);
  const reduceShort = reduceList.map(shortFoodName);
  const dietPref = asStr(client.dietary_preference);
  const clientAvoid = asStr(client.foods_to_avoid)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nonNeg = asStr(client.non_negotiables).trim();

  // ---- travel local foods — render cascade ----------------------------------
  // Attached after dietPref/clientAvoid exist.
  //   A/B: a guide cached on the flag (pre-authored by coach, or copilot)
  //        wins — it's tailored to this exact destination + client.
  //   C:   else the curated dataset, gated to this client's plan.
  //   null: no match → card shows generic rules + a "Get foods" button (B).
  if (travel) {
    const cached = coerceGuide(latestTravel?.localFoodsRaw);
    travel.localFoods =
      cached ??
      (await resolveTravelGuide({
        kind: travel.kind,
        location: travel.location,
        dietPref,
        avoidTerms: [...clientAvoid, ...asStrArr(client.known_allergies)],
      }));
  }

  const pickAdds = (re: RegExp, max: number): string[] =>
    addShort.filter((s) => re.test(s)).slice(0, max);
  const vegExamples = pickAdds(/greens|palak|methi|amaranth|gourd|lauki|bhindi|veget/i, 6);
  const proteinExamples = pickAdds(/egg|dal|moong|curd|paneer|seed|legume/i, 6);
  const carbExamples = pickAdds(/ragi|millet|jowar|bajra/i, 5);
  const fatExamples = pickAdds(/ghee|coconut|walnut|flax|sesame|seed/i, 6);
  const fermentExamples = pickAdds(/curd|dahi|buttermilk|ferment/i, 4);

  const plate: PlateItem[] = [
    {
      key: "veg",
      label: "Vegetables",
      portion: "Half your plate",
      pct: 50,
      tone: "forest",
      examples: vegExamples.length ? vegExamples : ["Leafy greens", "Seasonal sabzi", "Salad vegetables"],
      note: "Cooked or raw, the more colour the better. Half of every plate, every meal.",
    },
    {
      key: "protein",
      label: "Protein",
      portion: "A quarter",
      pct: 25,
      tone: "ochre",
      examples: proteinExamples.length ? proteinExamples : ["Dal & legumes", "Curd", "Paneer"],
      note: `A palm-sized portion at every meal keeps energy even${dietPref ? ` — built around your ${dietPref} diet` : ""}.`,
    },
    {
      key: "carb",
      label: "Smart carbs",
      portion: "A quarter",
      pct: 25,
      tone: "sand",
      examples: carbExamples.length ? carbExamples : ["Millets", "Whole grains"],
      note: "Millets over refined grains — same comfort, steadier blood sugar.",
    },
  ];
  const accents: PlateItem[] = [
    {
      key: "fats",
      label: "Healthy fats",
      portion: "A thumb",
      pct: 0,
      tone: "gold",
      icon: "droplet",
      examples: fatExamples.length ? fatExamples : ["Ghee", "Nuts", "Seeds"],
      note: "About a thumb-sized amount per meal — cook in ghee or cold-pressed oil. Fats help you absorb vitamins and stay full.",
    },
    {
      key: "ferments",
      label: "Fermented",
      portion: "A spoon",
      pct: 0,
      tone: "clay",
      icon: "leaf",
      examples: fermentExamples.length ? fermentExamples : ["Curd / dahi", "Buttermilk"],
      note: "A small katori of curd or a glass of buttermilk most days feeds the good bacteria in your gut.",
    },
  ];

  const seedOilItem = reduceList.find((r) => /seed oils|sunflower|soybean|canola/i.test(r));
  const oils = {
    use: ["Ghee", "Cold-pressed coconut", "Cold-pressed groundnut", "Mustard oil"],
    avoid: ["Refined sunflower", "Refined soybean", "Canola", "Vanaspati / margarine"],
    note: seedOilItem
      ? seedOilItem.split(":").slice(1).join(":").trim() || firstSentence(seedOilItem)
      : "Cook in ghee or cold-pressed oils, which hold up to heat. Refined seed oils oxidise when heated and quietly nudge inflammation.",
  };

  const sometimes: string[] = [];
  if (nonNeg) sometimes.push(`${nonNeg} — after food, not before`);
  const chaiItem = reduceList.find((r) => /chai|coffee|tea/i.test(r));
  if (chaiItem && !sometimes.some((s) => /tea|chai/i.test(s))) sometimes.push("Chai — up to 2 cups, after food");
  sometimes.push("Jaggery — a little, in cooking", "Seasonal fruit — whole, not juiced");

  const foods = {
    eat: addShort,
    sometimes,
    avoid: [...reduceShort.filter((s) => !/chai|coffee/i.test(s)), ...clientAvoid],
  };
  const avoidWhy =
    "These spike blood sugar, disturb sleep, or push blood pressure and inflammation the wrong way — working against the calm and energy we're building. Not forever; we revisit as you progress.";

  // cooking adjustment cards from the catalogue
  const cooking: { t: string; b: string }[] = [];
  for (const slug of asStrArr(nutrition.cooking_adjustments)) {
    const d = await readYamlIfExists(path.join(getCataloguePath(), "cooking_adjustments", `${slug}.yaml`));
    if (!d) continue;
    const how = asStr(d.how_to_use).replace(/\s+/g, " ").trim();
    const summ = asStr(d.summary).replace(/\s+/g, " ").trim();
    cooking.push({ t: asStr(d.display_name) || humanize(slug), b: firstSentence(how || summ) + (how && summ ? " " + firstSentence(summ) : "") });
  }

  // ---- phases ribbon: standard three arcs over the plan length --------------
  let ribbon: { name: string; weeks: string; note: string }[] = [];
  {
    const tw = Math.max(totalWeeks || 12, 3);
    const a = Math.ceil(tw / 3);
    ribbon = [
      { name: "Foundation", weeks: `Weeks 1–${a}`, note: "Calming the system and building a steady daily rhythm." },
      { name: "Rebalance", weeks: `Weeks ${a + 1}–${a * 2}`, note: "Settling blood sugar and stress hormones." },
      { name: "Sustain", weeks: `Weeks ${a * 2 + 1}–${tw}`, note: "Anchoring it all as a way of living." },
    ];
  }
  const ribbonIdx = ribbon.findIndex((r) => {
    const m = r.weeks.match(/(\d+)–(\d+)/);
    return m && week >= parseInt(m[1], 10) && week <= parseInt(m[2], 10);
  });

  // ---- lessons (education modules — already client-voiced) --------------------
  const LESSON_TITLES: Record<string, string> = {
    "cortisol-steal": "Cortisol steal — where your energy went",
    "methylation-cycle-dysfunction": "Homocysteine & your active B-vitamins",
    "hpa-axis-dysregulation": "Your stress system, explained",
    "ambivalence-in-coaching": "When past attempts felt futile",
    "gut-brain-axis": "Your gut makes your mood",
  };
  const lessons: AppLesson[] = (asArr(plan.education) as Dict[]).map((e, i) => {
    const slug = asStr(e.target_slug);
    const body = asStr(e.client_facing_summary);
    const mins = Math.max(1, Math.round(body.split(/\s+/).length / 180));
    return {
      id: `l${i}`,
      title: LESSON_TITLES[slug] ?? humanize(slug),
      kind: "read",
      mins: `${mins} min read`,
      summary: firstSentence(body).slice(0, 110),
      body,
    };
  });

  // ---- resources (assembled from real plan content) ----------------------------
  const resources: AppResource[] = [];
  const windDownBits = lifestyle
    .filter((p) => /sleep|screen|journal|breathing|golden milk/i.test(asStr(p.name)))
    .map((p) => `• ${asStr(p.name)}${asStr(p.details) ? ` — ${firstSentence(asStr(p.details))}` : ""}`);
  if (windDownBits.length) {
    resources.push({
      id: "r-winddown",
      title: "Your evening wind-down",
      kind: "Cheat-sheet",
      icon: "doc",
      desc: "The simple sequence that sets up deep sleep.",
      body: `FROM 9 PM\n${windDownBits.join("\n")}\n\nConsistency is what matters — same wind-down, most nights. Your sleep rebuilds itself around the rhythm.`,
    });
  }
  const breathPractice = lifestyle.find((p) => /4-7-8|breathing/i.test(asStr(p.name)));
  if (breathPractice && asStr(breathPractice.details)) {
    resources.push({
      id: "r-breath",
      title: "4-7-8 breathing — the script",
      kind: "Practice",
      icon: "breath",
      desc: "The breath that switches on “rest and digest”.",
      body: asStr(breathPractice.details),
    });
  }
  if (labs.length) {
    resources.push({
      id: "r-labs",
      title: "Your lab order list",
      kind: "Lab form",
      icon: "clock",
      desc: `What to ask your lab to run before ${recheckLabel}.`,
      body:
        `Take this to your lab before your retest:\n\n` +
        (asArr(plan.lab_orders) as Dict[]).map((l) => `• ${asStr(l.test)}`).join("\n") +
        `\n\nMorning, fasting, and before your morning supplements. Share the report on WhatsApp and Shivani will read it before your session.`,
    });
  }
  if (recipePack.length) {
    resources.push({
      id: "r-recipes",
      title: "Your full recipe pack",
      kind: "Recipes",
      icon: "leaf",
      desc: "Every dish in your meal plan — ingredients and method, right here.",
      // No body / no url: DocOverlay renders the pack IN-APP from
      // data.recipePack (letters are retiring — nothing links out).
      body: "",
    });
  }
  // (no separate supplement-order resource — each supplement on the Plan tab
  // already carries its own Reorder link; a second page was just noise)

  // ---- co-pilot canned chips (templated from real plan data) -------------------
  const dinner = meals.find((m) => m.slot.toLowerCase().includes("dinner"));
  const dinnerSwaps = dinner ? mealExtra[dinner.slot]?.swaps ?? [] : [];
  const snackRow = table?.rows.find((r) => /evening/i.test(r.slot));
  const snackOptions = [...new Set(snackRow?.cells ?? [])].slice(0, 3);
  const methylLesson = lessons.find((l) => /homocysteine|b-vitamins/i.test(l.title));
  const aiSuggested: { q: string; a: string }[] = [];
  if (dinner) {
    aiSuggested.push({
      q: "Can I swap tonight’s dinner?",
      a: `Yes — keep the shape of the plate: vegetables, a protein and a millet. Tonight is ${dinner.components.map((c) => c.title).join(", ").toLowerCase()}. Good swaps from your plan: ${dinnerSwaps.slice(0, 2).map((s) => s.name.toLowerCase()).join(", or ")}. Try to finish by about 7:45.`,
    });
  }
  aiSuggested.push({
    q: "I forgot my morning supplements — what now?",
    a: "No harm done. If it's still before lunch, take them now with a little food. If it's later, just skip today and carry on tomorrow — never double up. Consistency over the weeks matters far more than any single dose.",
  });
  if (methylLesson) {
    aiSuggested.push({
      q: "Why am I taking active B6 and methylfolate?",
      a: firstSentence(methylLesson.body) + " " + (methylLesson.body.split(". ").slice(1, 3).join(". ") || ""),
    });
  }
  if (snackOptions.length) {
    aiSuggested.push({
      q: "What can I snack on if I’m still hungry?",
      a: `Reach for the snacks on your plan: ${snackOptions.map((s) => s.toLowerCase()).join("; ")}. Pairing protein with fibre keeps your energy even and avoids an afternoon dip.`,
    });
  }

  // ---- identity / dosha ----------------------------------------------------------
  const displayName = asStr(client.display_name) || clientId;
  const firstName = displayName.split(" ")[0];

  // program label from the client's goals
  const goals = asStrArr(client.goals).join(" ").toLowerCase();
  const programBits: string[] = [];
  if (/anxiet|calm|stress|feel better/.test(goals)) programBits.push("Calm");
  if (/sleep/.test(goals)) programBits.push("sleep");
  if (/energy/.test(goals)) programBits.push("energy");
  if (/pressure|bp/.test(goals) && programBits.length < 3) programBits.push("heart");
  // Oxford-style join: 1 → "Calm reset"; 2 → "Calm & sleep reset";
  // 3 → "Calm, sleep & energy reset". (Old slice(1,-1) form emitted a stray
  // ", " on exactly-2 goals → "Calm,  & sleep reset".)
  const program =
    programBits.length === 0
      ? `Your ${totalWeeks}-week reset`
      : programBits.length === 1
        ? `${programBits[0]} reset`
        : `${programBits.slice(0, -1).join(", ")} & ${programBits[programBits.length - 1]} reset`;

  const arcNow = ribbonIdx >= 0 ? ribbon[ribbonIdx] : undefined;
  const coachLine = arcNow
    ? `Week ${week} — you're in the ${arcNow.name} phase now. ${arcNow.note} Keep going.`
    : `Week ${week} of ${totalWeeks} — steady, one day at a time. Keep going.`;

  const startLabel = startDate
    ? startDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : "";

  const intake = asStr(client.intake_date);
  const member = intake
    ? `Since ${new Date(`${intake}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`
    : "";
  const initials = displayName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Avatar: expose a token-scoped photo URL when ANY avatar file exists on
  // disk — the client's own in-app photo (_app_photo.*) or the coach/intake
  // photo (photo.*). The GET route prefers the in-app override. null → the app
  // renders initials. (The coach dashboard only ever reads photo.*, so an
  // in-app photo never flows back to the coach record.)
  const photoDir = path.join(getPlansRoot(), "clients", clientId);
  let hasAvatar = false;
  for (const f of [
    "_app_photo.jpg", "_app_photo.jpeg", "_app_photo.png", "_app_photo.webp",
    "photo.jpg", "photo.jpeg", "photo.png", "photo.webp",
  ]) {
    try {
      await fs.access(path.join(photoDir, f));
      hasAvatar = true;
      break;
    } catch {
      /* keep probing */
    }
  }
  const photoUrl = hasAvatar ? `/api/app-photo/${token}` : null;

  // Reminders are DERIVED from this client's live plan (supplement timings +
  // check-in cadence), capped at 3, then overlaid with the client's saved
  // on/off + pinned-time overrides. Republishing the plan regenerates them.
  const reminders = effectiveReminders(
    deriveReminders(plan, client),
    (await readOverrides(clientId)).overrides,
  );

  const faq = [
    {
      q: "What if I miss a dose?",
      a: "No harm done — just carry on with the next one. Skip a missed dose rather than doubling up. Consistency over weeks matters far more than any single day.",
    },
    {
      q: "Can I swap a meal?",
      a: "Yes. Keep the shape of the plate — vegetables, a protein and a millet — and you can swap the specific dish. Your plan's same-slot dishes are always safe swaps. When unsure, message Shivani a photo.",
    },
    {
      q: "Do I need to be online?",
      a: "Your plan loads from the coach's records, so opening the app needs a connection — but your daily ticks are saved on your phone either way. Messaging Shivani happens on WhatsApp.",
    },
    {
      q: "Who sees what I log?",
      a: "Your weekly check-in goes to Shivani. Daily ticks (supplements, practices, movement) stay on your phone to keep you on rhythm — share anything you like at check-in.",
    },
  ];

  const nextContact = asStr(client.next_contact_date);
  const nextSession = nextContact
    ? new Date(`${nextContact}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    : null;

  // ---- plan focus + dietary flags (Plan-tab header) --------------------------
  // Plain-language "what this plan is, and why you're on it". Built only from
  // on-file conditions + the eating pattern — never invented.
  // Condition label → clean client-facing name. Drop the "(confirmed: …)"
  // parentheticals AND the lab-value / detail clause after a dash
  // ("Type 2 diabetes — HbA1c 6.6%" → "Type 2 diabetes") so the why-line reads
  // as a plain list of conditions, not a wall of numbers.
  const cleanCondition = (c: string): string =>
    c
      .replace(/\([^)]*\)/g, "")
      .split(/\s+[—–]\s+|\s+-\s+/)[0] // strip the lab/detail tail after a dash
      .replace(/\s*\/\s*/g, " / ")
      .replace(/\s{2,}/g, " ")
      .trim();
  // Lowercase for mid-sentence flow but keep acronyms intact (NAFLD, GERD, PCOS)
  // — never "nafld" / "gerd".
  const softLower = (s: string): string =>
    s
      .split(/\s+/)
      .map((w) => (/^[A-Z0-9/&-]{2,}$/.test(w) || /[a-z][A-Z]/.test(w) ? w : w.toLowerCase()))
      .join(" ");
  const joinAnd = (a: string[]): string =>
    a.length <= 1
      ? a[0] ?? ""
      : a.length === 2
        ? `${a[0]} and ${a[1]}`
        : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
  const focusConditions = asStrArr(client.active_conditions)
    .map(cleanCondition)
    .filter(Boolean)
    // life-stage labels aren't therapeutic targets — keep them out of the "why"
    .filter((c) => !/^(post|peri)?menopaus|menstruat|pregnan|lactat/i.test(c))
    .slice(0, 4);
  // pattern label: take the clause before the em/en-dash AND before the
  // first comma (NOT before a hyphen — that breaks "Anti-inflammatory").
  const patternShort = (asStr(nutrition.pattern).split(/[—–]/)[0].split(",")[0] || "whole-food")
    .trim()
    .toLowerCase()
    .replace(/\s*\+\s*/g, " and ");
  const patternArticle = /^[aeiou]/.test(patternShort) ? "an" : "a";
  const coachFirst = coachName.split(" ")[0];
  const focusList = focusConditions.slice(0, 3).map(softLower);
  const focusWhy =
    (focusList.length
      ? `This plan focuses on what's on your file — ${joinAnd(focusList)}. `
      : "") +
    `You'll work through ${patternArticle} ${patternShort} way of eating, the supplements ${coachFirst} chose for you, and a few daily practices — each piece picked for your body, not a generic template.`;

  // Ayurvedic assessment (only clients on the Ayurveda track have one) + a
  // short client-friendly line on how the plan works with it. Pulled straight
  // from the client's quiz-derived constitution + the plan's ayurveda block.
  const ayurConstitution = prakrutiLabel.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const ayurBalance = firstSentence(asStr(ayur.balancing_focus).replace(/\s+/g, " ")).trim();
  const ayurDiet = firstSentence(asStr(ayur.dietary_guidance).replace(/\s+/g, " ")).trim();
  const ayurHow = [ayurBalance, ayurDiet].filter(Boolean).join(" ");
  const focusAyurveda =
    (client.ayurveda_enabled === true || ayurConstitution) && ayurConstitution
      ? {
          constitution: ayurConstitution,
          imbalance: asStr(ayurAssessment.vikruti_label).replace(/\s+/g, " ").trim() || undefined,
          how:
            ayurHow ||
            `Your meals and routine are shaped to bring ${ayurConstitution} back into balance.`,
        }
      : null;

  // Dietary highlights → chips. NO hallucination: a food is only flagged as
  // "free" when the plan ELIMINATES it (replace/swap/instead, with no
  // "reduce to N/day" qualifier), or it's a declared preference / allergy /
  // exclusionary protocol. "Reduce cow's milk to 1 cup/day" is NOT dairy-free.
  const dietPrefLc = dietPref.toLowerCase();
  const allergiesLc = asStrArr(client.known_allergies).join(" ").toLowerCase();
  const curatedAvoidLc = clientAvoid.join(" ").toLowerCase(); // foods_to_avoid = curated eliminations
  const protocolsText = asStrArr(plan.attached_protocols).join(" ").toLowerCase();
  const eliminatedText = [...asStrArr(nutrition.reduce), ...asStrArr(nutrition.avoid)]
    .filter((e) => {
      const lc = e.toLowerCase();
      const isFull = /\b(replace|swap|instead of|switch to|eliminate|cut out|remove|drop)\b/.test(lc);
      const isPartial = /\b(reduce to|limit to|in excess|in moderation|moderate|large quantit|occasional|small amount|1[-–]?2?\s*(cup|tsp|tbsp|serving)|per day|\/day|a day)\b/.test(lc);
      return isFull && !isPartial;
    })
    .join(" ")
    .toLowerCase();
  const findRes = (...kw: string[]): string | undefined =>
    resources.find((res) => kw.some((k) => `${res.title} ${res.desc}`.toLowerCase().includes(k)))?.id;
  const flags: { label: string; detail: string; resourceId?: string }[] = [];
  const isVegan = /vegan/.test(dietPrefLc);
  if (isVegan) {
    flags.push({ label: "Vegan", detail: "Fully plant-based — your plan keeps B12, iron and omega-3 covered so nothing slips.", resourceId: findRes("vegan", "b12", "iron") });
  } else if (isVegetarianPref(dietPrefLc)) {
    flags.push({ label: "Vegetarian", detail: "Plant protein at every meal — dals, paneer, curd and seeds keep it complete." });
  } else if (isNonVegPref(dietPrefLc)) {
    flags.push({ label: "Non-vegetarian", detail: "Lean fish, eggs and poultry are in — paired with plenty of plants and fibre." });
  }
  if (/jain/.test(dietPrefLc)) {
    flags.push({ label: "Jain — no root vegetables", detail: "No onion, garlic, potato or other underground vegetables. Every recipe in your plan already respects this." });
  }
  if (/egg/.test(dietPrefLc) && !/no egg|egg.?free/.test(dietPrefLc)) {
    flags.push({ label: "Eggetarian", detail: "Eggs are in — a clean, complete protein you can lean on." });
  }
  const glutenFree =
    /gluten.?free/.test(dietPrefLc) ||
    /gluten|wheat|celiac|coeliac/.test(allergiesLc) ||
    /\bgluten\b|\bwheat\b|maida/.test(curatedAvoidLc) ||
    /\bgluten\b|\bwheat\b|maida/.test(eliminatedText) ||
    /aip|autoimmune.?paleo/.test(protocolsText);
  if (glutenFree) {
    flags.push({
      label: "Gluten-free",
      detail: "Watch the hidden sources — hing/asafoetida blends, sauces, masala mixes and processed snacks often carry wheat.",
      resourceId: findRes("gluten"),
    });
  }
  const dairyFree =
    !isVegan &&
    (/dairy.?free/.test(dietPrefLc) ||
      /dairy|lactose|casein|\bmilk\b/.test(allergiesLc) ||
      /\bdairy\b|lactose|casein/.test(curatedAvoidLc) ||
      /\bdairy\b|lactose|casein|\bmilk\b|paneer|curd/.test(eliminatedText));
  if (dairyFree) {
    flags.push({ label: "Dairy-free", detail: "No milk, curd or paneer — your calcium and protein come from other sources in the plan.", resourceId: findRes("dairy", "calcium") });
  }
  if (/low.?fodmap/.test(`${protocolsText} ${dietPrefLc}`)) {
    flags.push({ label: "Low-FODMAP (gut reset)", detail: "A short, structured reduction of fermentable carbs to calm the gut — reintroduced step by step.", resourceId: findRes("fodmap") });
  }
  if (/\bonion|\bgarlic/.test(curatedAvoidLc) && !/jain/.test(dietPrefLc)) {
    flags.push({ label: "No onion / garlic", detail: "Left out per your preference — flavour comes from ginger, herbs and hing-free spice blends." });
  }

  const planUpdatedAt = extractPublishedAt(plan);
  const clientUpdateNote = typeof plan.client_update_note === "string" && plan.client_update_note.trim()
    ? plan.client_update_note.trim()
    : null;

  // ---- body composition (read-only height/age + editable weight/waist/hip) --
  //
  // Goes through the SAME canonical union reader the coach dashboard uses
  // (collectMeasurementSnapshots / latestMeasurements) instead of reading
  // client.health_snapshots or the flat client.measurements block directly.
  // Landmine this fixes: weight/BP/waist live in three stores that don't
  // sync (health_snapshots from the app + labs, measurements_log from the
  // coach's own "Log entry" editor, and the flat intake block) — a value
  // last touched by a DIFFERENT source than the most recent entry must
  // still surface here, not silently disappear because it wasn't repeated
  // on that same date.
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const meas = (client.measurements as Dict) || {};
  const measurementsLike = client as Parameters<typeof collectMeasurementSnapshots>[0];
  // mood is a sibling of `measurements` on a health_snapshot entry (a daily
  // energy tap, not a body measurement — see save-app-body.py), so it isn't
  // carried by the shared union reader; build a small date lookup directly.
  const moodByDate = new Map<string, number>();
  for (const s of asArr(client.health_snapshots) as Dict[]) {
    const d = asStr(s.date);
    const m = num(s.mood_score);
    if (d && m != null) moodByDate.set(d, m);
  }
  // height: prefer the dashboard measurement, else the most recent snapshot
  let bodyHeight = num(meas.height_cm);
  const bodyHistory = collectMeasurementSnapshots(measurementsLike)
    .map((s) => ({
      date: s.date,
      weightKg: s.measurements.weight_kg ?? null,
      waistCm: s.measurements.waist_cm ?? null,
      hipCm: s.measurements.hip_cm ?? null,
      heightCm: s.measurements.height_cm ?? null,
      bpSystolic: s.measurements.bp_systolic ?? null,
      bpDiastolic: s.measurements.bp_diastolic ?? null,
      moodScore: moodByDate.get(s.date) ?? null,
    }))
    .filter(
      (e) =>
        e.weightKg != null || e.waistCm != null || e.hipCm != null || e.bpSystolic != null || e.moodScore != null,
    );
  // collectMeasurementSnapshots() already returns ascending-by-date, one
  // merged entry per date across all three stores.
  if (bodyHeight == null) {
    const withH = bodyHistory.filter((e) => e.heightCm != null);
    if (withH.length) bodyHeight = withH[withH.length - 1].heightCm;
  }
  const latest = latestMeasurements(measurementsLike);
  const body: ClientAppData["body"] = {
    heightCm: bodyHeight,
    ageYears,
    sex: sexRaw === "M" ? "M" : sexRaw === "F" ? "F" : "",
    latest: {
      weightKg: latest?.measurements.weight_kg ?? null,
      waistCm: latest?.measurements.waist_cm ?? null,
      hipCm: latest?.measurements.hip_cm ?? null,
      bpSystolic: latest?.measurements.bp_systolic ?? null,
      bpDiastolic: latest?.measurements.bp_diastolic ?? null,
      measuredOn: latest?.date ?? null,
    },
    history: bodyHistory.map(({ date, weightKg, waistCm, hipCm, bpSystolic, bpDiastolic, moodScore }) => ({
      date,
      weightKg,
      waistCm,
      hipCm,
      bpSystolic,
      bpDiastolic,
      moodScore,
    })),
  };

  // ---- coach's quick picks (off-catalogue product / remedy tips) ------------
  const coachPicks = (Array.isArray(plan.coach_recommendations) ? (plan.coach_recommendations as Dict[]) : [])
    .map((r) => ({
      title: asStr(r.title).trim(),
      forWhat: asStr(r.for_what).trim(),
      note: asStr(r.note).trim(),
      buyUrl: asStr(r.buy_url).trim(),
    }))
    .filter((r) => r.title);

  // ---- weight-loss daily calorie guide --------------------------------------
  // Only for clients whose goals mention weight loss. Same maths as the letter
  // generator's _calc_calorie_targets: Mifflin-St Jeor BMR → TDEE → a deficit
  // that builds gradually across the plan. Activity + pace come from the
  // client's own weight_loss.activity_level / .pace (same mapping as the
  // Python _calc_calorie_targets docstring); default to "light"/"moderate"
  // only when those fields are unset, so existing clients keep their old
  // numbers unless the coach actually recorded a different activity/pace.
  let weightLoss: ClientAppData["weightLoss"] = null;
  // Structured client.weight_loss.enabled (set via the intake/coach weight-loss
  // questionnaire) is the reliable signal — free-text goals ("goals: []" is
  // common when the coach fills weight_loss directly and never types a goals
  // sentence) is a fallback heuristic only, not the sole gate.
  const wlGoal = (client.weight_loss as Dict | undefined) ?? undefined;
  const wlEnabled = wlGoal?.enabled === true;
  const wantsWeightLoss = wlEnabled || /\b(weight|lose|loose|slim|fat ?loss)\b/.test(goals);
  if (wantsWeightLoss && body.heightCm && body.latest.weightKg && body.ageYears) {
    const w = body.latest.weightKg;
    const bmr =
      body.sex === "M"
        ? 10 * w + 6.25 * body.heightCm - 5 * body.ageYears + 5
        : 10 * w + 6.25 * body.heightCm - 5 * body.ageYears - 161;
    const ACTIVITY_MULT: Record<string, number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
    };
    const PACE_DEFICIT: Record<string, number> = { slow: 250, moderate: 500, faster: 750 };
    const activityMult = ACTIVITY_MULT[String(wlGoal?.activity_level || "")] ?? ACTIVITY_MULT.light;
    const tdee = Math.round(bmr * activityMult);
    const fullDeficit = PACE_DEFICIT[String(wlGoal?.pace || "")] ?? PACE_DEFICIT.moderate;
    // deficit builds gradually (same phase shape as the letter generator)
    const frac = week <= 2 ? 0.4 : week <= 4 ? 0.7 : week <= 8 ? 1.0 : week <= 10 ? 0.8 : 0.6;
    const dailyTarget = Math.max(1200, Math.round(tdee - fullDeficit * frac));
    const phaseNote =
      frac < 1
        ? week <= 4
          ? "A gentle start — the deficit eases in over the first weeks."
          : "Easing off as you near your goal."
        : "Your steady fat-loss phase.";

    // Estimate what THIS week's menu actually delivers (avg kcal/day) and
    // whether it's tracking the target. Bedtime drinks are excluded as noise.
    const curWeek = weekMenus.find((w) => w.current) ?? weekMenus[0];
    let estimatedDailyKcal: number | null = null;
    let adherence: "on_track" | "high" | "low" | null = null;
    if (curWeek && curWeek.days.length) {
      // recipes carry accurate AI-computed kcal/serving — the shared
      // recipeKcalLookup uses those for matched dishes, table for the rest
      const dayTotals = curWeek.days.map((d) =>
        estimateDayKcal(
          d.slots.filter((s) => !/bedtime/i.test(s.slot)).map((s) => s.dish),
          recipeKcalLookup,
        ),
      );
      const filled = dayTotals.filter((v) => v > 0);
      if (filled.length) {
        estimatedDailyKcal = Math.round(filled.reduce((a, b) => a + b, 0) / filled.length);
        adherence = calorieAdherence(estimatedDailyKcal, dailyTarget);
      }
    }
    const goal =
      wlGoal &&
      typeof wlGoal.starting_weight_kg === "number" &&
      typeof wlGoal.goal_kg === "number" &&
      wlGoal.starting_date &&
      wlGoal.goal_target_date
        ? {
            startKg: Number(wlGoal.starting_weight_kg),
            startDate: String(wlGoal.starting_date),
            targetKg: Number(wlGoal.starting_weight_kg) - Number(wlGoal.goal_kg),
            targetDate: String(wlGoal.goal_target_date),
          }
        : null;
    weightLoss = { dailyTarget, tdee, phaseNote, estimatedDailyKcal, adherence, goal };
  }

  // ---- lab vault (results vs FM-optimal + standard ranges) ------------------
  const labCatalogue = await loadLabCatalogue();
  const targetedMarkers = (asArr(plan.lab_orders) as Dict[]).map((l) => asStr(l.test)).filter(Boolean);
  const concernTerms = [
    ...asStrArr(client.active_conditions),
    ...asStrArr(client.goals),
    ...asStrArr(client.medical_history),
  ];
  const labVault = buildLabVault(
    asArr(client.health_snapshots) as unknown as LabSnapshot[],
    labCatalogue,
    (client.lab_reference_ranges as LabReferenceRanges | undefined) ?? {},
    { mode: "plan", targetedMarkers, concernTerms },
  );

  // Coach-recommended lab orders (Acumen) — payable in app. Redacts our_cost_inr
  // and attaches list_inr (à-la-carte deal anchor); the coach dashboard reads the
  // un-redacted order separately.
  const labOrders = await projectClientLabOrders(clientId);

  // ── Tissue salts (Schüssler) — gentle optional adjunct ─────────────────
  // Only when the client is on the schussler_salts module AND the plan carries
  // an authored tissue_salts section. Resolve slug → catalogue name + dose.
  let tissueSalts: ClientAppData["tissueSalts"] = null;
  if (asStrArr(client.plan_modules).includes("schussler_salts")) {
    const tsBlock = (plan.tissue_salts as Dict) ?? {};
    const tsItems = Array.isArray(tsBlock.salts) ? (tsBlock.salts as Dict[]) : [];
    if (tsItems.length) {
      const tsMap = await loadTissueSaltMap();
      // Coach policy: cell salts are a gentle adjunct — keep it to 1–2 per
      // client so the section never overwhelms. Even if more are authored (or
      // the AI suggests a long list), only the first MAX_TISSUE_SALTS show.
      const MAX_TISSUE_SALTS = 2;
      const tsList = tsItems
        .map((it) => {
          const slug = asStr(it.salt_slug).trim();
          if (!slug) return null;
          const cat = tsMap.get(slug);
          // The catalogue buyUrl is an amazon.in search (SBL brand) — India
          // only. International clients get an iHerb search on the biochemic
          // name instead (Hyland's carries the cell-salt range there).
          const abbrev = (cat?.name ?? humanize(slug)).replace(/\s*\(No\..*\)$/, "");
          const intlBuyUrl = `https://www.iherb.com/search?kw=${encodeURIComponent(
            `${abbrev} 6X cell salt`,
          )}&rcode=WNB6015`;
          return {
            name: cat?.name ?? humanize(slug),
            reason: asStr(it.reason).trim(),
            how: asStr(it.typical_use).trim() || (cat?.how ?? ""),
            buyUrl: international ? intlBuyUrl : (cat?.buyUrl ?? ""),
          };
        })
        .filter((x): x is { name: string; reason: string; how: string; buyUrl: string } => x !== null)
        .slice(0, MAX_TISSUE_SALTS);
      if (tsList.length) {
        tissueSalts = { overview: asStr(tsBlock.overview).trim(), list: tsList };
      }
    }
  }

  // ── plan "on hold" state ───────────────────────────────────────────────
  // A plan is ON HOLD until the coach-confirmed meal-plan start arrives.
  // Freshly generated plans have meal_plan_started_on = null → on hold BY
  // DEFAULT (they don't show active content until the coach sets a start
  // date or makes the first menu live). plan_period_start is the authoring
  // anchor, NOT a "started" signal — so it is deliberately not a fallback here.
  const _mealStart = asStr(plan.meal_plan_started_on)
    ? new Date(`${asStr(plan.meal_plan_started_on)}T00:00:00Z`)
    : null;
  const _ppsDate = asStr(plan.plan_period_start)
    ? new Date(`${asStr(plan.plan_period_start)}T00:00:00Z`)
    : null;
  const notStarted = !_mealStart || todayUTC.getTime() < _mealStart.getTime();
  // The future date to count down to on the hold screen: the confirmed meal
  // start if it's still ahead, else a future plan_period_start (a coach who
  // set the authoring date forward but hasn't confirmed the meal start).
  // Null → no committed date yet → the hold screen shows "coach will confirm".
  const _holdDate =
    _mealStart && _mealStart.getTime() > todayUTC.getTime()
      ? _mealStart
      : !_mealStart && _ppsDate && _ppsDate.getTime() > todayUTC.getTime()
        ? _ppsDate
        : null;
  const startsInDays = _holdDate
    ? Math.max(0, Math.ceil((_holdDate.getTime() - todayUTC.getTime()) / 86_400_000))
    : 0;

  // End-game app mode (graduation → maintenance/grace/library). Built from a
  // clean AppModePlan (dates coerced) + the client's maintenance fields. ACTIVE
  // for an in-protocol client → endgame is null and the app renders normally.
  const modePlan: AppModePlan = {
    plan_period_start: asYmd(plan.plan_period_start) || undefined,
    plan_period_weeks: typeof plan.plan_period_weeks === "number" ? plan.plan_period_weeks : undefined,
    meal_plan_started_on: asYmd(plan.meal_plan_started_on) || null,
    supplements_started_on: asYmd(plan.supplements_started_on) || null,
    supersedes: asStr(plan.supersedes) || null,
    status: asStr(plan.status) || null,
  };
  // Record-derived maintenance window — a fresh Razorpay payment lands as a PAID
  // record on Fly before the Mac reconcile folds it into client.yaml; fold it in
  // here so the app reflects the renewal immediately.
  const recordThrough = await latestPaidMaintenanceThrough(clientId).catch(() => null);
  // Quarterly auto-debit subscription offer: available when the Razorpay plan is
  // configured; "active" hides the offer once the client has a live mandate.
  const subAvailable = !!process.env.RAZORPAY_QUARTERLY_PLAN_ID;
  const subInr = Number(process.env.RAZORPAY_QUARTERLY_PLAN_AMOUNT_INR || 6000);
  const subActive = subAvailable ? await hasLiveSubscription(clientId).catch(() => false) : false;
  const { mode: appMode, endgame } = buildEndgame(client, modePlan, tzTodayYmd(appTz), plan.monthly_cards, recordThrough, {
    available: subAvailable,
    inr: subInr,
    active: subActive,
  }, { overrides: travelOverrides, weightLossEnabled });

  return {
    clientId,
    planSlug,
    weightLoss,
    labVault,
    planUpdatedAt,
    clientUpdateNote,
    token,
    timezone: appTz,
    tier: "package",
    discoveryCredit: null,
    discoverySummary: null,
    discoveryStage: null,
    intakeUrl: null,
    mode: appMode,
    endgame,
    labOrders,
    client: {
      firstName,
      program,
      week,
      totalWeeks,
      startDateLabel: startLabel,
      notStarted,
      startsInDays,
      dosha,
      doshaLabel,
      coachLine,
    },
    coach: {
      name: coachName,
      role: "Functional medicine coach",
      initials: "SH",
      whatsappNumber: "918976563971",
      whatsappPrefill: `Hi Shivani, a quick question about my plan —`,
      nextSession,
    },
    today: {
      dow: refUTC.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
      dateLabel: refUTC.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }),
      idx: todayDow,
    },
    weekStrip,
    meals,
    mealExtra,
    weekMenus,
    menuIsSample,
    recipePack,
    grocery,
    swapGroups,
    msqEntries,
    travel,
    supplements,
    upcomingSupplements,
    allSupplements,
    slotOrder: ["Morning", "With meals", "Bedtime"],
    practices: practicesVisible,
    seedCycling,
    periodCare,
    breathwork,
    eft: eftVisible,
    sleep: sleepVisible,
    mindBody,
    principles,
    labs,
    journey,
    faq,
    symptomScore,
    watchList,
    labCheckpoints,
    movementGoalMins: 180,
    remedies,
    remedyLib: visibleLib,
    remedyShelf: visibleShelf,
    tissueSalts,
    coachPicks,
    planRef: {
      pattern: asStr(nutrition.pattern) || "your plan",
      authoredBy: coachName,
      forNote: goals ? `Built for your goals: ${asStrArr(client.goals).slice(0, 3).join(", ").toLowerCase()}` : "Built for you",
      phase: { currentIdx: ribbonIdx >= 0 ? ribbonIdx : 0, list: ribbon },
      plate,
      accents,
      oils,
      foods,
      letterFoods: null,
      avoidWhy,
      cooking,
      focus: { why: focusWhy, conditions: focusConditions },
      ayurveda: focusAyurveda,
      flags,
    },
    mealsNote: sampleWeekNote,
    lessons,
    resources,
    aiSuggested,
    account: {
      name: displayName,
      contact: asStr(client.mobile_number) || asStr(client.email),
      plan: `${program.charAt(0).toUpperCase()}${program.slice(1)} · ${totalWeeks} weeks`,
      member,
      avatar: initials,
      photoUrl,
      collectionAddress: resolveCollectionAddress(client).address,
      collectionPincode: resolveCollectionAddress(client).pincode,
    },
    body,
    reminders,
  };
}
