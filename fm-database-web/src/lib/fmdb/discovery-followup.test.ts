import { describe, it, expect } from "vitest";
import {
  followupDecision,
  renderFollowupEmail,
  checkFollowupEmail,
  parseBookedCallDate,
  isFreeCallEventSlug,
  quotableConcern,
  creditExpiresOn,
  touchesFor,
  type FollowupDecisionInput,
  type FollowupTouchKind,
} from "./discovery-followup";

const base: FollowupDecisionInput = {
  todayYmd: "2026-09-21",
  track: "foundation",
  callDate: "2026-09-20",
  engagementStatus: "pending",
  hasPlan: false,
  hasEmail: true,
  lastInboundAt: null,
  upcomingBookingAt: null,
  touchesHandled: [],
  exited: false,
};

describe("followupDecision — who is open", () => {
  it("drafts touch 1 the day after the call", () => {
    const d = followupDecision(base);
    expect(d.draft).toBe(true);
    if (d.draft) expect(d.touch.kind).toBe("fdn_recap");
  });

  it("treats a MISSING engagement_status as a prospect", () => {
    expect(followupDecision({ ...base, engagementStatus: null }).draft).toBe(true);
  });

  it.each(["signed_up", "declined", "lapsed", "offer_sent"])("stops for engagement %s", (es) => {
    expect(followupDecision({ ...base, engagementStatus: es }).draft).toBe(false);
  });

  it("stops once any plan exists", () => {
    expect(followupDecision({ ...base, hasPlan: true }).draft).toBe(false);
  });

  it("stops when the coach exited it", () => {
    expect(followupDecision({ ...base, exited: true }).draft).toBe(false);
  });

  it("does nothing before the call has happened", () => {
    expect(followupDecision({ ...base, todayYmd: "2026-09-19" }).draft).toBe(false);
  });

  it("holds while they are in a live conversation, resumes after", () => {
    expect(followupDecision({ ...base, lastInboundAt: "2026-09-20T15:00:00Z" }).draft).toBe(false);
    expect(
      followupDecision({ ...base, todayYmd: "2026-09-26", lastInboundAt: "2026-09-20T15:00:00Z" }).draft,
    ).toBe(true);
  });

  it("holds while another call is booked", () => {
    expect(followupDecision({ ...base, upcomingBookingAt: "2026-09-24T06:00:00Z" }).draft).toBe(false);
  });

  it("needs an email address", () => {
    expect(followupDecision({ ...base, hasEmail: false }).draft).toBe(false);
  });
});

describe("followupDecision — which touch", () => {
  it("drafts the latest due touch once, never a backlog", () => {
    const d = followupDecision({ ...base, todayYmd: "2026-09-26" }); // day 6
    expect(d.draft && d.touch.n).toBe(2);
  });

  it("does not redraft a handled touch", () => {
    const d = followupDecision({ ...base, touchesHandled: [1] });
    expect(d.draft).toBe(false);
  });

  it("the foundation credit reminder lands three days before expiry", () => {
    const t = touchesFor("foundation").find((x) => x.kind === "fdn_credit_expiring")!;
    expect(creditExpiresOn("2026-09-20")).toBe("2026-10-05");
    expect(15 - t.day).toBe(3);
  });

  it("is quiet beyond the backfill window, and complete after the last touch", () => {
    const late = followupDecision({ ...base, todayYmd: "2026-10-20", touchesHandled: [1, 2, 3] });
    expect(late.draft).toBe(false);
    const done = followupDecision({ ...base, todayYmd: "2026-10-20", touchesHandled: [1, 2, 3, 4] });
    expect(done.draft).toBe(false);
    if (!done.draft) expect(done.reason).toMatch(/complete/);
  });

  it("free track: day 5 is the Foundation offer", () => {
    const d = followupDecision({ ...base, track: "free", todayYmd: "2026-09-25", touchesHandled: [1] });
    expect(d.draft && d.touch.kind).toBe("free_foundation_offer");
  });
});

const facts = { firstName: "Asha", concern: "gut health", appUrl: "https://x/app/t", callDate: "2026-09-20" };
const FREE_KINDS: FollowupTouchKind[] = ["free_thanks", "free_foundation_offer", "free_check_in", "door_open"];
const FDN_KINDS: FollowupTouchKind[] = ["fdn_recap", "fdn_journey", "fdn_credit_expiring", "door_open"];

describe("copy", () => {
  it.each(FREE_KINDS)("free %s passes its own gate and never mentions a credit", (k) => {
    const e = renderFollowupEmail(k, facts, "free");
    expect(`${e.subject} ${e.body}`).not.toMatch(/credit/i);
    expect(checkFollowupEmail(e.subject, e.body, "free").refuse).toEqual([]);
  });

  it.each(FDN_KINDS)("foundation %s passes its own gate", (k) => {
    const e = renderFollowupEmail(k, facts, "foundation");
    expect(checkFollowupEmail(e.subject, e.body, "foundation").refuse).toEqual([]);
  });

  it("every email greets by first name and signs off", () => {
    for (const k of FREE_KINDS) {
      const { body } = renderFollowupEmail(k, facts, "free");
      expect(body.startsWith("Hi Asha,")).toBe(true);
      expect(body.trim().endsWith("Shivani")).toBe(true);
    }
  });

  it("foundation emails carry the same expiry date the app shows", () => {
    const e = renderFollowupEmail("fdn_credit_expiring", facts, "foundation");
    expect(e.body).toContain("5 October");
    expect(e.subject).toContain("5 October");
  });

  it("recap without a Starting Map does not link an empty app", () => {
    expect(renderFollowupEmail("fdn_recap", { ...facts, appUrl: null }, "foundation").body).not.toContain("http");
  });
});

