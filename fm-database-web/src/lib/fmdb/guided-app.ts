/**
 * buildGuidedAppData — a full ClientAppData for a guided-tier subscriber.
 *
 * Modelled directly on buildDiscoveryAppData (client-app.ts L3200): same
 * shape, same empties for everything coach-authored, but the plan-derived
 * fields filled from the subscriber's protocol (guided-protocols.ts).
 *
 * What fills vs stays empty follows the Stage-1 field audit
 * (ochre-funnel docs/APP_STAGE1_FIELD_AUDIT.md): the daily experience —
 * phases, practices, food framework, week math — derives from the protocol;
 * everything personal (supplement schedule, labs, coach lines, body goals)
 * stays deliberately empty. That emptiness is the ₹85,000 boundary, not a gap.
 */

import type { AppMeal, AppRecipe, AppWeekMenu, ClientAppData } from "./client-app";
import { loadLibraryRecipes, splitDishComponents } from "./client-app";
import { deriveSomatic } from "./somatic";
import type { GuidedSubscriber } from "./guided-tier";
import { guidedWeek } from "./guided-tier";
import {
  getGuidedProtocol,
  phaseForWeek,
  alsoActivePhases,
  ALLERGY_OVERRIDE_LINE,
  type GuidedProtocol,
  type GuidedSampleWeek,
} from "./guided-protocols";

const DIET_CHIP: Record<string, { label: string; detail: string }> = {
  vegetarian: {
    label: "Vegetarian",
    detail: "Noted. Every list carries vegetarian alternates — swap like for like.",
  },
  vegetarian_egg: {
    label: "Vegetarian + egg",
    detail: "Noted. Every list carries vegetarian alternates — eggs where they suit you.",
  },
  jain: {
    label: "Jain",
    detail: "Noted. Onion-and-garlic-free alternates are written into the lists.",
  },
  non_vegetarian: {
    label: "Non-vegetarian",
    detail: "Noted — the full lists apply as written.",
  },
};

type Dict = Record<string, unknown>;

const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function tzParts(now: Date, tz: string): { ymd: string; dowIdx: number; dom: number; monthShort: string; dowLong: string } {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const dowLong = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now);
  const monthShort = new Intl.DateTimeFormat("en-GB", { timeZone: tz, month: "long" }).format(now);
  const dom = Number(ymd.slice(8, 10));
  return { ymd, dowIdx: Math.max(0, DOW_LONG.indexOf(dowLong)), dom, monthShort, dowLong };
}

/** Mon-anchored 7-day strip for the header, with today flagged. */
function buildWeekStrip(now: Date, tz: string): { dow: string; num: number; today?: boolean }[] {
  const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const { dowIdx } = tzParts(now, tz); // 0=Sunday
  const monIdx = (dowIdx + 6) % 7; // 0=Monday position of today
  const out: { dow: string; num: number; today?: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + (i - monIdx) * 86_400_000);
    const num = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, day: "2-digit" }).format(d),
    );
    out.push(i === monIdx ? { dow: DOW_SHORT[i], num, today: true } : { dow: DOW_SHORT[i], num });
  }
  return out;
}

function weeksSpanLabel(startWeek: number, endWeek: number): string {
  return startWeek === endWeek ? `Wk ${startWeek}` : `Wk ${startWeek}–${endWeek}`;
}

const SLOT_META: Record<string, { timeHint: string; glyph: string }> = {
  Breakfast: { timeHint: "8:00 – 9:00 am", glyph: "sun" },
  Lunch: { timeHint: "12:30 – 1:30 pm", glyph: "bowl" },
  Evening: { timeHint: "4:30 – 5:30 pm", glyph: "leaf" },
  Dinner: { timeHint: "7:00 – 7:45 pm", glyph: "moon" },
};

