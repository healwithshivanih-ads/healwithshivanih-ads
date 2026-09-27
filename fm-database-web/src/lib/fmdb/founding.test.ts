import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FOUNDING_GIFT_EXPIRES_ON,
  creditWindowFor,
  giftCreditApplies,
  giftCreditDeadline,
  giftExpired,
  giftMessage,
  giftProgress,
  giftRefusal,
  giftedSessionOf,
  countFoundingMembers,
} from "./founding";
import { buildFoundingCounterRequest, pushFoundingCount } from "./founding-counter";
import { DISCOVERY_CREDIT_WINDOW_DAYS, resolveAppTier } from "./discovery-tier";

const founder = { client_id: "cl-100", display_name: "Priya Shah", founding_member: true };
const gift = (extra: Record<string, unknown> = {}) => ({
  client_id: "cl-200",
  display_name: "Meera",
  gifted_foundation_session: {
    gifted_by: "cl-100",
    gifted_by_name: "Priya",
    issued_on: "2027-01-05",
    expires_on: FOUNDING_GIFT_EXPIRES_ON,
    ...extra,
  },
});

const base = {
  founderId: "cl-100",
  founder,
  recipientId: "cl-200",
  recipient: { client_id: "cl-200", engagement_status: "pending" },
  recipientHasPaidFoundation: false,
  recipientHasPublishedPlan: false,
  todayYmd: "2027-01-10",
};

describe("one gift per founder", () => {
  it("allows the first gift", () => {
    expect(giftRefusal(base)).toBeNull();
  });
  it("refuses a second gift", () => {
    const f = { ...founder, founding_gift: { recipient_client_id: "cl-201", issued_on: "2027-01-06" } };
    expect(giftRefusal({ ...base, founder: f })).toMatch(/already gifted/);
  });
  it("refuses a non-founder", () => {
    expect(giftRefusal({ ...base, founder: { client_id: "cl-100" } })).toMatch(/only a founding member/);
  });
  it("refuses gifting to the founder themselves", () => {
    expect(giftRefusal({ ...base, recipientId: "cl-100", recipient: founder })).toMatch(/not the founder/);
  });
  it("refuses someone already gifted, already paid, or already a client", () => {
    expect(giftRefusal({ ...base, recipient: gift() })).toMatch(/already been gifted/);
    expect(giftRefusal({ ...base, recipientHasPaidFoundation: true })).toMatch(/already paid/);
    expect(giftRefusal({ ...base, recipientHasPublishedPlan: true })).toMatch(/programme/);
    expect(giftRefusal({ ...base, recipient: { engagement_status: "signed_up" } })).toMatch(/signed up/);
  });
  it("allows a brand-new recipient (no record yet)", () => {
    expect(giftRefusal({ ...base, recipientId: null, recipient: null })).toBeNull();
  });
});

describe("expiry (30 Apr 2027)", () => {
  it("no new gifts after the expiry date", () => {
    expect(giftRefusal({ ...base, todayYmd: "2027-05-01" })).toMatch(/closed/);
    expect(giftRefusal({ ...base, todayYmd: "2027-04-30" })).toBeNull();
  });
  it("an unused gift expires the day after", () => {
    const g = giftedSessionOf(gift())!;
    expect(giftExpired(g, "2027-04-30")).toBe(false);
    expect(giftExpired(g, "2027-05-01")).toBe(true);
    expect(giftProgress(gift(), "2027-05-01")!.status).toBe("expired");
  });
  it("a gift whose first call was held is used, never expired", () => {
    const g = giftedSessionOf(gift({ call_1_on: "2027-04-20" }))!;
    expect(giftExpired(g, "2027-06-01")).toBe(false);
  });
});

