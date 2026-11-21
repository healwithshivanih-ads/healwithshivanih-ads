/**
 * The ask box's fixed safety rules.
 *
 * Every input here came from somewhere real: the prototype's regression list,
 * the round-4 tester findings in docs/client-app-redesign/BUILD-PLAN.md, or
 * the live chat's emergency list. A case that stops passing means a client
 * could be shown a plan answer where she needed the emergency card, or the
 * emergency card for a joke — so fix the rule, never the expectation.
 */

import { describe, expect, it } from "vitest";
import { EMERGENCY_HINTS } from "./triage";
import {
  HANDOFF_COPY,
  REPLY_LINE,
  URGENT_COPY,
  askHandoff,
  askUrgent,
  coachTabNote,
  isMissedCapsule,
  type HandoffKind,
} from "./ask-safety";

describe("askUrgent — self-harm", () => {
  it.each([
    "i want to die",
    "I don't want to be here anymore",
    "I want to hurt myself",
    "marna chahti hu",
    // round 4
    "better off dead",
    "kms lol",
    "sucide",
    "suicide",
    "I keep thinking about killing myself",
    "jeene ka man nahi hai",
  ])("%s", (q) => {
    expect(askUrgent(q)).toBe("selfharm");
  });

  it("wins over an emergency phrase in the same message", () => {
    expect(askUrgent("my chest hurts and I want to die")).toBe("selfharm");
  });
});

describe("askUrgent — emergency", () => {
  it.each([
    "my chest feels tight",
    "seene me dard ho raha hai",
    "mujhe chakkar aa raha hai aur seene mein dard hai",
    "saans nahi aa rahi",
    "chest pain since morning",
    // round 4
    "chet pain",
    "seene me bhaari dard ho raha hai aur pasina",
    "I took too many pills",
    // chest wording gets the emergency card alone, even when she calls it panic
    "I think it's a panic attack, my chest is tight",
    "I can not bear this chest pain",
    "no, chest pain is back",
    "I have no chest pain but I can't breathe",
    "I fainted in the kitchen",
  ])("%s", (q) => {
    expect(askUrgent(q)).toBe("emergency");
  });

  it("everything the live chat calls an emergency is urgent here too", () => {
    for (const hint of EMERGENCY_HINTS) {
      expect(askUrgent(`I have ${hint} right now`), hint).not.toBeNull();
    }
  });

  it.each([
    "I fainted with laughter",
    "chest pain nahi hai, just checking",
    "no chest pain today",
    "seene me dard nahi hai",
    "I don't have any chest pain",
    "the chest tightness has gone",
    "hot flush at work and my heart is racing, what can I do right now",
    "what's for dinner",
    "",
    "   ",
  ])("is not an emergency: %s", (q) => {
    expect(askUrgent(q)).toBeNull();
  });
});

describe("askHandoff — the coach answers these personally", () => {
  const cases: [string, HandoffKind][] = [
    // medicine
    ["Can I take magnesium with my SSRI?", "medicine"],
    ["should I stop my thyronorm", "medicine"],
    ["dawai ke saath le sakti hu", "medicine"],
    // another person's health
    ["What is my husband's plan?", "other_person"],
    ["mere husband ko sugar hai kya wo bhi ye khichdi kha sakte hai", "other_person"],
    ["my husband has high BP, what should he eat", "other_person"],
    ["can my daughter follow this", "other_person"],
    // alcohol is never answered by the app
    ["can i drink wine", "alcohol"],
    ["can i drink", "alcohol"],
    ["Can I drink?", "alcohol"],
    ["can I have a drink", "alcohol"],
    ["late client dinner with drinks", "alcohol"],
    // results are not shared in the app yet (step 5)
    ["my hba1c is 6.1 is that ok", "results"],
    ["sugar report", "results"],
    ["is my vitamin D low?", "results"],
    ["is my vitamin D in range", "results"],
    ["what is my body age", "results"],
    ["Show me my lab results and when the next blood test is.", "results"],
    // supplements taken together
    ["Is it safe to restart all my supplements at once after a gap?", "combine"],
    ["what is the magnesium for, and can I take it with my B-complex", "combine"],
    [
      "At exactly what time should I take the magnesium, and can I take it with the vitamin D3 and the B-complex together?",
      "combine",
    ],
    // a fast or expected weight change
    ["What should I do about my weight, I have lost 3 kg in a week", "weight_change"],
    ["mera vajan kitna kam hoga 3 mahine me", "weight_change"],
    // symptoms
    ["chakkar aa raha hai aur dil ghabra raha hai", "symptom"],
    ["sir me bahut dard hai", "symptom"],
    ["I'm having palpitations and feel dizzy", "symptom"],
    ["thoda chakkar aa raha hai", "symptom"],
    ["my stomach hurts after the iron", "symptom"],
    ["chest pain nahi hai, just checking", "symptom"],
    // dose
    ["can i skip the b-complex today", "dose"],
    ["Can I take 2 Vitamin D3 tablets today?", "dose"],
    ["should I double my magnesium", "dose"],
    ["missed my b-complex", "dose"],
    // the wider health picture
    ["I feel stressed and cant sleep, is my cortisol high", "results"], // "is my X high" asks for a reading
    ["could this be my hormones", "health_picture"],
    ["is this good for pcos", "health_picture"],
  ];
  it.each(cases)("%s → %s", (q, kind) => {
    expect(askUrgent(q)).toBeNull();
    expect(askHandoff(q)).toBe(kind);
  });

  it("a symptom after a medicine still goes to the coach", () => {
    expect(askHandoff("iron ki goli khane ke baad pet me dard ho raha hai")).not.toBeNull();
  });

  it.each([
    "What's for dinner?",
    "what is left to tick today?",
    "what time did I take my iron?",
    "did I take my magnesium on Monday?",
    "is tomorrow an iron day?",
    "Why magnesium at night?",
    "when is my next session",
    "what time does my coach reply?",
    "Can I eat idli?",
    "dudh wali chai pi sakti hu",
    "can i have chai with my iron tablet",
    "when should I take iron relative to tea",
    "Shopping list",
    "I run a shop and eat lunch at 3, can I shift the times?",
    "can i drink water before breakfast",
    "aaj mehman aa rahe hai kya banau",
    "I'm furious with everyone today",
    // someone else is mentioned, but the question is her own
    "my husband wants pizza, can I have a slice",
    "my son is ordering biryani, what should I order",
  ])("is left for the plan lookups and the model: %s", (q) => {
    expect(askUrgent(q)).toBeNull();
    expect(askHandoff(q)).toBeNull();
  });
});

