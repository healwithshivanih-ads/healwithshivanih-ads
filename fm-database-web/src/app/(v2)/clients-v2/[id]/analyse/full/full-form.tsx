"use client";

/**
 * Full Assessment v2 — delta-from-intake form.
 *
 * Design principle: intake is where heavy data capture happens. Full
 * Assessment is the synthesis pass — it should READ what's already on
 * the client (intake fields, body comp, FM body-systems review, food
 * prefs, FM timeline, prior labs / reports / messages) and only ask the
 * coach for the delta.
 *
 * Sections:
 *   1. Intake recap (read-only, with "Edit on intake" link)
 *   2. Symptoms + conditions to focus on — pre-loaded from latest intake
 *      session's selections (coach can prune / add)
 *   3. What's new since intake (textarea + new-report upload)
 *   4. Prior protocol review (only if a prior plan / assessment exists)
 *   5. Analyze button → AI synthesis
 *   6. After analyze: SuggestionsView + Chat + PlanBriefCard + Generate
 *      draft (all imported from legacy assess-client)
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  runAssessAction,
  generateDraftAction,
  loadLatestSynthesisAction,
  autoRouteUploadedReportAction,
  type SessionSummary,
} from "@/lib/server-actions/assess";
import { uploadClientFile } from "@/lib/fmdb/upload-client-file";
import {
  listClientFilesAction,
  resolveClientFileAction,
} from "@/lib/server-actions/clients";
import type { AssessResult, PlanBrief } from "@/lib/fmdb/anthropic-types";
import {
  SuggestionsView,
  ChatPanel,
  ComputedRatiosCard,
  PlanBriefCard,
} from "@/components/assess/assess-client";
import { FmPanel, FmCollapsibleStep } from "@/components/fm";
import { TriadDetectionBanner } from "@/components/assess/triad-detection-banner";

interface IntakeSnapshot {
  chief_complaint?: string;
  conditions: string[];
  medications: string[];
  allergies: string[];
  goals: string[];
  medical_history: string[];
  body_comp: {
    height_cm?: number;
    weight_kg?: number;
    bmi?: number;
    bp_systolic?: number;
    bp_diastolic?: number;
    hr_bpm?: number;
    waist_cm?: number;
    hip_cm?: number;
  };
  fm_body_systems: {
    digestion_notes?: string;
    sleep_notes?: string;
    energy_pattern?: string;
    stress_response?: string;
    menstrual_notes?: string;
    childhood_history?: string;
    toxic_exposures?: string;
  };
  food_prefs: {
    dietary_preference?: string;
    foods_to_avoid?: string;
    non_negotiables?: string;
    reported_triggers?: string;
  };
  family_history?: string;
  timeline_count: number;
  /** Most recent intake session id + date (for the "Edit on intake" link). */
  intake_session_id?: string;
  intake_date?: string;
}

interface CatalogueOption {
  slug: string;
  label: string;
}

export interface FullAssessmentFormProps {
  clientId: string;
  displayName: string;
  intake: IntakeSnapshot;
  /** Slugs pre-selected from most recent intake's symptoms / topics. */
  prefilledSymptoms: string[];
  prefilledTopics: string[];
  /** Full catalogue for adding more. */
  symptomCatalogue: CatalogueOption[];
  topicCatalogue: CatalogueOption[];
  /** Prior full assessments (for repeat-assessment outcomes capture). */
  priorAssessments: Array<{ session_id: string; date: string }>;
  /** Active plan slug + status, if any. */
  activePlan: { slug: string; status: string } | null;
  /** Recent prior sessions — informs the "since intake" framing. */
  recentSessions: SessionSummary[];
  /**
   * v0.75.4 — raw fields the TriadDetectionBanner consumes. Plumbed
   * separately from `intake` (which is the read-only recap) so the
   * banner can compute MCAS-POTS-EDS pattern detection without further
   * server calls.
   */
  triadSignals?: {
    histamine_signals?: string[];
    beighton_self_score?: string[];
    lean_test_symptoms?: string[];
    pem_screen?: string[];
    mould_exposure?: string[];
    physical_exam_findings?: Array<{
      kind: string;
      assessed_at?: string;
      result?: Record<string, unknown>;
    }>;
  };
}

function Chip({ children, color = "var(--fm-text-secondary)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        background: "var(--fm-bg-cool)",
        color,
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-pill)",
        fontSize: 11,
        fontWeight: 600,
        marginRight: 5,
        marginBottom: 5,
      }}
    >
      {children}
    </span>
  );
}

function ChipList({ items, color }: { items: string[]; color?: string }) {
  if (items.length === 0) {
    return (
      <span style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>—</span>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}>
      {items.map((s, i) => (
        <Chip key={`${s}-${i}`} color={color}>
          {s}
        </Chip>
      ))}
    </div>
  );
}

function MiniLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        fontWeight: 700,
        color: "var(--fm-text-tertiary)",
      }}
    >
      {children}
    </div>
  );
}

function MetricChip({ label, value, unit }: { label: string; value?: number; unit?: string }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "var(--fm-bg-cool)",
        borderRadius: "var(--fm-radius-sm)",
        minWidth: 80,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 700,
          color: "var(--fm-text-tertiary)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
        {value != null ? (
          <>
            {value % 1 === 0 ? value : value.toFixed(1)}
            {unit && (
              <span style={{ fontSize: 10, fontWeight: 500, marginLeft: 3 }}>
                {unit}
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 13, color: "var(--fm-text-tertiary)" }}>—</span>
        )}
      </div>
    </div>
  );
}

