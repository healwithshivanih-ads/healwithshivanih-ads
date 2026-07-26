#!/usr/bin/env node
/**
 * npm run parity — plan ⇆ client-payload parity sweep over every client with a
 * published plan.
 *
 * The five client-facing defects of 2026-07-26 were all silent: the data was
 * valid, the plan was right, and the phone still showed the wrong thing. This
 * runs src/lib/fmdb/plan-app-parity.ts against the REAL payload
 * loadClientAppData() builds for each client, so a divergence between what the
 * coach prescribed and what the client sees is caught here instead of by the
 * coach after the fact.
 *
 * READ-ONLY. It opens client PHI to build payloads and writes nothing, ever.
 * Defaults to the staging replica (~/fm-plans-staging, what the app serves);
 * point FMDB_PLANS_DIR elsewhere to sweep another root.
 *
 * client-app.ts imports the `server-only` marker and "@/…" aliases, so plain
 * node cannot load it. Vite's SSR loader (already a vitest dependency — no new
 * package) applies the same two aliases vitest.config.ts uses.
 *
 * Exit 1 when any error-severity finding exists, else 0.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { createServer } from "vite";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plansRoot = process.env.FMDB_PLANS_DIR
  ? path.resolve(process.env.FMDB_PLANS_DIR)
  : path.join(os.homedir(), "fm-plans-staging");
process.env.FMDB_PLANS_DIR = plansRoot;

const G = "\x1b[32m", Y = "\x1b[33m", R = "\x1b[31m", D = "\x1b[2m", B = "\x1b[1m", X = "\x1b[0m";
const SEV = { error: `${R}✗${X}`, warn: `${Y}!${X}`, info: `${D}·${X}` };

function readYaml(file) {
  try {
    return yaml.load(fs.readFileSync(file, "utf8")) ?? null;
  } catch {
    return null;
  }
}

/** url → every catalogue display_name published at that url. Lets the TARGET
 *  family assert on the RESOLVED product without re-running the matcher that
 *  chose it (that matcher is the thing under test). */
function buildProductIndex() {
  const doc = readYaml(path.join(plansRoot, "supplement_links.yaml"));
  const byUrl = new Map();
  if (doc && typeof doc === "object") {
    for (const [key, v] of Object.entries(doc)) {
      if (!v || typeof v !== "object" || !v.url) continue;
      const name = v.display_name || key;
      byUrl.set(v.url, [...(byUrl.get(v.url) ?? []), name]);
    }
  }
  return byUrl;
}

/** The published plan record the payload was built from. Matched on the slug
 *  the payload reports, highest version wins — the same record, read straight
 *  off disk by a different code path. */
function findPlanFile(slug, clientId) {
  const dir = path.join(plansRoot, "published");
  let best = null;
  let bestV = -1;
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!/\.ya?ml$/.test(name)) continue;
    const d = readYaml(path.join(dir, name));
    if (!d || d.slug !== slug || (clientId && d.client_id !== clientId)) continue;
    const v = Number(d.version) || 0;
    if (v >= bestV) {
      bestV = v;
      best = d;
    }
  }
  return best;
}

const server = await createServer({
  configFile: false,
  root: webRoot,
  logLevel: "error",
  server: { middlewareMode: true, watch: null },
  resolve: {
    alias: {
      "server-only": path.resolve(webRoot, "node_modules/server-only/empty.js"),
      "@": path.resolve(webRoot, "src"),
    },
  },
});

