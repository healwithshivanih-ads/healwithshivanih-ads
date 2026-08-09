/**
 * Tests for buildSupplementEmail — the default notification channel since
 * 2026-08-09. Email-safe by construction; the coach's own words must survive
 * intact, and nothing may be injected into the HTML.
 */
import { describe, it, expect } from "vitest";
import { buildSupplementEmail } from "./supplement-email";

const base = {
  firstName: "Nazneen",
  mode: "activate" as const,
  whatChanged: "Creatine monohydrate — 1 level teaspoon daily.",
  why: "It supports the strength work you're already doing.",
  orderUrl: "https://intake.theochretree.com/supplements/tok123",
  appUrl: "https://intake.theochretree.com/app/apptok",
};

describe("buildSupplementEmail", () => {
  it("carries the coach's words through to both bodies", () => {
    const e = buildSupplementEmail(base);
    for (const body of [e.html, e.text]) {
      expect(body).toContain("Creatine monohydrate");
      expect(body).toContain("strength work");
      expect(body).toContain(base.orderUrl);
    }
  });

  it("titles itself by mode", () => {
    expect(buildSupplementEmail(base).subject).toBe("A new supplement starts this week");
    expect(buildSupplementEmail({ ...base, mode: "change" }).subject).toBe(
      "A small change to your supplements",
    );
  });

  it("escapes HTML in coach copy — an ampersand must not break the markup", () => {
    const e = buildSupplementEmail({ ...base, whatChanged: "Vitamin D & K2 <together>" });
    expect(e.html).toContain("Vitamin D &amp; K2 &lt;together&gt;");
    expect(e.html).not.toContain("<together>");
    // the plain-text part keeps the human characters
    expect(e.text).toContain("Vitamin D & K2 <together>");
  });

  it("keeps the coach's line breaks — she writes these as short lists", () => {
    const e = buildSupplementEmail({ ...base, whatChanged: "One\nTwo" });
    expect(e.html).toContain("One<br>Two");
  });

  it("is email-safe: no style block, no script, no external CSS", () => {
    const { html } = buildSupplementEmail(base);
    expect(html).not.toMatch(/<style|<script|stylesheet/i);
  });

  it("omits the app footer link when there is no app token", () => {
    const e = buildSupplementEmail({ ...base, appUrl: undefined });
    expect(e.html).not.toContain("Open your plan");
    expect(e.text).not.toContain("Open your plan");
  });
});
