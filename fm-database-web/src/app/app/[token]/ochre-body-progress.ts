/**
 * Pure progress-framing helpers for the client app body section (#6).
 *
 * Extracted from ochre-body.tsx so the copy logic is unit-testable without
 * pulling React in. Leads with the WAIST, not the scale: perimenopausal women
 * recompose (inches drop while the scale barely moves), and a scale-only view
 * makes them quit before the plan works. This computes the most encouraging
 * TRUE signal from their measurement history.
 */

export interface HistPoint {
  date: string;
  weightKg: number | null;
  waistCm: number | null;
  hipCm: number | null;
}

export interface ProgressSummary {
  headline: string;
  body: string;
  tone: string;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function cmToInches(cm: number): number {
  return Math.round((cm / 2.54) * 10) / 10;
}

export function progressSummary(hist: HistPoint[]): ProgressSummary {
  const waistPts = hist.filter((h) => h.waistCm != null);
  const weightPts = hist.filter((h) => h.weightKg != null);
  const waistDelta =
    waistPts.length >= 2
      ? round1((waistPts[waistPts.length - 1].waistCm as number) - (waistPts[0].waistCm as number))
      : null;
  const weightDelta =
    weightPts.length >= 2
      ? round1((weightPts[weightPts.length - 1].weightKg as number) - (weightPts[0].weightKg as number))
      : null;

  // Not enough data yet — point them at the waist, gently.
  if (waistDelta == null && weightDelta == null) {
    return {
      headline: "Your progress lives here",
      body: "Log your weight and waist each week. Watch your waist most — it's the truest measure of fat loss, far more than the scale.",
      tone: "var(--muted)",
    };
  }

  const waistDown = waistDelta != null && waistDelta <= -0.5;
  const weightDown = weightDelta != null && weightDelta <= -0.3;
  const weightFlatOrUp = weightDelta != null && weightDelta > -0.3;

  if (waistDown && weightFlatOrUp) {
    const cm = Math.abs(waistDelta as number);
    return {
      headline: `${cm} cm off your waist`,
      body: `That's about ${cmToInches(cm)} inches — even though the scale has barely moved. Losing inches while the scale holds steady means you're losing fat and keeping muscle: exactly what we're aiming for. Trust the tape, not just the scale.`,
      tone: "var(--forest)",
    };
  }
  if (waistDown && weightDown) {
    return {
      headline: `${Math.abs(waistDelta as number)} cm off your waist · ${Math.abs(weightDelta as number)} kg down`,
      body: "Lovely, steady progress — your waist and the scale are both moving the right way. Keep going.",
      tone: "var(--forest)",
    };
  }
  if (weightDown) {
    return {
      headline: `${Math.abs(weightDelta as number)} kg down so far`,
      body: "Nice progress. Keep logging your waist too — it's the truest picture of fat loss, and it often moves even in weeks the scale doesn't.",
      tone: "var(--forest)",
    };
  }
  // No clear drop yet (or waist up) — reframe away from the scale, no false cheer.
  return {
    headline: "Keep tracking — this is normal",
    body: "Measure your waist each week. It's a truer signal than the scale, which swings with water, salt, sleep and your cycle. Steady habits show up in the tape and in how your clothes fit before the scale catches up.",
    tone: "var(--ochre)",
  };
}
