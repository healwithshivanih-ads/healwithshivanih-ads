/**
 * Tests for stripCoachDirective — the guard against the coach's stage
 * directions ("…and it should be said to her that way") reaching the client
 * they are about. Caught live on cl-022's magnesium supplement card.
 */
import { describe, it, expect } from "vitest";
import { stripCoachDirective } from "./client-app-coach-directive";

describe("stripCoachDirective", () => {
  it("removes the real leak from cl-022's magnesium card, keeping the useful half", () => {
    const raw =
      "REPLACES her Wellbeing triple magnesium complex — this is a swap, not a " +
      "removal, and it should be said to her that way.";
    const out = stripCoachDirective(raw);
    expect(out).not.toMatch(/should be said/i);
    // the part the client actually needs must survive
    expect(out).toContain("this is a swap, not a removal");
    expect(out).toContain("Wellbeing triple magnesium complex");
    expect(out.endsWith(".")).toBe(true);
  });

  it("drops a standalone directive sentence but keeps its neighbours", () => {
    const raw =
      "Glycinate covers the same need. Tell her this is not a punishment. " +
      "Take it 60 minutes before bed.";
    const out = stripCoachDirective(raw);
    expect(out).toBe("Glycinate covers the same need. Take it 60 minutes before bed.");
  });

  it("catches the emotional-state instructions a coach writes about the reader", () => {
    for (const s of [
      "She must not feel she is losing that.",
      "He should not think this is a downgrade.",
      "Make sure she understands the swap.",
    ]) {
      expect(stripCoachDirective(s), s).toBe("");
    }
  });

  it("catches the saying verbs aimed at the client", () => {
    for (const s of [
      "This should be framed as an upgrade.",
      "Present it to her as a straight swap.",
      "Do not mention the cost.",
      "Remind the client to reorder early.",
    ]) {
      expect(stripCoachDirective(s), s).toBe("");
    }
  });

  it("NEVER touches ordinary client-facing instructions", () => {
    for (const s of [
      "Take it 60 minutes before bed with a little food.",
      "This replaces your triple magnesium — same job, gentler on your gut.",
      "Tell your doctor you are taking creatine before your next renal panel.",
      "Say the mantra twice, then rest for a minute.",
      "If your stools loosen, drop to one capsule.",
    ]) {
      expect(stripCoachDirective(s), s).toBe(s);
    }
  });

  it("returns empty when every clause is a directive, rather than half a sentence", () => {
    expect(stripCoachDirective("Tell her gently, and make sure she feels heard.")).toBe("");
  });

  it("handles empty and undefined safely", () => {
    expect(stripCoachDirective("")).toBe("");
    expect(stripCoachDirective(undefined as unknown as string)).toBe("");
  });
});
