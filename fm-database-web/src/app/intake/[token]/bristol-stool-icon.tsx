"use client";

/**
 * BristolStoolIcon — minimal stylised glyph for each of the 7 Bristol stool
 * types, drawn in the brand `--terracotta` token (`#B85C3E`) reserved in
 * form.css.
 *
 * Replaces the placeholder `[type-N-icon]` text in the Bristol picker. The
 * design brief (`docs/INTAKE_FORM_DESIGN_BRIEF.md`) keeps Bristol illustrations
 * on the dev side intentionally — designer locks the layout, dev provides
 * tasteful glyphs. Shapes are abstract enough to be unembarrassing on a
 * client-facing form but recognisable enough to map to the clinical scale.
 *
 * Type 1 — Separate hard lumps (3 small filled circles)
 * Type 2 — Sausage but lumpy (bumpy elongated shape)
 * Type 3 — Sausage with cracks (clean shape with crack hatches)
 * Type 4 — Smooth soft sausage (clean elongated shape)
 * Type 5 — Soft blobs with clear edges (several small rounded shapes)
 * Type 6 — Mushy, ragged edges (irregular feathered shape)
 * Type 7 — Watery (loose wavy pool)
 *
 * Renders inside the existing `.fm-stool__icon` 64px square. Background is
 * the slot's striped placeholder gradient by default; the icon sits on top.
 */

type Props = { type: 1 | 2 | 3 | 4 | 5 | 6 | 7 };

export function BristolStoolIcon({ type }: Props) {
  const stroke = "var(--terracotta, #B85C3E)";
  const fill = "var(--terracotta, #B85C3E)";

  // ViewBox is square so each glyph fits the 64px slot consistently.
  const svgProps = {
    viewBox: "0 0 64 64",
    width: 56,
    height: 56,
    style: { display: "block", margin: "auto" } as const,
    "aria-hidden": true as const,
  };

  switch (type) {
    case 1:
      return (
        <svg {...svgProps}>
          {/* 3 separate hard lumps */}
          <circle cx="18" cy="26" r="7" fill={fill} />
          <circle cx="34" cy="38" r="7" fill={fill} />
          <circle cx="48" cy="22" r="6" fill={fill} />
        </svg>
      );
    case 2:
      return (
        <svg {...svgProps}>
          {/* Lumpy sausage — series of overlapping circles */}
          <g fill={fill}>
            <circle cx="14" cy="32" r="9" />
            <circle cx="26" cy="33" r="10" />
            <circle cx="40" cy="31" r="9" />
            <circle cx="51" cy="33" r="8" />
          </g>
        </svg>
      );
    case 3:
      return (
        <svg {...svgProps}>
          {/* Smooth sausage with surface cracks */}
          <rect x="6" y="22" width="52" height="20" rx="10" fill={fill} />
          <g stroke="var(--bone, #F7F4F3)" strokeWidth="1.2" strokeLinecap="round">
            <line x1="18" y1="26" x2="20" y2="38" />
            <line x1="30" y1="28" x2="32" y2="36" />
            <line x1="42" y1="26" x2="44" y2="38" />
          </g>
        </svg>
      );
    case 4:
      return (
        <svg {...svgProps}>
          {/* Smooth, soft sausage — the healthy one */}
          <rect x="6" y="22" width="52" height="20" rx="10" fill={fill} />
        </svg>
      );
    case 5:
      return (
        <svg {...svgProps}>
          {/* Soft blobs with clear-cut edges */}
          <g fill={fill}>
            <ellipse cx="15" cy="24" rx="9" ry="7" />
            <ellipse cx="34" cy="22" rx="7" ry="6" />
            <ellipse cx="20" cy="42" rx="8" ry="6" />
            <ellipse cx="42" cy="42" rx="9" ry="7" />
          </g>
        </svg>
      );
    case 6:
      return (
        <svg {...svgProps}>
          {/* Mushy, ragged edges — irregular feathered shape */}
          <path
            d="M 10 32
               Q 12 22, 22 22
               Q 28 18, 36 22
               Q 46 20, 52 26
               Q 58 30, 54 38
               Q 50 44, 42 42
               Q 34 46, 24 42
               Q 14 44, 10 36
               Z"
            fill={fill}
          />
          {/* Tiny feathered specks */}
          <g fill={fill} opacity="0.7">
            <circle cx="8" cy="42" r="1.5" />
            <circle cx="56" cy="20" r="1.5" />
            <circle cx="58" cy="44" r="1.5" />
          </g>
        </svg>
      );
    case 7:
      return (
        <svg {...svgProps}>
          {/* Liquid — a soft pool */}
          <path
            d="M 6 36
               Q 14 28, 22 32
               Q 32 24, 42 30
               Q 52 26, 58 34
               Q 56 44, 46 42
               Q 38 48, 28 44
               Q 18 48, 10 44
               Q 4 40, 6 36
               Z"
            fill={fill}
            opacity="0.85"
          />
          {/* Faint ripple */}
          <path
            d="M 18 38 Q 32 34, 48 38"
            stroke={stroke}
            strokeWidth="1"
            fill="none"
            opacity="0.4"
          />
        </svg>
      );
  }
}
