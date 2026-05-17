/**
 * /clients-v2/[id]/intake-view — read-only review of the submitted intake form.
 *
 * Renders every field the client filled, grouped by the same 14 sections
 * they saw. Coach uses this to scan the full submission before a discovery
 * call. Snake_case enum values are humanised; arrays render as chip lists;
 * empty strings / null / [] are hidden so the page stays scannable.
 *
 * Submission timestamp shows in IST. If the client hasn't submitted yet,
 * the page surfaces that clearly with a link to the intake send/copy flow.
 */
import Link from "next/link";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmAppShell } from "@/components/fm";
import { clientQuickActions } from "../client-quick-actions";

export const dynamic = "force-dynamic";

type Val = unknown;

function isEmpty(v: Val): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function humanise(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtIST(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " IST";
  } catch {
    return iso;
  }
}

function Field({ label, value, hint }: { label: string; value: Val; hint?: string }) {
  if (isEmpty(value)) return null;
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 py-2 border-b border-stone-100 last:border-b-0">
      <div className="text-xs uppercase tracking-wide text-stone-500 pt-1">
        {label}
        {hint && <div className="text-[10px] normal-case tracking-normal text-stone-400 mt-0.5">{hint}</div>}
      </div>
      <div className="text-sm text-stone-800">
        <RenderValue value={value} />
      </div>
    </div>
  );
}

