import "server-only";
import juice from "juice";
import * as cheerio from "cheerio";

/**
 * Convert a full standalone letter HTML document into a fragment safe to
 * drop inside an email's `html` body.
 *
 * Email clients (Gmail web, Apple Mail, Outlook) do NOT render full HTML
 * documents the way browsers do. They strip `<script>`, often strip
 * external `<link rel="stylesheet">` and `@import url(...)` font imports,
 * silently ignore most `<style>` rules in favour of inline `style=""`
 * attributes, and treat nested `<html>` tags as garbage.
 *
 * What we do:
 *   1. Strip `<script>` blocks — irrelevant in email anyway.
 *   2. Strip `<link rel=stylesheet>` and `@import url(...)` font imports —
 *      neither survives Gmail's CSS sanitiser, and missing fonts trigger
 *      odd fallbacks. The recipient sees Georgia/Arial via the body
 *      style, which is fine.
 *   3. Strip `@media print { … }` blocks — useless inside an email
 *      body, and they bloat the size after inlining.
 *   4. Run juice over the rest — inlines every `<style>` rule that
 *      matches a real element into a `style=""` attribute, then drops
 *      the `<style>` tag. This is the format email clients actually
 *      apply.
 *   5. Extract the `<body>` contents — drops the outer `<html>` /
 *      `<head>` wrapper so the fragment can be concatenated inside an
 *      outer email envelope without producing nested `<html>` tags.
 *
 * Visual fidelity vs the rich browser HTML is intentionally lower —
 * scripts (per-week print buttons, recipe-jump linking) don't run in
 * email, and complex CSS (flexbox horizontal scroll on the supplement
 * timeline) degrades to a vertical list. The full interactive HTML
 * stays available as a download/preview.
 */
export function buildEmailSafeBody(rawHtml: string): string {
  // 0. Bake recipe-anchor links into table cells BEFORE we strip scripts.
  //    The browser version of this letter has a <script> block that walks
  //    `<h3>` headings + meal-plan `<td>` cells and wraps each line in an
  //    <a href="#recipe-x"> anchor. Email clients don't run JS, so the
  //    same logic must run server-side at email-prep time. After this step
  //    the anchors are static HTML and survive the rest of the pipeline.
  let html = bakeRecipeAnchors(rawHtml);

  // 1. drop <script> blocks
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // 2. drop external stylesheet links + @import font imports
  html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*\/?>/gi, "");
  html = html.replace(/@import\s+url\([^)]+\)\s*;?/gi, "");

  // 3. strip @media print blocks (balanced-brace walk; regex alone can't
  //    handle the nested rules inside @media)
  html = stripBalancedAtRule(html, /@media\s+print\s*\{/i);

  // 3b. drop universal-selector resets (`* { … }`, `*, *::before, *::after
  //     { … }`). They're useful in browsers but in email they explode into
  //     hundreds of identical `box-sizing/margin/padding` inline attrs that
  //     push the message past Gmail's ~102KB "clipped" threshold. Email
  //     clients have their own sane defaults; the reset is unnecessary.
  html = html.replace(
    /\*(?:\s*,\s*\*(?:::?[a-z-]+)?)*\s*\{[^}]*\}/gi,
    "",
  );

  // 4. inline remaining CSS via juice
  let inlined: string;
  try {
    inlined = juice(html, {
      removeStyleTags: true,
      preserveImportant: true,
      preserveMediaQueries: false,
      // Don't fetch external resources during inlining — keeps the
      // transform local, deterministic, and offline-safe.
      webResources: { images: false, scripts: false, links: false },
    });
  } catch {
    // If juice ever throws (malformed CSS, etc.), fall back to the
    // pre-processed HTML — recipient sees less-styled but still readable
    // content rather than nothing.
    inlined = html;
  }

  // 5. extract <body>…</body>
  const m = inlined.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (m ? m[1] : inlined).trim();
}

// ── Recipe-anchor baking ─────────────────────────────────────────────────
// Mirrors the runtime <script> in scripts/brand_html.py that builds recipe
// jump-links in the meal-plan tables. Email clients can't run that script,
// so we apply the same logic server-side at email-prep time.

const RECIPE_SYMBOL = "✦";

