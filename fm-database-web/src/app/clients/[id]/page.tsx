import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClientById, loadClientSessions } from "@/lib/fmdb/loader-extras";
import { loadAllPlans, loadAllOfKind } from "@/lib/fmdb/loader";
import type { SessionSummary } from "@/app/assess/actions";
import { parseSessionType, parseRequestedLabs } from "@/lib/fmdb/session-utils";
import { ClientPageTabs } from "./client-tabs";
import { ClientContactWidget } from "./client-contact-widget";
import { getPlansRoot } from "@/lib/fmdb/paths";
import fs from "node:fs/promises";
import path from "node:path";
import type { Symptom, Topic } from "@/lib/fmdb/types";

export const dynamic = "force-dynamic";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type LabMarker = {
  marker_name: string; value: number; unit: string;
  reference_range: string; flag: string; fm_interpretation: string; computed?: boolean;
};

function fmtMeasurements(m: Record<string, unknown> | undefined): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.height_cm) parts.push(`${m.height_cm} cm`);
  if (m.weight_kg) parts.push(`${m.weight_kg} kg`);
  if (m.waist_cm)  parts.push(`waist ${m.waist_cm}cm`);
  if (m.hip_cm)    parts.push(`hip ${m.hip_cm}cm`);
  if (m.blood_pressure) parts.push(`BP ${String(m.blood_pressure)}`);
  if (m.resting_heart_rate) parts.push(`HR ${m.resting_heart_rate}`);
  return parts.length ? parts.join(" · ") : null;
}

function fmtBmi(m: Record<string, unknown> | undefined): string | null {
  if (!m) return null;
  if (m.bmi) return `BMI ~${m.bmi}`;
  const h = Number(m.height_cm);
  const w = Number(m.weight_kg);
  if (h > 0 && w > 0) {
    const bmi = Math.round((w / ((h / 100) * (h / 100))) * 10) / 10;
    return `BMI ~${bmi}`;
  }
  return null;
}

function parseLabDate(d?: string | null): number {
  if (!d) return 0;
  const normalised = d.replace(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/, "$2 $1 $3");
  const t = new Date(normalised).getTime();
  return isNaN(t) ? 0 : t;
}

function normaliseFlag(raw?: string): string {
  const f = (raw ?? "").toLowerCase().trim();
  if (f === "optimal" || f === "normal" || f === "low-normal") return "optimal";
  if (f === "suboptimal" || f === "borderline" || f === "elevated" || f === "below-optimal") return "suboptimal";
  return "high";
}

// ─── Curated topic list for educational briefs ────────────────────────────────

