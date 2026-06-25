"use client";

/**
 * TriageSections — collapsible, urgency-ordered triage buckets for the
 * v2 dashboard.
 *
 * Buckets are grouped into 4 urgency TIERS and rendered top-to-bottom in
 * priority order so the coach's eye lands on the most urgent work first:
 *
 *   🔴 Needs action   — follow-ups, recheck-due, programmes owed
 *   🟡 Pipeline       — labs to chase, links to nudge, prospects to convert
 *   🔵 In progress    — clients on a live protocol (weekly glance)
 *   ⚪ Leads & cold   — re-engagement, brand-new leads, declined
 *
 * Each bucket maps to ONE client-lifecycle state, computed in
 * dashboard-v2/page.tsx::computeSignal. The lifecycle is:
 *
 *   new lead → discovery → [sign-up decision] → intake → plan build →
 *   plan active → recheck
 *
 * Zero-count sections collapse by default (green ✓ badge); non-zero
 * sections start expanded. Per-section collapse persists in sessionStorage.
 */
import { useState, useMemo, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmPanel, FmChip } from "@/components/fm";
import { sendCheckinNudgeAction } from "@/app/api/whatsapp/actions";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

export type SignalKind =
  | "follow_up_due"
  | "protocol_complete"
  | "intake_to_do"
  | "plan_to_build"
  | "labs_pending"
  | "booking_link_pending"
  | "awaiting_signup"
  | "phase_letter_due"
  | "plan_review_due"
  | "active"
  | "returning"
  | "new_lead"
  | "declined";

export interface TriageRow {
  client_id: string;
  display_name?: string;
  active_conditions?: string[];
  signal: {
    kind: SignalKind;
    daysOverdue?: number;
    recheckDate?: string;
    planSlug?: string;
    draftSlug?: string;
    daysSince?: number;
    sessionDate?: string;
    discoveryDate?: string;
    labCount?: number;
    labs?: string[];
    /** For plan_to_build — the exact next micro-step the coach owes:
     *  "Run intake" | "Build the plan" | "Activate the draft". */
    microStep?: string;
    /** For booking_link_pending — days since the link was sent + which
     *  cal.com slug was sent. Used in the section badge + tooltip. */
    daysSinceLinkSent?: number;
    bookingLinkSlug?: string;
    /** For plan_review_due — days since the last review touch (plan edit,
     *  check-in, or rework). Drives the 3-week cadence nudge. */
    daysSinceReview?: number;
    /** For plan_review_due — ISO of most-recent fm_checkin_nudge send to
     *  this client (read from sessions tagged [template: fm_checkin_nudge]).
     *  When set, the "Send check-in" button reads "↻ Resend (sent X ago)"
     *  and confirms before re-firing. Durable rule
     *  feedback-send-buttons-persist-state. */
    lastCheckinNudgeAt?: string | null;
    /** For phase_letter_due — the week range that letter covers
     *  (e.g. {start: 3, end: 4}) + the due date that's now in the past.
     *  Surfaced in the card so coach knows which fortnight she owes. */
    phaseLetterRange?: { start: number; end: number };
    phaseLetterDueDate?: string;
  };
}

interface SectionMeta {
  title: string;
  icon: string;
  accent: string;
  border: string;
  badgeColor: string;
  cta: string;
  ctaHref: (row: TriageRow) => string;
}

