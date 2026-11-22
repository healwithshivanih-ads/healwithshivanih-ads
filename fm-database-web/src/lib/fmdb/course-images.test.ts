import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { courseImage, photoIdFor } from "./course-images";

describe("Calm Gut week photos", () => {
  it("intros use their session's photo; the short daily practice uses the daily one", () => {
    expect(photoIdFor("r3")).toBe("s3");
    expect(photoIdFor("daily-short")).toBe("daily");
    expect(photoIdFor("s5")).toBe("s5");
  });
  it("a photo shows only when its file exists; demo stand-ins only with COURSE_IMAGES_DEMO=1", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cg-img-"));
    expect(courseImage("s1", {}, dir)).toBeNull();
    writeFileSync(path.join(dir, "demo-s1.jpg"), "x");
    expect(courseImage("s1", {}, dir)).toBeNull();
    expect(courseImage("s1", { COURSE_IMAGES_DEMO: "1" }, dir)?.wide).toMatch(/^\/ochre-app\/calm-gut\/demo-s1\.jpg\?v=\d+$/);
    writeFileSync(path.join(dir, "s1.jpg"), "x");
    writeFileSync(path.join(dir, "s1-sq.jpg"), "x");
    const real = courseImage("r1", { COURSE_IMAGES_DEMO: "1" }, dir)!;
    expect(real.wide).toMatch(/^\/ochre-app\/calm-gut\/s1\.jpg/); // the real photo wins over the stand-in
    expect(real.square).toMatch(/s1-sq\.jpg/);
  });
});
