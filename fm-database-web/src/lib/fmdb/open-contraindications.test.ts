import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openContraindications } from "./open-contraindications";
import type { PlanCheckResult } from "@/lib/server-actions/plans";

const flag = {
  id: "contra-reflux",
  field: "contraindications",
  reason: "The catalogue lists: Active ulcer",
  ask: "Does this apply to this client?",
  matched: ["gerd / acid reflux"],
  soft: false,
};

const finding = (target: string, section = "client_fit") => ({
  severity: "CRITICAL" as const,
  section,
  field: "contraindications",
  detail: "",
  target,
  ack_id: "",
});

const check = (over: Partial<PlanCheckResult> = {}): PlanCheckResult => ({
  ok: true,
  findings: [finding("betaine-hcl:contra-reflux")],
  fit_required: [{ item: "betaine-hcl", kind: "supplement", label: "Betaine HCl", flags: [flag] }],
  ...over,
});

describe("openContraindications", () => {
  it("shows a flag check_plan still raises", () => {
    expect(openContraindications(check())).toEqual([
      {
        supplement_slug: "betaine-hcl",
        supplement_name: "Betaine HCl",
        flag_id: "contra-reflux",
        contraindication_text: flag.reason,
        ask: flag.ask,
        matched: flag.matched,
        soft: false,
      },
    ]);
  });

  it("drops a flag with no finding: answered, or a lapsed client's old plan", () => {
    expect(openContraindications(check({ findings: [] }))).toEqual([]);
  });

  it("ignores a finding from another section with the same target", () => {
    const other = check({ findings: [finding("betaine-hcl:contra-reflux", "supplement_protocol")] });
    expect(openContraindications(other)).toEqual([]);
  });

  it("leaves screens to the fit panel", () => {
    const screen = { id: "mould-enzymes", reason: "", ask: "", matched: ["yeast"] };
    const onlyScreen = check({
      findings: [finding("betaine-hcl:mould-enzymes")],
      fit_required: [{ item: "betaine-hcl", kind: "supplement", label: "x", flags: [screen] }],
    });
    expect(openContraindications(onlyScreen)).toEqual([]);
  });

  it("copes with a failed plan-check", () => {
    expect(openContraindications({})).toEqual([]);
  });
});

describe("checkSupplementInteractionsAction", () => {
  const source = readFileSync(path.join(process.cwd(), "src/lib/server-actions/plans.ts"), "utf-8");
  const action = source.slice(
    source.indexOf("export async function checkSupplementInteractionsAction"),
    source.indexOf("// ── v0.74: drug_depletions"),
  );

  it("takes its answer from check_plan", () => {
    expect(action).toContain("runPlanCheck(planSlug)");
    expect(action).toContain("openContraindications(check)");
  });

  it("does no matching of its own", () => {
    expect(action).not.toMatch(/\.includes\(/);
    expect(action).not.toMatch(/toLowerCase/);
    expect(action).not.toMatch(/contraindications/);
  });
});
