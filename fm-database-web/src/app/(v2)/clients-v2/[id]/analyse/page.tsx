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
import { loadClientJourney } from "@/lib/fmdb/client-journey";
import { computeNextSessionDue, humanDueLabel } from "@/lib/fmdb/next-session";
import { loadAllPlans } from "@/lib/fmdb/loader";
import {
  FmAppShell,
  FmSessionTypePicker,
  FmSessionTimeline,
  FmPanel,
  type FmSessionTimelineEntry,
  type FmSessionTypeId,
} from "@/components/fm";
import { HeaderAvatar } from "./header-avatar";
import { clientQuickActions } from "../client-quick-actions";
import { BookSessionButton } from "@/components/client-widgets/book-session-modal";
import { SendDiscoveryLabsButton } from "./send-discovery-labs-button";
import { clientSubnavTabs } from "../client-subnav";
import { formatLongDate } from "@/lib/fmdb/format-date";

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

  const [client, sessions, journey, allPlans] = await Promise.all([
    loadClientById(id),
    loadClientSessions(id),
    loadClientJourney(id, todayStr),
    loadAllPlans(),
  ]);
  if (!client) notFound();

  // Active plan for this client — needed for next-session-due derivation
  // (uses plan_period_recheck_date if approaching).
  const ACTIVE_BUCKETS_NEXT = new Set([
    "draft",
    "ready_to_publish",
    "published",
  ]);
  const activePlanForNext =
    (allPlans as unknown as Array<Record<string, unknown>>).find(
      (p) =>
        p.client_id === id &&
        ACTIVE_BUCKETS_NEXT.has(
          (p._bucket as string | undefined) ??
            (p.status as string | undefined) ??
            "",
        ),
    ) ?? null;

  // Compute next session due — used by the banner above the picker AND
  // by the dashboard's "schedule reminders" widget (separately).
  const nextSessionDue = computeNextSessionDue({
    client: client as Record<string, unknown>,
    sessions: sessions as Array<Record<string, unknown>>,
    activePlan: activePlanForNext,
    todayIso: todayStr,
  });

  // Translate journey state → per-session-card completion. Discovery is
  // considered done when the journey says so (or transitively when intake
  // is done, since you can't have an intake without a discovery —
  // computed inside loadClientJourney). Mirrors the "Run X" → "Review X"
  // relabelling the picker does.
  const journeyDiscovery = journey.steps.find((s) => s.id === "discovery");
  const journeyIntake = journey.steps.find((s) => s.id === "intake");
  // "Intake / full assessment done" = a COACH intake session exists — a
  // session with the LITERAL [session_type: intake] (or legacy
  // [session_type: full_assessment]) tag. Must not count the client's
  // online questionnaire or untagged legacy notes (parseSessionType
  // defaults those to "intake"). Mirrors dashboard-v2 computeSignal +
  // loadClientJourney so every surface agrees on "intake done".
  const fullDone = sessions.some((s) =>
    /\[session_type:\s*(intake|full_assessment)\]/i.test(
      String((s as Record<string, unknown>).presenting_complaints ?? ""),
    ),
  );
  const completionState = {
    discovery: (journeyDiscovery?.status === "done" || journeyIntake?.status === "done")
      ? ("done" as const) : ("pending" as const),
    intake: journeyIntake?.status === "done" ? ("done" as const) : ("pending" as const),
    full: fullDone ? ("done" as const) : ("pending" as const),
    checkin: ("pending" as const),
    quick: ("pending" as const),
  };

  // Recommend the next session card. The journey's nextStep label tells
  // us which kind, but its href points at a specific surface — map back
  // to picker IDs.
  let recommendedId: FmSessionTypeId | null = null;
  const ns = journey.nextStep;
  if (ns) {
    if (ns.href.includes("/analyse/discovery")) recommendedId = "discovery";
    else if (ns.href.includes("/intake-view") || ns.href.includes("/analyse/intake"))
      recommendedId = "intake";
    else if (ns.href.includes("/analyse/full")) recommendedId = "full";
    else if (ns.href.includes("/analyse/checkin")) recommendedId = "checkin";
  }

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
      // Pass the full ISO created_at so the timeline can render HH:MM
      // IST — distinguishes multiple synthesis runs on the same day.
      timestamp: (sRec.created_at as string | undefined) ?? undefined,
      age: relativeAge(s.date as string | undefined, todayStr),
      title: SESSION_TYPE_TITLE[visualType] ?? "Session",
      summary: summariseSession(sRec),
      drivers: extractDrivers(sRec),
      supplements: extractSupplements(sRec),
      href: `/clients-v2/${id}/sessions?sid=${s.session_id ?? ""}`,
    };
  });

  const displayName = client.display_name ?? client.client_id;
  const age = deriveAge(client);
  const lastSession = sortedDesc[0]?.date as string | undefined;

  // Most-recent intake / discovery session — gets its own header strip.
  // The data layer only stores two assessment-class types: "discovery"
  // (15-min pre-call lab order) and "intake" (the programme intake form
  // + full assessment session are both aliased to "intake" by
  // parseSessionType). Coach feedback 2026-05-19: the strip was
  // labelling intake-form submissions as "Last full assessment" which
  // confused her — fixed by relabelling honestly ("Last intake" vs
  // "Last discovery call") instead of inventing a session type that
  // doesn't exist at the data layer.
  const lastAssessment = sortedDesc.find((s) => {
    const t = parseSessionType(
      (s as Record<string, unknown>).presenting_complaints as string | undefined,
    );
    return t === "intake" || t === "discovery";
  });
  const lastAssessmentDate = lastAssessment?.date as string | undefined;
  const lastAssessmentSid = lastAssessment?.session_id as string | undefined;
  const lastAssessmentType = lastAssessment
    ? parseSessionType(
        (lastAssessment as Record<string, unknown>).presenting_complaints as
          | string
          | undefined,
      )
    : null;

  // Discovery-session lab list — extracted from the session so we can
  // surface a "📤 Send labs to client" panel right next to the discovery
  // strip. Older sessions (saved before requested_labs became a top-level
  // field) embed the list inside coach_notes as "[Requested labs: X, Y]";
  // we parse both shapes here so the button works for ALL discovery
  // sessions on disk.
  const discoveryRequestedLabs: string[] = (() => {
    if (!lastAssessment || lastAssessmentType !== "discovery") return [];
    const top = (lastAssessment as { requested_labs?: unknown }).requested_labs;
    if (Array.isArray(top) && top.length > 0) {
      return top.map((s) => String(s)).filter(Boolean);
    }
    const notes = (lastAssessment as { coach_notes?: string }).coach_notes ?? "";
    const m = notes.match(/\[Requested labs:\s*([^\]]+)\]/);
    if (m) {
      return m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  })();

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(id)}
      crumbs={[
        { label: "Clients", href: "/clients-v2" },
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
              ? `Last session: ${formatLongDate(lastSession)} (${relativeAge(lastSession, todayStr)})`
              : "No sessions on record yet"}
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

      {/* Last full assessment / intake header strip — coach asked to
          see "date of last assessment + link to open" at the top of
          this tab. Linked to the Timeline inspector with the session
          pre-selected. Hidden when no assessment on file. */}
      {lastAssessmentDate && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            background: "rgba(46, 110, 213, 0.06)",
            border: "1px solid rgba(46, 110, 213, 0.30)",
            borderRadius: "var(--fm-radius-md)",
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 14 }}>
            {lastAssessmentType === "discovery" ? "🔍" : "📝"}
          </span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
            <strong style={{ color: "var(--fm-text-primary)" }}>
              Last{" "}
              {lastAssessmentType === "discovery" ? "discovery call" : "intake"}
              :
            </strong>{" "}
            <span style={{ color: "var(--fm-text-secondary)" }}>
              {formatLongDate(lastAssessmentDate)} ·{" "}
              {relativeAge(lastAssessmentDate, todayStr)}
            </span>
          </div>
          <Link
            href={`/clients-v2/${id}/sessions?sid=${lastAssessmentSid ?? ""}`}
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              background: "var(--fm-primary)",
              textDecoration: "none",
              padding: "6px 12px",
              borderRadius: "var(--fm-radius-sm)",
              whiteSpace: "nowrap",
            }}
          >
            {lastAssessmentType === "discovery"
              ? "Open discovery →"
              : "Open intake →"}
          </Link>
          {/* Discovery lab list — appears when the most-recent assessment
              is a discovery call AND requested_labs are on the session.
              Coach can preview / email / WhatsApp the list to the client
              without leaving this tab. */}
          {lastAssessmentType === "discovery" &&
            discoveryRequestedLabs.length > 0 &&
            lastAssessmentSid && (
              <div
                style={{
                  flex: "1 1 100%",
                  paddingTop: 8,
                  marginTop: 4,
                  borderTop: "1px dashed rgba(46, 110, 213, 0.30)",
                }}
              >
                <SendDiscoveryLabsButton
                  sessionId={lastAssessmentSid}
                  clientId={id}
                  clientEmail={client.email ?? null}
                  labCount={discoveryRequestedLabs.length}
                />
              </div>
            )}
        </div>
      )}

      {/* Sub-nav matching /clients-v2/[id]/page.tsx — Analyse active */}
      <SubNav id={id} active="analyse" />

      {/* 2-col body — stacks single-col under 1180px via fm-v2.css */}
      <div className="fm-v2-2col">
        {/* LEFT — picker + form area */}
        <div style={{ minWidth: 0 }}>
          {timeline.length === 0 ? (
            <EmptyState clientId={id} />
          ) : (
            <>
              {/* 📅 Next session due — separate from journey.nextStep
                  (which says "what to do today"). This says "when is the
                  client's next consultation booked / due, and have we
                  sent them the scheduling link". A 2-action banner:
                  navigate to communicate (which has the booking-link
                  panel) OR mark next contact date manually. */}
              {nextSessionDue && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    marginBottom: 10,
                    background: nextSessionDue.overdue
                      ? "linear-gradient(135deg, rgba(220, 38, 38, 0.10), rgba(220, 38, 38, 0.03))"
                      : nextSessionDue.daysUntil <= 3
                        ? "linear-gradient(135deg, rgba(245, 158, 11, 0.10), rgba(245, 158, 11, 0.03))"
                        : "var(--fm-bg-cool)",
                    border: nextSessionDue.overdue
                      ? "1px solid rgba(220, 38, 38, 0.40)"
                      : nextSessionDue.daysUntil <= 3
                        ? "1px solid rgba(245, 158, 11, 0.45)"
                        : "1px solid var(--fm-border-light)",
                    borderRadius: "var(--fm-radius-sm)",
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      color: nextSessionDue.overdue ? "#9c1c1c" : "#8a5a08",
                      whiteSpace: "nowrap",
                    }}
                  >
                    📅 Next session
                  </span>
                  <span style={{ flex: 1, color: "#1f1f1f" }}>
                    <strong>
                      {formatLongDate(nextSessionDue.iso)}
                    </strong>
                    <span style={{ opacity: 0.75, marginLeft: 8 }}>
                      ({humanDueLabel(nextSessionDue)} · {nextSessionDue.reason})
                    </span>
                  </span>
                  {/* Replaced single-purpose "Send scheduling link" Link
                      with the unified BookSessionButton 2026-05-19 —
                      opens the modal with BOTH send-link AND direct-book
                      flows. Client is pre-filled from the URL so coach
                      skips the picker step. */}
                  <BookSessionButton
                    prefilledClient={{
                      client_id: id,
                      display_name: displayName,
                      email: (client as unknown as { email?: string }).email,
                      mobile_number: (client as unknown as { mobile_number?: string }).mobile_number,
                    }}
                    label="📅 Book session"
                  />
                </div>
              )}

              {/* 🧭 Next-step recommendation. Single sentence pulled from
                  the client journey — kills the "I'm staring at 5 generic
                  buttons, what do I click" hunt the coach flagged. */}
              {journey.nextStep && (
                <Link
                  href={journey.nextStep.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    marginBottom: 14,
                    background: "linear-gradient(135deg, rgba(243,156,18,0.10), rgba(243,156,18,0.03))",
                    border: "1px solid rgba(243,156,18,0.35)",
                    borderRadius: "var(--fm-radius-sm)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      color: "#8a5a08",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ★ Next step
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: "#1f1f1f" }}>
                    <strong>{journey.nextStep.label}</strong>
                    <span style={{ opacity: 0.75, marginLeft: 8 }}>{journey.nextStep.reason}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#8a5a08", whiteSpace: "nowrap" }}>
                    Open →
                  </span>
                </Link>
              )}

              <FmSessionTypePicker
                hrefMap={{
                  // Discovery + Intake route to the REVIEW surface once
                  // already done so the coach lands on the filled record,
                  // not a blank form. New runs route to the entry form.
                  discovery: `/clients-v2/${id}/analyse/discovery`,
                  intake: completionState.intake === "done"
                    ? `/clients-v2/${id}/intake-view`
                    : `/clients-v2/${id}/analyse/intake`,
                  checkin: `/clients-v2/${id}/analyse/checkin`,
                  quick: `/clients-v2/${id}/analyse/quick`,
                  full: `/clients-v2/${id}/analyse/full`,
                }}
                completionState={completionState}
                recommendedId={recommendedId}
              />
            </>
          )}

          {/* The v2 forms have been live since Phase 3.5 — each session
              type tile above is a direct link to its own /analyse/<type>
              page (discovery, intake, full, checkin, quick). No more
              "classic flow" detour. */}
        </div>

        {/* RIGHT — sticky session timeline */}
        <div className="fm-v2-2col-rail">
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
        href={`/clients-v2/${clientId}/analyse/discovery`}
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
          href={`/clients-v2/${clientId}/analyse/intake`}
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
  const tabs = clientSubnavTabs(id);
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
