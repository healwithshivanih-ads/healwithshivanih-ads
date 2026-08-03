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

import type { ClientAppData } from "./client-app";
import { deriveSomatic } from "./somatic";
import type { GuidedSubscriber } from "./guided-tier";
import { guidedWeek } from "./guided-tier";
import { getGuidedProtocol, phaseForWeek, alsoActivePhases, ALLERGY_OVERRIDE_LINE, type GuidedProtocol } from "./guided-protocols";

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

export function buildGuidedAppData(
  sub: GuidedSubscriber,
  tz: string,
  now: Date = new Date(),
): ClientAppData | null {
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
    practices,
    practicesComingLater,
    seedCycling: null,
    periodCare: null,
    breathwork: null,
    somatic,
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
      /** The standard-version disclosure — rendered on every guided surface. */
      standardNote:
        "This is the standard programme. It is not adapted to your labs, history or medications.",
    },
  };
}
