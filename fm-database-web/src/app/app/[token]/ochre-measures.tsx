/* ======================================================================
   The Ochre Tree — Kitchen Measures reference (shared)
   ----------------------------------------------------------------------
   Menus now show household portions on every dish ("1 bowl", "½ cup",
   "1 katori", "2"). This file is the KEY that decodes them: what each
   measure means in ml, what it weighs for the common foods, and a real-
   world anchor so a client can eyeball it. ONE source of truth, rendered
   both in the in-app overlay (ochre-overlays.tsx → PortionsOverlay) and in
   the printable fridge card (/guides/kitchen-measures).

   Pure module — no hooks, no "use client". Safe in server and client
   trees alike. Glyphs are hand-authored inline SVG (same approach as the
   Bristol icons / pain body-map), so there are no image assets to ship.
   Values are deliberately approximate Indian-kitchen norms — a guide for
   the eye, not a lab spec.
   ====================================================================== */

export interface Measure {
  /** glyph key */
  k: string;
  /** display name */
  name: string;
  /** other names a client might know it by */
  also?: string;
  /** volume, e.g. "~150 ml" */
  approx: string;
  /** a real-world thing of the same size */
  anchor: string;
  /** food-specific weights — the units where weight varies by what's in it */
  weights?: string[];
}

export const MEASURES: Measure[] = [
  {
    k: "tsp",
    name: "1 teaspoon (tsp)",
    also: "chamach",
    approx: "5 ml",
    anchor: "the small spoon you stir tea with.",
  },
  {
    k: "tbsp",
    name: "1 tablespoon (tbsp)",
    also: "bada chamach · 3 tsp",
    approx: "15 ml",
    anchor: "a heaped serving spoon — three teaspoons.",
    weights: ["ghee / oil ≈ 14 g", "chutney / pickle ≈ 18 g", "seeds ≈ 10 g"],
  },
  {
    k: "katori",
    name: "1 katori / small bowl",
    also: "wati",
    approx: "~150 ml",
    anchor: "a standard steel katori.",
    weights: ["dal ≈ 150 g", "sabzi ≈ 120 g", "curd ≈ 150 g"],
  },
  {
    k: "bowl",
    name: "1 bowl",
    also: "big katori",
    approx: "~250 ml",
    anchor: "a cereal / soup bowl, filled to a comfortable level.",
    weights: ["cooked rice ≈ 200 g", "dal / sabzi ≈ 200 g", "salad ≈ 80 g"],
  },
  {
    k: "cup",
    name: "1 cup",
    also: "we mean ~200 ml — not the 240 ml US cup",
    approx: "~200 ml",
    anchor: "a regular tea/coffee cup, not a mug.",
    weights: ["cooked rice ≈ 150 g", "chopped veg ≈ 100 g", "milk = 200 ml"],
  },
  {
    k: "glass",
    name: "1 glass",
    also: "tumbler",
    approx: "~200 ml",
    anchor: "a normal drinking glass — water, chaas, milk.",
  },
  {
    k: "palm",
    name: "1 palm-sized portion",
    also: "your hand as the scale",
    approx: "protein serving",
    anchor: "as wide and thick as your own palm (fingers don't count).",
    weights: ["paneer / tofu / fish / chicken ≈ 90–100 g cooked"],
  },
  {
    k: "handful",
    name: "1 handful",
    also: "mutthi",
    approx: "what your cupped hand holds",
    anchor: "one cupped palm — your hand size is your portion.",
    weights: ["nuts ≈ 25–30 g", "puffed / dry snack ≈ 15 g"],
  },
  {
    k: "piece",
    name: "1 piece — roti / dosa / chilla",
    also: "the count in (1), (2)…",
    approx: "1 medium piece",
    anchor: "a roti about 6 inches across (≈ 30 g flour); a dosa from ≈ 30 g batter.",
  },
  {
    k: "pinch",
    name: "1 pinch",
    also: "chutki",
    approx: "a trace",
    anchor: "what you hold between thumb and one finger — for salt, spices, hing.",
  },
];

/** Top-of-guide coaching line — calibrate the eye, then stop weighing. */
export const MEASURE_INTRO =
  "Your plan uses everyday measures, not grams. Weigh a few of these against your own bowls and spoons two or three times — your eye calibrates fast, and then you can put the scale away.";

/* ── hand-authored glyphs (44×44, brand palette via CSS vars) ─────────── */

const S = "var(--forest-deep, #3a4d41)"; // stroke
const F = "var(--ochre-tint, rgba(169,101,31,0.10))"; // vessel fill
const A = "var(--ochre, #a9651f)"; // contents / accent

