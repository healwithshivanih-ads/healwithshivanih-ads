import { describe, it, expect } from "vitest";
import {
  followupDecision,
  renderFollowupMessage,
  checkFollowupMessage,
  parseBookedCallDate,
  isFreeCallEventSlug,
  quotableConcern,
  creditExpiresOn,
  touchesFor,
  type FollowupDecisionInput,
  type FollowupTouchKind,
  type FollowupTrack,
} from "./discovery-followup";

const base: FollowupDecisionInput = {
  todayYmd: "2026-09-21",
  track: "foundation",
  callDate: "2026-09-20",
  engagementStatus: "pending",
  hasPlan: false,
  hasPhone: true,
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

  it("needs a phone", () => {
    expect(followupDecision({ ...base, hasPhone: false }).draft).toBe(false);
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
    const msg = renderFollowupMessage(k, facts, "free");
    expect(msg).not.toMatch(/credit/i);
    expect(checkFollowupMessage(msg, "free").ok).toBe(true);
  });

  it.each(FDN_KINDS)("foundation %s passes its own gate", (k) => {
    const msg = renderFollowupMessage(k, facts, "foundation");
    const g = checkFollowupMessage(msg, "foundation");
    expect(g.refuse).toEqual([]);
  });

  it("no rendered message carries a line break (Meta rejects them)", () => {
    for (const [k, tr] of [
      ...FREE_KINDS.map((k) => [k, "free"] as const),
      ...FDN_KINDS.map((k) => [k, "foundation"] as const),
    ]) {
      expect(renderFollowupMessage(k, facts, tr as FollowupTrack)).not.toMatch(/\n/);
    }
  });

  it("foundation messages carry the same expiry date the app shows", () => {
    expect(renderFollowupMessage("fdn_credit_expiring", facts, "foundation")).toContain("5 October");
  });

  it("recap without a Starting Map does not link an empty app", () => {
    expect(renderFollowupMessage("fdn_recap", { ...facts, appUrl: null }, "foundation")).not.toContain("http");
  });
});

describe("checkFollowupMessage — the free-call credit rule", () => {
  it("refuses any credit wording to a free-call person", () => {
    const g = checkFollowupMessage("your ₹12,000 credit is waiting for you.", "free");
    expect(g.ok).toBe(false);
  });

  it("refuses a loose 'adjusted against' to a free-call person", () => {
    expect(checkFollowupMessage("our call fee is adjusted against the programme.", "free").ok).toBe(false);
  });

  it("refuses re-selling the Foundation session to someone who bought it", () => {
    expect(checkFollowupMessage("the Foundation session is ₹12,000 — shall I book it?", "foundation").ok).toBe(false);
  });

  it("refuses line breaks and placeholders", () => {
    expect(checkFollowupMessage("hello\nthere.", "free").ok).toBe(false);
    expect(checkFollowupMessage("your link: [LINK].", "free").ok).toBe(false);
  });

  it("warns on a price other than the Foundation fee", () => {
    const g = checkFollowupMessage("the programme is ₹85,000.", "foundation");
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
