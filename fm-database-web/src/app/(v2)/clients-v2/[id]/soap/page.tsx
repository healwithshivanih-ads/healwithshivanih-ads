/**
 * /clients-v2/[id]/soap — true SOAP note. Per-session, one A4 page.
 *
 *   S — Subjective  : client's reported symptoms today, mood, energy.
 *                     Source: most recent session's presenting_complaints
 *                     + Five Pillars subjective fields.
 *   O — Objective   : measurements + recent OUT-OF-RANGE labs (vs FM
 *                     ranges). Source: client.measurements + lab_markers.
 *   A — Assessment  : working hypothesis. Active conditions + primary
 *                     driver from the latest full assessment.
 *   P — Plan        : supplements, lifestyle changes, labs ordered, next
 *                     contact date. Source: active plan + client.next_contact_date.
 *
 * Sibling to /handoff, which is the heavy referral packet. SOAP is the
 * per-visit clinical record. ≤1 A4 page in print.
 */
import Link from "next/link";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessionsAction, type SessionSummary } from "@/lib/server-actions/assess";
import { SoapPrintButton } from "./soap-print-button";
import { FmAppShell } from "@/components/fm";
import { supplementDisplayName } from "@/lib/fmdb/supplement-display";
import { clientQuickActions } from "../client-quick-actions";
import { HeaderAvatar } from "../analyse/header-avatar";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["draft", "ready_to_publish", "published"]);

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return s;
  }
}

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function pickPrimaryDriver(session?: SessionSummary): string | null {
  const drivers = session?.likely_drivers;
  if (!drivers || drivers.length === 0) return null;
  // Drivers in older sessions are stored with various field names. Find the
  // first one that has any non-empty identifying field — display_name beats
  // mechanism beats slug. Filter out fully-empty placeholder entries.
  for (const raw of drivers) {
    const d = raw as { display_name?: string; mechanism?: string; mechanism_slug?: string; slug?: string };
    const label = d.display_name || d.mechanism || d.mechanism_slug || d.slug;
    if (label && label.trim()) return label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

function parseSessionType(s?: SessionSummary): string {
  // Sessions persisted with explicit session_type win, else parse the
  // `[session_type: X]` tag the older save-session.py wrote into
  // presenting_complaints. Returns a human-readable label.
  const explicit = s?.session_type;
  if (explicit) return explicit.replace(/_/g, " ");
  const m = (s?.presenting_complaints ?? "").match(/\[session_type:\s*([^\]]+)\]/i);
  if (m) return m[1].trim().replace(/_/g, " ");
  return "session";
}

function computeAge(dob?: string | null, ageBand?: string | null): string {
  if (dob) {
    try {
      const d = new Date(dob);
      if (!Number.isNaN(d.getTime())) {
        const t = new Date();
        let a = t.getFullYear() - d.getFullYear();
        const m = t.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
        return `${a}y`;
      }
    } catch {}
  }
  return ageBand ?? "—";
}

interface LabMarker {
  marker_name?: string;
  marker?: string;
  name?: string;
  value?: number | string;
  unit?: string;
  reference_range?: string;
  flag?: "low" | "high" | "suboptimal" | "optimal" | "very_high" | string;
  fm_interpretation?: string;
}

function flagWeight(flag?: string): number {
  // Sort order for the Objective panel — most clinically urgent first.
  switch (flag) {
    case "very_high": return 0;
    case "high": return 1;
    case "low": return 2;
    case "suboptimal": return 3;
    case "optimal": return 9;
    default: return 8;
  }
}

function flagColor(flag?: string): string {
  switch (flag) {
    case "very_high":
    case "high": return "#b91c1c";
    case "low": return "#1d4ed8";
    case "suboptimal": return "#b45309";
    default: return "#6b7280";
  }
}

export default async function SoapNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [client, sessions, allPlans] = await Promise.all([
    loadClientById(id),
    loadClientSessionsAction(id),
    loadAllPlans(),
  ]);

  if (!client) {
    return (
      <FmAppShell
        activeNavId="clients"
        crumbs={[
          { label: "Clients", href: "/clients-v2" },
          { label: "Unknown client" },
        ]}
      >
        <div style={{ padding: 40, fontFamily: "system-ui" }}>
          <p>Client not found.</p>
          <Link href="/clients-v2">← back</Link>
        </div>
      </FmAppShell>
    );
  }

  // Pick session: ?session=<id> if requested, otherwise the latest CLINICAL
  // session (one with AI analysis — drivers or synthesis_notes). Pure
  // intake-form quick_notes have neither and produce a blank SOAP — they
  // shouldn't be the default. Fall back to newest if no clinical session
  // exists.
  const sortedSessions = [...sessions].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  );
  const isClinical = (s: SessionSummary): boolean => {
    const hasDrivers = Array.isArray(s.likely_drivers) && s.likely_drivers.length > 0;
    const hasSynth = typeof s.synthesis_notes === "string" && s.synthesis_notes.trim().length > 0;
    return hasDrivers || hasSynth;
  };
  const session =
    sortedSessions.find((s) => s.session_id === sp.session) ??
    sortedSessions.find(isClinical) ??
    sortedSessions[0];

  // Active plan (drives the "P" section)
  const plans = allPlans.filter((p) => p.client_id === id);
  const statusOf = (p: typeof plans[number]) =>
    (p.status as string | undefined) ?? (p._bucket as string | undefined) ?? "";
  const STATUS_RANK: Record<string, number> = { published: 3, ready_to_publish: 2, draft: 1 };
  const activePlan = plans
    .filter((p) => ACTIVE_STATUSES.has(statusOf(p)))
    .sort((a, b) => (STATUS_RANK[statusOf(b)] ?? 0) - (STATUS_RANK[statusOf(a)] ?? 0))[0];

  const c = client as unknown as Record<string, unknown>;
  const displayName = (c.display_name as string | undefined) ?? (c.client_id as string);
  const dob = c.date_of_birth as string | undefined;
  const ageBand = c.age_band as string | undefined;
  const sex = c.sex as string | undefined;
  const age = computeAge(dob, ageBand);

  // ── Quick-context strip data (the "get me up to speed" bar) ─
  const conditions = asStrArr(c.active_conditions);
  const medications =
    asStrArr(c.current_medications).length > 0
      ? asStrArr(c.current_medications)
      : asStrArr(c.medications);
  const allergies =
    asStrArr(c.known_allergies).length > 0
      ? asStrArr(c.known_allergies)
      : asStrArr(c.allergies);
  const goals = asStrArr(c.goals);
  const dietaryPref = (c.dietary_preference as string | undefined) ?? "";
  const familyHistory = (c.family_history as string | undefined) ?? "";
  const nonNegotiables = (c.non_negotiables as string | undefined) ?? "";

  // ── Subjective — from latest CLINICAL session ─
  const presenting = (session?.presenting_complaints ?? "")
    .replace(/^\[session_type:[^\]]+\]\s*/i, "")
    .replace(/\[Requested labs:[^\]]+\]/gi, "")
    .trim();
  type FivePillarsLike = {
    sleep_quality?: number; sleep_hours?: number;
    stress_level?: number; stress?: number;
    movement_days_per_week?: number; movement_days?: number;
    nutrition_quality?: number;
    connection_quality?: number;
    notes?: string;
  };
  const fp = (session?.five_pillars as FivePillarsLike | undefined) ?? undefined;
  const subjectiveBullets: string[] = [];
  if (fp?.sleep_quality != null)
    subjectiveBullets.push(`Sleep ${fp.sleep_quality}/5${fp.sleep_hours ? ` (${fp.sleep_hours}h)` : ""}`);
  const stressVal = fp?.stress_level ?? fp?.stress;
  if (stressVal != null) subjectiveBullets.push(`Stress ${stressVal}/5`);
  const moveVal = fp?.movement_days_per_week ?? fp?.movement_days;
  if (moveVal != null) subjectiveBullets.push(`Movement ${moveVal}d/wk`);
  if (fp?.nutrition_quality != null) subjectiveBullets.push(`Nutrition ${fp.nutrition_quality}/5`);
  if (fp?.connection_quality != null) subjectiveBullets.push(`Connection ${fp.connection_quality}/5`);

  // ── Objective — measurements + lab markers (uses baked-in FM flag) ─
  const m = (c.measurements as Record<string, unknown> | undefined) ?? {};
  const objectiveBullets: string[] = [];
  const wt = m.weight_kg as number | undefined;
  const ht = m.height_cm as number | undefined;
  if (wt) objectiveBullets.push(`Weight ${wt} kg`);
  if (ht) objectiveBullets.push(`Height ${ht} cm`);
  if (wt && ht) {
    const bmi = Math.round((wt / Math.pow(ht / 100, 2)) * 10) / 10;
    objectiveBullets.push(`BMI ${bmi}`);
  }
  if (m.waist_cm) objectiveBullets.push(`Waist ${m.waist_cm} cm`);
  const bpSys = m.blood_pressure_systolic ?? m.bp_systolic;
  const bpDia = m.blood_pressure_diastolic ?? m.bp_diastolic;
  if (bpSys && bpDia) objectiveBullets.push(`BP ${bpSys}/${bpDia}`);
  else if (m.blood_pressure) objectiveBullets.push(`BP ${m.blood_pressure}`);
  if (m.resting_heart_rate) objectiveBullets.push(`HR ${m.resting_heart_rate}`);

  // Lab markers: use the FM-flag baked in by recompute-lab-markers
  // (high / very_high / low / suboptimal) rather than relying on the
  // client's optional `lab_reference_ranges` override. Show every
  // non-optimal flagged marker — sorted urgent-first.
  const allMarkers = (c.lab_markers as LabMarker[] | undefined) ?? [];
  const flaggedLabs = allMarkers
    .filter((lm) => lm.flag && lm.flag !== "optimal")
    .sort((a, b) => flagWeight(a.flag) - flagWeight(b.flag));

  // v0.75.3 — coach-led physical exam findings. Render the latest entry
  // of each kind on the Objective block. Sorted urgent-first (Beighton
  // hypermobility flag + POTS pattern surface above other findings).
  type ExamFinding = {
    kind: string;
    assessed_at: string;
    result?: Record<string, unknown>;
    notes?: string;
  };
  const allFindings = (c.physical_exam_findings as ExamFinding[] | undefined) ?? [];
  const latestFindingOf = (kind: string): ExamFinding | undefined =>
    allFindings
      .filter((f) => f.kind === kind)
      .sort((a, b) => (b.assessed_at ?? "").localeCompare(a.assessed_at ?? ""))[0];
  const beightonFinding = latestFindingOf("beighton");
  const leanFinding = latestFindingOf("nasa_lean_test");
  const beightonScore = beightonFinding?.result?.score as number | undefined;
  const beightonHypermobile = beightonFinding?.result?.hypermobile as boolean | undefined;
  const leanDeltaHr = leanFinding?.result?.delta_hr as number | undefined;
  const leanSupineHr = leanFinding?.result?.supine_hr as number | undefined;
  const leanPeakHr = leanFinding?.result?.peak_standing_hr as number | undefined;
  const leanPotsFlag = leanFinding?.result?.pots_pattern as boolean | undefined;
  const leanSymptoms = (leanFinding?.result?.symptoms as string[] | undefined) ?? [];
  const hasExamFindings = !!beightonFinding || !!leanFinding;

  // ── Assessment ─
  // Driver from latest clinical session; fall back to intake_insights top
  // hypothesis if no session driver exists yet.
  const primaryDriver = pickPrimaryDriver(session);
  const intakeInsights = (c.intake_insights as
    | { top_hypotheses?: Array<{ label?: string; confidence?: number }>; patterns?: string[]; red_flags?: string[] }
    | undefined) ?? undefined;
  const fallbackHypothesis =
    !primaryDriver && intakeInsights?.top_hypotheses?.length
      ? intakeInsights.top_hypotheses[0]?.label
      : null;
  // Trim synthesis_notes to the first ~600 chars so SOAP stays one A4 page.
  const synthRaw = (session?.synthesis_notes ?? "").trim();
  const synth = synthRaw.length > 700 ? synthRaw.slice(0, 700).trim() + "…" : synthRaw;

  // ── Plan ─
  type SuppItem = { supplement_slug?: string; display_name?: string; dose?: string; timing?: string };
  type PracticeItem = { name?: string } | string;
  type LabOrder = { test?: string; kind?: string; due_in_weeks?: number };
  const supplements = (activePlan?.supplement_protocol as SuppItem[] | undefined) ?? [];
  const practices = (activePlan?.lifestyle_practices as PracticeItem[] | undefined) ?? [];
  const labOrders = (activePlan?.lab_orders as LabOrder[] | undefined) ?? [];
  const nextContact = c.next_contact_date as string | undefined;

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(id)}
      crumbs={[
        { label: "Clients", href: "/clients-v2" },
        { label: displayName, href: `/clients-v2/${id}` },
        { label: "SOAP Note" },
      ]}
    >
      {/* v2 client identity strip (hidden on print via .no-print). */}
      <div
        className="no-print"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border-light)",
          borderRadius: "var(--fm-radius-md)",
          marginBottom: 16,
        }}
      >
        <HeaderAvatar clientId={id} displayName={displayName} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {displayName}
            <span
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                fontFamily: "var(--fm-font-mono)",
                fontWeight: 500,
                marginLeft: 8,
              }}
            >
              {id}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                marginLeft: 10,
              }}
            >
              · SOAP Note
            </span>
          </div>
        </div>
        <Link
          href={`/clients-v2/${id}`}
          style={{
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            textDecoration: "none",
            padding: "5px 10px",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          ← Overview
        </Link>
      </div>

      <SoapPrintButton />

      <div id="soap-printable" style={{ padding: "20px 28px", maxWidth: 820, margin: "0 auto", fontFamily: "Inter, system-ui, sans-serif", color: "#1f2937", lineHeight: 1.45 }}>
        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 10, borderBottom: "2px solid #2b2d42", marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>SOAP Note</h1>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
              {displayName} · {age} · {(sex ?? "").toUpperCase()}
              {dob ? ` · DOB ${fmtDate(dob)}` : ""}
              {" · session "}
              {fmtDate(session?.date)} · {parseSessionType(session)}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af", textAlign: "right" }}>
            Shivani Hari · FM coach
            <br />
            issued {fmtDate(new Date().toISOString())}
          </div>
        </div>

        {/* Session selector (hidden on print) */}
        {sortedSessions.length > 1 && (
          <div className="no-print" style={{ marginBottom: 12, fontSize: 11, color: "#6b7280" }}>
            Viewing session: <strong>{fmtDate(session?.date)}</strong>{" "}
            <span style={{ marginLeft: 8 }}>
              {sortedSessions.slice(0, 5).map((s, i) => (
                <Link
                  key={s.session_id ?? i}
                  href={`/clients-v2/${id}/soap?session=${s.session_id}`}
                  style={{
                    marginRight: 8,
                    fontWeight: s.session_id === session?.session_id ? 700 : 400,
                    color: s.session_id === session?.session_id ? "#2b2d42" : "#6b7280",
                    textDecoration: "underline",
                  }}
                >
                  {fmtDate(s.date)}
                </Link>
              ))}
            </span>
          </div>
        )}

        {/* ── Quick-context strip — the "get me up to speed" bar ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px 18px",
            padding: "10px 12px",
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            marginBottom: 14,
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <div>
            <strong style={{ color: "#6b7280" }}>Conditions:</strong>{" "}
            {conditions.length > 0 ? conditions.join(", ") : <span style={{ color: "#9ca3af", fontStyle: "italic" }}>—</span>}
          </div>
          <div>
            <strong style={{ color: "#6b7280" }}>Medications:</strong>{" "}
            {medications.length > 0 ? medications.join(", ") : <span style={{ color: "#9ca3af", fontStyle: "italic" }}>none</span>}
          </div>
          <div>
            <strong style={{ color: "#6b7280" }}>Allergies:</strong>{" "}
            {allergies.length > 0 ? allergies.join(", ") : <span style={{ color: "#9ca3af", fontStyle: "italic" }}>none reported</span>}
          </div>
          <div>
            <strong style={{ color: "#6b7280" }}>Diet:</strong>{" "}
            {dietaryPref ? dietaryPref : <span style={{ color: "#9ca3af", fontStyle: "italic" }}>—</span>}
            {nonNegotiables ? ` · NN: ${nonNegotiables}` : ""}
          </div>
          {goals.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <strong style={{ color: "#6b7280" }}>Goals:</strong> {goals.join(" · ")}
            </div>
          )}
          {familyHistory && (
            <div style={{ gridColumn: "1 / -1" }}>
              <strong style={{ color: "#6b7280" }}>Family hx:</strong> {familyHistory}
            </div>
          )}
        </div>

        {/* ── S ── */}
        <SoapSection letter="S" name="Subjective" subtitle="Client-reported · this session">
          {presenting ? (
            <p style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{presenting}</p>
          ) : (
            <p style={{ margin: 0, color: "#9ca3af", fontStyle: "italic" }}>No presenting complaints captured this session.</p>
          )}
          {subjectiveBullets.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#4b5563" }}>
              <strong>Five Pillars: </strong>
              {subjectiveBullets.join(" · ")}
            </div>
          )}
        </SoapSection>

        {/* ── O ── */}
        <SoapSection letter="O" name="Objective" subtitle="Measurements + flagged labs + physical exam">
          {objectiveBullets.length > 0 ? (
            <div style={{ marginBottom: 6 }}>{objectiveBullets.join(" · ")}</div>
          ) : (
            <div style={{ color: "#9ca3af", fontStyle: "italic", marginBottom: 6 }}>No measurements on file.</div>
          )}

          {/* v0.75.3 — physical exam findings from coach-led panels */}
          {hasExamFindings && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 3 }}>
                <strong>Physical exam findings:</strong>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {beightonFinding && (
                  <li style={{ marginBottom: 3 }}>
                    <span
                      style={{
                        fontWeight: 600,
                        color: beightonHypermobile ? "#b91c1c" : "#1f2937",
                      }}
                    >
                      🦋 Beighton {beightonScore}/9
                      {beightonHypermobile ? " — positive for hypermobility" : ""}
                    </span>
                    <span style={{ color: "#9ca3af", fontSize: 11 }}>
                      {" "}· assessed {fmtDate(beightonFinding.assessed_at)}
                    </span>
                  </li>
                )}
                {leanFinding && (
                  <li style={{ marginBottom: 3 }}>
                    <span
                      style={{
                        fontWeight: 600,
                        color: leanPotsFlag ? "#b91c1c" : "#1f2937",
                      }}
                    >
                      🩺 NASA lean test
                      {leanDeltaHr != null
                        ? ` — ΔHR +${leanDeltaHr} bpm`
                        : ""}
                      {leanPotsFlag ? ", POTS pattern POSITIVE" : ""}
                    </span>
                    {leanSupineHr != null && leanPeakHr != null && (
                      <div style={{ color: "#6b7280", fontSize: 11, marginLeft: 4 }}>
                        Supine {leanSupineHr} → peak standing {leanPeakHr}
                        {leanSymptoms.length > 0 ? `; symptoms: ${leanSymptoms.join(", ")}` : ""}
                      </div>
                    )}
                    <span style={{ color: "#9ca3af", fontSize: 11 }}>
                      Assessed {fmtDate(leanFinding.assessed_at)}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          )}
          {flaggedLabs.length > 0 ? (
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 3 }}>
                <strong>Flagged labs ({flaggedLabs.length}):</strong>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {flaggedLabs.slice(0, 14).map((l, i) => {
                  const name = l.marker_name ?? l.marker ?? l.name ?? "";
                  const val = l.value != null ? String(l.value) : "";
                  const unit = l.unit ? ` ${l.unit}` : "";
                  const arrow =
                    l.flag === "high" || l.flag === "very_high" ? " ↑" :
                    l.flag === "low" ? " ↓" :
                    l.flag === "suboptimal" ? " ◇" : "";
                  return (
                    <li key={i} style={{ marginBottom: 2 }}>
                      <span style={{ color: flagColor(l.flag), fontWeight: 600 }}>
                        {name} {val}{unit}{arrow}
                      </span>
                      {l.reference_range ? (
                        <span style={{ color: "#9ca3af", fontSize: 11 }}> · {l.reference_range}</span>
                      ) : null}
                    </li>
                  );
                })}
                {flaggedLabs.length > 14 && (
                  <li style={{ color: "#9ca3af", fontStyle: "italic" }}>+{flaggedLabs.length - 14} more</li>
                )}
              </ul>
            </div>
          ) : allMarkers.length > 0 ? (
            <div style={{ color: "#6b7280", fontStyle: "italic" }}>All {allMarkers.length} computed lab markers within FM-optimal range.</div>
          ) : (
            <div style={{ color: "#9ca3af", fontStyle: "italic" }}>No lab markers computed yet.</div>
          )}
        </SoapSection>

        {/* ── A ── */}
        <SoapSection letter="A" name="Assessment" subtitle="Working hypothesis">
          {primaryDriver && (
            <div style={{ marginBottom: 4 }}>
              <strong>Primary driver:</strong> {primaryDriver}
            </div>
          )}
          {!primaryDriver && fallbackHypothesis && (
            <div style={{ marginBottom: 4 }}>
              <strong>Top hypothesis (from intake AI):</strong> {fallbackHypothesis}
            </div>
          )}
          {/* Intake AI patterns + red flags — surface when synthesis is thin. */}
          {(!synth || synth.length < 100) && intakeInsights?.patterns && intakeInsights.patterns.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <strong>Patterns (intake AI):</strong>
              <ul style={{ margin: "2px 0 0", paddingLeft: 18, fontSize: 12 }}>
                {intakeInsights.patterns.slice(0, 3).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {intakeInsights?.red_flags && intakeInsights.red_flags.length > 0 && (
            <div style={{ marginBottom: 4, color: "#b91c1c" }}>
              <strong>Red flags:</strong>
              <ul style={{ margin: "2px 0 0", paddingLeft: 18, fontSize: 12 }}>
                {intakeInsights.red_flags.slice(0, 3).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {synth && (
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
              <strong style={{ color: "#6b7280" }}>Synthesis: </strong>
              {synth}
            </p>
          )}
          {!primaryDriver && !fallbackHypothesis && !synth && conditions.length === 0 && (
            <div style={{ color: "#9ca3af", fontStyle: "italic" }}>No clinical assessment on file yet — run a Full Assessment.</div>
          )}
        </SoapSection>

        {/* ── P ── */}
        <SoapSection letter="P" name="Plan" subtitle="Active protocol">
          {supplements.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <strong>Supplements:</strong>{" "}
              {supplements
                .slice(0, 6)
                .map((s) => `${supplementDisplayName(s) || "?"}${s.dose ? ` ${s.dose}` : ""}${s.timing ? ` (${s.timing})` : ""}`)
                .join("; ")}
              {supplements.length > 6 && ` +${supplements.length - 6} more`}
            </div>
          )}
          {practices.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <strong>Lifestyle:</strong>{" "}
              {practices
                .slice(0, 5)
                .map((p) => (typeof p === "string" ? p : p.name ?? ""))
                .filter(Boolean)
                .join(", ")}
            </div>
          )}
          {labOrders.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <strong>Labs ordered:</strong> {labOrders.map((l) => l.test).filter(Boolean).join(", ")}
            </div>
          )}
          <div>
            <strong>Next contact:</strong> {nextContact ? fmtDate(nextContact) : "to be scheduled"}
          </div>
        </SoapSection>

        <div style={{ marginTop: 14, fontSize: 10, color: "#9ca3af", textAlign: "center" }}>
          Functional medicine SOAP · this is a clinical record, not medical advice without coach review.
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body * { visibility: hidden !important; }
          #soap-printable, #soap-printable * { visibility: visible !important; }
          #soap-printable { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </FmAppShell>
  );
}

function SoapSection({
  letter,
  name,
  subtitle,
  children,
}: {
  letter: string;
  name: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid #e5e7eb", fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#2b2d42", lineHeight: 1, width: 28 }}>{letter}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{name}</div>
          <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ paddingLeft: 36 }}>{children}</div>
    </section>
  );
}