const SECTION_META: Record<SignalKind, SectionMeta> = {
  // ── 🔴 Needs action ──────────────────────────────────────────────
  follow_up_due: {
    title: "Follow-up overdue",
    icon: "📞",
    accent: "rgba(192, 57, 43, 0.09)",
    border: "rgba(192, 57, 43, 0.34)",
    badgeColor: "#c0392b",
    cta: "📞 Contact now",
    ctaHref: (r) => `/clients-v2/${r.client_id}`,
  },
  protocol_complete: {
    title: "Protocol complete — reassess",
    icon: "✅",
    accent: "rgba(192, 57, 43, 0.07)",
    border: "rgba(192, 57, 43, 0.30)",
    badgeColor: "#c0392b",
    cta: "🧠 Record session",
    ctaHref: (r) => `/clients-v2/${r.client_id}/analyse`,
  },
  intake_to_do: {
    // F1 2026-05-23 — "Intake to do" was misread by coach because the
    // form IS submitted; what's pending is the coach SESSION. Reworded
    // header + pill to make the action unambiguous.
    title: "Intake session to do",
    icon: "📝",
    accent: "rgba(192, 57, 43, 0.07)",
    border: "rgba(192, 57, 43, 0.30)",
    badgeColor: "#c0392b",
    cta: "📝 Run intake session",
    ctaHref: (r) => `/clients-v2/${r.client_id}/analyse/intake`,
  },
  plan_to_build: {
    title: "Signed up — programme owed",
    icon: "🛠",
    accent: "rgba(192, 57, 43, 0.07)",
    border: "rgba(192, 57, 43, 0.30)",
    badgeColor: "#c0392b",
    cta: "🛠 Continue build",
    ctaHref: (r) =>
      r.signal.draftSlug
        ? `/clients-v2/${r.client_id}/plan/edit/${r.signal.draftSlug}`
        : `/clients-v2/${r.client_id}/analyse`,
  },
  // ── 🟡 Pipeline ──────────────────────────────────────────────────
  labs_pending: {
    title: "Labs to chase",
    icon: "🧪",
    accent: "rgba(180, 83, 9, 0.10)",
    border: "rgba(180, 83, 9, 0.36)",
    badgeColor: "#b45309",
    cta: "🧪 Record results",
    ctaHref: (r) => `/clients-v2/${r.client_id}/analyse`,
  },
  booking_link_pending: {
    title: "Booking link sent — no response",
    icon: "📨",
    accent: "rgba(180, 83, 9, 0.10)",
    border: "rgba(180, 83, 9, 0.36)",
    badgeColor: "#b45309",
    cta: "📞 Nudge",
    ctaHref: (r) => `/clients-v2/${r.client_id}/communicate`,
  },
  awaiting_signup: {
    title: "In conversation — deciding",
    icon: "🌱",
    accent: "rgba(46, 125, 50, 0.07)",
    border: "rgba(46, 125, 50, 0.28)",
    badgeColor: "#2e7d32",
    cta: "💬 Nurture",
    ctaHref: (r) => `/clients-v2/${r.client_id}`,
  },
  // ── 🔵 In progress ───────────────────────────────────────────────
  phase_letter_due: {
    title: "Phase letter overdue",
    icon: "✉️",
    accent: "rgba(26, 127, 187, 0.10)",
    border: "rgba(26, 127, 187, 0.38)",
    badgeColor: "#1a7fbb",
    cta: "✉️ Send welcome letter",
    ctaHref: (r) => `/clients-v2/${r.client_id}/communicate`,
  },
  plan_review_due: {
    title: "Check-in needed (3+ weeks quiet)",
    icon: "💬",
    accent: "rgba(26, 127, 187, 0.10)",
    border: "rgba(26, 127, 187, 0.38)",
    badgeColor: "#1a7fbb",
    cta: "View client",
    ctaHref: (r) => `/clients-v2/${r.client_id}`,
  },
  active: {
    title: "Active protocols",
    icon: "📋",
    accent: "rgba(26, 127, 187, 0.07)",
    border: "rgba(26, 127, 187, 0.26)",
    badgeColor: "#1a7fbb",
    cta: "View plan",
    ctaHref: (r) =>
      r.signal.planSlug ? `/clients-v2/${r.client_id}/plan` : `/clients-v2/${r.client_id}`,
  },
  // ── ⚪ Leads & cold ──────────────────────────────────────────────
  returning: {
    title: "Returning — re-engage",
    icon: "🔄",
    accent: "rgba(120, 120, 120, 0.07)",
    border: "rgba(120, 120, 120, 0.26)",
    badgeColor: "#6b7280",
    cta: "🗓 Record session",
    ctaHref: (r) => `/clients-v2/${r.client_id}/analyse`,
  },
  new_lead: {
    title: "Discovery done — record session",
    icon: "🔍",
    accent: "rgba(120, 120, 120, 0.07)",
    border: "rgba(120, 120, 120, 0.26)",
    badgeColor: "#6b7280",
    cta: "📝 Record call",
    ctaHref: (r) => `/clients-v2/${r.client_id}/analyse/discovery`,
  },
  declined: {
    title: "Declined after discovery",
    icon: "🚫",
    accent: "rgba(120, 120, 120, 0.05)",
    border: "rgba(120, 120, 120, 0.20)",
    badgeColor: "#9ca3af",
    cta: "View",
    ctaHref: (r) => `/clients-v2/${r.client_id}`,
  },
};

