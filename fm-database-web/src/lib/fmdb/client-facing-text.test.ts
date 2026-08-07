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
    // Verbatim from a published plan a real client could open. No jargon, no
    // source, no test — just one professional telling another it is worth the
    // slot. This is the case the first version of this guard sailed past.
    "Balance, holding a counter. Cheap to add and it protects the knee by making a stumble less likely.",
    "The single highest-value thing here for a stated goal of normalising blood pressure",
    "glutes and hamstrings while the knee is still the limiting factor",
    "Direct calf and Achilles tendon loading, which is the specific complaint",
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
  it("shows the authored client line", () => {
    expect(clientFacingSummary("Standing up from a chair, under control.", "…in the catalogue…"))
      .toBe("Standing up from a chair, under control.");
  });

  it("NEVER falls back to the coach summary, however clean it looks", () => {
    // This is the fix, and the earlier version got it wrong. Falling back when
    // the coach summary passed a denylist still leaked, because the denylist
    // cannot judge audience: "Cheap to add and it protects the knee" has no
    // jargon, no source and no test, and is plainly one professional talking to
    // another. Safety comes from reading the client FIELD, not from screening
    // the coach one.
    expect(clientFacingSummary("", "Lying on your back and lifting your hips.")).toBe("");
    expect(clientFacingSummary("", "the single most transferable movement in the catalogue")).toBe("");
    expect(clientFacingSummary(undefined, "anything at all")).toBe("");
  });
});

describe("the exercise catalogue itself", () => {
  it("EVERY entry carries a client line", () => {
    // Not just the leaky ones. Since there is no fallback, an entry without an
    // authored line shows a client no description at all — so this is what
    // keeps the cards from quietly emptying as the catalogue grows.
    let files: string[] = [];
    try {
      files = fs.readdirSync(CAT).filter((f) => f.endsWith(".yaml"));
    } catch {
      return; // no catalogue on this machine
    }
    expect(files.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const f of files) {
      const d = (yaml.load(fs.readFileSync(path.join(CAT, f), "utf8")) ?? {}) as Record<string, unknown>;
      if (!String(d.client_summary ?? "").trim()) missing.push(f.replace(/\.yaml$/, ""));
    }
    expect(missing).toEqual([]);
  });

  /**
   * The OTHER route to the same leak, and the one that actually reached a
   * client. `PrescribedExercise.note` is client-facing by design, but it gets
   * written during assessment where the surrounding voice is coach-to-coach —
   * and a real published plan ended up telling a client a balance drill was
   * "Cheap to add".
   *
   * This checks the notes on the plans on THIS machine. Unlike the summary
   * case, the fix is never to hide the note at render — a note carries real
   * instructions ("Hold the counter", "lower slowly"), and withholding those
   * would be worse than the leak. It has to be caught while it can be
   * rewritten, which is here.
   */
  it("no published plan tells a client why it was worth prescribing", () => {
    const PUB = path.join(process.env.HOME || "", "fm-plans", "published");
    let files: string[] = [];
    try {
      files = fs.readdirSync(PUB).filter((f) => f.endsWith(".yaml"));
    } catch {
      return; // no PHI on this machine (CI)
    }
    const offenders: string[] = [];
    for (const f of files) {
      let d: Record<string, unknown>;
      try {
        d = (yaml.load(fs.readFileSync(path.join(PUB, f), "utf8")) ?? {}) as Record<string, unknown>;
      } catch {
        continue; // a malformed plan is a different test's problem
      }
      for (const pr of (d.lifestyle_practices ?? []) as Record<string, unknown>[]) {
        for (const ex of (pr?.exercises ?? []) as Record<string, unknown>[]) {
          const note = String(ex?.note ?? "");
          if (note && looksCoachFacing(note)) {
            offenders.push(`${f} · ${String(ex?.exercise)}: ${note.slice(0, 60)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
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
