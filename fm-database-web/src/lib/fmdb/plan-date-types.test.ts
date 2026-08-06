/**
 * Plan date fields must survive BOTH YAML spellings.
 *
 * `meal_plan_started_on: '2026-08-05'` (quoted) parses as a string.
 * `meal_plan_started_on: 2026-08-05`   (bare)   parses as a JS Date, because
 * js-yaml resolves the YAML timestamp type — and PyYAML emits date objects bare,
 * so any Python-side write produces the second spelling.
 *
 * The old reader used `typeof v === "string"`, so the Date became "" and every
 * date gate downstream behaved as though the field were absent. A published,
 * started plan read `notStarted: true` and the client app showed "your plan is
 * getting ready … finalising your start date" indefinitely — no error, no log,
 * and a file that looks correct when you open it.
 *
 * Same family as the underscore-int trap: two YAML parsers, one file, different
 * types out.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

describe("plan date fields", () => {
  it("js-yaml really does type the two spellings differently", () => {
    // If this ever stops being true the guard below is pointless — assert the
    // premise rather than trusting it.
    const quoted = yaml.load("d: '2026-08-05'") as { d: unknown };
    const bare = yaml.load("d: 2026-08-05") as { d: unknown };
    expect(typeof quoted.d).toBe("string");
    expect(bare.d).toBeInstanceOf(Date);
  });

  it("no published plan stores a date field bare", () => {
    // The read side is now defensive (asDayStr), but a bare date still round-trips
    // badly through every OTHER reader of these files, so keep them quoted.
    const dir = path.join(os.homedir(), "fm-plans", "published");
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    } catch {
      return; // no plans dir on this machine (CI) — nothing to assert
    }
    const offenders: string[] = [];
    for (const f of files) {
      const d = (yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) ?? {}) as Record<string, unknown>;
      for (const k of [
        "meal_plan_started_on",
        "supplements_started_on",
        "plan_period_start",
        "plan_period_recheck_date",
      ]) {
        if (d[k] instanceof Date) offenders.push(`${f} → ${k}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