describe("7-day credit window after the SECOND call", () => {
  it("has no deadline until call 2", () => {
    expect(giftCreditDeadline(giftedSessionOf(gift({ call_1_on: "2027-01-12" }))!)).toBeNull();
  });
  it("deadline = call 2 + 7 days, inclusive", () => {
    const g = giftedSessionOf(gift({ call_1_on: "2027-01-12", call_2_on: "2027-01-20" }))!;
    expect(giftCreditDeadline(g)).toBe("2027-01-27");
    expect(giftCreditApplies(g, "2027-01-27")).toBe(true);
    expect(giftCreditApplies(g, "2027-01-28")).toBe(false);
  });
  it("status reports joined with or without credit", () => {
    expect(
      giftProgress(gift({ call_1_on: "2027-01-12", call_2_on: "2027-01-20", joined_on: "2027-01-25" }), "2027-02-01"),
    ).toMatchObject({ status: "joined", creditApplies: true });
    expect(
      giftProgress(gift({ call_1_on: "2027-01-12", call_2_on: "2027-01-20", joined_on: "2027-02-01" }), "2027-02-01"),
    ).toMatchObject({ status: "joined", creditApplies: false });
  });
  it("the client app counts 7 days from call 2 for a gift, 15 from the call otherwise", () => {
    const recipient = { ...gift({ call_1_on: "2027-01-12", call_2_on: "2027-01-20" }), discovery_call_date: "2027-01-12" };
    const win = creditWindowFor(recipient, DISCOVERY_CREDIT_WINDOW_DAYS);
    expect(win).toEqual({ anchor: "2027-01-20", days: 7 });
    const tier = resolveAppTier({ discoveryCallDate: win.anchor, creditWindowDays: win.days }, "2027-01-26");
    expect(tier.credit).toMatchObject({ state: "credit_live", expiresOn: "2027-01-27", daysLeft: 1 });
    expect(resolveAppTier({ discoveryCallDate: win.anchor, creditWindowDays: win.days }, "2027-01-28").credit?.state).toBe(
      "credit_expired",
    );
    // Before call 2: live, but no countdown (never a wrong "expired").
    const early = creditWindowFor(gift({ call_1_on: "2027-01-12" }), DISCOVERY_CREDIT_WINDOW_DAYS);
    expect(resolveAppTier({ discoveryCallDate: early.anchor, creditWindowDays: early.days }, "2027-03-01").credit).toMatchObject({
      state: "credit_live",
      expiresOn: null,
    });
    // A paid Foundation client is unchanged.
    expect(creditWindowFor({ discovery_call_date: "2027-01-12" }, DISCOVERY_CREDIT_WINDOW_DAYS)).toEqual({
      anchor: "2027-01-12",
      days: 15,
    });
  });
});

describe("gift message", () => {
  it("names the founder and link, and never a price", () => {
    const m = giftMessage({ founderFirst: "Priya", recipientFirst: "Meera", url: "https://x/foundation/t", expiresOn: "2027-04-30" });
    expect(m).toContain("Priya has gifted you");
    expect(m).toContain("https://x/foundation/t");
    expect(m).toContain("30 April 2027");
    expect(m).not.toMatch(/₹|\bINR\b|\d{1,3},\d{3}/);
  });
});

describe("places counter feed", () => {
  it("counts founding members", () => {
    expect(countFoundingMembers([founder, { founding_member: false }, {}, { founding_member: true }])).toBe(2);
  });
  it("posts {taken} with the secret header", () => {
    const req = buildFoundingCounterRequest(7, "s3cret");
    expect(req.url).toBe("https://grow.theochretree.com/api/sequoya/founding");
    expect(req.init.method).toBe("POST");
    expect(req.init.headers["x-sequoya-secret"]).toBe("s3cret");
    expect(JSON.parse(req.init.body)).toEqual({ taken: 7 });
  });
  it("never throws — a failed POST is reported, not raised", async () => {
    const prev = process.env.SEQUOYA_FOUNDING_SECRET;
    process.env.SEQUOYA_FOUNDING_SECRET = "s3cret";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(pushFoundingCount(3, { fetchImpl: failing })).resolves.toMatchObject({ ok: false, taken: 3 });
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(pushFoundingCount(3, { fetchImpl: ok })).resolves.toMatchObject({ ok: true });
    delete process.env.SEQUOYA_FOUNDING_SECRET;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(pushFoundingCount(3, { fetchImpl: ok })).resolves.toMatchObject({ ok: false });
    errSpy.mockRestore();
    warnSpy.mockRestore();
    if (prev !== undefined) process.env.SEQUOYA_FOUNDING_SECRET = prev;
  });
});

describe("the locked Sequoya+ rate stays private", () => {
  // Every client-facing surface: the app payload builder, the app screens, the
  // public foundation page, and the Fly staging projection.
  const root = path.resolve(__dirname, "../../..");
  const clientFacing = [
    "src/lib/fmdb/client-app.ts",
    "src/app/foundation",
    "src/app/app",
    "src/components/sequoya",
    "scripts/app-staging-action.py",
  ];
  const files = (p: string): string[] => {
    const abs = path.join(root, p);
    if (fs.statSync(abs).isFile()) return [abs];
    return fs
      .readdirSync(abs, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|tsx|py)$/.test(d.name) && !d.name.includes(".test."))
      .map((d) => path.join(d.parentPath, d.name));
  };
  it("no client-facing file reads the rate", () => {
    const hits = clientFacing
      .flatMap(files)
      .filter((f) => /founding_splus_rate|FOUNDING_SPLUS_RATE/.test(fs.readFileSync(f, "utf8")));
    // app-staging-action.py names the field only in the comment saying it is excluded.
    const offenders = hits.filter((f) => {
      if (!f.endsWith("app-staging-action.py")) return true;
      const src = fs.readFileSync(f, "utf8");
      const block = src.slice(src.indexOf("_APP_CLIENT_KEYS = ("), src.indexOf(")\n", src.indexOf("_APP_CLIENT_KEYS = (")));
      return /^\s*"founding_splus_rate_inr",/m.test(block);
    });
    expect(offenders).toEqual([]);
  });
  it("the app payload exposes only the founding flag", () => {
    const src = fs.readFileSync(path.join(root, "src/lib/fmdb/client-app.ts"), "utf8");
    expect(src).toMatch(/founding: client\.founding_member === true/);
  });
});
