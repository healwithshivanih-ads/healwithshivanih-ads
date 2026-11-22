#!/usr/bin/env node
/**
 * Calm Gut week photos → app images, with ONE treatment for the whole set.
 * $0, runs on the Mac (ffmpeg + sips).
 *
 *   node scripts/course-images-prepare.mjs --src <folder of her photos> [--demo]
 *
 * In <folder>, name each image by its track: s1 … s8, daily, night, flare
 * (any of .jpg .jpeg .png .heic). The week intros use their session's photo,
 * the short daily practice uses the daily one.
 *
 * Writes public/ochre-app/calm-gut/<id>.jpg (1080×810, the card and player
 * picture) and <id>-sq.jpg (512×512, the lock-screen picture). With --demo
 * the files are named demo-<id>… instead: shown only when the server runs
 * with COURSE_IMAGES_DEMO=1, and git-ignored, so stand-ins never ship.
 *
 * The photos are made in ChatGPT in her Chrome (Shivani 22 Nov 2026), one
 * art direction for all: quiet documentary photo, soft daylight, muted earthy
 * colour, no people, hands or text. The treatment is a light touch (her pick,
 * 22 Nov 2026, over a heavier fade that greyed them out): colour eased back
 * about a quarter, a little warmth, softer contrast and a fine grain, so the
 * eleven read as one set and never as glossy AI images.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]?.startsWith("--") ? true : arr[i + 1] ?? true]] : acc), []),
);
const SRC = typeof args.src === "string" ? args.src : "";
if (!SRC) {
  console.error("--src <folder> is required");
  process.exit(2);
}
const DEMO = args.demo === true;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "ochre-app", "calm-gut");
const IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "daily", "night", "flare"];
const LOOK = "hue=s=0.72,colorbalance=rs=0.02:bs=-0.03:rm=0.01:bm=-0.02,eq=contrast=0.97:gamma=1.02,noise=alls=7:allf=t";

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-img-"));
let n = 0;
for (const id of IDS) {
  const found = fs.readdirSync(SRC).find((f) => path.parse(f).name.toLowerCase() === id && /\.(jpe?g|png|heic)$/i.test(f));
  if (!found) continue;
  let input = path.join(SRC, found);
  if (/\.heic$/i.test(found)) {
    const jpg = path.join(tmp, `${id}.jpg`);
    execFileSync("sips", ["-s", "format", "jpeg", input, "--out", jpg], { stdio: "ignore" });
    input = jpg;
  }
  const base = `${DEMO ? "demo-" : ""}${id}`;
  const wide = path.join(OUT, `${base}.jpg`);
  const sq = path.join(OUT, `${base}-sq.jpg`);
  const ff = (vf, out) =>
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", vf, "-q:v", "5", out]);
  ff(`scale=1080:810:force_original_aspect_ratio=increase,crop=1080:810,${LOOK}`, wide);
  ff(`scale=512:512:force_original_aspect_ratio=increase,crop=512:512,${LOOK}`, sq);
  console.log(`${base}.jpg ${(fs.statSync(wide).size / 1024).toFixed(0)} KB · ${base}-sq.jpg ${(fs.statSync(sq).size / 1024).toFixed(0)} KB`);
  n++;
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${n} of ${IDS.length} photos prepared in ${OUT}${n < IDS.length ? ` (missing: ${IDS.filter((id) => !fs.readdirSync(SRC).some((f) => path.parse(f).name.toLowerCase() === id)).join(", ")})` : ""}`);