// ── Urgency tiers ────────────────────────────────────────────────────
// Rendered top-to-bottom. Each tier gets a thin labelled divider so the
// coach can see at a glance where "must do today" ends and "cold" begins.
interface Tier {
  label: string;
  hint: string;
  color: string;
  kinds: SignalKind[];
}

const TIERS: Tier[] = [
  {
    label: "Needs action",
    hint: "Do these today — clients are waiting on you",
    color: "#c0392b",
    kinds: ["follow_up_due", "protocol_complete", "intake_to_do", "plan_to_build"],
  },
  {
    label: "Pipeline",
    hint: "Convert + chase — keep the funnel moving",
    color: "#b45309",
    kinds: ["labs_pending", "booking_link_pending", "awaiting_signup"],
  },
  {
    label: "In progress",
    hint: "On a live protocol — review every 3 weeks so it doesn't stall",
    color: "#1a7fbb",
    kinds: ["plan_review_due", "active"],
  },
  {
    label: "Leads & cold",
    hint: "Lower priority — re-engage when you have capacity",
    color: "#6b7280",
    kinds: ["returning", "new_lead", "declined"],
  },
];

const SECTION_ORDER: SignalKind[] = TIERS.flatMap((t) => t.kinds);

// ── Per-view tier definitions ────────────────────────────────────────
type DashboardView = "attention" | "active" | "discovery" | "past";

const VIEW_TIERS: Record<DashboardView, Tier[]> = {
  attention: [
    {
      label: "Do now",
      hint: "Clients waiting on you",
      color: "#c0392b",
      kinds: ["follow_up_due", "protocol_complete", "intake_to_do", "plan_to_build"],
    },
    {
      label: "This week",
      hint: "Keep things moving",
      color: "#b45309",
      // awaiting_signup removed — prospects live in the Pipeline tab, not here.
      // Mixing warm leads with urgent action items made the dashboard feel like
      // "still deciding = a problem to fix". It's not — they're in the funnel.
      kinds: ["labs_pending", "booking_link_pending", "plan_review_due"],
    },
  ],
  active: [
    {
      label: "Needs attention",
      hint: "On a live protocol — action needed",
      color: "#c0392b",
      kinds: ["plan_review_due", "protocol_complete"],
    },
    {
      label: "On protocol",
      hint: "Steady — check in every 3 weeks",
      color: "#1a7fbb",
      kinds: ["active"],
    },
  ],
  discovery: [
    {
      label: "Warm prospects",
      hint: "Had a discovery call — nurture toward sign-up",
      color: "#2e7d32",
      kinds: ["awaiting_signup", "booking_link_pending"],
    },
    {
      label: "New leads",
      hint: "Discovery done — log the session to start the record",
      color: "#6b7280",
      kinds: ["new_lead"],
    },
  ],
  past: [
    {
      label: "Past clients",
      hint: "Completed programme or declined",
      color: "#6b7280",
      kinds: ["returning", "declined"],
    },
  ],
};

interface TriageSectionsProps {
  /** Pre-grouped rows by signal kind. */
  grouped: Record<SignalKind, TriageRow[]>;
}

