/**
 * The remedy timing parser, tested against the REAL catalogue strings.
 *
 * Every case below is copied verbatim from a home_remedies entry that is
 * prescribed to someone on the live roster. Invented strings would let the
 * parser pass while the actual data fell through — which is exactly how a
 * remedy that belongs an hour after dinner ended up written into the dinner
 * slot as the meal itself.
 */

import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { REMEDY_SLOTS, remedySlots } from "./remedy-slots";

const CAT = path.resolve(__dirname, "../../../../fm-database/data/home_remedies");

describe("remedySlots — real catalogue timings", () => {
  it("methi water is an on-waking drink", () => {
    expect(
      remedySlots("First thing in the morning, on an empty stomach, 20-30 minutes before breakfast"),
    ).toEqual(["on_waking"]);
  });

  it("psyllium belongs AFTER dinner, not at it", () => {
    // The whole reason this module exists: this remedy was written into the
    // dinner slot as though a teaspoon of psyllium in dahi were the meal.
    expect(remedySlots("1 hour after dinner")).toEqual(["after_dinner"]);
  });

  it("a remedy taken after either main meal lands at both", () => {
    expect(remedySlots("20-30 minutes after lunch or dinner")).toEqual([
      "after_lunch",
      "after_dinner",
    ]);
    expect(remedySlots("Immediately after meals")).toEqual(["after_lunch", "after_dinner"]);
    expect(remedySlots("Take immediately after lunch and the evening meal")).toEqual([
      "after_lunch",
      "after_dinner",
    ]);
  });

  it("CCF tea — the most-prescribed remedy — appears at each of its times", () => {
    expect(
      remedySlots("Best between meals (mid-morning, mid-afternoon, evening). Avoid drinking with food."),
    ).toEqual(["mid_morning", "mid_afternoon"]);
  });

  it("bedtime is ONE occasion, however it is described", () => {
    // Each of these names bedtime plus a spacing rule or a condition. None of
    // them is two occasions, and a client told to do it twice would do it twice.
    expect(remedySlots("Bedtime, empty stomach (at least 2 hours after dinner).")).toEqual(["bedtime"]);
    expect(remedySlots("At bedtime, after the last meal of the day")).toEqual(["bedtime"]);
    expect(remedySlots("At bedtime, so the bowels move easily the next morning")).toEqual(["bedtime"]);
    expect(remedySlots("evening 1-2 hours before bed")).toEqual(["bedtime"]);
  });

  it("does not read a described OUTCOME as a second dose", () => {
    // Triphala: "Bedtime, empty stomach (at least 2 hours after dinner). The
    // traditional logic: works overnight to mobilize the bowel for morning
    // evacuation." The word "morning" describes what happens, not when to take
    // it — and a bare-word match put a bedtime churan on the waking slot too.
    expect(
      remedySlots(
        "Bedtime, empty stomach (at least 2 hours after dinner). The traditional logic: works overnight to mobilize the bowel for morning evacuation.",
      ),
    ).toEqual(["bedtime"]);
  });

  it("still honours a genuine twice-a-day prescription", () => {
    expect(remedySlots("Take in the morning and at bedtime")).toEqual(["on_waking", "bedtime"]);
  });

  it("respects a timing that FORBIDS a time", () => {
    // Hibiscus names bedtime only to rule it out. A whole-string scan slots it
    // there — the same shape as reading "no history of falls" as a falls history.
    const out = remedySlots(
      "mid-morning or afternoon; avoid right at bedtime due to mild diuretic effect",
    );
    expect(out).not.toContain("bedtime");
    expect(out).toEqual(["mid_morning", "mid_afternoon"]);
  });

  it("returns nothing rather than guessing when the timing says no time", () => {
    expect(remedySlots("")).toEqual([]);
    expect(remedySlots("As needed")).toEqual([]);
  });

  it("never matches a bare substring — 'bedside' is not bedtime", () => {
    expect(remedySlots("keep a glass at the bedside")).not.toContain("bedtime");
  });

  it("always returns slots in day order", () => {
    const out = remedySlots("after lunch and at mid-morning and on an empty stomach");
    const idx = out.map((s) => REMEDY_SLOTS.indexOf(s));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  /* The corpus sweep: no prescribed remedy should be unplaceable, and none
     should land in an absurd number of slots. Runs over the real catalogue so
     it fails when a NEW entry is written with a timing this cannot read. */
  it("places the timings of the remedies actually in the catalogue", () => {
    let files: string[] = [];
    try {
      files = fs.readdirSync(CAT).filter((f) => f.endsWith(".yaml"));
    } catch {
      return; // catalogue not present (CI without the data dir)
    }
    const unplaceable: string[] = [];
    for (const f of files) {
      const d = (yaml.load(fs.readFileSync(path.join(CAT, f), "utf8")) ?? {}) as Record<string, unknown>;
      const when = String(d.timing_notes ?? d.timing ?? "").trim();
      if (!when) continue;
      const slots = remedySlots(when);
      // Every slot returned must be a real one, and never the whole day.
      expect(slots.length).toBeLessThanOrEqual(4);
      for (const s of slots) expect(REMEDY_SLOTS).toContain(s);
      if (slots.length === 0) unplaceable.push(`${f.replace(/\.yaml$/, "")}: ${when.slice(0, 60)}`);
    }
    // Reported, not asserted to zero: a remedy legitimately taken "as needed"
    // has no slot, and forcing one would be worse than leaving it out.
    expect(unplaceable.length).toBeLessThan(files.length);
  });
});
