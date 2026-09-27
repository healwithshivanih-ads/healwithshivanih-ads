/**
 * Handouts attached to a plan → cards in the client app's Resources list.
 *
 * `plan.attached_resources` holds handout slugs (the same list the coach's
 * handout-drip panel writes and the WhatsApp drip sends). Each handout is a
 * static page at `public/handouts/<slug>.html`, served publicly at
 * `/handouts/<slug>.html` on both hosts — so the app only needs the page's
 * title and description, read from the HTML itself. ~/fm-resources is NOT on
 * the Fly machine, which is why the resource YAML is not the source here.
 *
 * A slug with no matching page is skipped rather than shown as a dead card.
 */
import fs from "node:fs/promises";
import path from "node:path";

export interface PlanHandout {
  slug: string;
  title: string;
  desc: string;
  url: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Title and description from a handout page; brand suffix stripped from the title. */
export function parseHandoutMeta(html: string): { title: string; desc: string } {
  const title = decodeEntities(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "")
    .replace(/\s+[—–-]\s+(Shivani Hari|The Ochre Tree)\s*$/i, "")
    .trim();
  const desc = decodeEntities(
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1] ?? "",
  ).trim();
  return { title, desc };
}

export async function loadPlanHandouts(
  slugs: unknown,
  handoutsDir: string = path.join(process.cwd(), "public", "handouts"),
): Promise<PlanHandout[]> {
  if (!Array.isArray(slugs)) return [];
  const seen = new Set<string>();
  const out: PlanHandout[] = [];
  for (const raw of slugs) {
    const slug = typeof raw === "string" ? raw.trim() : "";
    // the slug becomes a filesystem path — refuse anything but a plain slug
    if (!SLUG_RE.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    let html: string;
    try {
      html = await fs.readFile(path.join(handoutsDir, `${slug}.html`), "utf8");
    } catch {
      continue;
    }
    const { title, desc } = parseHandoutMeta(html);
    out.push({ slug, title: title || slug.replace(/-/g, " "), desc, url: `/handouts/${slug}.html` });
  }
  return out;
}