export function TriageSections({ grouped }: TriageSectionsProps) {
  const [view, setView] = useState<DashboardView>("attention");

  // Initial state: zero-count sections collapsed, non-zero expanded.
  const initialCollapsed = useMemo(() => {
    const init: Partial<Record<SignalKind, boolean>> = {};
    for (const k of SECTION_ORDER) init[k] = (grouped[k]?.length ?? 0) === 0;
    return init as Record<SignalKind, boolean>;
  }, [grouped]);

  const [collapsed, setCollapsed] = useState<Record<SignalKind, boolean>>(initialCollapsed);

  // Restore coach's per-section collapse preferences. Key bumped to v3
  // because the visible kind set changes per view — old keys would be stale.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("fmcoach.triage.collapsed.v3");
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<Record<SignalKind, boolean>>;
      setCollapsed((prev) => {
        const next = { ...prev };
        for (const k of SECTION_ORDER) {
          if (typeof stored[k] === "boolean") next[k] = stored[k] as boolean;
        }
        return next;
      });
    } catch {
      /* corrupt storage — fall through to initialCollapsed */
    }
  }, []);

  const toggle = (k: SignalKind) =>
    setCollapsed((s) => {
      const next = { ...s, [k]: !s[k] };
      try {
        window.sessionStorage.setItem(
          "fmcoach.triage.collapsed.v3",
          JSON.stringify(next),
        );
      } catch {
        /* sessionStorage may be unavailable in private windows */
      }
      return next;
    });

  const activeTiers = VIEW_TIERS[view];

  // For "attention" view: check whether ALL sections across all tiers are empty.
  const attentionIsAllClear =
    view === "attention" &&
    activeTiers.every((tier) => tier.kinds.every((k) => (grouped[k]?.length ?? 0) === 0));

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* ── Tab switcher ─────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {(["attention", "active", "discovery", "past"] as DashboardView[]).map((v) => {
          const labels: Record<DashboardView, string> = {
            attention: "🎯 Needs attention",
            active: "📋 Active clients",
            discovery: "🌱 Pipeline",
            past: "🗂 Past",
          };
          const isActive = view === v;
          const count = VIEW_TIERS[v]
            .flatMap((t) => t.kinds)
            .reduce((s, k) => s + (grouped[k]?.length ?? 0), 0);
          return (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                padding: "6px 14px",
                background: isActive ? "var(--fm-primary)" : "var(--fm-surface)",
                color: isActive ? "#fff" : "var(--fm-text-secondary)",
                border: isActive
                  ? "1px solid var(--fm-primary)"
                  : "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-pill)",
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {labels[v]}
              {count > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "1px 6px",
                    background: isActive
                      ? "rgba(255,255,255,0.25)"
                      : v === "attention"
                        ? "rgba(192,57,43,0.12)"
                        : "rgba(0,0,0,0.07)",
                    color: isActive
                      ? "#fff"
                      : v === "attention" && count > 0
                        ? "#c0392b"
                        : "var(--fm-text-secondary)",
                    borderRadius: "var(--fm-radius-pill)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── All-clear message for "attention" view ───────────────── */}
      {attentionIsAllClear && (
        <FmPanel
          style={{
            background: "rgba(46, 204, 113, 0.04)",
            borderColor: "rgba(46, 204, 113, 0.20)",
            borderStyle: "dashed",
          }}
        >
          <div
            style={{
              textAlign: "center",
              padding: "18px 16px",
              fontSize: 13,
              color: "var(--fm-success)",
              fontWeight: 600,
            }}
          >
            ✓ Nothing needs your attention right now
          </div>
        </FmPanel>
      )}

      {/* ── Tier sections ────────────────────────────────────────── */}
      {!attentionIsAllClear &&
        activeTiers.map((tier) => {
          const tierCount = tier.kinds.reduce(
            (sum, k) => sum + (grouped[k]?.length ?? 0),
            0,
          );

          // In "attention" view, skip tiers with zero items entirely.
          if (view === "attention" && tierCount === 0) return null;

          return (
            <div key={tier.label} style={{ display: "grid", gap: 14, marginBottom: 10 }}>
              {/* Tier divider */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: tier.color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: 0.9,
                    color: tier.color,
                  }}
                >
                  {tier.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--fm-text-tertiary)",
                    fontWeight: 500,
                  }}
                >
                  {tier.hint}
                </span>
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--fm-border-light)",
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: tierCount === 0 ? "var(--fm-text-tertiary)" : tier.color,
                  }}
                >
                  {tierCount}
                </span>
              </div>

              {tier.kinds.map((kind) => {
                const meta = SECTION_META[kind];
                const rows = grouped[kind] ?? [];
                const isZero = rows.length === 0;
                const isCollapsed = collapsed[kind];

                // In "attention" view, skip empty sections entirely.
                if (view === "attention" && isZero) return null;

                return (
                  <section key={kind}>
                    <button
                      type="button"
                      onClick={() => toggle(kind)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "6px 4px",
                        background: "transparent",
                        border: 0,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                      }}
                      aria-expanded={!isCollapsed}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--fm-text-tertiary)",
                          width: 12,
                          display: "inline-block",
                          transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                          transition: "transform 160ms var(--fm-ease-out)",
                        }}
                      >
                        ▾
                      </span>
                      <span style={{ fontSize: 17 }}>{meta.icon}</span>
                      <h2
                        style={{
                          margin: 0,
                          fontSize: 13,
                          textTransform: "uppercase",
                          letterSpacing: 0.6,
                          fontWeight: 700,
                          color: isZero
                            ? "var(--fm-text-tertiary)"
                            : "var(--fm-text-secondary)",
                          fontFamily: "var(--fm-font-body)",
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {meta.title}
                      </h2>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 9px",
                          background: isZero ? "var(--fm-success)" : meta.accent,
                          color: isZero ? "#fff" : meta.badgeColor,
                          border: isZero
                            ? "1px solid var(--fm-success)"
                            : `1px solid ${meta.border}`,
                          borderRadius: "var(--fm-radius-pill)",
                          fontWeight: 700,
                          opacity: isZero ? 0.55 : 1,
                        }}
                      >
                        {rows.length}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                          gap: 12,
                          marginTop: 8,
                        }}
                      >
                        {rows.length === 0 ? (
                          <FmPanel
                            style={{
                              gridColumn: "1 / -1",
                              background: "rgba(46, 204, 113, 0.04)",
                              borderColor: "rgba(46, 204, 113, 0.20)",
                              borderStyle: "dashed",
                            }}
                          >
                            <div
                              style={{
                                textAlign: "center",
                                padding: "10px 16px",
                                fontSize: 12,
                                color: "var(--fm-success)",
                                fontWeight: 600,
                              }}
                            >
                              ✓ Nothing here right now
                            </div>
                          </FmPanel>
                        ) : (
                          rows.map((row) => (
                            <TriageCard key={row.client_id} row={row} meta={meta} />
                          ))
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          );
        })}
    </div>
  );
}

