/**
 * /clients-v2/[id]/handoff — Doctor handoff PDF page.
 *
 * Print-friendly summary the coach hands off to a referring physician /
 * specialist / family doctor. Loads client identity + DOB / age / sex,
 * intake date, active conditions, current medications, allergies, recent
 * lab markers with FM ranges, latest body composition, family history,
 * AI synthesis summary from the most recent session. Coach types a
 * handoff note (persisted per-client in localStorage); hits Print →
 * Chrome "Save as PDF" → clean A4.
 *
 * Designed to slot into the workflow when referring a client to a GP /
 * endocrinologist / cardiologist. Standard SOAP-ish layout so the
 * receiving clinician can scan in under 60 seconds.
 */
import Link from "next/link";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import { loadClientSessionsAction } from "@/app/assess/actions";
import { HandoffActions, HandoffNote } from "./handoff-print";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["draft", "ready_to_publish", "published"]);

function deriveAge(dob: string | undefined, ageBand: string | undefined): string {
  if (dob) {
    try {
      const d = new Date(dob);
      if (!Number.isNaN(d.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - d.getFullYear();
        const m = today.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
        return `${age}y`;
      }
    } catch {
      /* ignore */
    }
  }
  return ageBand || "—";
}

function fmtDate(s?: string): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

interface MarkerEntry {
  marker_name?: string;
  value?: number | string;
  unit?: string;
  reference_range?: string;
  flag?: string;
  fm_interpretation?: string;
  panel?: string;
}

const FLAG_COLOR: Record<string, string> = {
  high: "#c0392b",
  low: "#2471a3",
  watch: "#b8770a",
  suboptimal: "#b8770a",
  optimal: "#1e8449",
  ok: "#1e8449",
};

export default async function HandoffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, sessions, allPlans] = await Promise.all([
    loadClientById(id),
    loadClientSessionsAction(id),
    loadAllPlans(),
  ]);

  if (!client) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <p>Client not found.</p>
        <Link href="/clients">← back</Link>
      </div>
    );
  }

  const c = client as unknown as Record<string, unknown>;
  const displayName = (client.display_name as string | undefined) ?? client.client_id;
  const dob = c.date_of_birth as string | undefined;
  const ageBand = c.age_band as string | undefined;
  const sex = c.sex as string | undefined;
  const age = deriveAge(dob, ageBand);
  const intakeDate = c.intake_date as string | undefined;

  const conditions = asStrArr(c.active_conditions);
  const medsList =
    asStrArr(c.current_medications).length > 0
      ? asStrArr(c.current_medications)
      : asStrArr(c.medications);
  const allergies =
    asStrArr(c.known_allergies).length > 0
      ? asStrArr(c.known_allergies)
      : asStrArr(c.allergies);
  const medicalHistory = asStrArr(c.medical_history);
  const familyHistory = (c.family_history as string | undefined) ?? "";
  const goals = asStrArr(c.goals);

  // Body comp — latest snapshot first, fall back to flat client.measurements
  const flatMeas = (c.measurements as Record<string, unknown> | undefined) ?? {};
  const snaps =
    (c.health_snapshots as Array<{ date?: string; measurements?: Record<string, unknown> }> | undefined) ?? [];
  const latestSnap = snaps
    .filter((s) => s.measurements && Object.keys(s.measurements).length > 0)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .pop()?.measurements ?? {};
  const num = (k: string, alt?: string): number | undefined => {
    const v = latestSnap[k] ?? flatMeas[k] ?? (alt ? flatMeas[alt] : undefined);
    return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
  };
  const weight = num("weight_kg");
  const height = num("height_cm");
  const bmi = weight && height ? +(weight / (height / 100) ** 2).toFixed(1) : undefined;
  const bpSys = num("bp_systolic", "blood_pressure_systolic");
  const bpDia = num("bp_diastolic", "blood_pressure_diastolic");
  const hr = num("hr_bpm", "resting_heart_rate");
  const waist = num("waist_cm");

  // Lab markers (skip OK markers — handoff focuses on what's abnormal)
  const labMarkers = (c.lab_markers as MarkerEntry[] | undefined) ?? [];
  const labMarkersDate = c.lab_markers_date as string | undefined;
  const flaggedLabs = labMarkers.filter(
    (m) => (m.flag ?? "ok").toLowerCase() !== "optimal" && (m.flag ?? "ok").toLowerCase() !== "ok",
  );

  // AI synthesis — most recent session with synthesis_notes
  const synth = sessions
    .filter((s) => s.synthesis_notes && s.synthesis_notes.trim())
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];

  // Active plan (for referenced supplements)
  const plans = allPlans.filter((p) => p.client_id === id);
  const statusOf = (p: typeof plans[number]) =>
    (p.status as string | undefined) ?? (p._bucket as string | undefined) ?? "";
  const STATUS_RANK: Record<string, number> = {
    published: 3,
    ready_to_publish: 2,
    draft: 1,
  };
  const activePlan = plans
    .filter((p) => ACTIVE_STATUSES.has(statusOf(p)))
    .sort((a, b) => (STATUS_RANK[statusOf(b)] ?? 0) - (STATUS_RANK[statusOf(a)] ?? 0))[0];
  const planSupps =
    ((activePlan?.supplement_protocol as Array<{ supplement_slug?: string; dose?: string }> | undefined) ?? [])
      .map((s) => `${s.supplement_slug ?? ""}${s.dose ? ` · ${s.dose}` : ""}`)
      .filter(Boolean);

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Inline styles only — keeps the page resilient to global CSS being
  // hidden by @media print rules. All chrome lives under .no-print.
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FAFAFA",
        padding: "24px 16px 60px",
        fontFamily: "var(--fm-font-display, -apple-system, BlinkMacSystemFont, sans-serif)",
        color: "#1A1A1A",
      }}
      className="fm-v2"
    >
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <HandoffActions clientId={id} />

        {/* Print root — body[data-print-section="handoff-print-root"]
            in handoff-print.tsx scopes @media print to this node. */}
        <div
          id="handoff-print-root"
          style={{
            background: "#fff",
            border: "1px solid #E8E8E8",
            borderRadius: 8,
            padding: "32px 36px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          {/* Page header — coach branding + report meta */}
          <header
            style={{
              borderBottom: "2px solid #2B2D42",
              paddingBottom: 14,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 1.4,
                    color: "#5A5A5A",
                    fontWeight: 700,
                  }}
                >
                  Functional medicine handoff
                </div>
                <h1
                  style={{
                    margin: "4px 0 2px",
                    fontFamily: '"Libre Baskerville", Georgia, serif',
                    fontWeight: 400,
                    fontSize: 24,
                    letterSpacing: "-0.3px",
                  }}
                >
                  {displayName}
                </h1>
                <div style={{ fontSize: 12, color: "#5A5A5A" }}>
                  Prepared by Shivani Hari · Functional Medicine Coach (FMCA)
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#5A5A5A",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                <div>
                  <strong>{today}</strong>
                </div>
                <div style={{ marginTop: 2 }}>
                  Client ID: <span style={{ fontFamily: "ui-monospace, monospace" }}>{id}</span>
                </div>
              </div>
            </div>
          </header>

          {/* 1 · Demographics + contact */}
          <SectionH>1 · Patient overview</SectionH>
          <KvGrid
            items={[
              ["Age", age],
              ["Sex", sex ?? "—"],
              ["Date of birth", fmtDate(dob)],
              ["Intake date", fmtDate(intakeDate)],
              ["Email", (c.email as string | undefined) || "—"],
              [
                "Mobile",
                (c.mobile_number as string | undefined) ?? (c.mobile as string | undefined) ?? "—",
              ],
            ]}
          />

          {/* 2 · Active conditions / Medications / Allergies */}
          <SectionH>2 · Active conditions</SectionH>
          {conditions.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul style={listStyle}>
              {conditions.map((cd, i) => (
                <li key={i}>{cd}</li>
              ))}
            </ul>
          )}

          <SectionH>3 · Current medications</SectionH>
          {medsList.length === 0 ? (
            <Empty>None reported.</Empty>
          ) : (
            <ul style={listStyle}>
              {medsList.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}

          <SectionH>4 · Allergies</SectionH>
          {allergies.length === 0 ? (
            <Empty>None reported.</Empty>
          ) : (
            <ul style={listStyle}>
              {allergies.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}

          {/* 5 · Medical history + family hx */}
          <SectionH>5 · Medical history</SectionH>
          {medicalHistory.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul style={listStyle}>
              {medicalHistory.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}

          {familyHistory.trim() && (
            <>
              <SectionH>6 · Family history</SectionH>
              <p style={{ fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>{familyHistory}</p>
            </>
          )}

          {/* 7 · Body composition + vitals */}
          <SectionH>7 · Body composition &amp; vitals</SectionH>
          <KvGrid
            items={[
              ["Weight", weight != null ? `${weight} kg` : "—"],
              ["Height", height != null ? `${height} cm` : "—"],
              ["BMI", bmi != null ? `${bmi}` : "—"],
              ["Waist", waist != null ? `${waist} cm` : "—"],
              ["BP", bpSys && bpDia ? `${bpSys} / ${bpDia} mmHg` : "—"],
              ["Resting HR", hr != null ? `${hr} bpm` : "—"],
            ]}
          />

          {/* 8 · Recent labs — flagged only, with FM optimal vs lab ranges */}
          <SectionH>
            8 · Recent labs — flagged ({flaggedLabs.length})
            {labMarkersDate && (
              <span style={{ fontWeight: 400, color: "#5A5A5A", marginLeft: 8 }}>
                values from {fmtDate(labMarkersDate)}
              </span>
            )}
          </SectionH>
          {flaggedLabs.length === 0 ? (
            <Empty>All markers within range, or no labs on file.</Empty>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 11.5,
                marginTop: 4,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1.5px solid #2B2D42" }}>
                  <Th>Marker</Th>
                  <Th>Value</Th>
                  <Th>Reference (FM optimal / lab)</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {flaggedLabs.map((m, i) => {
                  const flag = (m.flag ?? "").toLowerCase();
                  return (
                    <tr
                      key={i}
                      style={{
                        borderBottom: "1px solid #F0F0F0",
                        verticalAlign: "top",
                      }}
                    >
                      <Td>
                        <strong>{m.marker_name}</strong>
                      </Td>
                      <Td>
                        <span style={{ color: FLAG_COLOR[flag] ?? "#1A1A1A", fontWeight: 700 }}>
                          {m.value}
                          {m.unit ? ` ${m.unit}` : ""}
                        </span>
                      </Td>
                      <Td style={{ color: "#5A5A5A", fontFamily: "ui-monospace, monospace", fontSize: 10.5 }}>
                        {m.reference_range ?? "—"}
                      </Td>
                      <Td style={{ color: "#5A5A5A", fontSize: 11 }}>
                        {m.fm_interpretation ?? ""}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: 9.5, color: "#999", marginTop: 6, fontStyle: "italic" }}>
            FM optimal ranges are tighter than conventional lab cut-offs. Values flagged
            against the FM optimal band, not just the lab&apos;s reference range.
          </p>

          {/* 9 · FM synthesis (educational, not diagnostic) */}
          {synth?.synthesis_notes && (
            <>
              <SectionH>9 · FM synthesis (coach assessment)</SectionH>
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.6,
                  background: "#F5F5F5",
                  border: "1px solid #E8E8E8",
                  borderRadius: 6,
                  padding: "12px 14px",
                  whiteSpace: "pre-wrap",
                  color: "#1A1A1A",
                }}
              >
                {synth.synthesis_notes}
              </div>
              <p style={{ fontSize: 9.5, color: "#999", marginTop: 4, fontStyle: "italic" }}>
                Coach&apos;s working hypothesis — informational only. Not a medical diagnosis.
              </p>
            </>
          )}

          {/* 10 · Supplements currently on the protocol */}
          {planSupps.length > 0 && (
            <>
              <SectionH>10 · Current supplements ({planSupps.length})</SectionH>
              <ul style={listStyle}>
                {planSupps.map((s, i) => (
                  <li key={i} style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                    {s}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* 11 · Goals */}
          {goals.length > 0 && (
            <>
              <SectionH>11 · Client goals</SectionH>
              <ul style={listStyle}>
                {goals.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </>
          )}

          {/* 12 · Coach handoff note */}
          <SectionH>12 · Coach handoff note</SectionH>
          <HandoffNote clientId={id} />

          {/* Signature / footer block */}
          <div
            style={{
              marginTop: 40,
              paddingTop: 16,
              borderTop: "1px solid #E8E8E8",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 32,
            }}
          >
            <div>
              <div
                style={{
                  borderBottom: "1px solid #999",
                  height: 28,
                  marginBottom: 6,
                }}
              />
              <div style={{ fontSize: 10.5, color: "#5A5A5A" }}>
                Shivani Hari, FMCA · Functional Medicine Coach
              </div>
            </div>
            <div>
              <div
                style={{
                  borderBottom: "1px solid #999",
                  height: 28,
                  marginBottom: 6,
                }}
              />
              <div style={{ fontSize: 10.5, color: "#5A5A5A" }}>
                Receiving clinician (date, name, signature)
              </div>
            </div>
          </div>
          <p
            style={{
              marginTop: 22,
              fontSize: 9.5,
              color: "#999",
              fontStyle: "italic",
              lineHeight: 1.55,
            }}
          >
            This document is a coaching handover, not a medical record. The coach&apos;s
            scope is education and lifestyle support — diagnosis, prescription and lab
            interpretation remain with the treating clinician.
          </p>
        </div>
      </div>

      {/* Print rules — restrict to the handoff card, drop all UI chrome,
          tighten typography to a A4-friendly density. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 14mm 14mm 14mm; }
          html, body { background: #fff !important; }
          body > * { visibility: hidden !important; }
          body[data-print-section="handoff-print-root"] #handoff-print-root,
          body[data-print-section="handoff-print-root"] #handoff-print-root * {
            visibility: visible !important;
          }
          #handoff-print-root {
            position: absolute !important;
            top: 0; left: 0; right: 0;
            box-shadow: none !important;
            border: 0 !important;
            border-radius: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
        }
        .print-only { display: none; }
      `}</style>
    </div>
  );
}

function SectionH({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: '"Libre Baskerville", Georgia, serif',
        fontWeight: 400,
        fontSize: 14,
        margin: "20px 0 8px",
        letterSpacing: "-0.1px",
        color: "#1A1A1A",
        borderBottom: "1px solid #E8E8E8",
        paddingBottom: 4,
      }}
    >
      {children}
    </h2>
  );
}

function KvGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 10,
        marginBottom: 2,
      }}
    >
      {items.map(([k, v], i) => (
        <div
          key={i}
          style={{
            padding: "7px 10px",
            background: "#FAFAFA",
            border: "1px solid #F0F0F0",
            borderRadius: 4,
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontWeight: 700,
              color: "#999",
            }}
          >
            {k}
          </div>
          <div style={{ fontSize: 12, marginTop: 1 }}>{v || "—"}</div>
        </div>
      ))}
    </div>
  );
}

const listStyle: React.CSSProperties = {
  margin: "4px 0 0 0",
  paddingLeft: 18,
  fontSize: 12.5,
  lineHeight: 1.55,
};

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11.5, color: "#999", margin: "2px 0 0", fontStyle: "italic" }}>
      {children}
    </p>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        fontSize: 9.5,
        textTransform: "uppercase",
        letterSpacing: 0.7,
        fontWeight: 700,
        color: "#5A5A5A",
        padding: "5px 8px 5px 0",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td
      style={{
        padding: "6px 8px 6px 0",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
