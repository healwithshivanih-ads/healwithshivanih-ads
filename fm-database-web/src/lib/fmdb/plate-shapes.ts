/**
 * Plate shapes — WHICH plate a client sees on the Plan tab.
 *
 * Until 2026-10-23 every client saw the same plate: half vegetables, a quarter
 * protein, a quarter "smart carbs", plus two fixed accents (healthy fats,
 * fermented foods). Only the example chips varied. That was wrong in two ways:
 *
 *   - the SHAPE is part of the protocol. A low-glycaemic plan wants a protein-
 *     forward plate eaten vegetables-first; a gut-repair plan wants everything
 *     cooked and the ferments held back; a Mediterranean-leaning plan wants
 *     the fats promoted. Twenty live plans, one picture.
 *   - the accents ignored the record. A low-histamine plan (cl-004) told the
 *     client to have curd most days; a milk-protein-allergy plan (cl-906) got
 *     "Curd / dahi · Buttermilk" as its fallback chips.
 *
 * One module owns the shapes, the resolver (which shape for this plan) and the
 * builder (what the client sees, safety-filtered). Consumers:
 *   client-app.ts   → `planRef.plate` / `planRef.accents` / `planRef.plateOrder`
 *   guided-app.ts   → the self-guided programmes, mapped by protocol slug
 *   plan-editor.tsx → the "Plate shape" dropdown + its auto preview
 *
 * The STORAGE key is `plan.nutrition.plate_shape` (Pydantic `NutritionPlan`).
 * Unset → the resolver falls back to the attached protocol, then to keywords
 * in the free-text `nutrition.pattern`, then to `balanced`. That fallback
 * chain is what makes the existing plans correct without re-publishing; the
 * coach can pin a shape on any plan to overrule it.
 *
 * Shape ids are storage keys — never rename.
 */
import { type ResolvedDairy, treatsAsAllergy } from "./dairy-reaction";

export const PLATE_SHAPES = [
  "balanced",
  "blood_sugar",
  "gut_soothing",
  "anti_inflammatory",
  "low_histamine",
  "maintenance",
] as const;
export type PlateShape = (typeof PLATE_SHAPES)[number];

export function isPlateShape(v: unknown): v is PlateShape {
  return typeof v === "string" && (PLATE_SHAPES as readonly string[]).includes(v);
}

/** One wedge or accent as the client sees it (mirrors client-app's PlateItem). */
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

interface WedgeDef {
  key: "veg" | "protein" | "carb";
  label: string;
  portion: string;
  pct: number;
  tone: string;
  note: string;
}

interface ShapeDef {
  /** Coach-facing name in the editor dropdown. */
  label: string;
  /** Coach-facing one-liner under the dropdown. */
  coachNote: string;
  /** One warm line for the client under the diagram. */
  clientLine: string;
  wedges: WedgeDef[];
  /** Healthy-fats accent: shown, and promoted (bigger note) or plain. */
  fats: "plain" | "promoted";
  /** Fermented accent: off for the shapes where ferments are held back. */
  ferments: boolean;
  /** Only cooked vegetables on the veg chips (raw salad dropped). */
  cookedVegOnly: boolean;
  /** "Eat in this order" — shown as a line under the plate when set. */
  eatOrder?: string[];
}

const VEG_NOTE = "Cooked or raw, the more colour the better. Half of every plate, every meal.";