function TriageCard({ row, meta }: { row: TriageRow; meta: SectionMeta }) {
  return (
    <Link
      href={`/clients-v2/${row.client_id}`}
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <FmPanel
        style={{
          background: meta.accent,
          borderColor: meta.border,
          padding: "14px 16px",
          cursor: "pointer",
          transition: "all 200ms var(--fm-ease-out)",
          height: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--fm-text-primary)",
                marginBottom: 2,
              }}
            >
              {row.display_name ?? row.client_id}
            </div>
            <div
              style={{
                fontFamily: "var(--fm-font-mono)",
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
              }}
            >
              {row.client_id}
            </div>
          </div>
          <SignalBadge signal={row.signal} />
        </div>

        {(row.active_conditions ?? []).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {(row.active_conditions ?? []).slice(0, 3).map((c) => (
              <FmChip key={c} outline>
                {c}
              </FmChip>
            ))}
            {(row.active_conditions ?? []).length > 3 && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                  alignSelf: "center",
                }}
              >
                +{(row.active_conditions ?? []).length - 3}
              </span>
            )}
          </div>
        )}

        <SignalDetail signal={row.signal} />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 6,
            paddingTop: 6,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {row.signal.kind === "plan_review_due" && (
              <SendCheckinNudgeButton
                clientId={row.client_id}
                clientName={row.display_name}
                lastSentAt={row.signal.lastCheckinNudgeAt ?? null}
              />
            )}
            <Link
              href={meta.ctaHref(row)}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "5px 12px",
                background:
                  row.signal.kind === "plan_review_due"
                    ? "var(--fm-surface)"
                    : "var(--fm-primary)",
                color:
                  row.signal.kind === "plan_review_due"
                    ? "var(--fm-text-secondary)"
                    : "#fff",
                border:
                  row.signal.kind === "plan_review_due"
                    ? "1px solid var(--fm-border)"
                    : 0,
                borderRadius: "var(--fm-radius-sm)",
                textDecoration: "none",
              }}
            >
              {meta.cta}
            </Link>
          </div>
          <span style={{ fontSize: 11, color: "var(--fm-primary)", fontWeight: 600 }}>
            View →
          </span>
        </div>
      </FmPanel>
    </Link>
  );
}

