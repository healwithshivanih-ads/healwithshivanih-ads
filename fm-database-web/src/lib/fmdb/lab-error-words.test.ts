import { describe, expect, it } from "vitest";
import { labErrorWords } from "./lab-error-words";

const PLAIN = "That didn't go through. Check your connection and try again, or message your coach.";

describe("labErrorWords", () => {
  it("never shows a machine string to the client", () => {
    for (const raw of [
      "HTTP 500",
      "order is not payable",
      "order not found",
      "refused: price mismatch",
      "payments not configured",
      "lab catalogue unavailable",
      "could not start payment",
      "could not rebook",
      "couldn't load your receipt",
      "payment failed",
      "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
      "Failed to fetch",
      "bad id",
    ]) {
      expect(labErrorWords(raw)).toBe(PLAIN);
      expect(labErrorWords(new Error(raw))).toBe(PLAIN);
    }
  });

  it("keeps a sentence written for her, with a capital letter", () => {
    expect(labErrorWords("you already have an order ready to book")).toBe("You already have an order ready to book");
    expect(labErrorWords("that package isn't available to rebook right now — message your coach")).toBe(
      "That package isn't available to rebook right now — message your coach",
    );
    expect(labErrorWords("Please enter a 6-digit pincode")).toBe("Please enter a 6-digit pincode");
    expect(labErrorWords("enter a valid 6-digit pincode")).toBe("Enter a valid 6-digit pincode");
    expect(labErrorWords("the earliest home collection we can arrange is 2026-11-23 — we need about 36 hours' notice")).toBe(
      "The earliest home collection we can arrange is 2026-11-23 — we need about 36 hours' notice",
    );
  });

  it("says plainly when she has tried too often or payment is down", () => {
    expect(labErrorWords("too many attempts today")).toMatch(/^You have tried a few times today/);
    expect(labErrorWords(new Error("payment is unavailable right now"))).toMatch(/^Payment isn't working right now/);
  });

  it("falls back to the plain line when there is nothing to show", () => {
    expect(labErrorWords("")).toBe(PLAIN);
    expect(labErrorWords(undefined)).toBe(PLAIN);
    expect(labErrorWords({})).toBe(PLAIN);
  });
});
