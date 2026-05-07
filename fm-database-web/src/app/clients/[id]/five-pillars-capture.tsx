"use client";

/**
 * FivePillarsCapture — compact rating widget for the five foundational health pillars.
 * Captured at each check-in (and eventually full session) to feed the outcome progress chart.
 *
 * Pillars: Sleep · Stress · Movement · Nutrition · Connection
 * All fields are optional — coach fills what they have time for.
 */

import type { FivePillarsData } from "@/app/assess/actions";

export type { FivePillarsData };

// ── Chip helpers ───────────────────────────────────────────────────────────────

function RatingChips({
  value,
  max,
  onChange,
  invert = false,
}: {
  value?: number;
  max: number;
  onChange: (v: number) => void;
  invert?: boolean;
}) {
  const values = Array.from({ length: max + 1 }, (_, i) => i).slice(1); // 1..max

  function chipColor(n: number, selected: boolean) {
    if (!selected) return "border-border text-muted-foreground hover:border-muted-foreground bg-background";
    // invert=true means high number = bad (stress)
    const goodIdx = invert ? max - n : n - 1; // 0..max-1
    const tier = goodIdx / (max - 1); // 0..1 (0=worst, 1=best)
    if (tier < 0.34) return "border-red-400 bg-red-50 text-red-800";
    if (tier < 0.67) return "border-amber-400 bg-amber-50 text-amber-800";
    return "border-emerald-400 bg-emerald-50 text-emerald-800";
  }

  return (
    <div className="flex gap-1 flex-wrap">
      {values.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? 0 : n)}
          className={`text-[11px] font-semibold w-6 h-6 rounded-full border-2 transition-all ${chipColor(n, value === n)}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function DayChips({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => {
        const selected = value === n;
        const color = selected
          ? n <= 1 ? "border-red-400 bg-red-50 text-red-800"
          : n <= 3 ? "border-amber-400 bg-amber-50 text-amber-800"
          : "border-emerald-400 bg-emerald-50 text-emerald-800"
          : "border-border text-muted-foreground hover:border-muted-foreground bg-background";
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? -1 : n)}
            className={`text-[11px] font-semibold w-6 h-6 rounded-full border-2 transition-all ${color}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  value: FivePillarsData;
  onChange: (v: FivePillarsData) => void;
}

export function FivePillarsCapture({ value, onChange }: Props) {
  function set<K extends keyof FivePillarsData>(k: K, v: FivePillarsData[K]) {
    onChange({ ...value, [k]: v });
  }

  const isEmpty =
    !value.sleep_quality &&
    !value.sleep_hours &&
    value.stress_level == null &&
    value.movement_days_per_week == null &&
    !value.nutrition_quality &&
    !value.connection_quality;

  return (
    <div className="space-y-3 rounded-xl border-2 border-emerald-200 bg-emerald-50/30 p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: "var(--brand-indigo)" }}>
          🌿 Five Pillars
        </span>
        <span className="text-xs text-muted-foreground">
          — rate what you know (all optional)
        </span>
        {!isEmpty && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Sleep */}
        <div className="space-y-1.5 bg-white rounded-lg border px-3 py-2.5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">😴 Sleep</p>
          <div className="space-y-1.5">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Quality</p>
              <RatingChips value={value.sleep_quality} max={5} onChange={(v) => set("sleep_quality", v || undefined)} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Hours/night</p>
              <input
                type="number"
                step={0.5}
                min={0}
                max={12}
                value={value.sleep_hours ?? ""}
                onChange={(e) => set("sleep_hours", e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="e.g. 7"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Stress */}
        <div className="space-y-1.5 bg-white rounded-lg border px-3 py-2.5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">🧘 Stress</p>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Level (1=calm · 5=high)</p>
            <RatingChips
              value={value.stress_level}
              max={5}
              onChange={(v) => set("stress_level", v || undefined)}
              invert
            />
          </div>
        </div>

        {/* Movement */}
        <div className="space-y-1.5 bg-white rounded-lg border px-3 py-2.5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">🏃 Movement</p>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Days active/week</p>
            <DayChips
              value={value.movement_days_per_week}
              onChange={(v) => set("movement_days_per_week", v >= 0 ? v : undefined)}
            />
          </div>
        </div>

        {/* Nutrition */}
        <div className="space-y-1.5 bg-white rounded-lg border px-3 py-2.5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">🥗 Nutrition</p>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Overall quality</p>
            <RatingChips value={value.nutrition_quality} max={5} onChange={(v) => set("nutrition_quality", v || undefined)} />
          </div>
        </div>

        {/* Connection */}
        <div className="space-y-1.5 bg-white rounded-lg border px-3 py-2.5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">🤝 Connection</p>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Social / support quality</p>
            <RatingChips value={value.connection_quality} max={5} onChange={(v) => set("connection_quality", v || undefined)} />
          </div>
        </div>
      </div>

      {!isEmpty && (
        <p className="text-[10px] text-muted-foreground">
          Snapshot will be saved with this check-in and used to track trends in the Outcome Progress chart.
        </p>
      )}
    </div>
  );
}
