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
      // No external fetches of any kind (the xmlns namespace URI is inert).
      // `url(#id)` IS allowed: a same-document fragment reference is how an SVG
      // marker is attached, and it fetches nothing. Only an off-document url()
      // is a leak, so match the scheme rather than banning the function.
      expect(svg, slug).not.toMatch(/url\(\s*['"]?(?!#)/);
      expect(svg, slug).not.toMatch(/href|<image|src=/);
    }
  });

  describe("motion arrows", () => {
    it("draws an arrow with a marker head only where the asset defines one", () => {
      const withArrow = tracedFigureSvg("side-hops")!;
      expect(withArrow).toContain('class="tfarr"');
      expect(withArrow).toContain('<marker id="tfahsidehops"');
      // and stays absent everywhere else, including the CSS rule for it
      expect(tracedFigureSvg("chair-dip")!).not.toContain("tfarr");
    });

    it("keeps the whole arc inside the viewBox", () => {
      // A curve that leaves the viewBox is not an error anywhere — it just
      // renders as a stub pointing off the edge, which reads as a broken figure.
      const svg = tracedFigureSvg("side-hops")!;
      const [vx, vy, vw, vh] = svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
      const pts = svg
        .match(/class="tfarr"[^d]*d="M([\d.-]+),([\d.-]+)Q([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)"/)!
        .slice(1)
        .map(Number);
      for (let i = 0; i < pts.length; i += 2) {
        expect(pts[i]).toBeGreaterThanOrEqual(vx);
        expect(pts[i]).toBeLessThanOrEqual(vx + vw);
        expect(pts[i + 1]).toBeGreaterThanOrEqual(vy);
        expect(pts[i + 1]).toBeLessThanOrEqual(vy + vh);
      }
    });

    it("animates the arrow on the same clock as the poses, and normalises its length", () => {
      const svg = tracedFigureSvg("side-hops")!;
      // pathLength=100 is what makes the draw-on exact without arc-length maths
      expect(svg).toContain('pathLength="100"');
      expect(svg).toMatch(/stroke-dasharray:100/);
      expect(svg).toMatch(/animation:tfarsidehops var\(--fm-fig-cyc,4s\)/);
      // opacity must be part of it: an SVG marker draws at its vertex whatever
      // the dash offset, so a dash-only hide leaves the arrowhead stranded
      expect(svg).toMatch(/@keyframes tfarsidehops\{0%,34%\{stroke-dashoffset:100;opacity:0\}/);
    });

    it("gives the return leg its own arrow on the other half of the cycle", () => {
      // Coach: "the jumping needs to be left to right and right to left". The
      // exercise is over the towel AND back, so one arrow tells half of it.
      const svg = tracedFigureSvg("side-hops")!;
      const paths = [...svg.matchAll(/<path class="(tfarr[^"]*)"[^d]*d="M([\d.-]+),[\d.-]+Q[^ ]+ ([\d.-]+),/g)];
      expect(paths.length).toBe(2);
      const out = paths.find((m) => m[1] === "tfarr")!;
      const back = paths.find((m) => m[1] === "tfarr tfarrb")!;
      // they must actually run opposite ways, not just sit in different classes
      expect(Number(out[3])).toBeGreaterThan(Number(out[2]));
      expect(Number(back[3])).toBeLessThan(Number(back[2]));
      // and animate on different keyframes, so they never draw at once
      expect(svg).toContain(".fm-traced-figure .tfarrb{animation-name:tfarbsidehops}");
      expect(svg).toMatch(/@keyframes tfarbsidehops\{0%\{stroke-dashoffset:0;opacity:1\}/);
    });

    it("holds the arrow fully drawn when motion is reduced", () => {
      const svg = tracedFigureSvg("side-hops")!;
      const reduced = svg.match(/@media \(prefers-reduced-motion:reduce\)\{([^@]*)\}/)![1];
      expect(reduced).toContain(".tfarr{animation:none!important;stroke-dashoffset:0;opacity:1}");
    });

    it("renders no angle-bracketed tag name inside the style element", () => {
      // SVG is XML: a literal tag name in a CSS comment is parsed as markup and
      // the entire image fails to render. This shipped once.
      for (const slug of ["side-hops", "split-jumps", "chair-dip"]) {
        const style = tracedFigureSvg(slug)!.match(/<style>([\s\S]*?)<\/style>/)![1];
        expect(style, slug).not.toMatch(/<[a-zA-Z/]/);
      }
    });
  });
});
