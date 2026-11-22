#!/usr/bin/env node
/**
 * Prepare the Calm Gut audio for the app — $0, runs on the Mac.
 *
 *   node scripts/course-audio-prepare.mjs --src <draft folder> --out <dir>
 *        [--upload-s3 <bucket> --profile <aws profile>] [--only s1,flare]
 *
 * 1. Transcode each draft (48 kHz / ~164 kbps AAC) to 96 kbps stereo AAC,
 *    44.1 kHz, with the moov atom at the front (+faststart) so playback starts
 *    before the whole file has downloaded. ~40% smaller, which matters for
 *    "Save for offline" on a phone.
 * 2. Name it by the app's key: <out>/calm-gut/<rev>/<track>-<music|voice>.m4a
 *    (rev from src/lib/fmdb/courses.ts — bump it there when a file is replaced).
 * 3. Optionally upload to a PRIVATE bucket. Never the public marketing bucket:
 *    this script refuses any bucket name containing "public".
 *
 * Local mode (no S3): copy <out> to the server's COURSE_AUDIO_DIR instead.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]?.startsWith("--") ? true : arr[i + 1] ?? true]] : acc), []),
);
const SRC = args.src || path.join(process.env.HOME, "Downloads/ochre-reels/meditation-voice/gut-hypnotherapy");
const OUT = args.out;
if (!OUT) {
  console.error("--out <dir> is required");
  process.exit(2);
}

// Source files (final drafts, 22 Nov 2026 — calm-gut-build notes) → app keys.
// rev must match courses.ts.
const TRACKS = [
  { id: "s1", rev: "d1", dir: "01-calm-belly", music: "Calm belly - session 1 (YOUR voice, with music, draft 1).m4a", voice: "Calm belly - session 1 (YOUR voice, draft 1).m4a" },
  { id: "s2", rev: "d1", dir: "02-volume-dial", music: "Turning down the volume - session 2 (with music, draft 1).m4a", voice: "Turning down the volume - session 2 (voice only, draft 1).m4a" },
  { id: "s3", rev: "d1", dir: "03-the-river", music: "The river - session 3 (with music, draft 1).m4a", voice: "The river - session 3 (voice only, draft 1).m4a" },
  { id: "s4", rev: "d1", dir: "04-soft-and-spacious", music: "Soft and spacious - session 4 (with music, draft 1).m4a", voice: "Soft and spacious - session 4 (voice only, draft 1).m4a" },
  { id: "s5", rev: "d1", dir: "05-stress-shield", music: "The stress shield - session 5 (with music, draft 1).m4a", voice: "The stress shield - session 5 (voice only, draft 1).m4a" },
  { id: "s6", rev: "d1", dir: "06-eating-with-ease", music: "Eating with ease - session 6 (with music, draft 1).m4a", voice: "Eating with ease - session 6 (voice only, draft 1).m4a" },
  { id: "s7", rev: "d1", dir: "07-cool-calm-chest", music: "Cool calm chest - session 7 (with music, draft 1).m4a", voice: "Cool calm chest - session 7 (voice only, draft 1).m4a" },
  { id: "s8", rev: "d1", dir: "08-going-forward", music: "Your calm gut going forward - session 8 (with music, draft 1).m4a", voice: "Your calm gut going forward - session 8 (voice only, draft 1).m4a" },
  { id: "daily", rev: "d1", dir: "00-daily-practice", music: "Daily practice (draft 1, with music).m4a", voice: "Daily practice (draft 1).m4a" },
  { id: "night", rev: "d1", dir: "00b-night-practice", music: "Night practice (with music, draft 1).m4a", voice: "Night practice (voice only, draft 1).m4a" },
  { id: "flare", rev: "d2", dir: "09-flare-up", music: "Flare-up (with music, draft 2).m4a", voice: "Flare-up (voice only, draft 2).m4a" },
];

const only = typeof args.only === "string" ? new Set(args.only.split(",")) : null;
const bucket = typeof args["upload-s3"] === "string" ? args["upload-s3"] : null;
if (bucket && /public/i.test(bucket)) {
  console.error(`Refusing to upload paid audio to "${bucket}": it looks like a public bucket.`);
  process.exit(2);
}

let n = 0;
for (const t of TRACKS) {
  if (only && !only.has(t.id)) continue;
  for (const v of ["music", "voice"]) {
    const src = path.join(SRC, t.dir, t[v]);
    if (!fs.existsSync(src)) {
      console.error(`missing: ${src}`);
      process.exitCode = 1;
      continue;
    }
    const key = `calm-gut/${t.rev}/${t.id}-${v}.m4a`;
    const dest = path.join(OUT, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vn", "-map_metadata", "-1", "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", dest]);
    const mb = (fs.statSync(dest).size / 1e6).toFixed(1);
    console.log(`${key}  ${mb} MB`);
    if (bucket) {
      const prof = typeof args.profile === "string" ? ["--profile", args.profile] : [];
      execFileSync("aws", ["s3", "cp", dest, `s3://${bucket}/${key}`, "--content-type", "audio/mp4", "--cache-control", "private, max-age=3600", "--sse", "AES256", ...prof], { stdio: "inherit" });
    }
    n++;
  }
}
console.log(`${n} files ready in ${OUT}${bucket ? ` and uploaded to s3://${bucket}` : ""}`);
