#!/usr/bin/env node
/**
 * Stage a renewal letter authored in chat as a `drafted` record, so it surfaces
 * on the dashboard for the coach to read and approve.
 *
 * This is the hand-off between the author-renewal skill (which writes the letter
 * in Shivani's voice and gates it) and the app: instead of sending in chat, the
 * skill stages the letter here. The coach then reads + approves it on the
 * dashboard, and the renewal-send cron mails it on the plan-end day.
 *
 * usage: stage-renewal-letter.mjs <plan-slug> <client-id> <draft-file> [offer-label]
 *
 * The draft file is the same text the gate (check-renewal-letter.mjs) passed:
 * a "Subject: ..." first line, then the body. Recipient name + email are read
 * from the client's own client.yaml, never passed in — the one place they are
 * authoritative.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const [planSlug, clientId, draftFile, offerLabel = ""] = process.argv.slice(2);
if (!planSlug || !clientId || !draftFile) {
  console.error("usage: stage-renewal-letter.mjs <plan-slug> <client-id> <draft-file> [offer-label]");
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{0,120}$/i.test(planSlug)) {
  console.error(`bad plan slug: ${planSlug}`);
  process.exit(2);
}

const plansRoot = process.env.FMDB_PLANS_DIR || path.join(process.env.HOME, "fm-plans");

// Recipient from the authoritative client record.
let clientName = clientId;
let to = "";
try {
  const doc = yaml.load(fs.readFileSync(path.join(plansRoot, "clients", clientId, "client.yaml"), "utf8")) || {};
  clientName = (doc.display_name || clientId).trim();
  to = String(doc.email || "").trim();
} catch (e) {
  console.error(`could not read client.yaml for ${clientId}: ${e.message}`);
  process.exit(1);
}
if (!to) {
  console.error(`no email on file for ${clientId} — cannot stage a letter with no recipient`);
  process.exit(1);
}

// Parse the gated draft: first "Subject:" line, then the body.
const raw = fs.readFileSync(draftFile, "utf8").replace(/\r/g, "");
const lines = raw.split("\n");
let subject = "";
if (/^subject:/i.test(lines[0] || "")) {
  subject = lines.shift().replace(/^subject:\s*/i, "").trim();
}
const body = lines.join("\n").trim();
if (!subject) { console.error("draft has no 'Subject:' first line"); process.exit(1); }
if (!body) { console.error("draft has no body"); process.exit(1); }

// Refuse to clobber a letter that already went out.
const dir = path.join(plansRoot, "_renewal_letters");
const file = path.join(dir, `${planSlug}.yaml`);
try {
  const existing = yaml.load(fs.readFileSync(file, "utf8"));
  if (existing && existing.status === "sent") {
    console.error("a letter for this plan has already been sent — record the decision instead");
    process.exit(1);
  }
} catch { /* no existing letter — fine */ }

const record = {
  plan_slug: planSlug,
  client_id: clientId,
  client_name: clientName,
  to,
  subject,
  body,
  offer_label: offerLabel,
  status: "drafted",
  scheduled_for: null,
  drafted_at: new Date().toISOString(),
  approved_at: null,
  sent_at: null,
};

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${file}.tmp`, yaml.dump(record, { lineWidth: 100, noRefs: true }), { mode: 0o600 });
fs.renameSync(`${file}.tmp`, file);
console.log(`staged: ${planSlug} → drafted (to ${to}) — read & approve on the dashboard`);
