"use client";

/**
 * IFMTimelineCard — renders the client's IFM functional-medicine timeline in
 * the Antecedents / Triggers / Mediators / Resolution format.
 *
 * Two data paths:
 *   1. AI-generated (preferred) — if `aiTimeline` is supplied (typically the
 *      `ifm_timeline` field on the most recent intake's ai_analysis), each
 *      event already has `atm`, `rationale`, and `linked_driver_slugs`.
 *      The card surfaces driver links as chips per event.
 *   2. Heuristic fallback — when only raw `timeline_events` are available,
 *      classify each event using the original `category` field plus age
 *      derived from `dateOfBirth`.
 *
 * Coach refines classification upstream by:
 *   - Editing event categories in the intake form / transcript-update panel,
 *     OR
 *   - Re-running the intake AI (which produces the structured aiTimeline).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TimelineEvent } from "@/lib/fmdb/types";

type ATM = "antecedent" | "trigger" | "mediator" | "resolution";

interface ClassifiedEvent {
  year?: number;
  date?: string;
  event: string;
  category?: string;
  atm: ATM;
  ageAtEvent: number | null;
  yearNum: number | null;
  rationale?: string;
  linkedDrivers?: string[];
  source: "ai" | "heuristic";
}

const ATM_META: Record<ATM, { label: string; pill: string; dotColor: string; description: string }> = {
  antecedent: {
    label: "Antecedent",
    pill: "bg-amber-50 text-amber-800 border border-amber-200",
    dotColor: "#D97706",
    description: "Predisposing — early-life or genetic foundation",
  },
  trigger: {
    label: "Trigger",
    pill: "bg-rose-50 text-rose-800 border border-rose-200",
    dotColor: "#DC2626",
    description: "Initiated dysfunction — illness, surgery, stressor, medication",
  },
  mediator: {
    label: "Mediator",
    pill: "bg-indigo-50 text-indigo-800 border border-indigo-200",
    dotColor: "#4F46E5",
    description: "Perpetuating — ongoing diet, lifestyle, beliefs, environment",
  },
  resolution: {
    label: "Resolution",
    pill: "bg-emerald-50 text-emerald-800 border border-emerald-200",
    dotColor: "#059669",
    description: "Improvement / what helped",
  },
};

function classifyEvent(ev: TimelineEvent, dob?: string): ATM {
  const cat = (ev.category ?? "").toLowerCase();
  // Resolution comes first because it's unambiguous
  if (cat === "recovery" || /improv|resolv|recover/i.test(ev.event)) return "resolution";

  // Trigger categories — discrete events that initiate dysfunction
  if (cat === "symptom_onset" || cat === "diagnosis" || cat === "surgery") return "trigger";

  // Mediator categories — ongoing perpetuators
  if (cat === "treatment" || cat === "medication_change") return "mediator";

  // Stress is a trigger if discrete (one event), mediator if chronic — best guess from word
  if (cat === "stress") {
    if (/chronic|ongoing|years|since|long.?term|workload|overwork/i.test(ev.event)) return "mediator";
    return "trigger";
  }

  // life_event — use age at event when DOB available
  if (dob && (ev.year ?? null) !== null) {
    try {
      const dobYear = new Date(dob).getFullYear();
      const eventYear = ev.year as number;
      const age = eventYear - dobYear;
      if (age <= 12) return "antecedent";          // childhood
      if (age <= 18) return "antecedent";          // adolescence
      // adult life events lean mediator (chronic situation) absent other signal
      return "mediator";
    } catch {
      // fall through
    }
  }

  // No DOB — default life_event to mediator (broadly safer than guessing)
  return "mediator";
}

function ageAt(ev: TimelineEvent, dob?: string): number | null {
  if (!dob) return null;
  try {
    const dobYear = new Date(dob).getFullYear();
    if (ev.date) {
      const evDate = new Date(ev.date);
      const dobDate = new Date(dob);
      let age = evDate.getFullYear() - dobDate.getFullYear();
      const m = evDate.getMonth() - dobDate.getMonth();
      if (m < 0 || (m === 0 && evDate.getDate() < dobDate.getDate())) age--;
      return age >= 0 ? age : null;
    }
    if (ev.year != null) {
      const age = ev.year - dobYear;
      return age >= 0 ? age : null;
    }
  } catch { /* fall through */ }
  return null;
}

function eventYear(ev: TimelineEvent): number | null {
  if (ev.year != null) return ev.year;
  if (ev.date) {
    try { return new Date(ev.date).getFullYear(); } catch { return null; }
  }
  return null;
}

interface AITimelineEvent {
  year?: number;
  date?: string;
  age_at_event?: number;
  event: string;
  category?: string;
  atm: string;
  rationale?: string;
  linked_driver_slugs?: string[];
}

interface Props {
  events?: TimelineEvent[];
  dateOfBirth?: string;
  /** AI-classified timeline from the latest intake's ai_analysis.ifm_timeline.
   *  When present, this takes precedence over the heuristic classification. */
  aiTimeline?: AITimelineEvent[];
}

function normalizeAtm(s: string): ATM {
  const t = s.toLowerCase();
  if (t === "antecedent" || t === "trigger" || t === "mediator" || t === "resolution") return t;
  return "mediator";
}

