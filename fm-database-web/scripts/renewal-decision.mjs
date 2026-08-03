#!/usr/bin/env node
/**
 * Record what happened to a plan that was ending, so the queue stops asking.
 *
 * A queue that keeps showing someone who has already said no trains you to
 * skim it — and the person you then miss is the one who would have said yes.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const [slug, decision, ...noteParts] = process.argv.slice(2);
const VALID = ["renewed", "not_renewing", "deferred"];
if (!slug || !VALID.includes(decision)) {
  console.error(`usage: renewal-decision.mjs <plan-slug> <${VALID.join("|")}> [note]`);
  process.exit(2);
}
const file = path.join(process.env.FMDB_PLANS_DIR || path.join(process.env.HOME, "fm-plans"),
                       "_renewal_decisions.yaml");
let all = {};
try { all = yaml.load(fs.readFileSync(file, "utf8")) || {}; } catch { /* first write */ }
all[slug] = { decision, at: new Date().toISOString(), ...(noteParts.length ? { note: noteParts.join(" ") } : {}) };
fs.writeFileSync(`${file}.tmp`, yaml.dump(all, { sortKeys: true }), { mode: 0o600 });
fs.renameSync(`${file}.tmp`, file);
console.log(`recorded: ${slug} → ${decision}`);
