/**
 * Lab coverage — does the coach's chosen Acumen package cover the markers she
 * ordered on the discovery call?
 *
 * The discovery form writes `requested_labs` (exact LAB_PANELS marker names). This
 * module maps each marker to its Acumen reality via a hand-reviewed registry
 * (`fm-database/data/lab_coverage.yaml`) — NOT by fuzzy-matching the panel's
 * free-text "includes" prose, which is brittle. `checkCoverage` then sorts the
 * requested markers, for a chosen profile, into:
 *   covered          — in the package (Base, or an add-on the package carries)
 *   availableAsAddon — Acumen can run it; one click adds it as a priced add-on
 *   notAtAcumen      — Acumen can't run it (specialty: DUTCH/OAT/etc.) → requisition
 *   unknown          — not in the registry → routed to requisition (safe default)
 *
 * Pure core (checkCoverage) is unit-tested without disk; loadLabCoverage()
 * dynamically imports the path helper so this module stays free of top-level
 * path-alias imports (the vitest convention — see lab-providers.ts).
 */

import type { LabProfile } from "./lab-providers";

/** Just what checkCoverage needs from an add-on — so the coach menu's lighter
 *  `{ slug, name, ourCostInr }` rows work without the full LabAddon. */
type AddonLite = { slug: string; name: string };

export interface MarkerCoverage {
  /** "in_base" | "addon:<slug>" | "profile_only" | "not_at_acumen" */
  coverage: string;
  /** present on some in_base markers (ApoB etc.) — informational only. */
  slug?: string;
  /** for "profile_only" markers (in a panel's includes but no à-la-carte slug). */
  in_profiles?: number[];
}

export type LabCoverageRegistry = Record<string, MarkerCoverage>;

export interface CoverageResult {
  covered: string[];
  availableAsAddon: { marker: string; slug: string; name: string }[];
  notAtAcumen: string[];
  unknown: string[];
}

/** Strip a trailing " (custom)" / whitespace so a registry lookup matches the
 *  exact LAB_PANELS name the form stored. A custom (free-typed) marker won't be
 *  in the registry → falls to `unknown` → requisition, which is correct. */
function normalise(marker: string): string {
  return marker.replace(/\s*\(custom\)\s*$/i, "").trim();
}

/**
 * Sort `requestedMarkers` into coverage buckets for the chosen `profile`.
 * `profile` null means no package selected yet — nothing counts as covered.
 */
export function checkCoverage(
  requestedMarkers: string[],
  profile: LabProfile | null,
  registry: LabCoverageRegistry,
  addons: readonly AddonLite[],
): CoverageResult {
  const out: CoverageResult = { covered: [], availableAsAddon: [], notAtAcumen: [], unknown: [] };
  const coveredSlugs = new Set(profile?.coveredAddonSlugs ?? []);
  const addonBySlug = new Map(addons.map((a) => [a.slug, a]));
  const seen = new Set<string>();

  for (const raw of requestedMarkers) {
    const marker = normalise(raw);
    if (!marker || seen.has(marker)) continue;
    seen.add(marker);

    const entry = registry[marker];
    if (!entry) {
      out.unknown.push(marker);
      continue;
    }
    const cov = entry.coverage;

    if (cov === "in_base") {
      // Every Acumen profile includes Base; with no profile, nothing's covered.
      if (profile) out.covered.push(marker);
      else out.unknown.push(marker);
    } else if (cov === "not_at_acumen") {
      out.notAtAcumen.push(marker);
    } else if (cov === "profile_only") {
      if (profile && (entry.in_profiles ?? []).includes(profile.id)) out.covered.push(marker);
      else out.notAtAcumen.push(marker); // only via a panel, no à-la-carte option
    } else if (cov.startsWith("addon:")) {
      const slug = cov.slice("addon:".length);
      if (coveredSlugs.has(slug)) {
        out.covered.push(marker);
      } else {
        const a = addonBySlug.get(slug);
        if (a) out.availableAsAddon.push({ marker, slug, name: a.name });
        else out.notAtAcumen.push(marker); // slug not a real add-on (shouldn't happen)
      }
    } else {
      out.unknown.push(marker); // unrecognised coverage value
    }
  }
  return out;
}

/** True when every requested marker is in the package (nothing to add or requisition). */
export function isFullyCovered(r: CoverageResult): boolean {
  return r.availableAsAddon.length === 0 && r.notAtAcumen.length === 0 && r.unknown.length === 0;
}

/** Load the coverage registry from disk (fs wrapper — not unit-tested). */
export async function loadLabCoverage(): Promise<LabCoverageRegistry> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const yaml = (await import("js-yaml")).default;
  const { getCataloguePath } = await import("@/lib/fmdb/paths");
  try {
    const file = path.join(getCataloguePath(), "lab_coverage.yaml");
    const raw = await fs.readFile(file, "utf8");
    const doc = yaml.load(raw) as { markers?: LabCoverageRegistry } | null;
    return doc?.markers ?? {};
  } catch {
    return {}; // absent / unreadable → everything routes to requisition (safe)
  }
}
