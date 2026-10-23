/**
 * Food diary — the COACH's estimate (docs/FOOD_DIARY_PLAN.md §5).
 *
 * Dish names + portions from each photo (the coach's correction wins, else
 * the AI reading) go through the SAME deterministic engine the weekly-menu
 * strip uses (menu-nutrients.ts: recipe match first, then the home-food
 * fallback table with count/size multipliers). Per day → protein, fibre,
 * kcal and a coverage figure; per meal → protein, so the summary can say
 * which meals carry almost none.
 *
 * The floor is `clientProteinFloor` — never a hand-rolled number — so a
 * kidney / liver / urate-flagged client keeps the suppressed, moderate floor
 * (CLAUDE.md v0.76). A prescribed protein powder (`supplementProteinPerDay`)
 * is reported beside the food figure, not hidden inside it.
 *
 * Coach-only. The only thing a client may ever see from here is
 * `gramsByDate`, and only behind food_diary.show_grams (see clientDiaryView).
 */
import {
  FIBRE_FLOOR_G,
  buildRecipeNutrientLookup,
  clientProteinFloor,
  clientWeightKg,
  componentNutrients,
  supplementProteinPerDay,
  type RecipeNutrientLookup,
} from "./menu-nutrients";
import {
  DIARY_BANDS,
  diaryDates,
  entryDishes,
  entryReadState,
  readingUsable,
  type DiaryBand,
  type DiaryEntry,
  type FoodDiaryConfig,
} from "./food-diary";

export interface DiaryDayEstimate {
  date: string;
  dayNumber: number;
  photos: number;
  protein_g: number;
  fibre_g: number;
  kcal: number;
  /** components the engine recognised / components named */
  matched: number;
  components: number;
}

export interface DiaryEstimate {
  days: DiaryDayEstimate[];
  /** Days with at least one photo — averages are over these only. */
  loggedDays: number;
  avgProteinG: number;
  avgFibreG: number;
  proteinFloorG: number;
  proteinSuppressed: boolean;
  proteinSuppressReason: string;
  fibreFloorG: number;
  supplementProteinG: number;
  /** Average food protein per logged day, by part of the day. */
  bandProtein: Partial<Record<DiaryBand, number>>;
  /** 0-1, components recognised / named, across the diary. */
  coverage: number;
  photos: number;
  pending: number;
  unreadable: number;
  /** One line for the coach, the inbox and the session record. */
  line: string;
}

const SIZE_WORD = { small: "small ", regular: "", large: "large " } as const;

/** The component strings the engine sees for one photo. */
export function entryComponents(e: DiaryEntry): string[] {
  if (e.coach_label) return entryDishes(e);
  if (!readingUsable(e.ai_reading)) return [];
  return (e.ai_reading?.dishes ?? [])
    .filter((d) => d && d.name)
    .map((d) => {
      const count = Math.min(6, Math.max(1, Math.round(Number(d.count) || 1)));
      const size = SIZE_WORD[(d.size ?? "regular") as keyof typeof SIZE_WORD] ?? "";
      return `${size}${d.name}${count > 1 ? ` (${count})` : ""}`;
    });
}

function round(n: number): number {
  return Math.round(n);
}

export function diaryEstimate(
  cfg: FoodDiaryConfig,
  entries: readonly DiaryEntry[],
  client: Record<string, unknown> | null,
  plan: Record<string, unknown> | null,
  lookup: RecipeNutrientLookup = buildRecipeNutrientLookup(),
): DiaryEstimate {
  const floor = clientProteinFloor(client, clientWeightKg(client));
  const supplementProteinG = supplementProteinPerDay(plan);
  const bandTotals = new Map<DiaryBand, number>();
  let matchedAll = 0;
  let compsAll = 0;

  const days: DiaryDayEstimate[] = diaryDates(cfg).map((date, i) => {
    const mine = entries.filter((e) => e.date === date);
    let protein = 0;
    let fibre = 0;
    let kcal = 0;
    let matched = 0;
    let components = 0;
    for (const e of mine) {
      for (const c of entryComponents(e)) {
        components += 1;
        const n = componentNutrients(c, lookup);
        if (!n) continue;
        matched += 1;
        protein += n.protein_g;
        fibre += n.fibre_g;
        kcal += n.kcal;
        bandTotals.set(e.band, (bandTotals.get(e.band) ?? 0) + n.protein_g);
      }
    }
    matchedAll += matched;
    compsAll += components;
    return {
      date,
      dayNumber: i + 1,
      photos: mine.length,
      protein_g: round(protein),
      fibre_g: round(fibre),
      kcal: round(kcal),
      matched,
      components,
    };
  });

  const logged = days.filter((d) => d.photos > 0);
  const avg = (k: "protein_g" | "fibre_g") =>
    logged.length ? round(logged.reduce((a, d) => a + d[k], 0) / logged.length) : 0;
  const bandProtein: Partial<Record<DiaryBand, number>> = {};
  for (const b of DIARY_BANDS) {
    if (entries.some((e) => e.band === b)) bandProtein[b] = logged.length ? round((bandTotals.get(b) ?? 0) / logged.length) : 0;
  }
  const states = entries.map(entryReadState);
  const est: DiaryEstimate = {
    days,
    loggedDays: logged.length,
    avgProteinG: avg("protein_g"),
    avgFibreG: avg("fibre_g"),
    proteinFloorG: floor.floorG,
    proteinSuppressed: floor.suppressed,
    proteinSuppressReason: floor.suppressReason,
    fibreFloorG: FIBRE_FLOOR_G,
    supplementProteinG,
    bandProtein,
    coverage: compsAll ? matchedAll / compsAll : 0,
    photos: entries.length,
    pending: states.filter((s) => s === "pending").length,
    unreadable: states.filter((s) => s === "unreadable").length,
    line: "",
  };
  est.line = estimateLine(est);
  return est;
}

