/**
 * Build the catalogue chip dictionary used by FmCoachNotes to detect
 * inline mentions of supplements / mechanisms / conditions / markers
 * in the AI's notes_for_coach prose.
 *
 * Server-side helper — walks the live catalogue under
 * fm-database/data/{supplements,mechanisms,topics,symptoms,lab_tests}/
 * and constructs a list of { term, kind, slug } entries that FmCoachNotes
 * runs against each paragraph at render time.
 *
 * Trade-offs:
 *   - We DO NOT include claims (1,492 entries, ~all prose statements
 *     that would chip-match noisy fragments)
 *   - We DO NOT include short or generic terms (<= 3 chars or in the
 *     stopword list) — "PCOS" is fine, "diet" is not
 *   - We sort by term length DESC so longer phrases win over shorter
 *     prefixes (FmCoachNotes already drops overlaps, but feeding the
 *     longer-first list keeps the kept-match heuristic stable)
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath } from "./paths";
import type { CatalogueChip } from "@/components/fm";

/** Module-level cache. Catalogue is hundreds of files; re-reading on
 *  every Plan-tab render would be wasteful. NextJS dev resets this on
 *  HMR; in production it lives for the process lifetime which is
 *  fine — the coach restarts via pm2 when the catalogue changes. */
let CACHED: CatalogueChip[] | null = null;
let CACHE_BUILD_AT = 0;
const CACHE_TTL_MS = 60_000; // 1 min — let dev edits feed through quickly

/** Words too short, too generic, or too noisy to chip-link. Hand-picked
 *  for FM notes — extend as false positives surface. */
const STOPWORDS = new Set([
  "all", "and", "any", "are", "but", "can", "day", "did", "for", "get",
  "had", "has", "her", "him", "his", "how", "its", "let", "low", "may",
  "new", "not", "now", "off", "old", "one", "our", "out", "she", "the",
  "too", "top", "two", "use", "via", "was", "way", "who", "why", "yes",
  // FM-noisy
  "diet", "food", "good", "high", "load", "plan", "take", "test", "time",
  "well", "work", "year", "week", "form", "dose", "side", "side", "rate",
  "case", "type", "many", "more", "most", "less", "best", "long",
]);

interface CatalogueDoc {
  slug?: string;
  display_name?: string;
  aliases?: string[];
  /** lab_tests carry an explicit match_keys list */
  match_keys?: string[];
}

interface SourceSpec {
  dir: string;
  kind: CatalogueChip["kind"];
}

const SOURCES: SourceSpec[] = [
  { dir: "supplements", kind: "supplement" },
  { dir: "mechanisms", kind: "mechanism" },
  // Topics are the "condition" surface in the catalogue — chips link to
  // /catalogue/topics/<slug> on the client side.
  { dir: "topics", kind: "condition" },
  // Symptoms get the "topic" palette (neutral); they're informational
  // not actionable. Could be promoted to a `symptom` kind later.
  { dir: "symptoms", kind: "topic" },
  { dir: "lab_tests", kind: "marker" },
];

/** Escape regex specials in a term that came from a slug / display_name. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a chip-friendly regex SOURCE for a phrase. We emit the regex as
 *  a string because the RSC → Client Components boundary refuses RegExp
 *  objects (the FmCoachNotes component re-builds the RegExp from
 *  source + flags at render time).
 *
 *  Word-boundaries on alphanum edges so "ferritin" doesn't match inside
 *  "ferritinaemia" but allows non-word neighbours (punctuation / numbers
 *  / units). Lookarounds work on non-ASCII too. */
function termSource(phrase: string): string {
  const escaped = escapeRe(phrase);
  return `(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`;
}

/** Is a candidate phrase usable as a chip term?
 *  Strips out anything too short / generic / unsafe. */
function isUsable(phrase: string): boolean {
  const t = phrase.trim();
  if (t.length < 4) return false;
  if (/^\d+$/.test(t)) return false; // pure number
  // Single-word stopwords
  if (/^[a-z]+$/i.test(t) && STOPWORDS.has(t.toLowerCase())) return false;
  return true;
}

/** Convert slug ("magnesium-glycinate") to a human-readable phrase
 *  ("magnesium glycinate") that the AI is likely to write. */
function slugToPhrase(slug: string): string {
  return slug.replace(/-/g, " ").trim();
}

async function loadDir(catRoot: string, dir: string): Promise<CatalogueDoc[]> {
  const full = path.join(catRoot, dir);
  let entries: string[];
  try {
    entries = await fs.readdir(full);
  } catch {
    return [];
  }
  const out: CatalogueDoc[] = [];
  for (const f of entries) {
    if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
    try {
      const raw = await fs.readFile(path.join(full, f), "utf8");
      const doc = yaml.load(raw) as CatalogueDoc | null;
      if (doc?.slug) out.push(doc);
    } catch {
      // skip bad files
    }
  }
  return out;
}

/** Build (or return cached) chip dictionary.
 *  ~30-50ms on first call against the live catalogue, sub-ms thereafter
 *  until the TTL elapses. */
export async function loadCatalogueChipDict(): Promise<CatalogueChip[]> {
  const now = Date.now();
  if (CACHED && now - CACHE_BUILD_AT < CACHE_TTL_MS) return CACHED;

  const catRoot = getCataloguePath();
  const all: CatalogueChip[] = [];
  // Dedup terms — same phrase appearing under multiple entries collapses
  // to the first one seen, prioritised by the SOURCES ordering above
  // (supplements > mechanisms > conditions > symptoms > markers).
  const seen = new Set<string>();

  function pushTerm(phrase: string, kind: CatalogueChip["kind"], slug: string) {
    if (!isUsable(phrase)) return;
    const key = phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    all.push({ term: termSource(phrase), flags: "gi", kind, slug });
  }

  for (const src of SOURCES) {
    const docs = await loadDir(catRoot, src.dir);
    for (const doc of docs) {
      const slug = doc.slug as string;
      // Display name first — it's the canonical human form
      if (doc.display_name) pushTerm(doc.display_name, src.kind, slug);
      // Aliases
      for (const a of doc.aliases ?? []) pushTerm(a, src.kind, slug);
      // match_keys for lab_tests
      for (const k of doc.match_keys ?? []) pushTerm(k, src.kind, slug);
      // The slug itself as a phrase ("hpa-axis-dysregulation" → "hpa axis dysregulation")
      const fromSlug = slugToPhrase(slug);
      if (fromSlug && fromSlug !== doc.display_name?.toLowerCase()) {
        pushTerm(fromSlug, src.kind, slug);
      }
    }
  }

  // Sort by term-source length DESC so longer phrases get matched first
  // when FmCoachNotes's overlap-rejection pass runs. After this point the
  // term field is always a string (set by pushTerm above), so length is
  // a safe read.
  all.sort((a, b) => {
    const al = typeof a.term === "string" ? a.term.length : a.term.source.length;
    const bl = typeof b.term === "string" ? b.term.length : b.term.source.length;
    return bl - al;
  });

  CACHED = all;
  CACHE_BUILD_AT = now;
  return all;
}
