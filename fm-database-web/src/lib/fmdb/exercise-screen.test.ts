/**
 * The TS suitability screen must agree with the Python one, exactly.
 *
 * The coach UI could shell out; the client app cannot, so `exercise-screen.ts`
 * duplicates `fmdb/plan/exercise_screen.py`. Two copies of a safety matcher
 * drift, and the drift is invisible — the coach sees an exercise blocked on her
 * screen and the client is offered it on theirs.
 *
 * So this pins the TS against output captured from the REAL Python running over
 * the REAL catalogue. `__fixtures__/exercise-screen-python.json` is regenerated
 * by hand (`fm-database$ .venv/bin/python scripts/dump_exercise_screen_fixture.py`)
 * when the matcher legitimately changes; if the two ever disagree, one of them
 * is wrong and this fails.
 *
 * The fixture's client records are shaped from the real roster's design cases
 * but carry no identifying detail — a real record is PHI and does not belong
 * in the repo.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/exercise-screen-python.json";
import { foldPainRegions, screenAll, summarise } from "./exercise-screen";

const EXERCISE_DIR = path.resolve(process.cwd(), "../fm-database/data/exercises");

function loadExercises(): Record<string, unknown>[] {
  return readdirSync(EXERCISE_DIR)
    .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))
    .sort()
    .map((f) => yaml.load(readFileSync(path.join(EXERCISE_DIR, f), "utf8")) as Record<string, unknown>);
}

const exercises = loadExercises();
const cases = fixture.cases as Record<string, Array<Record<string, unknown>>>;
const clients = fixture.clients as Record<string, Record<string, unknown>>;

describe("parity with the Python screen", () => {
  it("reads the same catalogue the fixture was captured from", () => {
    expect(exercises.length).toBe(fixture.exercise_count);
  });

  for (const name of Object.keys(cases)) {
    it(`agrees on every verdict for the '${name}' record`, () => {
      const got = screenAll(exercises, clients[name]);
      const expected = cases[name];

      // Order matters: the panel shows blocked first, and a different order is
      // a different screen.
      expect(got.map((v) => v.slug)).toEqual(expected.map((v) => v.slug));
      expect(got.map((v) => v.verdict)).toEqual(expected.map((v) => v.verdict));
      expect(got.map((v) => v.start_level)).toEqual(expected.map((v) => v.start_level));
      expect(got.map((v) => v.start_reason)).toEqual(expected.map((v) => v.start_reason));
    });

    it(`agrees on every note for the '${name}' record`, () => {
      const got = screenAll(exercises, clients[name]);
      const expected = cases[name];
      // The notes ARE the coach-facing output — a matching verdict with
      // different reasons behind it is still a disagreement.
      expect(got.map((v) => v.notes)).toEqual(expected.map((v) => v.notes));
    });
  }
});

describe("the safety properties hold in TS too", () => {
  it("blocks a PEM record out of every progressive entry", () => {
    const got = screenAll(exercises, clients.pem);
    const progressive = exercises.filter(
      (e) => Array.isArray(e.levels) && (e.levels as unknown[]).length > 1,
    );
    const slugs = new Set(progressive.map((e) => e.slug as string));
    const offered = got.filter((v) => slugs.has(v.slug) && v.verdict !== "blocked");
    expect(offered.map((v) => v.slug)).toEqual([]);
  });

  it("leaves a PEM record something to actually do", () => {
    const got = screenAll(exercises, clients.pem);
    const left = got.filter((v) => v.verdict !== "blocked").map((v) => v.slug);
    expect(left).toContain("energy-envelope-pacing");
    expect(left.length).toBeGreaterThanOrEqual(3);
  });

  // Mirrors test_bone_client_keeps_the_loading_work in tests/test_exercise_screen.py —
  // keep the two in step. This was a blanket "blocks nothing", which held only while
  // every entry on disk came from the Otago falls manual and none bent the loaded
  // spine. Entries that do now exist, and the block tier exists precisely for them
  // (see ExerciseCautionSeverity). The claim is narrower and truer: a bone-loss record
  // may lose the spine-bending movements, and must keep everything that loads bone.
  it("blocks a bone-loss record only from spine-bending work, never from loading", () => {
    const got = screenAll(exercises, clients.bone);
    const blocked = got.filter((v) => v.verdict === "blocked").map((v) => v.slug);
    const flexes = new Set(
      exercises.filter((e) => e.spinal_flexion).map((e) => String(e.slug)),
    );
    expect(blocked.filter((s) => !flexes.has(s))).toEqual([]);

    const loading = exercises
      .filter((e) => (e.modality === "strength" || e.modality === "balance") && !e.spinal_flexion)
      .map((e) => String(e.slug));
    expect(loading.length).toBeGreaterThan(0);
    expect(loading.filter((s) => blocked.includes(s))).toEqual([]);
  });

  it("starts an 80-year-old supported on high-balance work", () => {
    const got = screenAll(exercises, clients.elder);
    const ols = got.find((v) => v.slug === "one-leg-stand");
    expect(ols?.verdict).not.toBe("clear");
    expect(ols?.start_reason).toBe("start supported");
  });

  it("never suggests a starting level for a blocked entry", () => {
    for (const v of screenAll(exercises, clients.pem)) {
      if (v.verdict === "blocked") expect(v.start_level).toBeNull();
    }
  });

  it("does not read a negated record as a positive finding", () => {
    const got = screenAll(exercises, clients.negated);
    expect(got.find((v) => v.slug === "one-leg-stand")?.verdict).toBe("clear");
  });

  it("survives an empty record without inventing findings", () => {
    const got = screenAll(exercises, {});
    expect(got.length).toBe(exercises.length);
    expect(got.every((v) => v.verdict === "clear" || v.verdict === "watch")).toBe(true);
  });

  it("summary totals cover the whole catalogue", () => {
    const counts = summarise(screenAll(exercises, clients.bone));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(exercises.length);
  });
});

describe("pain-region folding", () => {
  it("strips side and folds granularity the same way Python does", () => {
    const got = foldPainRegions([
      "knee_left", "knee_right", "scapula_left", "buttock_right",
      "achilles_left", "neck_back", "sacrum",
    ]);
    expect([...got].sort()).toEqual(
      ["ankle_foot", "hip", "knee", "neck", "sacrum_pelvis", "upper_back"],
    );
  });

  it("drops head regions rather than folding them onto a body region", () => {
    expect([...foldPainRegions(["head", "face", "jaw"])]).toEqual([]);
  });
});