export const SHAPE_DEFS: Record<PlateShape, ShapeDef> = {
  balanced: {
    label: "Balanced (default)",
    coachNote: "Half vegetables, a quarter protein, a quarter whole-grain carbs. Fats and ferments on.",
    clientLine: "Half the plate is vegetables because half of health is maintenance.",
    wedges: [
      { key: "veg", label: "Vegetables", portion: "Half your plate", pct: 50, tone: "forest", note: VEG_NOTE },
      { key: "protein", label: "Protein", portion: "A quarter", pct: 25, tone: "ochre", note: "A palm-sized portion at every meal keeps energy even." },
      { key: "carb", label: "Smart carbs", portion: "A quarter", pct: 25, tone: "sand", note: "Millets over refined grains — same comfort, steadier blood sugar." },
    ],
    fats: "plain",
    ferments: true,
    cookedVegOnly: false,
  },
  blood_sugar: {
    label: "Blood sugar — protein-forward",
    coachNote: "Half vegetables, a third protein, a small carb wedge. Vegetables first, then protein, then carbs.",
    clientLine: "Vegetables first, protein next, carbs last — same food, steadier curve.",
    wedges: [
      { key: "veg", label: "Vegetables", portion: "Half your plate", pct: 50, tone: "forest", note: "Start every meal here. Fibre first slows how fast the rest of the plate lands in your blood." },
      { key: "protein", label: "Protein", portion: "A third", pct: 33, tone: "ochre", note: "A generous palm at every meal — protein is what keeps you full and steady between meals." },
      { key: "carb", label: "Smart carbs", portion: "A small wedge", pct: 17, tone: "sand", note: "Last on the plate and the smallest part — millets or whole grains, never liquid or refined." },
    ],
    fats: "plain",
    ferments: true,
    cookedVegOnly: false,
    eatOrder: ["Vegetables", "Protein", "Carbs"],
  },
  gut_soothing: {
    label: "Gut soothing — cooked, gentle",
    coachNote: "Everything cooked and warm. Half soft vegetables, a quarter protein, a quarter well-cooked grain. Ferments held back until you switch them on.",
    clientLine: "Warm, cooked and gentle — your gut heals fastest when it is not asked to work hard.",
    wedges: [
      { key: "veg", label: "Cooked vegetables", portion: "Half your plate", pct: 50, tone: "forest", note: "Cooked soft, never raw for now — steamed, sautéed in ghee or in a sabzi. Raw salads come back later." },
      { key: "protein", label: "Protein", portion: "A quarter", pct: 25, tone: "ochre", note: "Well-cooked and easy to digest — a soft dal, moong, or eggs over heavy legumes for now." },
      { key: "carb", label: "Well-cooked grain", portion: "A quarter", pct: 25, tone: "sand", note: "Rice, well-cooked millet or soft roti — a grain your stomach finds easy, in a modest portion." },
    ],
    fats: "plain",
    ferments: false,
    cookedVegOnly: true,
  },
  anti_inflammatory: {
    label: "Anti-inflammatory — fats promoted",
    coachNote: "Half vegetables, a quarter protein, a quarter whole grains. Good fats are the feature, not a garnish. Ferments on.",
    clientLine: "Colour, good fats and whole food — the plate that quietens inflammation.",
    wedges: [
      { key: "veg", label: "Vegetables", portion: "Half your plate", pct: 50, tone: "forest", note: "The more colours the better — each colour is a different family of plant compounds calming inflammation." },
      { key: "protein", label: "Protein", portion: "A quarter", pct: 25, tone: "ochre", note: "A palm-sized portion at every meal — dal, legumes, eggs or fish keep repair going." },
      { key: "carb", label: "Whole grains", portion: "A quarter", pct: 25, tone: "sand", note: "Whole and unrefined — millets, brown rice, whole wheat. Refined grains feed inflammation." },
    ],
    fats: "promoted",
    ferments: true,
    cookedVegOnly: false,
  },
  low_histamine: {
    label: "Low histamine — no ferments",
    coachNote: "Balanced thirds, freshly cooked. Fermented and aged foods are OFF the plate entirely.",
    clientLine: "Fresh and freshly cooked — the plate that keeps histamine low.",
    wedges: [
      { key: "veg", label: "Vegetables", portion: "Half your plate", pct: 50, tone: "forest", note: "Fresh and freshly cooked — leftovers and anything aged, pickled or fermented raise histamine." },
      { key: "protein", label: "Protein", portion: "A quarter", pct: 25, tone: "ochre", note: "Freshly cooked at every meal — fresh dal, paneer made that day, eggs. Nothing aged or leftover." },
      { key: "carb", label: "Smart carbs", portion: "A quarter", pct: 25, tone: "sand", note: "Millets and whole grains, cooked fresh — same comfort, steadier blood sugar." },
    ],
    fats: "plain",
    ferments: false,
    cookedVegOnly: false,
  },
  maintenance: {
    label: "Maintenance — gentle balance",
    coachNote: "The balanced plate, worded as a habit to keep rather than a programme to follow.",
    clientLine: "The shape you already know — half vegetables, and the rest takes care of itself.",
    wedges: [
      { key: "veg", label: "Vegetables", portion: "Half your plate", pct: 50, tone: "forest", note: "Half of most plates, most days. Not a rule any more — just how you eat." },
      { key: "protein", label: "Protein", portion: "A quarter", pct: 25, tone: "ochre", note: "A palm at every meal keeps the energy you have built." },
      { key: "carb", label: "Smart carbs", portion: "A quarter", pct: 25, tone: "sand", note: "Millets and whole grains most of the time; the occasional treat belongs here too." },
    ],
    fats: "plain",
    ferments: true,
    cookedVegOnly: false,
  },
};

