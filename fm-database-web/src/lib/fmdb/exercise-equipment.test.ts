/**
 * Equipment must survive the trip from catalogue to client.
 *
 * It did not, and it reached a real client: three Otago leg exercises need ankle
 * cuff weights, and the app told him to "strap the ankle cuff weight around one
 * ankle" as step two of a session already in progress. Nobody had asked whether
 * he owned any.
 *
 * The suitability screen was never going to catch it — it screens what a body
 * can take, not what is in the house — so the requirement has to be carried and
 * shown, at BOTH the moment of choosing and before the client starts.
 */

import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { deriveExerciseSessions, loadExercise } from "./exercise-session";

const CAT = path.resolve(__dirname, "../../../../fm-database/data/exercises");

function slugsNeedingKit(): string[] {
  return fs
    .readdirSync(CAT)
    .filter((f) => f.endsWith(".yaml"))
    .filter((f) => {
      const d = yaml.load(fs.readFileSync(path.join(CAT, f), "utf8")) as Record<string, unknown>;
      return Array.isArray(d.equipment) && d.equipment.length > 0;
    })
    .map((f) => f.replace(/\.yaml$/, ""));
}

describe("exercise equipment", () => {
  it("the catalogue really does record kit for some entries", () => {
    // If this ever hits zero the rest of the suite passes vacuously.
    expect(slugsNeedingKit().length).toBeGreaterThan(0);
  });

  it("carries per-exercise equipment through to the app item", () => {
    const slug = slugsNeedingKit()[0];
    const sessions = deriveExerciseSessions(
      [{ id: "p0", name: "Movement session", when: "" }],
      [{ name: "Movement session", exercises: [{ exercise: slug }] }],
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].items[0].equipment.length).toBeGreaterThan(0);
  });

  it("rolls the whole session's kit up onto the session, deduped", () => {
    const needing = slugsNeedingKit();
    const sessions = deriveExerciseSessions(
      [{ id: "p0", name: "Movement session", when: "" }],
      [{ name: "Movement session", exercises: needing.map((s) => ({ exercise: s })) }],
    );
    const rolled = sessions[0].equipment;
    expect(rolled.length).toBeGreaterThan(0);
    expect(new Set(rolled).size).toBe(rolled.length); // deduped
    // Every item's kit appears in the session roll-up — nothing is dropped.
    for (const it of sessions[0].items) {
      for (const e of it.equipment) expect(rolled).toContain(e);
    }
  });

  it("reports no kit for an equipment-free session rather than undefined", () => {
    const free = fs
      .readdirSync(CAT)
      .map((f) => f.replace(/\.yaml$/, ""))
      .find((s) => {
        const d = loadExercise(s);
        return d && (!Array.isArray(d.equipment) || (d.equipment as unknown[]).length === 0);
      });
    expect(free).toBeTruthy();
    const sessions = deriveExerciseSessions(
      [{ id: "p0", name: "Movement session", when: "" }],
      [{ name: "Movement session", exercises: [{ exercise: free }] }],
    );
    expect(sessions[0].equipment).toEqual([]);
  });

  it("ankle cuff weights are still declared on the entries that need them", () => {
    // The specific case that reached a client. If someone strips these fields
    // the session silently becomes 'no kit required' again.
    for (const slug of ["seated-knee-extension", "standing-knee-flexion"]) {
      const d = loadExercise(slug);
      expect(String(JSON.stringify(d?.equipment ?? []))).toMatch(/cuff/i);
    }
  });
});
