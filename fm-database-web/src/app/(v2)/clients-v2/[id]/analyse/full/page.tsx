/**
 * /clients-v2/[id]/analyse/full — Phase 3.5 Full Assessment in v2.
 *
 * The Full Assessment is the AI synthesis pass — NOT a data-capture form.
 * Intake already captured chief complaint, body comp, conditions, meds,
 * FM body-systems review, food prefs, FM timeline, allergies, goals.
 * Repeating those inputs here was redundant and exhausting.
 *
 * This page now loads the intake snapshot (latest intake session + the
 * client.yaml profile data the Intake form persists) and asks the coach
 * only for the DELTA:
 *   - What's new since intake?
 *   - New reports
 *   - Coach observations
 *   - For repeat assessments: how did the prior protocol go?
 *
 * The AI synthesis still calls the proven runAssessAction / generateDraftAction;
 * the form just shows less, with everything already known displayed as
 * read-only recap. Full Assessments can be repeated at every recheck.
 */
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans, loadAllOfKind } from "@/lib/fmdb/loader";
import type { Symptom, Topic } from "@/lib/fmdb/types";
import { AnalysePageShell } from "../analyse-page-shell";
import { FmPageHeader } from "@/components/fm";
import { loadClientSessionsAction } from "@/lib/server-actions/assess";
import { FullAssessmentForm } from "./full-form";

