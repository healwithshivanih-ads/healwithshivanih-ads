"use client";

/**
 * TriageSections — collapsible sections for the v2 dashboard.
 *
 * Each section can be expanded or collapsed by clicking its header.
 * Zero-count sections are styled with a faded green badge and start
 * collapsed by default (per design decision 1A — keep spatial memory,
 * don't auto-hide). Non-zero sections start expanded.
 */
import { useState, useMemo } from "react";
import Link from "next/link";
import { FmPanel, FmChip } from "@/components/fm";

export type SignalKind =
  | "follow_up_due"
  | "protocol_complete"
  | "labs_pending"
  | "returning"
  | "new_client"
  | "active";

export interface TriageRow {
  client_id: string;
  display_name?: string;
  active_conditions?: string[];
  signal: {
    kind: SignalKind;
    daysOverdue?: number;
    recheckDate?: string;
    planSlug?: string;
    daysSince?: number;
    sessionDate?: string;
    labCount?: number;
    labs?: string[];
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
  follow_up_due: {
    title: "Follow-ups due",
    icon: "📅",
    accent: "rgba(155, 89, 182, 0.10)",
    border: "rgba(155, 89, 182, 0.30)",
    badgeColor: "#7d3c98",
    cta: "📞 Contact",
    ctaHref: (r) => `/clients-v2/${r.client_id}`,
  },
  protocol_complete: {
    title: "Protocol complete — reassess",
    icon: "✅",
    accent: "rgba(46, 204, 113, 0.08)",
    border: "rgba(46, 204, 113, 0.30)",
    badgeColor: "var(--fm-success)",
    cta: "🧠 Record session",
    ctaHref: (r) => `/clients-v2/${r.client_id}/sessions`,
  },
  labs_pending: {
    title: "Labs pending",
    icon: "🧪",
    accent: "rgba(214, 162, 162, 0.12)",
    border: "rgba(214, 162, 162, 0.40)",
    badgeColor: "#a85858",
    cta: "🧪 Record results",
    ctaHref: (r) => `/clients-v2/${r.client_id}/sessions`,
  },
  returning: {
    title: "Returning clients",
    icon: "🔄",
    accent: "rgba(26, 127, 187, 0.08)",
    border: "rgba(26, 127, 187, 0.30)",
    badgeColor: "var(--fm-secondary)",
    cta: "🗓 Record session",
    ctaHref: (r) => `/clients-v2/${r.client_id}/sessions`,
  },
  new_client: {
    title: "New — awaiting assessment",
    icon: "🆕",
    accent: "rgba(247, 147, 30, 0.08)",
    border: "rgba(247, 147, 30, 0.30)",
    badgeColor: "var(--fm-accent-dark)",
    cta: "🗓 Record session",
    ctaHref: (r) => `/clients-v2/${r.client_id}/sessions`,
  },
  active: {
    title: "Active protocols",
    icon: "📋",
    accent: "var(--fm-bg-cool)",
    border: "var(--fm-border)",
    badgeColor: "var(--fm-text-secondary)",
    cta: "View plan",
    ctaHref: (r) => (r.signal.planSlug ? `/clients-v2/${r.client_id}/plan` : `/clients-v2/${r.client_id}`),
  },
};

// Priority order per coach (2026-05-13):
//   1. Follow-ups due — needs a reply / next contact today.
//   2. Active protocols — clients currently in-flight; coach checks weekly.
//   3. Protocol complete — recheck time, generate next plan.
//   4. Labs pending — waiting on results.
//   5. Returning — re-engaged, no current plan.
//   6. New — awaiting first assessment.
const SECTION_ORDER: SignalKind[] = [
  "follow_up_due",
  "active",
  "protocol_complete",
  "labs_pending",
  "returning",
  "new_client",
];

interface TriageSectionsProps {
  /** Pre-grouped rows by signal kind. */
  grouped: Record<SignalKind, TriageRow[]>;
}

export function TriageSections({ grouped }: TriageSectionsProps) {
  const initialCollapsed = useMemo(() => {
    const init: Partial<Record<SignalKind, boolean>> = {};
    for (const k of SECTION_ORDER) init[k] = (grouped[k]?.length ?? 0) === 0;
    return init as Record<SignalKind, boolean>;
  }, [grouped]);

  const [collapsed, setCollapsed] = useState<Record<SignalKind, boolean>>(initialCollapsed);

  const toggle = (k: SignalKind) => setCollapsed((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {SECTION_ORDER.map((kind) => {
        const meta = SECTION_META[kind];
        const rows = grouped[kind] ?? [];
        const isZero = rows.length === 0;
        const isCollapsed = collapsed[kind];

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
                padding: "8px 4px",
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
              <span style={{ fontSize: 18 }}>{meta.icon}</span>
              <h2
                style={{
                  margin: 0,
                  fontSize: 13,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  fontWeight: 700,
                  color: isZero ? "var(--fm-text-tertiary)" : "var(--fm-text-secondary)",
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
                  border: isZero ? "1px solid var(--fm-success)" : `1px solid ${meta.border}`,
                  borderRadius: "var(--fm-radius-pill)",
                  fontWeight: 700,
                  opacity: isZero ? 0.6 : 1,
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
                  marginTop: 10,
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
                        padding: "12px 16px",
                        fontSize: 12.5,
                        color: "var(--fm-success)",
                        fontWeight: 600,
                      }}
                    >
                      ✓ No clients in this bucket right now
                    </div>
                  </FmPanel>
                ) : (
                  rows.map((row) => <TriageCard key={row.client_id} row={row} meta={meta} />)
                )}
              </div>
            )}
          </section>
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
                fontSize: 10.5,
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
                  fontSize: 10.5,
                  color: "var(--fm-text-tertiary)",
                  alignSelf: "center",
                }}
              >
                +{(row.active_conditions ?? []).length - 3}
              </span>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 6,
            paddingTop: 6,
          }}
        >
          <Link
            href={meta.ctaHref(row)}
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              padding: "5px 12px",
              background: "var(--fm-primary)",
              color: "#fff",
              borderRadius: "var(--fm-radius-sm)",
              textDecoration: "none",
            }}
          >
            {meta.cta}
          </Link>
          <span style={{ fontSize: 11, color: "var(--fm-primary)", fontWeight: 600 }}>
            View →
          </span>
        </div>
      </FmPanel>
    </Link>
  );
}

function SignalBadge({ signal }: { signal: TriageRow["signal"] }) {
  if (signal.kind === "follow_up_due") {
    const d = signal.daysOverdue ?? 0;
    return (
      <FmChip tone="warning">{d === 0 ? "due today" : `${d}d overdue`}</FmChip>
    );
  }
  if (signal.kind === "protocol_complete") {
    return <FmChip tone="success">recheck {signal.recheckDate}</FmChip>;
  }
  if (signal.kind === "labs_pending") {
    const n = signal.labCount ?? signal.labs?.length ?? 0;
    return <FmChip tone="danger">{n} test{n === 1 ? "" : "s"}</FmChip>;
  }
  if (signal.kind === "returning") {
    return <FmChip tone="secondary">{signal.daysSince}d ago</FmChip>;
  }
  if (signal.kind === "new_client") {
    return <FmChip tone="primary">awaiting assessment</FmChip>;
  }
  if (signal.kind === "active" && signal.recheckDate) {
    return <FmChip>recheck {signal.recheckDate}</FmChip>;
  }
  return <FmChip>active</FmChip>;
}
