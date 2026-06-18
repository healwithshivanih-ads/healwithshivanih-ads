/* Server-side status for the coach's mind-body drip panel.
 *
 * The client app unlocks graduated relaxation techniques ONE AT A TIME as the
 * prior one becomes a habit: breathing (always on) → EFT tapping → sleep
 * wind-down. The gate + override logic lives in client-app.ts (buildClientAppData,
 * ~line 3056). This module re-derives the SAME status purely for display on the
 * coach Overview page, so the coach can see where the client actually is before
 * deciding whether to override the pace.
 *
 * Thresholds mirror client-app.ts exactly: breathing is a habit at ≥3 distinct
 * days in the trailing 7; each later technique opens once the prior one was used
 * ≥2 distinct days in the trailing 14. Per-technique coach override lives in
 * client.yaml#mindbody_<tech> = (absent=auto) | unlocked | locked.
 *
 * Note: client-app.ts puts a sleep-primary client's wind-down at slot #2. This
 * display always renders breathing → EFT → sleep; for the rare sleep-primary
 * client the "opens once X is a habit" wording may name a different prior. The
 * override controls write the correct per-technique field regardless of order,
 * so functionality is unaffected — only the explanatory sentence ordering.
 */

import fs from "fs/promises";
import path from "path";
import { getPlansRoot } from "./paths";

export type Override = "auto" | "unlocked" | "locked";

export type MbStepStatus =
  | "habit" //   breathing reached the habit threshold
  | "building" // breathing prescribed but not yet a habit
  | "open" //    technique visible to the client (auto gate satisfied)
  | "waiting" // technique hidden, waiting on the gate (auto)
  | "released" // technique force-shown by coach
  | "held"; //   technique force-hidden by coach

export type MbStep = {
  key: "breath" | "eft" | "sleep";
  n: number; // 1-based position in the journey
  label: string;
  alwaysOn: boolean; // breathing — no override control
  override?: Override; // eft / sleep only
  status: MbStepStatus;
  detail: string; // plain-language status sentence for the coach
};

/** Distinct days a client logged a practice kind in the trailing N days.
 *  Copy of client-app.ts:practiceDaysInWindow (kept local to avoid importing
 *  the heavy app-builder module into the coach page). */
async function practiceDays(clientDir: string, kind: string, days: number): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(clientDir, "_practice_log.jsonl"), "utf-8");
  } catch {
    return 0;
  }
  const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { kind?: string; date?: string };
      if (r.kind === kind && typeof r.date === "string" && r.date >= cutoff) seen.add(r.date);
    } catch {
      /* skip a malformed line */
    }
  }
  return seen.size;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function loadMindbodyDrip(
  clientId: string,
  opts: {
    breathPrescribed: boolean;
    eftPrescribed: boolean;
    sleepPrescribed: boolean;
    eftOverride: Override;
    sleepOverride: Override;
  },
): Promise<MbStep[]> {
  const clientDir = path.join(getPlansRoot(), "clients", clientId);
  const steps: MbStep[] = [];
  let n = 1;

  // ---- step 1: breathing (always available; the foundation gate) ----------
  const breathDays = opts.breathPrescribed ? await practiceDays(clientDir, "breath", 7) : 0;
  let priorSatisfied = opts.breathPrescribed ? breathDays >= 3 : true;
  let priorLabel = "breathing";
  let priorDone = breathDays;
  let priorNeeded = 3;

  if (opts.breathPrescribed) {
    const habit = breathDays >= 3;
    steps.push({
      key: "breath",
      n: n++,
      label: "Breathing",
      alwaysOn: true,
      status: habit ? "habit" : "building",
      detail: habit
        ? `Practiced ${plural(breathDays, "day")} this week — it's a habit ✓, so the next practice can open.`
        : `Practiced ${breathDays} of 3 days this week — 3 days in a week makes it a habit and opens the next practice.`,
    });
  }

  // ---- steps 2+: graduated techniques, in journey order -------------------
  const seq: { key: "eft" | "sleep"; label: string; override: Override; prescribed: boolean }[] = [
    { key: "eft", label: "EFT tapping", override: opts.eftOverride, prescribed: opts.eftPrescribed },
    { key: "sleep", label: "Sleep wind-down", override: opts.sleepOverride, prescribed: opts.sleepPrescribed },
  ];

  for (const tech of seq) {
    if (!tech.prescribed) continue;
    const ov = tech.override;
    const open = ov === "unlocked" ? true : ov === "locked" ? false : priorSatisfied;

    let status: MbStepStatus;
    let detail: string;

    if (ov === "unlocked") {
      status = "released";
      detail = "Released by you — visible in the client's app now, regardless of pace.";
    } else if (ov === "locked") {
      status = "held";
      detail = "Held by you — hidden from the client for now, even if they're ready.";
    } else if (open) {
      status = "open";
      const used = await practiceDays(clientDir, tech.key, 14);
      detail =
        used > 0
          ? `Open in the app. Practiced ${plural(used, "day")} in the last 2 weeks.`
          : "Open in the app — not opened by the client yet.";
    } else {
      status = "waiting";
      detail = `Opens on its own once ${priorLabel} is a habit — ${priorDone} of ${priorNeeded} days so far.`;
    }

    steps.push({ key: tech.key, n: n++, label: tech.label, alwaysOn: false, override: ov, status, detail });

    // advance the frontier for the next technique (mirror client-app.ts)
    if (open) {
      const used = await practiceDays(clientDir, tech.key, 14);
      priorSatisfied = used >= 2;
      priorLabel = tech.key === "eft" ? "tapping" : "the wind-down";
      priorDone = used;
      priorNeeded = 2;
    } else {
      priorSatisfied = false; // everything after a closed step stays closed
    }
  }

  return steps;
}
