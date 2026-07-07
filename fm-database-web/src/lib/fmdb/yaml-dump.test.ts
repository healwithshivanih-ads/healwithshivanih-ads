import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { dumpYaml } from "./yaml-dump";

describe("dumpYaml — PyYAML-safe numeric-underscore quoting", () => {
  it("quotes underscore chip strings so PyYAML (YAML 1.1) reads them as strings", () => {
    const out = dumpYaml({ time_to_fall_asleep: "30_60" });
    expect(out).toContain("time_to_fall_asleep: '30_60'");
    // plain js-yaml would emit it bare, which PyYAML mis-reads as int 3060
    expect(yaml.dump({ time_to_fall_asleep: "30_60" })).toContain(
      "time_to_fall_asleep: 30_60",
    );
  });

  it("quotes underscore chips inside lists and nested maps", () => {
    const out = dumpYaml({ chips: ["15_30", "60_90"], nested: { deep: "10_20" } });
    expect(out).toContain("- '15_30'");
    expect(out).toContain("- '60_90'");
    expect(out).toContain("deep: '10_20'");
  });

  it("leaves real numbers as unquoted numbers", () => {
    const out = dumpYaml({ age: 53, weight_kg: 62.5, count: 1000000 });
    expect(out).toContain("age: 53");
    expect(out).toContain("weight_kg: 62.5");
    expect(out).toContain("count: 1000000");
  });

  it("does not touch safe non-numeric underscore strings", () => {
    const out = dumpYaml({ chip: "over_60", mode: "next_phase" });
    expect(out).toContain("chip: over_60");
    expect(out).toContain("mode: next_phase");
  });

  it("preserves multiline block scalars and never rewrites their content", () => {
    const notes = "Client sleep: 30_60 pattern.\nSecond line 10_20 here.";
    const out = dumpYaml({ notes_for_coach: notes });
    // stays a readable block scalar, not an escaped single line
    expect(out).toContain("notes_for_coach: |-");
    // the 30_60 INSIDE the note must not be quoted/altered
    expect(out).toContain("Client sleep: 30_60 pattern.");
    expect(out).not.toContain("'30_60'");
    // and it round-trips back to exactly the original string
    const back = yaml.load(out) as { notes_for_coach: string };
    expect(back.notes_for_coach).toBe(notes);
  });

  it("round-trips underscore chips as strings through a reload", () => {
    const back = yaml.load(dumpYaml({ x: "30_60", y: "1_5" })) as {
      x: unknown;
      y: unknown;
    };
    expect(back.x).toBe("30_60");
    expect(back.y).toBe("1_5");
  });
});
