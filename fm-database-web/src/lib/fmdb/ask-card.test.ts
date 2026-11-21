/**
 * The model never writes straight to the client. Whatever it sends is read by
 * parseModelCard, and anything that is not a well-formed card becomes "defer"
 * (an offer to send the question to the coach). These tests are the list of
 * ways a model reply can be wrong.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTO_CHECK_NOTE, MODEL_BUTTONS, inventsAReason, NO_ANSWER_CARD, handoffCard, parseModelCard, urgentCard } from "./ask-card";

const answer = (o: Record<string, unknown>) => JSON.stringify({ verdict: "answer", ...o });

describe("parseModelCard", () => {
  it("reads a well-formed answer", () => {
    const got = parseModelCard(answer({ heading: "Yes, without milk", lines: ["Tea is fine on your plan.", "Milk is left out for now."], buttons: ["day"] }));
    expect(got).toEqual({
      verdict: "answer",
      card: {
        src: "From your plan",
        heading: "Yes, without milk",
        lines: ["Tea is fine on your plan.", "Milk is left out for now."],
        buttons: [{ to: "day", label: "Your whole day" }],
      },
    });
  });

  it("reads the card out of a reply wrapped in a code fence or stray words", () => {
    const fenced = "```json\n" + answer({ heading: "Yes", lines: ["Idli is on your menu."] }) + "\n```";
    expect(parseModelCard(fenced).verdict).toBe("answer");
    expect(parseModelCard("Here you go: " + answer({ lines: ["Idli is on your menu."] })).verdict).toBe("answer");
  });

  it.each([
    ['{"verdict":"emergency"}', "emergency"],
    ['{"verdict":"selfharm"}', "selfharm"],
    ['{"verdict":"self_harm"}', "selfharm"],
    ['{"verdict":"defer"}', "defer"],
    ["EMERGENCY", "emergency"],
    ["emergency.", "emergency"],
    ["SELFHARM", "selfharm"],
    ["DEFER", "defer"],
  ])("%s → %s", (raw, verdict) => {
    expect(parseModelCard(raw)).toEqual({ verdict });
  });

  it.each([
    ["nothing at all", ""],
    ["not a string", 42 as unknown as string],
    ["free text, as today's app returns", "Yes, you can have tea without milk."],
    ["broken JSON", '{"verdict":"answer","lines":["Tea is fine"'],
    ["a JSON array", '[{"verdict":"answer"}]'],
    ["an unknown verdict", '{"verdict":"maybe","lines":["x"]}'],
    ["no verdict", '{"lines":["Tea is fine."]}'],
    ["an answer with no lines", answer({ heading: "Yes" })],
    ["an answer whose lines are empty", answer({ lines: ["", "  "] })],
    ["lines that are not a list", answer({ lines: "Tea is fine." })],
    ["a line that runs on", answer({ lines: ["x".repeat(241)] })],
    ["a heading that runs on", answer({ heading: "y".repeat(81), lines: ["Tea is fine."] })],
    ["the coach's name", answer({ lines: ["Shivani says tea is fine."] })],
    ["a leaked control word", answer({ lines: ["I should DEFER this."] })],
  ])("fails towards the coach: %s", (_label, raw) => {
    expect(parseModelCard(raw)).toEqual({ verdict: "defer" });
  });

  it("keeps the first three lines of a longer answer", () => {
    const got = parseModelCard(answer({ lines: ["a", "b", "c", "d"] }));
    if (got.verdict !== "answer") throw new Error("expected an answer");
    expect(got.card.lines).toEqual(["a", "b", "c"]);
  });

  it("keeps only buttons from the fixed list, at most two, each once", () => {
    const got = parseModelCard(answer({ lines: ["x"], buttons: ["shop", "coach", "coach", "day", "record", "https://evil.example"] }));
    if (got.verdict !== "answer") throw new Error("expected an answer");
    expect(got.card.buttons).toEqual([
      { to: "coach", label: MODEL_BUTTONS.coach },
      { to: "day", label: MODEL_BUTTONS.day },
    ]);
  });

  it("collapses stray whitespace and newlines in the text", () => {
    const got = parseModelCard(answer({ heading: " Yes \n", lines: ["Tea  is\nfine."] }));
    if (got.verdict !== "answer") throw new Error("expected an answer");
    expect(got.card.heading).toBe("Yes");
    expect(got.card.lines).toEqual(["Tea is fine."]);
  });
});

describe("fixed cards", () => {
  it("the emergency card has no button: nothing may slow a call for help", () => {
    expect(urgentCard("emergency").buttons).toEqual([]);
    expect(urgentCard("emergency").tone).toBe("urgent");
  });
  it("the self-harm card offers the coach, with words she can send as they are", () => {
    expect(urgentCard("selfharm").buttons).toEqual([{ to: "coach", label: "Message my coach", draft: "I need to talk." }]);
  });
  it("every hand-off offers to send the question", () => {
    expect(handoffCard("medicine").handoff).toBe(true);
    expect(handoffCard("symptom").note).toContain("see a doctor today");
    expect(NO_ANSWER_CARD.handoff).toBe(true);
  });
});

/**
 * Wiring pins for the paid path. Each is one line that a later edit could
 * quietly undo, and each failure would either spend money on a client who has
 * lapsed or put unchecked model text in front of a client.
 */
