#!/usr/bin/env node
/**
 * postbuild hook — keep the running pm2 server in sync with the build on disk.
 *
 * Next's production server loads its build manifest ONCE, at startup. Rebuild
 * `.next` underneath a running `next start` and the process keeps serving HTML
 * that references the previous build's hashed chunk names — so JS and CSS that
 * are sitting right there on disk come back 404, because the old manifest
 * doesn't list them. The page renders unstyled, and client components never
 * hydrate (2026-07-26: the coach plan tab lost a 95 KB stylesheet this way,
 * and the client-app preview panel silently stopped mounting).
 *
 * Restarting after a build is the whole fix. Chaining it here means it happens
 * every time instead of when someone remembers.
 *
 * No-ops rather than failing when there's nothing to restart — this also runs
 * inside the Fly Docker image build, where no pm2 daemon exists.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const APP = process.env.FMDB_PM2_APP ?? "fm-coach";
const here = dirname(fileURLToPath(import.meta.url));

function skip(why) {
  console.log(`[postbuild] pm2 restart skipped — ${why}`);
  process.exit(0);
}

if (process.env.FMDB_SKIP_PM2_RESTART === "1") skip("FMDB_SKIP_PM2_RESTART=1");
if (process.env.CI) skip("CI build");

// Probe the pid file rather than shelling out to `pm2 describe` first: asking
// pm2 anything STARTS a daemon, and we don't want to spawn one inside a Docker
// layer just to be told there's nothing to restart.
if (!existsSync(join(homedir(), ".pm2", "pm2.pid"))) skip("no pm2 daemon running");

const pm2 = join(here, "..", "node_modules", ".bin", "pm2");
if (!existsSync(pm2)) skip("pm2 not installed here");

try {
  execFileSync(pm2, ["describe", APP], { stdio: "ignore" });
} catch {
  skip(`no pm2 process named "${APP}"`);
}

try {
  execFileSync(pm2, ["restart", APP, "--update-env"], { stdio: "inherit" });
  console.log(`[postbuild] restarted ${APP} — now serving the build just produced`);
} catch (err) {
  // Never fail the build over this. A stale server is recoverable by hand;
  // a build that won't complete is worse.
  console.error(
    `[postbuild] WARNING: could not restart ${APP} — restart it by hand ` +
      `or the site will serve the previous build's asset names.\n${err}`,
  );
}
