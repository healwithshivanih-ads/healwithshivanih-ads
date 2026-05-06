"use client";

/**
 * ClientPageTabs — tabbed hub for /clients/[id].
 *
 * Tabs:
 *   Overview  — bio, clinical, lab panels, preferences, files, topic brief
 *   Assess    — AssessClient in fixed-client mode (no client picker)
 *   Plans     — client's plans list + actions
 *   Health    — health trends sparklines + timeline
 */

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssessClient } from "@/app/assess/assess-client";
import { HealthTrends } from "./health-trends";
import { ClientLetterButton } from "./client-letter-button";
import { DeleteClientButton } from "./delete-client-button";
import { PreferencesEditor } from "./preferences-editor";
import { ClientProfileEditor } from "./client-profile-editor";
import { TopicBriefButton } from "./topic-brief-button";
import { SendEducationPackButton } from "./send-education-pack-button";
import { LabPanels } from "./lab-panels";
import { SessionTypePicker, type SessionType } from "./session-type-picker";
import { PreIntakeForm } from "./pre-intake-form";
import { CheckInForm } from "./check-in-form";
import type { Client } from "@/lib/fmdb/types";
import type { SessionSummary } from "@/app/assess/actions";

// ──────────────────────────────────────────────────────────────────────────────
// Prop types (all data pre-loaded server-side)
// ──────────────────────────────────────────────────────────────────────────────

type Opt = { slug: string; label: string; aliases?: string[]; category?: string };
type LabMarker = { marker_name: string; value: number; unit: string; reference_range: string; flag: string; fm_interpretation: string; computed?: boolean };
type Plan = { slug: string; status?: string; _bucket?: string; plan_period_start?: string; plan_period_recheck_date?: string; version?: number; client_id?: string };

interface ClientTabsProps {
  client: Client;
  clientId: string;
  plans: Plan[];
  sessions: SessionSummary[];
  uploadedFiles: string[];
  symptoms: Opt[];
  topics: Opt[];
  allTopics: { slug: string; display_name: string }[];
  assessmentTopics: { slug: string; label: string }[];
  labMarkers: LabMarker[];
  measurements: string | null;
  bmiStr: string | null;
  bmrCalc: number | null;
  ageDisplay: string | null;
  intakeDaysAgo: number | null;
  meds: string[];
  allergies: string[];
  keyMarkers: Array<{ label: string; value: number; unit?: string; flag: string; computed?: boolean }>;
  defaultTab?: "overview" | "assess" | "plans" | "health";
}

// ──────────────────────────────────────────────────────────────────────────────
// Tab bar
// ──────────────────────────────────────────────────────────────────────────────

type Tab = "overview" | "assess" | "plans" | "health";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "assess",   label: "🧠 Assess" },
  { key: "plans",    label: "📋 Plans" },
  { key: "health",   label: "📈 Health" },
];

// ──────────────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────────────

const SESSION_TYPE_META: Record<
  "pre_intake" | "full_assessment" | "check_in",
  { icon: string; label: string; pill: string }
> = {
  pre_intake:      { icon: "📋", label: "Pre-intake",  pill: "bg-[#D6A2A2]/20 text-[#7A3D3D]" },
  full_assessment: { icon: "🧠", label: "Assessment",  pill: "bg-[#2B2D42]/10 text-[#2B2D42]" },
  check_in:        { icon: "💬", label: "Check-in",    pill: "bg-[#8D99AE]/20 text-[#3D4A5C]" },
};