/** Meals averaging under this much protein "carry almost none". */
const THIN_MEAL_G = 5;
const MEAL_WORD: Record<DiaryBand, string> = {
  waking: "early morning",
  morning: "breakfast",
  midday: "lunch",
  evening: "dinner",
  bedtime: "late night",
};

/** "~38 g protein/day from food (+20 g whey) vs floor 86 g · fibre ~14 g vs 25 g ·
 *  breakfast and dinner carry almost none · 2 of 14 photos unreadable". */
export function estimateLine(e: DiaryEstimate): string {
  if (e.loggedDays === 0) return "No photos came in.";
  const parts: string[] = [];
  const supp = e.supplementProteinG > 0 ? ` (+${e.supplementProteinG} g from the protein powder)` : "";
  const floorNote = e.proteinSuppressed ? ` (kept moderate — ${e.proteinSuppressReason.replace("_", " ")})` : "";
  parts.push(
    `~${e.avgProteinG} g protein/day from food${supp} vs floor ${e.proteinFloorG} g${floorNote}, over ${e.loggedDays} day${e.loggedDays === 1 ? "" : "s"}`,
  );
  parts.push(`fibre ~${e.avgFibreG} g vs ${e.fibreFloorG} g`);
  const thin = (["morning", "midday", "evening"] as DiaryBand[]).filter(
    (b) => b in e.bandProtein && (e.bandProtein[b] ?? 0) < THIN_MEAL_G,
  );
  if (thin.length) {
    const names = thin.map((b) => MEAL_WORD[b]);
    parts.push(`${names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0]} carr${names.length > 1 ? "y" : "ies"} almost none`);
  }
  if (e.unreadable) parts.push(`${e.unreadable} of ${e.photos} photo${e.photos === 1 ? "" : "s"} unreadable`);
  if (e.pending) parts.push(`${e.pending} not read yet`);
  if (e.coverage < 0.6) parts.push(`rough — ${Math.round(e.coverage * 100)}% of dishes recognised`);
  return parts.join(" · ");
}

/** For the client card, behind show_grams: food protein per diary day. */
export function gramsByDate(est: DiaryEstimate): Record<string, number> {
  return Object.fromEntries(est.days.filter((d) => d.photos > 0).map((d) => [d.date, d.protein_g]));
}


const BAND_NAME: Record<DiaryBand, string> = {
  waking: "Early morning",
  morning: "Breakfast",
  midday: "Lunch",
  evening: "Evening",
  bedtime: "Late night",
};

/** What save-food-diary-summary.py writes as the session's
 *  `food_diary_summary` block. `fingerprint` lets the cron skip a rewrite when
 *  nothing changed. */
export function diarySummaryPayload(cfg: FoodDiaryConfig, entries: readonly DiaryEntry[], est: DiaryEstimate) {
  const meals = entries.map((e) => {
    const day = est.days.find((d) => d.date === e.date)?.dayNumber ?? "?";
    const state = entryReadState(e);
    const what =
      state === "pending"
        ? "(not read yet)"
        : state === "unreadable"
          ? `(couldn't read — ${e.ai_reading?.reason ?? "unclear"})`
          : entryComponents(e).join(", ");
    return `Day ${day} ${BAND_NAME[e.band]} ${e.time}: ${what}${e.coach_label ? " [coach]" : ""}${e.note ? ` — client: "${e.note}"` : ""}`;
  });
  const body = {
    diary_id: cfg.id,
    start: cfg.start,
    days: cfg.days,
    photos: est.photos,
    logged_days: est.loggedDays,
    avg_protein_g: est.avgProteinG,
    avg_fibre_g: est.avgFibreG,
    protein_floor_g: est.proteinFloorG,
    protein_suppressed: est.proteinSuppressed,
    protein_suppress_reason: est.proteinSuppressReason,
    supplement_protein_g: est.supplementProteinG,
    fibre_floor_g: est.fibreFloorG,
    coverage_pct: Math.round(est.coverage * 100),
    unreadable: est.unreadable,
    pending: est.pending,
    line: est.line,
    per_day: est.days.map((d) => ({
      day: d.dayNumber,
      date: d.date,
      photos: d.photos,
      protein_g: d.protein_g,
      fibre_g: d.fibre_g,
    })),
    meals,
  };
  return { ...body, fingerprint: JSON.stringify(body) };
}
