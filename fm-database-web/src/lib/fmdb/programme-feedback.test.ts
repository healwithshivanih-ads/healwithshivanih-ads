import { describe, it, expect } from "vitest";
import {
  parseClientGoals,
  resolveFeedbackDue,
  sanitiseFeedback,
  summariseFeedback,
  type FeedbackRow,
  type FeedbackStage,
} from "./programme-feedback";

describe("parseClientGoals", () => {
  it("splits bulleted blocks and de-duplicates a re-submitted intake (the cl-022 shape)", () => {
    const raw = [
      "- getting my sleep back on track",
      "- generally overall feeling better - not anxious, tired, irritable",
      "- dry mouth to be non existent like it was before",
      "- getting my sleep back on track\n- getting my hormones under control\n- not feeling tired, anxious etc",
      "- dry mouth to be non existent like it was before (it’s more that feeling thirsty all the time)",
    ];
    expect(parseClientGoals(raw)).toEqual([
      "Getting my sleep back on track",
      "Generally overall feeling better - not anxious, tired, irritable",
      "Dry mouth to be non existent like it was before",
      "Getting my hormones under control",
      "Not feeling tired, anxious etc",
    ]);
  });

  it("caps at five and tolerates junk", () => {
    expect(parseClientGoals(null)).toEqual([]);
    expect(parseClientGoals([1, "", "  "])).toEqual([]);
    expect(parseClientGoals("a1\nb2\nc3\nd4\ne5\nf6")).toHaveLength(5);
  });
});

describe("resolveFeedbackDue", () => {
  const base = { week: 1, totalWeeks: 12, recheckDate: "2026-10-19", todayYmd: "2026-10-15", done: new Set<FeedbackStage>() };

  it("asks the midpoint from halfway through an active plan, not before", () => {
    expect(resolveFeedbackDue({ ...base, mode: "ACTIVE", week: 5 })).toBeNull();
    expect(resolveFeedbackDue({ ...base, mode: "ACTIVE", week: 6 })).toBe("midpoint");
  });

  it("never asks a midpoint on a short plan", () => {
    expect(resolveFeedbackDue({ ...base, mode: "ACTIVE", week: 3, totalWeeks: 4 })).toBeNull();
  });

  it("asks nothing in the final-stretch lead-in — the end-game banner is already asking", () => {
    expect(resolveFeedbackDue({ ...base, mode: "REVIEW", approaching: true, week: 12 })).toBeNull();
  });

  it("asks graduation once the end is reached, even if the midpoint was skipped", () => {
    expect(resolveFeedbackDue({ ...base, mode: "REVIEW", approaching: false, week: 12 })).toBe("graduation");
  });

  it("keeps the graduation ask open after the plan ends — a lapsed client is still asked", () => {
    expect(resolveFeedbackDue({ ...base, mode: "LIBRARY", todayYmd: "2027-03-01" })).toBe("graduation");
  });

  it("opens the follow-up 90 days after the end, once graduation is answered", () => {
    const done = new Set<FeedbackStage>(["graduation"]);
    expect(resolveFeedbackDue({ ...base, mode: "MAINTENANCE", done, todayYmd: "2027-01-16" })).toBeNull();
    expect(resolveFeedbackDue({ ...base, mode: "MAINTENANCE", done, todayYmd: "2027-01-17" })).toBe("followup");
    expect(resolveFeedbackDue({ ...base, mode: "REVIEW", done, todayYmd: "2027-06-01" })).toBeNull();
  });

  it("asks nothing once every stage is answered", () => {
    const done = new Set<FeedbackStage>(["midpoint", "graduation", "followup"]);
    expect(resolveFeedbackDue({ ...base, mode: "LIBRARY", done, todayYmd: "2027-06-01" })).toBeNull();
  });
});

describe("sanitiseFeedback", () => {
  it("clamps out-of-range numbers to null and drops unknown parts", () => {
    const r = sanitiseFeedback({
      stage: "graduation",
      week: 12,
      goals: [{ goal: "Sleep", change: 9 }, { goal: "Energy", change: 2 }],
      parts: { menus: 5, app: 0, bogus: 4 },
      recommend: 11,
      testimonial: "named",
    });
    if (typeof r === "string") throw new Error(r);
    expect(r.goals).toEqual([{ goal: "Sleep", change: null }, { goal: "Energy", change: 2 }]);
    expect(r.parts.menus).toBe(5);
    expect(r.parts.app).toBeNull();
    expect("bogus" in r.parts).toBe(false);
    expect(r.recommend).toBeNull();
    expect(r.testimonial).toBe("named");
  });

  it("never records testimonial consent at the midpoint", () => {
    const r = sanitiseFeedback({ stage: "midpoint", recommend: 9, testimonial: "named" });
    if (typeof r === "string") throw new Error(r);
    expect(r.testimonial).toBe("no");
  });

  it("refuses an empty form and an unknown stage", () => {
    expect(sanitiseFeedback({ stage: "graduation" })).toBe("nothing answered");
    expect(sanitiseFeedback({ stage: "exit", recommend: 9 })).toBe("unknown stage");
  });
});

describe("summariseFeedback", () => {
  const row = (over: Partial<FeedbackRow>): FeedbackRow => ({
    clientId: "cl-1",
    clientName: "A",
    date: "2026-10-20",
    stage: "graduation",
    week: 12,
    goals: [],
    parts: {},
    recommend: null,
    biggest_change: "",
    hardest: "",
    change_one_thing: "",
    testimonial: "no",
    ...over,
  });

  it("computes NPS from graduation + follow-up only", () => {
    const s = summariseFeedback([
      row({ clientId: "a", recommend: 10 }),
      row({ clientId: "b", recommend: 9 }),
      row({ clientId: "c", recommend: 5 }),
      row({ clientId: "d", recommend: 8 }),
      row({ clientId: "e", stage: "midpoint", recommend: 0 }),
    ]);
    // 2 promoters, 1 detractor, 4 answered → 25
    expect(s.nps).toBe(25);
    expect(s.npsAnswered).toBe(4);
    expect(s.responses).toBe(5);
    expect(s.clients).toBe(5);
  });

  it("averages parts and buckets goal change", () => {
    const s = summariseFeedback([
      row({ parts: { menus: 5, app: null }, goals: [{ goal: "x", change: 3 }, { goal: "y", change: 1 }] }),
      row({ parts: { menus: 4 }, goals: [{ goal: "x", change: 0 }, { goal: "y", change: -1 }, { goal: "z", change: null }] }),
    ]);
    expect(s.parts.menus).toEqual({ avg: 4.5, n: 2 });
    expect(s.parts.app).toBeUndefined();
    expect(s.goalChange).toEqual({ worse: 1, same: 1, better: 1, resolved: 1, rated: 4 });
  });

  it("is empty-safe", () => {
    expect(summariseFeedback([]).nps).toBeNull();
  });
});
