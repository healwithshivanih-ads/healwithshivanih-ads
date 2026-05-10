"use client";

export interface MacroSpec {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };

const COLOURS = {
  protein: { fill: "#16a34a", soft: "#dcfce7", text: "#14532d" },
  carbs:   { fill: "#d97706", soft: "#fef3c7", text: "#78350f" },
  fat:     { fill: "#0284c7", soft: "#e0f2fe", text: "#0c4a6e" },
};

interface Slice {
  key: "protein" | "carbs" | "fat";
  label: string;
  grams: number;
  kcal: number;
  pct: number;
}

function buildSlices(spec: MacroSpec): { slices: Slice[]; totalKcal: number } {
  const proteinKcal = spec.protein_g * KCAL_PER_G.protein;
  const carbsKcal   = spec.carbs_g   * KCAL_PER_G.carbs;
  const fatKcal     = spec.fat_g     * KCAL_PER_G.fat;
  const totalKcal   = proteinKcal + carbsKcal + fatKcal;

  const slices: Slice[] = [
    { key: "protein", label: "Protein", grams: spec.protein_g, kcal: proteinKcal, pct: totalKcal ? proteinKcal / totalKcal : 0 },
    { key: "carbs",   label: "Carbs",   grams: spec.carbs_g,   kcal: carbsKcal,   pct: totalKcal ? carbsKcal   / totalKcal : 0 },
    { key: "fat",     label: "Fat",     grams: spec.fat_g,     kcal: fatKcal,     pct: totalKcal ? fatKcal     / totalKcal : 0 },
  ];
  return { slices, totalKcal };
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  // Angles in radians, clockwise from -90deg (top)
  const x1 = cx + rOuter * Math.cos(startAngle);
  const y1 = cy + rOuter * Math.sin(startAngle);
  const x2 = cx + rOuter * Math.cos(endAngle);
  const y2 = cy + rOuter * Math.sin(endAngle);
  const x3 = cx + rInner * Math.cos(endAngle);
  const y3 = cy + rInner * Math.sin(endAngle);
  const x4 = cx + rInner * Math.cos(startAngle);
  const y4 = cy + rInner * Math.sin(startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    "Z",
  ].join(" ");
}

interface Props {
  spec: MacroSpec;
  clientName?: string;
  size?: number;
  showLegend?: boolean;
}

export function MacroPlate({ spec, clientName, size = 320, showLegend = true }: Props) {
  const { slices, totalKcal } = buildSlices(spec);

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.42;
  const rInner = size * 0.24;

  // Build arcs
  let cursor = -Math.PI / 2; // start at top
  const arcs = slices.map((s) => {
    const sweep = s.pct * Math.PI * 2;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;
    return { s, start, end };
  });

  return (
    <div className="inline-flex flex-col items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Macronutrient plate for ${clientName ?? "client"}`}
        style={{ display: "block" }}
      >
        {/* Plate ring background */}
        <circle cx={cx} cy={cy} r={rOuter + 6} fill="#fafaf9" stroke="#e7e5e4" strokeWidth="2" />

        {/* Slices */}
        {arcs.map(({ s, start, end }) => {
          if (s.pct <= 0) return null;
          const colour = COLOURS[s.key];
          // Special case: full circle (one macro is 100%)
          if (s.pct >= 0.999) {
            return (
              <g key={s.key}>
                <circle cx={cx} cy={cy} r={rOuter} fill={colour.fill} />
                <circle cx={cx} cy={cy} r={rInner} fill="white" />
              </g>
            );
          }
          const d = arcPath(cx, cy, rOuter, rInner, start, end);
          // Label position — middle of arc, just outside the outer ring
          const midAngle = (start + end) / 2;
          const labelR = rOuter * 0.72;
          const lx = cx + labelR * Math.cos(midAngle);
          const ly = cy + labelR * Math.sin(midAngle);
          return (
            <g key={s.key}>
              <path d={d} fill={colour.fill} stroke="white" strokeWidth="2" />
              {s.pct >= 0.08 && (
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={size * 0.045}
                  fontWeight="700"
                  fill="white"
                  style={{ pointerEvents: "none" }}
                >
                  {Math.round(s.pct * 100)}%
                </text>
              )}
            </g>
          );
        })}

        {/* Centre — total kcal */}
        <circle cx={cx} cy={cy} r={rInner} fill="white" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={size * 0.085} fontWeight="700" fill="#14532d">
          {Math.round(totalKcal)}
        </text>
        <text x={cx} y={cy + size * 0.06} textAnchor="middle" fontSize={size * 0.038} fill="#6b7280" letterSpacing="1">
          kcal / day
        </text>
      </svg>

      {showLegend && (
        <div className="flex gap-4 flex-wrap justify-center">
          {slices.map((s) => {
            const c = COLOURS[s.key];
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className="inline-block rounded-sm"
                  style={{ width: 14, height: 14, background: c.fill }}
                />
                <div className="text-xs leading-tight">
                  <div className="font-semibold" style={{ color: c.text }}>{s.label}</div>
                  <div className="text-muted-foreground">
                    {Math.round(s.grams)}g · {Math.round(s.kcal)} kcal · {Math.round(s.pct * 100)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
