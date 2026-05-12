/**
 * /clients-v2/[id]/analyse/full — Phase 3.5 Full Assessment in the v2 shell.
 *
 * The Full Assessment is by far the most complex session form (~1500 LOC of
 * working UI: category symptom picker, transcript-aware lab extraction,
 * snapshot prefill, AI synthesis with progress modal, drivers/topics/supps
 * review with include checkboxes, multi-turn chat panel, Generate-draft).
 *
 * Re-implementing it natively in v2 primitives would be a multi-week task and
 * introduces real regression risk on the highest-stakes workflow the coach
 * has. Instead we wrap the proven legacy `AssessClient` (in fixedClientId
 * mode) inside the v2 shell + analyse breadcrumbs. Coach gets v2 nav around
 * the form; the form internals are unchanged.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans, loadAllOfKind } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";
import type { Symptom, Topic } from "@/lib/fmdb/types";
import { AnalysePageShell } from "../analyse-page-shell";
import { AssessClient } from "@/app/assess/assess-client";
import { FmPageHeader } from "@/components/fm";
import { loadClientSessionsAction } from "@/app/assess/actions";

export const dynamic = "force-dynamic";

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
    // AnalysePageShell handles the notFound; we still need the early return.
    return (
      <AnalysePageShell clientId={id} formLabel="Full assessment">
        <div />
      </AnalysePageShell>
    );
  }

  // ── Catalogue options for the symptom + topic pickers ──────────
  const symptomOpts = symptoms
    .map((s) => ({
      slug: s.slug,
      label: s.display_name || s.slug,
      aliases: s.aliases || [],
      category: (s as unknown as { category?: string }).category || "other",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const topicOpts = topics
    .map((t) => ({ slug: t.slug, label: t.display_name || t.slug }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // ── Files already uploaded for this client ─────────────────────
  const filesDir = path.join(getPlansRoot(), "clients", id, "files");
  let uploadedFiles: string[] = [];
  try {
    uploadedFiles = await fs.readdir(filesDir);
  } catch {
    /* no files dir yet — fine */
  }

  // ── Active plan (so the form can warn on overwrite) ────────────
  const plans = allPlans.filter((p) => p.client_id === id);
  const activePlan = plans.find((p) =>
    ["draft", "ready_to_publish", "published"].includes(
      (p.status as string | undefined) ?? (p._bucket as string | undefined) ?? "",
    ),
  );
  const activePlanStatus = activePlan
    ? ((activePlan.status as string | undefined) ??
        (activePlan._bucket as string | undefined) ??
        "draft")
    : null;

  const displayName = client.display_name ?? client.client_id;
  const c = client as unknown as Record<string, unknown>;
  const clientSex =
    c.sex === "F" || c.sex === "M" ? (c.sex as "F" | "M") : null;
  // health_snapshots on disk sometimes have nullable date/source on older
  // records; AssessClient's priorSnapshots prop requires them. Drop entries
  // missing date so the contract holds.
  const rawSnaps =
    (c.health_snapshots as Array<{
      date?: string;
      source?: string;
      linked_session_id?: string;
      measurements?: {
        height_cm?: number | null;
        weight_kg?: number | null;
        bp_systolic?: number | null;
        bp_diastolic?: number | null;
        hr_bpm?: number | null;
        waist_cm?: number | null;
        hip_cm?: number | null;
      };
      lab_values?: Array<{ test_name: string; value: string; unit: string }>;
      medications?: string[];
      conditions?: string[];
    }> | undefined) ?? [];
  const priorSnapshots = rawSnaps
    .filter((s) => typeof s.date === "string")
    .map((s) => ({
      date: s.date as string,
      source: s.source ?? "",
      linked_session_id: s.linked_session_id,
      measurements: s.measurements,
      lab_values: s.lab_values,
      medications: s.medications,
      conditions: s.conditions,
    }));

  return (
    <AnalysePageShell
      clientId={id}
      formLabel="Full assessment"
      formHint="🔬 Full assessment · long visit · AI synthesis + draft plan · 60–90 min"
    >
      <FmPageHeader
        as="h2"
        size="md"
        title={
          <span style={{ color: "#3a4250" }}>
            🔬 Full assessment — {displayName.split(" ")[0]}
          </span>
        }
        subtitle="Pulls the full client picture together. Upload labs, transcripts and food journals; pick symptoms + conditions; AI synthesises drivers, ranks supplements, and (on coach approval) drafts a structured plan."
      />

      {/* The legacy AssessClient is rendered inside the v2 shell. fixedClientId
          mode skips the client picker and uses the client-page snapshot UI.
          Internals (CategoryPicker, transcript extraction, AI progress bar,
          SuggestionsView, ChatPanel, PlanBriefCard) all carry over. */}
      <div style={{ marginTop: 8 }}>
        <AssessClient
          fixedClientId={id}
          symptoms={symptomOpts}
          topics={topicOpts}
          initialSessions={sessions}
          existingFiles={uploadedFiles}
          clientSex={clientSex}
          priorSnapshots={priorSnapshots}
          activePlan={
            activePlan
              ? {
                  slug: activePlan.slug,
                  status: activePlanStatus ?? undefined,
                  plan_period_recheck_date:
                    (activePlan.plan_period_recheck_date as string | null | undefined) ??
                    null,
                }
              : null
          }
        />
      </div>
    </AnalysePageShell>
  );
}
