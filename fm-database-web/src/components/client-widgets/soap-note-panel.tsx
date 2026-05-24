"use client";

/**
 * SOAPNotePanel — renders the most recent intake session as a
 * standard medical SOAP note (Subjective / Objective / Assessment / Plan).
 *
 * Mounted on the Client Overview tab. Two surfaces:
 *  - Inline panel showing the latest intake session in SOAP format
 *  - 🖨 Print button that isolates the SOAP content for a clean PDF export
 *
 * Why SOAP: standard medical documentation format. Any GP / specialist /
 * hospital can read it. Sharing a SOAP note with a referring physician
 * is dramatically faster than handing over the FM-jargon brief.
 */

import { useMemo, useState } from "react";
import type { SessionSummary } from "@/lib/server-actions/assess";
import { supplementDisplayName } from "@/lib/fmdb/supplement-display";

interface Props {
  client: Record<string, unknown>;
  clientName: string;
  clientId: string;
  sessions: SessionSummary[];
}

const SECTION_HEADER = "text-[11px] font-semibold uppercase tracking-widest text-gray-600 mt-1";

const PRINT_CSS = `
.soap-print-only { display: none; }
@media print {
  body > * { display: none !important; }
  body > #soap-print-root { display: block !important; }
  #soap-print-root > * { display: block !important; }
  .soap-no-print { display: none !important; }
  .soap-print-only { display: block !important; }
  .soap-content {
    font-family: Georgia, serif !important;
    font-size: 11pt !important;
    line-height: 1.55 !important;
    color: #111 !important;
    padding: 18mm 18mm !important;
    max-width: 100% !important;
  }
  .soap-section-h {
    font-family: Arial, sans-serif !important;
    font-size: 9pt !important;
    letter-spacing: 0.16em !important;
    text-transform: uppercase !important;
    color: #555 !important;
    border-bottom: 1px solid #ccc !important;
    padding-bottom: 2pt !important;
    margin: 14pt 0 6pt !important;
  }
  .soap-page-header { page-break-after: avoid; }
}
`;

/** Boilerplate phrases that some intake-submit paths write into
 *  presenting_complaints as a placeholder. They're not actual complaints —
 *  SOAP should treat them as empty so the section falls back to a
 *  meaningful summary (goals / active conditions). */
const STUB_COMPLAINT_PHRASES = new Set<string>([
  "client-submitted intake questionnaire.",
  "client-submitted intake questionnaire",
  "cap-test",
  "test",
]);

function stripTag(text: string): string {
  // B7 fix 2026-05-23 — Strip ALL leading bracketed tags, not just one.
  // Geetika cl-006 had presenting_complaints "[session_type: intake]
  // [session_type: intake] " (duplicated), and the old single-strip
  // regex left the SECOND tag rendering as the chief complaint.
  let out = text;
  while (true) {
    const next = out.replace(/^\[[^\]]+\]\s*/i, "");
    if (next === out) break;
    out = next;
  }
  out = out.trim();
  // Drop placeholder-only complaints — the SOAP renderer's caller will
  // see this as null and fall back to a section-empty state, which
  // routes the eye to the goals + active conditions below instead.
  if (STUB_COMPLAINT_PHRASES.has(out.toLowerCase())) return "";
  return out;
}

function pickIntake(sessions: SessionSummary[]): SessionSummary | null {
  // Most recent intake; fall back to discovery if no intake exists
  const intakes = sessions.filter((s) => s.session_type === "intake");
  if (intakes.length > 0) return intakes[0]; // sessions arrive newest-first
  const discovery = sessions.filter((s) => s.session_type === "discovery");
  return discovery[0] ?? null;
}

/** D10 fix 2026-05-23 — symptom + topic slugs come back as kebab-case
 *  (e.g. "joint-pain", "white-tongue-coating", "daytime-fatigue").
 *  Rendering them raw on a SOAP note shared with a referring clinician
 *  reads unprofessionally. This is a simple title-case fallback that
 *  doesn't need to round-trip through the catalogue — catalogue
 *  display_name is usually just the slug with hyphens swapped, so
 *  reconstruction is faithful for the overwhelming majority of cases.
 *  Special-cases preserve common medical capitalisations (FM, GI, IBS,
 *  GERD, NAFLD, MCAS, PCOS, T1D, T2D, OCD, PTSD, ADHD, ME/CFS, HPA, IBD,
 *  IBS, IBS-D, IBS-C, SIBO, OCP, HRT, etc.) — extend as needed. */