describe("wiring", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("the route checks the fixed safety rules before it spends anything", () => {
    const src = read("src/app/api/app-copilot/route.ts");
    const fn = src.slice(src.indexOf("async function cardAnswer("));
    const at = (needle: string) => {
      const i = fn.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at("askUrgent(question)"),
      at("askHandoff(question)"),
      at('allowDaily("app-copilot"'),
      at("clientIsLapsed("),
      at('data.mode === "LIBRARY"'),
      at("runShim("),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The model's words reach the phone only through the parser.
    expect(fn).toMatch(/parseModelCard\(out\.answer\)/);
    expect(fn).not.toMatch(/answer: out\.answer/);
  });

  it("the script still refuses a lapsed client, keeps the small model and logs the spend", () => {
    const src = read("scripts/app-copilot.py");
    expect(src).toMatch(/refuse_if_expired\(client_id, "app-copilot\.py"\)/);
    expect(src.match(/model="claude-haiku-4-5"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/log_usage\(/);
    // The fixed prompt and the plan context sit under cache_control.
    expect(src.match(/"cache_control": \{"type": "ephemeral"\}/g)?.length).toBe(2);
  });

  it("the model's instructions list exactly the buttons the parser accepts", () => {
    const src = read("scripts/app-copilot.py");
    for (const key of Object.keys(MODEL_BUTTONS)) expect(src, key).toContain(`\\"${key}\\"`);
  });
});

describe("automatic answer on a dish the plan does not name (coach, 21 Nov 2026)", () => {
  it("is marked, carries the note, and drops the coach button (the question goes by itself)", () => {
    const v = parseModelCard('{"verdict":"answer","heading":"Likely yes, a small bowl","lines":["Nothing in it is on your leave-out list."],"buttons":["coach"],"check_with_coach":true}');
    expect(v.verdict).toBe("answer");
    if (v.verdict !== "answer") return;
    expect(v.card.autoCheck).toBe(true);
    expect(v.card.src).toBe("Quick answer");
    expect(v.card.note).toBe(AUTO_CHECK_NOTE);
    expect(v.card.buttons).toEqual([]);
  });
  it("an ordinary answer is not marked", () => {
    const v = parseModelCard('{"verdict":"answer","heading":"Yes","lines":["Dal is on your menu."]}');
    expect(v.verdict === "answer" && v.card.autoCheck).toBeFalsy();
  });
});

describe("a reason the plan never gave is not shown", () => {
  const card = (heading: string, line: string) => ({ src: "x", heading, lines: [line] });
  it("catches cream and butter when the plan leaves out no dairy", () => {
    expect(inventsAReason(card("Skip dal makhani", "It is made with cream and butter."), "Leave out: wheat, rice", "can I have dal makhani")).toBe(true);
  });
  it("lets a reason through when the plan names it, or the client did", () => {
    expect(inventsAReason(card("Skip it", "Fried food is on your skip list."), "Eating out: skip fried snacks", "pakora?")).toBe(false);
    expect(inventsAReason(card("Yes", "Butter is fine."), "Leave out: wheat", "can I have butter")).toBe(false);
    expect(inventsAReason(card("Yes, dal is on your menu", "Have a small bowl."), "Leave out: wheat", "dal?")).toBe(false);
  });
});
