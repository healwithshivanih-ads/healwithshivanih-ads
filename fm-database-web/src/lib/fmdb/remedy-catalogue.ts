/**
 * remedy-catalogue.ts — coach-side remedy catalogue + eligibility gates.
 *
 * The CLIENT app assembles its remedy list inside client-app.ts (heavy).
 * The COACH "Manage remedies" picker needs the same eligible set plus a
 * concern taxonomy (Stress / Sleep / Digestion …) to filter by. Rather than
 * export internals from the big client-app module, this small module
 * re-derives the gates from the same fields — duplication is intentional and
 * documented (engine vs picker), per the alias-aware-lookup precedent.
 *
 * Read-only: pure YAML reads, no API, no writes.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import yaml from "js-yaml";
import { getCataloguePath } from "./paths";

type Dict = Record<string, unknown>;

export interface CatalogueRemedy {
  slug: string;
  name: string;
  also: string;
  category: string;
  route: "internal" | "external";
  summary: string;
  indications: string[];
  /** client-friendly concern labels derived from indications */
  concerns: string[];
  bal: string[];
  agg: string[];
  suitableSex: "any" | "female" | "male";
  suitableStages: string[];
  avoidIn: string[];
  stub: boolean;
}

export interface ClientGates {
  sex: "M" | "F" | "";
  stages: Set<string>;
  dosha: string[];
}

/** Client-facing concern taxonomy. Order = display order of the filter pills. */
export const CONCERNS: { label: string; re: RegExp }[] = [
  { label: "Stress & anxiety", re: /anxiet|stress|nervous|tension|calm|panic|mood/i },
  { label: "Sleep", re: /insomnia|sleep/i },
  { label: "Digestion", re: /digest|bloat|\bgas\b|indigestion|appetite|acidit|nausea|reflux/i },
  { label: "Constipation", re: /constipat|sluggish bowel|elimination|laxative/i },
  { label: "Blood pressure", re: /hypertens|blood pressure|cardiovascular|circulation/i },
  { label: "Blood sugar", re: /blood sugar|glucose|diabet|insulin/i },
  { label: "Energy & fatigue", re: /fatigue|energy|vitality|tired|exhaust|stamina/i },
  { label: "Immunity", re: /immun|cold|cough|infection|congestion|fever/i },
  { label: "Skin", re: /skin|acne|eczema|complexion|rash/i },
  { label: "Hair & scalp", re: /hair|scalp|dandruff/i },
  { label: "Joints", re: /joint|knee|tendon|arthrit|stiffness/i },
  { label: "Hormones & cycle", re: /hormon|menstr|menopaus|\bpms\b|period|\bpcos\b/i },
  { label: "Detox & liver", re: /detox|liver|cleanse/i },
  { label: "Weight", re: /weight|metabolis|obesity/i },
  { label: "Respiratory", re: /respirat|asthma|breath|sinus|throat/i },
];

export function concernsFor(indications: string[]): string[] {
  const hay = indications.join(" | ");
  return CONCERNS.filter((c) => c.re.test(hay)).map((c) => c.label);
}

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function readYaml(p: string): Promise<Dict | null> {
  try {
    const d = yaml.load(await fs.readFile(p, "utf-8"));
    return d && typeof d === "object" ? (d as Dict) : null;
  } catch {
    return null;
  }
}

let cache: CatalogueRemedy[] | null = null;
let cacheAt = 0;

export async function loadAllRemedies(): Promise<CatalogueRemedy[]> {
  if (cache && Date.now() - cacheAt < 60_000) return cache;
  const dir = path.join(getCataloguePath(), "home_remedies");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: CatalogueRemedy[] = [];
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    const d = await readYaml(path.join(dir, name));
    if (!d) continue;
    const slug = asStr(d.slug) || name.replace(/\.ya?ml$/, "");
    const indications = asStrArr(d.indications);
    const summary = asStr(d.summary).replace(/\s+/g, " ").trim();
    out.push({
      slug,
      name: asStr(d.display_name) || humanize(slug),
      also: asStrArr(d.aliases).slice(0, 2).map(humanize).join(" · "),
      category: asStr(d.category) || "other",
      route: asStr(d.route) === "external" ? "external" : "internal",
      summary,
      indications,
      concerns: concernsFor(indications),
      bal: asStrArr(d.balances_dosha),
      agg: asStrArr(d.aggravates_dosha),
      suitableSex: (asStr(d.suitable_sex) as "any" | "female" | "male") || "any",
      suitableStages: asStrArr(d.suitable_stages),
      avoidIn: asStrArr(d.avoid_in),
      stub: !asStr(d.preparation).trim() || /flesh out before clinical use/i.test(summary),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  cache = out;
  cacheAt = Date.now();
  return out;
}

/** Re-derive sex / life-stage / dosha gates from a client record.
 *  Mirrors the logic in client-app.ts loadClientAppData (intentional twin). */
export function deriveClientGates(client: Dict): ClientGates {
  const sex = (asStr(client.sex).trim().toUpperCase().slice(0, 1) as "M" | "F" | "") || "";
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let ageYears: number | null = null;
  const dobStr = asStr(client.date_of_birth);
  if (dobStr) {
    ageYears = Math.floor((todayMs - new Date(`${dobStr}T00:00:00Z`).getTime()) / (365.25 * 86_400_000));
  } else {
    const band = asStr(client.age_band).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (band) ageYears = Math.round((parseInt(band[1], 10) + parseInt(band[2], 10)) / 2);
  }
  const pregnancyStatus = asStr(client.pregnancy_status);
  const isPregnant = /^pregnant/.test(pregnancyStatus);
  const isLactating = pregnancyStatus === "lactating" || !!asStr(client.lactation_started);
  const cycleStatus = asStr(client.cycle_status);
  const stages: string[] = [];
  if (sex === "F") {
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
  const prakruti = asStr(client.ayurveda_constitution) ||
    asStr((client.ayurveda_assessment as Dict)?.prakruti_label);
  let dosha: string[] = [];
  if (/vata/i.test(prakruti)) dosha.push("vata");
  if (/pitta/i.test(prakruti)) dosha.push("pitta");
  if (/kapha/i.test(prakruti)) dosha.push("kapha");
  if (!dosha.length) dosha = asStrArr((client.ayurveda_assessment as Dict)?.vikruti_doshas);
  return { sex, stages: new Set(stages), dosha };
}

/** Hard eligibility gates — same rules the client app applies server-side. */
export function filterEligible(remedies: CatalogueRemedy[], gates: ClientGates): CatalogueRemedy[] {
  return remedies.filter((r) => {
    if (r.suitableSex === "female" && gates.sex !== "F") return false;
    if (r.suitableSex === "male" && gates.sex !== "M") return false;
    if (r.suitableStages.length && !r.suitableStages.some((s) => gates.stages.has(s))) return false;
    if (r.avoidIn.some((s) => gates.stages.has(s))) return false;
    if (gates.dosha.length) {
      if (r.agg.some((d) => gates.dosha.includes(d))) return false;
      if (r.bal.length && !r.bal.some((d) => gates.dosha.includes(d))) return false;
    }
    return true;
  });
}
