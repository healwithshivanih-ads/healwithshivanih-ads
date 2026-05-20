"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateClientPreferences } from "@/lib/server-actions/clients";

const LETTER_TYPE_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: "consolidated", label: "📄 Consolidated", desc: "All-in-one letter (most common ship)" },
  { value: "meal_plan", label: "🍽 Meal plan", desc: "Standalone 7-day meal plan" },
  { value: "supplement_plan", label: "💊 Supplement plan", desc: "Skip for clients refusing supplements" },
  { value: "lifestyle_guide", label: "🌿 Lifestyle guide", desc: "Habits, education, labs, tracking" },
  { value: "exercise_plan", label: "🏃 Exercise plan", desc: "Opt-in detailed exercise prescription" },
];

type MealPlanStyle = "detailed" | "principles" | "hybrid";

const MEAL_STYLE_OPTIONS: {
  value: MealPlanStyle;
  label: string;
  emoji: string;
  desc: string;
}[] = [
  {
    value: "detailed",
    label: "Detailed",
    emoji: "📅",
    desc: "Full Mon-Sun meal tables for each week. Best for clients who want structure.",
  },
  {
    value: "principles",
    label: "Principles",
    emoji: "🟢",
    desc: "Categories + do's/don'ts + portions + 5 ideas per slot. For clients who cook from feel.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    emoji: "🌗",
    desc: "Principles first, then a sample week table as inspiration. Default — works for most.",
  },
];

interface Props {
  clientId: string;
  initial: {
    dietary_preference?: string;
    animal_derived_supplements_ok?: string;
    foods_to_avoid?: string;
    reported_triggers?: string;
    non_negotiables?: string;
    city?: string;
    country?: string;
    letter_types_active?: string[];
    meal_plan_style?: MealPlanStyle;
  };
}

