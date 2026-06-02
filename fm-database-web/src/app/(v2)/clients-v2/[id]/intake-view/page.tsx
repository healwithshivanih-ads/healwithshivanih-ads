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

  // When the client hasn't submitted yet, read from the auto-saved draft
  // (intake_form_draft) rather than the top-level client.yaml fields —
  // the top-level fields were pre-filled by the coach when creating the
  // record and are NOT what the client typed. The draft is written by the
  // form's auto-save on every section change, so it reflects real
  // in-progress answers even before the client hits Submit.
  const draft = (client.intake_form_draft ?? null) as Record<string, Val> | null;
  const hasDraft = draft && Object.values(draft).some((v) => !isEmpty(v));
  // Which object do we read fields from?
  //   submitted → top-level client fields (promoted from the submit handler)
  //   in-progress draft → intake_form_draft
  //   nothing → show a clear "nothing yet" message
  const src: Record<string, Val> = submitted ? client : (hasDraft ? draft! : {});

  // Body composition lives in the canonical `measurements` block — the
  // intake submit handler converts the form's flat height/weight/waist/
  // hip/BP fields (metric or imperial) into metric here. Reading the old
  // flat `client.height_cm` etc. always showed blank: those flat fields
  // were never persisted (intake field-drop bug, fixed 2026-05-20).
  // For a draft, measurements may be stored flat in the draft object.
  const meas = (submitted
    ? (client.measurements ?? {})
    : (src.measurements ?? {})) as Record<string, number | undefined>;

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
            ) : hasDraft ? (
              <span className="text-amber-700 font-medium">
                ✍ Draft in progress — client has NOT submitted yet. These are their saved-but-unsubmitted answers.
              </span>
            ) : (
              <span className="text-stone-400">Client has opened the form but hasn't filled anything yet.</span>
            )}
          </p>
        </div>
        {/* Back link converted to inline styles 2026-05-19 — coach
            reported the Tailwind `text-emerald-700 hover:underline`
            wasn't rendering (link looked broken / unclickable). Inline
            border + bg make it an unmistakable button-shaped link. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link
            href={`/clients-v2/${id}/analyse/intake`}
            style={{
              display: "inline-block",
              padding: "8px 14px",
              background: "var(--fm-primary, #E8622A)",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            📋 Open intake form
          </Link>
          <Link
            href={`/clients-v2/${id}`}
            style={{
              display: "inline-block",
              padding: "8px 14px",
              background: "var(--fm-surface, #fff)",
              border: "1px solid var(--fm-border, #E5E2DD)",
              borderRadius: 8,
              color: "var(--fm-text-primary, #1A1A1A)",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            ← Back to client
          </Link>
        </div>
      </div>

      {!submitted && !hasDraft && (
        <div className="bg-stone-50 border border-stone-200 rounded-lg px-5 py-8 text-center text-stone-500 text-sm">
          <div className="text-2xl mb-3">👀</div>
          <div className="font-medium text-stone-700 mb-1">{displayName} hasn&apos;t filled anything yet</div>
          <div className="text-xs text-stone-400">The form was opened but no answers have been saved. Check back once they start filling it.</div>
        </div>
      )}

      {(submitted || hasDraft) && (
        <>
      <Section num={1} title="About you">
        <Field label="Name" value={src.display_name} />
        <Field label="Date of birth" value={src.date_of_birth} />
        <Field label="Sex" value={src.sex} />
        <Field label="Email" value={src.email} />
        <Field label="Mobile" value={src.mobile_number} />
        <Field label="City" value={src.city} />
        <Field label="Country" value={src.country} />
        <Field
          label="Height"
          value={meas.height_cm ? `${meas.height_cm} cm` : null}
        />
        <Field
          label="Current weight"
          value={meas.weight_kg ? `${meas.weight_kg} kg` : null}
        />
        <Field
          label="Waist"
          value={meas.waist_cm ? `${meas.waist_cm} cm` : null}
        />
        <Field
          label="Hips"
          value={meas.hip_cm ? `${meas.hip_cm} cm` : null}
        />
        <Field
          label="Blood pressure"
          value={
            meas.blood_pressure_systolic && meas.blood_pressure_diastolic
              ? `${meas.blood_pressure_systolic} / ${meas.blood_pressure_diastolic} mmHg`
              : null
          }
        />
        <Field label="Highest adult weight (kg)" value={src.weight_highest_adult} />
        <Field label="Lowest adult weight (kg)" value={src.weight_lowest_adult} />
        <Field label="Weight trend" value={src.weight_trend_current} />
        <Field label="What changed" value={src.weight_change_trigger} />
        <Field label="Work pattern" value={src.work_pattern} />
      </Section>

      <Section num={2} title="Why you're here">
        <Field label="Goals" value={src.goals} />
        <Field label="Reported triggers" value={src.reported_triggers} />
      </Section>

      <Section num={3} title="Diagnoses, allergies & family">
        <Field label="Active conditions" value={src.active_conditions} />
        <Field label="Medical history" value={src.medical_history} />
        <Field label="Known allergies" value={src.known_allergies} />
        <Field label="Family history (freeform)" value={src.family_history} />
        <Field label="Family — specific conditions" value={src.family_specific_conditions} />
        <Field label="COVID infections" value={src.covid_history} />
        <Field label="COVID long symptoms" value={src.covid_long_symptoms} />
        <Field label="COVID vaccine history" value={src.covid_vaccine_history} />
        <Field label="COVID vaccine brand" value={src.covid_vaccine_brand} />
        <Field label="COVID vaccine reactions" value={src.covid_vaccine_reactions} />
        <Field label="COVID vaccine reaction detail" value={src.covid_vaccine_reaction_detail} />
      </Section>

      <Section num={4} title="Medications, current and past">
        <Field label="Current medications" value={src.current_medications} />
        <Field label="Current supplements" value={src.current_supplements} />
        <Field label="GLP-1 medications" value={src.glp1_medications} />
        <Field label="Acid suppressants" value={src.acid_suppressants} />
        <Field label="NSAIDs (daily)" value={src.nsaids_daily} />
        <Field label="Antibiotics (last 12mo)" value={src.antibiotics_last_12mo} />
        <Field label="Hormonal contraception / HRT" value={src.hormonal_contraception_hrt} />
        <Field label="Thyroid medication" value={src.thyroid_medication} />
        <Field label="Psych medications" value={src.psych_medications} />
        <Field label="Biologics / immunosuppressants" value={src.biologics_immunosuppressants} />
        <Field label="Statins / BP / diabetes" value={src.statins_bp_diabetes} />
      </Section>

      <Section num={5} title="Health story, in time">
        <Field label="Timeline events" value={src.timeline_events} />
      </Section>

      <Section num={6} title="Day to day — how you're living">
        <Field label="Postprandial pattern" value={src.postprandial_pattern} />
        <Field label="Cold / heat tolerance" value={src.cold_heat_tolerance} />
        <Field label="Time to fall asleep (min)" value={src.time_to_fall_asleep} />
        <Field label="Wake pattern" value={src.wake_time_pattern} />
        <Field label="Snore / apnoea" value={src.snore_or_apnoea} />
        <Field label="Restless legs" value={src.restless_legs} />
        <Field label="Sleep tracker owned" value={src.sleep_tracker_owned} />
        <Field label="CGM owned" value={src.cgm_owned} />
        <Field label="Energy crashes" value={src.energy_crashes} />
        <Field label="Caffeine dependency" value={src.caffeine_dependency} />
        <Field label="Morning state" value={src.morning_state} />
        <Field label="Sleep notes" value={src.sleep_notes} />
        <Field label="Energy pattern" value={src.energy_pattern} />
        <Field label="Digestion notes" value={src.digestion_notes} />
      </Section>

      <Section num={7} title="Five pillars + sleep depth">
        <Field label="Five pillars" value={src.five_pillars} />
        <Field label="Stress response" value={src.stress_response} />
      </Section>

      <Section num={8} title="Childhood, environment, what's been tried">
        <Field label="Childhood history" value={src.childhood_history} />
        <Field label="Toxic exposures" value={src.toxic_exposures} />
        <Field label="What has worked" value={src.what_has_worked} />
        <Field label="What hasn't worked" value={src.what_hasnt_worked} />
      </Section>

      <Section num={9} title="How you eat">
        <Field label="Dietary preference" value={src.dietary_preference} />
        <Field label="Foods to avoid" value={src.foods_to_avoid} />
        <Field label="Non-negotiables" value={src.non_negotiables} />
      </Section>

      <Section num={10} title="Body systems — what's bothering you">
        <Field label="Bristol stool (typical)" value={src.bristol_stool_typical} />
        <Field label="Bowel frequency / day" value={src.bowel_frequency_per_day} />
        <Field label="Bowel pattern" value={src.bowel_pattern} />
        <Field label="Bowel — historical" value={src.bowel_historical} />
        <Field label="Hair loss pattern" value={src.hair_loss_pattern} />
        <Field label="Hair texture change" value={src.hair_texture_change} />
        <Field label="Hair — other" value={src.hair_other} />
        <Field label="Nail signs" value={src.nail_signs} />
        <Field label="Acne pattern" value={src.acne_pattern} />
        <Field label="Skin signs" value={src.skin_signs} />
        <Field label="Pain locations" value={src.pain_locations} />
        <Field label="Headache type" value={src.headache_type} />
        <Field label="Pain pattern" value={src.pain_pattern} />
        <Field label="Pain quality" value={src.pain_quality} />
        <Field label="Belly fat pattern" value={src.belly_fat_pattern} />
        <Field label="Histamine signals" value={src.histamine_signals} />
        <Field label="Chemical sensitivity" value={src.chemical_sensitivity} />
        <Field label="Oral signs" value={src.oral_signs} />
      </Section>

      <Section num={11} title="Cycle, contraception, pregnancies">
        <Field label="Cycle status" value={src.cycle_status} />
        <Field label="Last menstrual period" value={src.last_menstrual_period} />
        <Field label="Cycle length (days)" value={src.cycle_length_days} />
        <Field label="Cycle regularity" value={src.cycle_regularity} />
        <Field label="Menopause started" value={src.menopause_started} />
        <Field label="Pregnancy status" value={src.pregnancy_status} />
        <Field label="Period pain severity" value={src.period_pain_severity} />
        <Field label="Period pain impact" value={src.period_pain_impact} />
        <Field label="PMDD signs" value={src.pmdd_signs} />
        <Field label="Contraception history" value={src.contraception_history} />
        <Field label="Pregnancies" value={src.pregnancies} />
        <Field label="Reproductive diagnoses" value={src.repro_diagnoses} />
        <Field label="Perimenopause inventory" value={src.perimenopause_inventory} />
        <Field label="Menstrual notes" value={src.menstrual_notes} />
      </Section>

      <Section num={12} title="Sun, environment & recent labs">
        <Field label="Sun exposure (daily)" value={src.sun_exposure_daily} />
        <Field label="Sunscreen use" value={src.sunscreen_use} />
        <Field label="Vitamin D supplement" value={src.vit_d_supplement} />
        <Field label="Barefoot outdoors" value={src.barefoot_outdoors} />
        <Field label="Recent labs done" value={src.recent_labs_done} />
        <Field label="When were labs done" value={src.recent_labs_when} />
        <Field label="Willing to share labs" value={src.willing_to_share_labs} />
        <Field label="Readiness confidence (1–10)" value={src.readiness_confidence} />
      </Section>

      <Section num={13} title="Anything else">
        <Field label="Notes" value={src.notes} />
      </Section>

      {/* AI insights only exist after submission */}
      {submitted && (
        <Section num={14} title="Intake insights (AI-derived)">
          <Field label="Insights" value={client.intake_insights} />
        </Section>
      )}
        </>
      )}
    </div>
    </FmAppShell>
  );
}
