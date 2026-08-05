import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXERCISE_VIDEO_FILES, exerciseVideoSrc } from "./exercise-video";

/**
 * The list in exercise-video.ts is a hand-maintained map, chosen over a
 * directory scan so the client app does not hit the filesystem per exercise.
 * The cost of that choice is that it can drift from what is actually committed
 * — so the drift is what these tests check.
 */
describe("exercise videos", () => {
  it("every mapped file actually exists in public/", () => {
    for (const [slug, file] of Object.entries(EXERCISE_VIDEO_FILES)) {
      const p = path.resolve(process.cwd(), "public", "exercise-videos", file);
      expect(existsSync(p), `${slug} → ${file} is mapped but not on disk`).toBe(true);
    }
  });

  it("every mapped slug is a real catalogue exercise", () => {
    const dir = path.resolve(process.cwd(), "../fm-database/data/exercises");
    for (const slug of Object.keys(EXERCISE_VIDEO_FILES)) {
      expect(
        existsSync(path.join(dir, `${slug}.yaml`)),
        `${slug} has a video but no catalogue entry`,
      ).toBe(true);
    }
  });

  it("returns null for an exercise with no video, rather than a broken path", () => {
    expect(exerciseVideoSrc("chair-sit-to-stand")).toBeNull();
    expect(exerciseVideoSrc("")).toBeNull();
    expect(exerciseVideoSrc("../../etc/passwd")).toBeNull();
  });

  it("serves from the allowlisted public prefix", () => {
    // /exercise-videos/ is in middleware-policy's PUBLIC_PATH_PREFIXES; a path
    // built anywhere else 404s through the Fly intake-only gate.
    for (const slug of Object.keys(EXERCISE_VIDEO_FILES)) {
      expect(exerciseVideoSrc(slug)!.startsWith("/exercise-videos/")).toBe(true);
    }
  });
});