/**
 * SendCheckinNudgeButton — one-click "💬 Send check-in" on a plan_review_due
 * card. Sends the fm_checkin_nudge WhatsApp template to the client asking
 * how they're getting on. No AI call — just a nudge to get feedback.
 * The 3-week clock resets automatically once the client responds and you
 * log a check-in session.
 */
function SendCheckinNudgeButton({
  clientId,
  clientName,
  lastSentAt,
}: {
  clientId: string;
  clientName?: string;
  /** ISO of most-recent fm_checkin_nudge send. When set, button label
   *  becomes "↻ Resend (sent X ago)" and asks for confirmation if the
   *  last send was inside the 7-day check-in window. */
  lastSentAt?: string | null;
}) {
  const [pending, start] = useTransition();
  const alreadySent = Boolean(lastSentAt);
  const ago = lastSentAt ? relativeTimeShort(lastSentAt) : "";
  const fire = () =>
    start(async () => {
      const r = await sendCheckinNudgeAction(clientId);
      if (r.ok) {
        toast.success(`Check-in nudge sent to ${clientName ?? clientId}`);
      } else {
        toast.error(r.error ?? "Failed to send check-in message");
      }
    });
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Resend gate: nudge templates spam easily — coach taps quickly
        // through 5 rows + a row that already got nudged 2 days ago
        // shouldn't silently re-fire. Durable rule
        // feedback-send-buttons-persist-state.
        if (alreadySent) {
          if (
            !confirm(
              `Check-in nudge was already sent to ${clientName ?? clientId} ${ago}. Send another?`,
            )
          )
            return;
        }
        fire();
      }}
      style={{
        fontSize: 12,
        fontWeight: 700,
        padding: "5px 12px",
        background: pending
          ? "var(--fm-text-tertiary)"
          : alreadySent
            ? "transparent"
            : "#1a7fbb",
        color: alreadySent && !pending ? "var(--fm-text-secondary)" : "#fff",
        border: alreadySent && !pending ? "1px solid var(--fm-border)" : 0,
        borderRadius: "var(--fm-radius-sm)",
        cursor: pending ? "wait" : "pointer",
        fontFamily: "inherit",
      }}
      title={
        alreadySent
          ? `Last check-in nudge sent ${ago}`
          : "Sends fm_checkin_nudge WhatsApp template"
      }
    >
      {pending
        ? "Sending…"
        : alreadySent
          ? `✓ Sent ${ago} · ↻ Resend`
          : "💬 Send check-in"}
    </button>
  );
}

/**
 * Per-signal context line — the WHY-this-client-is-here info so the coach
 * can scan + decide without drilling into the client page.
 */
