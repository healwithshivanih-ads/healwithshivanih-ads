/**
 * The end of a plan is the most commercially significant moment in the
 * relationship, and until now nothing watched it. On 3 Aug 2026 six plans sat
 * inside their final fortnight unflagged; one client's own renewal fell six
 * days after an email asking her to pay for her daughter's, because nobody
 * had checked the household.
 *
 * Two behaviours carry the weight and both are pinned here: a decided client
 * disappears (or the digest trains you to skim, and the one who WOULD have
 * renewed is the one you miss), and people in the same household are visibly
 * linked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

let root: string;
const TODAY = new Date("2026-08-03T00:00:00Z");

async function mod() {
  vi.resetModules();
  process.env.FMDB_PLANS_DIR = root;
  return import("../renewal-queue");
}

function plan(slug: string, clientId: string, start: string, weeks: number) {
  fs.writeFileSync(
    path.join(root, "published", `${slug}-v1.yaml`),
    yaml.dump({ client_id: clientId, plan_period_start: start, meal_plan_started_on: start, plan_period_weeks: weeks }),
  );
}
function client(id: string, name: string) {
  fs.mkdirSync(path.join(root, "clients", id), { recursive: true });
  fs.writeFileSync(path.join(root, "clients", id, "client.yaml"), yaml.dump({ display_name: name }));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "renew-"));
  fs.mkdirSync(path.join(root, "published"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("plans ending", () => {
  it("surfaces a plan inside the final fortnight", async () => {
    client("cl-007", "Archana Rao");
    plan("archana-plan-3", "cl-007", "2026-05-24", 12); // ends 16 Aug
    const m = await mod();
    const q = m.loadRenewalQueue(TODAY);
    expect(q).toHaveLength(1);
    expect(q[0].endsOn).toBe("2026-08-16");
    expect(q[0].daysLeft).toBe(13);
    expect(q[0].stage).toBe("heads_up");
  });

  it("ignores a plan still months away", async () => {
    client("cl-020", "Someone Else");
    plan("someone-plan-1", "cl-020", "2026-07-20", 12);
    expect((await mod()).loadRenewalQueue(TODAY)).toHaveLength(0);
  });

  it("calls the last week an offer, and a finished plan overdue", async () => {
    client("cl-004", "Dhanishta Shah");
    plan("dhanishta-plan-2", "cl-004", "2026-05-12", 12); // ends 4 Aug
    client("cl-017", "Samaa Mahandru");
    plan("samaa-plan-1", "cl-017", "2026-06-20", 4); // ended 18 Jul
    const q = (await mod()).loadRenewalQueue(TODAY);
    expect(q.find((r) => r.clientId === "cl-004")!.stage).toBe("offer");
    expect(q.find((r) => r.clientId === "cl-017")!.stage).toBe("overdue");
  });

  it("a client who has said no stops appearing", async () => {
    client("cl-007", "Archana Rao");
    plan("archana-plan-3", "cl-007", "2026-05-24", 12);
    const m = await mod();
    expect(m.openRenewals(TODAY)).toHaveLength(1);
    expect(m.setDecision("archana-plan-3", "not_renewing", "said no on the call")).toBe(true);
    expect(m.openRenewals(TODAY)).toHaveLength(0);
    // Still visible in the full queue — a decision is recorded, not erased.
    expect(m.loadRenewalQueue(TODAY)[0].decision).toBe("not_renewing");
  });

  it("links people in the same household so two asks do not collide", async () => {
    client("cl-006", "Geetika Mahendru");
    plan("geetika-plan-1", "cl-006", "2026-05-17", 12);
    client("cl-016", "Manju Mahendru");
    plan("manju-plan-1", "cl-016", "2026-05-20", 12);
    const q = (await mod()).loadRenewalQueue(TODAY);
    expect(q.find((r) => r.clientId === "cl-006")!.household).toEqual(["Manju Mahendru"]);
    expect(q.find((r) => r.clientId === "cl-016")!.household).toEqual(["Geetika Mahendru"]);
  });

  it("soonest first — the one ending today outranks the one ending in a fortnight", async () => {
    client("cl-004", "A A"); plan("a-plan", "cl-004", "2026-05-12", 12);
    client("cl-007", "B B"); plan("b-plan", "cl-007", "2026-05-24", 12);
    const q = (await mod()).loadRenewalQueue(TODAY);
    expect(q[0].daysLeft).toBeLessThan(q[1].daysLeft);
  });

  it("one unreadable plan does not empty the queue", async () => {
    client("cl-004", "Dhanishta Shah");
    plan("dhanishta-plan-2", "cl-004", "2026-05-12", 12);
    fs.writeFileSync(path.join(root, "published", "broken-v1.yaml"), "{{{ not yaml");
    expect((await mod()).loadRenewalQueue(TODAY).length).toBeGreaterThan(0);
  });
});
