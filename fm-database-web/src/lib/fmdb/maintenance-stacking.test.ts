import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveExistingThrough, extendPaidThrough } from "./maintenance-orders";

// Regression: a Payment Link payment arrives as TWO webhook events. The second
// read the record the first had just stamped as "existing cover" and stacked
// another term on it — Nazneen (cl-022) paid for 6 months and was stamped for 12.
describe("maintenance stacking never counts the order being paid", () => {
  let root = "";
  const prev = process.env.FMDB_PLANS_DIR;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "maint-stack-"));
    process.env.FMDB_PLANS_DIR = root;
    const dir = path.join(root, "clients", "cl-x", "maintenance");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(root, "clients", "cl-x", "client.yaml"), "client_id: cl-x\n");
    // The first delivery has already stamped this order paid.
    fs.writeFileSync(
      path.join(dir, "maint-2026-10-20-01.yaml"),
      "order_id: maint-2026-10-20-01\nstatus: paid\npaid_through: '2027-04-20'\n",
    );
  });

  afterAll(() => {
    process.env.FMDB_PLANS_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the duplicate delivery computes the SAME date, not +6 more months", async () => {
    const existing = await effectiveExistingThrough("cl-x", { excludeOrderId: "maint-2026-10-20-01" });
    expect(existing).toBeNull();
    expect(extendPaidThrough(existing, "2026-10-20", 6)).toBe("2027-04-20");
  });

  it("a genuinely earlier paid block still stacks (early renewal)", async () => {
    expect(await effectiveExistingThrough("cl-x", { excludeOrderId: "maint-2027-04-01-01" })).toBe("2027-04-20");
  });
});
