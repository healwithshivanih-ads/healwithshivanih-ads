import { describe, expect, it } from "vitest";
import {
  activeConcerns,
  dismissConcern,
  lastInterestAt,
  mergeInterests,
  parseInterests,
  signalsFromText,
  type InterestSignal,
} from "./interests";

const sig = (concern: InterestSignal["concern"], source: string, at: string, detail?: string): InterestSignal => ({
  concern,
  source,
  at,
  ...(detail ? { detail } : {}),
});

describe("parseInterests", () => {
  it("accepts Date and string dates (Python dumps unquoted dates)", () => {
    const got = parseInterests([
      { concern: "gut", source: "booking_form", at: new Date("2026-10-01T00:00:00Z") },
      { concern: "thyroid", source: "coach", at: "2026-10-02" },
    ]);
    expect(got.map((s) => s.at)).toEqual(["2026-10-01", "2026-10-02"]);
  });
  it("drops unknown concerns and undated entries instead of throwing", () => {
    expect(parseInterests([{ concern: "astrology", at: "2026-10-01" }, { concern: "gut" }, "x", null])).toEqual([]);
    expect(parseInterests(undefined)).toEqual([]);
  });
});

describe("mergeInterests", () => {
  it("does not add the same signal twice", () => {
    const a = [sig("gut", "booking_form", "2026-10-01", "Bloating")];
    const { merged, added } = mergeInterests(a, [sig("gut", "booking_form", "2026-10-05", "bloating")]);
    expect(merged).toHaveLength(1);
    expect(added).toHaveLength(0);
  });
  it("adds the same concern from a different source", () => {
    const { merged } = mergeInterests([sig("gut", "booking_form", "2026-10-01")], [sig("gut", "discovery_call", "2026-10-03")]);
    expect(merged).toHaveLength(2);
  });
  it("never re-adds a dismissed concern from an automatic source", () => {
    const dismissed = dismissConcern([sig("gut", "booking_form", "2026-10-01")], "gut");
    const { added } = mergeInterests(dismissed, [sig("gut", "discovery_call", "2026-10-09")]);
    expect(added).toHaveLength(0);
    expect(activeConcerns(dismissed)).toEqual([]);
  });
  it("lets the coach bring a dismissed concern back", () => {
    const dismissed = dismissConcern([sig("gut", "booking_form", "2026-10-01")], "gut");
    const { merged } = mergeInterests(dismissed, [sig("gut", "coach", "2026-10-09")]);
    expect(activeConcerns(merged)).toEqual(["gut"]);
  });
});

describe("activeConcerns / lastInterestAt", () => {
  it("orders by most recent signal", () => {
    const s = [sig("gut", "a", "2026-09-01"), sig("thyroid", "a", "2026-10-01"), sig("gut", "b", "2026-08-01")];
    expect(activeConcerns(s)).toEqual(["thyroid", "gut"]);
    expect(lastInterestAt(s)).toBe("2026-10-01");
  });
});

describe("signalsFromText", () => {
  it("makes one signal per concern with the words kept as detail", () => {
    const s = signalsFromText("Hashimoto's and tiredness", "booking_form", "2026-10-21", "Hashimoto's and tiredness");
    expect(s.map((x) => x.concern)).toEqual(["thyroid", "autoimmune", "energy"]);
    expect(s[0].detail).toBe("Hashimoto's and tiredness");
  });
});
