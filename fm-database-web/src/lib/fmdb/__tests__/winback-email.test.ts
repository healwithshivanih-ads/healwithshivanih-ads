/**
 * The copy, and the gate that refuses it.
 *
 * The gate is check-renewal-letter.mjs's ruleset moved into the request path,
 * and every rule in it exists because it was got wrong on a real letter first.
 * The cases below are the ones that actually bite: an unfilled price
 * placeholder (which passes every other check, because it holds no digits to
 * source and no malformed number to reject), a weight nobody recorded, and a
 * price that disagrees with what the client will actually be charged.
 */
import { describe, it, expect } from "vitest";
import {
  renderWinbackEmail,
  maintenancePriceInr,
  formatInr,
  PRICE_PLACEHOLDER,
  type WinbackFacts,
} from "../winback-email";
import { checkWinbackEmail, briefingNumbers } from "../winback-gate";

const FACTS: WinbackFacts = {
  name: "Archana Rao",
  weeks: 12,
  msq: [
    { week: 0, total: 84 },
    { week: 12, total: 51 },
  ],
  goals: ["more steady energy through the afternoon"],
  conditions: ["hypothyroidism"],
};

const BRIEF = {
  name: "Archana Rao",
  plan: { weeks: 12 },
  msq: [{ week: 0, total: 84 }, { week: 12, total: 51 }],
  weights: [{ date: "2026-05-01", weight_kg: 68.4 }],
};

function gate(body: string, over: Partial<Parameters<typeof checkWinbackEmail>[0]> = {}) {
  return checkWinbackEmail({
    body,
    name: "Archana Rao",
    sourceNumbers: briefingNumbers(BRIEF),
    allowedPrices: [maintenancePriceInr() ?? 10000],
    weightValues: new Set(["68.4"]),
    ...over,
  });
}

describe("the copy", () => {
  it("touch 1 carries no price and no pitch", () => {
    const { subject, body } = renderWinbackEmail("check_in", FACTS, null);
    expect(body).not.toMatch(/₹|Rs\.?\s?\d/);
    expect(body).not.toContain(PRICE_PLACEHOLDER);
    expect(body).toContain("Archana");
    expect(subject).toContain("Archana");
  });

  it("opens with something true from their own data", () => {
    const { body } = renderWinbackEmail("check_in", FACTS, null);
    expect(body).toContain("84");
    expect(body).toContain("51");
  });

  it("names what has NOT moved rather than skipping past it", () => {
    // The rule that earns the rest of the letter. A score that went the wrong
    // way must be said plainly, not omitted.
    const worse: WinbackFacts = { ...FACTS, msq: [{ week: 0, total: 51 }, { week: 12, total: 84 }] };
    const { body } = renderWinbackEmail("offer", worse, 45000);
    expect(body).toMatch(/rather say that plainly|would rather know/i);
    expect(body).toContain("84");
  });

  it("touch 2 renders the placeholder until the coach supplies a price", () => {
    const { body } = renderWinbackEmail("offer", FACTS, null);
    expect(body).toContain(PRICE_PLACEHOLDER);
  });

  it("touch 2 uses the coach's price once given, and the real maintenance price", () => {
    const { body } = renderWinbackEmail("offer", FACTS, 45000);
    expect(body).not.toContain(PRICE_PLACEHOLDER);
    expect(body).toContain(formatInr(45000));
    // Sourced from MAINTENANCE_PRICING — the constant Razorpay actually bills,
    // so the letter and the payment page cannot disagree.
    const maint = maintenancePriceInr();
    expect(maint).toBe(10000);
    expect(body).toContain(formatInr(maint!));
  });

  it("touch 3 drops the programme and holds the door open", () => {
    const { body } = renderWinbackEmail("maintenance", FACTS, 45000);
    expect(body).not.toContain(formatInr(45000));
    expect(body).toMatch(/last you will hear/i);
    expect(body).toContain(formatInr(10000));
  });

  it("uses ₹ and never Rs", () => {
    const { body } = renderWinbackEmail("offer", FACTS, 45000);
    expect(body).not.toMatch(/\bRs\.?\s?\d/);
  });

  it("every touch asks for something", () => {
    for (const kind of ["check_in", "offer", "maintenance"] as const) {
      const { body } = renderWinbackEmail(kind, FACTS, 45000);
      expect(gate(body, { allowedPrices: [10000, 45000] }).refuse).toEqual([]);
    }
  });
});