let exitCode = 0;
try {
  const { loadClientAppData } = await server.ssrLoadModule("/src/lib/fmdb/client-app.ts");
  const { checkPlanAppParity, countBySeverity, expectedSlotFor } = await server.ssrLoadModule(
    "/src/lib/fmdb/plan-app-parity.ts",
  );

  const productByUrl = buildProductIndex();
  // A url can be published under two names for the same bottle — hand back all
  // of them; the checker passes when ANY of them names the item.
  const productNameForUrl = (url) => productByUrl.get(url) ?? null;

  const clientsDir = path.join(plansRoot, "clients");
  const ids = fs.existsSync(clientsDir) ? fs.readdirSync(clientsDir).filter((n) => !n.startsWith(".")) : [];

  console.log(`${B}plan ⇆ app parity sweep${X}  ${D}${plansRoot}${X}\n`);

  const totals = { error: 0, warn: 0, info: 0 };
  const byCode = new Map();
  let swept = 0;
  let skipped = 0;
  // How much of the corpus PLACEMENT actually verifies. Reported so a green
  // sweep is never read as "every supplement is in the right group" — only the
  // timings the curated table recognises are checked at all.
  let timingsTotal = 0;
  let timingsClassified = 0;

  for (const id of ids.sort()) {
    const client = readYaml(path.join(clientsDir, id, "client.yaml"));
    const token = client?.app_token ? String(client.app_token) : "";
    if (!token) {
      skipped++;
      console.log(`${D}—${X} ${id.padEnd(12)} ${D}no app token${X}`);
      continue;
    }
    let app = null;
    try {
      app = await loadClientAppData(token);
    } catch (err) {
      exitCode = 1;
      console.log(`${SEV.error} ${id.padEnd(12)} payload build threw: ${err?.message ?? err}`);
      continue;
    }
    if (!app || !app.planSlug) {
      skipped++;
      console.log(`${D}—${X} ${id.padEnd(12)} ${D}${app ? `${app.tier} tier, no published plan` : "no payload"}${X}`);
      continue;
    }
    const plan = findPlanFile(app.planSlug, app.clientId);
    if (!plan) {
      skipped++;
      console.log(`${Y}!${X} ${id.padEnd(12)} ${Y}payload names plan "${app.planSlug}" but no published file matches${X}`);
      continue;
    }

    const kept = checkPlanAppParity(plan, app, { productNameForUrl });
    for (const p of Array.isArray(plan.supplement_protocol) ? plan.supplement_protocol : []) {
      timingsTotal++;
      if (expectedSlotFor(String(p?.timing ?? ""))) timingsClassified++;
    }

    swept++;
    const c = countBySeverity(kept);
    totals.error += c.error;
    totals.warn += c.warn;
    totals.info += c.info;
    for (const f of kept) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
    if (c.error) exitCode = 1;

    const head =
      c.error === 0 && c.warn === 0
        ? `${G}✓${X} ${id.padEnd(12)} ${G}parity${X}`
        : `${c.error ? SEV.error : SEV.warn} ${id.padEnd(12)} ${c.error} error · ${c.warn} warn`;
    console.log(
      `${head}  ${D}${app.planSlug} · wk ${app.client.week} · ${app.allSupplements.length} supp · ` +
        `${app.weekMenus.length} wk menu · ${app.practices.length} practice · ${app.remedies.length} remedy` +
        `${c.info ? ` · ${c.info} unclassified timing` : ""}${X}`,
    );
    for (const f of kept) {
      if (f.severity === "info" && !process.env.PARITY_VERBOSE) continue;
      console.log(`      ${SEV[f.severity]} ${B}[${f.family}/${f.code}]${X} ${f.detail}`);
      if (f.where) console.log(`        ${D}where:    ${f.where}${X}`);
      if (f.expected) console.log(`        ${D}expected: ${f.expected}${X}`);
      if (f.actual) console.log(`        ${D}actual:   ${f.actual}${X}`);
    }
  }

  const pct = timingsTotal ? Math.round((timingsClassified / timingsTotal) * 100) : 0;
  console.log(
    `\n${B}total${X} ${swept} client${swept === 1 ? "" : "s"} swept, ${skipped} skipped · ` +
      `${totals.error ? R : G}${totals.error} error${X} · ${totals.warn ? Y : D}${totals.warn} warn${X}`,
  );
  console.log(
    `${D}placement coverage: ${timingsClassified}/${timingsTotal} supplement timings (${pct}%) matched the curated table; ` +
      `the rest are unverified, not verified-good${X}`,
  );
  if (byCode.size) {
    console.log(`${D}by code:${X}`);
    for (const [code, n] of [...byCode.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n).padStart(4)}  ${code}`);
  }
  if (!process.env.PARITY_VERBOSE && totals.info)
    console.log(`${D}(PARITY_VERBOSE=1 to list unclassified timing phrases)${X}`);
} finally {
  await server.close();
}

process.exit(exitCode);
