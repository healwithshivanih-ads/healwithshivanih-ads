/**
 * /recipes/<planSlug> — public recipe pack for a plan.
 *
 * The reformat split: recipes used to live in the consolidated letter
 * as a `## ✦ Recipe Appendix` section. That made the letter 30+ pages
 * and clients didn't read past page 5. Recipes now live on their own
 * page, linked from the ✦ symbols in the meal plan tables.
 *
 * Source-of-truth resolution order:
 *   1. `~/fm-plans/clients/<id>/meal-plans/<slug>-recipes.html` (preferred,
 *      coach explicitly generates a recipes letter type).
 *   2. Same path but `.md` — wrap in minimal styling for the iframe.
 *   3. Fall back to extracting the `## ✦ Recipe Appendix` section from
 *      the consolidated letter (for letters generated before the split).
 *   4. Empty state.
 *
 * Auth: none — the plan slug is non-guessable in practice. Same posture
 * as /supplements/<planSlug>.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { lookupLetterToken } from "@/lib/server-actions/letter-token";

export const dynamic = "force-dynamic";

async function loadPublishedPlan(slug: string): Promise<{ client_id?: string } | null> {
  const dir = path.join(getPlansRoot(), "published");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const matches = entries
    .filter((n) => n.startsWith(`${slug}-v`) && (n.endsWith(".yaml") || n.endsWith(".yml")))
    .sort()
    .reverse();
  if (matches.length === 0) return null;
  try {
    const raw = await fs.readFile(path.join(dir, matches[0]), "utf-8");
    return yaml.load(raw) as { client_id?: string };
  } catch {
    return null;
  }
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

/** Newest `<planSlug>…-recipes.<ext>` file in the meal-plans dir.
 *  Covers BOTH the consolidated sidecar (`<slug>-recipes.html`) and the
 *  phase-letter sidecars (`<slug>-meal_plan-wk3-4-recipes.html`) — the
 *  latter was missed entirely by the old exact-match lookup, so phase
 *  recipe packs were unreachable. Newest file = the current pack. */
async function newestRecipeFile(
  dir: string,
  planSlug: string,
  ext: "html" | "md",
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const suffix = `-recipes.${ext}`;
  const matches = entries.filter(
    (n) => n.startsWith(planSlug) && n.endsWith(suffix),
  );
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const name of matches) {
    const full = path.join(dir, name);
    try {
      const st = await fs.stat(full);
      if (!newest || st.mtimeMs > newest.mtimeMs) {
        newest = { path: full, mtimeMs: st.mtimeMs };
      }
    } catch {
      /* unreadable — skip */
    }
  }
  return newest ? newest.path : null;
}

/** Pull the `## ✦ Recipe Appendix` section out of a markdown body. The
 *  appendix is everything from the first Recipe Appendix heading to
 *  either the next top-level `## ` heading or EOF. Emoji-agnostic — the
 *  model varies the heading symbol (✦ / ✨ / ⭐ / none). */
