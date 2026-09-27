/**
 * Handouts attached to a plan must reach the client app's Resources list —
 * and a bad or missing slug must never become a dead card or a path escape.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadPlanHandouts, parseHandoutMeta } from "./plan-handouts";

const REAL_DIR = path.join(__dirname, "..", "..", "..", "public", "handouts");

describe("parseHandoutMeta", () => {
  it("strips the brand suffix and decodes entities", () => {
    const m = parseHandoutMeta(
      '<title>Alcohol &amp; You — Shivani Hari</title><meta name="description" content="A &quot;short&quot; guide">',
    );
    expect(m).toEqual({ title: "Alcohol & You", desc: 'A "short" guide' });
  });
});

describe("loadPlanHandouts", () => {
  it("loads the alcohol handout from the real public/handouts page", async () => {
    const out = await loadPlanHandouts(["alcohol-beyond-sugar"], REAL_DIR);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("/handouts/alcohol-beyond-sugar.html");
    expect(out[0].title).toMatch(/Zero Sugar/);
    expect(out[0].desc).not.toBe("");
  });

  it("skips missing pages, duplicates and anything that is not a plain slug", async () => {
    const out = await loadPlanHandouts(
      ["no-such-handout", "../../package", "steady-blood-sugar", "steady-blood-sugar", 42],
      REAL_DIR,
    );
    expect(out.map((h) => h.slug)).toEqual(["steady-blood-sugar"]);
  });

  it("returns nothing when the plan has no list", async () => {
    expect(await loadPlanHandouts(undefined, REAL_DIR)).toEqual([]);
  });
});
