import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  parseLabProvider,
  orderProviderSlug,
  isKnownLabProvider,
  hasBookablePanel,
  priceSelection,
  PRIMARY_LAB_PROVIDER,
  BACKUP_LAB_PROVIDER,
} from "./lab-providers";
import { checkCoverage, type LabCoverageRegistry } from "./lab-coverage";

const DATA = path.resolve(__dirname, "../../../../fm-database/data");
const readYaml = (rel: string) => yaml.load(fs.readFileSync(path.join(DATA, rel), "utf8")) as Record<string, unknown>;

describe("provider roles", () => {
  it("Thyrocare is primary, Acumen is the backup", () => {
    expect(PRIMARY_LAB_PROVIDER).toBe("thyrocare");
    expect(BACKUP_LAB_PROVIDER).toBe("acumen-diagnostics");
  });

  it("only known slugs load — a tampered provider value is not a path", () => {
    expect(isKnownLabProvider("thyrocare")).toBe(true);
    expect(isKnownLabProvider("acumen-diagnostics")).toBe(true);
    expect(isKnownLabProvider("../../etc/passwd")).toBe(false);
    expect(isKnownLabProvider(undefined)).toBe(false);
  });

  it("an order with no / unknown provider reads as Acumen (pre-Thyrocare orders), never the primary", () => {
    expect(orderProviderSlug({})).toBe("acumen-diagnostics");
    expect(orderProviderSlug({ provider: "nonsense" })).toBe("acumen-diagnostics");
    expect(orderProviderSlug({ provider: "thyrocare" })).toBe("thyrocare");
  });
});

describe("parseLabProvider — non-Acumen pricing rules", () => {
  const raw = {
    provider: { slug: "thyrocare", display_name: "Thyrocare", booking: "manual", alert_recipients_env: "THYROCARE_ALERT_WHATSAPP" },
    profiles_final: [
      { id: 1, name: "F Pro", audience: "everyone", our_cost_inr: 3000, mrp_inr: 6000, includes: ["Thyroid"] },
      { id: 2, name: "Women's", audience: "women <45", our_cost_inr: null, mrp_inr: null },
    ],
    addon_tests: [
      { slug: "zinc", name: "Zinc", dos_list_inr: 800 }, // catalogue only — no 50% rule for Thyrocare
      { slug: "esr", name: "ESR", our_cost_inr: 60, client_inr: 150 },
    ],
  };
  const p = parseLabProvider(raw);

  it("reads role, manual booking and its own alert env", () => {
    expect(p.role).toBe("primary");
    expect(p.booking).toBe("manual");
    expect(p.alertRecipientsEnv).toBe("THYROCARE_ALERT_WHATSAPP");
  });

  it("drops an unpriced profile (fails closed) and keeps the priced one", () => {
    expect(p.profiles.map((x) => x.id)).toEqual([1]);
    expect(hasBookablePanel(p)).toBe(true);
  });

  it("does NOT apply Acumen's 50%-of-catalogue rule to another lab's add-ons", () => {
    const zinc = p.addons.find((a) => a.slug === "zinc")!;
    expect(zinc.ourCostInr).toBeNull();
    expect(zinc.clientInr).toBeNull();
    const esr = p.addons.find((a) => a.slug === "esr")!;
    expect(esr.ourCostInr).toBe(60);
    expect(esr.clientInr).toBe(150);
  });

  it("an Acumen yaml without the new fields keeps the old deal (50% cost, catalogue price)", () => {
    const a = parseLabProvider({
      provider: { slug: "acumen-diagnostics" },
      profiles_final: [],
      addon_tests: [{ slug: "c-peptide", name: "C-Peptide", dos_list_inr: 1400 }],
    });
    expect(a.role).toBe("backup");
    expect(a.booking).toBe("partner_whatsapp");
    expect(a.alertRecipientsEnv).toBe("LAB_PARTNER_WHATSAPP");
    expect(a.addons[0].ourCostInr).toBe(700);
    expect(a.addons[0].clientInr).toBe(1400);
  });
});

describe("real thyrocare.yaml", () => {
  const thyro = parseLabProvider(readYaml("lab_providers/thyrocare.yaml"));
  const acumen = parseLabProvider(readYaml("lab_providers/acumen.yaml"));

  it("parses as the primary, manual-booking lab with pre-test instructions", () => {
    expect(thyro.slug).toBe("thyrocare");
    expect(thyro.role).toBe("primary");
    expect(thyro.booking).toBe("manual");
    expect(thyro.pretestInstructions.length).toBeGreaterThan(0);
  });

  it("is bookable at Thyrocare list price + 10% on packages, and every price leaves us a margin", () => {
    expect(hasBookablePanel(thyro)).toBe(true);
    expect(thyro.profiles.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    const base = thyro.profiles.find((p) => p.id === 1)!;
    expect(base.mrpInr).toBe(7787); // (F Pro ₹6,999 + fasting glucose ₹80) + 10% for transaction charges
    const r = priceSelection(thyro, { profileId: 1 });
    expect(r.ok).toBe(true);
    for (const prof of thyro.profiles) {
      expect(prof.mrpInr).toBeGreaterThan(prof.ourCostInr);
      expect(prof.ourCostInr).toBeGreaterThan(0);
    }
    for (const a of thyro.addons) {
      expect(a.clientInr, a.slug).not.toBeNull();
      expect(a.ourCostInr, a.slug).not.toBeNull();
      expect(a.clientInr!, a.slug).toBeGreaterThan(a.ourCostInr!);
    }
  });

  it("the hormone profiles carry the Steroid Profile and the Autoimmune Thyroid panel", () => {
    for (const prof of thyro.profiles.filter((p) => p.id > 1)) {
      expect(prof.coveredAddonSlugs).toContain("steroid-profile");
      expect(prof.coveredAddonSlugs).toContain("thyroid-antibodies");
      expect(prof.coveredAddonSlugs).toContain("am-cortisol");
    }
  });

  it("acumen.yaml is still the backup with a bookable Base panel", () => {
    expect(acumen.role).toBe("backup");
    expect(hasBookablePanel(acumen)).toBe(true);
  });

  it("every add-on slug in the Thyrocare coverage map is a real Thyrocare add-on", () => {
    const cov = (readYaml("lab_coverage_thyrocare.yaml").markers ?? {}) as LabCoverageRegistry;
    const slugs = new Set(thyro.addons.map((a) => a.slug));
    const missing = Object.entries(cov)
      .filter(([, v]) => v.coverage.startsWith("addon:") && !slugs.has(v.coverage.slice(6)))
      .map(([k, v]) => `${k} → ${v.coverage}`);
    expect(missing).toEqual([]);
  });

  it("thyroid antibodies are an add-on on the F Pro base, covered by the hormone profiles", () => {
    const cov = (readYaml("lab_coverage_thyrocare.yaml").markers ?? {}) as LabCoverageRegistry;
    const base = { id: 1, name: "F Pro", audience: "", ourCostInr: 1, mrpInr: 2, marginInr: 1, catalogueInr: null, includes: [], coveredAddonSlugs: [] };
    const r = checkCoverage(["TPO Antibodies", "TSH", "Selenium", "DUTCH Test (Dried Urine)"], base, cov, thyro.addons);
    expect(r.covered).toEqual(["TSH", "Selenium"]);
    expect(r.availableAsAddon.map((a) => a.slug)).toEqual(["thyroid-antibodies"]);
    expect(r.notAtLab).toEqual(["DUTCH Test (Dried Urine)"]);
  });
});
