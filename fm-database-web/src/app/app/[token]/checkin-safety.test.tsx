/**
 * What the weekly check-in shows beside a send: the ask box's urgent card or
 * its "see a doctor today" line (ask-safety.ts), and plain words — never an
 * HTTP status — when the check-in did not go.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { coachTabNote } from "@/lib/fmdb/ask-safety";
import { CheckinSafetyNote, checkinErrorLine } from "./ochre-checkin";

describe("CheckinSafetyNote", () => {
  it("shows the emergency card for emergency words", () => {
    const html = renderToStaticMarkup(<CheckinSafetyNote note={coachTabNote("my chest feels tight")} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("This may be an emergency");
    expect(html).toContain("Call 112");
  });
  it("shows the self-harm card for self-harm words", () => {
    const html = renderToStaticMarkup(<CheckinSafetyNote note={coachTabNote("i want to hurt myself")} />);
    expect(html).toContain("You do not have to carry this alone");
  });
  it("shows the doctor line for a new symptom", () => {
    const html = renderToStaticMarkup(<CheckinSafetyNote note={coachTabNote("I have had a headache all week")} />);
    expect(html).toContain("see a doctor today");
    expect(html).toContain("Your coach replies within 24 hours.");
  });
  it("shows nothing for an ordinary note", () => {
    expect(renderToStaticMarkup(<CheckinSafetyNote note={coachTabNote("slept well, felt lighter")} />)).toBe("");
  });
});

describe("checkinErrorLine", () => {
  it.each([null, 400, 401, 429, 500, 502])("is plain words for %s", (status) => {
    const line = checkinErrorLine(status);
    expect(line).not.toMatch(/HTTP|\d{3}|error/i);
    expect(line.length).toBeGreaterThan(20);
  });
});