describe("isMissedCapsule", () => {
  it("knows a missed supplement from a missed meal", () => {
    expect(isMissedCapsule("missed my b-complex")).toBe(true);
    expect(isMissedCapsule("iron lena bhool gayi")).toBe(true);
    expect(isMissedCapsule("I forgot my capsule this morning")).toBe(true);
    expect(isMissedCapsule("I missed lunch")).toBe(false);
  });
});

describe("the words on the cards", () => {
  it("the self-harm card carries no helpline number, only 112 and the hospital", () => {
    const text = URGENT_COPY.selfharm.lines.join(" ");
    expect(text).toContain("112");
    expect(text.replace("112", "")).not.toMatch(/\d{3,}/);
  });

  it("never names the coach or uses a pronoun for the coach", () => {
    const all = [
      REPLY_LINE,
      ...Object.values(URGENT_COPY).flatMap((c) => [c.src, c.heading, ...c.lines]),
      ...Object.values(HANDOFF_COPY).flatMap((c) => [c.line, c.note ?? ""]),
    ].join(" ");
    expect(all).not.toMatch(/shivani/i);
    expect(all).not.toMatch(/\b(she|her|hers|he|him|his)\b/i);
    expect(REPLY_LINE).toContain("24 hours");
  });
});

describe("coachTabNote — a message typed straight to the coach", () => {
  it("shows the emergency card beside an emergency message", () => {
    expect(coachTabNote("chet pain since an hour")).toEqual({ urgent: "emergency" });
    expect(coachTabNote("I want to die")).toEqual({ urgent: "selfharm" });
  });
  it("shows the see-a-doctor line beside a symptom", () => {
    expect(coachTabNote("my stomach hurts after the iron")).toEqual({ doctor: HANDOFF_COPY.symptom.note });
  });
  it("adds nothing to an ordinary message", () => {
    expect(coachTabNote("Thank you, see you Saturday")).toBeNull();
    // A medicine question is still just a message once it is going to the coach.
    expect(coachTabNote("should I stop my thyronorm")).toBeNull();
  });
});

describe("round 6 safety gaps (21 Nov 2026)", () => {
  it.each([
    ["chest me bahut dard ho raha hai kya karu", "emergency"],
    ["chest mein jalan ho rahi hai", "emergency"],
    ["Mann karta hai sab khatam kar doon", "selfharm"],
    ["zindagi khatam kar dena chahti hoon", "selfharm"],
    ["I took 20 of my magnesium capsules at once by mistake", "emergency"],
    ["took ten iron tablets", "emergency"],
    ["maine 6 goli ek saath kha li", "emergency"],
  ])("%s → %s", (q, want) => {
    expect(askUrgent(q)).toBe(want);
  });
  it.each(["I took 2 capsules of magnesium", "sab khatam kar diya, thali saaf", "took my iron at 8"])("%s is not urgent", (q) => {
    expect(askUrgent(q)).toBeNull();
  });
});