function SlugMultiPicker({
  label,
  selected,
  setSelected,
  options,
  placeholder,
}: {
  label: string;
  selected: string[];
  setSelected: (next: string[]) => void;
  options: CatalogueOption[];
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const selectedSet = new Set(selected);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return options
      .filter(
        (o) =>
          !selectedSet.has(o.slug) &&
          (o.slug.toLowerCase().includes(needle) ||
            o.label.toLowerCase().includes(needle)),
      )
      .slice(0, 8);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, options, selected]);

  const labelFor = (slug: string) =>
    options.find((o) => o.slug === slug)?.label ?? slug;

  return (
    <div>
      <MiniLabel>{label}</MiniLabel>
      <div style={{ display: "flex", flexWrap: "wrap", marginTop: 6, gap: 4 }}>
        {selected.length === 0 && (
          <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            (none selected)
          </span>
        )}
        {selected.map((s) => (
          <span
            key={s}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              background: "rgba(255, 107, 53, 0.10)",
              color: "var(--fm-primary)",
              borderRadius: "var(--fm-radius-pill)",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {labelFor(s)}
            <button
              type="button"
              onClick={() => setSelected(selected.filter((x) => x !== s))}
              style={{
                background: "transparent",
                border: 0,
                color: "inherit",
                cursor: "pointer",
                fontSize: 11,
                padding: 0,
              }}
              aria-label={`Remove ${labelFor(s)}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ position: "relative", marginTop: 6 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%",
            padding: "6px 10px",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontFamily: "inherit",
            background: "var(--fm-surface)",
          }}
        />
        {filtered.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 2px)",
              left: 0,
              right: 0,
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
              zIndex: 10,
            }}
          >
            {filtered.map((o) => (
              <button
                key={o.slug}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSelected([...selected, o.slug]);
                  setQ("");
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "5px 10px",
                  background: "transparent",
                  border: 0,
                  borderBottom: "1px solid var(--fm-border-light)",
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
              >
                {o.label}{" "}
                <span
                  style={{ color: "var(--fm-text-tertiary)", fontSize: 10 }}
                >
                  · {o.slug}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface UploadedFile {
  filePath: string;
  filename: string;
  mime_type: string;
  kind: "lab_report" | "food_journal";
}

export function FullAssessmentForm({
  clientId,
  displayName,
  intake,
  prefilledSymptoms,
  prefilledTopics,
  symptomCatalogue,
  topicCatalogue,
  priorAssessments,
  activePlan,
  recentSessions,
  triadSignals,
}: FullAssessmentFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftPending, startDraft] = useTransition();

  // Pre-loaded from intake; coach can prune / add.
  const [symptoms, setSymptoms] = useState<string[]>(prefilledSymptoms);
  const [topics, setTopics] = useState<string[]>(prefilledTopics);

  // Delta inputs
  const [deltaNotes, setDeltaNotes] = useState("");
  const [protocolReview, setProtocolReview] = useState("");
  const [coachObservations, setCoachObservations] = useState("");

  // New report uploads
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [uploadPending, startUpload] = useTransition();

  // Existing files already saved on this client (from prior sessions /
  // intake / lab uploads). Lets the coach re-attach without re-uploading.
  const [existingFiles, setExistingFiles] = useState<
    Array<{ filename: string; size: number; mtime: string }>
  >([]);
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [pickerPending, startPicker] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listClientFilesAction(clientId);
      if (cancelled) return;
      if (res.ok) setExistingFiles(res.files);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const attachExistingFile = (filename: string) => {
    if (uploads.some((u) => u.filename === filename)) {
      toast.info(`${filename}: already attached`);
      return;
    }
    startPicker(async () => {
      const res = await resolveClientFileAction(clientId, filename);
      if (!res.ok) {
        toast.error(`${filename}: ${res.error}`);
        return;
      }
      setUploads((prev) => {
        if (prev.some((u) => u.filename === filename)) return prev;
        return [
          ...prev,
          {
            filePath: res.filePath,
            filename,
            mime_type: res.mimeType,
            kind: "lab_report",
          },
        ];
      });
      toast.success(`Attached ${filename}`);
    });
  };

  // Result
  const [result, setResult] = useState<AssessResult | null>(null);
  const [rehydratedFrom, setRehydratedFrom] = useState<{ date?: string; createdAt?: string; planSlug?: string | null } | null>(null);
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [planBrief, setPlanBrief] = useState<PlanBrief>({});
  const [error, setError] = useState<string | null>(null);
  const [preflightBlocked, setPreflightBlocked] = useState(false);
  const [draftSignupWarning, setDraftSignupWarning] = useState<string | null>(null);
  // Freshness guard: set true when the coach clicks Generate-draft while the
  // on-screen synthesis is a REHYDRATED old run (loaded on mount, never
  // re-analysed this session). Nidhi 2026-07-07: a plan was generated off a
  // stale May "cap-test" synthesis because rehydration made the button read
  // "✓ Synthesis ready" — so the new July report never reached the plan.
  const [staleGenerateConfirm, setStaleGenerateConfirm] = useState(false);
  // Ref + freshness flag for the post-synthesis scroll. After a successful
  // run we scroll the new results into view so the coach immediately sees
  // the AI output — previously the button reset and the report rendered
  // below the fold, making it look like the click hadn't gone through.
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [justFinished, setJustFinished] = useState(false);

  // Rehydrate the most recent saved synthesis on mount. Without this,
  // every page navigation reset the button to "Run AI synthesis" even
  // when the AI had clearly already analysed this client — coach saw a
  // fresh button on Nidhi's page despite having a generated plan + full
  // ai_analysis on disk, and was about to click again and burn ~$0.20.
  useEffect(() => {
    if (!clientId || result) return;
    let cancelled = false;
    (async () => {
      const r = await loadLatestSynthesisAction(clientId);
      if (cancelled || !r.ok || !("found" in r) || !r.found || !r.ai_analysis) return;
      const ai = r.ai_analysis as Record<string, unknown>;
      // Two storage shapes have existed: ai_analysis with the suggestion
      // keys flat at the top, OR nested under ai_analysis.suggestions.
      // Detect and reconstruct an AssessResult-shaped object either way.
      const sugg = (ai.suggestions as Record<string, unknown> | undefined) ?? ai;
      const rehydrated = {
        ok: true,
        session_id: r.session_id,
        suggestions: sugg,
        computed_ratios: ai.computed_ratios,
      } as unknown as AssessResult;
      setResult(rehydrated);
      setRehydratedFrom({
        date: r.date,
        createdAt: r.created_at,
        planSlug: r.generated_plan_slug,
      });
    })();
    return () => { cancelled = true; };
    // Only run once per client. clientId is stable for a mounted page.
  }, [clientId, result]);

  // Elapsed-time tracker for the long-running Analyze call (1–5 min).
  const [analyzeStartedAt, setAnalyzeStartedAt] = useState<number | null>(null);
  const [analyzeElapsedMs, setAnalyzeElapsedMs] = useState(0);
  useEffect(() => {
    if (!pending || analyzeStartedAt === null) return;
    const id = window.setInterval(() => {
      setAnalyzeElapsedMs(Date.now() - analyzeStartedAt);
    }, 500);
    return () => window.clearInterval(id);
  }, [pending, analyzeStartedAt]);

  const isRepeatAssessment = priorAssessments.length > 0;
  const lastAssessmentDate = priorAssessments[0]?.date;

  const onUpload = (
    files: FileList | null,
    kind: "lab_report" | "food_journal",
  ) => {
    if (!files || files.length === 0) return;
    startUpload(async () => {
      for (const file of Array.from(files)) {
        try {
          const filePath = await uploadClientFile(clientId, file);
          setUploads((prev) => [
            ...prev,
            {
              filePath,
              filename: file.name,
              mime_type: file.type || "application/octet-stream",
              kind,
            },
          ]);
          toast.success(`Uploaded ${file.name}`);

          // Auto-route to the right structured pipeline so the upload
          // also persists as a parseable record (gi_map / dutch /
          // food_sensitivity / genetic / oat / lab_snapshot) — not just
          // an attached PDF. This way: (1) re-runs of synthesis next
          // week still have the findings, (2) reactive foods flow into
          // foods_to_avoid, (3) older blood reports build chronological
          // history via the lab_drawn snapshot date.
          //
          // Fire-and-forget for the food_journal kind — those aren't
          // medical reports.
          if (kind === "lab_report") {
            void (async () => {
              const route = await autoRouteUploadedReportAction(
                clientId,
                filePath,
                file.name,
                file.type || "application/pdf",
              );
              if (route.ok && route.summary) {
                toast.info(route.summary, { duration: 7000 });
              } else if (!route.ok && route.error) {
                toast.warning(
                  `Couldn't auto-parse ${file.name}: ${route.error.slice(0, 80)} — AI will still read the PDF inline.`,
                  { duration: 8000 },
                );
              }
            })();
          }
        } catch (e) {
          toast.error(`Failed: ${(e as Error).message.slice(0, 80)}`);
        }
      }
    });
  };

  const onAnalyze = (opts?: { manual?: boolean }) => {
    setError(null);
    setPreflightBlocked(false);
    // Combine delta inputs into one complaints payload for the AI.
    const complaintSections: string[] = [];
    if (deltaNotes.trim())
      complaintSections.push(`What's new since intake:\n${deltaNotes.trim()}`);
    if (coachObservations.trim())
      complaintSections.push(`Coach observations:\n${coachObservations.trim()}`);
    if (isRepeatAssessment && protocolReview.trim())
      complaintSections.push(
        `How the prior protocol went (since ${lastAssessmentDate}):\n${protocolReview.trim()}`,
      );
    const complaints = complaintSections.join("\n\n");

    // Accept if ANY signal is present: notes/uploads OR pre-loaded
    // symptoms/topics from intake OR a meaningful intake snapshot
    // (chief complaint, conditions, medications, body comp). Coach should
    // not have to re-type what the intake form already captured.
    const hasIntakeContext =
      !!intake?.chief_complaint?.trim() ||
      (intake?.conditions?.length ?? 0) > 0 ||
      (intake?.medications?.length ?? 0) > 0 ||
      (intake?.goals?.length ?? 0) > 0 ||
      !!intake?.body_comp?.weight_kg;
    const hasPickedSlugs = symptoms.length > 0 || topics.length > 0;
    if (
      !complaints &&
      uploads.length === 0 &&
      !hasPickedSlugs &&
      !hasIntakeContext
    ) {
      const msg = "Add a symptom, a note, or upload a report.";
      setError(msg);
      toast.error(msg);
      return;
    }
    // If complaints is empty but other signals exist, send a brief
    // marker so the AI knows this is an intake-driven run (no delta).
    const effectiveComplaints =
      complaints ||
      (hasPickedSlugs || hasIntakeContext
        ? "[intake-driven analysis — see attached intake snapshot + pre-loaded symptoms/topics]"
        : "");

    setAnalyzeStartedAt(Date.now());
    setAnalyzeElapsedMs(0);
    startTransition(async () => {
      try {
        const res = await runAssessAction({
          client_id: clientId,
          symptoms,
          topics,
          complaints: effectiveComplaints,
          attachments: uploads.map((u) => ({
            path: u.filePath,
            mime_type: u.mime_type,
            kind: u.kind,
          })),
          dry_run: false,
          manual_suggestions: opts?.manual,
          session_date: new Date().toISOString().slice(0, 10),
        });
        if (!res.ok) {
          setError(res.error || "Analyze failed");
          setPreflightBlocked(!!res.preflight_blocked);
          toast.error(res.error?.slice(0, 120) || "Analyze failed");
          setResult(null);
        } else {
          setResult(res);
          setPicks({});
          setJustFinished(true);
          // Fresh synthesis this session — this run reflects the latest
          // uploads/notes, so drop the "rehydrated stale" marker and
          // dismiss any pending freshness confirmation. Generate-draft
          // now proceeds without the guard.
          setRehydratedFrom(null);
          setStaleGenerateConfirm(false);
          if (opts?.manual) {
            toast.success(
              "Draft started without AI — topics carried over from your selection. Fill in the rest in the plan editor."
            );
          }
          // Bring the new synthesis into view + briefly highlight the
          // "✓ Synthesis ready" pill so the coach doesn't think their click
          // failed (the button itself sits above the results in the layout).
          setTimeout(() => {
            resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 60);
          setTimeout(() => setJustFinished(false), 6000);
          if (res.suggestions?.synthesis_notes) {
            setPlanBrief((prev) => ({
              ...prev,
              root_cause_hypothesis:
                prev.root_cause_hypothesis ||
                res.suggestions!.synthesis_notes.slice(0, 500),
            }));
          }
        }
      } catch (e) {
        const msg = (e as Error).message ?? "";
        setError(msg);
        toast.error(msg.slice(0, 120) || "Analyze failed");
      }
    });
  };

  const onGenerateDraft = (opts?: { force?: boolean; confirmStale?: boolean }) => {
    if (!result?.session_id) return;
    // Freshness guard — the synthesis on screen was rehydrated from a
    // prior saved run and has NOT been re-analysed this session. Building
    // a plan now bakes in whatever labs/notes that old run saw, silently
    // ignoring any report/intake added since. Force the coach to either
    // Re-run or explicitly acknowledge before we generate.
    if (rehydratedFrom && !opts?.confirmStale) {
      setStaleGenerateConfirm(true);
      return;
    }
    setStaleGenerateConfirm(false);
    setDraftSignupWarning(null);
    startDraft(async () => {
      try {
        const res = await generateDraftAction({
          client_id: clientId,
          session_id: result.session_id!,
          picks,
          plan_brief: Object.keys(planBrief).some(
            (k) => !!(planBrief as Record<string, unknown>)[k],
          )
            ? planBrief
            : undefined,
          force: opts?.force,
        });
        if (!res.ok) {
          toast.error(res.error || "Draft generation failed");
          if (res.needs_confirmation) {
            setDraftSignupWarning(res.error || "This client hasn't signed up yet.");
          }
        } else if (res.slug) {
          toast.success(`Draft plan created at ${res.slug}`);
          router.push(`/clients-v2/${clientId}/plan/edit/${res.slug}`);
        }
      } catch (e) {
        toast.error((e as Error).message.slice(0, 120));
      }
    });
  };

  const analyzeSecs = Math.floor(analyzeElapsedMs / 1000);
  const analyzePhase =
    analyzeSecs < 15
      ? "Building catalogue subgraph…"
      : analyzeSecs < 60
        ? "Sending to AI…"
        : analyzeSecs < 150
          ? "AI is reasoning over your client's data…"
          : analyzeSecs < 240
            ? "Still synthesizing — long history takes longer…"
            : "Almost done…";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── 1. Intake recap ─────────────────────────────────────────── */}
      <FmCollapsibleStep
        title="📋 What we already know"
        subtitle={
          intake.intake_date
            ? `Captured at intake on ${intake.intake_date}. Anything wrong → fix it on the Intake form.`
            : "No intake on record. Most of this section will be empty — run an Intake first for a richer Full Assessment."
        }
        summary={
          intake.intake_date
            ? `Intake ${intake.intake_date} · ${intake.conditions?.length ?? 0} condition${(intake.conditions?.length ?? 0) === 1 ? "" : "s"} · ${intake.medications?.length ?? 0} med${(intake.medications?.length ?? 0) === 1 ? "" : "s"}`
            : "no intake on record"
        }
        storageKey={`fm-step-intake-${clientId}`}
        rightSlot={
          intake.intake_session_id ? (
            <Link
              href={`/clients-v2/${clientId}/analyse/intake`}
              style={{
                fontSize: 11,
                color: "var(--fm-text-secondary)",
                textDecoration: "underline",
              }}
            >
              ✏️ Edit on Intake
            </Link>
          ) : (
            <Link
              href={`/clients-v2/${clientId}/analyse/intake`}
              style={{
                fontSize: 11,
                color: "var(--fm-primary)",
                fontWeight: 700,
                textDecoration: "underline",
              }}
            >
              + Run Intake first
            </Link>
          )
        }
      >
        {intake.chief_complaint && (
          <div style={{ marginBottom: 12 }}>
            <MiniLabel>Chief complaint at intake</MiniLabel>
            <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
              {intake.chief_complaint}
            </div>
          </div>
        )}

        {/* Body comp summary row */}
        <div style={{ marginBottom: 12 }}>
          <MiniLabel>Body composition</MiniLabel>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}
          >
            <MetricChip label="Wt" value={intake.body_comp.weight_kg} unit="kg" />
            <MetricChip label="Ht" value={intake.body_comp.height_cm} unit="cm" />
            <MetricChip label="BMI" value={intake.body_comp.bmi} />
            <MetricChip label="BP sys" value={intake.body_comp.bp_systolic} />
            <MetricChip label="BP dia" value={intake.body_comp.bp_diastolic} />
            <MetricChip label="HR" value={intake.body_comp.hr_bpm} unit="bpm" />
            <MetricChip label="Waist" value={intake.body_comp.waist_cm} unit="cm" />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <MiniLabel>Active conditions</MiniLabel>
            <ChipList items={intake.conditions} />
          </div>
          <div>
            <MiniLabel>Medications</MiniLabel>
            <ChipList items={intake.medications} />
          </div>
          <div>
            <MiniLabel>Allergies</MiniLabel>
            <ChipList items={intake.allergies} />
          </div>
          <div>
            <MiniLabel>Goals</MiniLabel>
            <ChipList items={intake.goals} color="var(--fm-primary)" />
          </div>
        </div>

        {/* FM body-systems compact */}
        {(intake.fm_body_systems.digestion_notes ||
          intake.fm_body_systems.sleep_notes ||
          intake.fm_body_systems.energy_pattern ||
          intake.fm_body_systems.stress_response) && (
          <details style={{ marginBottom: 10 }}>
            <summary
              style={{
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                color: "var(--fm-text-secondary)",
              }}
            >
              FM body-systems review
            </summary>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginTop: 8,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {intake.fm_body_systems.digestion_notes && (
                <div>
                  <MiniLabel>Digestion</MiniLabel>
                  {intake.fm_body_systems.digestion_notes}
                </div>
              )}
              {intake.fm_body_systems.sleep_notes && (
                <div>
                  <MiniLabel>Sleep</MiniLabel>
                  {intake.fm_body_systems.sleep_notes}
                </div>
              )}
              {intake.fm_body_systems.energy_pattern && (
                <div>
                  <MiniLabel>Energy</MiniLabel>
                  {intake.fm_body_systems.energy_pattern}
                </div>
              )}
              {intake.fm_body_systems.stress_response && (
                <div>
                  <MiniLabel>Stress response</MiniLabel>
                  {intake.fm_body_systems.stress_response}
                </div>
              )}
              {intake.fm_body_systems.menstrual_notes && (
                <div>
                  <MiniLabel>Menstrual / cycle</MiniLabel>
                  {intake.fm_body_systems.menstrual_notes}
                </div>
              )}
              {intake.fm_body_systems.childhood_history && (
                <div>
                  <MiniLabel>Childhood / early hx</MiniLabel>
                  {intake.fm_body_systems.childhood_history}
                </div>
              )}
              {intake.fm_body_systems.toxic_exposures && (
                <div>
                  <MiniLabel>Toxic exposures</MiniLabel>
                  {intake.fm_body_systems.toxic_exposures}
                </div>
              )}
            </div>
          </details>
        )}

        {(intake.food_prefs.dietary_preference ||
          intake.food_prefs.foods_to_avoid ||
          intake.food_prefs.non_negotiables) && (
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            {intake.food_prefs.dietary_preference && (
              <span style={{ marginRight: 14 }}>
                <strong>Diet:</strong> {intake.food_prefs.dietary_preference}
              </span>
            )}
            {intake.food_prefs.foods_to_avoid && (
              <span style={{ marginRight: 14 }}>
                <strong>Avoiding:</strong> {intake.food_prefs.foods_to_avoid}
              </span>
            )}
            {intake.food_prefs.non_negotiables && (
              <span>
                <strong>Non-negotiables:</strong>{" "}
                {intake.food_prefs.non_negotiables}
              </span>
            )}
          </div>
        )}

        {intake.timeline_count > 0 && (
          <div
            style={{
              fontSize: 11,
              marginTop: 10,
              color: "var(--fm-text-tertiary)",
            }}
          >
            FM timeline: {intake.timeline_count} event
            {intake.timeline_count === 1 ? "" : "s"} on file.
          </div>
        )}
      </FmCollapsibleStep>

      {/* v0.75.4 — Triad detection banner. Renders only when MCAS-POTS-
          EDS / long-COVID / mould-CIRS pattern is detected from intake
          signals. One-click adds the 4 relevant topic slugs to the AI
          context so synthesis is triad-aware instead of treating each
          finding in isolation. */}
      <TriadDetectionBanner
        histamineSignals={triadSignals?.histamine_signals}
        beightonSelfScore={triadSignals?.beighton_self_score}
        leanTestSymptoms={triadSignals?.lean_test_symptoms}
        pemScreen={triadSignals?.pem_screen}
        mouldExposure={triadSignals?.mould_exposure}
        physicalExamFindings={triadSignals?.physical_exam_findings}
        selectedTopics={topics}
        onAddTopics={(slugs) => {
          setTopics((prev) => {
            const seen = new Set(prev);
            const next = [...prev];
            for (const s of slugs) {
              if (!seen.has(s)) {
                next.push(s);
                seen.add(s);
              }
            }
            return next;
          });
          toast.success(`Added ${slugs.length} triad topic${slugs.length === 1 ? "" : "s"} to AI context`);
        }}
      />

      {/* ── 2. Symptoms + conditions to focus on ──────────────────── */}
      <FmCollapsibleStep
        title="🎯 Symptoms + conditions to focus on"
        subtitle="Pre-loaded from the most recent intake. The AI will pull the catalogue subgraph for these. Prune or add as needed."
        summary={`${symptoms.length} symptom${symptoms.length === 1 ? "" : "s"} · ${topics.length} topic${topics.length === 1 ? "" : "s"} picked`}
        storageKey={`fm-step-symptoms-${clientId}`}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <SlugMultiPicker
            label="Symptoms"
            selected={symptoms}
            setSelected={setSymptoms}
            options={symptomCatalogue}
            placeholder="Search symptoms — bloating, brain-fog, …"
          />
          <SlugMultiPicker
            label="Conditions / topics"
            selected={topics}
            setSelected={setTopics}
            options={topicCatalogue}
            placeholder="Search conditions — hashimoto, perimenopause, …"
          />
        </div>
      </FmCollapsibleStep>

      {/* ── 3. What's new since intake ──────────────────────────────── */}
      <FmCollapsibleStep
        title={
          isRepeatAssessment
            ? `📝 What's new since last assessment (${lastAssessmentDate})`
            : "📝 What's new since intake"
        }
        subtitle="New symptoms, life events, things the client reported between sessions. The AI weaves this into the synthesis."
        summary={`${deltaNotes.trim().length === 0 ? "no delta notes" : `${deltaNotes.trim().split(/\s+/).length} word${deltaNotes.trim().split(/\s+/).length === 1 ? "" : "s"} of delta`} · ${uploads.length} new report${uploads.length === 1 ? "" : "s"}`}
        storageKey={`fm-step-delta-${clientId}`}
      >
        <textarea
          value={deltaNotes}
          onChange={(e) => setDeltaNotes(e.target.value)}
          placeholder="e.g. Energy improved on protocol weeks 1–4, then dipped. New symptom: heart palpitations 2× last week. Travelled abroad → digestion off."
          rows={5}
          style={{
            width: "100%",
            padding: 10,
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
            lineHeight: 1.5,
          }}
        />

        <div style={{ marginTop: 14 }}>
          <MiniLabel>New reports (labs, functional tests, transcripts)</MiniLabel>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 6,
              alignItems: "center",
            }}
          >
            <label
              style={{
                cursor: "pointer",
                padding: "6px 12px",
                background: "var(--fm-bg-warm)",
                border: "1px dashed var(--fm-primary)",
                borderRadius: "var(--fm-radius-sm)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--fm-primary)",
              }}
            >
              + Upload report
              <input
                type="file"
                accept=".pdf,.md,.txt,.png,.jpg,.jpeg,.webp"
                multiple
                onChange={(e) => onUpload(e.target.files, "lab_report")}
                style={{ display: "none" }}
              />
            </label>
            {uploadPending && (
              <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                Uploading…
              </span>
            )}
            {uploads.map((u) => (
              <Chip key={u.filePath}>
                📎 {u.filename} ·{" "}
                {u.kind === "lab_report" ? "lab" : "food journal"}
              </Chip>
            ))}
          </div>

          {/* ── Pre-uploaded files picker ─────────────────────────── */}
          {existingFiles.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setShowExistingPicker((v) => !v)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--fm-primary)",
                  fontWeight: 600,
                }}
              >
                {showExistingPicker ? "▾" : "▸"} 📁 Or pick a transcript already on this client ({existingFiles.length})
              </button>
              {showExistingPicker && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 10,
                    background: "var(--fm-bg-warm)",
                    border: "1px solid var(--fm-border)",
                    borderRadius: "var(--fm-radius-sm)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fm-text-tertiary)",
                      marginBottom: 8,
                      lineHeight: 1.4,
                    }}
                  >
                    Re-attach a file already saved on this client (from prior intake, discovery, or report uploads). Skips the re-upload.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {(() => {
                      const transcriptLike = /\.(pdf|md|txt|png|jpe?g|webp)$/i;
                      const items = existingFiles.filter((f) => transcriptLike.test(f.filename));
                      if (items.length === 0) {
                        return (
                          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                            No transcript-compatible files on this client yet.
                          </div>
                        );
                      }
                      return items.map((f) => {
                        const isAttached = uploads.some((u) => u.filename === f.filename);
                        const mtime = new Date(f.mtime);
                        const dateStr = mtime.toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        });
                        const sizeKB = Math.max(1, Math.round(f.size / 1024));
                        return (
                          <div
                            key={f.filename}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "4px 6px",
                              background: "var(--fm-bg-card)",
                              border: "1px solid var(--fm-border)",
                              borderRadius: "var(--fm-radius-sm)",
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 500,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={f.filename}
                              >
                                {f.filename}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                                {dateStr} · {sizeKB} KB
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => attachExistingFile(f.filename)}
                              disabled={isAttached || pickerPending}
                              style={{
                                padding: "4px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                background: isAttached
                                  ? "var(--fm-bg-warm)"
                                  : "var(--fm-primary)",
                                color: isAttached ? "var(--fm-text-tertiary)" : "white",
                                border: "1px solid",
                                borderColor: isAttached
                                  ? "var(--fm-border)"
                                  : "var(--fm-primary)",
                                borderRadius: "var(--fm-radius-sm)",
                                cursor: isAttached || pickerPending ? "default" : "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isAttached ? "✓ attached" : "Use this"}
                            </button>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <MiniLabel>Coach observations from the consult (optional)</MiniLabel>
          <textarea
            value={coachObservations}
            onChange={(e) => setCoachObservations(e.target.value)}
            placeholder="e.g. Visibly fatigued today. Skin clearer than last visit. Tongue coating thick."
            rows={2}
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 12,
              fontFamily: "inherit",
              resize: "vertical",
              marginTop: 6,
              lineHeight: 1.5,
            }}
          />
        </div>
      </FmCollapsibleStep>

      {/* ── 4. Repeat assessment — prior protocol review ─────────── */}
      {isRepeatAssessment && (
        <FmCollapsibleStep
          title="🔁 How did the prior protocol go?"
          subtitle={`Prior plan: ${activePlan ? activePlan.slug : "(none active)"}${activePlan ? ` · ${activePlan.status}` : ""}. The AI uses this to weight adjustments vs restart.`}
          summary={`${protocolReview.trim().length === 0 ? "no review captured yet" : `${protocolReview.trim().split(/\s+/).length} word${protocolReview.trim().split(/\s+/).length === 1 ? "" : "s"} of protocol review`}`}
          storageKey={`fm-step-protocol-review-${clientId}`}
        >
          <textarea
            value={protocolReview}
            onChange={(e) => setProtocolReview(e.target.value)}
            placeholder="e.g. Took ashwagandha + magnesium consistently — sleep improved week 3. NAC made nausea, stopped at week 2. Movement 4×/wk holding. Stress still high — work pressure."
            rows={4}
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
          <div
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              marginTop: 6,
            }}
          >
            Tip: capture adherence per supplement / practice, what worked, what
            didn&apos;t, side-effects. The AI compares against the prior plan.
          </div>
        </FmCollapsibleStep>
      )}

      {/* ── 5. Analyze ─────────────────────────────────────────────── */}
      <div
        style={{
          padding: 16,
          background: "var(--fm-bg-warm)",
          border: "1px solid rgba(255, 107, 53, 0.25)",
          borderRadius: "var(--fm-radius-md)",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <button
          type="button"
          onClick={() => {
            // Already have a result? Scroll to it rather than re-running.
            // Re-run requires an explicit "Re-run" click via the ghost
            // button below — protects against accidental double-spend
            // (~$0.20 + 2 min each).
            if (result?.ok && !pending) {
              resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              return;
            }
            onAnalyze();
          }}
          disabled={pending}
          style={{
            background: result?.ok
              ? "var(--fm-success, #15803d)"
              : "var(--fm-primary)",
            color: "#fff",
            border: 0,
            padding: "11px 22px",
            fontSize: 14,
            fontWeight: 700,
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending
            ? `🧠 Analysing… ${analyzeSecs}s`
            : result?.ok
              ? "✓ Synthesis ready — jump to results ↓"
              : "🧠 Run AI synthesis"}
        </button>
        {result?.ok && !pending && (
          <button
            type="button"
            onClick={() => onAnalyze()}
            title="Discards the current synthesis and re-runs from scratch (~$0.20)"
            style={{
              background: "transparent",
              color: "var(--fm-text-secondary)",
              border: "1px solid var(--fm-border)",
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: "var(--fm-radius-sm)",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            🔁 Re-run
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>
            {pending
              ? analyzePhase
              : result?.ok
                ? justFinished
                  ? "✨ Just synthesised — scroll down for drivers, supplements, draft plan"
                  : "Synthesised — see results below"
                : "Ready to synthesise"}
          </div>
          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            {pending
              ? "AI calls take 1–5 minutes. Don't refresh."
              : result?.ok
                ? rehydratedFrom?.date
                  ? (() => {
                      let timePart = "";
                      if (rehydratedFrom.createdAt) {
                        try {
                          const d = new Date(rehydratedFrom.createdAt);
                          if (!Number.isNaN(d.getTime())) {
                            timePart = ` at ${d.toLocaleTimeString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              hour: "numeric",
                              minute: "2-digit",
                              hour12: true,
                            })} IST`;
                          }
                        } catch { /* ignore */ }
                      }
                      const planPart = rehydratedFrom.planSlug ? ` — generated plan ${rehydratedFrom.planSlug}` : "";
                      return `Last synthesised ${rehydratedFrom.date}${timePart}${planPart}. Hit Re-run only after adding new uploads or delta notes (~$0.20).`;
                    })()
                  : "Hit Re-run only after you've added new uploads or delta notes — every run costs ~$0.20."
                : `AI reads intake, ${recentSessions.length} prior session${recentSessions.length === 1 ? "" : "s"}, ${uploads.length} new report${uploads.length === 1 ? "" : "s"}, your delta notes. Output: drivers, supplements, draft plan.`}
          </div>
        </div>
      </div>
      {error && (
        <div
          style={{
            padding: 10,
            background: "rgba(220,38,38,0.08)",
            border: "1px solid rgba(220,38,38,0.3)",
            borderRadius: "var(--fm-radius-sm)",
            color: "#9b1c1c",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      {preflightBlocked && (
        <div
          style={{
            padding: 10,
            background: "rgba(220,38,38,0.04)",
            border: "1px solid rgba(220,38,38,0.15)",
            borderRadius: "var(--fm-radius-sm)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => onAnalyze({ manual: true })}
            disabled={pending}
            style={{
              background: "#fff",
              color: "var(--fm-text-primary)",
              border: "1px solid var(--fm-border)",
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 700,
              borderRadius: "var(--fm-radius-sm)",
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            ✍️ Skip AI — draft manually
          </button>
          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            No API call is made — a session is created from your symptom/topic
            picks (topics carry straight into the draft plan), and you fill in
            drivers, supplements, nutrition and everything else in the plan editor.
          </div>
        </div>
      )}

      {/* ── 6. Results ─────────────────────────────────────────────── */}
      {result?.ok && result.suggestions && (
        <div ref={resultRef} style={{ scrollMarginTop: 90 }}>
          {justFinished && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(21,128,61,0.10)",
                border: "1px solid rgba(21,128,61,0.35)",
                borderRadius: "var(--fm-radius-sm)",
                color: "#14532d",
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 10,
              }}
            >
              ✓ Synthesis complete. Review the AI&apos;s findings below.
            </div>
          )}
          {result.computed_ratios && result.computed_ratios.length > 0 && (
            <ComputedRatiosCard ratios={result.computed_ratios} />
          )}

          <FmPanel
            title="✨ AI suggestions"
            subtitle="Review each item. Untick to exclude before draft generation."
          >
            <SuggestionsView
              suggestions={result.suggestions}
              picks={picks}
              setPicks={setPicks}
              selectedTopics={topics}
              computedRatios={result.computed_ratios}
              priorSession={
                recentSessions.length > 0
                  ? {
                      date: recentSessions[0].date,
                      selected_symptoms: recentSessions[0].selected_symptoms,
                      five_pillars: recentSessions[0].five_pillars,
                    }
                  : undefined
              }
              currentSymptoms={symptoms}
            />
          </FmPanel>

          <PlanBriefCard
            brief={planBrief}
            onChange={setPlanBrief}
            synthesisNotes={result.suggestions.synthesis_notes}
          />

          {result.session_id && (
            <FmPanel
              title="💬 Refine with chat"
              subtitle="Ask follow-up questions about this synthesis. The conversation persists with the session — anything you tell the AI here is also factored into the draft when you click Generate below."
            >
              <ChatPanel
                clientId={clientId}
                sessionId={result.session_id}
                dryRun={false}
              />
            </FmPanel>
          )}

          {/* Generate-draft sits BELOW the chat so it visually captures
              both the AI suggestions AND any chat refinement — not just
              the suggestions cards. Without this ordering the button
              looked like it only acted on what was directly above it
              and coaches missed using the chat. */}
          <div
            style={{
              padding: 16,
              background: "rgba(43, 45, 66, 0.04)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-md)",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <button
              type="button"
              onClick={() => onGenerateDraft()}
              disabled={draftPending}
              style={{
                background: "var(--fm-primary)",
                color: "#fff",
                border: 0,
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 700,
                borderRadius: "var(--fm-radius-sm)",
                cursor: draftPending ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {draftPending ? "Generating…" : "📋 Generate draft plan →"}
            </button>
            <div style={{ flex: 1, fontSize: 12 }}>
              Captures everything above — AI suggestions you ticked +
              anything refined in the chat — into a structured draft.
              You can edit, preview, and activate from there.
            </div>
          </div>
          {staleGenerateConfirm && (
            <div
              style={{
                padding: 12,
                background: "rgba(217,119,6,0.10)",
                border: "1px solid rgba(217,119,6,0.4)",
                borderRadius: "var(--fm-radius-sm)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.5 }}>
                ⚠️ This synthesis was loaded from{" "}
                <strong>{rehydratedFrom?.date ?? "an earlier run"}</strong> and
                hasn&apos;t been re-analysed this session. If you&apos;ve uploaded
                new reports or saved a new intake since then, the plan will{" "}
                <strong>ignore them</strong> and use the old data. Re-run first so
                the plan reflects the latest reports.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    setStaleGenerateConfirm(false);
                    onAnalyze();
                  }}
                  disabled={pending || draftPending}
                  style={{
                    background: "var(--fm-primary)",
                    color: "#fff",
                    border: 0,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: "var(--fm-radius-sm)",
                    cursor: pending || draftPending ? "wait" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  🔁 Re-run synthesis first
                </button>
                <button
                  type="button"
                  onClick={() => onGenerateDraft({ confirmStale: true })}
                  disabled={draftPending}
                  style={{
                    background: "#fff",
                    color: "var(--fm-text-primary)",
                    border: "1px solid var(--fm-border)",
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: "var(--fm-radius-sm)",
                    cursor: draftPending ? "wait" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Generate from {rehydratedFrom?.date ?? "old"} synthesis anyway
                </button>
              </div>
            </div>
          )}
          {draftSignupWarning && (
            <div
              style={{
                padding: 10,
                background: "rgba(217,119,6,0.08)",
                border: "1px solid rgba(217,119,6,0.3)",
                borderRadius: "var(--fm-radius-sm)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: "#92400e" }}>{draftSignupWarning}</div>
              <button
                type="button"
                onClick={() => onGenerateDraft({ force: true })}
                disabled={draftPending}
                style={{
                  background: "#fff",
                  color: "var(--fm-text-primary)",
                  border: "1px solid var(--fm-border)",
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: draftPending ? "wait" : "pointer",
                  fontFamily: "inherit",
                  alignSelf: "flex-start",
                }}
              >
                Generate the full plan anyway
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
