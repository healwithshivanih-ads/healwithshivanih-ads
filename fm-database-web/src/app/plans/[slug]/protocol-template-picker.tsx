"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PROTOCOL_TEMPLATES, type ProtocolTemplate } from "@/lib/fmdb/protocol-templates";
import type { Plan } from "@/lib/fmdb/types";

interface Props {
  onApply: (merged: Partial<Plan>) => void;
  disabled?: boolean;
}

/** Deduplicate an array of strings (case-insensitive). */
function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const k = s.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Merge a protocol template into existing plan fields, returning only the changed keys. */
function mergeTemplate(plan: Plan, tpl: ProtocolTemplate, phase: PhaseKey = "wk1"): Partial<Plan> {
  const phaseNote = phase === "wk1" ? "" : `[Introduce from ${PHASE_LABEL[phase]}] `;
  const existing = plan as Record<string, unknown>;

  // Topics
  const primary = dedup([
    ...((existing.primary_topics as string[]) ?? []),
    ...tpl.primary_topics,
  ]);
  const contributing = dedup([
    ...((existing.contributing_topics as string[]) ?? []),
    ...(tpl.contributing_topics ?? []),
  ]);

  // Presenting symptoms
  const symptoms = dedup([
    ...((existing.presenting_symptoms as string[]) ?? []),
    ...(tpl.presenting_symptoms ?? []),
  ]);

  // Supplements — merge by supplement_slug (don't duplicate), stamp phase note on rationale
  const existingSupps = ((existing.supplement_protocol as Record<string, unknown>[]) ?? []);
  const existingSlugs = new Set(existingSupps.map((s) => s.supplement_slug as string));
  const newSupps = tpl.supplements
    .filter((s) => !existingSlugs.has(s.supplement_slug))
    .map((s) => ({
      ...s,
      coach_rationale: phaseNote
        ? `${phaseNote}${s.coach_rationale ?? ""}`
        : s.coach_rationale,
    }));
  const supplement_protocol = [...existingSupps, ...newSupps];

  // Nutrition
  const existingNutrition = (existing.nutrition as Record<string, unknown>) ?? {};
  const nutrition = {
    ...existingNutrition,
    add: dedup([...((existingNutrition.add as string[]) ?? []), ...tpl.nutrition_add]),
    reduce: dedup([...((existingNutrition.reduce as string[]) ?? []), ...tpl.nutrition_reduce]),
    pattern: (existingNutrition.pattern as string) || tpl.nutrition_pattern || "",
  };

  // Lifestyle
  const existingLifestyle = (existing.lifestyle_practices as Record<string, unknown>[]) ?? [];
  const existingLifestyleNames = new Set(existingLifestyle.map((p) => (p.name as string).toLowerCase()));
  const newLifestyle = tpl.lifestyle_practices
    .filter((p) => !existingLifestyleNames.has(p.name.toLowerCase()))
    .map((p) => ({
      ...p,
      details: phaseNote
        ? `${phaseNote}${p.details ?? ""}`
        : p.details,
    }));
  const lifestyle_practices = [...existingLifestyle, ...newLifestyle];

  // Tracking
  const existingTracking = (existing.tracking as Record<string, unknown>) ?? {};
  const existingHabits = (existingTracking.habits as Record<string, unknown>[]) ?? [];
  const existingHabitNames = new Set(existingHabits.map((h) => (h.name as string).toLowerCase()));
  const newHabits = tpl.tracking_habits.filter(
    (h) => !existingHabitNames.has(h.name.toLowerCase())
  );
  const tracking = {
    ...existingTracking,
    habits: [...existingHabits, ...newHabits],
    monitor_symptoms: dedup([
      ...((existingTracking.monitor_symptoms as string[]) ?? []),
      ...(tpl.tracking_symptoms ?? []),
    ]),
  };

  // Lab orders
  const existingLabs = (existing.lab_orders as Record<string, unknown>[]) ?? [];
  const existingLabTests = new Set(existingLabs.map((l) => (l.test as string).toLowerCase()));
  const newLabs = (tpl.lab_orders ?? []).filter(
    (l) => !existingLabTests.has(l.test.toLowerCase())
  );
  const lab_orders = [...existingLabs, ...newLabs];

  return {
    primary_topics: primary,
    contributing_topics: contributing,
    presenting_symptoms: symptoms,
    supplement_protocol: supplement_protocol as Plan["supplement_protocol"],
    nutrition: nutrition as Plan["nutrition"],
    lifestyle_practices: lifestyle_practices as Plan["lifestyle_practices"],
    tracking: tracking as Plan["tracking"],
    lab_orders: lab_orders as Plan["lab_orders"],
  };
}