/** Catalogue protocol slug → the plate it implies. Checked before the free
 *  text pattern because an attached protocol is a structured, deliberate
 *  choice. Protocols not listed here (adrenal, liver, cycle-sync, POTS…) have
 *  no plate opinion and fall through. */
export const PROTOCOL_PLATE: Record<string, PlateShape> = {
  "blood-sugar-regulation": "blood_sugar",
  "weight-loss-metabolic-reset": "blood_sugar",
  "5r-gut-protocol": "gut_soothing",
  "great-in-8-gut-healing-protocol": "gut_soothing",
  "h-pylori-protocol": "gut_soothing",
  "low-fodmap-protocol": "gut_soothing",
  "elemental-diet-reset-protocol": "gut_soothing",
  "anti-inflammatory-reset": "anti_inflammatory",
  "autoimmune-paleo-aip": "anti_inflammatory",
  "whole30": "anti_inflammatory",
  "mcas-gentle-first-30-days": "low_histamine",
};

/** Self-guided programme slug (guided-protocols.ts) → plate. */
export const GUIDED_PLATE: Record<string, PlateShape> = {
  "gut-reset": "gut_soothing",
  "blood-sugar-balance": "blood_sugar",
  "energy-stress-recovery": "balanced",
  "anti-inflammatory-reset": "anti_inflammatory",
};

/** Keyword rules over the free-text `nutrition.pattern`. ORDER IS THE
 *  PRIORITY: a pattern naming several things gets the first match. Histamine
 *  is a safety concern so it wins; a blood-sugar brief outranks "gut-
 *  supportive" because most such plans still want protein-forward thirds. */
const PATTERN_RULES: [RegExp, PlateShape][] = [
  [/histamine|mcas|mast.?cell/i, "low_histamine"],
  [/low.?glyc|blood.?sugar|insulin|glyc(a)?emic|protein.?(anchored|forward|first)|low.?refined.?carb|metabolic|diabet|hba1c|pcos/i, "blood_sugar"],
  // "gut-supportive" / "gut-healing" as one adjective among many is NOT this
  // shape — it prescribes cooked-only food and holds the ferments. Needs an
  // active gut-repair brief.
  [/gut.?(sooth|repair)|gastric|gastritis|\b5r\b|fodmap|pylori|manda agni|easy.to.digest|reflux|gerd|sibo|\bibs\b/i, "gut_soothing"],
  [/anti.?inflamm|mediterranean|autoimmun|aip\b/i, "anti_inflammatory"],
];

export type PlateSource = "plan" | "protocol" | "pattern" | "maintenance" | "default";

/** A histamine brief anywhere on the plan — the pattern text or an attached
 *  protocol — holds the ferments off WHATEVER shape wins. Geetika (cl-006)
 *  carries blood-sugar-regulation AND mcas-gentle-first-30-days: the shape is
 *  blood sugar, the ferments stay off. A modifier, not a shape, so the client
 *  keeps the protein-forward plate and the eat order. */
const HISTAMINE = /histamine|mcas|mast.?cell/i;

export interface ResolveInput {
  /** `plan.nutrition.plate_shape` — the coach's pin. */
  plateShape?: unknown;
  attachedProtocols?: unknown;
  /** `plan.nutrition.pattern` free text. */
  pattern?: unknown;
  isMaintenance?: unknown;
}

export interface ResolvedPlate {
  shape: PlateShape;
  source: PlateSource;
  /** Ferments must stay off this plate regardless of shape (histamine brief). */
  holdFerments: boolean;
}

