import { describe, expect, it } from "vitest";
import { feedbackEmail } from "./feedback-notify";
import type { FeedbackResponse } from "./programme-feedback";

const r: FeedbackResponse = {
  stage: "graduation",
  week: 12,
  goals: [
    { goal: "Getting my sleep back on track", change: 2 },
    { goal: "Skipped goal", change: null },
  ],
  parts: { menus: 4, supplements: 5, app: 4, whatsapp: null, calls: 5 },
  recommend: 10,
  biggest_change: "my symptoms are <much> less",
  hardest: "",
  change_one_thing: "the app is quite clunky",
  testimonial: "named",
};

describe("feedbackEmail", () => {
  const e = feedbackEmail("Nazneen Test", "cl-022", r, "https://coach.example");

  it("puts who, which stage and the score in the subject", () => {
    expect(e.subject).toBe("💬 Nazneen Test sent end-of-programme feedback — would recommend 10/10");
  });

  it("carries every answered goal, part and comment, and skips the empty ones", () => {
    expect(e.text).toContain("Getting my sleep back on track: Much better");
    expect(e.text).not.toContain("Skipped goal");
    expect(e.text).toContain("The app: 4/5");
    expect(e.text).not.toContain("WhatsApp support");
    expect(e.text).toContain("ONE THING THEY'D CHANGE");
    expect(e.text).not.toContain("HARDEST PART");
    expect(e.text).toContain("Testimonial: Yes — may be quoted with their first name");
  });

  it("links to the PUBLIC coach host, never the Fly intake host", () => {
    expect(e.text).toContain("https://coach.example/clients-v2/cl-022");
    expect(e.html).not.toContain("intake.theochretree.com");
  });

  it("escapes the client's own words in the HTML", () => {
    expect(e.html).toContain("&lt;much&gt;");
    expect(e.html).not.toContain("<much>");
  });

  it("does not show testimonial consent for a midpoint answer (never asked)", () => {
    const mid = feedbackEmail("N", "cl-1", { ...r, stage: "midpoint", testimonial: "no" }, "https://x");
    expect(mid.text).not.toContain("Testimonial");
  });
});