function SignalDetail({ signal }: { signal: TriageRow["signal"] }) {
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "var(--fm-text-tertiary)",
    marginRight: 6,
  };
  const valueStyle: React.CSSProperties = {
    fontSize: 12,
    color: "var(--fm-text-secondary)",
    lineHeight: 1.4,
  };
  const wrap: React.CSSProperties = {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottom: "1px dashed var(--fm-border)",
  };

  if (signal.kind === "labs_pending") {
    // Coach feedback 2026-05-24: dashboard card was rendering the full
    // 46/55-test "AWAITING:" list, making the card 4-6 lines tall and
    // the dashboard cluttered. The individual test list belongs on the
    // client page, not in a triage summary. Show count + first 2 tests
    // as a flavour hint, link out for the rest.
    const labs = signal.labs ?? [];
    const n = signal.labCount ?? labs.length;
    const preview = labs.slice(0, 2).join(", ");
    return (
      <div style={wrap}>
        <span style={labelStyle}>Awaiting:</span>
        <span style={valueStyle}>
          {n} test{n === 1 ? "" : "s"}
          {preview ? ` · ${preview}${labs.length > 2 ? ", …" : ""}` : ""}
        </span>
      </div>
    );
  }

  if (signal.kind === "follow_up_due") {
    const d = signal.daysOverdue ?? 0;
    return (
      <div style={wrap}>
        <span style={labelStyle}>Contact:</span>
        <span style={valueStyle}>
          {d === 0 ? "due today" : d < 0 ? `in ${Math.abs(d)} day(s)` : `${d} day(s) overdue`}
        </span>
      </div>
    );
  }

  if (signal.kind === "protocol_complete") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Recheck:</span>
        <span style={valueStyle}>
          {signal.recheckDate ?? "—"}
          {signal.planSlug && (
            <span
              style={{
                fontFamily: "var(--fm-font-mono)",
                fontSize: 11,
                marginLeft: 6,
                color: "var(--fm-text-tertiary)",
              }}
            >
              · {signal.planSlug}
            </span>
          )}
        </span>
      </div>
    );
  }

  if (signal.kind === "intake_to_do") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Next step:</span>
        <span style={valueStyle}>
          {signal.microStep ?? "Run the 60-minute intake session"}
        </span>
      </div>
    );
  }

  if (signal.kind === "plan_to_build") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Next step:</span>
        <span style={valueStyle}>{signal.microStep ?? "Build the programme"}</span>
      </div>
    );
  }

  if (signal.kind === "awaiting_signup") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Discovery:</span>
        <span style={valueStyle}>
          {signal.discoveryDate
            ? `${signal.discoveryDate} · in the pipeline`
            : "done · in the pipeline"}
        </span>
      </div>
    );
  }

  if (signal.kind === "booking_link_pending") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Link sent:</span>
        <span style={valueStyle}>
          {signal.daysSinceLinkSent ?? 0} day(s) ago — no booking yet
          {signal.bookingLinkSlug && (
            <span
              style={{
                fontFamily: "var(--fm-font-mono)",
                fontSize: 11,
                marginLeft: 6,
                color: "var(--fm-text-tertiary)",
              }}
            >
              · {signal.bookingLinkSlug}
            </span>
          )}
        </span>
      </div>
    );
  }

  if (signal.kind === "returning") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Last session:</span>
        <span style={valueStyle}>
          {signal.daysSince} day(s) ago{signal.sessionDate ? ` · ${signal.sessionDate}` : ""}
        </span>
      </div>
    );
  }

  if (signal.kind === "new_lead") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Next step:</span>
        <span style={valueStyle}>
          Record the discovery call — run the 15-min fit call session
        </span>
      </div>
    );
  }

  if (signal.kind === "declined") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Status:</span>
        <span style={valueStyle}>
          Declined after discovery{signal.discoveryDate ? ` · ${signal.discoveryDate}` : ""}
        </span>
      </div>
    );
  }

  if (signal.kind === "phase_letter_due") {
    const r = signal.phaseLetterRange;
    return (
      <div style={wrap}>
        <span style={labelStyle}>Phase letter:</span>
        <span style={valueStyle}>
          {r ? `Week ${r.start}–${r.end}` : "next phase"}
          {signal.phaseLetterDueDate && (
            <span style={{ marginLeft: 6, color: "var(--fm-text-tertiary)" }}>
              · due {signal.phaseLetterDueDate}
            </span>
          )}
          {signal.planSlug && (
            <span
              style={{
                fontFamily: "var(--fm-font-mono)",
                fontSize: 11,
                marginLeft: 6,
                color: "var(--fm-text-tertiary)",
              }}
            >
              · {signal.planSlug}
            </span>
          )}
        </span>
      </div>
    );
  }

  if (signal.kind === "plan_review_due") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>Last check-in:</span>
        <span style={valueStyle}>
          {signal.daysSinceReview ?? 0} days ago — get feedback from client
          {signal.planSlug && (
            <span
              style={{
                fontFamily: "var(--fm-font-mono)",
                fontSize: 11,
                marginLeft: 6,
                color: "var(--fm-text-tertiary)",
              }}
            >
              · {signal.planSlug}
            </span>
          )}
        </span>
      </div>
    );
  }

  if (signal.kind === "active") {
    return (
      <div style={wrap}>
        <span style={labelStyle}>On protocol:</span>
        <span style={valueStyle}>
          {signal.planSlug ?? "—"}
          {signal.recheckDate && (
            <span style={{ marginLeft: 6, color: "var(--fm-text-tertiary)" }}>
              · recheck {signal.recheckDate}
            </span>
          )}
        </span>
      </div>
    );
  }

  return null;
}

