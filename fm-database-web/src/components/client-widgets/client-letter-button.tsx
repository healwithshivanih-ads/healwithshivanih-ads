"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  generateClientLetter,
  loadMealPlan,
  saveMealPlan,
  type WeightLossParams,
  type LetterType,
} from "@/lib/server-actions/plan-lifecycle";
import { LetterRefinementChat } from "./letter-refinement-chat";

interface Props {
  planSlug: string;
  clientId: string;
}

interface LetterState {
  markdown: string;
  html: string | null;
}

type Stage = "loading" | "idle" | "asking" | "generating" | "ready";

const LETTER_TYPES: { type: LetterType; label: string; emoji: string; desc: string; needsWeightLoss: boolean }[] = [
  { type: "meal_plan",       label: "Meal Plan",       emoji: "🥗", desc: "14-day tables, recipes, seasonal foods", needsWeightLoss: true  },
  { type: "supplement_plan", label: "Supplement Plan", emoji: "💊", desc: "Timings, doses, rationale & buy links",  needsWeightLoss: false },
  { type: "lifestyle_guide", label: "Lifestyle Guide",  emoji: "🌿", desc: "Habits, labs, education & tracking",      needsWeightLoss: false },
  { type: "consolidated",    label: "Full Wellness",   emoji: "📋", desc: "Everything in one document",             needsWeightLoss: true  },
];