const MEAL_GRAD = "linear-gradient(135deg, #4a6152, #31423a)";

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export async function buildGuidedAppData(
  sub: GuidedSubscriber,
  tz: string,
  now: Date = new Date(),
): Promise<ClientAppData | null> {
  const protocol: GuidedProtocol | null = getGuidedProtocol(sub.protocol_slug);
  if (!protocol) return null;

  const t = tzParts(now, tz);
  const rawWeek = guidedWeek(sub.start_date, t.ymd);
  const notStarted = rawWeek === 0;
  const week = Math.min(Math.max(rawWeek, 1), protocol.weeks); // clamp for phase math
  const startsInDays = notStarted
    ? Math.max(0, Math.round((Date.parse(`${sub.start_date}T00:00:00Z`) - Date.parse(`${t.ymd}T00:00:00Z`)) / 86_400_000))
    : 0;
  const { phase, idx: phaseIdx } = phaseForWeek(protocol, week);

  // Practices open at the current week; later ones counted, never listed —
  // same "staging protects, must not read as withholding" rule as package.
  const openDefs = protocol.practices.filter((p) => (p.startWeek ?? 1) <= week);
  const practicesComingLater = protocol.practices.length - openDefs.length;
  const practices = openDefs.map((p, i) => ({
    id: `gp-${i}`,
    name: p.name,
    when: p.cadence,
    ...(p.details ? { details: p.details } : {}),
  }));
  const practiceRaw: Dict[] = openDefs.map((p) => ({
    name: p.name,
    cadence: p.cadence,
    ...(p.somatic_practice ? { somatic_practice: p.somatic_practice } : {}),
  }));
  const somatic = deriveSomatic(practices, practiceRaw);

  const firstName = (sub.display_name || "there").split(/\s+/)[0];
  const initials =
    (sub.display_name || "·")
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "·";

  // ── The food layer — the sample week for the CURRENT headline phase ──────
  // Every dish is an exact catalogue recipe title (guided-protocols.ts rule);
  // the library recipe renders verbatim. No menu for a phase → the principle
  // framework carries the tab, exactly as before.
  const sampleWeek: GuidedSampleWeek | null =
    (protocol.sampleWeeks ?? []).find((w) => w.phase === phase.name) ?? null;

  let weekMenus: AppWeekMenu[] = [];
  let meals: AppMeal[] = [];
  const mealExtra: ClientAppData["mealExtra"] = {};
  let recipePack: AppRecipe[] = [];

  if (sampleWeek) {
    const library = await loadLibraryRecipes();
    const byTitle = new Map(library.map((l) => [normTitle(l.recipe.title), l.recipe]));

    // Per-diet dish pick: non-veg and Jain get their authored overrides;
    // veg + veg-egg run the default (eggs/fish arrive via the swap framework).
    const pickDish = (s: { dish: string; nonveg?: string; jain?: string }): string => {
      if (sub.dietary_preference === "non_vegetarian" && s.nonveg) return s.nonveg;
      if (sub.dietary_preference === "jain" && s.jain) return s.jain;
      return s.dish;
    };

    const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const todayShort = DOW_SHORT[(t.dowIdx + 6) % 7];

    weekMenus = [
      {
        week: 1,
        current: true,
        nourishment: sampleWeek.nourishment,
        days: sampleWeek.days.map((d) => ({
          dow: d.dow,
          today: d.dow === todayShort || undefined,
          slots: d.slots.map((s) => ({
            slot: s.slot,
            dish: pickDish(s),
            components: splitDishComponents(pickDish(s)),
          })),
        })),
      },
    ];

    // Today's meals — the current day's column of the sample week.
    const todayCol = sampleWeek.days.find((d) => d.dow === todayShort) ?? sampleWeek.days[0];
    meals = todayCol.slots.map((s) => {
      const dish = pickDish(s);
      const lib = byTitle.get(normTitle(dish));
      const meta = SLOT_META[s.slot] ?? { timeHint: "", glyph: "bowl" };
      return {
        slot: s.slot,
        timeHint: meta.timeHint,
        glyph: meta.glyph,
        pills: [dish],
        components: splitDishComponents(dish),
        kcal: lib?.kcalPerServing,
      };
    });
    for (const s of todayCol.slots) {
      const lib = byTitle.get(normTitle(pickDish(s)));
      if (!lib) continue;
      mealExtra[s.slot] = {
        grad: MEAL_GRAD,
        imageUrl: lib.imageUrl,
        mins: lib.time,
        serves: lib.serves ?? (lib.servingsNum ? String(lib.servingsNum) : undefined),
        ingredients: lib.ingredients ?? [],
        recipe: lib.method ?? [],
        swaps: [],
      };
    }

    // The pack: every dish used across ALL of this protocol's sample weeks.
    const used = new Set<string>();
    for (const w of protocol.sampleWeeks ?? [])
      for (const d of w.days)
        for (const s of d.slots) {
          used.add(normTitle(s.dish));
          if (s.nonveg) used.add(normTitle(s.nonveg));
          if (s.jain) used.add(normTitle(s.jain));
        }
    recipePack = [...used]
      .map((k) => byTitle.get(k))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        title: r.title,
        serves: r.serves ?? (r.servingsNum ? String(r.servingsNum) : undefined),
        servingsNum: r.servingsNum,
        kcalPerServing: r.kcalPerServing,
        time: r.time,
        ingredients: r.ingredients ?? [],
        ingredientsStructured: r.ingredientsStructured,
        method: r.method ?? [],
        tip: r.tip,
        imageUrl: r.imageUrl,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // ── The practice library — curated catalogue practices, all playable ─────
  // Same deriver as the daily prescriptions (players need motion shapes);
  // client-voiced `line` replaces the catalogue's clinical why on BOTH the
  // library entries and any daily practice that appears in the library.
  const libDefs = (protocol.practiceLibrary ?? []).filter(
    (l) => !openDefs.some((d) => d.somatic_practice === l.slug),
  );
  const libPractices = libDefs.map((l, i) => ({
    id: `gp-lib-${i}`,
    name: l.slug.replace(/-/g, " "),
    when: "Anytime",
  }));
  const libRaw: Dict[] = libDefs.map((l) => ({ somatic_practice: l.slug, cadence: "Anytime" }));
  const librarySomatic = deriveSomatic(libPractices, libRaw).map((s) => {
    const def = libDefs.find((l) => l.slug === s.slug);
    return def ? { ...s, why: def.line } : s;
  });
  const dailySomatic = somatic.map((s) => {
    const def = (protocol.practiceLibrary ?? []).find((l) => l.slug === s.slug);
    return def ? { ...s, why: def.line } : s;
  });
  const allSomatic = [...dailySomatic, ...librarySomatic];

  const startLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "long",
  }).format(new Date(`${sub.start_date}T00:00:00Z`));

  return {
    clientId: sub.subscriber_id,
    planSlug: `guided:${protocol.slug}`,
    token: sub.app_token,
    timezone: tz,
    tier: "guided",
    discoveryCredit: null,
    discoverySummary: null,
    discoveryStage: null,
    intakeUrl: null,
    mode: "ACTIVE",
    endgame: null,
    labOrders: [],
    client: {
      firstName,
      program: protocol.name,
      week,
      totalWeeks: protocol.weeks,
      tenureWeek: week,
      tenureTotalWeeks: protocol.weeks,
      phaseNumber: 1,
      continued: false,
      startDateLabel: startLabel,
      notStarted,
      startsInDays,
      dosha: [],
      doshaLabel: "",
      coachLine: "",
    },
    coach: {
      name: "Shivani",
      role: "Functional medicine coach",
      initials: "SH",
      whatsappNumber: "", // guided has NO WhatsApp access — the ₹85k boundary
      whatsappPrefill: "",
      nextSession: null,
    },
    today: { dow: t.dowLong, dateLabel: `${t.dom} ${t.monthShort}`, idx: t.dowIdx },
    weekStrip: buildWeekStrip(now, tz),
    meals,
    weekMenus,
    menuIsSample: weekMenus.length > 0,
    recipePack,
    grocery: null,
    swapGroups: [],
    msqEntries: [],
    travel: null,
    mealExtra,
    supplements: [],
    upcomingSupplements: [],
    allSupplements: [],
    slotOrder: ["Morning", "With meals", "Bedtime"],
    practices,
    practicesComingLater,
    seedCycling: null,
    periodCare: null,
    breathwork: null,
    somatic: allSomatic,
    eft: null,
    sleep: null,
    mindBody: null,
    mindBodyReads: [],
    mindBodyWithheld: 0,
    principles: protocol.principles,
    labs: [],
    labVault: null,
    journey: [],
    faq: protocol.faq,
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
      pattern: protocol.name,
      authoredBy: "The Ochre Tree",
      forNote: protocol.short,
      phase: {
        currentIdx: phaseIdx,
        list: protocol.phases.map((p) => ({
          name: p.name,
          weeks: weeksSpanLabel(p.startWeek, p.endWeek),
          note: p.note,
        })),
      },
      plate: [],
      accents: [],
      oils: { use: [], avoid: [], note: "" },
      foods: protocol.foods,
      letterFoods: null,
      avoidWhy: `${protocol.foods.avoidWhy} ${ALLERGY_OVERRIDE_LINE}`,
      cooking: [],
      focus: { why: protocol.short, conditions: [] },
      ayurveda: null,
      flags: sub.dietary_preference
        ? [DIET_CHIP[sub.dietary_preference] ?? { label: "Diet noted", detail: "" }]
        : [],
    },
    mealsNote: "",
    lessons: [],
    resources: [],
    aiSuggested: [],
    account: {
      name: sub.display_name,
      contact: sub.email || sub.phone,
      plan: `Guided · ${protocol.name}`,
      member: "",
      avatar: initials,
      photoUrl: null,
      collectionAddress: "",
      collectionPincode: "",
    },
    body: {
      heightCm: null,
      ageYears: null,
      sex: "",
      latest: { weightKg: null, waistCm: null, hipCm: null, bpSystolic: null, bpDiastolic: null, measuredOn: null },
      history: [],
    },
    reminders: [],
    weightLoss: null,
    planUpdatedAt: null,
    clientUpdateNote: null,
    guidedWeekly: {
      title: notStarted
        ? `Week zero — you start Monday ${startLabel}`
        : `${phase.name} · ${weeksSpanLabel(phase.startWeek, phase.endWeek)}`,
      note: phase.note,
      items: phase.actions,
      alsoActive: notStarted ? [] : alsoActivePhases(protocol, week, phaseIdx),
      middayLine: protocol.heroMidday ?? null,
      /** The standard-version disclosure — rendered on every guided surface. */
      standardNote:
        "This is the standard programme. It is not adapted to your labs, history or medications.",
    },
    guidedAbout: protocol.about
      ? {
          ...protocol.about,
          practiceLibraryIds: librarySomatic.map((s) => s.practiceId),
        }
      : null,
  };
}
