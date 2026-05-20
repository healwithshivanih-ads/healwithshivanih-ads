/**
 * calorie-phases.ts — TS port of `_calc_calorie_targets` in
 * scripts/render-client-letter.py. Pure, deterministic, no API.
 *
 * SINGLE SOURCE OF TRUTH is the Python (the letter generator uses it).
 * This port exists so the Weight Loss card can show the same phased
 * calorie ramp on the Overview without generating a letter. Keep the
 * two in lockstep — if the Python phase curve / multipliers change,
 * change them here too.
 *
 * Phase curve (% of full deficit across a 12-week arc):
 *   Wks 1-2: 40%   Wks 3-4: 70%   Wks 5-8: 100%   Wks 9-10: 80%   Wks 11-12: 60%
 */

export interface CaloriePhases {
  bmr: number;
  tdee: number;
  fullDeficit: number;
  phases: {
    wk1_2: number;
    wk3_4: number;
    wk5_8: number;
    wk9_10: number;
    wk11_12: number;
  };
}

interface ClientLike {
  sex?: string;
  date_of_birth?: string | null;
  age_band?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  measurements?: { weight_kg?: number | null; height_cm?: number | null } | null;
}

interface WeightLossLike {
  enabled?: boolean;
  activity_level?: string;
  pace?: string;
  goal_kg?: number;
  goal_weeks?: number;
}

const ACTIVITY_MULTIPLIER: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};
const PACE_DEFICIT: Record<string, number> = {
  slow: 250,
  moderate: 500,
  faster: 750,
};

export function computeCaloriePhases(
  client: ClientLike,
  wl: WeightLossLike | null | undefined,
): CaloriePhases | null {
  if (!wl || !wl.enabled) return null;

  const m = client.measurements ?? {};
  const weight = Number(m.weight_kg ?? client.weight_kg ?? 0);
  const height = Number(m.height_cm ?? client.height_cm ?? 0);
  const sex = (client.sex ?? "").toUpperCase();

  // Age — prefer date_of_birth, else age-band midpoint (mirrors the Python).
  let age: number | null = null;
  if (client.date_of_birth) {
    const t = Date.parse(client.date_of_birth);
    if (!Number.isNaN(t)) {
      age = Math.floor((Date.now() - t) / (365 * 24 * 60 * 60 * 1000));
    }
  }
  if (age == null && client.age_band) {
    const parts = client.age_band.split("-").map((n) => parseInt(n, 10));
    if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
      age = Math.floor((parts[0] + parts[1]) / 2);
    }
  }

  if (!(weight && height && age)) return null;

  // Mifflin-St Jeor BMR.
  const bmr =
    sex === "M"
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;

  const tdee = Math.round(
    bmr * (ACTIVITY_MULTIPLIER[(wl.activity_level ?? "sedentary").toLowerCase()] ?? 1.2),
  );

  let fullDeficit = PACE_DEFICIT[(wl.pace ?? "moderate").toLowerCase()] ?? 500;
  // If the coach specified explicit goal weeks, back-calculate the daily
  // deficit (7700 kcal ≈ 1 kg fat). Capped 200–750 for safety.
  const goalKg = Number(wl.goal_kg ?? 0);
  const goalWeeks = Number(wl.goal_weeks ?? 0);
  if (goalKg && goalWeeks) {
    const required = Math.round(((goalKg / goalWeeks) * 7700) / 7);
    fullDeficit = Math.max(200, Math.min(750, required));
  }

  // Floor every phase at 1200 kcal — mirrors the Python.
  const ph = (pct: number) => Math.max(1200, Math.round(tdee - fullDeficit * pct));

  return {
    bmr: Math.round(bmr),
    tdee,
    fullDeficit,
    phases: {
      wk1_2: ph(0.4),
      wk3_4: ph(0.7),
      wk5_8: ph(1.0),
      wk9_10: ph(0.8),
      wk11_12: ph(0.6),
    },
  };
}