function RenderValue({ value }: { value: Val }) {
  if (typeof value === "string") {
    // Looks like an enum? Humanise.
    if (/^[a-z][a-z0-9_]*$/.test(value) && value.includes("_")) {
      return <span>{humanise(value)}</span>;
    }
    if (value.length > 80) {
      return <span className="whitespace-pre-wrap">{value}</span>;
    }
    return <span>{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === "string" || typeof x === "number")) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {(value as Array<string | number>).map((v, i) => (
            <span key={i} className="inline-block px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-xs">
              {typeof v === "string" && /^[a-z][a-z0-9_]*$/.test(v) && v.includes("_") ? humanise(v) : String(v)}
            </span>
          ))}
        </div>
      );
    }
    // Array of objects (medications, pregnancies, timeline_events)
    return (
      <div className="space-y-2">
        {(value as Array<Record<string, unknown>>).map((row, i) => (
          <div key={i} className="bg-stone-50 rounded px-3 py-2 text-xs space-y-0.5">
            {Object.entries(row)
              .filter(([, v]) => !isEmpty(v))
              .map(([k, v]) => (
                <div key={k}>
                  <span className="text-stone-500">{humanise(k)}:</span>{" "}
                  <span className="text-stone-800">{typeof v === "boolean" ? (v ? "yes" : "no") : String(v)}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    );
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => !isEmpty(v));
    if (entries.length === 0) return null;
    return (
      <div className="bg-stone-50 rounded px-3 py-2 text-xs space-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k}>
            <span className="text-stone-500">{humanise(k)}:</span>{" "}
            <span className="text-stone-800">{typeof v === "boolean" ? (v ? "yes" : "no") : String(v)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-stone-400">—</span>;
}

function Section({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  // Filter out empty children so we can skip whole sections.
  const arr = Array.isArray(children) ? children.flat().filter(Boolean) : [children];
  const hasAny = arr.some((c) => c && typeof c === "object" && "props" in c && !isEmpty((c as { props: { value: Val } }).props?.value));
  if (!hasAny) return null;
  return (
    <section className="bg-white rounded-lg border border-stone-200 px-5 py-4">
      <h2 className="text-base font-semibold text-stone-900 mb-3">
        <span className="text-stone-400 mr-2">{String(num).padStart(2, "0")}</span>
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

export default async function IntakeViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = (await loadClientById(id)) as Record<string, Val> | null;

  if (!client) {
    return (
      <FmAppShell
        activeNavId="clients"
        crumbs={[
          { label: "Clients", href: "/clients-v2" },
          { label: "Intake view" },
        ]}
      >
        <div className="max-w-3xl mx-auto p-6">
          <p className="text-stone-600">Client not found.</p>
          <Link href="/clients-v2" className="text-sm text-emerald-700 underline">← All clients</Link>
        </div>
      </FmAppShell>
    );
  }

  const submittedAt = client.intake_submitted_at as string | null | undefined;
  const submitted = !!submittedAt;
  const displayName = (client.display_name as string) || id;

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(id)}
      crumbs={[
        { label: "Clients", href: "/clients-v2" },
        { label: displayName, href: `/clients-v2/${id}` },
        { label: "Intake submission" },
      ]}
    ><div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">
            {displayName} — Intake submission
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {submitted ? (
              <>Submitted <span className="text-stone-800 font-medium">{fmtIST(submittedAt)}</span></>
            ) : (
              <span className="text-amber-700">Not yet submitted — only fields the coach pre-filled will show below.</span>
            )}
          </p>
        </div>
        <Link
          href={`/clients-v2/${id}`}
          className="text-sm text-emerald-700 hover:underline whitespace-nowrap"
        >
          ← Back to client
        </Link>
      </div>

      <Section num={1} title="About you">
        <Field label="Name" value={client.display_name} />
        <Field label="Date of birth" value={client.date_of_birth} />
        <Field label="Sex" value={client.sex} />
        <Field label="Email" value={client.email} />
        <Field label="Mobile" value={client.mobile_number} />
        <Field label="City" value={client.city} />
        <Field label="Country" value={client.country} />
        <Field
          label="Height"
          value={
            client.height_cm
              ? `${client.height_cm} cm`
              : client.height_ft || client.height_in
              ? `${client.height_ft ?? "—"} ft ${client.height_in ?? 0} in`
              : null
          }
        />
        <Field
          label="Current weight"
          value={
            client.weight_now_kg
              ? `${client.weight_now_kg} kg`
              : client.weight_now_lb
              ? `${client.weight_now_lb} lb`
              : null
          }
        />
        <Field
          label="Waist"
          value={
            client.waist_cm
              ? `${client.waist_cm} cm`
              : client.waist_in
              ? `${client.waist_in} in`
              : null
          }
        />
        <Field
          label="Hips"
          value={
            client.hip_cm
              ? `${client.hip_cm} cm`
              : client.hip_in
              ? `${client.hip_in} in`
              : null
          }
        />
        <Field
          label="Blood pressure"
          value={
            client.bp_systolic && client.bp_diastolic
              ? `${client.bp_systolic} / ${client.bp_diastolic} mmHg`
              : null
          }
        />
        <Field label="Highest adult weight (kg)" value={client.weight_highest_adult} />
        <Field label="Lowest adult weight (kg)" value={client.weight_lowest_adult} />
        <Field label="Weight trend" value={client.weight_trend_current} />
        <Field label="What changed" value={client.weight_change_trigger} />
        <Field label="Work pattern" value={client.work_pattern} />
      </Section>

      <Section num={2} title="Why you're here">
        <Field label="Goals" value={client.goals} />
        <Field label="Reported triggers" value={client.reported_triggers} />
      </Section>

      <Section num={3} title="Diagnoses, allergies & family">
        <Field label="Active conditions" value={client.active_conditions} />
        <Field label="Medical history" value={client.medical_history} />
        <Field label="Known allergies" value={client.known_allergies} />
        <Field label="Family history (freeform)" value={client.family_history} />
        <Field label="Family — specific conditions" value={client.family_specific_conditions} />
        <Field label="COVID infections" value={client.covid_history} />
        <Field label="COVID long symptoms" value={client.covid_long_symptoms} />
        <Field label="COVID vaccine history" value={client.covid_vaccine_history} />
        <Field label="COVID vaccine brand" value={client.covid_vaccine_brand} />
        <Field label="COVID vaccine reactions" value={client.covid_vaccine_reactions} />
        <Field label="COVID vaccine reaction detail" value={client.covid_vaccine_reaction_detail} />
      </Section>

      <Section num={4} title="Medications, current and past">
        <Field label="Current medications" value={client.current_medications} />
        <Field label="Current supplements" value={client.current_supplements} />
        <Field label="GLP-1 medications" value={client.glp1_medications} />
        <Field label="Acid suppressants" value={client.acid_suppressants} />
        <Field label="NSAIDs (daily)" value={client.nsaids_daily} />
        <Field label="Antibiotics (last 12mo)" value={client.antibiotics_last_12mo} />
        <Field label="Hormonal contraception / HRT" value={client.hormonal_contraception_hrt} />
        <Field label="Thyroid medication" value={client.thyroid_medication} />
        <Field label="Psych medications" value={client.psych_medications} />
        <Field label="Biologics / immunosuppressants" value={client.biologics_immunosuppressants} />
        <Field label="Statins / BP / diabetes" value={client.statins_bp_diabetes} />
      </Section>

      <Section num={5} title="Health story, in time">
        <Field label="Timeline events" value={client.timeline_events} />
      </Section>

      <Section num={6} title="Day to day — how you're living">
        <Field label="Postprandial pattern" value={client.postprandial_pattern} />
        <Field label="Cold / heat tolerance" value={client.cold_heat_tolerance} />
        <Field label="Time to fall asleep (min)" value={client.time_to_fall_asleep} />
        <Field label="Wake pattern" value={client.wake_time_pattern} />
        <Field label="Snore / apnoea" value={client.snore_or_apnoea} />
        <Field label="Restless legs" value={client.restless_legs} />
        <Field label="Sleep tracker owned" value={client.sleep_tracker_owned} />
        <Field label="CGM owned" value={client.cgm_owned} />
        <Field label="Energy crashes" value={client.energy_crashes} />
        <Field label="Caffeine dependency" value={client.caffeine_dependency} />
        <Field label="Morning state" value={client.morning_state} />
        <Field label="Sleep notes" value={client.sleep_notes} />
        <Field label="Energy pattern" value={client.energy_pattern} />
        <Field label="Digestion notes" value={client.digestion_notes} />
      </Section>

      <Section num={7} title="Five pillars + sleep depth">
        <Field label="Five pillars" value={client.five_pillars} />
        <Field label="Stress response" value={client.stress_response} />
      </Section>

      <Section num={8} title="Childhood, environment, what's been tried">
        <Field label="Childhood history" value={client.childhood_history} />
        <Field label="Toxic exposures" value={client.toxic_exposures} />
        <Field label="What has worked" value={client.what_has_worked} />
        <Field label="What hasn't worked" value={client.what_hasnt_worked} />
      </Section>

      <Section num={9} title="How you eat">
        <Field label="Dietary preference" value={client.dietary_preference} />
        <Field label="Foods to avoid" value={client.foods_to_avoid} />
        <Field label="Non-negotiables" value={client.non_negotiables} />
      </Section>

      <Section num={10} title="Body systems — what's bothering you">
        <Field label="Bristol stool (typical)" value={client.bristol_stool_typical} />
        <Field label="Bowel frequency / day" value={client.bowel_frequency_per_day} />
        <Field label="Bowel pattern" value={client.bowel_pattern} />
        <Field label="Bowel — historical" value={client.bowel_historical} />
        <Field label="Hair loss pattern" value={client.hair_loss_pattern} />
        <Field label="Hair texture change" value={client.hair_texture_change} />
        <Field label="Hair — other" value={client.hair_other} />
        <Field label="Nail signs" value={client.nail_signs} />
        <Field label="Acne pattern" value={client.acne_pattern} />
        <Field label="Skin signs" value={client.skin_signs} />
        <Field label="Pain locations" value={client.pain_locations} />
        <Field label="Headache type" value={client.headache_type} />
        <Field label="Pain pattern" value={client.pain_pattern} />
        <Field label="Pain quality" value={client.pain_quality} />
        <Field label="Belly fat pattern" value={client.belly_fat_pattern} />
        <Field label="Histamine signals" value={client.histamine_signals} />
        <Field label="Chemical sensitivity" value={client.chemical_sensitivity} />
        <Field label="Oral signs" value={client.oral_signs} />
      </Section>

      <Section num={11} title="Cycle, contraception, pregnancies">
        <Field label="Cycle status" value={client.cycle_status} />
        <Field label="Last menstrual period" value={client.last_menstrual_period} />
        <Field label="Cycle length (days)" value={client.cycle_length_days} />
        <Field label="Cycle regularity" value={client.cycle_regularity} />
        <Field label="Menopause started" value={client.menopause_started} />
        <Field label="Pregnancy status" value={client.pregnancy_status} />
        <Field label="Period pain severity" value={client.period_pain_severity} />
        <Field label="Period pain impact" value={client.period_pain_impact} />
        <Field label="PMDD signs" value={client.pmdd_signs} />
        <Field label="Contraception history" value={client.contraception_history} />
        <Field label="Pregnancies" value={client.pregnancies} />
        <Field label="Reproductive diagnoses" value={client.repro_diagnoses} />
        <Field label="Perimenopause inventory" value={client.perimenopause_inventory} />
        <Field label="Menstrual notes" value={client.menstrual_notes} />
      </Section>

      <Section num={12} title="Sun, environment & recent labs">
        <Field label="Sun exposure (daily)" value={client.sun_exposure_daily} />
        <Field label="Sunscreen use" value={client.sunscreen_use} />
        <Field label="Vitamin D supplement" value={client.vit_d_supplement} />
        <Field label="Barefoot outdoors" value={client.barefoot_outdoors} />
        <Field label="Recent labs done" value={client.recent_labs_done} />
        <Field label="When were labs done" value={client.recent_labs_when} />
        <Field label="Willing to share labs" value={client.willing_to_share_labs} />
        <Field label="Readiness confidence (1–10)" value={client.readiness_confidence} />
      </Section>

      <Section num={13} title="Anything else">
        <Field label="Notes" value={client.notes} />
      </Section>

      <Section num={14} title="Intake insights (AI-derived)">
        <Field label="Insights" value={client.intake_insights} />
      </Section>
    </div>
    </FmAppShell>
  );
}
