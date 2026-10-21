import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  isLive,
  newlyLiveFor,
  parseContentLibrary,
  pickContent,
  unknownLinks,
  type ContentItem,
} from "./content-library";

const REAL_FILE = path.resolve(__dirname, "../../../../fm-database/data/_content_library.yaml");

describe("the real _content_library.yaml", () => {
  const raw = yaml.load(fs.readFileSync(REAL_FILE, "utf-8"));
  const { items, problems } = parseContentLibrary(raw);

  it("has no broken entries (an incomplete item would be silently dropped)", () => {
    expect(problems).toEqual([]);
    expect(items.length).toBeGreaterThan(10);
  });

  it("every line is client-safe", () => {
    for (const i of items) {
      expect(i.line, i.id).not.toMatch(/free call|free discovery|sequoya|evidence|\bthin\b|unproven/i);
      expect(i.line.length, i.id).toBeLessThan(140);
    }
  });

  it("covers the concerns prospects actually came in with", () => {
    const covered = new Set(items.flatMap((i) => i.concerns));
    for (const c of ["gut", "blood_sugar", "thyroid", "hormones", "energy", "nutrients", "liver", "weight"]) {
      expect(covered.has(c as never), c).toBe(true);
    }
  });
});

const item = (over: Partial<ContentItem> & Pick<ContentItem, "id">): ContentItem => ({
  kind: "video",
  title: over.id,
  url: `https://example.com/${over.id}`,
  concerns: ["gut"],
  liveFrom: "2026-10-01",
  until: null,
  stage: "first",
  line: "A line.",
  ...over,
});

describe("pickContent", () => {
  const lib = [
    item({ id: "gut-guide", kind: "guide" }),
    item({ id: "gut-video" }),
    item({ id: "gut-future", liveFrom: "2026-12-01" }),
    item({ id: "gut-deeper", stage: "deeper", liveFrom: "2026-10-15" }),
    item({ id: "thyroid-video", concerns: ["thyroid"] }),
  ];

  it("never picks an item before it goes live", () => {
    const got = pickContent(lib, { concerns: ["gut"], today: "2026-10-21", sentIds: ["gut-video", "gut-guide", "gut-deeper"], prefer: "first" });
    expect(got).toBeNull();
  });

  it("prefers a first-touch video over a guide for the first concern", () => {
    expect(pickContent(lib, { concerns: ["gut", "thyroid"], today: "2026-10-21", sentIds: [], prefer: "first" })?.id).toBe("gut-video");
  });

  it("never repeats something already sent", () => {
    expect(pickContent(lib, { concerns: ["gut"], today: "2026-10-21", sentIds: ["gut-video"], prefer: "first" })?.id).toBe("gut-guide");
  });

  it("moves to the next concern when the first is exhausted", () => {
    const sent = ["gut-video", "gut-guide", "gut-deeper"];
    expect(pickContent(lib, { concerns: ["gut", "thyroid"], today: "2026-10-21", sentIds: sent, prefer: "first" })?.id).toBe("thyroid-video");
  });

  it("is null with no concerns", () => {
    expect(pickContent(lib, { concerns: [], today: "2026-10-21", sentIds: [], prefer: "first" })).toBeNull();
  });

  it("retires a seasonal item after `until`", () => {
    const s = item({ id: "diwali", until: "2026-11-20" });
    expect(isLive(s, "2026-11-20")).toBe(true);
    expect(isLive(s, "2026-11-21")).toBe(false);
  });
});

describe("newlyLiveFor", () => {
  it("finds what went live recently for their concerns, unsent only", () => {
    const lib = [
      item({ id: "old", liveFrom: "2026-08-01" }),
      item({ id: "new", liveFrom: "2026-10-18" }),
      item({ id: "other", liveFrom: "2026-10-18", concerns: ["joints"] }),
      item({ id: "future", liveFrom: "2026-10-30" }),
    ];
    expect(newlyLiveFor(lib, ["gut"], "2026-10-21", 14, []).map((i) => i.id)).toEqual(["new"]);
    expect(newlyLiveFor(lib, ["gut"], "2026-10-21", 14, ["new"])).toEqual([]);
  });
});

describe("unknownLinks", () => {
  const lib = [item({ id: "a", url: "https://youtu.be/AAA" }), item({ id: "b", url: "https://youtu.be/BBB", liveFrom: "2027-01-01" })];
  it("passes library links and allowed prefixes", () => {
    const text = "Watch https://youtu.be/AAA. Your app: https://intake.theochretree.com/app/xyz";
    expect(unknownLinks(text, lib, "2026-10-21", ["https://intake.theochretree.com/app/"])).toEqual([]);
  });
  it("flags invented links and not-yet-live library links", () => {
    const text = "https://youtu.be/MADEUP and https://youtu.be/BBB";
    expect(unknownLinks(text, lib, "2026-10-21")).toEqual(["https://youtu.be/MADEUP", "https://youtu.be/BBB"]);
  });
});