export const dynamic = "force-dynamic";

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
function numOr(v: unknown): number | undefined {
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

export default async function FullAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [client, sessions, allPlans, symptoms, topics] = await Promise.all([
    loadClientById(id),
    loadClientSessionsAction(id),
    loadAllPlans(),
    loadAllOfKind<Symptom>("symptoms"),
    loadAllOfKind<Topic>("topics"),
  ]);
  if (!client) {
    return (
      <AnalysePageShell clientId={id} formLabel="Full assessment">
        <div />
      </AnalysePageShell>
    );
  }

  const displayName = client.display_name ?? client.client_id;
  const c = client as unknown as Record<string, unknown>;

  // Most recent intake session — drives the "prefilled symptoms/topics".
  // Note: in the v0.59 rename, full_assessment was folded into intake at the
  // data-model level. Intake sessions WITH ai_analysis (driver_count > 0 OR
  // synthesis_notes present) are the prior "full assessments".
  //
  // Also consider client-submitted intake-form quick_notes (tagged
  // `[source: client_intake_form]`) — these are the freshest intake signal
  // and carry derived selected_symptoms from the structured form payload.
  const intakeSessions = sessions
    .filter(
      (sess) =>
        sess.session_type === "intake" ||
        (sess.session_type === "quick_note" &&
          (sess.presenting_complaints ?? "").includes("[source: client_intake_form]")),
    )
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const latestIntake = intakeSessions[0];

  const priorAssessments = intakeSessions
    .filter(
      (sess) =>
        (sess.driver_count ?? 0) > 0 ||
        (sess.synthesis_notes && sess.synthesis_notes.trim().length > 0),
    )
    .map((sess) => ({
      session_id: sess.session_id ?? "",
      date: sess.date ?? "",
    }))
    .filter((p) => p.session_id);

  // Body comp — same merge logic the Overview uses (snapshot + flat).
  const flatMeas = (c.measurements as Record<string, unknown> | undefined) ?? {};
  const snaps =
    (c.health_snapshots as Array<{
      date?: string;
      measurements?: Record<string, unknown>;
    }> | undefined) ?? [];
  const latestSnapMeas =
    snaps
      .filter((sn) => sn.measurements && Object.keys(sn.measurements).length > 0)
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
      .pop()?.measurements ?? {};

  function bc(snapKey: string, flatKey?: string): number | undefined {
    return (
      numOr(latestSnapMeas[snapKey]) ??
      numOr(flatMeas[snapKey]) ??
      (flatKey ? numOr(flatMeas[flatKey]) : undefined)
    );
  }

  const weight = bc("weight_kg");
  const height = bc("height_cm");
  const bmi =
    weight && height ? Math.round((weight / Math.pow(height / 100, 2)) * 10) / 10 : undefined;

  // Build the intake snapshot.
  const intakeSnapshot = {
    chief_complaint: latestIntake?.presenting_complaints?.replace(
      /^\[session_type:[^\]]+\]\s*/,
      "",
    ),
    conditions: asStrArray(c.active_conditions),
    medications:
      asStrArray(c.current_medications).length > 0
        ? asStrArray(c.current_medications)
        : asStrArray(c.medications),
    allergies:
      asStrArray(c.known_allergies).length > 0
        ? asStrArray(c.known_allergies)
        : asStrArray(c.allergies),
    goals: asStrArray(c.goals),
    medical_history: asStrArray(c.medical_history),
    body_comp: {
      weight_kg: weight,
      height_cm: height,
      bmi,
      bp_systolic: bc("bp_systolic", "blood_pressure_systolic"),
      bp_diastolic: bc("bp_diastolic", "blood_pressure_diastolic"),
      hr_bpm: bc("hr_bpm", "resting_heart_rate"),
      waist_cm: bc("waist_cm"),
      hip_cm: bc("hip_cm"),
    },
    fm_body_systems: {
      digestion_notes: s(c.digestion_notes),
      sleep_notes: s(c.sleep_notes),
      energy_pattern: s(c.energy_pattern),
      stress_response: s(c.stress_response),
      menstrual_notes: s(c.menstrual_notes),
      childhood_history: s(c.childhood_history),
      toxic_exposures: s(c.toxic_exposures),
    },
    food_prefs: {
      dietary_preference: s(c.dietary_preference),
      foods_to_avoid: s(c.foods_to_avoid),
      non_negotiables: s(c.non_negotiables),
      reported_triggers: s(c.reported_triggers),
    },
    family_history: s(c.family_history),
    timeline_count: Array.isArray(c.timeline_events)
      ? (c.timeline_events as unknown[]).length
      : 0,
    intake_session_id: latestIntake?.session_id,
    intake_date: latestIntake?.date,
  };

  // Catalogue options for the symptom + topic pickers.
  const symptomCatalogue = symptoms
    .map((sm) => ({
      slug: sm.slug,
      label: sm.display_name || sm.slug,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const topicCatalogue = topics
    .map((t) => ({ slug: t.slug, label: t.display_name || t.slug }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Active plan (drives the repeat-assessment context line). Prefer
  // published over draft so the AI compares against the live protocol,
  // not a half-finished candidate draft.
  const plans = allPlans.filter((p) => p.client_id === id);
  const statusOf = (p: typeof plans[number]) =>
    (p.status as string | undefined) ?? (p._bucket as string | undefined) ?? "";
  const STATUS_RANK: Record<string, number> = {
    published: 3,
    ready_to_publish: 2,
    draft: 1,
  };
  const activePlan = plans
    .filter((p) => ["draft", "ready_to_publish", "published"].includes(statusOf(p)))
    .sort(
      (a, b) => (STATUS_RANK[statusOf(b)] ?? 0) - (STATUS_RANK[statusOf(a)] ?? 0),
    )[0];
  const activePlanInfo = activePlan
    ? {
        slug: activePlan.slug,
        status:
          (activePlan.status as string | undefined) ??
          (activePlan._bucket as string | undefined) ??
          "draft",
      }
    : null;

  // Recent sessions — short list for AI context indicator (already passed
  // server-side to assess.py via prior_sessions there, this is just for UI).
  const recentSessions = sessions
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 10);

  return (
    <AnalysePageShell
      clientId={id}
      formLabel="Full assessment"
      formHint="🔬 Full assessment · AI synthesis + draft plan · 30–45 min"
    >
      <FmPageHeader
        as="h2"
        size="md"
        title={
          <span style={{ color: "#3a4250" }}>
            🔬 Full assessment — {displayName.split(" ")[0]}
          </span>
        }
        subtitle={
          priorAssessments.length > 0
            ? `Re-assessment #${priorAssessments.length + 1}. The AI compares against the prior plan and your protocol-review notes below.`
            : "First full assessment. Intake already captured the history — only tell me what's new, and the AI weaves it all together."
        }
      />

      <FullAssessmentForm
        clientId={id}
        displayName={displayName}
        intake={intakeSnapshot}
        prefilledSymptoms={latestIntake?.selected_symptoms ?? []}
        prefilledTopics={latestIntake?.selected_topics ?? []}
        symptomCatalogue={symptomCatalogue}
        topicCatalogue={topicCatalogue}
        priorAssessments={priorAssessments}
        activePlan={activePlanInfo}
        recentSessions={recentSessions}
        triadSignals={{
          histamine_signals: asStrArray(c.histamine_signals),
          beighton_self_score: asStrArray(c.beighton_self_score),
          lean_test_symptoms: asStrArray(c.lean_test_symptoms),
          pem_screen: asStrArray(c.pem_screen),
          mould_exposure: asStrArray(c.mould_exposure),
          physical_exam_findings: Array.isArray(c.physical_exam_findings)
            ? (c.physical_exam_findings as Array<{
                kind: string;
                assessed_at?: string;
                result?: Record<string, unknown>;
              }>)
            : [],
        }}
      />
    </AnalysePageShell>
  );
}
