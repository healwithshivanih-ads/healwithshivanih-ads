/* ======================================================================
   Travel / festival / situation foods — the "C" tier of the render cascade
   ----------------------------------------------------------------------
   Reads the hand-authored scripts/travel_foods.yaml and GATES each food to
   one client's plan deterministically (no AI). Returns a small guide the
   app travel card renders directly.

   Cascade (built incrementally): pre-authored (A) → curated+gated (C) →
   on-demand copilot (B). This module is C. A/B slot in later by checking
   their sources before falling through to resolveTravelGuide().

   Gating: drop foods the client's diet can't eat, then drop foods that
   `contains` anything the client is allergic to / avoids. Survivors carry
   their plan-language `why`. See the YAML header for the tag vocabulary.
   ====================================================================== */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export type GatedFood = { food: string; why: string };

export type TravelGuide = {
  /** Card heading, e.g. "Eating in Australia, on your plan". */
  title: string;
  /** Optional one-line context (festival / situation framing). */
  note?: string;
  /** Plan-gated foods to build meals around (already capped). */
  eat: GatedFood[];
  /** Shown as-is — easy to over-order while away. */
  goEasy: string[];
  /** Which cascade tier produced this:
   *  "pre_authored" = coach/AI generated for this client (A),
   *  "copilot"      = client asked for it on demand (B),
   *  "curated"      = the deterministic dataset floor (C). */
  source: "curated" | "pre_authored" | "copilot";
};

type RawFood = { food?: string; diet?: string; contains?: string[]; why?: string };
type RawSection = { label?: string; aliases?: string[]; note?: string; eat?: RawFood[]; go_easy?: string[] };
type Dataset = {
  destinations?: Record<string, RawSection>;
  festivals?: Record<string, RawSection>;
  situations?: Record<string, RawSection>;
};

let _cache: Dataset | null = null;

