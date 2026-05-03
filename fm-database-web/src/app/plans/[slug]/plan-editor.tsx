"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MultiSelect, type MultiSelectOption } from "@/components/multi-select";
import { updatePlan } from "./actions";
import type { Plan } from "@/lib/fmdb/types";

interface SupplementItem {
  supplement_slug: string;
  form?: string;
  dose?: string;
  timing?: string;
  take_with_food?: string;
  duration_weeks?: number | null;
  titration?: string;
  coach_rationale?: string;
}

interface TrackingHabit {
  name: string;
  cadence: string;
}

interface Tracking {
  habits?: TrackingHabit[];
  symptoms_to_monitor?: string[];
  recheck_questions?: string[];
}

interface HypothesizedDriver {
  mechanism: string;
  reasoning: string;
}

interface PracticeItem {
  name: string;
  cadence: string;
  details?: string;
}

interface EducationModuleItem {
  target_kind: string; // "topic" | "mechanism" | "claim"
  target_slug: string;
  client_facing_summary?: string;
}

interface LabOrderItem {
  test: string;
  reason?: string;
}

interface ReferralItem {
  to: string;
  reason: string;
  urgency: string; // matches ReferralUrgency enum
}

const REFERRAL_URGENCIES = ["routine", "soon", "urgent", "emergency"] as const;

export interface PlanEditorProps {
  plan: Plan;
  topicOptions: MultiSelectOption[];
  symptomOptions: MultiSelectOption[];
  mechanismOptions: MultiSelectOption[];
  supplementOptions: MultiSelectOption[];
  cookingOptions: MultiSelectOption[];
  remedyOptions: MultiSelectOption[];
  resourceOptions: MultiSelectOption[];
  /** True when on-disk status is anything other than "draft". */
  locked: boolean;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x ?? null));
}

