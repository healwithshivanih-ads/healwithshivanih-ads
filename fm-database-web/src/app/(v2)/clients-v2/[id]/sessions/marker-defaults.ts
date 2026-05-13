/**
 * Pure utility module for marker-default selection — used by BOTH the
 * server wrapper (session-marker-charts.tsx) and the client component
 * (session-marker-charts-client.tsx).
 *
 * Lives in its own file with NO `"use client"` directive because Next 16
 * forbids server components from importing functions out of a `"use client"`
 * module: the import becomes a client-reference proxy that can't be invoked
 * server-side. The types in here are re-exported from the client component
 * for convenience (types disappear at compile time so the boundary is fine);
 * the functions must live in a neutral file like this one.
 */

import type { MarkerWithData } from "./session-marker-charts-client";

const GOAL_RULES: Array<{ patterns: RegExp[]; markers: string[] }> = [
  {
    patterns: [/weight\s*loss/i, /lose\s*weight/i, /\bweight\b/i, /\bbody\s*comp/i, /\bbmi\b/i],
    markers: ["measurement:weight_kg", "measurement:waist_cm", "measurement:bmi", "lab:Body Fat %"],
  },
  {
    patterns: [/insulin/i, /diabet/i, /pcos/i, /glucose/i, /sugar/i],
    markers: ["lab:HOMA-IR", "lab:Fasting Glucose", "lab:Fasting Insulin", "lab:HbA1c", "lab:TG/HDL"],
  },
  {
    patterns: [/thyroid/i, /hashimoto/i],
    markers: ["lab:TSH", "lab:fT3", "lab:fT4", "lab:Anti-TPO", "lab:Free T3", "lab:Free T4"],
  },
  {
    patterns: [/perimenopause/i, /menopause/i, /hormon/i, /estrogen/i, /oestrogen/i, /progesterone/i],
    markers: ["lab:Oestradiol", "lab:Estradiol", "lab:Progesterone", "lab:FSH", "lab:LH", "lab:SHBG"],
  },
  {
    patterns: [/energy/i, /fatigue/i, /tired/i],
    markers: ["lab:Vitamin D", "lab:Ferritin", "lab:B12", "lab:Vitamin B12", "lab:TSH", "lab:Cortisol"],
  },
  {
    patterns: [/inflammat/i, /joint/i, /autoimmun/i],
    markers: ["lab:hsCRP", "lab:CRP", "lab:ESR", "lab:Fibrinogen", "lab:Homocysteine"],
  },
];

/**
 * Resolve a wanted key (case-sensitive label) against available keys, also
 * trying case-insensitive label-substring match — handles "lab:TSH" matching
 * "lab:TSH (mIU/L)" or "lab:Vitamin D" matching "lab:Vitamin D 25-OH".
 */
function resolveMarkerKey(wantKey: string, available: Set<string>): string | null {
  if (available.has(wantKey)) return wantKey;
  const [prefix, ...rest] = wantKey.split(":");
  const wantLabel = rest.join(":").toLowerCase();
  if (!wantLabel) return null;
  for (const k of available) {
    if (!k.startsWith(prefix + ":")) continue;
    const label = k.slice(prefix.length + 1).toLowerCase();
    if (label === wantLabel || label.includes(wantLabel) || wantLabel.includes(label)) {
      return k;
    }
  }
  return null;
}

export function pickDefaultMarkers(
  available: MarkerWithData[],
  goals: string[],
  cap: number,
): string[] {
  const availableKeys = new Set(available.map((m) => m.key));
  const out: string[] = [];
  const goalText = goals.join(" • ");
  for (const rule of GOAL_RULES) {
    if (!rule.patterns.some((p) => p.test(goalText))) continue;
    for (const wantKey of rule.markers) {
      const resolved = resolveMarkerKey(wantKey, availableKeys);
      if (resolved && !out.includes(resolved)) out.push(resolved);
      if (out.length >= cap) break;
    }
    if (out.length >= cap) break;
  }
  // Fallback: top-N by series length (most-tracked).
  if (out.length < cap) {
    const sorted = [...available]
      .filter((m) => !out.includes(m.key))
      .sort((a, b) => b.series.length - a.series.length);
    for (const m of sorted) {
      out.push(m.key);
      if (out.length >= cap) break;
    }
  }
  return out.slice(0, cap);
}