async function loadDataset(): Promise<Dataset> {
  if (_cache) return _cache;
  try {
    const p = path.resolve(process.cwd(), "scripts", "travel_foods.yaml");
    const raw = await fs.readFile(p, "utf-8");
    const d = yaml.load(raw);
    _cache = d && typeof d === "object" ? (d as Dataset) : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

type DietClass = "vegan" | "jain" | "veg" | "egg" | "nonveg";

function classifyDiet(pref: string): DietClass {
  const p = (pref || "").toLowerCase();
  if (/vegan/.test(p)) return "vegan";
  if (/jain/.test(p)) return "jain";
  if (/non[\s-]?veg|nonveg/.test(p)) return "nonveg"; // checked before plain "veg"
  if (/egg/.test(p)) return "egg";
  if (/veg/.test(p)) return "veg";
  return "veg"; // safe default — never surprise a veg client with meat
}

const DIET_ALLOWS: Record<DietClass, Set<string>> = {
  vegan: new Set(["vegan"]),
  jain: new Set(["vegan", "veg"]),
  veg: new Set(["vegan", "veg"]),
  egg: new Set(["vegan", "veg", "egg"]),
  nonveg: new Set(["vegan", "veg", "egg", "nonveg"]),
};

// Map a client avoid / allergy phrase → the `contains` tokens it blocks.
const SENSITIVITY_MAP: { re: RegExp; token: string }[] = [
  { re: /milk|dairy|lactose|casein|curd|paneer|cheese|yog/, token: "dairy" },
  { re: /gluten|wheat|maida|atta/, token: "gluten" },
  { re: /onion|garlic/, token: "onion_garlic" },
  { re: /\begg/, token: "egg" },
  { re: /soy|tofu|edamame/, token: "soy" },
  { re: /\bnut|almond|cashew|walnut|peanut|pista/, token: "nuts" },
  { re: /fish|seafood|prawn|shrimp|shellfish/, token: "fish" },
  { re: /tomato|nightshade|brinjal|eggplant|capsicum/, token: "nightshade" },
];

function blockedTokens(avoidTerms: string[], diet: DietClass): Set<string> {
  const blocked = new Set<string>();
  const joined = avoidTerms.join(" ").toLowerCase();
  for (const { re, token } of SENSITIVITY_MAP) {
    if (re.test(joined)) blocked.add(token);
  }
  if (diet === "jain") {
    blocked.add("onion_garlic");
    blocked.add("root");
  }
  if (diet === "vegan") blocked.add("dairy");
  return blocked;
}

function gateFoods(
  foods: RawFood[],
  diet: DietClass,
  blocked: Set<string>,
  allergyTerms: string[],
  cap: number,
): GatedFood[] {
  const allowed = DIET_ALLOWS[diet];
  const out: GatedFood[] = [];
  for (const f of foods) {
    if (!f || !f.food) continue;
    const fdiet = (f.diet || "veg").toLowerCase();
    if (!allowed.has(fdiet)) continue;
    const contains = (f.contains || []).map((c) => String(c).toLowerCase());
    if (contains.some((c) => blocked.has(c))) continue;
    // belt-and-braces: drop if the food name itself names an allergy term
    const nameLc = f.food.toLowerCase();
    if (allergyTerms.some((a) => a.length >= 3 && nameLc.includes(a))) continue;
    out.push({ food: f.food, why: f.why || "" });
    if (out.length >= cap) break;
  }
  return out;
}

function matchSection(
  sections: Record<string, RawSection> | undefined,
  location: string,
): RawSection | null {
  if (!sections) return null;
  const loc = location.toLowerCase().trim();
  if (!loc) return null;
  for (const [key, sec] of Object.entries(sections)) {
    const aliases = [key, ...(sec.aliases || [])].map((a) => String(a).toLowerCase());
    if (aliases.some((a) => a.length >= 2 && (loc.includes(a) || a.includes(loc)))) {
      return sec;
    }
  }
  return null;
}

/** Resolve the curated, plan-gated food guide for a travel/festival/illness
 *  window. Returns null when there's no dataset match or nothing survives the
 *  gate — the card then falls back to its generic rules (and, later, copilot). */
export async function resolveTravelGuide(opts: {
  kind: "travel" | "festival" | "illness";
  location: string;
  dietPref: string;
  avoidTerms: string[];
}): Promise<TravelGuide | null> {
  const ds = await loadDataset();
  const diet = classifyDiet(opts.dietPref);
  const allergyTerms = opts.avoidTerms.map((t) => t.toLowerCase().trim()).filter(Boolean);
  const blocked = blockedTokens(opts.avoidTerms, diet);

  let section: RawSection | null = null;
  let title = "";
  if (opts.kind === "illness") {
    section = ds.situations?.unwell ?? null;
    title = section?.label || "Under the weather";
  } else if (opts.kind === "festival") {
    section = matchSection(ds.festivals, opts.location);
    if (section) title = `${section.label || "Festival"} — on your plan`;
  } else {
    section = matchSection(ds.destinations, opts.location);
    if (section) title = `Eating in ${section.label || opts.location}, on your plan`;
  }
  if (!section) return null;

  const eat = gateFoods(section.eat || [], diet, blocked, allergyTerms, 6);
  if (eat.length === 0) return null;
  return {
    title,
    note: section.note,
    eat,
    goEasy: (section.go_easy || []).slice(0, 4),
    source: "curated",
  };
}

/** Coerce a cached guide read back from a travel_response.local_foods blob
 *  (produced by generate-travel-guide.py — the A/B tiers) into a TravelGuide.
 *  Returns null if it's missing/empty so the cascade falls through to curated. */
export function coerceGuide(raw: unknown): TravelGuide | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const eatRaw = Array.isArray(r.eat) ? r.eat : [];
  const eat: GatedFood[] = eatRaw
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => x.food)
    .map((x) => ({ food: String(x.food), why: x.why ? String(x.why) : "" }))
    .slice(0, 8);
  const title = r.title ? String(r.title) : "";
  if (!title || eat.length === 0) return null;
  const goEasyRaw = (r.go_easy ?? r.goEasy) as unknown;
  const goEasy = Array.isArray(goEasyRaw) ? goEasyRaw.map(String).slice(0, 5) : [];
  const src = r.source;
  return {
    title,
    note: r.note ? String(r.note) : undefined,
    eat,
    goEasy,
    source: src === "copilot" ? "copilot" : "pre_authored",
  };
}
