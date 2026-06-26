#!/usr/bin/env node
/**
 * npm run doctor — pre-flight check for the local dev/build environment.
 *
 * The single most common local failure on this machine is the EMFILE
 * "too many open files" Watchpack flood that makes `next dev` and `next build`
 * flaky or stuck (Codex audit 2026-06-26, finding #1). The root cause is a low
 * file-descriptor soft limit (macOS default ~256). This script surfaces that
 * (and a couple of other footguns) with the exact fix, BEFORE you waste time on
 * a hung build.
 *
 * Zero dependencies. Exit 1 if anything is a hard blocker, else 0.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webRoot, "..");

let failed = false;
const G = "\x1b[32m", Y = "\x1b[33m", R = "\x1b[31m", B = "\x1b[1m", X = "\x1b[0m";

function ok(msg) { console.log(`  ${G}✓${X} ${msg}`); }
function warn(msg, fix) { console.log(`  ${Y}!${X} ${msg}`); if (fix) console.log(`      ${Y}fix:${X} ${fix}`); }
function bad(msg, fix) { failed = true; console.log(`  ${R}✗${X} ${msg}`); if (fix) console.log(`      ${R}fix:${X} ${fix}`); }

console.log(`${B}fm-coach doctor${X}\n`);

// 1. File-descriptor soft limit — the EMFILE root cause.
console.log(`${B}File descriptors${X}`);
let fd = NaN;
try {
  fd = parseInt(execSync("ulimit -n", { shell: "/bin/bash", encoding: "utf8" }).trim(), 10);
} catch {
  /* ignore */
}
const plistInstalled = fs.existsSync("/Library/LaunchDaemons/limit.maxfiles.plist");
const plistSrc = path.join(repoRoot, "scripts", "limit.maxfiles.plist");
const installCmds =
  `sudo cp ${plistSrc} /Library/LaunchDaemons/ && ` +
  `sudo chown root:wheel /Library/LaunchDaemons/limit.maxfiles.plist && ` +
  `sudo launchctl load -w /Library/LaunchDaemons/limit.maxfiles.plist  (then open a fresh terminal)`;
if (!Number.isFinite(fd)) {
  warn("could not read `ulimit -n`", "run `ulimit -n` manually; aim for >= 8192");
} else if (fd < 4096) {
  bad(`ulimit -n is ${fd} — too low; this is what causes the EMFILE Watchpack flood`, installCmds);
} else if (fd < 8192) {
  warn(`ulimit -n is ${fd} — workable but tight under Mutagen + node + Chrome`, installCmds);
} else {
  ok(`ulimit -n is ${fd}`);
}
if (plistInstalled) ok("limit.maxfiles LaunchDaemon installed (survives reboot)");
else warn("limit.maxfiles LaunchDaemon not installed — a fresh login may reset the fd cap", installCmds);

// 2. Node version — Next 16 needs a modern Node.
console.log(`\n${B}Runtime${X}`);
const major = parseInt(process.versions.node.split(".")[0], 10);
if (major >= 20) ok(`Node ${process.versions.node}`);
else bad(`Node ${process.versions.node} — Next 16 needs Node >= 20`, "install Node 20+ (nvm install 20)");

// 3. Dependencies installed.
if (fs.existsSync(path.join(webRoot, "node_modules", ".bin", "next"))) ok("node_modules present");
else bad("node_modules missing", "run `npm install`");

// 4. Env file (informational — coach UI reads .env.local).
console.log(`\n${B}Config${X}`);
if (fs.existsSync(path.join(webRoot, ".env.local"))) ok(".env.local present");
else warn(".env.local missing", "copy .env.local.example and fill secrets (GMAIL_*, WHATSAPP_*, NEXT_PUBLIC_APP_URL)");

console.log("");
if (failed) {
  console.log(`${R}${B}doctor: blockers found — fix the ✗ items above before next dev / next build.${X}`);
  process.exit(1);
}
console.log(`${G}${B}doctor: environment looks healthy.${X}`);