function downloadAs(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Weight loss questionnaire ──────────────────────────────────────────────────

export function WeightLossForm({
  onGenerate,
  onSkip,
}: {
  onGenerate: (params: WeightLossParams) => void;
  onSkip: () => void;
}) {
  const [isWeightLoss, setIsWeightLoss] = useState<boolean | null>(null);
  const [goalKg, setGoalKg] = useState("");
  const [goalWeeks, setGoalWeeks] = useState("");
  const [activity, setActivity] = useState<WeightLossParams["activity_level"]>("sedentary");
  const [pace, setPace] = useState<WeightLossParams["pace"]>("moderate");
  const [exerciseCurrent, setExerciseCurrent] = useState("");
  const [exerciseOpenTo, setExerciseOpenTo] = useState("");
  const [exerciseDays, setExerciseDays] = useState("3");
  const [exerciseLimitations, setExerciseLimitations] = useState("");

  if (isWeightLoss === null) {
    return (
      <div className="border rounded-lg p-4 bg-amber-50 border-amber-200 space-y-3">
        <p className="text-sm font-medium text-amber-900">Is weight loss a goal for this client?</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="border-amber-400 text-amber-800 hover:bg-amber-100 text-xs"
            onClick={() => setIsWeightLoss(true)}>
            Yes — include calorie targets
          </Button>
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground"
            onClick={onSkip}>
            No — general wellness
          </Button>
        </div>
      </div>
    );
  }

  if (isWeightLoss) {
    return (
      <div className="border rounded-lg p-4 bg-amber-50 border-amber-200 space-y-4">
        <p className="text-xs font-semibold text-amber-900">Weight loss parameters</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Goal (kg to lose)</label>
            <input type="number" className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. 8"
              value={goalKg} onChange={(e) => setGoalKg(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Timeframe (weeks)</label>
            <input type="number" className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. 12"
              value={goalWeeks} onChange={(e) => setGoalWeeks(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Activity level</label>
            <select className="w-full border rounded px-2 py-1 text-sm"
              value={activity} onChange={(e) => setActivity(e.target.value as WeightLossParams["activity_level"])}>
              <option value="sedentary">Sedentary — desk job, little exercise</option>
              <option value="light">Light — walks, light activity</option>
              <option value="moderate">Moderate — exercises 3–4x week</option>
              <option value="active">Active — daily intense exercise</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Pace</label>
            <select className="w-full border rounded px-2 py-1 text-sm"
              value={pace} onChange={(e) => setPace(e.target.value as WeightLossParams["pace"])}>
              <option value="slow">Slow — ~0.25 kg/week (gentle)</option>
              <option value="moderate">Moderate — ~0.5 kg/week (recommended)</option>
              <option value="faster">Faster — ~0.75 kg/week (aggressive)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Current exercise routine</label>
          <input type="text" className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. 30 min walk 3x week"
            value={exerciseCurrent} onChange={(e) => setExerciseCurrent(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Open to adding?</label>
            <input type="text" className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. strength training, yoga"
              value={exerciseOpenTo} onChange={(e) => setExerciseOpenTo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Available days/week</label>
            <input type="number" className="w-full border rounded px-2 py-1 text-sm" min={1} max={7} placeholder="3"
              value={exerciseDays} onChange={(e) => setExerciseDays(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Physical limitations (if any)</label>
          <input type="text" className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. knee pain, back issues"
            value={exerciseLimitations} onChange={(e) => setExerciseLimitations(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="text-xs" onClick={() => {
            onGenerate({
              enabled: true,
              goal_kg: goalKg ? parseFloat(goalKg) : undefined,
              goal_weeks: goalWeeks ? parseInt(goalWeeks) : undefined,
              activity_level: activity,
              pace,
              exercise_current: exerciseCurrent,
              exercise_open_to: exerciseOpenTo,
              exercise_days_per_week: exerciseDays ? parseInt(exerciseDays) : 3,
              exercise_limitations: exerciseLimitations,
            });
          }}>
            ✓ Generate with weight loss plan
          </Button>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setIsWeightLoss(null)}>Back</Button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ClientLetterButton({ planSlug, clientId }: Props) {
  const [, startGen] = useTransition();
  const [stage, setStage] = useState<Stage>("loading");
  const [letterType, setLetterType] = useState<LetterType>("consolidated");
  const [coachNotes, setCoachNotes] = useState("");
  const [letter, setLetter] = useState<LetterState | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Track which types have been saved: type → savedAt timestamp
  const [savedTypes, setSavedTypes] = useState<Partial<Record<LetterType, string>>>({});
  const [showPreview, setShowPreview] = useState(false);
  // Inline edit chat now uses the shared <LetterRefinementChat> component
  // (discuss → finalise pattern). The old chatHistory / input / chatEndRef
  // / refinePending state lived here and got nuked when we adopted that
  // shared component — see the JSX where <LetterRefinementChat /> mounts.

  // On mount: check disk for saved consolidated plan (backward compat) + scan other types
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      LETTER_TYPES.map((lt) =>
        loadMealPlan(planSlug, clientId, lt.type).then((d) => ({ type: lt.type, data: d }))
      )
    ).then((results) => {
      if (cancelled) return;
      const saved: Partial<Record<LetterType, string>> = {};
      let latestData: (typeof results)[0] | null = null;
      for (const r of results) {
        if (r.data.ok && r.data.markdown) {
          saved[r.type] = r.data.savedAt ?? new Date().toISOString();
          if (!latestData || (r.data.savedAt ?? "") > (latestData.data.savedAt ?? "")) {
            latestData = r;
          }
        }
      }
      setSavedTypes(saved);
      if (latestData) {
        setLetterType(latestData.type);
        setLetter({ markdown: latestData.data.markdown!, html: latestData.data.html ?? null });
        setSavedAt(latestData.data.savedAt ?? null);
        setStage("ready");
      } else {
        setStage("idle");
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSlug, clientId]);

  const runGenerate = (weightLoss?: WeightLossParams) => {
    setStage("generating");
    setLetter(null);
    startGen(async () => {
      const meta = LETTER_TYPES.find((l) => l.type === letterType)!;
      toast.info(`Generating ${meta.label}… this takes 2–3 minutes`);
      const res = await generateClientLetter(planSlug, clientId, weightLoss, letterType, coachNotes);
      if (res.ok && res.markdown) {
        setLetter({ markdown: res.markdown, html: res.html ?? null });
        const ts = new Date().toISOString();
        setSavedAt(ts);
        setSavedTypes((prev) => ({ ...prev, [letterType]: ts }));
        setStage("ready");
        toast.success(`${meta.label} saved — come back any time to view or refine it`);
      } else {
        toast.error(res.error ?? "Failed to generate document");
        setStage("idle");
      }
    });
  };

  /** Switch to a different letter type that's already saved. */
  const switchToType = (type: LetterType) => {
    loadMealPlan(planSlug, clientId, type).then((data) => {
      if (data.ok && data.markdown) {
        setLetterType(type);
        setLetter({ markdown: data.markdown, html: data.html ?? null });
        setSavedAt(data.savedAt ?? null);
      }
    });
  };

  const meta = LETTER_TYPES.find((l) => l.type === letterType)!;
  const base = `${planSlug}-${letterType}`;

  // ── loading ────────────────────────────────────────────────────────────────
  if (stage === "loading") {
    return <div className="text-xs text-muted-foreground py-1 animate-pulse">Checking for saved documents…</div>;
  }

  // ── idle ──────────────────────────────────────────────────────────────────
  if (stage === "idle") {
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Choose document to generate:</p>
        <div className="grid grid-cols-2 gap-2">
          {LETTER_TYPES.map((lt) => (
            <button
              key={lt.type}
              onClick={() => { setLetterType(lt.type); setStage("asking"); }}
              className="flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left text-xs hover:bg-accent hover:border-foreground/30 transition-colors"
            >
              <span className="font-medium">{lt.emoji} {lt.label}</span>
              <span className="text-muted-foreground text-[10px]">{lt.desc}</span>
              {savedTypes[lt.type] && (
                <span className="text-emerald-600 text-[10px] mt-0.5">✓ saved</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── asking ────────────────────────────────────────────────────────────────
  if (stage === "asking") {
    return (
      <div className="space-y-4">
        {/* Type indicator + back */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{meta.emoji} {meta.label}</span>
          <button className="text-[10px] text-muted-foreground underline" onClick={() => setStage("idle")}>
            change
          </button>
        </div>

        {/* Coach notes — always shown */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            🧠 Coach knowledge (optional)
          </label>
          <p className="text-[10px] text-muted-foreground">
            Add custom tips, home remedies, or specific advice to weave into this document naturally.
          </p>
          <textarea
            className="w-full border rounded px-2 py-1.5 text-xs resize-y min-h-[60px] max-h-[120px] focus:outline-none focus:ring-1 focus:ring-emerald-300"
            placeholder="e.g. Soak 1 tsp methi seeds overnight and drink the water first thing in the morning — great for blood sugar. She responds well to morning routines..."
            value={coachNotes}
            onChange={(e) => setCoachNotes(e.target.value)}
          />
        </div>

        {/* Weight loss questionnaire — only for meal_plan / consolidated */}
        {meta.needsWeightLoss ? (
          <WeightLossForm
            onGenerate={(params) => runGenerate(params)}
            onSkip={() => runGenerate(undefined)}
          />
        ) : (
          <Button
            size="sm"
            className="text-xs"
            onClick={() => runGenerate(undefined)}
          >
            ✓ Generate {meta.label}
          </Button>
        )}
      </div>
    );
  }

  // ── generating ────────────────────────────────────────────────────────────
  if (stage === "generating") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <span className="animate-spin">⏳</span>
        Writing {meta.emoji} {meta.label}… usually 2–3 minutes. You can keep working.
      </div>
    );
  }

  // ── ready ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* All 4 type cards — always visible. Saved = switch to it; unsaved = generate it */}
      <div className="grid grid-cols-2 gap-2">
        {LETTER_TYPES.map((lt) => {
          const isCurrent = lt.type === letterType;
          const isSaved = !!savedTypes[lt.type];
          return (
            <button
              key={lt.type}
              onClick={() => {
                if (isSaved) {
                  switchToType(lt.type);
                } else {
                  setLetterType(lt.type);
                  setStage("asking");
                }
              }}
              className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                isCurrent && isSaved
                  ? "border-emerald-500 bg-emerald-50"
                  : "hover:bg-accent hover:border-foreground/30"
              }`}
            >
              <span className="font-medium">{lt.emoji} {lt.label}</span>
              <span className="text-muted-foreground text-[10px]">{lt.desc}</span>
              {isSaved ? (
                <span className="text-emerald-600 text-[10px] mt-0.5">
                  {isCurrent ? "▶ viewing" : "✓ saved — click to view"}
                </span>
              ) : (
                <span className="text-muted-foreground text-[10px] mt-0.5">click to generate</span>
              )}
            </button>
          );
        })}
      </div>

      {savedAt && (
        <p className="text-[11px] text-emerald-700">
          ✓ {meta.label} saved · last generated{" "}
          {new Date(savedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" variant="outline"
          className="border-emerald-500 text-emerald-700 hover:bg-emerald-50 text-xs"
          onClick={() => setStage("asking")}
        >
          ↺ Regenerate {meta.label}
        </Button>
        {letter?.html && (
          <Button size="sm" variant="outline"
            className="border-indigo-400 text-indigo-700 hover:bg-indigo-50 text-xs font-medium"
            onClick={() => downloadAs(`${base}.html`, letter.html!, "text/html")}
          >
            ⬇ Download HTML
          </Button>
        )}
        <Button size="sm" variant="outline" className="text-xs"
          onClick={() => downloadAs(`${base}.md`, letter!.markdown, "text/markdown")}
        >
          ⬇ Markdown
        </Button>
        <Button size="sm" variant="ghost" className="text-xs"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? "Hide preview" : "Preview"}
        </Button>
      </div>

      {letter?.html && (
        <p className="text-xs text-indigo-600">
          ✓ Branded HTML ready — open in Chrome →{" "}
          <kbd className="bg-muted px-1 rounded text-[10px]">Cmd+P → Save as PDF</kbd>
        </p>
      )}

      {/* Refinement chat — discuss-then-finalise. Coach proposes edits in
          chat (Haiku, conversational, no save); a running pending-changes
          list appears; clicking "Finalise & apply" runs Sonnet once to
          commit every queued change. Shared component used by both this
          surface and the inline meal-plan viewer. */}
      <LetterRefinementChat
        clientId={clientId}
        planSlug={planSlug}
        letterType={letterType}
        onSaved={() => {
          // Re-load the just-saved letter into local state so the preview
          // + download buttons reflect the new content.
          loadMealPlan(planSlug, clientId, letterType).then((data) => {
            if (data.ok && data.markdown) {
              setLetter({ markdown: data.markdown, html: data.html ?? null });
              const ts = new Date().toISOString();
              setSavedAt(ts);
              setSavedTypes((prev) => ({ ...prev, [letterType]: ts }));
            }
          });
        }}
      />

      {/* Markdown preview */}
      {showPreview && (
        <div className="relative">
          <pre className="overflow-auto bg-white border rounded p-3 text-[11px] max-h-[80vh] whitespace-pre-wrap">
            {letter?.markdown}
          </pre>
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent rounded-b pointer-events-none flex items-end justify-center pb-1">
            <span className="text-[10px] text-muted-foreground">↕ scroll</span>
          </div>
        </div>
      )}
    </div>
  );
}