/** Which plate this plan gets, and why. Pure; safe in client components. */
export function resolvePlateShape(input: ResolveInput): ResolvedPlate {
  const protocols = Array.isArray(input.attachedProtocols)
    ? input.attachedProtocols.filter((p): p is string => typeof p === "string").map((p) => p.trim().toLowerCase())
    : [];
  const pattern = typeof input.pattern === "string" ? input.pattern : "";
  const holdFerments = HISTAMINE.test(pattern) || protocols.some((p) => PROTOCOL_PLATE[p] === "low_histamine");
  const pick = (shape: PlateShape, source: PlateSource): ResolvedPlate => ({ shape, source, holdFerments });

  if (isPlateShape(input.plateShape)) return pick(input.plateShape, "plan");
  for (const p of protocols) {
    const s = PROTOCOL_PLATE[p];
    if (s) return pick(s, "protocol");
  }
  if (pattern) {
    for (const [re, shape] of PATTERN_RULES) {
      if (re.test(pattern)) return pick(shape, "pattern");
    }
  }
  if (input.isMaintenance === true) return pick("maintenance", "maintenance");
  return pick("balanced", "default");
}

// ── building the client-facing plate ────────────────────────────────────────

export interface BuildInput {
  /** The plan's `nutrition.add` foods, already shortened for chips. */
  addShort: string[];
  dietPref?: string;
  dairy: ResolvedDairy | null;
  /** foods_to_avoid + known_allergies, as typed. A chip naming any of these is dropped. */
  avoidTerms: string[];
  /** From `resolvePlateShape().holdFerments` — a histamine brief overrides the shape. */
  holdFerments?: boolean;
}

export interface BuiltPlate {
  shape: PlateShape;
  plate: PlateItem[];
  accents: PlateItem[];
  /** "Eat in this order" labels, when the shape has one. */
  eatOrder: string[];
  clientLine: string;
}

const RAW_VEG = /salad|raw|cucumber|lettuce|sprout/i;

/** True when an example chip names something on the client's avoid list.
 *  Word-level, both directions, so "nuts" kills "Walnuts" and "walnut" kills
 *  "Nuts & seeds" — over-dropping a chip costs nothing; under-dropping puts an
 *  allergen on the plate. */
const STOP = new Set(["and", "the", "all", "any", "raw", "with", "from", "cooked", "food", "foods", "products"]);
const stem = (w: string) => w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : ""));
const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w));

function clashes(example: string, avoidTerms: string[]): boolean {
  const ex = example.toLowerCase();
  const exWords = words(ex).map(stem);
  for (const t of avoidTerms) {
    const term = t.toLowerCase().trim();
    if (term.length < 3) continue;
    if (ex.includes(term)) return true;
    for (const w of words(term).map(stem)) {
      if (exWords.some((e) => e.includes(w) || (e.length >= 4 && w.includes(e)))) return true;
    }
  }
  return false;
}

const DAIRY_WORD = /curd|dahi|yog|buttermilk|chaas|paneer|cheese|milk|kefir|lassi|khoa|cream/i;
const GHEE = /ghee/i;

/** Drop examples the record forbids: avoid-list clashes, dairy for a dairy
 *  allergy, ghee when ghee is not tolerated. Lactose intolerance keeps curd,
 *  paneer and ghee (fmdb/plan/dairy.py). */
function safeExamples(list: string[], input: BuildInput): string[] {
  const noDairy = treatsAsAllergy(input.dairy);
  const noGhee = input.dairy ? !input.dairy.gheeOk : false;
  const out: string[] = [];
  for (const e of list) {
    if (!e) continue;
    if (clashes(e, input.avoidTerms)) continue;
    if (noDairy && DAIRY_WORD.test(e)) continue;
    if (noGhee && GHEE.test(e)) continue;
    if (!out.some((o) => o.toLowerCase() === e.toLowerCase())) out.push(e);
  }
  return out;
}

function proteinFallback(input: BuildInput): string[] {
  const pref = (input.dietPref ?? "").toLowerCase();
  const nonVeg = /non.?veg|omni|pescat|chicken|fish|meat/.test(pref) && !/^veg/.test(pref);
  const egg = nonVeg || /egg/.test(pref);
  const vegan = /vegan/.test(pref);
  const base = ["Dal & legumes", "Sprouts", "Nuts & seeds"];
  if (!vegan) base.splice(1, 0, "Curd", "Paneer");
  if (egg) base.push("Eggs");
  if (nonVeg) base.push("Fish / chicken");
  return base;
}

function fermentFallback(input: BuildInput): string[] {
  const noDairy = treatsAsAllergy(input.dairy) || /vegan/i.test(input.dietPref ?? "");
  return noDairy ? ["Kanji", "Idli / dosa batter", "Fermented rice"] : ["Curd / dahi", "Buttermilk"];
}

function pick(input: BuildInput, re: RegExp, max: number): string[] {
  return input.addShort.filter((s) => re.test(s)).slice(0, max);
}