const PHASE_OPTIONS = [
  { value: "wk1", label: "Week 1–2 (Foundation)" },
  { value: "wk3", label: "Week 3–4 (Repair)" },
  { value: "wk5", label: "Week 5–8 (Full protocol)" },
  { value: "wk9", label: "Week 9–10 (Optimise)" },
] as const;

type PhaseKey = typeof PHASE_OPTIONS[number]["value"];

const PHASE_LABEL: Record<PhaseKey, string> = {
  wk1: "Weeks 1–2",
  wk3: "Weeks 3–4",
  wk5: "Weeks 5–8",
  wk9: "Weeks 9–10",
};

export function ProtocolTemplatePicker({ onApply, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ProtocolTemplate | null>(null);
  const [phase, setPhase] = useState<PhaseKey>("wk1");

  return (
    <div className="mb-4">
      {!open ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-7"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          📋 Apply protocol template
        </Button>
      ) : (
        <div className="border rounded-lg p-4 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Choose a protocol template</p>
            <button
              onClick={() => { setOpen(false); setPreview(null); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕ close
            </button>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground flex-1">
              Templates <strong>merge</strong> into your existing plan — nothing already added is deleted.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs font-medium whitespace-nowrap">Introduce from:</label>
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value as PhaseKey)}
                className="text-xs border rounded px-2 py-1 bg-background"
              >
                {PHASE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PROTOCOL_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setPreview(tpl)}
                className={`text-left rounded-md border px-3 py-2.5 transition-colors ${
                  preview?.id === tpl.id
                    ? "border-indigo-400 bg-indigo-50"
                    : "hover:border-indigo-200 hover:bg-muted/40"
                }`}
              >
                <div className="font-medium text-sm">
                  {tpl.icon} {tpl.display_name}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {tpl.description}
                </div>
              </button>
            ))}
          </div>

          {preview && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                {preview.icon} {preview.display_name} — what will be added
              </p>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="font-medium mb-1">Topics</div>
                  <div className="flex flex-wrap gap-1">
                    {[...preview.primary_topics, ...(preview.contributing_topics ?? [])].map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-medium mb-1">Supplements ({preview.supplements.length})</div>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {preview.supplements.map((s) => (
                      <li key={s.supplement_slug}>• {s.display_name} — {s.dose_display}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="font-medium mb-1">Foods to add</div>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {preview.nutrition_add.slice(0, 4).map((f) => (
                      <li key={f}>• {f}</li>
                    ))}
                    {preview.nutrition_add.length > 4 && (
                      <li className="italic">+ {preview.nutrition_add.length - 4} more</li>
                    )}
                  </ul>
                </div>
                <div>
                  <div className="font-medium mb-1">Lifestyle ({preview.lifestyle_practices.length})</div>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {preview.lifestyle_practices.slice(0, 3).map((p) => (
                      <li key={p.name}>• {p.name}</li>
                    ))}
                  </ul>
                </div>
                {(preview.lab_orders?.length ?? 0) > 0 && (
                  <div className="col-span-2">
                    <div className="font-medium mb-1">Lab orders</div>
                    <div className="flex flex-wrap gap-1">
                      {preview.lab_orders!.map((l) => (
                        <Badge key={l.test} variant="secondary" className="text-[10px]">{l.test}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onApply(mergeTemplate({} as Plan, preview, phase));
                    setOpen(false);
                    setPreview(null);
                  }}
                >
                  ✅ Apply from {PHASE_LABEL[phase]}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPreview(null)}
                >
                  ← Back
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
