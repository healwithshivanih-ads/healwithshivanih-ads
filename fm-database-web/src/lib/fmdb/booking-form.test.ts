import { describe, expect, it } from "vitest";
import { bookingConcern, bookingFreeText, parseBookingFormNote } from "./booking-form";

// The cal.com form as it reached cl-907 (Oct 2026): duration question FIRST.
const CALCOM_907 = [
  { question: "How long has this been going on?", answer: "1 to 3 years" },
  { question: "Would you be willing to invest your time and money to improve your health?", answer: "Yes" },
  { question: "What is your main area of concern?", answer: "High BP and Mental health" },
  {
    question: "additional_notes",
    answer: "Migraine, high bp and currently diagnosed with hb1c 6.2. Also want to take care of mental health.",
  },
];

describe("bookingConcern", () => {
  it("takes the main-concern answer, not the first answer (the cl-907 bug)", () => {
    expect(bookingConcern(CALCOM_907)).toBe("High BP and Mental health");
  });

  it("falls back to the notes field when the concern question is missing", () => {
    expect(
      bookingConcern([
        { question: "How long has this been going on?", answer: "Less than 6 months" },
        { question: "additional_notes", answer: "Bloating after every meal" },
      ]),
    ).toBe("Bloating after every meal");
  });

  it("never returns a duration or a yes/no", () => {
    expect(
      bookingConcern([
        { question: "How long has this been going on?", answer: "More than 3 years" },
        { question: "Would you be willing to invest?", answer: "Maybe" },
      ]),
    ).toBeNull();
    expect(bookingConcern([{ question: "", answer: "1 to 3 years" }])).toBeNull();
    expect(bookingConcern([{ question: "", answer: "less than 6 months" }])).toBeNull();
    expect(bookingConcern([{ question: "", answer: "2 weeks" }])).toBeNull();
  });

  it("keeps a Wix-style first answer that is a real concern", () => {
    expect(
      bookingConcern([{ question: "Tell us about your health", answer: "Migraine, iron and vitamin deficiency, sleep" }]),
    ).toBe("Migraine, iron and vitamin deficiency, sleep");
  });

  it("does not mistake 'manage' for an age question", () => {
    expect(
      bookingConcern([{ question: "What would you like help to manage?", answer: "My weight" }]),
    ).toBe("My weight");
  });

  it("is null for an empty form", () => {
    expect(bookingConcern([])).toBeNull();
    expect(bookingConcern(undefined)).toBeNull();
  });
});

describe("bookingFreeText", () => {
  it("joins the concern and notes, leaving out durations and yes/no", () => {
    const t = bookingFreeText(CALCOM_907);
    expect(t).toContain("High BP");
    expect(t).toContain("hb1c 6.2");
    expect(t).not.toContain("1 to 3 years");
    expect(t).not.toMatch(/^Yes$/m);
  });
});

describe("parseBookingFormNote", () => {
  const note = [
    "Booked 15 min Discover call between Shivani Hariharan and Sangeeta Rajesh  for Tue, 29 Sept, 2026, 9:15 am IST.",
    "Booked via Cal.com.",
    "Contact given at booking: someone@example.com · +910000000000",
    "",
    "What they told us on the booking form:",
    "- How long has this been going on?",
    "  1 to 3 years",
    "- What is your main area of concern?",
    "  High BP and Mental health",
    "- additional_notes",
    "  Migraine, high bp.",
    "  Also want to take care of mental health.",
    "",
    "[booking: hKJkEFxQQe68729sLNKFGf]",
  ].join("\n");

  it("reads every question and answer back, multi-line answers joined", () => {
    const f = parseBookingFormNote(note);
    expect(f).toHaveLength(3);
    expect(f[1]).toEqual({ question: "What is your main area of concern?", answer: "High BP and Mental health" });
    expect(f[2].answer).toBe("Migraine, high bp.\nAlso want to take care of mental health.");
  });

  it("round-trips into the right concern", () => {
    expect(bookingConcern(parseBookingFormNote(note))).toBe("High BP and Mental health");
  });

  it("is empty when the note has no form section", () => {
    expect(parseBookingFormNote("Booked Discovery Call for Tue, 22 Sept, 2026.")).toEqual([]);
    expect(parseBookingFormNote(null)).toEqual([]);
  });
});