function slugToDisplay(slug: string): string {
  if (!slug) return slug;
  const KEEP_UPPER = new Set([
    "fm","gi","ibs","gerd","nafld","mcas","pcos","t1d","t2d","ocd","ptsd",
    "adhd","ibd","sibo","ocp","hrt","copd","cfs","mecfs","ms","ra","sle",
    "hpa","hpv","tb","uti","sti","stf","sars","aids","hiv","obg","pms",
    "pmdd","tia","mi","ecg","ekg","mri","ct","crp","tsh","fmla",
  ]);
  return slug
    .split("-")
    .map((part, idx) => {
      const lc = part.toLowerCase();
      if (KEEP_UPPER.has(lc)) return lc.toUpperCase();
      if (idx === 0) return lc.charAt(0).toUpperCase() + lc.slice(1);
      return lc;
    })
    .join(" ");
}

function fmtDate(s?: string): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

export function SOAPNotePanel({ client, clientName, clientId, sessions }: Props) {
  void clientId;
  const [open, setOpen] = useState(false);
  const session = useMemo(() => pickIntake(sessions), [sessions]);

  if (!session) return null;  // no intake or discovery session yet

  // Subjective — what the client reports
  const cleanComplaints = session.presenting_complaints
    ? stripTag(session.presenting_complaints)
    : null;
  const symptoms = session.selected_symptoms ?? [];
  const topics = session.selected_topics ?? [];

  // Objective — measurable: meds, conditions, labs
  const conditions = (client.active_conditions as string[] | undefined) ?? [];
  const medHistory = (client.medical_history as string[] | undefined) ?? [];
  const meds = (client.current_medications as string[] | undefined) ?? (client.medications as string[] | undefined) ?? [];
  const allergies = (client.known_allergies as string[] | undefined) ?? (client.allergies as string[] | undefined) ?? [];
  const ageBand = (client.age_band as string | undefined) ?? "";
  const sex = (client.sex as string | undefined) ?? "";
  const labs = session.requested_labs ?? [];
  const fp = session.five_pillars;

  // Assessment — what the AI inferred
  const drivers = session.likely_drivers ?? [];
  const synthesis = session.synthesis_notes ?? "";

  // Plan — what to do
  const supplements = session.supplement_suggestions ?? [];
  const planSlug = session.generated_plan_slug ?? null;

  const handlePrint = () => window.print();

  const SOAPBody = (
    <div className="soap-content text-sm space-y-5">
      {/* Header */}
      <div className="soap-page-header border-b-2 border-gray-700 pb-3 space-y-0.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold" style={{ fontFamily: "Georgia, serif" }}>
            {clientName}
          </h1>
          <span className="text-xs text-gray-600 tabular-nums">SOAP · {fmtDate(session.date)}</span>
        </div>
        <p className="text-sm text-gray-600">
          {[ageBand, sex && (sex === "F" ? "Female" : sex === "M" ? "Male" : sex)].filter(Boolean).join(" · ")}
          {" · "}Functional Medicine intake by Shivani Hariharan
        </p>
      </div>

      {/* S — Subjective. When a session has no real chief complaint
          text (placeholder or only-tags), fall back to the client's
          goals — that's the best summary of "what they came for" we
          have. Prevents the empty-S section common on client-submitted
          intakes where the form path writes a sentinel string. */}
      {(() => {
        const goalsList = (client.goals as string[] | undefined) ?? [];
        const showGoalsAsComplaint = !cleanComplaints && goalsList.length > 0;
        const headerLabel = cleanComplaints ? "Chief complaints" : "What they came for (goals)";
        return (
          <section className="space-y-1.5">
            <h2 className="soap-section-h text-xs font-bold uppercase tracking-widest text-gray-700 border-b border-gray-200 pb-1">
              S — Subjective
            </h2>
            {(cleanComplaints || showGoalsAsComplaint) && (
              <div className="space-y-1">
                <div className={SECTION_HEADER}>{headerLabel}</div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {cleanComplaints || goalsList.join(" · ")}
                </p>
              </div>
            )}
            {symptoms.length > 0 && (
              <div className="space-y-1">
                <div className={SECTION_HEADER}>Reported symptoms</div>
                <p className="text-sm text-gray-800">{symptoms.map(slugToDisplay).join(" · ")}</p>
              </div>
            )}
            {topics.length > 0 && (
              <div className="space-y-1">
                <div className={SECTION_HEADER}>Clinical areas raised</div>
                <p className="text-sm text-gray-800">{topics.map(slugToDisplay).join(", ")}</p>
              </div>
            )}
            {!cleanComplaints && !showGoalsAsComplaint && symptoms.length === 0 && topics.length === 0 && (
              <p className="text-xs italic text-gray-500">No subjective data captured.</p>
            )}
          </section>
        );
      })()}

      {/* O — Objective */}
      <section className="space-y-1.5">
        <h2 className="soap-section-h text-xs font-bold uppercase tracking-widest text-gray-700 border-b border-gray-200 pb-1">
          O — Objective
        </h2>
        {conditions.length > 0 && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Active diagnoses</div>
            <p className="text-sm text-gray-800">{conditions.join(", ")}</p>
          </div>
        )}
        {medHistory.length > 0 && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Past medical history</div>
            <p className="text-sm text-gray-800">{medHistory.join(", ")}</p>
          </div>
        )}
        {meds.length > 0 && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Current medications</div>
            <p className="text-sm text-gray-800">{meds.join(", ")}</p>
          </div>
        )}
        {allergies.length > 0 && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Known allergies / reactions</div>
            <p className="text-sm text-gray-800">{allergies.join(", ")}</p>
          </div>
        )}
        {fp && Object.values(fp).some((v) => v != null) && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Five Pillars (self-reported)</div>
            <p className="text-sm text-gray-800">
              {[
                fp.sleep_quality != null ? `Sleep ${fp.sleep_quality}/5${fp.sleep_hours != null ? ` (${fp.sleep_hours}h)` : ""}` : null,
                fp.stress_level != null ? `Stress ${fp.stress_level}/5` : null,
                fp.movement_days_per_week != null ? `Movement ${fp.movement_days_per_week}/7d` : null,
                fp.nutrition_quality != null ? `Nutrition ${fp.nutrition_quality}/5` : null,
                fp.connection_quality != null ? `Connection ${fp.connection_quality}/5` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
        )}
        {labs.length > 0 && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Labs ordered</div>
            <p className="text-sm text-gray-800">{labs.join(" · ")}</p>
          </div>
        )}
        {conditions.length === 0 && medHistory.length === 0 && meds.length === 0 && allergies.length === 0 && !fp && labs.length === 0 && (
          <p className="text-xs italic text-gray-500">No objective data captured.</p>
        )}
      </section>

      {/* A — Assessment */}
      <section className="space-y-1.5">
        <h2 className="soap-section-h text-xs font-bold uppercase tracking-widest text-gray-700 border-b border-gray-200 pb-1">
          A — Assessment
        </h2>
        {synthesis && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Clinical synthesis</div>
            <p className="text-sm text-gray-800 italic leading-relaxed whitespace-pre-wrap">{synthesis}</p>
          </div>
        )}
        {drivers.length > 0 && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Likely drivers (functional medicine framing)</div>
            <ol className="list-decimal list-inside space-y-1.5 mt-1">
              {drivers.map((d, i) => {
                // B6 fix 2026-05-23 — sessions write the label as `driver`
                // (free-text), older sessions sometimes used `mechanism` or
                // `mechanism_slug`. Check all three before falling back to
                // a placeholder. Sudarshan cl-008 had all drivers named
                // "Driver 1 / Driver 2 / Driver 3..." because his session
                // used `driver` and the renderer only knew about
                // `mechanism` / `mechanism_slug`.
                const dx = d as Record<string, unknown>;
                const name =
                  (typeof dx.driver === "string" && dx.driver) ||
                  (typeof dx.mechanism === "string" && dx.mechanism) ||
                  (typeof dx.mechanism_slug === "string" && dx.mechanism_slug) ||
                  `Driver ${i + 1}`;
                // Rationale field also varies — Sudarshan's sessions use
                // `rationale`, others use `reasoning`. Read both.
                const explain =
                  (typeof dx.reasoning === "string" && dx.reasoning) ||
                  (typeof dx.rationale === "string" && dx.rationale) ||
                  "";
                const conf = d.confidence != null
                  ? ` (${typeof d.confidence === "number" ? `${Math.round(d.confidence * 100)}% confidence` : d.confidence})`
                  : "";
                return (
                  <li key={i} className="text-sm text-gray-800">
                    <span className="font-semibold">{name}</span>
                    <span className="text-gray-600 text-xs">{conf}</span>
                    {explain && (
                      <span className="block ml-5 text-xs text-gray-700 mt-0.5 leading-snug">{explain}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {!synthesis && drivers.length === 0 && (
          <p className="text-xs italic text-gray-500">No AI assessment captured for this session.</p>
        )}
      </section>

      {/* P — Plan */}
      <section className="space-y-1.5">
        <h2 className="soap-section-h text-xs font-bold uppercase tracking-widest text-gray-700 border-b border-gray-200 pb-1">
          P — Plan
        </h2>
        {supplements.length > 0 && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Supplement protocol (initial)</div>
            <ul className="list-disc list-inside space-y-1 mt-1">
              {supplements.map((sp, i) => {
                const name = supplementDisplayName(sp) || `Supplement ${i + 1}`;
                const dose = sp.dose ? ` · ${sp.dose}` : "";
                const timing = sp.timing ? ` · ${sp.timing}` : "";
                return (
                  <li key={i} className="text-sm text-gray-800">
                    <span className="font-medium">{name}</span>
                    <span className="text-gray-600 text-xs">{dose}{timing}</span>
                    {sp.rationale && (
                      <span className="block ml-5 text-xs text-gray-700 mt-0.5 leading-snug italic">{sp.rationale}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {labs.length > 0 && (
          <div className="space-y-1">
            <div className={SECTION_HEADER}>Lab work to obtain</div>
            <p className="text-sm text-gray-800">{labs.join(" · ")}</p>
          </div>
        )}
        <div className="space-y-1">
          <div className={SECTION_HEADER}>Follow-up</div>
          <p className="text-sm text-gray-800">
            {planSlug
              ? `Structured care plan generated (${planSlug}). Recheck in 8–12 weeks pending lab return + protocol response.`
              : "Care plan to be authored from this session. Recheck in 8–12 weeks."}
          </p>
        </div>
      </section>

      <div className="border-t pt-3 mt-6 text-[10px] text-center text-emerald-700">
        Generated by HealWithShivaniH · healwithshivanih.com · Confidential — for the named clinician only
      </div>
    </div>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="rounded-xl border-2 border-slate-200 bg-slate-50/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap soap-no-print">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 flex-wrap text-left"
          >
            <span className="text-base font-semibold text-slate-800">📋 SOAP note</span>
            <span className="text-[11px] text-slate-600">
              · From {fmtDate(session.date)} {session.session_type === "discovery" ? "discovery" : "intake"}
            </span>
            <span className="text-[10px] text-slate-500 ml-1">{open ? "▲" : "▼"}</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
            style={{ background: "#2B2D42" }}
            title="Cmd/Ctrl+P → Save as PDF — share with referring clinician"
          >
            🖨 Print / Save as PDF
          </button>
        </div>

        {open && (
          <div className="rounded-lg border bg-white p-4 max-h-[600px] overflow-y-auto soap-no-print">
            {SOAPBody}
          </div>
        )}

        {/* Always rendered for print isolation — hidden from screen via CSS */}
        <div id="soap-print-root" className="soap-print-only">
          {SOAPBody}
        </div>
      </div>
    </>
  );
}