function extractRecipeAppendix(md: string): string | null {
  const re = /^##[^\n]*?Recipe\s*Appendix\b/im;
  const start = md.match(re);
  if (!start || start.index === undefined) return null;
  const after = md.slice(start.index);
  // Find the next `## ` at start of line (excluding the one we just matched).
  const next = after.slice(start[0].length).search(/^##\s/m);
  if (next === -1) return after.trim();
  return after.slice(0, start[0].length + next).trim();
}

function emptyPage(message: string): React.ReactElement {
  return (
    <div
      style={{
        maxWidth: 520,
        margin: "10vh auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        color: "#1f2937",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "#14532d" }}>
        Recipe pack
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: "#6b7280" }}>{message}</p>
    </div>
  );
}

/** Lightweight markdown → HTML wrap. Recipe pack rendering: just enough
 *  to make headings + bullets + bold text readable. Avoids pulling in a
 *  full markdown lib. */
function markdownToBasicHtml(md: string): string {
  // Escape any literal HTML.
  let out = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Headings.
  out = out.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  out = out.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  out = out.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
  // Bold (greedy avoidance: minimal pair).
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Bullet lists.
  out = out.replace(/^(\s*)-\s+(.+)$/gm, "$1<li>$2</li>");
  out = out.replace(/(<li>[\s\S]*?<\/li>(\n<li>[\s\S]*?<\/li>)*)/g, "<ul>$1</ul>");
  // Paragraphs (split on blank lines).
  out = out
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<(h[1-6]|ul|ol|p|div)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");
  return out;
}

const WRAP_CSS = `
  body {
    font-family: system-ui, -apple-system, sans-serif;
    color: #1f2937;
    background: #fafaf9;
    margin: 0;
    padding: 24px 18px 60px;
    line-height: 1.55;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { color: #14532d; font-size: 22px; margin: 0 0 4px; }
  h2 { color: #14532d; font-size: 18px; margin: 28px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  h3 { color: #15803d; font-size: 16px; margin: 18px 0 4px; }
  p { margin: 6px 0; font-size: 14px; }
  ul { margin: 6px 0; padding-left: 22px; font-size: 14px; }
  li { margin: 3px 0; }
  strong { color: #1f2937; }
  .header-sub { font-size: 13px; color: #6b7280; margin-bottom: 18px; }
  .footer { margin-top: 40px; font-size: 11.5px; color: #9ca3af; text-align: center; }
  @media print {
    body { background: white; padding: 8mm; }
    .header-sub, .footer { color: #6b7280; }
  }
`;

export default async function RecipesPage({
  params,
}: {
  params: Promise<{ planSlug: string }>;
}) {
  const { planSlug: routeParam } = await params;
  // Resolve a stable letter_token → the plan's real slug; fall back to treating
  // the param AS the slug (legacy links still work). Token-first means a
  // client's link stays stable even when the letter is regenerated.
  const tok = await lookupLetterToken(routeParam);
  const planSlug = tok.ok ? tok.plan_slug : routeParam;
  const plan = await loadPublishedPlan(planSlug);
  if (!plan?.client_id) {
    return emptyPage(
      "We couldn't find this recipe pack. Ask your coach for an updated link.",
    );
  }

  const mealPlanDir = path.join(
    getPlansRoot(),
    "clients",
    plan.client_id,
    "meal-plans",
  );

  // Preferred: dedicated recipes sidecar. Resolve the NEWEST
  // `<slug>…-recipes.html` — covers the consolidated sidecar AND the
  // phase-letter sidecars (`<slug>-meal_plan-wk3-4-recipes.html`).
  const recipesHtmlPath = await newestRecipeFile(mealPlanDir, planSlug, "html");
  const recipesHtml = recipesHtmlPath
    ? await readIfExists(recipesHtmlPath)
    : null;
  if (recipesHtml) {
    return (
      <iframe
        title="Recipe pack"
        srcDoc={recipesHtml}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
      />
    );
  }
  const recipesMdPath = await newestRecipeFile(mealPlanDir, planSlug, "md");
  const recipesMd = recipesMdPath ? await readIfExists(recipesMdPath) : null;
  let body: string | null = recipesMd;

  // Fallback: extract from the consolidated letter (legacy letters that
  // still have recipes inline).
  if (!body) {
    const consolidatedMd = await readIfExists(path.join(mealPlanDir, `${planSlug}.md`));
    if (consolidatedMd) body = extractRecipeAppendix(consolidatedMd);
  }
  if (!body) {
    const mealPlanMd = await readIfExists(path.join(mealPlanDir, `${planSlug}-meal_plan.md`));
    if (mealPlanMd) body = extractRecipeAppendix(mealPlanMd);
  }

  if (!body) {
    return emptyPage(
      "Your coach hasn't published the recipe pack for this plan yet. Check back in a bit, or message her.",
    );
  }

  const fullHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Your recipe pack · The Ochre Tree</title>
<style>${WRAP_CSS}</style>
</head>
<body>
<div class="wrap">
  <h1>Your recipe pack</h1>
  <p class="header-sub">Full recipes for every ✦ dish in your meal plan. Bookmark this on your phone for easy access in the kitchen.</p>
  ${markdownToBasicHtml(body)}
  <div class="footer">Questions? Message your coach on WhatsApp.</div>
</div>
</body>
</html>`;

  return (
    <iframe
      title="Recipe pack"
      srcDoc={fullHtml}
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
