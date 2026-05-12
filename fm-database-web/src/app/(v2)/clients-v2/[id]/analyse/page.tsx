/**
 * /clients-v2/[id]/analyse — Phase 3 client Analyse tab in the v2 shell.
 *
 * Layout per design C0–C9:
 *   - Client header strip (reuses FmClientHeader)
 *   - 5-tab subnav with Analyse active
 *   - 2-col body: form area (left) + sticky session timeline (right rail)
 *   - Session-type picker above the form area
 *
 * Phase 3 part 1 ships the picker + timeline + the visual shell. Each
 * session-type card routes to the existing legacy form at
 * /clients/[id]?tab=sessions&type=<id>. The legacy forms are already
 * fully wired to save / upload / validate — Phase 3.5 ports them to v2
 * primitives, but routing through to legacy keeps the coach productive
 * today.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  loadClientById,
  loadClientSessions,
  type ClientWithMeta,
} from "@/lib/fmdb/loader-extras";
import {
  parseSessionType,
  type SessionType,
} from "@/lib/fmdb/session-utils";
import {
  FmAppShell,
  FmSessionTypePicker,
  FmSessionTimeline,
  FmPanel,
  type FmSessionTimelineEntry,
  type FmSessionTypeId,
} from "@/components/fm";
import { HeaderAvatar } from "./header-avatar";

export const dynamic = "force-dynamic";

const SESSION_TYPE_MAP: Record<SessionType, FmSessionTypeId> = {
  discovery: "discovery",
  intake: "intake",
  check_in: "checkin",
  quick_note: "quick",
};

const SESSION_TYPE_TITLE: Record<FmSessionTypeId, string> = {
  discovery: "Discovery",
  intake: "Intake",
  full: "Full assessment",
  checkin: "Check-in",
  quick: "Quick note",
};

function relativeAge(dateStr: string | undefined, todayStr: string): string {
  if (!dateStr) return "";
  try {
    const days = Math.round(
      (new Date(todayStr).getTime() - new Date(dateStr).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    if (days < 365) return `${Math.round(days / 30)} mo ago`;
    return `${Math.round(days / 365)} yr ago`;
  } catch {
    return "";
  }
}

function summariseSession(s: Record<string, unknown>): string {
  // Prefer AI synthesis_notes if present; fall back to presenting_complaints.
  const notes =
    (s.synthesis_notes as string) ??
    (s.ai_analysis as Record<string, unknown> | undefined)?.synthesis_notes;
  if (typeof notes === "string" && notes.trim()) {
    return notes.slice(0, 220) + (notes.length > 220 ? "…" : "");
  }
  const complaints =
    typeof s.presenting_complaints === "string"
      ? s.presenting_complaints.replace(/^\[session_type:[^\]]+\]\s*/, "")
      : "";
  if (complaints) {
    return complaints.slice(0, 220) + (complaints.length > 220 ? "…" : "");
  }
  return "—";
}

function extractDrivers(s: Record<string, unknown>): string[] {
  const ai = s.ai_analysis as Record<string, unknown> | undefined;
  const drivers = ai?.likely_drivers as Array<Record<string, unknown>> | undefined;
  if (!drivers) return [];
  return drivers
    .slice(0, 4)
    .map((d) => (d.mechanism_slug as string) ?? (d.name as string))
    .filter((s): s is string => !!s);
}

function extractSupplements(s: Record<string, unknown>): string[] {
  const ai = s.ai_analysis as Record<string, unknown> | undefined;
  const supps = ai?.supplement_suggestions as Array<Record<string, unknown>> | undefined;
  if (!supps) return [];
  return supps
    .slice(0, 6)
    .map((sp) => {
      const slug = sp.supplement_slug as string | undefined;
      const dose = sp.dose as string | undefined;
      return slug ? `${slug}${dose ? ` · ${dose}` : ""}` : "";
    })
    .filter(Boolean);
}