describe("the gate", () => {
  it("refuses an unfilled price placeholder", () => {
    const { body } = renderWinbackEmail("offer", FACTS, null);
    const r = gate(body);
    expect(r.ok).toBe(false);
    expect(r.refuse.join(" ")).toMatch(/price has not been filled in/i);
  });

  it("refuses a figure that appears nowhere in the briefing", () => {
    const r = gate("Hi Archana,\n\nYour score improved by 73 points. Give me a call.\n\nShivani");
    expect(r.ok).toBe(false);
    expect(r.refuse.join(" ")).toMatch(/"73"/);
  });

  it("accepts a figure that does appear in the briefing", () => {
    const r = gate("Hi Archana,\n\nYour score went from 84 to 51. Give me a call.\n\nShivani");
    expect(r.ok).toBe(true);
  });

  it("refuses a weight nobody recorded, however small the number", () => {
    // A kg figure is the one number the client has been checking themselves,
    // so the small-number prose exemption must never reach it.
    const r = gate("Hi Archana,\n\nYou've lost 6 kg. Give me a call.\n\nShivani");
    expect(r.ok).toBe(false);
    expect(r.refuse.join(" ")).toMatch(/6 kg/);
  });

  it("accepts a weight that was actually recorded", () => {
    const r = gate("Hi Archana,\n\nYou were 68.4 kg at the start. Give me a call.\n\nShivani");
    expect(r.ok).toBe(true);
  });

  it("refuses a price the coach has not confirmed", () => {
    const r = gate("Hi Archana,\n\nA next phase is ₹52,000. Give me a call.\n\nShivani");
    expect(r.ok).toBe(false);
    expect(r.refuse.join(" ")).toMatch(/not one you have confirmed/i);
  });

  it("does not trip over the comma inside a formatted price", () => {
    // "₹85,000" once yielded a phantom "000" that matched nothing and refused a
    // perfectly good letter. A gate that cries wolf gets switched off.
    const r = gate("Hi Archana,\n\nA next phase is ₹45,000. Give me a call.\n\nShivani", {
      allowedPrices: [45000],
    });
    expect(r.refuse.filter((x) => x.includes("000"))).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("refuses naming the held-back supplement", () => {
    const r = gate(
      "Hi Archana,\n\nThere is one thing I held back — berberine. Give me a call.\n\nShivani",
    );
    expect(r.ok).toBe(false);
    expect(r.refuse.join(" ")).toMatch(/berberine/i);
  });

  it("refuses a letter that never asks for anything", () => {
    const r = gate("Hi Archana,\n\nYour programme is over.\n\nShivani");
    expect(r.ok).toBe(false);
    expect(r.refuse.join(" ")).toMatch(/no call to action/i);
  });

  it("refuses a letter that never names the recipient", () => {
    const r = gate("Hi there,\n\nGive me a call.\n\nShivani");
    expect(r.ok).toBe(false);
    expect(r.refuse.join(" ")).toMatch(/never addresses Archana/i);
  });

  it("refuses app-usage statistics — that reads as surveillance", () => {
    const r = gate("Hi Archana,\n\nYou opened it 23 of 28 days. Give me a call.\n\nShivani");
    expect(r.ok).toBe(false);
    expect(r.refuse.join(" ")).toMatch(/surveillance/i);
  });

  it("warns on the wrong register rather than blocking it", () => {
    const r = gate(
      "Hi Archana,\n\nI want to be straight with you. Give me a call.\n\nShivani",
    );
    expect(r.ok).toBe(true);
    expect(r.warn.join(" ")).toMatch(/confrontation/i);
  });

  it("refuses leftover template junk of any shape", () => {
    for (const junk of ["<<name>>", "{{price}}", "TBC", "TODO", "[insert price]"]) {
      const r = gate(`Hi Archana,\n\n${junk} — give me a call.\n\nShivani`);
      expect(r.ok, `${junk} was let through`).toBe(false);
    }
  });
});
