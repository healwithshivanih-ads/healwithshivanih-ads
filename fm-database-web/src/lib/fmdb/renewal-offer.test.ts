import { describe, it, expect } from "vitest";
import { renewalSendDate, withPaymentLink, isRenewalOfferKind, PAYMENT_LINK_PLACEHOLDER } from "./renewal-offer";

describe("renewalSendDate", () => {
  it("sends two days before the effective end", () => {
    expect(renewalSendDate("2026-10-19", "2026-10-10")).toBe("2026-10-17");
  });

  it("never back-dates: approved inside the window → today", () => {
    expect(renewalSendDate("2026-10-19", "2026-10-18")).toBe("2026-10-18");
    expect(renewalSendDate("2026-10-19", "2026-10-25")).toBe("2026-10-25");
  });

  it("crosses a month boundary", () => {
    expect(renewalSendDate("2026-11-01", "2026-10-01")).toBe("2026-10-30");
  });
});

describe("withPaymentLink", () => {
  const link = "https://rzp.io/rzp/abc";

  it("replaces the placeholder where the letter put it", () => {
    const out = withPaymentLink(`Pay here: ${PAYMENT_LINK_PLACEHOLDER}\n\nWarmly,\nShivani`, link, "₹12,000 for six months");
    expect(out).toContain(`Pay here: ${link}`);
    expect(out).not.toContain(PAYMENT_LINK_PLACEHOLDER);
    expect(out).not.toContain("start your maintenance here");
  });

  it("without a placeholder, inserts the link ABOVE the sign-off", () => {
    const out = withPaymentLink("Dear N,\n\nThe body.\n\nWarmly,\nShivani\n", link, "₹12,000 for six months");
    const linkAt = out.indexOf(link);
    expect(linkAt).toBeGreaterThan(out.indexOf("The body."));
    expect(linkAt).toBeLessThan(out.indexOf("Warmly,"));
    expect(out).toContain("₹12,000 for six months");
  });

  it("with no recognisable sign-off, appends at the end", () => {
    const out = withPaymentLink("Dear N,\n\nThe body.", link, "x");
    expect(out.trimEnd().endsWith(link)).toBe(true);
  });
});

describe("isRenewalOfferKind", () => {
  it("accepts the three kinds only", () => {
    expect(isRenewalOfferKind("maintenance")).toBe(true);
    expect(isRenewalOfferKind("continue")).toBe(true);
    expect(isRenewalOfferKind("letter_only")).toBe(true);
    expect(isRenewalOfferKind("quarterly")).toBe(false);
    expect(isRenewalOfferKind(undefined)).toBe(false);
  });
});
