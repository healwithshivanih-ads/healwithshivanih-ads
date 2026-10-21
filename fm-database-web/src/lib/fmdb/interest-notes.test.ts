import { describe, expect, it } from "vitest";
import type { ContentItem } from "./content-library";
import { checkNoteEmail, noteDecision, renderNoteEmail, type NoteDecisionInput } from "./interest-notes";

const item: ContentItem = {
  id: "yt-belly-after-40",
  kind: "video",
  title: "Belly Fat After 40",
  url: "https://youtu.be/AvTIYcitW10",
  concerns: ["weight"],
  liveFrom: "2026-10-18",
  until: null,
  stage: "first",
  line: "Why belly fat changes after 40, and what helps more than eating less.",
};

const base: NoteDecisionInput = {
  todayYmd: "2026-10-21",
  engagementStatus: "pending",
  hasPlan: false,
  hasEmail: true,
  optedOut: false,
  followupStopped: false,
  followupRunning: false,
  lastContentEmailOn: null,
  notePending: false,
  lastInboundOn: null,
  lastActivityOn: "2026-09-01",
  item,
};

describe("noteDecision", () => {
  it("drafts for a quiet prospect when something new matches", () => {
    const d = noteDecision(base);
    expect(d.draft).toBe(true);
  });

  it.each([
    ["signed up", { engagementStatus: "signed_up" }],
    ["declined", { engagementStatus: "declined" }],
    ["lapsed", { engagementStatus: "lapsed" }],
    ["opted out", { optedOut: true }],
    ["stopped by the coach", { followupStopped: true }],
    ["no email", { hasEmail: false }],
    ["call follow-up still running", { followupRunning: true }],
    ["a note already pending", { notePending: true }],
    ["emailed 10 days ago", { lastContentEmailOn: "2026-10-11" }],
    ["messaged 3 days ago", { lastInboundOn: "2026-10-18" }],
    ["quiet over a year", { lastActivityOn: "2025-09-01" }],
    ["nothing new", { item: null }],
    ["has a plan", { hasPlan: true }],
  ] as const)("does not draft when %s", (_label, over) => {
    expect(noteDecision({ ...base, ...over }).draft).toBe(false);
  });

  it("drafts again once 30 days have passed since the last content email", () => {
    expect(noteDecision({ ...base, lastContentEmailOn: "2026-09-21" }).draft).toBe(true);
  });

  it("treats a missing engagement_status as not enrolled", () => {
    expect(noteDecision({ ...base, engagementStatus: null }).draft).toBe(true);
  });
});

describe("renderNoteEmail + checkNoteEmail", () => {
  it("the rendered note passes its own gate", () => {
    const e = renderNoteEmail("Asha", item);
    expect(e.body).toContain(item.url);
    expect(e.body.startsWith("Hi Asha,")).toBe(true);
    expect(checkNoteEmail(e.subject, e.body)).toEqual({ ok: true, refuse: [] });
  });

  it("refuses a price, a credit, a free call, or a missing opt-out", () => {
    const e = renderNoteEmail("Asha", item);
    expect(checkNoteEmail(e.subject, `${e.body}\nThe Foundation session is ₹12,000.`).ok).toBe(false);
    expect(checkNoteEmail(e.subject, `${e.body}\nYour credit is waiting.`).ok).toBe(false);
    expect(checkNoteEmail(e.subject, `${e.body}\nBook a free call.`).ok).toBe(false);
    expect(checkNoteEmail(e.subject, e.body.replace(/If you'd rather[\s\S]*$/, "")).ok).toBe(false);
  });
});
