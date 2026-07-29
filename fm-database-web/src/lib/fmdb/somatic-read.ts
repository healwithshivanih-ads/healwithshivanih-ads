/**
 * The chief-complaint read, for the CLIENT app.
 *
 * A TS mirror of `fmdb/assess/somatic_read.py`. The coach surface calls that
 * Python through a shim; the client app cannot — `client-app.ts` never shells
 * out, it reads the catalogue off disk — so the matching is duplicated here on
 * purpose, the same way `lab-nutrient-priorities.ts` mirrors its Python.
 * KEEP THE TWO IN LOCKSTEP; `somatic-read.test.ts` pins this against output
 * captured from the real Python on real client records.
 *
 * WHY IT MUST BE A MIRROR AND NOT A REWRITE. Matching a free-text condition is
 * subtler than it looks, and one shortcut is already ruled out: resolving only
 * the slugs that somatic maps target, rather than the whole catalogue. Eleven
 * map targets — `hypertension`, `migraine`, `asthma`, `palpitations` among them
 * — are ALSO aliases of some other entity, so a reduced index resolves them
 * differently from the full one. Building the full index costs 42ms for 947
 * files, once per process. Fidelity is cheaper than the bug.
 *
 * The gate is elsewhere. This module answers "what does the book say about
 * what this client came in for"; it does NOT decide what the client may see.
 * That is `client-app.ts`, against the map's sensitivity and the client's own
 * `mind_body_depth`.
 */

import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { getCataloguePath } from "./paths";

type Dict = Record<string, unknown>;

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(asStr).filter(Boolean) : [];

/** Words that carry no clinical meaning when matching a condition string. */
const NOISE = new Set([
  "suspected", "confirmed", "possible", "probable", "mild", "moderate", "severe",
  "chronic", "acute", "on", "off", "treatment", "previously", "unreported",
  "and", "or", "the", "a", "of", "with", "in", "at", "to", "for", "non", "now",
  "history", "past", "current", "ongoing", "recurrent", "grade", "type",
]);

/**
 * Candidate lookup keys from one free-text condition, longest first.
 *
 * Real entries look like "Hypertension — ON TREATMENT (previously unreported)
 * — Telma 40 twice daily". The clinical name is almost always the head, before
 * the first dash, comma, colon or bracket.
 */
export function conditionPhrases(condition: string): string[] {
  const head = String(condition).split(/[—–\-(,:;/]/)[0].replace(/\s+/g, " ").trim().toLowerCase();
  if (!head) return [];
  const words = (head.match(/[a-z0-9']+/g) ?? []).filter((w) => !NOISE.has(w));
  const out: string[] = [];
  if (words.length) {
    out.push(words.join("-"));                       // full head
    for (const n of [3, 2]) {                        // leading n-grams
      if (words.length > n) out.push(words.slice(0, n).join("-"));
    }
    if (words.length > 1) out.push(words[words.length - 1]);  // trailing noun
    out.push(words[0]);
  }
  // de-dup, keep order, drop 1-2 char keys which match noisily
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const k of out) {
    if (k.length > 2 && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

export interface SomaticRoot {
  pattern: string;
  note: string;
}

export interface ChiefRead {
  /** the condition exactly as the coach wrote it */
  condition: string;
  targetSlug: string;
  mapSlug: string;
  displayName: string;
  sensitivity: string;
  /** coach_only_note is set — never auto-surface, whatever the depth */
  gated: boolean;
  roots: SomaticRoot[];
  reframe: string;
  inquiryQuestion: string;
  somaticPractice: string;
  differentialNote: string;
}

/** Safe to surface unsupervised, at the client's `full` depth. */
export function isClientSafe(r: ChiefRead): boolean {
  return r.sensitivity === "general" && !r.gated;
}

/* ---- catalogue indexes, built once per process ------------------------ */

function readDir(dir: string): Dict[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort();
  } catch {
    return [];
  }
  const out: Dict[] = [];
  for (const n of names) {
    try {
      const d = yaml.load(fs.readFileSync(path.join(dir, n), "utf8"));
      if (d && typeof d === "object") out.push(d as Dict);
    } catch {
      /* a malformed entry must not take the whole read down */
    }
  }
  return out;
}

/**
 * {slug-or-alias → canonical-slug}. Mirrors `validator._resolve_index`,
 * including its conflict policy: a canonical slug always wins over an alias
 * that would shadow it.
 */
function resolveIndex(items: Dict[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const it of items) {
    const canonical = asStr(it.slug);
    if (!canonical) continue;
    index.set(canonical, canonical);
  }
  for (const it of items) {
    const canonical = asStr(it.slug);
    if (!canonical) continue;
    for (const alias of asStrArr(it.aliases)) {
      // Don't let an alias shadow another entity's canonical slug
      if (!index.has(alias) || index.get(alias) !== alias) index.set(alias, canonical);
    }
  }
  return index;
}

interface Catalogue {
  resolve: (s: string) => string;
  byTarget: Map<string, Dict>;
}

let CACHE: Catalogue | null = null;

/** Exposed for tests, which need a clean build after changing the fixture root. */
export function _resetSomaticCache(): void {
  CACHE = null;
}

function catalogue(): Catalogue {
  if (CACHE) return CACHE;
  const root = getCataloguePath();
  const sym = resolveIndex(readDir(path.join(root, "symptoms")));
  const top = resolveIndex(readDir(path.join(root, "topics")));
  // symptoms first, then topics — the same precedence somatic-read.py uses
  const resolve = (s: string) => sym.get(s) ?? top.get(s) ?? s;

  const byTarget = new Map<string, Dict>();
  for (const m of readDir(path.join(root, "somatic_maps"))) {
    // the TARGET is resolved too: a map on `hypertension` lands under
    // `high-blood-pressure`, which is what a client's condition resolves to
    const key = resolve(asStr(m.target_slug));
    if (!byTarget.has(key)) byTarget.set(key, m);
  }
  CACHE = { resolve, byTarget };
  return CACHE;
}

/**
 * Map a client's stated conditions onto catalogue somatic maps.
 *
 * Ordered as the coach wrote the conditions: the first-listed condition is
 * almost always the presenting one.
 */
export function readChiefComplaints(conditions: string[], limit?: number): ChiefRead[] {
  const { resolve, byTarget } = catalogue();
  const out: ChiefRead[] = [];
  const seen = new Set<string>();

  for (const cond of conditions) {
    for (const key of conditionPhrases(cond)) {
      const canon = resolve(key);
      const m = byTarget.get(canon);
      const mapSlug = m ? asStr(m.slug) : "";
      if (!m || seen.has(mapSlug)) continue;
      seen.add(mapSlug);
      out.push({
        condition: String(cond),
        targetSlug: canon,
        mapSlug,
        displayName: asStr(m.display_name),
        sensitivity: asStr(m.sensitivity) || "sensitive",
        gated: asStr(m.coach_only_note).trim().length > 0,
        roots: (Array.isArray(m.emotional_roots) ? m.emotional_roots : []).map((r) => {
          const d = (r ?? {}) as Dict;
          return { pattern: asStr(d.pattern), note: asStr(d.note) };
        }),
        reframe: asStr(m.reframe),
        inquiryQuestion: asStr(m.inquiry_question),
        somaticPractice: asStr(m.somatic_practice),
        differentialNote: asStr(m.differential_note),
      });
      break; // first phrase that resolves wins; don't double-match a condition
    }
    if (limit && out.length >= limit) break;
  }
  return out;
}