export function PreferencesEditor({ clientId, initial }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [dietaryPreference, setDietaryPreference] = useState(
    initial.dietary_preference ?? ""
  );
  const [animalSupplementsOk, setAnimalSupplementsOk] = useState(
    initial.animal_derived_supplements_ok ?? ""
  );
  const [foodsToAvoid, setFoodsToAvoid] = useState(
    initial.foods_to_avoid ?? ""
  );
  const [reportedTriggers, setReportedTriggers] = useState(
    initial.reported_triggers ?? ""
  );
  const [nonNegotiables, setNonNegotiables] = useState(
    initial.non_negotiables ?? ""
  );
  const [city, setCity] = useState(initial.city ?? "");
  const [country, setCountry] = useState(initial.country ?? "");
  const [letterTypesActive, setLetterTypesActive] = useState<string[]>(
    initial.letter_types_active && initial.letter_types_active.length > 0
      ? initial.letter_types_active
      : ["consolidated"]
  );
  const [mealPlanStyle, setMealPlanStyle] = useState<MealPlanStyle>(
    initial.meal_plan_style ?? "hybrid",
  );
  const toggleLetterType = (v: string) => {
    setLetterTypesActive((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  };

  const hasData =
    initial.dietary_preference ||
    initial.foods_to_avoid ||
    initial.reported_triggers ||
    initial.non_negotiables ||
    initial.city ||
    initial.country;

  const save = () => {
    startTransition(async () => {
      const res = await updateClientPreferences({
        client_id: clientId,
        dietary_preference: dietaryPreference,
        animal_derived_supplements_ok: animalSupplementsOk,
        foods_to_avoid: foodsToAvoid,
        reported_triggers: reportedTriggers,
        non_negotiables: nonNegotiables,
        city,
        country,
        letter_types_active: letterTypesActive.length > 0 ? letterTypesActive : ["consolidated"],
        meal_plan_style: mealPlanStyle,
      });
      if (res.ok) {
        toast.success("Preferences saved");
        setOpen(false);
      } else {
        toast.error(res.error ?? "Save failed");
      }
    });
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">🥗 Food &amp; lifestyle preferences</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Cancel" : hasData ? "Edit" : "Add"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        {!open && (
          <>
            {(initial.city || initial.country) && (
              <div>
                <span className="text-xs uppercase text-muted-foreground">Location: </span>
                {[initial.city, initial.country].filter(Boolean).join(", ")}
              </div>
            )}
            {initial.dietary_preference ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">Diet: </span>
                {initial.dietary_preference}
              </div>
            ) : null}
            {initial.animal_derived_supplements_ok ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">
                  Animal-derived supplements:{" "}
                </span>
                <span
                  className={
                    initial.animal_derived_supplements_ok === "no"
                      ? "text-red-700 font-medium"
                      : "text-muted-foreground"
                  }
                >
                  {initial.animal_derived_supplements_ok === "yes"
                    ? "OK"
                    : initial.animal_derived_supplements_ok === "no"
                      ? "Plant / algae only"
                      : "Unsure — discuss"}
                </span>
              </div>
            ) : null}
            {initial.foods_to_avoid ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">Won&apos;t eat: </span>
                <span className="text-muted-foreground">{initial.foods_to_avoid}</span>
              </div>
            ) : null}
            {initial.reported_triggers ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">⚠ Reported triggers: </span>
                <span className="text-amber-700 font-medium">{initial.reported_triggers}</span>
              </div>
            ) : null}
            {initial.non_negotiables ? (
              <div>
                <span className="text-xs uppercase text-muted-foreground">Won&apos;t give up: </span>
                <span className="text-muted-foreground">{initial.non_negotiables}</span>
              </div>
            ) : null}
            <div>
              <span className="text-xs uppercase text-muted-foreground">Letters: </span>
              <span className="text-muted-foreground">
                {(initial.letter_types_active && initial.letter_types_active.length > 0
                  ? initial.letter_types_active
                  : ["consolidated"]
                )
                  .map((t) => t.replace(/_/g, " "))
                  .join(", ")}
              </span>
            </div>
            <div>
              <span className="text-xs uppercase text-muted-foreground">Meal plan style: </span>
              <span className="text-muted-foreground">
                {(() => {
                  const v = initial.meal_plan_style ?? "hybrid";
                  const opt = MEAL_STYLE_OPTIONS.find((o) => o.value === v);
                  return opt ? `${opt.emoji} ${opt.label}` : v;
                })()}
              </span>
            </div>
            {!hasData && (
              <p className="text-xs text-muted-foreground">
                No preferences on file — click Add to set them. These are used when generating the client letter.
              </p>
            )}
          </>
        )}

        {open && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Mumbai"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Country</label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. India"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Used to suggest seasonal produce and region-appropriate recipes in the meal plan.
            </p>

            <div>
              <label className="text-xs font-medium block mb-1">Dietary preference</label>
              <select
                value={dietaryPreference}
                onChange={(e) => setDietaryPreference(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— select —</option>
                <option value="Vegetarian">Vegetarian</option>
                <option value="Vegetarian Jain">Vegetarian Jain</option>
                <option value="Eggetarian">Eggetarian (veg + eggs)</option>
                <option value="Non-vegetarian">Non-vegetarian</option>
                <option value="Vegan">Vegan</option>
                <option value="Pescatarian">Pescatarian (fish, no meat)</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Animal-derived supplements — only relevant for veg-spectrum
                diets. Drives the plan-checker guard + supplement picks. */}
            {["Vegetarian", "Vegetarian Jain", "Eggetarian", "Vegan"].includes(
              dietaryPreference,
            ) && (
              <div>
                <label className="text-xs font-medium block mb-1">
                  OK with animal-derived supplements?
                </label>
                <select
                  value={animalSupplementsOk}
                  onChange={(e) => setAnimalSupplementsOk(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">— not asked —</option>
                  <option value="yes">Yes — fish oil / gelatin etc. are fine</option>
                  <option value="no">No — plant / algae-based only</option>
                  <option value="unsure">Unsure — discuss on call</option>
                </select>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Omega-3 fish oil, gelatin capsules, collagen, cod-liver oil
                  are animal-derived. &quot;No&quot; makes the plan checker
                  block these (CRITICAL); blank/unsure → a warning.
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-medium block mb-1">Foods they will NOT eat</label>
              <textarea
                value={foodsToAvoid}
                onChange={(e) => setFoodsToAvoid(e.target.value)}
                rows={2}
                placeholder="e.g. brinjal, bitter gourd, raw onion, mushrooms"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                ⚠ Reported triggers / intolerances
              </label>
              <textarea
                value={reportedTriggers}
                onChange={(e) => setReportedTriggers(e.target.value)}
                rows={2}
                placeholder="e.g. wheat causes bloating, dairy causes acne, coffee causes palpitations"
                className="w-full rounded-md border border-amber-300 bg-amber-50/50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Foods / substances client has personally experienced reactions to. These are EXCLUDED from all future meal plans.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                Non-negotiables (won&apos;t give up)
              </label>
              <textarea
                value={nonNegotiables}
                onChange={(e) => setNonNegotiables(e.target.value)}
                rows={2}
                placeholder="e.g. morning chai with milk and sugar, rice at dinner"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                🍽 Meal plan style
              </label>
              <p className="text-[11px] text-muted-foreground mb-2">
                How structured this client wants her meal-plan letters.
                Hybrid is the safe default — coach can refine after the
                first call.
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {MEAL_STYLE_OPTIONS.map((opt) => {
                  const checked = mealPlanStyle === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex flex-col gap-1 px-2.5 py-2 rounded-md border cursor-pointer text-xs transition-colors ${
                        checked
                          ? "bg-amber-100/60 border-amber-300"
                          : "bg-background border-input hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="meal_plan_style"
                          checked={checked}
                          onChange={() => setMealPlanStyle(opt.value)}
                        />
                        <span className="font-medium">
                          {opt.emoji} {opt.label}
                        </span>
                      </div>
                      <div className="text-[10.5px] text-muted-foreground leading-snug">
                        {opt.desc}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                📤 Letter preferences
              </label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Which letters this client should receive. Default is consolidated only.
                Skip supplements for clients refusing them; skip exercise plan unless requested.
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {LETTER_TYPE_OPTIONS.map((opt) => {
                  const checked = letterTypesActive.includes(opt.value);
                  return (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs transition-colors ${
                        checked ? "bg-amber-100/60 border-amber-300" : "bg-background border-input hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLetterType(opt.value)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-[10.5px] text-muted-foreground">{opt.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
