"use client";

import { useState } from "react";
import { MacroPlate, type MacroSpec } from "./macro-plate";

const PRESETS: { name: string; spec: MacroSpec; note: string }[] = [
  { name: "Balanced (1800 kcal)", spec: { protein_g: 110, carbs_g: 200, fat_g: 60 }, note: "25% P / 45% C / 30% F" },
  { name: "Higher protein (1800)", spec: { protein_g: 135, carbs_g: 180, fat_g: 60 }, note: "30% P / 40% C / 30% F" },
  { name: "Low carb (1600)", spec: { protein_g: 120, carbs_g: 100, fat_g: 90 }, note: "30% P / 25% C / 50% F" },
  { name: "Indian veg (1700)", spec: { protein_g: 80, carbs_g: 220, fat_g: 55 }, note: "19% P / 52% C / 29% F" },
];

export default function MacroPlatePreviewPage() {
  const [spec, setSpec] = useState<MacroSpec>(PRESETS[0].spec);
  const [clientName, setClientName] = useState("");

  const update = (k: keyof MacroSpec, v: string) =>
    setSpec((p) => ({ ...p, [k]: Math.max(0, Number(v) || 0) }));

  return (
    <div className="max-w-4xl mx-auto py-8 px-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--brand-indigo, #2B2D42)" }}>
          🥗 Macro plate — design preview
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approve this visual before it gets baked into the client letter. Adjust grams to test edge cases.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 items-start">
        {/* Controls */}
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setSpec(p.spec)}
                  className="rounded-md border border-border bg-white hover:bg-muted/40 px-3 py-1.5 text-xs"
                  title={p.note}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Client name (optional)</span>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              placeholder="e.g. Hariharan"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            {(["protein_g", "carbs_g", "fat_g"] as const).map((k) => (
              <label key={k} className="space-y-1">
                <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                  {k.replace("_g", "")} (g)
                </span>
                <input
                  type="number"
                  min={0}
                  value={spec[k]}
                  onChange={(e) => update(k, e.target.value)}
                  className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                />
              </label>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs space-y-1">
            <p className="font-semibold">Calorie math</p>
            <p>Protein: {spec.protein_g}g × 4 = {spec.protein_g * 4} kcal</p>
            <p>Carbs: {spec.carbs_g}g × 4 = {spec.carbs_g * 4} kcal</p>
            <p>Fat: {spec.fat_g}g × 9 = {spec.fat_g * 9} kcal</p>
            <p className="font-semibold border-t border-border pt-1 mt-1">
              Total: {spec.protein_g * 4 + spec.carbs_g * 4 + spec.fat_g * 9} kcal/day
            </p>
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-xl border border-border bg-white p-6 flex justify-center">
          <MacroPlate spec={spec} clientName={clientName || undefined} size={340} />
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
        <p className="font-semibold">⚠ Preview only — not yet integrated</p>
        <p>
          This SVG component is standalone. Once approved, we&apos;ll wire it into{" "}
          <code className="bg-amber-100 px-1 rounded">render-client-letter.py</code> via{" "}
          <code className="bg-amber-100 px-1 rounded">brand_html.py</code> so the meal plan letter
          renders the same visual inline (server-side string concat — no React in the letter).
        </p>
      </div>
    </div>
  );
}
