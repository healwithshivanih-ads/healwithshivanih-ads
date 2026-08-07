import { describe, expect, it } from "vitest";

import { hasStepFigures, stepFigureSvgs } from "./exercise-step-figures";
import { tracedFigureSvg } from "./exercise-figure-traced";

describe("per-step figures", () => {
  it("gives the warm-up one figure per written step", () => {
    // The fault this exists to fix: eight named movements sharing one picture.
    const svgs = stepFigureSvgs("joint-mobilising-sequence", 8);
    expect(svgs).not.toBeNull();
    expect(svgs!.length).toBe(8);
    expect(svgs!.every(Boolean)).toBe(true);
    // exactly one of the eight is a clip: the trunk turn, which is axial
    // rotation and the one thing a drawn figure has never managed
    const vids = svgs!.filter((v) => v?.video);
    expect(vids.length).toBe(1);
    expect(vids[0]!.video).toBe("/exercise-videos/standing-trunk-rotation.mp4");
  });

  it("refuses a step that names both a figure and a clip, or neither", () => {
    // An ambiguous spec must not silently resolve to whichever the code checks
    // first — that is how the mixed arrow slipped through.
    const specs = stepFigureSvgs("joint-mobilising-sequence", 8)!;
    for (const v of specs) {
      if (!v) continue;
      expect(Boolean(v.svg) !== Boolean(v.video)).toBe(true);
    }
  });

  it("is absent for ordinary one-movement exercises", () => {
    // Most entries are one movement; a figure beside every line would add
    // nothing, and the caller falls back to the single figure above the steps.
    expect(hasStepFigures("bodyweight-squat")).toBe(false);
    expect(stepFigureSvgs("bodyweight-squat", 4)).toBeNull();
  });

  it("SCOPES EVERY INSTANCE, so figures on one page cannot fight", () => {
    // CSS inside an inline SVG applies to the WHOLE DOCUMENT, not to that SVG.
    // With eight of these on a page, one figure's `.tf0{animation:...}` drove
    // every other figure's `.tf0` to opacity 0 and seven of the eight rendered
    // as arrows floating over nothing. Slug-unique keyframe NAMES were not
    // enough — the selectors collided, and five steps borrow the same figure.
    const drawn = stepFigureSvgs("joint-mobilising-sequence", 8)!
      .map((v) => v?.svg)
      .filter((s): s is string => Boolean(s));
    const scopes = drawn.map((s) => s.match(/class="fm-traced-figure (ff[a-zA-Z0-9]+)"/)?.[1]);
    expect(scopes.every(Boolean)).toBe(true);
    expect(new Set(scopes).size).toBe(scopes.length);

    // and no rule may target the shared class, or the scoping is decorative
    for (const s of drawn) {
      const css = s.match(/<style>([\s\S]*?)<\/style>/)![1];
      expect(css).not.toMatch(/\.fm-traced-figure\s+\./);
    }
  });

  it("borrows a single pose without dragging in the movement it came from", () => {
    // Five steps borrow a plain standing body. Cross-fading into that figure's
    // second pose would show a star jump during "circle each wrist".
    const one = tracedFigureSvg("jumping-jacks", { frame: 0, uid: "t1" })!;
    const both = tracedFigureSvg("jumping-jacks", { uid: "t2" })!;
    expect((one.match(/<g class="tf\d+"/g) ?? []).length).toBe(1);
    expect((both.match(/<g class="tf\d+"/g) ?? []).length).toBe(2);
  });

  it("draws a circling arrow as an arc command, not a straight line", () => {
    // A circle is a path, not a pose — this is the whole reason loop arrows
    // exist, so it must actually emit an arc.
    const svg = tracedFigureSvg("jumping-jacks", {
      frame: 0,
      uid: "t3",
      arrows: [{ cx: 500, cy: 500, r: 60 }],
    })!;
    const d = svg.match(/class="tfarr"[^d]*d="([^"]+)"/)![1];
    expect(d).toMatch(/A[\d.]+,[\d.]+ 0 1 1/);
  });

  it("rejects a half-specified arrow rather than drawing a wrong one", () => {
    const svg = tracedFigureSvg("jumping-jacks", {
      frame: 0,
      uid: "t4",
      // a centre with no radius is neither an arc nor a loop
      arrows: [{ cx: 500, cy: 500 }, { x1: 1, y1: 2, cx: 3, cy: 4, r: 5 }],
    })!;
    expect(svg).not.toContain("tfarr");
  });

  it("keeps every step figure self-contained", () => {
    for (const v of stepFigureSvgs("joint-mobilising-sequence", 8)!) {
      if (!v?.svg) continue;
      expect(v.svg.startsWith("<svg")).toBe(true);
      expect(v.svg).not.toMatch(/url\(\s*['"]?(?!#)/);
      expect(v.svg).not.toMatch(/href|<image|src=/);
    }
  });
});