function LabMarkerDot({ flag }: { flag: string }) {
  if (flag === "optimal") return <span title="optimal">🟢</span>;
  if (flag === "suboptimal") return <span title="suboptimal">🟡</span>;
  return <span title={flag}>🔴</span>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export function ClientPageTabs({
  client,
  clientId,
  plans,
  sessions,
  uploadedFiles,
  symptoms,
  topics,
  allTopics,
  assessmentTopics,
  labMarkers,
  measurements,
  bmiStr,
  bmrCalc,
  ageDisplay,
  intakeDaysAgo,
  meds,
  allergies,
  keyMarkers,
  defaultTab = "overview",
}: ClientTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const [sessionType, setSessionType] = useState<SessionType>("full_assessment");
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const m = client.measurements as Record<string, unknown> | undefined;

  // Derive pending labs: find the most recent session (any type) that has
  // requested_labs, only if no full_assessment has occurred after it.
  // This covers both pre-intake lab orders AND mid-protocol check-in lab orders.
  const pendingLabsInfo = (() => {
    // sessions is sorted newest-first
    const labIdx = sessions.findIndex((s) => s.requested_labs.length > 0);
    if (labIdx === -1) return null;
    // check if any full_assessment session is NEWER (lower index = more recent)
    const hasAssessmentAfter = sessions.slice(0, labIdx).some((s) => s.session_type === "full_assessment");
    if (hasAssessmentAfter) return null;
    return sessions[labIdx];
  })();

  // Plan completion: a published plan whose recheck date has passed
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* ── Tab bar ── */}
      <div className="flex gap-0 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors",
              activeTab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.key === "plans" && plans.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                {plans.length}
              </Badge>
            )}
            {t.key === "plans" && plans.some((p) =>
              (p.status ?? p._bucket) === "published" &&
              p.plan_period_recheck_date &&
              p.plan_period_recheck_date < todayStr
            ) && (
              <span className="ml-1 text-[10px] font-semibold px-1.5 py-0 rounded-full bg-emerald-100 text-emerald-800">
                ✅
              </span>
            )}
            {t.key === "health" && (client.health_snapshots ?? []).length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                {(client.health_snapshots ?? []).length}
              </Badge>
            )}
            {t.key === "assess" && pendingLabsInfo != null && (
              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0 rounded-full bg-[#D6A2A2]/30 text-[#7A3D3D]">
                🧪
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
           OVERVIEW TAB
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Quick snapshot card */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-sm space-y-2">
                <div className="text-muted-foreground text-xs">
                  {[
                    ageDisplay ? `Age: ${ageDisplay}` : null,
                    client.sex ?? null,
                    client.intake_date
                      ? `Intake: ${client.intake_date}${intakeDaysAgo !== null ? ` · ${intakeDaysAgo} days ago` : ""}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {(client.active_conditions ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-xs text-muted-foreground shrink-0">Conditions:</span>
                    {(client.active_conditions as string[]).map((c) => (
                      <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
                    ))}
                  </div>
                )}
                {meds.length > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Medications: </span>{meds.join(", ")}
                  </div>
                )}
                {allergies.length > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Allergies: </span>{allergies.join(", ")}
                  </div>
                )}
                {(client.goals ?? []).length > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Goals: </span>
                    {(client.goals as string[]).join(" · ")}
                  </div>
                )}
                {(bmiStr || measurements) && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Measurements: </span>
                    {[
                      bmiStr,
                      m?.height_cm ? `${m.height_cm}cm` : null,
                      m?.weight_kg ? `${m.weight_kg}kg` : null,
                      m?.blood_pressure_systolic && m?.blood_pressure_diastolic
                        ? `BP ${m.blood_pressure_systolic}/${m.blood_pressure_diastolic}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
                {labMarkers.length > 0 && (
                  <div className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-muted-foreground shrink-0">
                      Labs{client.lab_markers_date ? ` (${client.lab_markers_date})` : ""}:
                    </span>
                    {(() => {
                      const flagged = labMarkers.filter(lm => lm.flag !== "optimal" && lm.flag !== "suboptimal").length;
                      const sub    = labMarkers.filter(lm => lm.flag === "suboptimal").length;
                      const ok     = labMarkers.filter(lm => lm.flag === "optimal").length;
                      return (
                        <span className="flex items-center gap-2">
                          {flagged > 0 && <span className="text-red-700 font-medium">🔴 {flagged} flagged</span>}
                          {sub > 0 && <span className="text-amber-700 font-medium">🟡 {sub} suboptimal</span>}
                          {ok > 0 && <span className="text-emerald-700 font-medium">🟢 {ok} optimal</span>}
                          <span className="text-muted-foreground">({labMarkers.length} total)</span>
                        </span>
                      );
                    })()}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action bar */}
          <div className="flex flex-wrap gap-3 p-4 rounded-lg border bg-muted/30">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Next steps</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use the <strong>Assess</strong> tab to upload transcripts / lab reports and generate
                a draft plan. Use the <strong>Plans</strong> tab to view and manage existing plans.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center shrink-0">
              <button
                onClick={() => setActiveTab("assess")}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
              >
                🧠 Run assessment
              </button>
              <Link href={`/plans/new?client=${clientId}`}>
                <button className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted">
                  ＋ New plan
                </button>
              </Link>
              <DeleteClientButton clientId={clientId} />
            </div>
          </div>

          <ClientProfileEditor
            clientId={clientId}
            initial={{
              active_conditions: (client.active_conditions as string[] | undefined) ?? [],
              medications: ((client.medications ?? client.current_medications) as string[] | undefined) ?? [],
              medical_history: (client.medical_history as string[] | undefined) ?? [],
              allergies: ((client.allergies ?? (client as Record<string,unknown>).known_allergies) as string[] | undefined) ?? [],
              goals: (client.goals as string[] | undefined) ?? [],
              notes: (client.notes as string | undefined) ?? "",
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle>Bio</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {measurements && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Measurements</div>
                    <div>{measurements}</div>
                  </div>
                )}
                {(bmiStr || bmrCalc) && (
                  <div className="flex flex-wrap gap-3">
                    {bmiStr && (
                      <div className="rounded-md border px-3 py-2 bg-muted/30 text-center min-w-[80px]">
                        <div className="text-[10px] uppercase text-muted-foreground font-medium">BMI</div>
                        <div className="text-base font-semibold">{bmiStr.replace("BMI ~", "")}</div>
                      </div>
                    )}
                    {(() => {
                      const waist = Number(m?.waist_cm);
                      const hip   = Number(m?.hip_cm);
                      if (!waist || !hip) return null;
                      const ratio = Math.round((waist / hip) * 100) / 100;
                      const sex = (client.sex as string | undefined)?.toUpperCase();
                      // Optimal: W:H < 0.80 for women, < 0.90 for men
                      const threshold = sex === "M" ? 0.90 : 0.80;
                      const flagCls = ratio < threshold
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : ratio < threshold + 0.05
                        ? "bg-amber-50 border-amber-200 text-amber-800"
                        : "bg-red-50 border-red-200 text-red-800";
                      return (
                        <div className={`rounded-md border px-3 py-2 text-center min-w-[80px] ${flagCls}`}>
                          <div className="text-[10px] uppercase font-medium opacity-70">W:H Ratio</div>
                          <div className="text-base font-semibold">{ratio}</div>
                          <div className="text-[10px] opacity-60">{waist}cm / {hip}cm</div>
                        </div>
                      );
                    })()}
                    {bmrCalc && (
                      <div className="rounded-md border px-3 py-2 bg-muted/30 text-center min-w-[100px]">
                        <div className="text-[10px] uppercase text-muted-foreground font-medium">BMR</div>
                        <div className="text-base font-semibold">{bmrCalc.toLocaleString()} kcal</div>
                        <div className="text-[10px] text-muted-foreground">Mifflin-St Jeor</div>
                      </div>
                    )}
                    {keyMarkers.map((lm) => {
                      const fd = lm.flag === "optimal"
                        ? { dot: "🟢", bg: "bg-emerald-50 border-emerald-200 text-emerald-800" }
                        : lm.flag === "suboptimal"
                        ? { dot: "🟡", bg: "bg-amber-50 border-amber-200 text-amber-800" }
                        : { dot: "🔴", bg: "bg-red-50 border-red-200 text-red-800" };
                      return (
                        <div key={lm.label} className={`rounded-md border px-3 py-2 text-center min-w-[100px] ${fd.bg}`}>
                          <div className="text-[10px] uppercase font-medium opacity-70">{lm.label}</div>
                          <div className="text-base font-semibold">{fd.dot} {lm.value}{lm.unit ? ` ${lm.unit}` : ""}</div>
                          {lm.computed && <div className="text-[10px] opacity-60 italic">calculated</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {(client as { mobile_number?: string }).mobile_number && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Mobile</div>
                    <div>{(client as { mobile_number?: string }).mobile_number}</div>
                  </div>
                )}
                {client.notes && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Notes</div>
                    <div className="whitespace-pre-wrap">{client.notes}</div>
                  </div>
                )}
                {client.goals && (client.goals as string[]).length > 0 && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Goals</div>
                    <ul className="list-disc list-inside">
                      {(client.goals as string[]).map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Clinical</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(client.medical_history as string[] | undefined)?.length ? (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Medical history</div>
                    <ul className="list-disc list-inside">
                      {(client.medical_history as string[]).map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                  </div>
                ) : null}
                {(client.active_conditions as string[] | undefined)?.length ? (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Active conditions</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(client.active_conditions as string[]).map((c) => (
                        <Badge key={c} variant="outline">{c}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {meds.length > 0 && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Medications</div>
                    <ul className="list-disc list-inside">{meds.map((m, i) => <li key={i}>{m}</li>)}</ul>
                  </div>
                )}
                {allergies.length > 0 && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Allergies</div>
                    <ul className="list-disc list-inside">{allergies.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Dietary & lifestyle preferences */}
          <PreferencesEditor
            clientId={clientId}
            initial={{
              dietary_preference: (client as { dietary_preference?: string }).dietary_preference,
              foods_to_avoid: (client as { foods_to_avoid?: string }).foods_to_avoid,
              non_negotiables: (client as { non_negotiables?: string }).non_negotiables,
              city: (client as { city?: string }).city,
              country: (client as { country?: string }).country,
            }}
          />

          {/* Lab Panels */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Lab Panels</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                FM-optimal ranges · markers updated each assessment session
                {client.lab_markers_date ? ` · last updated ${client.lab_markers_date}` : ""}
              </p>
            </CardHeader>
            <CardContent>
              <LabPanels markers={labMarkers} />
            </CardContent>
          </Card>

          {/* Uploaded files */}
          <Card>
            <CardHeader>
              <CardTitle>Uploaded files ({uploadedFiles.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {uploadedFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No files yet. Lab reports and food journals are uploaded in the{" "}
                  <button
                    onClick={() => setActiveTab("assess")}
                    className="underline hover:text-foreground"
                  >
                    Assess tab
                  </button>
                  .
                </p>
              ) : (
                <ul className="space-y-1">
                  {uploadedFiles.sort().map((f) => (
                    <li key={f} className="text-sm font-mono text-muted-foreground">{f}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Education pack + topic briefs */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>📚 Education pack</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Send a branded email with AI-generated topic briefs — cites NHS, NIH, WHO, ICMR and other government sources. Topics from this client&apos;s assessments are pre-selected.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <SendEducationPackButton
                  clientId={clientId}
                  clientEmail={(client as { email?: string }).email}
                  clientName={client.display_name ?? undefined}
                  assessmentTopics={assessmentTopics}
                  allTopics={allTopics.filter((t) => t.slug && t.display_name)}
                />
                <span className="text-xs text-muted-foreground">or send a single topic brief →</span>
                <TopicBriefButton
                  clientId={clientId}
                  topics={allTopics.filter(t => t.slug && t.display_name)}
                />
              </div>
              {assessmentTopics.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">{assessmentTopics.length} assessment topic{assessmentTopics.length !== 1 ? "s" : ""} pre-selected:</span>{" "}
                  {assessmentTopics.map((t) => t.label).join(", ")}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Sessions table */}
          <Card>
            <CardHeader>
              <CardTitle>Sessions ({sessions.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Topics / Notes</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead className="w-6" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((s, i) => {
                      const typeMeta = SESSION_TYPE_META[s.session_type];
                      const sid = s.session_id ?? `idx-${i}`;
                      const isExpanded = expandedSessionId === sid;
                      return (
                        <>
                          <TableRow
                            key={sid}
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() => setExpandedSessionId(isExpanded ? null : sid)}
                          >
                            <TableCell>
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeMeta.pill}`}>
                                {typeMeta.icon} {typeMeta.label}
                              </span>
                              {s.requested_labs.length > 0 && (
                                <span className="ml-1.5 text-[10px] text-muted-foreground">🧪 {s.requested_labs.length} labs</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">{s.date ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                              {s.session_type === "full_assessment"
                                ? (s.selected_topics ?? []).join(", ") || "—"
                                : s.session_type === "check_in"
                                ? (() => { const m = (s.presenting_complaints ?? "").match(/Progress:\s*([^\n]+)/); return m ? m[1].slice(0, 60) : "—"; })()
                                : s.selected_symptoms?.slice(0, 3).join(", ") || "—"}
                            </TableCell>
                            <TableCell className="text-sm">
                              {s.generated_plan_slug ? (
                                <Link href={`/plans/${s.generated_plan_slug}`} className="font-mono text-xs hover:underline" onClick={(e) => e.stopPropagation()}>
                                  {s.generated_plan_slug}
                                </Link>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground w-6">
                              {isExpanded ? "▲" : "▼"}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${sid}-detail`}>
                              <TableCell colSpan={5} className="bg-muted/20 p-0">
                                <div className="px-4 py-3 space-y-3 text-xs">
                                  {/* Stats row */}
                                  {(s.driver_count > 0 || s.supplement_count > 0 || s.requested_labs.length > 0) && (
                                    <div className="flex flex-wrap gap-2">
                                      {s.driver_count > 0 && (
                                        <span className="px-2 py-0.5 rounded-full bg-[#2B2D42]/10 text-[#2B2D42] font-medium">
                                          🔍 {s.driver_count} driver{s.driver_count !== 1 ? "s" : ""}
                                        </span>
                                      )}
                                      {s.supplement_count > 0 && (
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-medium">
                                          💊 {s.supplement_count} supplement{s.supplement_count !== 1 ? "s" : ""}
                                        </span>
                                      )}
                                      {s.requested_labs.length > 0 && (
                                        <span className="px-2 py-0.5 rounded-full bg-[#D6A2A2]/20 text-[#7A3D3D] font-medium">
                                          🧪 {s.requested_labs.length} lab{s.requested_labs.length !== 1 ? "s" : ""} ordered
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {/* Topics / symptoms */}
                                  {(s.selected_topics ?? []).length > 0 && (
                                    <div>
                                      <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Topics: </span>
                                      {(s.selected_topics ?? []).join(", ")}
                                    </div>
                                  )}
                                  {(s.selected_symptoms ?? []).length > 0 && (
                                    <div>
                                      <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Symptoms: </span>
                                      {(s.selected_symptoms ?? []).join(", ")}
                                    </div>
                                  )}
                                  {/* Presenting complaints */}
                                  {s.presenting_complaints && (
                                    <div className="rounded-md border bg-background p-2.5 text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                      {s.presenting_complaints.slice(0, 600)}
                                      {s.presenting_complaints.length > 600 && "…"}
                                    </div>
                                  )}
                                  {/* AI synthesis */}
                                  {s.synthesis_notes && (
                                    <div>
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">AI synthesis</div>
                                      <p className="italic text-muted-foreground leading-relaxed">{s.synthesis_notes}</p>
                                    </div>
                                  )}
                                  {/* Labs ordered */}
                                  {s.requested_labs.length > 0 && (
                                    <div>
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Labs ordered</div>
                                      <div className="flex flex-wrap gap-1">
                                        {s.requested_labs.map((lab) => (
                                          <span key={lab} className="px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800">{lab}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
           ASSESS TAB
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "assess" && (
        <div className="space-y-6">
          {/* ── Pending labs banner ── */}
          {pendingLabsInfo && sessionType !== "pre_intake" && (
            <div
              className="rounded-xl border-2 p-4 space-y-3"
              style={{ borderColor: "var(--brand-rose)", background: "var(--brand-bone)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🧪</span>
                    <span
                      className="font-brand font-bold text-base"
                      style={{ color: "var(--brand-indigo)" }}
                    >
                      Labs pending since {pendingLabsInfo.date ?? "pre-intake"}
                    </span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "var(--brand-lavender)" }}>
                    {pendingLabsInfo.requested_labs.length} test{pendingLabsInfo.requested_labs.length !== 1 ? "s" : ""} ordered
                    {pendingLabsInfo.session_type === "check_in" ? " at check-in" : " at pre-intake"}{" "}
                    ({pendingLabsInfo.date ?? "—"}). Run a Full Assessment once results are in.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSessionType("full_assessment");
                    setSavedSessionId(null);
                  }}
                  className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg transition-all hover:opacity-90"
                  style={{ background: "var(--brand-indigo)", color: "#fff" }}
                >
                  Labs received → run assessment
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pendingLabsInfo.requested_labs.map((lab) => (
                  <span
                    key={lab}
                    className="text-[11px] px-2 py-0.5 rounded-full border font-medium"
                    style={{
                      borderColor: "var(--brand-rose)",
                      color: "var(--brand-indigo)",
                      background: "rgba(214,162,162,0.12)",
                    }}
                  >
                    {lab}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Session type picker — always visible at top */}
          <SessionTypePicker value={sessionType} onChange={(v) => {
            setSessionType(v);
            setSavedSessionId(null);
          }} />

          {/* Divider */}
          <div className="border-t" />

          {/* Saved confirmation banner */}
          {savedSessionId && (
            <div
              className="rounded-lg px-4 py-3 text-sm flex items-center gap-2"
              style={{ background: "var(--brand-bone)", color: "var(--brand-indigo)" }}
            >
              <span className="text-base">✅</span>
              <div>
                <span className="font-semibold">Session saved</span>
                <span className="ml-2 font-mono text-xs opacity-70">{savedSessionId}</span>
              </div>
            </div>
          )}

          {/* Form for selected session type */}
          {sessionType === "pre_intake" && (
            <PreIntakeForm
              clientId={clientId}
              onSaved={(id) => setSavedSessionId(id)}
            />
          )}

          {sessionType === "full_assessment" && (
            <div className="space-y-2">
              <div
                className="rounded-xl px-5 py-4"
                style={{ background: "var(--brand-bone)" }}
              >
                <h3
                  className="font-brand text-lg font-bold mb-0.5"
                  style={{ color: "var(--brand-indigo)" }}
                >
                  🧠 Full Assessment
                </h3>
                <p className="text-xs" style={{ color: "var(--brand-lavender)" }}>
                  Upload transcripts, lab reports, and food journals. AI analyses
                  root causes and generates supplement + lifestyle suggestions.
                  Each run is saved as a session and can generate a draft plan.
                </p>
              </div>
              <AssessClient
                fixedClientId={clientId}
                symptoms={symptoms}
                topics={topics}
                initialSessions={sessions}
              />
            </div>
          )}

          {sessionType === "check_in" && (
            <CheckInForm
              clientId={clientId}
              currentPlanSlug={plans.find((p) =>
                (p.status ?? p._bucket) === "published"
              )?.slug}
              onSaved={(id) => setSavedSessionId(id)}
            />
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
           PLANS TAB
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "plans" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Plans ({plans.length})</h2>
            <Link href={`/plans/new?client=${clientId}`}>
              <button className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted">
                ＋ New plan
              </button>
            </Link>
          </div>

          {plans.length === 0 ? (
            <Card>
              <CardContent className="pt-6 pb-5 text-center">
                <p className="text-sm text-muted-foreground">No plans yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Run an assessment in the{" "}
                  <button
                    onClick={() => setActiveTab("assess")}
                    className="underline hover:text-foreground"
                  >
                    Assess tab
                  </button>{" "}
                  to generate a draft plan.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {plans
                .slice()
                .sort((a, b) => {
                  // newest first — sort by plan_period_start descending
                  const da = a.plan_period_start ?? "";
                  const db = b.plan_period_start ?? "";
                  return db.localeCompare(da);
                })
                .map((p) => {
                  const status = p.status ?? p._bucket ?? "draft";
                  const statusColor =
                    status === "published"  ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                    status === "draft"       ? "bg-muted text-muted-foreground border-border" :
                    status === "ready_to_publish" ? "bg-blue-100 text-blue-800 border-blue-200" :
                    status === "revoked"     ? "bg-red-100 text-red-700 border-red-200" :
                    "bg-muted text-muted-foreground border-border";
                  return (
                    <Card key={p.slug} className="overflow-hidden">
                      {/* Protocol complete banner */}
                      {(p.status ?? p._bucket) === "published" &&
                        p.plan_period_recheck_date &&
                        p.plan_period_recheck_date < todayStr && (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3 border-b bg-emerald-50 border-emerald-200">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-emerald-800">
                              ✅ Protocol complete — recheck date was {p.plan_period_recheck_date}
                            </p>
                            <p className="text-xs text-emerald-700 mt-0.5">
                              Time to reassess. Run a full assessment to review progress and update the protocol.
                            </p>
                          </div>
                          <button
                            onClick={() => { setActiveTab("assess"); setSessionType("full_assessment"); setSavedSessionId(null); }}
                            className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
                          >
                            🧠 Reassess now
                          </button>
                        </div>
                      )}

                      {/* Plan header */}
                      <div className="flex items-center gap-3 px-5 py-3 border-b bg-muted/20">
                        <Link href={`/plans/${p.slug}`} className="font-mono text-sm font-medium hover:underline flex-1">
                          {p.slug}
                        </Link>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${statusColor}`}>
                          {status.replace(/_/g, " ")}
                        </span>
                        {p.version && p.version > 1 && (
                          <span className="text-[11px] text-muted-foreground">v{p.version}</span>
                        )}
                        {p.plan_period_start && (
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            from {p.plan_period_start}
                          </span>
                        )}
                      </div>

                      {/* Two sections side by side */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x">
                        {/* Coaching Plan */}
                        <div className="px-5 py-4 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">🗂 Coaching Plan</span>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              Protocol & supplements
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Structured protocol: supplements, lifestyle practices, education
                            modules, labs, and referrals.
                            {status === "published" && (
                              <span className="block mt-0.5 text-emerald-700">
                                Published — read-only. Create a successor draft to edit.
                              </span>
                            )}
                          </p>
                          <Link
                            href={`/plans/${p.slug}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            {status === "draft" || status === "ready_to_publish"
                              ? "Open & edit plan →"
                              : "View plan →"}
                          </Link>
                        </div>

                        {/* Meal Plan Letter */}
                        <div className="px-5 py-4 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">🍽 Meal Plan</span>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              Client-facing letter
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            AI-generated 12-week meal plan with Indian recipes, supplement
                            guide, and lifestyle instructions tailored for the client.
                          </p>
                          <ClientLetterButton planSlug={p.slug} clientId={clientId} />
                        </div>
                      </div>
                    </Card>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
           HEALTH TAB
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "health" && (
        <div className="space-y-4">
          {(client.health_snapshots ?? []).length === 0 ? (
            <Card>
              <CardContent className="pt-6 pb-5 text-center">
                <p className="text-sm text-muted-foreground">No health snapshots yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Health data (measurements, lab values, medications, conditions) recorded
                  during an assessment will appear here as sparkline charts and a timeline.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Health trends</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(client.health_snapshots ?? []).length} snapshot{(client.health_snapshots ?? []).length !== 1 ? "s" : ""} recorded across appointments
                </p>
              </CardHeader>
              <CardContent>
                <HealthTrends client={client} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
