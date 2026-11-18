/**
 * WHO SEES THE NEW FRONT.
 *
 * The new Sequoya shell carries a programme name that is under embargo until
 * 2 January 2027, and it only has screens for a client inside her programme.
 * So the rule must fail towards today's app in every case it was not built
 * for. These tests walk every combination rather than a few examples: a rule
 * that is right for the cases someone thought of and wrong for one nobody
 * listed is exactly how a real client would end up on a half-built screen.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppMode } from "./app-mode";
import type { AppTier } from "./discovery-tier";
import { isPlanSetupHold, parseAppShell, pickAppShell, type AppShellInput } from "./app-shell";

const MODES: AppMode[] = ["ACTIVE", "REVIEW", "MAINTENANCE", "GRACE", "LIBRARY"];
const TIERS: AppTier[] = ["package", "discovery", "enrolled", "guided"];
/** [label, client start state, is it the setup-hold screen?] */
const STARTS: [string, { notStarted: boolean; startsInDays: number }, boolean][] = [
  ["started", { notStarted: false, startsInDays: 0 }, false],
  ["starts in 5 days (preview)", { notStarted: true, startsInDays: 5 }, false],
  ["no start date yet (setup hold)", { notStarted: true, startsInDays: 0 }, true],
];
const SWITCHES: (string | null | undefined)[] = ["v2", undefined, null, "", "V2", "v1", "v3", "true", " v2"];

/** The one combination that gets the new front. */
const ON: AppShellInput = {
  appShell: "v2",
  tier: "package",
  mode: "ACTIVE",
  client: { notStarted: false, startsInDays: 0 },
};

describe("pickAppShell", () => {
  it("gives the new front to a switched-on client inside her programme", () => {
    expect(pickAppShell(ON)).toBe("sq");
  });

  it("gives the new front to a switched-on client whose plan has a committed start date", () => {
    expect(pickAppShell({ ...ON, client: { notStarted: true, startsInDays: 5 } })).toBe("sq");
  });

  it("walks every combination: new front ONLY for v2 + package + ACTIVE + not on setup hold", () => {
    let newFront = 0;
    let total = 0;
    for (const appShell of SWITCHES) {
      for (const tier of TIERS) {
        for (const mode of MODES) {
          for (const [label, client, hold] of STARTS) {
            total++;
            // Written out by hand, not derived from the implementation.
            const expected = appShell === "v2" && tier === "package" && mode === "ACTIVE" && !hold ? "sq" : "classic";
            const got = pickAppShell({ appShell, tier, mode, client });
            expect(got, `switch=${String(appShell)} tier=${tier} mode=${mode} start=${label}`).toBe(expected);
            if (got === "sq") newFront++;
          }
        }
      }
    }
    expect(total).toBe(SWITCHES.length * TIERS.length * MODES.length * STARTS.length);
    // v2 × package × ACTIVE × (started | preview) — two cells out of 540.
    expect(newFront).toBe(2);
  });

  it.each(MODES.filter((m) => m !== "ACTIVE"))("keeps today's app in %s even when switched on", (mode) => {
    expect(pickAppShell({ ...ON, mode })).toBe("classic");
  });

  it.each(TIERS.filter((t) => t !== "package"))("keeps today's app for the %s tier even when switched on", (tier) => {
    expect(pickAppShell({ ...ON, tier })).toBe("classic");
  });

  it("keeps today's plan-hold screen when no start date is set", () => {
    expect(pickAppShell({ ...ON, client: { notStarted: true, startsInDays: 0 } })).toBe("classic");
  });

  it("a client without the field gets today's app, whatever else is true", () => {
    for (const tier of TIERS) {
      for (const mode of MODES) {
        for (const [, client] of STARTS) {
          expect(pickAppShell({ tier, mode, client })).toBe("classic");
        }
      }
    }
  });
});

describe("parseAppShell", () => {
  it("turns on for the exact string v2 only", () => {
    expect(parseAppShell("v2")).toBe("v2");
  });
  it.each([undefined, null, "", "V2", " v2", "v2 ", "v1", "v3", "true", true, 2, {}, ["v2"]])(
    "reads %j as off",
    (raw) => {
      expect(parseAppShell(raw)).toBeNull();
    },
  );
});

describe("isPlanSetupHold", () => {
  it("is the hold screen only when the plan has not started and has no start date", () => {
    expect(isPlanSetupHold({ notStarted: true, startsInDays: 0 })).toBe(true);
    expect(isPlanSetupHold({ notStarted: true, startsInDays: 3 })).toBe(false);
    expect(isPlanSetupHold({ notStarted: false, startsInDays: 0 })).toBe(false);
  });
});

/**
 * Wiring pins. The rule above is only as good as the places that feed and
 * call it, and both are single lines that a later edit could quietly undo.
 */
describe("wiring", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("only the package build of the app payload carries the switch", () => {
    const src = read("src/lib/fmdb/client-app.ts");
    // Read from the client record through the one parser…
    expect(src).toMatch(/appShell: parseAppShell\(client\.app_shell\)/);
    // …exactly once: the discovery and guided builders never set it, so those
    // apps cannot be switched whatever their record says.
    expect(src.match(/appShell:/g)?.length).toBe(1);
    expect(src.match(/app_shell/g)?.length).toBe(2); // the loader line + the field's doc comment
  });

  it("the app chooses its front in exactly one place", () => {
    const dir = path.join(root, "src/app/app/[token]");
    const callers = fs
      .readdirSync(dir)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."))
      .filter((f) => /pickAppShell\(/.test(fs.readFileSync(path.join(dir, f), "utf8")));
    expect(callers).toEqual(["ochre-app.tsx"]);
    const app = read("src/app/app/[token]/ochre-app.tsx");
    expect(app.match(/pickAppShell\(/g)?.length).toBe(1);
    expect(app.match(/<SqApp\b/g)?.length).toBe(1);
  });

  it("the switch is projected to Fly, where the client app is served", () => {
    const src = read("scripts/app-staging-action.py");
    const start = src.indexOf("_APP_CLIENT_KEYS = (");
    const block = src.slice(start, src.indexOf("\n)\n", start));
    expect(block).toMatch(/^\s*"app_shell",/m);
  });
});
