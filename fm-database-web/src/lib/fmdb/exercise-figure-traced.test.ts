import { describe, expect, it } from "vitest";

import {
  _resetTracedFigureCache,
  hasTracedFigure,
  tracedFigureSvg,
} from "./exercise-figure-traced";

// These run against the real asset on disk — the point is to pin the artwork
// contract, not a fixture's idea of it. If the asset is absent the module must
// fail CLOSED, which the unknown-slug case still covers.

describe("tracedFigureSvg", () => {
  it("returns null for a slug with no traced artwork", () => {
    _resetTracedFigureCache();
    expect(tracedFigureSvg("no-such-exercise")).toBeNull();
    expect(hasTracedFigure("no-such-exercise")).toBe(false);
  });

  it("serves every Tier-2 rung as a two-pose cross-fade", () => {
    for (const slug of [
      "extended-kneeling-press-up",
      "chair-dip",
      "split-squat",
      "single-leg-floor-bridge",
      "side-lying-hip-abduction",
      "sit-to-stand-no-hands",
    ]) {
      const svg = tracedFigureSvg(slug);
      expect(svg, slug).toBeTruthy();
      // two pose groups, cross-faded
      expect(svg).toContain('class="tf0"');
      expect(svg).toContain('class="tf1"');
      // reduced motion resolves to the start pose
      expect(svg).toContain("prefers-reduced-motion");
    }
  });

  it("escapes the title it interpolates", () => {
    const svg = tracedFigureSvg("chair-dip", { title: '"<b>&' });
    expect(svg).toBeTruthy();
    expect(svg).not.toContain('aria-label=""<b>&"');
    expect(svg).toContain("&quot;&lt;b&gt;&amp;");
  });

  it("keyframe names derived from the slug are valid CSS identifiers", () => {
    const svg = tracedFigureSvg("sit-to-stand-no-hands")!;
    const names = [...svg.matchAll(/@keyframes\s+([^{\s]+)\{/g)].map((m) => m[1]);
    expect(names.length).toBe(2);
    for (const n of names) {
      expect(n).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
    }
  });

  it("every figure in the asset is renderable and self-contained", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { getCataloguePath } = await import("./paths");
    const file = path.join(getCataloguePath(), "_exercise_figures.json");
    const asset = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const slug of Object.keys(asset)) {
      const svg = tracedFigureSvg(slug);
      expect(svg, slug).toBeTruthy();
      expect(svg!.startsWith("<svg"), slug).toBe(true);
      // no external fetches of any kind (the xmlns namespace URI is inert)
      expect(svg, slug).not.toMatch(/url\(|href|<image|src=/);
    }
  });
});