/** One measure's illustration. Pure SVG — recognisable, not literal. */
export function MeasureGlyph({ k, size = 40 }: { k: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 44 44",
    fill: "none" as const,
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true as const,
  };
  switch (k) {
    case "tsp":
    case "tbsp": {
      const r = k === "tbsp" ? 7.5 : 5.5; // tablespoon bowl is bigger
      return (
        <svg {...common}>
          <ellipse cx="16" cy="15" rx={r} ry={r * 0.78} fill={F} stroke={S} strokeWidth="1.6" />
          <ellipse cx="16" cy="15" rx={r - 2.4} ry={(r - 2.4) * 0.75} fill={A} opacity="0.55" />
          <path d={`M20 19 L31 33`} stroke={S} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    }
    case "katori":
      return (
        <svg {...common}>
          <ellipse cx="22" cy="17" rx="13" ry="3.6" fill={F} stroke={S} strokeWidth="1.6" />
          <path d="M9 17 Q22 33 35 17" fill={F} stroke={S} strokeWidth="1.6" />
          <path d="M12.5 19 Q22 27.5 31.5 19" stroke={A} strokeWidth="1.6" opacity="0.6" fill="none" />
        </svg>
      );
    case "bowl":
      return (
        <svg {...common}>
          <ellipse cx="22" cy="15" rx="15" ry="4" fill={F} stroke={S} strokeWidth="1.6" />
          <path d="M7 15 Q22 36 37 15" fill={F} stroke={S} strokeWidth="1.6" />
          <path d="M11 18 Q22 31 33 18" stroke={A} strokeWidth="1.8" opacity="0.6" fill="none" />
        </svg>
      );
    case "cup":
      return (
        <svg {...common}>
          <path d="M11 13 H31 V25 Q31 33 21 33 Q11 33 11 25 Z" fill={F} stroke={S} strokeWidth="1.6" />
          <ellipse cx="21" cy="13" rx="10" ry="2.8" fill={F} stroke={S} strokeWidth="1.6" />
          <path d="M31 16 Q38 17 37.5 22 Q37 27 31 26" fill="none" stroke={S} strokeWidth="1.6" />
          <ellipse cx="21" cy="13.5" rx="7" ry="1.8" fill={A} opacity="0.5" />
        </svg>
      );
    case "glass":
      return (
        <svg {...common}>
          <path d="M14 10 H30 L28 34 H16 Z" fill={F} stroke={S} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M16.5 22 H27.5 L26.5 33 H17.5 Z" fill={A} opacity="0.4" />
          <ellipse cx="22" cy="10" rx="8" ry="1.8" fill={F} stroke={S} strokeWidth="1.6" />
        </svg>
      );
    case "palm":
      return (
        <svg {...common}>
          {/* palm */}
          <rect x="13" y="18" width="18" height="15" rx="6" fill={F} stroke={S} strokeWidth="1.6" />
          {/* fingers */}
          {[15.5, 19.5, 23.5, 27.5].map((x, i) => (
            <rect key={i} x={x} y={8} width="3.2" height="12" rx="1.6" fill={F} stroke={S} strokeWidth="1.4" />
          ))}
          {/* thumb */}
          <rect x="9.5" y="20" width="5.5" height="3.2" rx="1.6" fill={F} stroke={S} strokeWidth="1.4" transform="rotate(-28 12 22)" />
        </svg>
      );
    case "handful":
      return (
        <svg {...common}>
          <path d="M9 24 Q22 34 35 24 L33 20 Q22 28 11 20 Z" fill={F} stroke={S} strokeWidth="1.6" />
          {[[16, 17], [22, 15], [28, 17], [19, 20], [25, 20]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="2.6" fill={A} opacity="0.7" />
          ))}
        </svg>
      );
    case "piece":
      return (
        <svg {...common}>
          <circle cx="22" cy="22" r="13" fill={F} stroke={S} strokeWidth="1.6" />
          {[[18, 18], [26, 19], [22, 25], [16, 25], [27, 26]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="1.5" fill={A} opacity="0.6" />
          ))}
        </svg>
      );
    case "pinch":
      return (
        <svg {...common}>
          <path d="M14 12 Q19 20 21 24" stroke={S} strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <path d="M30 12 Q25 20 23 24" stroke={S} strokeWidth="1.8" strokeLinecap="round" fill="none" />
          {[[20, 27], [23, 28], [21.5, 30], [24, 31], [22, 33]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="1.1" fill={A} />
          ))}
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="22" cy="22" r="12" fill={F} stroke={S} strokeWidth="1.6" />
        </svg>
      );
  }
}

/** The measures list — shared by the in-app overlay and the printable card.
 *  Pure presentational; the host supplies the surrounding chrome. */
export function MeasureList() {
  return (
    <div className="measure-list">
      {MEASURES.map((m) => (
        <div key={m.k} className="measure-row">
          <div className="measure-glyph">
            <MeasureGlyph k={m.k} />
          </div>
          <div className="measure-body">
            <div className="measure-head">
              <span className="measure-name">{m.name}</span>
              <span className="measure-approx">{m.approx}</span>
            </div>
            {m.also && <div className="measure-also">{m.also}</div>}
            <div className="measure-anchor">{m.anchor}</div>
            {m.weights && (
              <div className="measure-weights">
                {m.weights.map((w, i) => (
                  <span key={i} className="measure-wchip">
                    {w}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