function searchKey(text: string): string {
  return text
    .replace(new RegExp(RECIPE_SYMBOL, "g"), "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recipeKeyWords(text: string): string[] {
  return searchKey(text)
    .split(" ")
    .filter((w) => w.length > 2);
}

function recipeSlug(text: string): string {
  return (
    "recipe-" +
    text
      .replace(new RegExp(RECIPE_SYMBOL, "g"), "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
  );
}

interface RecipeIndex {
  id: string;
  key: string;       // lowercased name with parentheticals stripped
  words: string[];   // 3+ char tokens
  name: string;      // original heading text
}

function bakeRecipeAnchors(html: string): string {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html, null, false);
  } catch {
    return html; // malformed HTML — leave untouched
  }

  // Inline page-break hints on week sections and the supplement schedule.
  // The runtime "🖨 Print: Week 1 / Week 2 / 💊 Supplements" buttons can't
  // work inside an email (no JS execution), but if the recipient prints
  // the whole email, these CSS rules ensure each week + the schedule
  // start on their own page — they can pick a page range in the print
  // dialog to grab just one section. We use `break-before: page` (modern
  // standard) plus `page-break-before: always` (legacy fallback) since
  // email-rendering engines vary in which they honour.
  const PRINT_BREAK = "break-before:page;page-break-before:always;";
  $(".week-section, #supplement-schedule").each((_, el) => {
    const $el = $(el);
    const existing = $el.attr("style") ?? "";
    $el.attr(
      "style",
      existing ? `${PRINT_BREAK}${existing}` : PRINT_BREAK,
    );
  });

  // Index recipe-style h3 headings — same heuristic as the runtime JS:
  // start with ✦ OR start with a letter/digit (i.e. not an emoji-prefixed
  // section divider like "🌙 Night Hunger"), AND ≥ 2 words after stripping
  // ✦ + parentheticals.
  const recipes: RecipeIndex[] = [];
  $("h3").each((_, el) => {
    const $h3 = $(el);
    const raw = $h3.text().trim();
    if (!raw) return;
    const startsWithSymbol = raw.charAt(0) === RECIPE_SYMBOL;
    const startsWithAlnum = /^[A-Za-z0-9]/.test(raw);
    if (!startsWithSymbol && !startsWithAlnum) return;
    const key = searchKey(raw);
    const words = recipeKeyWords(raw);
    if (!key || words.length < 2) return;
    const id = recipeSlug(raw);
    $h3.attr("id", id);
    recipes.push({ id, key, words, name: raw });
  });

  if (recipes.length === 0) return $.html();

  // Longest key first so substring matching prefers more specific names.
  recipes.sort((a, b) => b.key.length - a.key.length);

  const bestRecipeFor = (plain: string): RecipeIndex | null => {
    const t = plain.toLowerCase();
    let best: RecipeIndex | null = null;
    let bestScore = 0;
    for (const r of recipes) {
      let score = 0;
      if (t.indexOf(r.key) !== -1) score += 5;
      for (const w of r.words) if (t.indexOf(w) !== -1) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return bestScore >= 5 || bestScore >= 2 ? best : null;
  };

  // Per-line link wrapping in every meal-plan table cell. Split each cell
  // on <br>, score per segment, wrap whole segment in a single anchor.
  $("td").each((_, td) => {
    const $td = $(td);
    if (!/[A-Za-z]/.test($td.text())) return;
    const inner = $td.html() ?? "";
    if (!inner) return;
    const parts = inner.split(/(<br\s*\/?\s*>)/gi); // alternating text, <br>, text
    let changed = false;
    const rebuilt = parts.map((part) => {
      if (/^<br\s*\/?\s*>$/i.test(part)) return part;
      const plain = part
        .replace(/<[^>]+>/g, "")
        .replace(new RegExp(RECIPE_SYMBOL, "g"), "")
        .trim();
      if (plain.length < 3) return part;
      const r = bestRecipeFor(plain);
      if (!r) return part;
      const cleaned = part
        .replace(new RegExp(`\\s*${RECIPE_SYMBOL}\\s*`, "g"), " ")
        .replace(/^\s+|\s+$/g, "");
      if (!cleaned) return part;
      changed = true;
      const safeName = r.name.replace(/"/g, "&quot;");
      return `<a href="#${r.id}" style="color:#2B2D42;text-decoration:underline;" title="Jump to recipe: ${safeName}">${cleaned}</a>`;
    });
    if (changed) $td.html(rebuilt.join(""));
  });

  return $.html();
}

/**
 * Walk `html` removing every occurrence of an at-rule matched by `openRe`
 * (e.g. `@media print {`) along with the balanced `{ … }` block that
 * follows it. Used because regex can't reliably match balanced braces
 * inside CSS that has nested rules of its own.
 */
function stripBalancedAtRule(html: string, openRe: RegExp): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    openRe.lastIndex = 0;
    const rest = html.slice(i);
    const m = rest.match(openRe);
    if (!m || m.index === undefined) {
      out += rest;
      break;
    }
    const start = i + m.index;
    out += html.slice(i, start);
    // Skip past the rule and its `{ … }` body using brace balance.
    let depth = 1;
    let j = start + m[0].length;
    while (j < html.length && depth > 0) {
      const c = html[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    i = j;
  }
  return out;
}
