"use client";

/**
 * PainBodyMap — body-area picker for the intake form's Section 11e.
 *
 * v0.72 first cut was a hand-authored SVG silhouette with tappable region
 * polygons. Coach feedback after walk-through 2026-05-14: "clunky, and if
 * someone wants to say right hip there's no obvious option". The silhouette
 * had ~22px tap targets (below the 44px mobile a11y baseline) and the visual
 * front-mirror flip made left/right confusing.
 *
 * This pass swaps the silhouette for a grouped chip-grid:
 *   - 6 anatomical groups (Head & neck / Front torso / Back / Arms /
 *     Hips & pelvis / Legs)
 *   - 40 region chips, same slugs as before (dev contract intact)
 *   - Comfortable 36px+ tap targets, no left/right confusion
 *   - Reuses `.fm-chip` / `.fm-chip--on` from form.css — no new visual
 *     primitive
 *
 * The full silhouette can come back as a v2 visual flourish later; for
 * now we ship the chip-grid that actually works on a phone.
 */

import type { CSSProperties } from "react";

/* ─── 40 region slugs grouped by body area ─────────────────────────────── */

interface BodyGroup {
  title: string;
  emoji: string;
  regions: { slug: string; label: string }[];
}

const BODY_GROUPS: BodyGroup[] = [
  {
    title: "Head & neck",
    emoji: "🧠",
    regions: [
      { slug: "head", label: "Head" },
      { slug: "face", label: "Face" },
      { slug: "jaw", label: "Jaw" },
      { slug: "neck_front", label: "Front of neck" },
      { slug: "head_back", label: "Back of head" },
      { slug: "neck_back", label: "Back of neck" },
    ],
  },
  {
    title: "Front torso",
    emoji: "🫁",
    regions: [
      { slug: "chest", label: "Chest" },
      { slug: "upper_abdomen", label: "Upper abdomen" },
      { slug: "lower_abdomen", label: "Lower abdomen" },
      { slug: "pelvis", label: "Pelvis" },
    ],
  },
  {
    title: "Back",
    emoji: "🦴",
    regions: [
      { slug: "upper_back", label: "Upper back" },
      { slug: "mid_back", label: "Mid back" },
      { slug: "lower_back", label: "Lower back" },
      { slug: "scapula_left", label: "Left shoulder blade" },
      { slug: "scapula_right", label: "Right shoulder blade" },
      { slug: "sacrum", label: "Sacrum / tailbone" },
    ],
  },
  {
    title: "Shoulders & arms",
    emoji: "💪",
    regions: [
      { slug: "shoulder_left", label: "Left shoulder" },
      { slug: "shoulder_right", label: "Right shoulder" },
      { slug: "arm_left", label: "Left upper arm" },
      { slug: "arm_right", label: "Right upper arm" },
      { slug: "elbow_left", label: "Left elbow" },
      { slug: "elbow_right", label: "Right elbow" },
      { slug: "hand_left", label: "Left hand / wrist" },
      { slug: "hand_right", label: "Right hand / wrist" },
    ],
  },
  {
    title: "Hips & buttocks",
    emoji: "🦵",
    regions: [
      { slug: "hip_left", label: "Left hip" },
      { slug: "hip_right", label: "Right hip" },
      { slug: "buttock_left", label: "Left buttock" },
      { slug: "buttock_right", label: "Right buttock" },
    ],
  },
  {
    title: "Legs & feet",
    emoji: "🦶",
    regions: [
      { slug: "thigh_left", label: "Left thigh" },
      { slug: "thigh_right", label: "Right thigh" },
      { slug: "knee_left", label: "Left knee" },
      { slug: "knee_right", label: "Right knee" },
      { slug: "calf_left", label: "Left calf" },
      { slug: "calf_right", label: "Right calf" },
      { slug: "shin_left", label: "Left shin" },
      { slug: "shin_right", label: "Right shin" },
      { slug: "achilles_left", label: "Left achilles" },
      { slug: "achilles_right", label: "Right achilles" },
      { slug: "foot_left", label: "Left foot" },
      { slug: "foot_right", label: "Right foot" },
    ],
  },
];

// Reverse lookup for the readback chip row.
const SLUG_TO_LABEL: Record<string, string> = {};
for (const g of BODY_GROUPS) {
  for (const r of g.regions) SLUG_TO_LABEL[r.slug] = r.label;
}

/* ─── Component ─────────────────────────────────────────────────────────── */

interface Props {
  value: string[];                          // current pain_locations
  onChange: (next: string[]) => void;
}

export function PainBodyMap({ value, onChange }: Props) {
  const selected = new Set(value);
  const toggle = (slug: string) => {
    if (selected.has(slug)) {
      onChange(value.filter((s) => s !== slug));
    } else {
      onChange([...value, slug]);
    }
  };

  const groupStyle: CSSProperties = {
    marginBottom: 16,
  };
  const groupHeadStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--fg-2)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 8,
  };

  return (
    <div role="group" aria-label="Pain locations — tap every body area where you have pain">
      <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginBottom: 14, lineHeight: 1.5 }}>
        Tap every body area where you have pain. Left and right are <em>your</em> left and right,
        not mine.
      </div>

      {BODY_GROUPS.map((group) => {
        const groupCount = group.regions.filter((r) => selected.has(r.slug)).length;
        return (
          <div key={group.title} style={groupStyle}>
            <div style={groupHeadStyle}>
              <span aria-hidden>{group.emoji}</span>
              <span>{group.title}</span>
              {groupCount > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--indigo)",
                    fontWeight: 600,
                    textTransform: "none",
                    letterSpacing: "0.01em",
                  }}
                >
                  · {groupCount} ticked
                </span>
              )}
            </div>
            <div className="fm-chips">
              {group.regions.map((r) => {
                const on = selected.has(r.slug);
                return (
                  <button
                    key={r.slug}
                    type="button"
                    className={"fm-chip" + (on ? " fm-chip--on" : "")}
                    aria-pressed={on}
                    onClick={() => toggle(r.slug)}
                  >
                    {r.label}
                    {on && (
                      <span className="fm-chip__x" aria-hidden>
                        ×
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {value.length === 0 && (
        <div
          style={{
            marginTop: 12,
            fontSize: 12.5,
            color: "var(--fg-3)",
            fontStyle: "italic",
          }}
        >
          No pain to report? You can skip this section — an empty answer is information too.
        </div>
      )}

      {value.length > 0 && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            background: "var(--bone-warm)",
            borderRadius: "var(--radius-1)",
            border: "1px solid var(--lavender-15)",
            fontSize: 12,
            color: "var(--fg-2)",
            lineHeight: 1.5,
          }}
          aria-live="polite"
        >
          <strong style={{ fontWeight: 500, color: "var(--fg-1)" }}>
            {value.length} location{value.length === 1 ? "" : "s"} marked:
          </strong>{" "}
          {value.map((s) => SLUG_TO_LABEL[s] ?? s).join(", ")}
        </div>
      )}
    </div>
  );
}