export function buildPlate(shape: PlateShape, input: BuildInput): BuiltPlate {
  const def = SHAPE_DEFS[shape];
  // "Pumpkin seeds and almonds" is a fat, not a vegetable — the seed/nut
  // exclusion runs before the vegetable match.
  let vegEx = pick(input, /greens|palak|methi|amaranth|gourd|lauki|bhindi|veget|sabzi|salad|carrot|beans|cabbage|broccoli|pumpkin|beet/i, 8).filter(
    (v) => !/seed|nut|almond|walnut/i.test(v),
  ).slice(0, 6);
  if (def.cookedVegOnly) vegEx = vegEx.filter((v) => !RAW_VEG.test(v));
  const proteinEx = pick(input, /egg|dal|moong|curd|paneer|seed|legume|chana|rajma|tofu|soya|fish|chicken|sprout|nuts?\b/i, 6);
  const carbEx = pick(input, /ragi|millet|jowar|bajra|rice|oats|quinoa|roti|grain/i, 5);
  const fatEx = pick(input, /ghee|coconut|walnut|flax|sesame|seed|olive|almond|avocado|nuts?\b/i, 6);
  const fermentEx = pick(input, /curd|dahi|buttermilk|ferment|kanji|idli|dosa|kefir/i, 4);

  const vegFallback = def.cookedVegOnly
    ? ["Steamed vegetables", "Seasonal sabzi", "Soft-cooked greens"]
    : ["Leafy greens", "Seasonal sabzi", "Salad vegetables"];
  const examplesFor = (picked: string[], fallback: string[]) => {
    const safe = safeExamples(picked, input);
    return safe.length ? safe : safeExamples(fallback, input);
  };

  const pref = input.dietPref?.trim();
  const plate: PlateItem[] = def.wedges.map((w) => {
    const examples =
      w.key === "veg"
        ? examplesFor(vegEx, vegFallback)
        : w.key === "protein"
          ? examplesFor(proteinEx, proteinFallback(input))
          : examplesFor(carbEx, ["Millets", "Whole grains"]);
    const note =
      w.key === "protein" && pref && shape === "balanced"
        ? `${w.note.replace(/\.$/, "")} — built around your ${pref} diet.`
        : w.note;
    return { key: w.key, label: w.label, portion: w.portion, pct: w.pct, tone: w.tone, examples, note };
  });

  const gheeOk = input.dairy ? input.dairy.gheeOk : true;
  const fatNote =
    def.fats === "promoted"
      ? `Be generous here — a good spoon of ${gheeOk ? "ghee or " : ""}cold-pressed oil on every meal, nuts and seeds most days. These fats are a big part of why this way of eating calms inflammation.`
      : `About a thumb-sized amount per meal — cook in ${gheeOk ? "ghee or " : ""}cold-pressed oil. Fats help you absorb vitamins and stay full.`;
  const accents: PlateItem[] = [
    {
      key: "fats",
      label: "Healthy fats",
      portion: def.fats === "promoted" ? "A good spoon" : "A thumb",
      pct: 0,
      tone: "gold",
      icon: "droplet",
      examples: examplesFor(fatEx, [...(gheeOk ? ["Ghee"] : []), "Cold-pressed oil", "Nuts", "Seeds"]),
      note: fatNote,
    },
  ];
  if (def.ferments && !input.holdFerments) {
    const noDairy = treatsAsAllergy(input.dairy);
    accents.push({
      key: "ferments",
      label: "Fermented",
      portion: "A spoon",
      pct: 0,
      tone: "clay",
      icon: "leaf",
      examples: examplesFor(fermentEx, fermentFallback(input)),
      note: noDairy
        ? "A little fermented food most days — kanji, a fermented batter, fermented rice — feeds the good bacteria in your gut."
        : "A small katori of curd or a glass of buttermilk most days feeds the good bacteria in your gut.",
    });
  }

  return { shape, plate, accents, eatOrder: def.eatOrder ?? [], clientLine: def.clientLine };
}

/** Fraction glyph for a wedge label; "" when the slice has no clean fraction. */
export function fractionGlyph(pct: number): string {
  if (pct >= 48 && pct <= 52) return "½";
  if (pct >= 31 && pct <= 35) return "⅓";
  if (pct >= 23 && pct <= 27) return "¼";
  if (pct >= 15 && pct <= 19) return "⅙";
  return "";
}
