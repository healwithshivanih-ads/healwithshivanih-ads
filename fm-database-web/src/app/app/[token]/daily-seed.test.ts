/**
 * Today's seed — the properties that make it safe to ship, pinned:
 * same (client, day) → same seed on every device; different days rotate;
 * personal mind-body material only ever comes from the already-gated reads
 * the server chose to send; no reads → always evergreen.
 */
import { describe, it, expect } from "vitest";
import { dailySeed } from "./daily-seed";
import type { AppMindBodyRead } from "@/lib/fmdb/somatic";

const READ = {
  title: "T",
  roots: [],
  reframe: "A kinder way to hold it.",
  question: "What are you holding?",
  practice: null,
  prescribed: false,
} as unknown as AppMindBodyRead;

describe("dailySeed", () => {
  it("is deterministic per (client, day)", () => {
    const a = dailySeed("cl-001", "2026-08-05", [READ]);
    const b = dailySeed("cl-001", "2026-08-05", [READ]);
    expect(a).toEqual(b);
  });

  it("rotates across days", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 9; d++) seen.add(dailySeed("cl-001", `2026-08-0${d}`, []).text);
    expect(seen.size).toBeGreaterThan(3);
  });

  it("differs between clients on the same day (usually)", () => {
    const texts = new Set(["cl-001", "cl-002", "cl-003", "cl-004"].map((c) => dailySeed(c, "2026-08-05", []).text));
    expect(texts.size).toBeGreaterThan(1);
  });

  it("with no reads, every day is evergreen and non-empty", () => {
    for (let d = 10; d <= 28; d++) {
      const s = dailySeed("cl-x", `2026-08-${d}`, []);
      expect(s.kind).toBe("line");
      expect(s.text.length).toBeGreaterThan(10);
    }
  });

  it("personal material appears some days and only from the given reads", () => {
    let personal = 0;
    for (let d = 10; d <= 28; d++) {
      const s = dailySeed("cl-x", `2026-08-${d}`, [READ]);
      if (s.text === READ.question || s.text === READ.reframe) personal++;
    }
    expect(personal).toBeGreaterThan(0); // surfaces sometimes
    expect(personal).toBeLessThan(19); // never wallpaper
  });
});