describe("triage (₹999) track", () => {
  it.each(FREE_KINDS)("triage %s passes its own gate", (k) => {
    const e = renderFollowupEmail(k, facts, "triage");
    const g = checkFollowupEmail(e.subject, e.body, "triage");
    expect(g.refuse).toEqual([]);
    expect(g.warn).toEqual([]);
  });

  it("the offer quotes ₹11,001, never ₹12,000 alone", () => {
    const e = renderFollowupEmail("free_foundation_offer", facts, "triage");
    expect(e.body).toContain("₹11,001");
    expect(checkFollowupEmail("Hi", "The Foundation session is ₹12,000. Shall I book it?", "triage").ok).toBe(false);
  });

  it("free-call copy for the same touch never mentions the ₹999", () => {
    for (const k of FREE_KINDS) {
      expect(renderFollowupEmail(k, facts, "free").body).not.toContain("999");
    }
  });

  it("refuses telling a ₹999 caller they hold a ₹12,000 credit", () => {
    expect(checkFollowupEmail("Hi", "Your ₹12,000 credit is waiting.", "triage").ok).toBe(false);
  });

  it("uses the free-call cadence", () => {
    const d = followupDecision({ ...base, track: "triage", todayYmd: "2026-09-25", touchesHandled: [1] });
    expect(d.draft && d.touch.kind).toBe("free_foundation_offer");
  });
});

describe("checkFollowupEmail — the free-call credit rule", () => {
  it("refuses any credit wording to a free-call person, subject included", () => {
    expect(checkFollowupEmail("Hello", "your ₹12,000 credit is waiting for you.", "free").ok).toBe(false);
    expect(checkFollowupEmail("Your credit", "hello", "free").ok).toBe(false);
  });

  it("refuses a loose 'adjusted against' to a free-call person", () => {
    expect(checkFollowupEmail("Hi", "our call fee is adjusted against the programme.", "free").ok).toBe(false);
  });

  it("refuses re-selling the Foundation session to someone who bought it", () => {
    expect(checkFollowupEmail("Hi", "the Foundation session is ₹12,000 — shall I book it?", "foundation").ok).toBe(false);
  });

  it("refuses placeholders and an empty subject", () => {
    expect(checkFollowupEmail("Hi", "your link: [LINK].", "free").ok).toBe(false);
    expect(checkFollowupEmail(" ", "hello", "free").ok).toBe(false);
  });

  it("warns on a price other than the Foundation fee", () => {
    const g = checkFollowupEmail("Hi", "the programme is ₹85,000.", "foundation");
    expect(g.ok).toBe(true);
    expect(g.warn.length).toBe(1);
  });
});

describe("parseBookedCallDate", () => {
  it("reads the cal.com line (with 'Sept')", () => {
    expect(
      parseBookedCallDate("Booked 15 min Discover call for Tue, 8 Sept, 2026, 11:00 am IST.\nBooked via Cal.com."),
    ).toBe("2026-09-08");
  });
  it("reads the website line", () => {
    expect(parseBookedCallDate("Booked Discovery Call for Tue, 22 Sept, 2026, 2:45 pm IST.")).toBe("2026-09-22");
  });
  it("reads short months", () => {
    expect(parseBookedCallDate("Booked 15 min Discover call for Fri, 7 Aug, 2026, 4:30 pm IST.")).toBe("2026-08-07");
  });
  it("returns null rather than guessing", () => {
    expect(parseBookedCallDate("Booked a coaching session for tomorrow")).toBeNull();
    expect(parseBookedCallDate("Booked Discovery Call for Tue, 31 Feb, 2026")).toBeNull();
    expect(parseBookedCallDate(null)).toBeNull();
  });
});

describe("helpers", () => {
  it("recognises the free call slug, not the paid ones", () => {
    expect(isFreeCallEventSlug("15min")).toBe(true);
    expect(isFreeCallEventSlug("discovery-call")).toBe(true);
    expect(isFreeCallEventSlug("programme-intake-session")).toBe(false);
    expect(isFreeCallEventSlug("coaching-session")).toBe(false);
  });
  it("quotes only short concerns", () => {
    expect(quotableConcern("Gut health")).toBe("gut health");
    expect(quotableConcern("Autoimmune disorders (Hashimoto’s thyroid and MS), fatigue, chronic anaemia, possible insulin resistance, weight")).toBeNull();
  });
});

describe("the ₹999 figures agree with the pay route", () => {
  it("follow-up copy and checkout use the same credit and price", async () => {
    const fo = await import("./foundation-orders");
    const df = await import("./discovery-followup");
    expect(df.TRIAGE_CREDIT_INR).toBe(fo.TRIAGE_CALL_PRICE_INR);
    expect(df.FOUNDATION_AFTER_TRIAGE_INR).toBe(fo.foundationPriceFor({ triage_call_date: "2026-09-20" }).amountInr);
  });
});