export function IFMTimelineCard({ events, dateOfBirth, aiTimeline }: Props) {
  // Prefer AI-generated timeline when available — it includes driver links
  // and rationale that the heuristic version can't produce.
  const useAi = Array.isArray(aiTimeline) && aiTimeline.length > 0;
  const rawEvents = useAi ? aiTimeline! : (events ?? []);
  if (rawEvents.length === 0) return null;

  const classified: ClassifiedEvent[] = useAi
    ? aiTimeline!.map((ev) => ({
        year: ev.year,
        date: ev.date,
        event: ev.event,
        category: ev.category,
        atm: normalizeAtm(ev.atm),
        ageAtEvent: ev.age_at_event ?? ageAt({ year: ev.year, date: ev.date, event: ev.event }, dateOfBirth),
        yearNum: ev.year ?? eventYear({ event: ev.event, year: ev.year, date: ev.date }),
        rationale: ev.rationale,
        linkedDrivers: ev.linked_driver_slugs,
        source: "ai" as const,
      }))
    : (events ?? []).map((ev) => ({
        year: ev.year,
        date: ev.date,
        event: ev.event,
        category: ev.category,
        atm: classifyEvent(ev, dateOfBirth),
        ageAtEvent: ageAt(ev, dateOfBirth),
        yearNum: eventYear(ev),
        source: "heuristic" as const,
      }));

  // Sort chronologically (events with no year sink to the bottom)
  classified.sort((a, b) => {
    if (a.yearNum == null && b.yearNum == null) return 0;
    if (a.yearNum == null) return 1;
    if (b.yearNum == null) return -1;
    return a.yearNum - b.yearNum;
  });

  const counts = {
    antecedent: classified.filter((e) => e.atm === "antecedent").length,
    trigger: classified.filter((e) => e.atm === "trigger").length,
    mediator: classified.filter((e) => e.atm === "mediator").length,
    resolution: classified.filter((e) => e.atm === "resolution").length,
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              📅 IFM Timeline
              {useAi && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-800 border border-violet-200">
                  ✨ AI-classified
                </span>
              )}
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {useAi
                ? `${classified.length} events classified by the assessment, with mechanism links.`
                : `Heuristic classification of ${classified.length} captured event${classified.length !== 1 ? "s" : ""}. Run an intake assessment for AI-classified driver links.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["antecedent", "trigger", "mediator", "resolution"] as ATM[]).map((k) =>
              counts[k] > 0 ? (
                <span key={k} className={`text-[10px] font-semibold px-2 py-0.5 rounded ${ATM_META[k].pill}`}>
                  {ATM_META[k].label} · {counts[k]}
                </span>
              ) : null
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Legend */}
        <details className="mb-3 text-[11px]">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
            What these mean
          </summary>
          <div className="mt-2 grid sm:grid-cols-2 gap-2">
            {(["antecedent", "trigger", "mediator", "resolution"] as ATM[]).map((k) => (
              <div key={k} className="flex items-start gap-2">
                <span className={`shrink-0 mt-0.5 w-2 h-2 rounded-full`} style={{ background: ATM_META[k].dotColor }} />
                <div>
                  <span className="font-semibold">{ATM_META[k].label}</span>{" "}
                  <span className="text-muted-foreground">— {ATM_META[k].description}</span>
                </div>
              </div>
            ))}
          </div>
        </details>

        {/* Vertical chronological timeline */}
        <div className="relative pl-5">
          <div className="absolute left-1.5 top-1 bottom-1 w-px bg-border" />
          {classified.map((ev, i) => {
            const meta = ATM_META[ev.atm];
            return (
              <div key={i} className="relative mb-3 last:mb-0">
                <div
                  className="absolute -left-[14px] top-1 w-3 h-3 rounded-full border-2 border-background"
                  style={{ background: meta.dotColor, boxShadow: "0 0 0 1.5px #e2e8f0" }}
                />
                <div className="space-y-0.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                      {ev.yearNum ?? "—"}
                      {ev.ageAtEvent != null && (
                        <span className="ml-1 text-[10px]">(age {ev.ageAtEvent})</span>
                      )}
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.pill}`}>
                      {meta.label}
                    </span>
                    {ev.category && ev.category !== "life_event" && (
                      <Badge variant="outline" className="text-[10px]">
                        {ev.category.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {ev.source === "ai" && ev.category === "extracted_from_narrative" && (
                      <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                        ✨ extracted by AI
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm leading-snug">{ev.event}</p>
                  {ev.rationale && (
                    <p className="text-[11px] italic text-muted-foreground leading-snug">
                      {ev.rationale}
                    </p>
                  )}
                  {ev.linkedDrivers && ev.linkedDrivers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                        Drives:
                      </span>
                      {ev.linkedDrivers.map((slug) => (
                        <span
                          key={slug}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-800"
                        >
                          {slug}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-muted-foreground mt-3 italic">
          {useAi
            ? "Classification produced by the intake AI assessment. Re-running the intake will refresh it."
            : "Classification is heuristic, based on event category and age. Run an intake assessment to get AI-classified driver links."}
        </p>
      </CardContent>
    </Card>
  );
}
