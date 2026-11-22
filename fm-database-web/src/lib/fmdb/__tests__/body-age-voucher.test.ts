import { describe, expect, it } from "vitest";
import { checkVoucher, issueVoucher, tidyVoucher, VOUCHER_OFF_INR } from "../body-age-voucher";
import { buildBodyAgeOrder, sanitizeOrderInput } from "../body-age-orders";

const SECRET = "test-secret-not-a-real-one";
const EMAIL = "asha@example.com";

describe("body age voucher", () => {
  it("is worth Rs 500 for the person it was issued to, until its last day", () => {
    const { code, validUntilYmd } = issueVoucher(EMAIL, "2027-01-03", SECRET);
    expect(code).toMatch(/^BA-270117-[A-Z2-9]{6}$/);
    expect(validUntilYmd).toBe("2027-01-17");
    const ok = { email: " Asha@Example.com ", people: 1, secret: SECRET };
    expect(checkVoucher(code, { ...ok, todayYmd: "2027-01-03" })).toEqual({ ok: true, offInr: VOUCHER_OFF_INR });
    expect(checkVoucher(code, { ...ok, todayYmd: "2027-01-17" }).ok).toBe(true);
    expect(checkVoucher(code, { ...ok, todayYmd: "2027-01-18" }).ok).toBe(false); // never extended
  });

  it("refuses another person's email, two people, a made-up code, and a site with no secret", () => {
    const { code } = issueVoucher(EMAIL, "2027-01-03", SECRET);
    const base = { email: EMAIL, people: 1, todayYmd: "2027-01-05", secret: SECRET };
    expect(checkVoucher(code, { ...base, email: "someone@example.com" }).ok).toBe(false);
    expect(checkVoucher(code, { ...base, people: 2 }).ok).toBe(false);
    expect(checkVoucher("BA-270117-AAAAAA", base).ok).toBe(false);
    expect(checkVoucher("FREE500", base).ok).toBe(false);
    expect(checkVoucher(code, { ...base, secret: undefined }).ok).toBe(false);
    expect(checkVoucher(code, { ...base, secret: "another-secret" }).ok).toBe(false);
  });

  it("a later date cannot be forged by editing the code", () => {
    const { code } = issueVoucher(EMAIL, "2027-01-03", SECRET);
    const stretched = code.replace("270117", "271231");
    expect(checkVoucher(stretched, { email: EMAIL, people: 1, todayYmd: "2027-06-01", secret: SECRET }).ok).toBe(false);
  });

  it("the same person gets the same code on the same day: one per person", () => {
    expect(issueVoucher(EMAIL, "2027-01-03", SECRET).code).toBe(issueVoucher("ASHA@example.com ", "2027-01-03", SECRET).code);
  });

  it("no message to the buyer breaks her wording rules", () => {
    const { code } = issueVoucher(EMAIL, "2027-01-03", SECRET);
    const base = { email: EMAIL, people: 1, todayYmd: "2027-01-05", secret: SECRET };
    const said = [
      checkVoucher("nonsense", base),
      checkVoucher(code, { ...base, secret: undefined }),
      checkVoucher(code, { ...base, people: 2 }),
      checkVoucher(code, { ...base, email: "x@example.com" }),
      checkVoucher(code, { ...base, todayYmd: "2028-01-01" }),
    ].map((r) => (r.ok ? "" : r.error)).join(" ");
    for (const banned of [/urgent/i, /hurry|last chance|expires soon|only \d+ left/i, /sequoya|rings/i, /\bfree\b/i]) expect(said).not.toMatch(banned);
  });

  it("tidies what was typed and carries it on the order without trusting it", () => {
    expect(tidyVoucher(" ba-270117-abcdef ")).toBe("BA-270117-ABCDEF");
    expect(tidyVoucher(undefined)).toBe("");
    const form = {
      report_kind: "standard",
      consent: true,
      voucher_code: " ba-270117-abcdef",
      people: [{ full_name: "Asha Rao", date_of_birth: "1980-05-01", sex: "F", email: EMAIL, phone: "9876543210" }],
      visit: { address: "12 Test Lane, Test Nagar", pincode: "400001", preferred_date: "2027-01-10", preferred_slot: "morning", notes: "" },
    };
    const checked = sanitizeOrderInput(form, { todayYmd: "2027-01-05", minDateYmd: "2027-01-07" });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.amountInr).toBe(4999); // the form alone never lowers the price
    expect(checked.input.voucher_code).toBe("BA-270117-ABCDEF");
    const plain = buildBodyAgeOrder("ba-20270105-aaaaaaaa", "k", checked.input, 4999, "2027-01-05T00:00:00Z", true);
    expect(plain.voucher_code).toBeUndefined();
    const reduced = buildBodyAgeOrder("ba-20270105-aaaaaaaa", "k", checked.input, 4499, "2027-01-05T00:00:00Z", true, { code: "BA-270117-ABCDEF", offInr: 500 });
    expect([reduced.amount_inr, reduced.voucher_code, reduced.discount_inr]).toEqual([4499, "BA-270117-ABCDEF", 500]);
  });
});
