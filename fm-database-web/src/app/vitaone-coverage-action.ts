"use server";

/**
 * getVitaoneCoverageStatus — standing guardrail for affiliate-commission leaks.
 *
 * VitaOne pays 30% commission, FM Nutrition 10%. The buy-link resolver already
 * prefers VitaOne, so leaks come only from DATA coverage: a supplement
 * PRESCRIBED in a live published plan whose link currently resolves to FM
 * Nutrition — real money going to the 10% store (usually because the matching
 * VitaOne product has an empty `covers` list, or none exists yet).
 *
 * We flag ONLY prescribed items (the ones actually costing money) and skip
 * ACCEPTED_GAPS (verified not stocked by vitaone.in), so the chip stays
 * high-signal — it lights up when a NEW leak appears (e.g. a VitaOne product
 * added without covers, or a fresh script), not on the intentionally-empty
 * VitaOne products nothing prescribes.
 *
 * Live-computed on every dashboard load (like FmCatalogueOrphanChip) — no cron,
 * always current. Defensive: any failure returns the empty status so the chip
 * simply hides rather than breaking the dashboard.
 */

import { promises as fs } from "fs";
import path from "path";
import { getPlansRoot } from "@/lib/fmdb/paths";
import {
  pickLinkEntry,
  type LinksFile,
  type LinksEntry,
} from "@/lib/server-actions/supplement-links-match";

/** A prescribed supplement whose buy link currently goes to FM Nutrition. */
export interface CoverageLeakItem {
  slug: string;
  plans: number; // how many live published plans prescribe it
}

export interface VitaoneCoverageStatus {
  leaks: number;
  leakItems: CoverageLeakItem[];
}

const EMPTY: VitaoneCoverageStatus = { leaks: 0, leakItems: [] };

/**
 * Slugs verified NOT stocked by vitaone.in (checked 2026-07-07) — FM Nutrition
 * is the legitimate stockist, so don't nag about them. Trim this list if
 * VitaOne ever adds one of these (then add a VitaOne entry with covers).
 */
const ACCEPTED_GAPS = new Set<string>([
  "cordyceps",
  "medicinal-mushrooms",
  "taurine",
  "l-theanine",
  "bromelain",
  "chromium",
  "creatine-monohydrate",
  "oregano-oil",
  "saccharomyces-boulardii",
  "zinc-picolinate",
  "indole-3-carbinol",
  "vitamin-k2",
  // FM Nutrition / Autoimmunity Care brand blends — no VitaOne equivalent
  // (verified 2026-07-07; VitaOne's nearest is Gastro Zinc Carnosine, a
  // different single-ingredient product).
  "h-pylori-combo",
  "leaky-gut-care",
]);

function sourceOf(e: LinksEntry): string {
  return e.source ?? (e.url?.includes("vitaone") ? "vitaone" : "other");
}

export async function getVitaoneCoverageStatus(): Promise<VitaoneCoverageStatus> {
  try {
    const root = getPlansRoot();
    const { default: yaml } = await import("js-yaml");

    const links =
      ((yaml.load(
        await fs.readFile(path.join(root, "supplement_links.yaml"), "utf-8"),
      ) as LinksFile) ?? {});

    const dir = path.join(root, "published");
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const planCount = new Map<string, number>();
    for (const n of names) {
      if (!n.endsWith(".yaml") || n.includes(".bak")) continue;
      try {
        const d =
          (yaml.load(await fs.readFile(path.join(dir, n), "utf-8")) as {
            supplement_protocol?: { supplement_slug?: string }[];
          }) ?? {};
        for (const s of d.supplement_protocol ?? []) {
          const slug = s?.supplement_slug;
          if (slug) planCount.set(slug, (planCount.get(slug) ?? 0) + 1);
        }
      } catch {
        /* skip unreadable plan */
      }
    }

    const leakItems: CoverageLeakItem[] = [];
    for (const [slug, plans] of planCount) {
      if (ACCEPTED_GAPS.has(slug)) continue;
      const entry = pickLinkEntry(links, slug, slug);
      if (entry && sourceOf(entry) === "fmnutrition") {
        leakItems.push({ slug, plans });
      }
    }
    leakItems.sort((a, b) => b.plans - a.plans || a.slug.localeCompare(b.slug));

    return { leaks: leakItems.length, leakItems };
  } catch {
    return EMPTY;
  }
}
