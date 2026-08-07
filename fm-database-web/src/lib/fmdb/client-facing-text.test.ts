/**
 * Catalogue prose must not reach a client.
 *
 * The case that prompted this: the sit-to-stand exercise card on a client's
 * phone read "Standing up and sitting down under control — the single most
 * transferable movement in the catalogue, and the one the 30-second chair stand
 * test measures." That is our own vocabulary and a clinical test, shown to the
 * person doing the exercise.
 *
 * `summary` is a COACH field on Exercise; `client_summary` is the client one.
 * These tests pin both the guard and the catalogue itself, so a NEW entry
 * written with a coach-facing summary and no client line is caught here rather
 * than in the app.
 */

import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { clientFacingSummary, looksCoachFacing } from "./client-facing-text";

const CAT = path.resolve(__dirname, "../../../../fm-database/data/exercises");

describe("looksCoachFacing", () => {
  it.each([
    "the single most transferable movement in the catalogue",
    "the one the 30-second chair stand test measures",
    "first of the Otago flexibility set",
    "the only Otago strengthening exercise performed sitting",
    "A protocol for staying within the activity level",
    "losing it is what converts weakness into dependence",
    "the entry in this catalogue that bends the loaded spine",
  ])("flags %s", (s) => {
    expect(looksCoachFacing(s)).toBe(true);
  });

  it.each([
    "Standing up and sitting down under control.",
    "Lying on your back and lifting your hips.",
    "A gentle way of moving the neck through its range.",
    "Small, springy hops from the ankles — quick work for the calves.",
  ])("passes %s", (s) => {
    expect(looksCoachFacing(s)).toBe(false);
  });
});

describe("clientFacingSummary", () => {
  it("prefers the authored client line", () => {
    expect(clientFacingSummary("Standing up from a chair, under control.", "…in the catalogue…"))
      .toBe("Standing up from a chair, under control.");
  });

  it("falls back to a CLEAN coach summary", () => {
    expect(clientFacingSummary("", "Lying on your back and lifting your hips.")).toBe(
      "Lying on your back and lifting your hips.",
    );
  });

  it("shows NOTHING rather than a leaky summary", () => {
    // The whole point. An unconditional fallback is what put the catalogue's
    // own vocabulary on a client's phone.
    expect(clientFacingSummary("", "the single most transferable movement in the catalogue")).toBe("");
  });

  it("withholds rather than strips — a stub reads worse than silence", () => {
    const out = clientFacingSummary("", "Standing up and sitting down — the 30-second test.");
    expect(out).toBe("");
  });
});

describe("the exercise catalogue itself", () => {
  it("every entry can show a client SOMETHING, or is deliberately silent", () => {
    let files: string[] = [];
    try {
      files = fs.readdirSync(CAT).filter((f) => f.endsWith(".yaml"));
    } catch {
      return; // no catalogue on this machine
    }
    // Any entry whose coach summary leaks MUST carry an authored client line,
    // otherwise its card silently loses its description.
    const needsAuthoring: string[] = [];
    for (const f of files) {
      const d = (yaml.load(fs.readFileSync(path.join(CAT, f), "utf8")) ?? {}) as Record<string, unknown>;
      const summary = String(d.summary ?? "");
      const client = String(d.client_summary ?? "");
      if (summary && looksCoachFacing(summary) && !client.trim()) {
        needsAuthoring.push(f.replace(/\.yaml$/, ""));
      }
    }
    expect(needsAuthoring).toEqual([]);
  });

  it("no authored client_summary is itself coach-facing", () => {
    let files: string[] = [];
    try {
      files = fs.readdirSync(CAT).filter((f) => f.endsWith(".yaml"));
    } catch {
      return;
    }
    const offenders: string[] = [];
    for (const f of files) {
      const d = (yaml.load(fs.readFileSync(path.join(CAT, f), "utf8")) ?? {}) as Record<string, unknown>;
      const client = String(d.client_summary ?? "").trim();
      if (client && looksCoachFacing(client)) offenders.push(f.replace(/\.yaml$/, ""));
    }
    expect(offenders).toEqual([]);
  });
});
