import "server-only";

/**
 * What to book at the laboratory for each body age report, read from the lab price file
 * (`thyrocare.yaml#longevity_panels`: `body-age` and `body-age-deeper`). Coach-only: the laboratory is never
 * named to a buyer, and these item names never reach one.
 */
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getCataloguePath } from "./paths";
import type { ReportKind } from "./body-age-orders";

const KEY: Record<ReportKind, string> = { standard: "body-age", deeper: "body-age-deeper" };

export interface LabItems {
  items: string[];
  ourCostInr: number | null;
}

export async function labItemsFor(kind: ReportKind, file?: string): Promise<LabItems> {
  const f = file ?? path.join(getCataloguePath(), "lab_providers", "thyrocare.yaml");
  try {
    const doc = yaml.load(await fs.readFile(f, "utf8")) as { longevity_panels?: Array<Record<string, unknown>> };
    const p = (doc.longevity_panels ?? []).find((x) => x.key === KEY[kind]);
    const items = Array.isArray(p?.thyrocare_items) ? p.thyrocare_items.filter((x): x is string => typeof x === "string") : [];
    return { items, ourCostInr: typeof p?.our_cost_inr === "number" ? p.our_cost_inr : null };
  } catch {
    return { items: [], ourCostInr: null };
  }
}
