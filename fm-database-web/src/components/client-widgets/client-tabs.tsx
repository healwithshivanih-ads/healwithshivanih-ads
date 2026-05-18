"use client";

/**
 * ClientPageTabs — tabbed hub for /clients/[id].
 *
 * Tabs:
 *   Overview  — bio, clinical snapshot, lab panels, preferences, files, education pack
 *   Sessions  — record a session (discovery / intake / check-in / quick note) + session history
 *   Plan      — plan status, edit, activate, and client letter generation (merged Protocol + Send)
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AssessClient } from "@/components/assess/assess-client";
import { HealthTrends } from "./health-trends";
import { ReportsTab } from "./reports-tab";
import { SendPackageButton } from "./send-package-button";
import { DeleteClientButton } from "./delete-client-button";
import { PreferencesEditor } from "./preferences-editor";
import { ClientProfileEditor } from "./client-profile-editor";
import { TopicBriefButton } from "./topic-brief-button";
import { SendEducationPackButton } from "./send-education-pack-button";
import { LabPanels } from "./lab-panels";
import { SessionTypePicker, type SessionType } from "./session-type-picker";
import { CheckInForm } from "./check-in-form";
import { generateFollowUpPlan, submitPlan, publishPlan } from "@/lib/server-actions/plan-lifecycle";
import { addMeasurementAction, assessReworkBenefitAction } from "@/lib/server-actions/clients";
import { TranscriptUpdatePanel } from "./transcript-update-panel";
import { OutcomeProgressCard } from "./outcome-progress-card";
import { LabUploadPanel } from "./lab-upload-panel";
import { MessageCapturePanel } from "./message-capture-panel";
import { ProtocolCheckinPanel } from "./protocol-checkin-panel";
import { PreSessionBrief } from "./pre-session-brief";
import { MessageTemplatesPanel } from "./message-templates-panel";
import { FollowUpDraftPanel } from "./follow-up-draft-panel";
import { ProtocolAdherenceChart } from "./protocol-adherence-chart";
import { DiscoveryForm } from "./discovery-form";
import { IFMTrend } from "./ifm-trend";
import { LabComparison } from "./lab-comparison";
import { LabReferenceRangesEditor } from "./lab-reference-ranges";
import { TimelineEditor } from "./timeline-editor";
import { ApiUsagePanel } from "./api-usage-panel";
import { MedicationImpactPanel } from "./medication-impact-panel";
import { FunctionalTestPanel } from "./functional-test-panel";
import { GeneticReportPanel } from "./genetic-report-panel";
import { SOAPNotePanel } from "./soap-note-panel";
import { PregnancySafetyPanel } from "./pregnancy-safety-panel";
import { ReworkBanner } from "./rework-banner";
import { IFMTimelineCard } from "./ifm-timeline-card";
import { ClientAvatar } from "./client-avatar";
import { SessionBriefModal } from "./session-brief-modal";
import type { Client, MeasurementEntry } from "@/lib/fmdb/types";
import type { SessionSummary } from "@/lib/server-actions/assess";

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
  defaultTab?: "overview" | "sessions" | "plan";
  defaultSessionType?: SessionType;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tab bar
// ──────────────────────────────────────────────────────────────────────────────

type Tab = "overview" | "sessions" | "plan";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview",  label: "Overview"     },
  { key: "sessions",  label: "🔬 Analyse"  },
  { key: "plan",      label: "📋 Plan"      },
];

// ──────────────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────────────

const SESSION_TYPE_META: Record<
  SessionType,
  { icon: string; label: string; pill: string }
> = {
  discovery: { icon: "🔍", label: "Discovery", pill: "bg-[#A8C5A0]/20 text-[#3D6B35]" },
  intake:    { icon: "📋", label: "Intake",    pill: "bg-[#2B2D42]/10 text-[#2B2D42]" },
  check_in:  { icon: "💬", label: "Check-in",  pill: "bg-[#8D99AE]/20 text-[#3D4A5C]" },
  quick_note: { icon: "📌", label: "Quick Note", pill: "bg-[#E8A87C]/20 text-[#7A4A2A]" },
};

// ── MeasurementsWidget ────────────────────────────────────────────────────────

import { saveSessionAction } from "@/lib/server-actions/assess";

function MeasurementsWidget({
  clientId,
  log,
  todayStr,
}: {
  clientId: string;
  log: MeasurementEntry[];
  todayStr: string;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayStr);
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [hip, setHip] = useState("");
  const [height, setHeight] = useState("");
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");
  const [hr, setHr] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSave = async () => {
    if (!date) return;
    setSaving(true); setError(null); setSuccess(false);
    const input = {
      client_id: clientId,
      date,
      weight_kg: weight ? parseFloat(weight) : undefined,
      waist_cm: waist ? parseFloat(waist) : undefined,
      hip_cm: hip ? parseFloat(hip) : undefined,
      height_cm: height ? parseFloat(height) : undefined,
      blood_pressure_systolic: bpSys ? parseInt(bpSys, 10) : undefined,
      blood_pressure_diastolic: bpDia ? parseInt(bpDia, 10) : undefined,
      resting_heart_rate: hr ? parseInt(hr, 10) : undefined,
      notes: notes.trim() || undefined,
    };
    const res = await addMeasurementAction(input);
    setSaving(false);
    if (!res.ok) { setError((res as { error?: string }).error ?? "Failed"); return; }
    setSuccess(true);
    setTimeout(() => { setOpen(false); setSuccess(false); router.refresh(); }, 800);
  };

  const latest = log[0];

  return (
    <div className="space-y-2">
      {/* Latest entry summary */}
      {latest && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          {latest.weight_kg && <span className="font-medium">{latest.weight_kg} kg</span>}
          {latest.waist_cm && <span className="text-muted-foreground text-xs">Waist {latest.waist_cm}cm</span>}
          {latest.hip_cm && <span className="text-muted-foreground text-xs">Hip {latest.hip_cm}cm</span>}
          {latest.blood_pressure_systolic && latest.blood_pressure_diastolic && (
            <span className="text-muted-foreground text-xs">BP {latest.blood_pressure_systolic}/{latest.blood_pressure_diastolic}</span>
          )}
          {latest.resting_heart_rate && <span className="text-muted-foreground text-xs">HR {latest.resting_heart_rate}</span>}
          <span className="text-[10px] text-muted-foreground">({latest.date})</span>
        </div>
      )}
      {!latest && <p className="text-xs text-muted-foreground italic">No measurements recorded yet.</p>}

      {/* Historical log (compact, collapsed) */}
      {log.length > 1 && (
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none list-none flex items-center gap-1">
            <span className="group-open:hidden">▶</span><span className="hidden group-open:inline">▼</span>
            <span>{log.length - 1} earlier entr{log.length - 1 !== 1 ? "ies" : "y"}</span>
          </summary>
          <div className="mt-1 pl-3 space-y-1 border-l-2" style={{ borderColor: "var(--brand-lavender, #8D99AE)" }}>
            {log.slice(1).map((e, i) => (
              <div key={i} className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
                <span className="font-medium">{e.date}</span>
                {e.weight_kg && <span>{e.weight_kg}kg</span>}
                {e.waist_cm && <span>W:{e.waist_cm}</span>}
                {e.hip_cm && <span>H:{e.hip_cm}</span>}
                {e.blood_pressure_systolic && <span>BP:{e.blood_pressure_systolic}/{e.blood_pressure_diastolic}</span>}
                {e.resting_heart_rate && <span>HR:{e.resting_heart_rate}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Add / Update button */}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] font-medium text-blue-700 hover:text-blue-900 underline"
        >
          ＋ {latest ? "Update measurements" : "Add measurements"}
        </button>
      ) : (
        <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Update measurements</span>
            <button onClick={() => setOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <label className="space-y-0.5">
              <span className="text-muted-foreground">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
            </label>
            <label className="space-y-0.5">
              <span className="text-muted-foreground">Weight (kg)</span>
              <input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 68.5"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
            </label>
            <label className="space-y-0.5">
              <span className="text-muted-foreground">Waist (cm)</span>
              <input type="number" step="0.5" value={waist} onChange={(e) => setWaist(e.target.value)} placeholder="e.g. 82"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
            </label>
            <label className="space-y-0.5">
              <span className="text-muted-foreground">Hip (cm)</span>
              <input type="number" step="0.5" value={hip} onChange={(e) => setHip(e.target.value)} placeholder="e.g. 96"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
            </label>
            <label className="space-y-0.5">
              <span className="text-muted-foreground">Height (cm)</span>
              <input type="number" step="0.5" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="e.g. 162"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
            </label>
            <label className="space-y-0.5">
              <span className="text-muted-foreground">BP Systolic</span>
              <input type="number" value={bpSys} onChange={(e) => setBpSys(e.target.value)} placeholder="e.g. 118"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
            </label>
            <label className="space-y-0.5">
              <span className="text-muted-foreground">BP Diastolic</span>
              <input type="number" value={bpDia} onChange={(e) => setBpDia(e.target.value)} placeholder="e.g. 76"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
            </label>
            <label className="space-y-0.5">
              <span className="text-muted-foreground">Heart Rate</span>
              <input type="number" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="e.g. 72"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
            </label>
          </div>
          <label className="block space-y-0.5 text-xs">
            <span className="text-muted-foreground">Notes (optional)</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Post menstruation, hydrated"
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none" />
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {success && <p className="text-xs text-emerald-700 font-medium">✅ Saved!</p>}
          <button
            onClick={handleSave}
            disabled={saving || !date}
            className="w-full text-xs font-semibold py-1.5 rounded-lg text-white disabled:opacity-50 transition-all"
            style={{ background: "var(--brand-indigo, #2B2D42)" }}
          >
            {saving ? "Saving…" : "💾 Save measurement"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── QuickNoteForm ─────────────────────────────────────────────────────────────

function QuickNoteForm({ clientId, onSaved }: { clientId: string; onSaved: (id: string) => void }) {
  const [note, setNote] = useState("");
  const [source, setSource] = useState("client_message");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    if (!note.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveSessionAction({
        client_id: clientId,
        session_type: "quick_note",
        presenting_complaints: `[source: ${source}]\n${note.trim()}`,
      });
      if (res.ok && res.session_id) {
        setNote("");
        onSaved(res.session_id);

        // Fire-and-forget AI rework assessment based on note content.
        void assessReworkBenefitAction({
          clientId,
          triggeredBy: "quick_note",
          eventSummary: `Quick note (${source}): ${note.trim().slice(0, 400)}`,
        });
      } else {
        setError(res.error ?? "Failed to save note");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium block mb-1 text-muted-foreground">What happened?</label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Client messaged — can't find amaranth leaves for Wednesday's recipe. Swapped to spinach. She'll adjust quantity."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1"
            style={{ borderColor: "var(--brand-lavender, #8D99AE)" }}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1 text-muted-foreground">Source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="client_message">Client message / WhatsApp</option>
            <option value="phone_call">Phone call</option>
            <option value="coach_observation">Coach observation</option>
            <option value="other">Other</option>
          </select>
          <button
            onClick={handleSave}
            disabled={isPending || !note.trim()}
            className="mt-2 w-full text-sm font-semibold px-4 py-2 rounded-lg text-white transition-all disabled:opacity-50"
            style={{ background: "var(--brand-indigo, #2B2D42)" }}
          >
            {isPending ? "Saving…" : "📌 Save note"}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-muted-foreground">
        Quick notes appear in the session history and are visible in future AI analyses. They do not trigger a new session.
      </p>
    </div>
  );
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
  defaultSessionType,
}: ClientTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab ?? "overview");
  const [sessionType, setSessionType] = useState<SessionType>(defaultSessionType ?? "intake");
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [briefSessionId, setBriefSessionId] = useState<string | null>(null);
  const [followUpOpenFor, setFollowUpOpenFor] = useState<string | null>(null);
  const [followUpSlug, setFollowUpSlug] = useState("");
  const [followUpWeeks, setFollowUpWeeks] = useState("");
  const [followUpGenerating, setFollowUpGenerating] = useState(false);
  const [followUpResult, setFollowUpResult] = useState<{ ok: boolean; newSlug?: string; summary?: string; error?: string } | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const m = client.measurements as Record<string, unknown> | undefined;
  const measurementsLog = (client.measurements_log ?? []) as MeasurementEntry[];
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Workflow stage ─────────────────────────────────────────────────────────
  const activePlan = plans.find((p) =>
    ["draft", "ready_to_publish", "published"].includes(p.status ?? p._bucket ?? "")
  );
  const activePlanStatus = activePlan ? (activePlan.status ?? activePlan._bucket ?? "draft") : null;
  const recheckDue = activePlan?.plan_period_recheck_date
    ? activePlan.plan_period_recheck_date < todayStr
    : false;
  const workflowStage: "no_plan" | "draft" | "active" | "recheck" =
    !activePlan ? "no_plan"
    : (activePlanStatus === "published" && recheckDue) ? "recheck"
    : activePlanStatus === "published" ? "active"
    : "draft";

  // Inline activate plan handler (submit + publish in one click)
  async function handleActivate(planSlug: string) {
    setIsActivating(true);
    try {
      const sub = await submitPlan(planSlug, "Activated from client page");
      if (!sub.ok) { toast.error(sub.error ?? "Plan check failed — open the plan editor to fix errors"); setIsActivating(false); return; }
      const pub = await publishPlan(planSlug, "Activated from client page");
      if (!pub.ok) { toast.error(pub.error ?? "Activation failed"); setIsActivating(false); return; }
      toast.success("✅ Plan activated!");
      router.refresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setIsActivating(false);
    }
  }

  // Derive pending labs
  const pendingLabsInfo = (() => {
    const labIdx = sessions.findIndex((s) => s.requested_labs.length > 0);
    if (labIdx === -1) return null;
    const hasSessionAfter = sessions.slice(0, labIdx).some((s) => s.session_type === "intake");
    if (hasSessionAfter) return null;
    return sessions[labIdx];
  })();

  // ── Next Step computation ─────────────────────────────────────────────────
  const nextStep = (() => {
    if (workflowStage === "recheck") return {
      icon: "🔄", color: "#6C5CE7", bg: "#F4F0FF", borderColor: "#6C5CE7",
      title: `Recheck was due ${activePlan?.plan_period_recheck_date ?? "—"}`,
      detail: "Review what changed, assess progress, and build a follow-up phase plan.",
      action: "🔬 Run new analysis →",
      onAction: () => { setActiveTab("sessions"); setSessionType("intake"); setSavedSessionId(null); },
    };
    if (workflowStage === "active") return {
      icon: "✅", color: "#059669", bg: "#F0FAF5", borderColor: "#7BBF9A",
      title: "Plan is live",
      detail: activePlan?.plan_period_recheck_date
        ? `Recheck ${activePlan.plan_period_recheck_date} · Generate client letters while the plan runs.`
        : "Generate and send the meal plan, supplement guide, and lifestyle letter.",
      action: "📤 Generate letters →",
      onAction: () => setActiveTab("plan"),
    };
    if (workflowStage === "draft") return {
      icon: "✏️", color: "#B45309", bg: "#FFFBEB", borderColor: "#D97706",
      title: "Draft plan ready — complete the protocol",
      detail: "Fill in supplements, lifestyle practices, and nutrition. Then activate to make it live.",
      action: "📋 Go to Plan →",
      onAction: () => setActiveTab("plan"),
    };
    // no_plan — differentiate by whether an analysis exists
    if (sessions.length > 0) return {
      icon: "🧬", color: "#2563EB", bg: "#EFF6FF", borderColor: "#93C5FD",
      title: "Analysis done — generate a draft plan",
      detail: `${sessions.length} session${sessions.length !== 1 ? "s" : ""} recorded. Use the analysis to create a personalised plan.`,
      action: "📋 Go to Plan →",
      onAction: () => setActiveTab("plan"),
    };
    return {
      icon: "📋", color: "var(--brand-indigo)", bg: "#FEF9F5", borderColor: "#E8A87C",
      title: "Start with a full analysis session",
      detail: "Upload transcripts, lab reports, or food journals. AI analyses root causes and generates a personalised protocol.",
      action: "🔬 Start analysis →",
      onAction: () => { setActiveTab("sessions"); setSessionType("intake"); setSavedSessionId(null); },
    };
  })();

  return (
    <div className="space-y-4">
      {/* ── Next Step command bar ── */}
      <div
        className="rounded-xl border-2 px-4 py-3 flex items-center gap-3 flex-wrap"
        style={{ borderColor: nextStep.borderColor, background: nextStep.bg }}
      >
        <span className="text-xl shrink-0">{nextStep.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: nextStep.color }}>{nextStep.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{nextStep.detail}</p>
        </div>
        <button
          onClick={nextStep.onAction}
          className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg text-white transition-colors hover:opacity-90"
          style={{ background: nextStep.color }}
        >
          {nextStep.action}
        </button>
      </div>

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
            {t.key === "sessions" && sessions.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                {sessions.length}
              </Badge>
            )}
            {t.key === "sessions" && pendingLabsInfo != null && (
              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0 rounded-full bg-[#D6A2A2]/30 text-[#7A3D3D]">
                🧪
              </span>
            )}
            {t.key === "plan" && workflowStage === "draft" && (
              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0 rounded-full bg-amber-100 text-amber-800">!</span>
            )}
            {t.key === "plan" && workflowStage === "active" && (
              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0 rounded-full bg-emerald-100 text-emerald-800">→</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
           OVERVIEW TAB
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* AI plan rework suggestion (only shows when benefit_pct >= 30 and not dismissed/snoozed) */}
          <ReworkBanner clientId={clientId} suggestion={client.rework_suggestion ?? null} />

          {/* Quick snapshot card */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start gap-3 mb-3">
                <ClientAvatar
                  clientId={clientId}
                  displayName={client.display_name ?? undefined}
                  size={52}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-base leading-tight">{client.display_name ?? clientId}</p>
                  <p className="text-xs text-muted-foreground">{clientId}</p>
                </div>
              </div>
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

          {/* Active plan quick-access */}
          {(() => {
            const ap = plans.find((p) =>
              ["draft", "ready_to_publish", "published"].includes(p.status ?? p._bucket ?? "")
            );
            if (!ap) return null;
            const st = ap.status ?? ap._bucket ?? "draft";
            const dot = st === "published" ? "🟢" : st === "ready_to_publish" ? "🔵" : "🟡";
            return (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 text-sm flex-wrap" style={{ borderColor: "var(--brand-indigo, #2B2D42)", background: "var(--brand-bone, #FAF8F5)" }}>
                <span className="text-base">{dot}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold" style={{ color: "var(--brand-indigo, #2B2D42)" }}>Active plan: </span>
                  <Link href={`/plans/${ap.slug}`} className="font-mono text-xs hover:underline" style={{ color: "var(--brand-indigo, #2B2D42)" }}>
                    {ap.slug}
                  </Link>
                  {ap.plan_period_recheck_date && (
                    <span className="ml-2 text-xs text-muted-foreground">· recheck {ap.plan_period_recheck_date}</span>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/plans/${ap.slug}`}>
                    <button className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-all hover:opacity-90" style={{ background: "var(--brand-indigo, #2B2D42)" }}>
                      🗂 Open plan
                    </button>
                  </Link>
                  <button
                    onClick={() => { setActiveTab("sessions"); setSessionType("check_in"); setSavedSessionId(null); }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all hover:bg-muted"
                  >
                    💬 Log check-in
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Action bar */}
          <div className="flex flex-wrap gap-3 p-4 rounded-lg border bg-muted/30">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Quick actions</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                <strong>Analyse</strong> — record interactions, upload labs, and run AI analysis.{" "}
                <strong>Plan</strong> — view, edit, activate the protocol and generate client letters.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center shrink-0">
              <button
                onClick={() => { setActiveTab("sessions"); setSessionType("intake"); setSavedSessionId(null); }}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
              >
                📋 New session
              </button>
              {plans.some((p) =>
                ["draft", "ready_to_publish", "published"].includes(p.status ?? p._bucket ?? "")
              ) ? (
                <div className="relative group">
                  <button
                    disabled
                    className="inline-flex items-center gap-1 rounded-md border bg-muted px-3 py-2 text-sm font-medium text-muted-foreground cursor-not-allowed opacity-60"
                    title="Close or revoke the active plan before creating a new one"
                  >
                    ＋ New plan
                  </button>
                  <div className="absolute right-0 top-full mt-1 z-10 hidden group-hover:block w-64 rounded-md border bg-popover p-3 text-xs text-muted-foreground shadow-lg">
                    This client already has an active plan. Revoke or close it before starting a new protocol.
                  </div>
                </div>
              ) : (
                <Link href={`/plans/new?client=${clientId}`}>
                  <button className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted">
                    ＋ New plan
                  </button>
                </Link>
              )}
              <DeleteClientButton clientId={clientId} />
            </div>
          </div>

          {/* Quick-capture panels — transcript / labs / message / protocol check-in / send message */}
          <div className="flex flex-wrap gap-2">
            <TranscriptUpdatePanel clientId={clientId} />
            <LabUploadPanel clientId={clientId} />
            <MessageCapturePanel clientId={clientId} />
            <ProtocolCheckinPanel
              clientId={clientId}
              planSlug={plans.find((p) => (p.status ?? p._bucket) === "published")?.slug}
              onSaved={(id) => setSavedSessionId(id)}
            />
          </div>

          {/* 📋 SOAP note — most recent intake in standard medical format (printable) */}
          <SOAPNotePanel
            client={client as Record<string, unknown>}
            clientName={client.display_name ?? clientId}
            clientId={clientId}
            sessions={sessions}
          />

          {/* 🤰 Pregnancy / lactation safety overlay (renders only when status active) */}
          <PregnancySafetyPanel clientId={clientId} />

          {/* 💊 Drug-nutrient depletion auto-flag (renders only when meds match catalogue) */}
          <MedicationImpactPanel clientId={clientId} />

          {/* 🧪 Functional test PDFs — DUTCH / GI-MAP / OAT */}
          <FunctionalTestPanel clientId={clientId} />

          {/* 🧬 Genetic / SNP reports — MTHFR / COMT / APOE etc. */}
          <GeneticReportPanel clientId={clientId} />

          {/* 📁 Other / specialist reports — endoscopy, imaging, anything else.
              All client document uploads live on the Overview tab. */}
          <details className="rounded-lg border bg-card open:shadow-sm" open={false}>
            <summary className="cursor-pointer select-none list-none px-4 py-3 text-sm font-semibold flex items-center gap-2 hover:bg-muted/30">
              <span className="transition-transform group-open:rotate-90 text-xs">▶</span>
              📁 Other reports & specialist uploads
              <span className="ml-auto text-[10px] text-muted-foreground font-normal">endoscopy · imaging · anything else</span>
            </summary>
            <div className="border-t p-3">
              <ReportsTab clientId={clientId} />
            </div>
          </details>

          {/* Message templates — WhatsApp pre-written templates */}
          <MessageTemplatesPanel
            clientId={clientId}
            clientName={(client as Record<string, unknown>).display_name as string ?? clientId}
            clientPhone={(client as Record<string, unknown>).mobile_number as string | undefined}
            clientEmail={(client as Record<string, unknown>).email as string | undefined}
          />

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
                {/* Measurements time-series widget */}
                <div>
                  <div className="text-xs uppercase text-muted-foreground mb-1.5">Measurements</div>
                  <MeasurementsWidget
                    clientId={clientId}
                    log={measurementsLog}
                    todayStr={todayStr}
                  />
                </div>
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
                    <ul className="list-disc list-inside">{meds.map((med, i) => <li key={i}>{med}</li>)}</ul>
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

          {/* IFM Timeline (Antecedents / Triggers / Mediators).
              Prefers ai_timeline from the most recent intake session if available;
              falls back to heuristic classification of raw client.timeline_events. */}
          <IFMTimelineCard
            events={client.timeline_events}
            dateOfBirth={(client as { date_of_birth?: string }).date_of_birth}
            aiTimeline={(() => {
              const latestIntakeWithTimeline = sessions.find(
                (s) => s.session_type === "intake" && s.ifm_timeline && s.ifm_timeline.length > 0
              );
              return latestIntakeWithTimeline?.ifm_timeline;
            })()}
          />

          {/* Timeline — add events post-intake */}
          <TimelineEditor
            clientId={clientId}
            initialEvents={(client.timeline_events ?? []) as Array<{ year?: number; date?: string; event: string; category?: string }>}
          />

          {/* FM Reference Ranges */}
          <LabReferenceRangesEditor clientId={clientId} />

          {/* AI API spend tracker — hidden until at least 1 call recorded */}
          <ApiUsagePanel clientId={clientId} />

          {/* Dietary & lifestyle preferences */}
          <PreferencesEditor
            clientId={clientId}
            initial={{
              dietary_preference: (client as { dietary_preference?: string }).dietary_preference,
              foods_to_avoid: (client as { foods_to_avoid?: string }).foods_to_avoid,
              reported_triggers: (client as { reported_triggers?: string }).reported_triggers,
              non_negotiables: (client as { non_negotiables?: string }).non_negotiables,
              city: (client as { city?: string }).city,
              country: (client as { country?: string }).country,
              letter_types_active: (client as { letter_types_active?: string[] }).letter_types_active,
            }}
          />

          {/* Lab Panels */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Lab Panels</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                FM-optimal ranges · markers updated each session
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
                    onClick={() => setActiveTab("sessions")}
                    className="underline hover:text-foreground"
                  >
                    Analyse tab
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
                Send a branded email with AI-generated topic briefs — cites NHS, NIH, WHO, ICMR and other government sources.
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
                  <span className="font-medium">{assessmentTopics.length} topic{assessmentTopics.length !== 1 ? "s" : ""} from sessions pre-selected:</span>{" "}
                  {assessmentTopics.map((t) => t.label).join(", ")}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Sessions summary — brief count; full history in Sessions tab */}
          {sessions.length > 0 && (
            <button
              onClick={() => setActiveTab("sessions")}
              className="w-full text-left rounded-lg border px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <span className="text-sm font-medium">{sessions.length} analysis session{sessions.length !== 1 ? "s" : ""} recorded</span>
              <span className="ml-2 text-xs text-muted-foreground">→ view full history in Analyse tab</span>
            </button>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
           ANALYSE TAB — record sessions, run AI analysis, view history
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "sessions" && (
        <div className="space-y-6">
          {/* ── Pending labs banner ── */}
          {pendingLabsInfo && sessionType !== "discovery" && (
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
                    ({pendingLabsInfo.date ?? "—"}). Run a full session once results are in.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSessionType("intake");
                    setSavedSessionId(null);
                  }}
                  className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg transition-all hover:opacity-90"
                  style={{ background: "var(--brand-indigo)", color: "#fff" }}
                >
                  Labs received → start session
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

          {/* ── Pre-session coach brief ── */}
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-brand text-base font-bold" style={{ color: "var(--brand-indigo)" }}>
              Record &amp; Analyse
            </h3>
            <PreSessionBrief
              client={client}
              clientId={clientId}
              sessions={sessions}
              activePlanSlug={plans.find((p) => (p.status ?? p._bucket) === "published")?.slug}
              activePlanStart={plans.find((p) => (p.status ?? p._bucket) === "published")?.plan_period_start}
              activePlanRecheck={plans.find((p) => (p.status ?? p._bucket) === "published")?.plan_period_recheck_date}
              pendingLabs={pendingLabsInfo?.requested_labs}
            />
          </div>

          {/* ── Record a new session ── */}
          <div className="rounded-xl border p-5 space-y-4" style={{ background: "var(--brand-bone)" }}>
            <div>
              <p className="text-xs mt-0.5" style={{ color: "var(--brand-lavender)" }}>
                Select the interaction type. Full sessions run AI root-cause analysis.
              </p>
            </div>

            <SessionTypePicker value={sessionType} onChange={(v) => {
              setSessionType(v);
              setSavedSessionId(null);
            }} />

            <div className="border-t" />

            {savedSessionId && (
              <div className="space-y-2">
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
                {/* WhatsApp follow-up draft — skip for intake (AI assessment handles its own flow) */}
                {sessionType !== "intake" && (
                  <FollowUpDraftPanel
                    clientId={clientId}
                    sessionId={savedSessionId}
                    sessionType={sessionType}
                  />
                )}
              </div>
            )}

            {sessionType === "discovery" && (
              <DiscoveryForm
                clientId={clientId}
                clientName={client.display_name ?? undefined}
                clientSex={(client.sex as string | undefined) ?? null}
                onSaved={(id) => setSavedSessionId(id)}
              />
            )}

            {sessionType === "intake" && (
              <div className="space-y-2">
                <div
                  className="rounded-xl px-5 py-4"
                  style={{ background: "rgba(43,45,66,0.04)" }}
                >
                  <h3
                    className="font-brand text-base font-bold mb-0.5"
                    style={{ color: "var(--brand-indigo)" }}
                  >
                    📋 Intake session
                  </h3>
                  <p className="text-xs" style={{ color: "var(--brand-lavender)" }}>
                    Detailed second visit: upload labs and food journal, capture the
                    full FM timeline, symptoms, and Five Pillars. The AI assessment
                    runs on this data and stores results on the same session.
                  </p>
                </div>
                <AssessClient
                  fixedClientId={clientId}
                  symptoms={symptoms}
                  topics={topics}
                  initialSessions={sessions}
                  existingFiles={uploadedFiles}
                  clientSex={(client as { sex?: string }).sex ?? null}
                  priorSnapshots={client.health_snapshots ?? []}
                  activePlan={activePlan ? {
                    slug: activePlan.slug,
                    status: activePlanStatus ?? undefined,
                    plan_period_recheck_date: activePlan.plan_period_recheck_date ?? null,
                  } : null}
                />
              </div>
            )}

            {sessionType === "check_in" && (
              <CheckInForm
                clientId={clientId}
                currentPlanSlug={plans.find((p) =>
                  (p.status ?? p._bucket) === "published"
                )?.slug}
                currentReportedTriggers={(client as { reported_triggers?: string }).reported_triggers}
                onSaved={(id) => setSavedSessionId(id)}
              />
            )}

            {sessionType === "quick_note" && (
              <QuickNoteForm
                clientId={clientId}
                onSaved={(id) => setSavedSessionId(id)}
              />
            )}
          </div>

          {/* ── Outcome progress ── */}
          {sessions.length >= 2 && (
            <OutcomeProgressCard sessions={sessions} />
          )}

          {/* ── IFM Matrix trend (last 2 intake sessions) ── */}
          {sessions.filter(s => s.session_type === "intake").length >= 2 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>🧬 IFM Matrix trend</CardTitle>
              </CardHeader>
              <CardContent>
                <IFMTrend clientId={clientId} sessions={sessions} />
              </CardContent>
            </Card>
          )}

          {/* ── Protocol adherence trend ── */}
          <ProtocolAdherenceChart sessions={sessions} />

          {/* ── Lab comparison ── */}
          {(client.health_snapshots ?? []).length >= 2 && (
            <LabComparison client={client} />
          )}

          {/* ── Session history — vertical timeline ── */}
          {sessions.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Analysis history ({sessions.length})
              </h3>

              <div className="relative">
                <div className="absolute left-[18px] top-5 bottom-5 w-px bg-border" />

                <div className="space-y-3">
                  {sessions.map((s, i) => {
                    const typeMeta = SESSION_TYPE_META[s.session_type];
                    const sid = s.session_id ?? `idx-${i}`;
                    const isExpanded = expandedSessionId === sid;

                    const summaryLine =
                      s.session_type === "intake"
                        ? (s.selected_topics ?? []).slice(0, 3).join(", ") || null
                        : s.session_type === "check_in"
                        ? (() => {
                            const cm = (s.presenting_complaints ?? "").match(/Progress:\s*([^\n]+)/);
                            return cm ? cm[1].slice(0, 80) : null;
                          })()
                        : s.session_type === "quick_note"
                        ? (s.presenting_complaints ?? "").replace(/^\[source:[^\]]+\]\s*/i, "").trim().slice(0, 100) || null
                        : s.session_type === "discovery"
                        ? (() => {
                            const cm = (s.presenting_complaints ?? "").match(/Chief complaints:\s*([^\n]+)/);
                            return cm ? cm[1].slice(0, 80) : "Discovery session";
                          })()
                        : (s.selected_symptoms ?? []).slice(0, 3).join(", ") || null;

                    const dotColor =
                      s.session_type === "intake"    ? "#2B2D42"
                      : s.session_type === "discovery" ? "#A8C5A0"
                      : s.session_type === "check_in"  ? "#8D99AE"
                      :                                  "#E8A87C";

                    return (
                      <div key={sid} className="relative flex gap-4 pl-10">
                        <div
                          className="absolute left-3 top-3.5 w-3 h-3 rounded-full border-2 border-background shrink-0 z-10"
                          style={{ background: dotColor, boxShadow: "0 0 0 2px #e2e8f0" }}
                        />

                        <button
                          className="w-full text-left rounded-xl border bg-card px-4 py-3 hover:shadow-sm transition-all focus:outline-none focus-visible:ring-2"
                          onClick={() => setExpandedSessionId(isExpanded ? null : sid)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeMeta.pill}`}>
                                {typeMeta.icon} {typeMeta.label}
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {s.date ?? "—"}
                              </span>
                              {s.requested_labs.length > 0 && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                                  🧪 {s.requested_labs.length} lab{s.requested_labs.length !== 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                              {isExpanded ? "▲" : "▼"}
                            </span>
                          </div>

                          {(s.driver_count > 0 || s.supplement_count > 0 || s.generated_plan_slug) && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {s.driver_count > 0 && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#2B2D42]/8 text-[#2B2D42]">
                                  🔍 {s.driver_count} driver{s.driver_count !== 1 ? "s" : ""}
                                </span>
                              )}
                              {s.supplement_count > 0 && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800">
                                  💊 {s.supplement_count} supp{s.supplement_count !== 1 ? "s" : ""}
                                </span>
                              )}
                              {s.generated_plan_slug && (
                                <Link
                                  href={`/plans/${s.generated_plan_slug}`}
                                  className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 hover:bg-blue-100 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  📋 {s.generated_plan_slug}
                                </Link>
                              )}
                            </div>
                          )}

                          {summaryLine && !isExpanded && (
                            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                              {summaryLine}
                              {(s.session_type === "intake" && (s.selected_topics ?? []).length > 3) ||
                               (s.session_type === "discovery" && (s.selected_symptoms ?? []).length > 3)
                                ? " …" : ""}
                            </p>
                          )}

                          {isExpanded && (
                            <div className="mt-3 pt-3 border-t space-y-3 text-xs text-left">
                              {(s.selected_topics ?? []).length > 0 && (
                                <div>
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Topics: </span>
                                  <span className="text-muted-foreground">{(s.selected_topics ?? []).join(", ")}</span>
                                </div>
                              )}
                              {(s.selected_symptoms ?? []).length > 0 && (
                                <div>
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Symptoms: </span>
                                  <span className="text-muted-foreground">{(s.selected_symptoms ?? []).join(", ")}</span>
                                </div>
                              )}
                              {s.presenting_complaints && (
                                <div className="rounded-md border bg-background p-2.5 text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                  {s.presenting_complaints.slice(0, 600)}
                                  {s.presenting_complaints.length > 600 && "…"}
                                </div>
                              )}
                              {s.synthesis_notes && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">AI analysis</div>
                                  <p className="italic text-muted-foreground leading-relaxed">{s.synthesis_notes}</p>
                                </div>
                              )}
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
                              {/* Export brief button */}
                              <div className="pt-1 flex justify-end">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBriefSessionId(sid);
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 transition-all"
                                  style={{ color: "#2B2D42" }}
                                >
                                  📄 Brief
                                </button>
                              </div>
                            </div>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Health trends ── */}
          {(client.health_snapshots ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>📈 Health trends</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(client.health_snapshots ?? []).length} snapshot{(client.health_snapshots ?? []).length !== 1 ? "s" : ""} across sessions
                </p>
              </CardHeader>
              <CardContent>
                <HealthTrends client={client} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
           PLAN TAB — plan status, edit, activate, + client letter generation
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "plan" && (
        <div className="space-y-4">
          {/* Plan tab purpose — clarified for new coaches at a glance */}
          <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2.5 py-0.5">
            Active plan status · edit the protocol · activate when ready · generate &amp; share client letters · review older plans.
          </p>
          {workflowStage === "no_plan" ? (
            /* ── No plan ── */
            <Card>
              <CardContent className="pt-8 pb-8 flex flex-col items-center text-center gap-5">
                <div className="text-4xl">📋</div>
                <div>
                  <p className="text-base font-semibold">No active plan yet</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                    Record a full session first — AI analyses root causes and auto-generates a draft plan you can then fill in and activate.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 justify-center">
                  <button
                    onClick={() => { setActiveTab("sessions"); setSessionType("intake"); setSavedSessionId(null); }}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
                    style={{ background: "var(--brand-indigo)" }}
                  >
                    📋 Start a session
                  </button>
                  <Link href={`/plans/new?client=${clientId}`}>
                    <button className="px-5 py-2.5 rounded-lg text-sm font-semibold border hover:bg-muted">
                      ＋ Create plan manually
                    </button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : activePlan ? (
            /* ── Plan exists ── */
            <div className="space-y-4">
              {/* Plan header card */}
              <div className="rounded-xl border-2 p-5 space-y-4" style={{ borderColor: "var(--brand-indigo, #2B2D42)", background: "var(--brand-bone, #FAF8F5)" }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg">{activePlanStatus === "published" ? "🟢" : "🟡"}</span>
                      <span className="font-semibold text-base" style={{ color: "var(--brand-indigo)" }}>
                        {activePlanStatus === "published" ? "Active plan" : "Draft plan"}
                      </span>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                        activePlanStatus === "published"        ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                        activePlanStatus === "ready_to_publish" ? "bg-blue-100 text-blue-800 border-blue-200" :
                                                                  "bg-amber-50 text-amber-800 border-amber-200"
                      }`}>
                        {(activePlanStatus ?? "draft").replace(/_/g, " ")}
                      </span>
                      {activePlan.version && activePlan.version > 1 && (
                        <span className="text-[11px] text-muted-foreground">v{activePlan.version}</span>
                      )}
                    </div>
                    <p className="text-xs font-mono mt-1 text-muted-foreground">{activePlan.slug}</p>
                    {activePlan.plan_period_start && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Started {activePlan.plan_period_start}
                        {activePlan.plan_period_recheck_date ? ` · recheck ${activePlan.plan_period_recheck_date}` : ""}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-3">
                  <Link href={`/plans/${activePlan.slug}`}>
                    <button className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold border hover:bg-muted transition-all">
                      ✏️ {activePlanStatus === "published" ? "View plan" : "Edit plan"}
                    </button>
                  </Link>

                  {activePlanStatus !== "published" && (
                    <button
                      onClick={() => handleActivate(activePlan.slug)}
                      disabled={isActivating}
                      className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50"
                      style={{ background: "var(--brand-indigo)" }}
                    >
                      {isActivating ? (
                        <><span className="animate-spin inline-block text-base">⏳</span> Activating…</>
                      ) : "🚀 Activate plan"}
                    </button>
                  )}

                  {activePlanStatus === "published" && (
                    <button
                      onClick={() => { setActiveTab("sessions"); setSessionType("check_in"); setSavedSessionId(null); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-5 py-2.5 text-sm font-semibold hover:bg-muted transition-all"
                    >
                      💬 Log check-in
                    </button>
                  )}
                </div>

                {activePlanStatus !== "published" && (
                  <p className="text-xs text-muted-foreground border-t pt-3">
                    ✏️ Fill the protocol in the plan editor (supplements, lifestyle, nutrition, labs), then click <strong>Activate</strong> to mark it live.
                  </p>
                )}
              </div>

              {/* ── Letter generation — visible for ALL plan states.
                  Draft + ready: preview letters before activating; once activated,
                  the same letters re-render against the locked catalogue snapshot.
                  Published: ready to send. ── */}
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">📤 Client letters</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generate meal plan, supplement guide, lifestyle guide, and exercise plan — review, edit if needed, then download or send.
                  </p>
                  {activePlanStatus !== "published" && (
                    <p className="mt-1.5 text-xs rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">
                      💡 Plan is still <strong>{(activePlanStatus ?? "draft").replace(/_/g, " ")}</strong>.
                      You can preview letters here, but activate first to lock the version + catalogue snapshot.
                    </p>
                  )}
                </div>
                <SendPackageButton
                  planSlug={activePlan.slug}
                  clientId={clientId}
                  clientEmail={client.email as string | undefined}
                  clientName={(client.display_name ?? client.client_id) as string | undefined}
                />
              </div>

              {/* Follow-up plan generator — published plans only */}
              {activePlanStatus === "published" && (
                <div className="rounded-xl border px-5 py-4 bg-muted/10">
                  {followUpOpenFor !== activePlan.slug ? (
                    <button
                      onClick={() => {
                        setFollowUpOpenFor(activePlan.slug);
                        setFollowUpResult(null);
                        const baseSlug = activePlan.slug.replace(/-phase(\d+)$/, (_, n) => `-phase${parseInt(n) + 1}`);
                        setFollowUpSlug(baseSlug === activePlan.slug ? `${activePlan.slug}-phase2` : baseSlug);
                        setFollowUpWeeks("");
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 transition-all"
                    >
                      🔄 Generate AI follow-up plan for next phase
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold" style={{ color: "var(--brand-indigo)" }}>🔄 Generate follow-up plan</p>
                        <button onClick={() => { setFollowUpOpenFor(null); setFollowUpResult(null); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                      </div>
                      <p className="text-xs text-muted-foreground">AI reads the previous plan + check-in notes and generates an adjusted protocol — graduated doses, updated lifestyle, refined nutrition.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">New plan slug</label>
                          <input type="text" value={followUpSlug} onChange={(e) => setFollowUpSlug(e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                            placeholder="e.g. shivani-plan-1-phase2-cl-001" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Phase weeks (e.g. 3–8)</label>
                          <input type="text" value={followUpWeeks} onChange={(e) => setFollowUpWeeks(e.target.value)}
                            placeholder="e.g. 3-8" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none" />
                        </div>
                      </div>
                      {followUpResult && !followUpResult.ok && (
                        <p className="text-xs text-red-700 rounded-md border border-red-200 bg-red-50 px-3 py-2">❌ {followUpResult.error}</p>
                      )}
                      {followUpResult?.ok && followUpResult.newSlug && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1.5">
                          <p className="text-sm font-semibold text-emerald-800">✅ Follow-up plan created!</p>
                          {followUpResult.summary && <p className="text-xs text-emerald-700 leading-relaxed">{followUpResult.summary}</p>}
                          <Link href={`/plans/${followUpResult.newSlug}`} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-900 underline hover:no-underline">
                            Open {followUpResult.newSlug} →
                          </Link>
                        </div>
                      )}
                      {!followUpResult?.ok && (
                        <button
                          onClick={async () => {
                            if (!followUpSlug.trim()) { toast.error("Enter a new plan slug"); return; }
                            setFollowUpGenerating(true);
                            setFollowUpResult(null);
                            try {
                              const r = await generateFollowUpPlan(activePlan.slug, followUpSlug, followUpWeeks || "next phase", clientId);
                              setFollowUpResult({ ok: r.ok, newSlug: r.newSlug, summary: r.adjustmentSummary, error: r.error });
                              if (r.ok) toast.success(`Follow-up plan created: ${r.newSlug}`);
                              else toast.error(r.error ?? "Generation failed");
                            } finally { setFollowUpGenerating(false); }
                          }}
                          disabled={followUpGenerating || !followUpSlug.trim()}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
                          style={{ background: "var(--brand-indigo, #2B2D42)" }}
                        >
                          {followUpGenerating ? <><span className="animate-spin inline-block">⏳</span> Generating (~60s)…</> : <>🤖 Generate follow-up plan</>}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Older / archived plans */}
              {plans.filter((p) => !["draft", "ready_to_publish", "published"].includes(p.status ?? p._bucket ?? "")).length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none list-none flex items-center gap-1">
                    <span className="group-open:hidden">▶</span><span className="hidden group-open:inline">▼</span>
                    <span>{plans.filter((p) => !["draft", "ready_to_publish", "published"].includes(p.status ?? p._bucket ?? "")).length} archived / previous plan(s)</span>
                  </summary>
                  <div className="mt-3 space-y-2">
                    {plans.filter((p) => !["draft", "ready_to_publish", "published"].includes(p.status ?? p._bucket ?? "")).map((p) => (
                      <div key={p.slug} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-muted/20">
                        <Link href={`/plans/${p.slug}`} className="font-mono text-xs hover:underline flex-1">{p.slug}</Link>
                        <span className="text-[10px] text-muted-foreground px-2 py-0.5 rounded border bg-background">{(p.status ?? p._bucket ?? "").replace(/_/g, " ")}</span>
                        {p.plan_period_start && <span className="text-[10px] text-muted-foreground hidden sm:inline">{p.plan_period_start}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : null}
          {/* External reports moved to Overview tab — they're about client
              uploads, not about the active plan. */}
        </div>
      )}

      {/* ── Session brief modal ── */}
      {briefSessionId && (() => {
        const briefSession = sessions.find((s, i) => (s.session_id ?? `idx-${i}`) === briefSessionId);
        if (!briefSession) return null;
        return (
          <SessionBriefModal
            session={briefSession}
            clientName={client.display_name ?? clientId}
            clientAgeBand={client.age_band ?? null}
            clientSex={client.sex ?? null}
            clientConditions={client.active_conditions ?? []}
            clientMedications={client.current_medications ?? client.medications ?? []}
            clientId={clientId}
            beightonSelfScore={
              (client as unknown as { beighton_self_score?: string[] }).beighton_self_score
            }
            beightonLastVerifiedAt={(() => {
              const findings =
                ((client as unknown as { physical_exam_findings?: Array<{ kind: string; assessed_at: string }> })
                  .physical_exam_findings) ?? [];
              const latest = findings
                .filter((f) => f.kind === "beighton")
                .sort((a, b) => (b.assessed_at ?? "").localeCompare(a.assessed_at ?? ""))[0];
              return latest?.assessed_at ?? null;
            })()}
            leanTestSymptomsSelfReport={
              (client as unknown as { lean_test_symptoms?: string[] }).lean_test_symptoms
            }
            leanTestLastVerifiedAt={(() => {
              const findings =
                ((client as unknown as { physical_exam_findings?: Array<{ kind: string; assessed_at: string }> })
                  .physical_exam_findings) ?? [];
              const latest = findings
                .filter((f) => f.kind === "nasa_lean_test")
                .sort((a, b) => (b.assessed_at ?? "").localeCompare(a.assessed_at ?? ""))[0];
              return latest?.assessed_at ?? null;
            })()}
            onClose={() => setBriefSessionId(null)}
          />
        );
      })()}
    </div>
  );
}