const ALL_TOPICS: { slug: string; display_name: string }[] = [
  { slug: "thyroid-dysfunction",         display_name: "Thyroid Health & Dysfunction" },
  { slug: "autoimmune-thyroiditis",       display_name: "Hashimoto's Thyroiditis" },
  { slug: "subclinical-hypothyroidism",   display_name: "Subclinical Hypothyroidism" },
  { slug: "t3-conversion-disorder",       display_name: "T3 Conversion & Thyroid Hormones" },
  { slug: "autoimmune-disease",           display_name: "Autoimmune Disease" },
  { slug: "hrt",                          display_name: "Hormone Replacement Therapy (HRT)" },
  { slug: "perimenopause",                display_name: "Perimenopause & Menopause" },
  { slug: "pcos",                         display_name: "PCOS" },
  { slug: "estrogen-dominance",           display_name: "Estrogen Dominance" },
  { slug: "low-progesterone",             display_name: "Low Progesterone" },
  { slug: "estrogen-metabolism",          display_name: "Estrogen Metabolism" },
  { slug: "testosterone-health",          display_name: "Testosterone & Androgens" },
  { slug: "sex-hormone-binding-globulin", display_name: "Sex Hormone Binding Globulin (SHBG)" },
  { slug: "gut-microbiome",              display_name: "Gut Microbiome & Gut Health" },
  { slug: "dysbiosis",                   display_name: "Gut Dysbiosis" },
  { slug: "sibo",                        display_name: "SIBO (Small Intestinal Bacterial Overgrowth)" },
  { slug: "leaky-gut",                   display_name: "Leaky Gut / Intestinal Permeability" },
  { slug: "gut-brain-axis",              display_name: "Gut-Brain Connection" },
  { slug: "food-sensitivities",          display_name: "Food Sensitivities" },
  { slug: "gerd",                        display_name: "Acid Reflux & GERD" },
  { slug: "constipation",               display_name: "Constipation & Gut Motility" },
  { slug: "h-pylori-infection",          display_name: "H. Pylori Infection" },
  { slug: "blood-sugar-dysfunction",     display_name: "Blood Sugar Dysregulation & Insulin Resistance" },
  { slug: "prediabetes",                 display_name: "Prediabetes & Type 2 Diabetes Prevention" },
  { slug: "type-2-diabetes",             display_name: "Type 2 Diabetes" },
  { slug: "metabolic-syndrome",          display_name: "Metabolic Syndrome" },
  { slug: "midlife-weight-gain",         display_name: "Midlife Weight Gain" },
  { slug: "visceral-adiposity",          display_name: "Visceral Fat & Belly Fat" },
  { slug: "nafld",                       display_name: "Fatty Liver (NAFLD)" },
  { slug: "dyslipidemia",               display_name: "Cholesterol & Lipid Imbalance" },
  { slug: "cardiometabolic-health",      display_name: "Heart & Cardiovascular Health" },
  { slug: "anxiety",                     display_name: "Anxiety & Mood" },
  { slug: "emotional-wellbeing",         display_name: "Emotional Wellbeing & Mental Health" },
  { slug: "cognitive-decline",           display_name: "Brain Health & Cognitive Function" },
  { slug: "nervous-system-regulation",   display_name: "Nervous System Regulation" },
  { slug: "chronic-stress",             display_name: "Chronic Stress & Burnout" },
  { slug: "adrenal-dysfunction",         display_name: "Adrenal Dysfunction & Fatigue" },
  { slug: "chronic-inflammation",        display_name: "Chronic Inflammation" },
  { slug: "psoriasis",                  display_name: "Psoriasis & Skin Inflammation" },
  { slug: "vitamin-d-deficiency",        display_name: "Vitamin D Deficiency" },
  { slug: "vitamin-b12-deficiency",      display_name: "Vitamin B12 Deficiency" },
  { slug: "folate-deficiency",           display_name: "Folate Deficiency" },
  { slug: "magnesium-insufficiency",     display_name: "Magnesium Deficiency" },
  { slug: "zinc-nutrition",             display_name: "Zinc & Immune Health" },
  { slug: "iron-deficiency",            display_name: "Iron Deficiency & Anaemia" },
  { slug: "methylation-mthfr",          display_name: "Methylation & MTHFR" },
  { slug: "essential-fatty-acids",       display_name: "Omega-3 & Essential Fatty Acids" },
  { slug: "hairfall",                   display_name: "Hair Loss" },
  { slug: "gluten-sensitivity",         display_name: "Gluten Sensitivity & Coeliac" },
  { slug: "insomnia",                    display_name: "Sleep Health & Insomnia" },
  { slug: "environmental-toxin-exposure", display_name: "Environmental Toxins & Detoxification" },
].sort((a, b) => a.display_name.localeCompare(b.display_name));

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; session_type?: string }>;
}) {
  const [{ id }, { tab, session_type }] = await Promise.all([params, searchParams]);
  // Map old tab names → new 3-tab structure (backward compat with existing deep-links)
  const defaultTab: "overview" | "sessions" | "plan" =
    tab === "sessions" ? "sessions"
    : tab === "plan"   ? "plan"
    : tab === "timeline" ? "sessions"          // old → new
    : tab === "protocol" ? "plan"              // old → new
    : tab === "send"     ? "plan"              // old → new
    : tab === "documents" ? "plan"             // old → new
    : "overview";
  // session_type URL param: accept new names + legacy aliases
  const defaultSessionType: "discovery" | "intake" | "check_in" | "quick_note" | undefined =
    session_type === "discovery"     ? "discovery"
    : session_type === "intake"      ? "intake"
    : session_type === "check_in"    ? "check_in"
    : session_type === "quick_note"  ? "quick_note"
    // legacy aliases from older deep-links
    : session_type === "pre_intake"  ? "discovery"
    : session_type === "discovery_consultation" ? "discovery"
    : session_type === "full_assessment" ? "intake"
    : undefined;

  // Parallel data fetch — client info + sessions + plans + symptom/topic catalogue
  const [client, rawSessions, allPlans, symptoms, topics] = await Promise.all([
    loadClientById(id),
    loadClientSessions(id),
    loadAllPlans(),
    loadAllOfKind<Symptom>("symptoms"),
    loadAllOfKind<Topic>("topics"),
  ]);

  if (!client) notFound();

  // Build set of existing plan slugs for plan_exists check
  const planSlugsSet = new Set(allPlans.map((p) => p.slug));

  // Slim sessions for client tabs (must match SessionSummary shape from actions.ts)
  const sessions: SessionSummary[] = rawSessions.map((s) => {
    const r = s as Record<string, unknown>;
    const presenting = r.presenting_complaints as string | undefined;
    const coach_notes = r.coach_notes as string | undefined;
    const ai = (r.ai_analysis as Record<string, unknown> | undefined) ?? {};
    return {
      session_id:            r.session_id as string | undefined,
      date:                  r.date as string | undefined,
      selected_symptoms:     r.selected_symptoms as string[] | undefined,
      selected_topics:       r.selected_topics as string[] | undefined,
      presenting_complaints: presenting,
      driver_count:          (ai.likely_drivers as unknown[] | undefined)?.length ?? 0,
      supplement_count:      (ai.supplement_suggestions as unknown[] | undefined)?.length ?? 0,
      synthesis_notes:       ai.synthesis_notes as string | undefined,
      generated_plan_slug:   r.generated_plan_slug as string | undefined,
      plan_exists:           s.generated_plan_slug
                               ? planSlugsSet.has(s.generated_plan_slug as string)
                               : false,
      session_type:          parseSessionType(presenting),
      requested_labs:        parseRequestedLabs(coach_notes),
    };
  });

  // Catalogue opts for Assess tab
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

  // Plans for this client
  const plans = allPlans.filter((p) => p.client_id === id);

  // Derive unique topics from intake sessions — pre-select in education pack
  const assessmentTopicSlugs = new Set<string>();
  for (const s of sessions) {
    if (s.session_type === "intake") {
      for (const slug of (s.selected_topics ?? [])) {
        assessmentTopicSlugs.add(slug);
      }
    }
  }
  const assessmentTopics = Array.from(assessmentTopicSlugs).map((slug) => {
    const found = ALL_TOPICS.find((t) => t.slug === slug) ?? topicOpts.find((t) => t.slug === slug);
    return {
      slug,
      label: (found as { display_name?: string; label?: string } | undefined)?.display_name
        ?? (found as { label?: string } | undefined)?.label
        ?? slug.replace(/-/g, " "),
    };
  });

  // Uploaded files
  const filesDir = path.join(getPlansRoot(), "clients", id, "files");
  let uploadedFiles: string[] = [];
  try { uploadedFiles = await fs.readdir(filesDir); } catch { /* fine */ }

  // Measurements
  const m = client.measurements as Record<string, unknown> | undefined;
  const measurements = fmtMeasurements(m);
  const bmiStr = fmtBmi(m);

  // BMR (Mifflin-St Jeor)
  const bmrCalc = (() => {
    const wkg = Number(m?.weight_kg);
    const hcm = Number(m?.height_cm);
    if (!wkg || !hcm) return null;
    let ageYrs: number | null = null;
    const dob = (client as { date_of_birth?: string }).date_of_birth;
    if (dob) {
      const d = new Date(dob);
      const today = new Date();
      ageYrs = today.getFullYear() - d.getFullYear();
      if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) ageYrs--;
    } else if (client.age_band) {
      try {
        const parts = String(client.age_band).split("-");
        ageYrs = Math.round((parseInt(parts[0]) + parseInt(parts[1])) / 2);
      } catch { ageYrs = 35; }
    }
    if (!ageYrs) return null;
    const sex = (client.sex as string | undefined)?.toUpperCase();
    const bmr = sex === "M"
      ? 10 * wkg + 6.25 * hcm - 5 * ageYrs + 5
      : 10 * wkg + 6.25 * hcm - 5 * ageYrs - 161;
    return Math.round(bmr);
  })();

  // Age display
  const ageDisplay = (() => {
    const dob = (client as { date_of_birth?: string }).date_of_birth;
    if (dob) {
      const dobDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - dobDate.getFullYear();
      const mm = today.getMonth() - dobDate.getMonth();
      if (mm < 0 || (mm === 0 && today.getDate() < dobDate.getDate())) age--;
      return `${dob} (age ${age})`;
    }
    return client.age_band ?? null;
  })();

  // Intake days ago
  const TODAY = new Date();
  let intakeDaysAgo: number | null = null;
  if (client.intake_date) {
    try {
      intakeDaysAgo = Math.round((TODAY.getTime() - new Date(client.intake_date).getTime()) / (1000 * 60 * 60 * 24));
    } catch { /* ignore */ }
  }

  const meds      = (client.medications ?? client.current_medications ?? []) as string[];
  const allergies = (client.allergies ?? client.known_allergies ?? []) as string[];
  const labMarkers = (client.lab_markers ?? []) as LabMarker[];

  // ── Returning client detection ────────────────────────────────────────────
  // A returning client: had ≥1 intake, ≥28 days since any session,
  // and no currently active plan.
  const returningSignal = (() => {
    if (sessions.length === 0) return null;
    const hadIntake = sessions.some((s) => s.session_type === "intake");
    if (!hadIntake) return null; // brand new or discovery only
    const mostRecent = sessions[0];
    if (!mostRecent.date) return null;
    const daysSince = Math.round(
      (TODAY.getTime() - new Date(mostRecent.date).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSince < 28) return null;
    const hasActivePlan = plans.some((p) => {
      const bucket = (p as Record<string, unknown>)._bucket as string | undefined;
      const status = (p as Record<string, unknown>).status as string | undefined;
      return ["draft", "ready_to_publish", "published"].includes(bucket ?? status ?? "");
    });
    if (hasActivePlan) return null; // still on a live protocol
    return { daysSince, lastSession: mostRecent };
  })();

  // Key blood markers (HbA1c, HOMA-IR)
  type ExtractedLab = { test_name: string; value: number | string; unit?: string; flag?: string; date_drawn?: string | null };
  const latestSession = rawSessions[0];
  const sessionLabs: ExtractedLab[] = (() => {
    const ai = (latestSession as Record<string, unknown> | undefined)?.ai_analysis as Record<string, unknown> | undefined;
    return (ai?.extracted_labs as ExtractedLab[] | undefined) ?? [];
  })();

  function findLabValue(keywords: string[]): { value: number; unit?: string; flag?: string } | null {
    for (const lm of labMarkers) {
      const nm = lm.marker_name.toLowerCase();
      if (keywords.some((k) => nm.includes(k))) return { value: lm.value, unit: lm.unit, flag: lm.flag };
    }
    const matches: Array<{ value: number; unit?: string; flag?: string; dateMs: number }> = [];
    for (const el of sessionLabs) {
      const nm = (el.test_name ?? "").toLowerCase();
      if (keywords.some((k) => nm.includes(k))) {
        const v = parseFloat(String(el.value));
        if (!isNaN(v)) matches.push({ value: v, unit: el.unit, flag: el.flag, dateMs: parseLabDate(el.date_drawn) });
      }
    }
    if (!matches.length) return null;
    matches.sort((a, b) => b.dateMs - a.dateMs);
    return matches[0];
  }

  interface KeyMarkerItem { label: string; value: number; unit?: string; flag: string; computed?: boolean }
  const keyMarkers: KeyMarkerItem[] = [];
  const hba1c = findLabValue(["hba1c", "hba1", "glycated haemoglobin", "glycated hemoglobin"]);
  if (hba1c) keyMarkers.push({ label: "HbA1c", value: hba1c.value, unit: hba1c.unit ?? "%", flag: normaliseFlag(hba1c.flag) });

  const homaStored = findLabValue(["homa-ir", "homa_ir", "homa ir", "homa2-ir"]);
  if (homaStored) {
    keyMarkers.push({ label: "HOMA-IR", value: homaStored.value, unit: homaStored.unit ?? "", flag: normaliseFlag(homaStored.flag) });
  } else {
    const glucose = findLabValue(["fasting glucose", "glucose fasting", "glucose (fasting)", "blood glucose"]);
    const insulin = findLabValue(["fasting insulin", "insulin fasting", "insulin (fasting)", "serum insulin"]);
    if (glucose && insulin) {
      const homaVal = Math.round((glucose.value * insulin.value / 405) * 100) / 100;
      const homaFlag = homaVal < 1.0 ? "optimal" : homaVal < 2.0 ? "suboptimal" : "high";
      keyMarkers.push({ label: "HOMA-IR", value: homaVal, unit: "", flag: homaFlag, computed: true });
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <Link href="/clients" className="text-xs text-muted-foreground hover:underline">
          ← All clients
        </Link>
        <h1 className="text-3xl font-bold mt-1">
          {client.display_name ?? client.client_id}
        </h1>
        <p className="text-muted-foreground text-sm font-mono">
          {client.client_id} · {ageDisplay ?? "—"} · {client.sex ?? "—"} ·
          intake {client.intake_date ?? "—"}
        </p>
        <div className="mt-2">
          <ClientContactWidget
            clientId={id}
            email={client.email}
            nextContactDate={client.next_contact_date as string | undefined}
            mobile={client.mobile_number}
          />
        </div>
      </div>

      {/* Returning client banner */}
      {returningSignal && (
        <div
          className="rounded-xl border-2 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4"
          style={{
            borderColor: "var(--brand-indigo)",
            background: "var(--brand-bone)",
          }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: "var(--brand-indigo)" }}>
              👋 Welcome back —{" "}
              {returningSignal.daysSince === 1
                ? "1 day"
                : `${returningSignal.daysSince} days`}{" "}
              since the last session
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--brand-lavender)" }}>
              Last seen {returningSignal.lastSession.date}
              {returningSignal.lastSession.session_type === "check_in"
                ? " (check-in)"
                : returningSignal.lastSession.session_type === "intake"
                ? " (intake)"
                : ""}
              {returningSignal.lastSession.driver_count > 0
                ? ` · ${returningSignal.lastSession.driver_count} driver${returningSignal.lastSession.driver_count !== 1 ? "s" : ""} identified`
                : ""}
              {returningSignal.lastSession.supplement_count > 0
                ? ` · ${returningSignal.lastSession.supplement_count} supplement${returningSignal.lastSession.supplement_count !== 1 ? "s" : ""} in last protocol`
                : ""}
            </p>
            {returningSignal.lastSession.generated_plan_slug && (
              <p className="text-xs mt-0.5 font-mono" style={{ color: "var(--brand-lavender)" }}>
                Prior plan:{" "}
                <Link
                  href={`/plans/${returningSignal.lastSession.generated_plan_slug}`}
                  className="underline underline-offset-2"
                >
                  {returningSignal.lastSession.generated_plan_slug}
                </Link>
              </p>
            )}
            {returningSignal.lastSession.synthesis_notes && (
              <p className="text-xs mt-1.5 italic line-clamp-2 text-muted-foreground">
                &ldquo;{returningSignal.lastSession.synthesis_notes}&rdquo;
              </p>
            )}
          </div>
          <Link
            href={`/clients/${id}?tab=sessions`}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: "var(--brand-indigo)", color: "#fff" }}
          >
            🗓 Record session
          </Link>
        </div>
      )}

      {/* Tabbed layout — all interaction lives here */}
      <ClientPageTabs
        client={client}
        clientId={id}
        plans={plans}
        sessions={sessions}
        uploadedFiles={uploadedFiles}
        symptoms={symptomOpts}
        topics={topicOpts}
        allTopics={ALL_TOPICS}
        assessmentTopics={assessmentTopics}
        labMarkers={labMarkers}
        measurements={measurements}
        bmiStr={bmiStr}
        bmrCalc={bmrCalc}
        ageDisplay={ageDisplay}
        intakeDaysAgo={intakeDaysAgo}
        meds={meds}
        allergies={allergies}
        keyMarkers={keyMarkers}
        defaultTab={defaultTab}
        defaultSessionType={defaultSessionType}
      />
    </div>
  );
}