export function PlanEditor(props: PlanEditorProps) {
  const {
    plan: initial,
    topicOptions,
    symptomOptions,
    mechanismOptions,
    supplementOptions,
    cookingOptions,
    remedyOptions,
    locked,
  } = props;

  const [plan, setPlan] = useState<Plan>(() => clone(initial));
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<string | null>(null);

  function patch<K extends keyof Plan>(key: K, value: Plan[K]) {
    setPlan((p) => ({ ...p, [key]: value }));
    setDirty(true);
  }

  function patchNutrition(field: string, value: unknown) {
    setPlan((p) => ({
      ...p,
      nutrition: { ...(p.nutrition ?? {}), [field]: value },
    }));
    setDirty(true);
  }

  function patchTracking(field: keyof Tracking, value: unknown) {
    setPlan((p) => ({
      ...p,
      tracking: { ...(p.tracking ?? {}), [field]: value },
    }));
    setDirty(true);
  }

  function save() {
    setSaveResult(null);
    startTransition(async () => {
      const res = await updatePlan(plan.slug, plan);
      if (res.ok) {
        setDirty(false);
        setSaveResult("Saved.");
        toast.success("Plan saved");
      } else {
        setSaveResult(`Error: ${res.error}`);
        toast.error(res.error ?? "Save failed");
      }
    });
  }

  const supplements: SupplementItem[] =
    (plan.supplement_protocol as SupplementItem[]) ?? [];
  const drivers: HypothesizedDriver[] =
    (plan.hypothesized_drivers as HypothesizedDriver[]) ?? [];
  const tracking: Tracking = (plan.tracking as Tracking) ?? {};
  const nutrition = (plan.nutrition as Record<string, unknown>) ?? {};
  const lifestyle: PracticeItem[] =
    (plan.lifestyle_practices as PracticeItem[]) ?? [];
  const education: EducationModuleItem[] =
    (plan.education as EducationModuleItem[]) ?? [];
  const labOrders: LabOrderItem[] = (plan.lab_orders as LabOrderItem[]) ?? [];
  const referrals: ReferralItem[] = (plan.referrals as ReferralItem[]) ?? [];
  const nutritionAdd: string[] = (nutrition.add as string[]) ?? [];
  const nutritionReduce: string[] = (nutrition.reduce as string[]) ?? [];

  function optionsForKind(kind: string): MultiSelectOption[] {
    if (kind === "topic") return topicOptions;
    if (kind === "mechanism") return mechanismOptions;
    // claim — we don't load claims options into the editor; fall back to empty
    return [];
  }

  return (
    <div className="space-y-4">
      {locked && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm">
          This plan is <strong>{plan.status}</strong> — switch back to drafts
          to edit, or use the lifecycle CLI (
          <code>fmdb plan-revoke</code> / <code>plan-supersede</code>) to make
          a new revision.
        </div>
      )}

      <div className="flex items-center justify-between gap-3 sticky top-0 z-10 bg-background/80 backdrop-blur py-2 -mx-2 px-2">
        <div className="text-sm text-muted-foreground">
          {dirty ? (
            <span className="text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          ) : (
            <span>Up to date</span>
          )}
          {saveResult && <span className="ml-3">{saveResult}</span>}
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={!dirty || isPending || locked}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <Tabs defaultValue="assessment">
        <TabsList>
          <TabsTrigger value="assessment">Assessment</TabsTrigger>
          <TabsTrigger value="lifestyle">Lifestyle</TabsTrigger>
          <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
          <TabsTrigger value="education">Education</TabsTrigger>
          <TabsTrigger value="supplements">Supplements</TabsTrigger>
          <TabsTrigger value="labs">Labs</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="notes">Notes &amp; Raw</TabsTrigger>
        </TabsList>

        {/* ─────────── Assessment ─────────── */}
        <TabsContent value="assessment">
          <Card>
            <CardHeader>
              <CardTitle>Assessment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Primary topics
                </label>
                <MultiSelect
                  options={topicOptions}
                  value={plan.primary_topics ?? []}
                  onChange={(v) => patch("primary_topics", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Contributing topics
                </label>
                <MultiSelect
                  options={topicOptions}
                  value={plan.contributing_topics ?? []}
                  onChange={(v) => patch("contributing_topics", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Presenting symptoms
                </label>
                <MultiSelect
                  options={symptomOptions}
                  value={plan.presenting_symptoms ?? []}
                  onChange={(v) => patch("presenting_symptoms", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Hypothesized drivers
                </label>
                <div className="space-y-3">
                  {drivers.map((d, i) => (
                    <div
                      key={i}
                      className="border rounded-md p-3 space-y-2 bg-muted/20"
                    >
                      <div className="flex gap-2">
                        <select
                          value={d.mechanism}
                          onChange={(e) => {
                            const next = [...drivers];
                            next[i] = { ...next[i], mechanism: e.target.value };
                            patch("hypothesized_drivers", next);
                          }}
                          className="flex-1 h-9 px-2 text-sm border rounded-md bg-background"
                        >
                          <option value="">— mechanism —</option>
                          {mechanismOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label} ({o.value})
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const next = drivers.filter((_, j) => j !== i);
                            patch("hypothesized_drivers", next);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                      <textarea
                        value={d.reasoning}
                        onChange={(e) => {
                          const next = [...drivers];
                          next[i] = { ...next[i], reasoning: e.target.value };
                          patch("hypothesized_drivers", next);
                        }}
                        placeholder="Reasoning — why this is in play for this client"
                        className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patch("hypothesized_drivers", [
                        ...drivers,
                        { mechanism: "", reasoning: "" },
                      ])
                    }
                  >
                    + Add driver
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Supplements ─────────── */}
        <TabsContent value="supplements">
          <Card>
            <CardHeader>
              <CardTitle>Supplement protocol</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {supplements.map((s, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 space-y-2 bg-muted/20"
                >
                  <div className="flex gap-2 items-center">
                    <select
                      value={s.supplement_slug}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = {
                          ...next[i],
                          supplement_slug: e.target.value,
                        };
                        patch("supplement_protocol", next);
                      }}
                      className="flex-1 h-9 px-2 text-sm border rounded-md bg-background"
                    >
                      <option value="">— supplement —</option>
                      {supplementOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label} ({o.value})
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patch(
                          "supplement_protocol",
                          supplements.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Form (e.g. capsule)"
                      value={s.form ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], form: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      placeholder="Dose (e.g. 200-400 mg)"
                      value={s.dose ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], dose: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      placeholder="Timing (e.g. evening)"
                      value={s.timing ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], timing: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      placeholder="Take with food"
                      value={s.take_with_food ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = {
                          ...next[i],
                          take_with_food: e.target.value,
                        };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Duration (weeks)"
                      value={s.duration_weeks ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        const v = e.target.value;
                        next[i] = {
                          ...next[i],
                          duration_weeks: v === "" ? null : Number(v),
                        };
                        patch("supplement_protocol", next);
                      }}
                    />
                    <Input
                      placeholder="Titration"
                      value={s.titration ?? ""}
                      onChange={(e) => {
                        const next = [...supplements];
                        next[i] = { ...next[i], titration: e.target.value };
                        patch("supplement_protocol", next);
                      }}
                    />
                  </div>
                  <textarea
                    placeholder="Coach rationale — why for this client"
                    value={s.coach_rationale ?? ""}
                    onChange={(e) => {
                      const next = [...supplements];
                      next[i] = {
                        ...next[i],
                        coach_rationale: e.target.value,
                      };
                      patch("supplement_protocol", next);
                    }}
                    className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("supplement_protocol", [
                    ...supplements,
                    {
                      supplement_slug: "",
                      form: "",
                      dose: "",
                      timing: "",
                      take_with_food: "",
                      duration_weeks: null,
                      titration: "",
                      coach_rationale: "",
                    },
                  ])
                }
              >
                + Add supplement
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Tracking ─────────── */}
        <TabsContent value="tracking">
          <Card>
            <CardHeader>
              <CardTitle>Tracking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Habits
                </label>
                <div className="space-y-2">
                  {(tracking.habits ?? []).map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        placeholder="Name (e.g. nightly walk)"
                        value={h.name}
                        onChange={(e) => {
                          const next = [...(tracking.habits ?? [])];
                          next[i] = { ...next[i], name: e.target.value };
                          patchTracking("habits", next);
                        }}
                      />
                      <Input
                        placeholder="Cadence"
                        value={h.cadence}
                        onChange={(e) => {
                          const next = [...(tracking.habits ?? [])];
                          next[i] = { ...next[i], cadence: e.target.value };
                          patchTracking("habits", next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const next = (tracking.habits ?? []).filter(
                            (_, j) => j !== i
                          );
                          patchTracking("habits", next);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchTracking("habits", [
                        ...(tracking.habits ?? []),
                        { name: "", cadence: "" },
                      ])
                    }
                  >
                    + Add habit
                  </Button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Symptoms to monitor
                </label>
                <MultiSelect
                  options={symptomOptions}
                  value={tracking.symptoms_to_monitor ?? []}
                  onChange={(v) => patchTracking("symptoms_to_monitor", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Recheck questions
                </label>
                <div className="space-y-2">
                  {(tracking.recheck_questions ?? []).map((q, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={q}
                        onChange={(e) => {
                          const next = [...(tracking.recheck_questions ?? [])];
                          next[i] = e.target.value;
                          patchTracking("recheck_questions", next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const next = (
                            tracking.recheck_questions ?? []
                          ).filter((_, j) => j !== i);
                          patchTracking("recheck_questions", next);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchTracking("recheck_questions", [
                        ...(tracking.recheck_questions ?? []),
                        "",
                      ])
                    }
                  >
                    + Add question
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Nutrition (partial; multi-selects only) ─────────── */}
        <TabsContent value="nutrition">
          <Card>
            <CardHeader>
              <CardTitle>Nutrition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Pattern
                </label>
                <Input
                  value={(nutrition.pattern as string) ?? ""}
                  onChange={(e) => patchNutrition("pattern", e.target.value)}
                  placeholder="e.g. gentle anti-inflammatory"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Meal timing
                </label>
                <Input
                  value={(nutrition.meal_timing as string) ?? ""}
                  onChange={(e) =>
                    patchNutrition("meal_timing", e.target.value)
                  }
                  placeholder="e.g. 12-hour overnight fast"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Cooking adjustments
                </label>
                <MultiSelect
                  options={cookingOptions}
                  value={(nutrition.cooking_adjustments as string[]) ?? []}
                  onChange={(v) => patchNutrition("cooking_adjustments", v)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Home remedies
                </label>
                <MultiSelect
                  options={remedyOptions}
                  value={(nutrition.home_remedies as string[]) ?? []}
                  onChange={(v) => patchNutrition("home_remedies", v)}
                />
              </div>
              <FreeformStringList
                label="Foods to add"
                value={nutritionAdd}
                onChange={(v) => patchNutrition("add", v)}
                placeholder="e.g. cooked leafy greens"
                addLabel="+ Add food"
              />
              <FreeformStringList
                label="Foods to reduce"
                value={nutritionReduce}
                onChange={(v) => patchNutrition("reduce", v)}
                placeholder="e.g. ultra-processed snacks"
                addLabel="+ Add food"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Lifestyle ─────────── */}
        <TabsContent value="lifestyle">
          <Card>
            <CardHeader>
              <CardTitle>Lifestyle practices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lifestyle.map((p, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 space-y-2 bg-muted/20"
                >
                  <div className="flex gap-2">
                    <Input
                      placeholder="Name (e.g. morning sunlight)"
                      value={p.name}
                      onChange={(e) => {
                        const next = [...lifestyle];
                        next[i] = { ...next[i], name: e.target.value };
                        patch("lifestyle_practices", next);
                      }}
                    />
                    <Input
                      placeholder="Cadence (e.g. daily)"
                      value={p.cadence}
                      onChange={(e) => {
                        const next = [...lifestyle];
                        next[i] = { ...next[i], cadence: e.target.value };
                        patch("lifestyle_practices", next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patch(
                          "lifestyle_practices",
                          lifestyle.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <textarea
                    placeholder="Details — how to do it, what to expect"
                    value={p.details ?? ""}
                    onChange={(e) => {
                      const next = [...lifestyle];
                      next[i] = { ...next[i], details: e.target.value };
                      patch("lifestyle_practices", next);
                    }}
                    className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("lifestyle_practices", [
                    ...lifestyle,
                    { name: "", cadence: "", details: "" },
                  ])
                }
              >
                + Add practice
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Education ─────────── */}
        <TabsContent value="education">
          <Card>
            <CardHeader>
              <CardTitle>Education modules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {education.map((em, i) => {
                const opts = optionsForKind(em.target_kind);
                return (
                  <div
                    key={i}
                    className="border rounded-md p-3 space-y-2 bg-muted/20"
                  >
                    <div className="flex gap-2">
                      <select
                        value={em.target_kind}
                        onChange={(e) => {
                          const next = [...education];
                          // Changing kind clears the slug — slugs aren't
                          // interchangeable across topic/mechanism/claim.
                          next[i] = {
                            ...next[i],
                            target_kind: e.target.value,
                            target_slug: "",
                          };
                          patch("education", next);
                        }}
                        className="h-9 px-2 text-sm border rounded-md bg-background"
                      >
                        <option value="topic">topic</option>
                        <option value="mechanism">mechanism</option>
                        <option value="claim">claim</option>
                      </select>
                      <select
                        value={em.target_slug}
                        onChange={(e) => {
                          const next = [...education];
                          next[i] = { ...next[i], target_slug: e.target.value };
                          patch("education", next);
                        }}
                        className="flex-1 h-9 px-2 text-sm border rounded-md bg-background"
                      >
                        <option value="">
                          {em.target_kind === "claim"
                            ? "— claim slug (paste below) —"
                            : `— ${em.target_kind} —`}
                        </option>
                        {opts.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label} ({o.value})
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          patch(
                            "education",
                            education.filter((_, j) => j !== i)
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    {em.target_kind === "claim" && (
                      <Input
                        placeholder="Claim slug (no picker for claims yet)"
                        value={em.target_slug}
                        onChange={(e) => {
                          const next = [...education];
                          next[i] = {
                            ...next[i],
                            target_slug: e.target.value,
                          };
                          patch("education", next);
                        }}
                      />
                    )}
                    <textarea
                      placeholder="Client-facing summary — what you'll actually say"
                      value={em.client_facing_summary ?? ""}
                      onChange={(e) => {
                        const next = [...education];
                        next[i] = {
                          ...next[i],
                          client_facing_summary: e.target.value,
                        };
                        patch("education", next);
                      }}
                      className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                    />
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("education", [
                    ...education,
                    {
                      target_kind: "topic",
                      target_slug: "",
                      client_facing_summary: "",
                    },
                  ])
                }
              >
                + Add module
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Labs ─────────── */}
        <TabsContent value="labs">
          <Card>
            <CardHeader>
              <CardTitle>Lab orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {labOrders.map((lo, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 space-y-2 bg-muted/20"
                >
                  <div className="flex gap-2">
                    <Input
                      placeholder="Test (e.g. fT3, fT4, TPO antibodies)"
                      value={lo.test}
                      onChange={(e) => {
                        const next = [...labOrders];
                        next[i] = { ...next[i], test: e.target.value };
                        patch("lab_orders", next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patch(
                          "lab_orders",
                          labOrders.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <textarea
                    placeholder="Reason — what you're looking for, why it matters now"
                    value={lo.reason ?? ""}
                    onChange={(e) => {
                      const next = [...labOrders];
                      next[i] = { ...next[i], reason: e.target.value };
                      patch("lab_orders", next);
                    }}
                    className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("lab_orders", [
                    ...labOrders,
                    { test: "", reason: "" },
                  ])
                }
              >
                + Add lab
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Referrals ─────────── */}
        <TabsContent value="referrals">
          <Card>
            <CardHeader>
              <CardTitle>Referrals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {referrals.map((r, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 space-y-2 bg-muted/20"
                >
                  <div className="flex gap-2">
                    <Input
                      placeholder="To (role/specialty — e.g. menopause-certified clinician)"
                      value={r.to}
                      onChange={(e) => {
                        const next = [...referrals];
                        next[i] = { ...next[i], to: e.target.value };
                        patch("referrals", next);
                      }}
                    />
                    <select
                      value={r.urgency || "routine"}
                      onChange={(e) => {
                        const next = [...referrals];
                        next[i] = { ...next[i], urgency: e.target.value };
                        patch("referrals", next);
                      }}
                      className="h-9 px-2 text-sm border rounded-md bg-background"
                    >
                      {REFERRAL_URGENCIES.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        patch(
                          "referrals",
                          referrals.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <textarea
                    placeholder="Reason — why this referral, what you want them to look at"
                    value={r.reason}
                    onChange={(e) => {
                      const next = [...referrals];
                      next[i] = { ...next[i], reason: e.target.value };
                      patch("referrals", next);
                    }}
                    className="w-full text-sm border rounded-md p-2 min-h-[60px] bg-background"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch("referrals", [
                    ...referrals,
                    { to: "", reason: "", urgency: "routine" },
                  ])
                }
              >
                + Add referral
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="resources">
          <Card>
            <CardHeader>
              <CardTitle>Attached resources</CardTitle>
            </CardHeader>
            <CardContent>
              {props.resourceOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No resources found at <code>~/fm-resources/</code>.
                </p>
              ) : (
                <MultiSelect
                  options={props.resourceOptions}
                  value={(plan.attached_resources as string[]) ?? []}
                  onChange={(v) => patch("attached_resources", v)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── Notes & Raw ─────────── */}
        <TabsContent value="notes">
          <Card>
            <CardHeader>
              <CardTitle>Notes for coach</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                value={(plan.notes_for_coach as string) ?? ""}
                onChange={(e) => patch("notes_for_coach", e.target.value)}
                placeholder="Private working notes…"
                className="w-full text-sm border rounded-md p-2 min-h-[120px] bg-background font-mono"
              />
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Raw plan (read-only)
                </div>
                <pre className="text-xs bg-muted/40 p-3 rounded-md overflow-x-auto max-h-[400px]">
                  {JSON.stringify(plan, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="text-xs text-muted-foreground flex gap-4 pt-2 border-t">
        <span>
          Status: <Badge variant="outline">{plan.status ?? "draft"}</Badge>
        </span>
        <span>Version: {plan.version ?? 1}</span>
        <span>Updated: {String(plan.updated_at ?? "—")}</span>
      </div>
    </div>
  );
}

interface FreeformStringListProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}

/** Vertical list of freeform string rows with Add at bottom + Remove per row. */
function FreeformStringList({
  label,
  value,
  onChange,
  placeholder,
  addLabel = "+ Add",
}: FreeformStringListProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={v}
              placeholder={placeholder}
              onChange={(e) => {
                const next = [...value];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, ""])}
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