function SignalBadge({ signal }: { signal: TriageRow["signal"] }) {
  if (signal.kind === "follow_up_due") {
    const d = signal.daysOverdue ?? 0;
    return <FmChip tone="danger">{d === 0 ? "due today" : `${d}d overdue`}</FmChip>;
  }
  if (signal.kind === "protocol_complete") {
    return <FmChip tone="danger">recheck due</FmChip>;
  }
  if (signal.kind === "intake_to_do") {
    // F1 + F3 2026-05-23 — pill says SESSION pending (the form is in).
    // Tone switched from danger (red, used for overdue/recheck) to
    // secondary (blue, "informational state") so it visually separates
    // from the orange action button. Coach feedback: red pill next to
    // orange CTA created false urgency.
    return <FmChip tone="secondary">session pending</FmChip>;
  }
  if (signal.kind === "plan_to_build") {
    return <FmChip tone="danger">programme owed</FmChip>;
  }
  if (signal.kind === "labs_pending") {
    const n = signal.labCount ?? signal.labs?.length ?? 0;
    return <FmChip tone="warning">{n} test{n === 1 ? "" : "s"}</FmChip>;
  }
  if (signal.kind === "booking_link_pending") {
    return <FmChip tone="warning">no booking</FmChip>;
  }
  if (signal.kind === "awaiting_signup") {
    return <FmChip>deciding</FmChip>;
  }
  if (signal.kind === "plan_review_due") {
    return (
      <FmChip tone="secondary">{signal.daysSinceReview ?? 0}d no check-in</FmChip>
    );
  }
  if (signal.kind === "active") {
    return signal.recheckDate ? (
      <FmChip tone="secondary">recheck {signal.recheckDate}</FmChip>
    ) : (
      <FmChip tone="secondary">on protocol</FmChip>
    );
  }
  if (signal.kind === "returning") {
    return <FmChip>{signal.daysSince}d gap</FmChip>;
  }
  if (signal.kind === "new_lead") {
    return <FmChip>new lead</FmChip>;
  }
  if (signal.kind === "declined") {
    return <FmChip>declined</FmChip>;
  }
  return <FmChip>—</FmChip>;
}
