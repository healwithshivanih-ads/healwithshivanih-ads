/**
 * The practice-log `kind` allowlist exists in THREE places, and all three must
 * agree or sessions are lost with no signal anywhere.
 *
 * This is not hypothetical. `kind: "somatic"` was once registered in the client
 * but not in the API route, so every somatic session ever finished was POSTed,
 * rejected with a 400, and swallowed by the `.catch(() => {})` that exists so a
 * client mid-practice never sees a network error. The only visible symptom was
 * the drip gate reading zero for months — which looks exactly like clients not
 * practising.
 *
 * The three layers, and what each failure looks like:
 *   1. `practice-log.ts`        — the client union. Miss it: a type error, the
 *                                 only one of the three that is loud.
 *   2. `app-practice/route.ts`  — miss it: 400, swallowed, silent.
 *   3. `save-app-practice.py`   — miss it: the shim fails, the route 500s,
 *                                 swallowed, silent.
 *
 * So this test reads the actual source of all three and asserts they match. It
 * is deliberately a text-scrape rather than an import: the Python tuple cannot
 * be imported, and the whole point is to catch the day someone edits two of
 * three.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** The union on PracticeLogInput.kind. */
function clientKinds(): string[] {
  const src = read("src/app/[token]/practice-log.ts".replace("[token]", "app/[token]"));
  const m = src.match(/kind:\s*((?:"[a-z]+"\s*\|\s*)*"[a-z]+")\s*;/);
  if (!m) throw new Error("could not find the kind union in practice-log.ts");
  return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort();
}

/** The KINDS const in the API route. */
function routeKinds(): string[] {
  const src = read("src/app/api/app-practice/route.ts");
  const m = src.match(/const KINDS\s*=\s*\[([^\]]+)\]/);
  if (!m) throw new Error("could not find KINDS in app-practice/route.ts");
  return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort();
}

/** The tuple in the Python shim. */
function shimKinds(): string[] {
  const src = read("scripts/save-app-practice.py");
  const m = src.match(/if kind not in \(([^)]+)\)/);
  if (!m) throw new Error("could not find the kind tuple in save-app-practice.py");
  return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort();
}

describe("practice-log kind allowlist", () => {
  it("finds all three allowlists — the scrapes still match the source", () => {
    expect(clientKinds().length).toBeGreaterThan(0);
    expect(routeKinds().length).toBeGreaterThan(0);
    expect(shimKinds().length).toBeGreaterThan(0);
  });

  it("client, API route and Python shim accept exactly the same kinds", () => {
    const client = clientKinds();
    const route = routeKinds();
    const shim = shimKinds();
    // Named comparisons so a failure says WHICH pair drifted.
    expect({ where: "route", kinds: route }).toEqual({ where: "route", kinds: client });
    expect({ where: "shim", kinds: shim }).toEqual({ where: "shim", kinds: client });
  });

  it("still carries the kinds that already have live data", () => {
    // A rename or a tidy-up that drops one of these silently stops logging for
    // a whole practice type, and every historical row keyed to it stops being
    // counted by practiceDaysInWindow, which matches on the exact string.
    for (const k of ["breath", "eft", "sleep", "somatic"]) {
      expect(clientKinds()).toContain(k);
    }
  });

  it("accepts the exercise kind on all three layers", () => {
    for (const kinds of [clientKinds(), routeKinds(), shimKinds()]) {
      expect(kinds).toContain("exercise");
    }
  });
});