export default async function AnalysePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const todayStr = new Date().toISOString().slice(0, 10);

  const [client, sessions] = await Promise.all([
    loadClientById(id),
    loadClientSessions(id),
  ]);
  if (!client) notFound();

  // Sort newest first
  const sortedDesc = [...sessions].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  );

  // Build timeline entries
  const timeline: FmSessionTimelineEntry[] = sortedDesc.map((s) => {
    const sRec = s as Record<string, unknown>;
    const typed = parseSessionType(sRec.presenting_complaints as string | undefined);
    const visualType = SESSION_TYPE_MAP[typed];
    return {
      id: (s.session_id as string) ?? `${s.date}-${Math.random()}`,
      type: visualType,
      date: (s.date as string) ?? "",
      age: relativeAge(s.date as string | undefined, todayStr),
      title: SESSION_TYPE_TITLE[visualType] ?? "Session",
      summary: summariseSession(sRec),
      drivers: extractDrivers(sRec),
      supplements: extractSupplements(sRec),
      href: `/clients/${id}?tab=sessions&session=${s.session_id ?? ""}`,
    };
  });

  const displayName = client.display_name ?? client.client_id;
  const age = deriveAge(client);
  const lastSession = sortedDesc[0]?.date as string | undefined;

  return (
    <FmAppShell
      activeNavId="clients"
      crumbs={[
        { label: "Clients", href: "/clients" },
        { label: displayName, href: `/clients-v2/${id}` },
        { label: "Analyse" },
      ]}
    >
      {/* Compact client strip — the full FmClientHeader lives on Overview;
          here we just show identity + a back link, since the page is dense. */}
      <div
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
                fontWeight: 500,
                marginLeft: 8,
                fontFamily: "var(--fm-font-mono)",
              }}
            >
              {id}
            </span>
            {age && (
              <span
                style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginLeft: 8 }}
              >
                🎂 {age}
              </span>
            )}
            {client.city && (
              <span
                style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginLeft: 8 }}
              >
                📍 {client.city}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            {lastSession
              ? `Last session: ${lastSession} (${relativeAge(lastSession, todayStr)})`
              : "No sessions on record yet"}
          </div>
        </div>
        <Link
          href={`/clients-v2/${id}`}
          style={{
            fontSize: 11.5,
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

      {/* Sub-nav matching /clients-v2/[id]/page.tsx — Analyse active */}
      <SubNav id={id} active="analyse" />

      {/* 2-col body */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* LEFT — picker + form area */}
        <div style={{ minWidth: 0 }}>
          {timeline.length === 0 ? (
            <EmptyState clientId={id} />
          ) : (
            <FmSessionTypePicker
              hrefMap={{
                discovery: `/clients/${id}?tab=sessions&type=discovery_consultation`,
                intake: `/clients/${id}?tab=sessions&type=intake`,
                full: `/clients/${id}?tab=sessions&type=full_assessment`,
                checkin: `/clients/${id}?tab=sessions&type=check_in`,
                quick: `/clients/${id}?tab=sessions&type=quick_note`,
              }}
            />
          )}

          {/* Form area placeholder — Phase 3.5 fills this with v2 forms.
              For now we direct coach to legacy /clients/[id]?tab=sessions
              where the forms are fully wired. */}
          {timeline.length > 0 && (
            <FmPanel
              title="Recording a session"
              subtitle="Pick a session type above. The form opens in the classic Sessions tab; Phase 3.5 brings the form inside the v2 shell."
              style={{ marginTop: 16 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  background: "var(--fm-bg-cool)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              >
                <span style={{ fontSize: 24 }}>📝</span>
                <div style={{ flex: 1, fontSize: 12 }}>
                  <strong>Forms live in the classic flow today.</strong> Picking a
                  type above routes through to the existing session form which
                  saves to the same place — appears on the timeline here on
                  return.
                </div>
                <Link
                  href={`/clients/${id}?tab=sessions`}
                  style={{
                    background: "var(--fm-primary)",
                    color: "#fff",
                    padding: "6px 12px",
                    fontSize: 11.5,
                    fontWeight: 700,
                    borderRadius: "var(--fm-radius-sm)",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open classic →
                </Link>
              </div>
            </FmPanel>
          )}
        </div>

        {/* RIGHT — sticky session timeline */}
        <div style={{ position: "sticky", top: 24 }}>
          <FmPanel>
            <FmSessionTimeline entries={timeline} />
          </FmPanel>
        </div>
      </div>
    </FmAppShell>
  );
}

function deriveAge(client: ClientWithMeta): number | undefined {
  if (client.date_of_birth) {
    const dob = new Date(client.date_of_birth);
    if (!Number.isNaN(dob.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
      return age;
    }
  }
  return undefined;
}

function EmptyState({ clientId }: { clientId: string }) {
  return (
    <FmPanel
      style={{
        textAlign: "center",
        padding: "32px 24px",
        background: "linear-gradient(135deg, var(--fm-bg-warm), var(--fm-surface) 70%)",
        borderColor: "rgba(255, 107, 53, 0.25)",
        borderWidth: 2,
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 8 }}>🔍</div>
      <h2
        style={{
          fontFamily: "var(--fm-font-display)",
          fontSize: 22,
          fontWeight: 400,
          margin: "0 0 6px",
          letterSpacing: "-0.3px",
          color: "var(--fm-text-primary)",
        }}
      >
        No sessions on record yet
      </h2>
      <p
        style={{
          fontSize: 13,
          color: "var(--fm-text-secondary)",
          margin: "0 0 18px",
          lineHeight: 1.55,
        }}
      >
        Every analyse, intake and check-in lives here. Start with a 15-minute Discovery
        call — chief concern + lab order is enough.
      </p>
      <Link
        href={`/clients/${clientId}?tab=sessions&type=discovery_consultation`}
        style={{
          display: "inline-block",
          background: "var(--fm-primary)",
          color: "#fff",
          padding: "10px 18px",
          fontSize: 13,
          fontWeight: 700,
          borderRadius: "var(--fm-radius-sm)",
          textDecoration: "none",
        }}
      >
        Start a Discovery call →
      </Link>
      <div
        style={{
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          marginTop: 14,
        }}
      >
        Or jump straight to{" "}
        <Link
          href={`/clients/${clientId}?tab=sessions&type=intake`}
          style={{ color: "var(--fm-text-secondary)", textDecoration: "underline" }}
        >
          Intake
        </Link>{" "}
        if you already have history on file.
      </div>
    </FmPanel>
  );
}

function SubNav({ id, active }: { id: string; active: string }) {
  const tabs = [
    { id: "overview", label: "Overview", href: `/clients-v2/${id}` },
    { id: "analyse", label: "Analyse", href: `/clients-v2/${id}/analyse` },
    { id: "plan", label: "Plan", href: `/clients/${id}?tab=plan` },
    { id: "communicate", label: "Communicate", href: `/clients/${id}?tab=plan` },
    { id: "catalogue", label: "Catalogue", href: "/catalogue" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        marginBottom: 20,
        borderBottom: "1px solid var(--fm-border)",
      }}
    >
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: t.id === active ? 700 : 500,
            color:
              t.id === active ? "var(--fm-text-primary)" : "var(--fm-text-tertiary)",
            borderBottom: `2px solid ${t.id === active ? "var(--fm-primary)" : "transparent"}`,
            textDecoration: "none",
            marginBottom: -1,
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
