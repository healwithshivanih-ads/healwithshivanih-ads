"use client";

/**
 * PlanDiffAlert — sits at the top of the client Plan tab when a draft
 * plan exists alongside an active published plan.
 *
 * Two-layer comparison:
 *   1. DETERMINISTIC (instant, free) — structural diff of plan_period_weeks,
 *      supplements, lab_orders, referrals, lifestyle counts. Surfaces
 *      auto-derived severity badge.
 *   2. SEMANTIC (Haiku, on demand, ~$0.005, cached) — coach clicks
 *      "🔍 Compare coach notes" → button calls Haiku to read both
 *      notes_for_coach blocks and reports clinical change_type +
 *      publish_recommendation.
 *
 * Severity colour scheme:
 *   high   → red border / amber tint   (review before publishing)
 *   medium → amber border / amber tint (light review)
 *   low    → blue border / blue tint   (mostly cosmetic)
 *   none   → grey border (no material changes — consider discarding draft)
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import type { PlanVersionDiffSummary } from "@/lib/fmdb/plan-version-diff";
import {
  computeSemanticPlanDiffAction,
  type SemanticDiffResult,
} from "@/lib/server-actions/plan-version-diff";

interface Props {
  clientId: string;
  activeSlug: string;
  draftSlug: string;
  diff: PlanVersionDiffSummary;
}

const SEVERITY_THEME = {
  high: {
    border: "1.5px solid #dc2626",
    bg: "rgba(220, 38, 38, 0.05)",
    badge: { bg: "#dc2626", text: "#fff", label: "HIGH" },
    icon: "🚨",
    title: "Draft has material clinical changes — review before publishing",
  },
  medium: {
    border: "1.5px solid #d97706",
    bg: "rgba(217, 119, 6, 0.05)",
    badge: { bg: "#d97706", text: "#fff", label: "MEDIUM" },
    icon: "⚠️",
    title: "Draft has structural changes — light review recommended",
  },
  low: {
    border: "1.5px solid #2563eb",
    bg: "rgba(37, 99, 235, 0.05)",
    badge: { bg: "#2563eb", text: "#fff", label: "LOW" },
    icon: "ℹ️",
    title: "Draft has minor differences — mostly cosmetic",
  },
  none: {
    border: "1.5px solid #6b7280",
    bg: "rgba(107, 114, 128, 0.05)",
    badge: { bg: "#6b7280", text: "#fff", label: "NONE" },
    icon: "🪞",
    title: "Draft is structurally identical to active plan — consider discarding",
  },
};

const PUBLISH_REC_LABEL: Record<
  NonNullable<SemanticDiffResult["publish_recommendation"]>,
  { label: string; bg: string; text: string }
> = {
  publish_now: { label: "✅ Safe to publish", bg: "#16a34a", text: "#fff" },
  review_with_client: { label: "👁 Review with client first", bg: "#d97706", text: "#fff" },
  discuss_first: { label: "💬 Discuss before publishing", bg: "#dc2626", text: "#fff" },
  discard_draft: { label: "🗑 Discard draft", bg: "#6b7280", text: "#fff" },
};

const CHANGE_TYPE_LABEL: Record<
  NonNullable<SemanticDiffResult["change_type"]>,
  string
> = {
  none: "No clinical change",
  consolidation: "Consolidation — refining existing approach",
  escalation: "Escalation — new interventions or intensity",
  pivot: "Pivot — change of clinical direction",
  cleanup: "Cleanup — wording / formatting only",
  unclear: "Unclear — review manually",
};

export function PlanDiffAlert({ clientId, activeSlug, draftSlug, diff }: Props) {
  const theme = SEVERITY_THEME[diff.severity];
  const [semantic, setSemantic] = useState<SemanticDiffResult | null>(null);
  const [pending, startTransition] = useTransition();

  function runSemantic(force = false) {
    startTransition(async () => {
      const r = await computeSemanticPlanDiffAction(activeSlug, draftSlug, { force });
      setSemantic(r);
    });
  }

  // Don't render at all if no material diff and notes are also identical
  // (caller already gates on draft-exists; this skips the "nothing to see")
  if (!diff.hasChanges && diff.severity === "none") {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: "14px 16px",
        background: theme.bg,
        border: theme.border,
        borderRadius: "var(--fm-radius-md)",
        fontSize: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18 }}>{theme.icon}</span>
        <span
          style={{
            padding: "2px 8px",
            background: theme.badge.bg,
            color: theme.badge.text,
            fontWeight: 700,
            fontSize: 10,
            borderRadius: 3,
            letterSpacing: "0.4px",
          }}
        >
          {theme.badge.label}
        </span>
        <strong style={{ flex: 1, minWidth: 200 }}>{theme.title}</strong>
        <Link
          href={`/clients-v2/${clientId}/plan/edit/${draftSlug}`}
          style={{
            padding: "5px 10px",
            background: "#1f2937",
            color: "#fff",
            fontWeight: 700,
            fontSize: 11,
            borderRadius: 3,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Open draft →
        </Link>
      </div>

      {/* Structural diff body */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px dashed rgba(0,0,0,0.12)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {diff.periodWeeksDelta !== null && diff.periodWeeksDelta !== 0 && (
          <DiffCard label="Plan period">
            <strong>{diff.activePeriodWeeks}w</strong> → <strong>{diff.draftPeriodWeeks}w</strong>
            <span style={{ color: "var(--fm-text-secondary)", marginLeft: 4 }}>
              ({diff.periodWeeksDelta! > 0 ? "+" : ""}
              {diff.periodWeeksDelta}w)
            </span>
          </DiffCard>
        )}

        {(diff.supplementsAdded.length > 0 || diff.supplementsRemoved.length > 0) && (
          <DiffCard label="Supplements">
            {diff.supplementsAdded.length > 0 && (
              <div>
                <span style={{ color: "#16a34a" }}>+ {diff.supplementsAdded.length}</span>{" "}
                <code style={{ fontSize: 10 }}>{diff.supplementsAdded.join(", ")}</code>
              </div>
            )}
            {diff.supplementsRemoved.length > 0 && (
              <div>
                <span style={{ color: "#dc2626" }}>− {diff.supplementsRemoved.length}</span>{" "}
                <code style={{ fontSize: 10 }}>{diff.supplementsRemoved.join(", ")}</code>
              </div>
            )}
          </DiffCard>
        )}

        {diff.supplementsBrandSwapped.length > 0 && (
          <DiffCard label={`🔁 Brand swaps (${diff.supplementsBrandSwapped.length})`}>
            <div
              style={{
                fontSize: 10,
                color: "var(--fm-text-secondary)",
                marginBottom: 3,
                fontStyle: "italic",
              }}
            >
              Same compound, different brand catalogue entry — usually not a clinical change.
            </div>
            {diff.supplementsBrandSwapped.slice(0, 4).map((s, i) => (
              <div key={i} style={{ fontSize: 10, marginTop: 2 }}>
                <code style={{ color: "#dc2626" }}>{s.activeSlug}</code> →{" "}
                <code style={{ color: "#16a34a" }}>{s.draftSlug}</code>
              </div>
            ))}
            {diff.supplementsBrandSwapped.length > 4 && (
              <div style={{ fontSize: 10, color: "var(--fm-text-tertiary)" }}>
                +{diff.supplementsBrandSwapped.length - 4} more
              </div>
            )}
          </DiffCard>
        )}

        {diff.supplementsModified.length > 0 && (
          <DiffCard label="Supplement adjustments">
            {diff.supplementsModified.slice(0, 4).map((m, i) => (
              <div key={i} style={{ fontSize: 11 }}>
                <code>{m.slug}</code> {m.field}:{" "}
                <span style={{ color: "var(--fm-text-secondary)" }}>{m.activeValue}</span>{" "}
                → <strong>{m.draftValue}</strong>
              </div>
            ))}
            {diff.supplementsModified.length > 4 && (
              <div style={{ color: "var(--fm-text-secondary)", fontSize: 10 }}>
                +{diff.supplementsModified.length - 4} more
              </div>
            )}
          </DiffCard>
        )}

        {(diff.labOrdersAdded.length > 0 || diff.labOrdersRemoved.length > 0) && (
          <DiffCard label="Lab orders">
            {diff.labOrdersAdded.length > 0 && (
              <div>
                <span style={{ color: "#16a34a" }}>+ {diff.labOrdersAdded.length}</span> ordered
              </div>
            )}
            {diff.labOrdersRemoved.length > 0 && (
              <div>
                <span style={{ color: "#dc2626" }}>− {diff.labOrdersRemoved.length}</span> dropped
              </div>
            )}
          </DiffCard>
        )}

        {(diff.referralsAdded.length > 0 || diff.referralsRemoved.length > 0) && (
          <DiffCard label="Referrals">
            {diff.referralsAdded.length > 0 && (
              <div>
                <span style={{ color: "#16a34a" }}>+ {diff.referralsAdded.length}</span>{" "}
                {diff.referralsAdded.slice(0, 2).join(", ")}
              </div>
            )}
            {diff.referralsRemoved.length > 0 && (
              <div>
                <span style={{ color: "#dc2626" }}>− {diff.referralsRemoved.length}</span>{" "}
                {diff.referralsRemoved.slice(0, 2).join(", ")}
              </div>
            )}
          </DiffCard>
        )}

        {(diff.lifestyleAdded > 0 || diff.lifestyleRemoved > 0) && (
          <DiffCard label="Lifestyle practices">
            <span style={{ color: "var(--fm-text-secondary)" }}>
              {diff.lifestyleAdded > 0 && (
                <>
                  <span style={{ color: "#16a34a" }}>+ {diff.lifestyleAdded}</span>{" "}
                </>
              )}
              {diff.lifestyleRemoved > 0 && (
                <span style={{ color: "#dc2626" }}>− {diff.lifestyleRemoved}</span>
              )}
            </span>
          </DiffCard>
        )}
      </div>

      {/* Semantic comparison surface */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px dashed rgba(0,0,0,0.12)",
        }}
      >
        {!semantic && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "var(--fm-text-secondary)", fontSize: 11 }}>
              Coach notes {diff.notesChanged ? "differ" : "are identical"}
              {diff.notesChanged && diff.notesLengthDelta !== 0 && (
                <>
                  {" "}
                  ({diff.notesLengthDelta > 0 ? "+" : ""}
                  {diff.notesLengthDelta} chars)
                </>
              )}
            </span>
            {diff.notesChanged && (
              <button
                onClick={() => runSemantic(false)}
                disabled={pending}
                style={{
                  padding: "4px 10px",
                  background: "#1f2937",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 3,
                  cursor: pending ? "wait" : "pointer",
                }}
              >
                {pending ? "🔍 Reading notes…" : "🔍 Compare coach notes (AI)"}
              </button>
            )}
          </div>
        )}

        {semantic && semantic.ok && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 11 }}>AI verdict:</strong>
              <span style={{ fontSize: 11 }}>
                {CHANGE_TYPE_LABEL[semantic.change_type ?? "unclear"]}
              </span>
              {semantic.publish_recommendation && (
                <span
                  style={{
                    padding: "2px 8px",
                    background: PUBLISH_REC_LABEL[semantic.publish_recommendation].bg,
                    color: PUBLISH_REC_LABEL[semantic.publish_recommendation].text,
                    fontWeight: 700,
                    fontSize: 10,
                    borderRadius: 3,
                    letterSpacing: "0.4px",
                  }}
                >
                  {PUBLISH_REC_LABEL[semantic.publish_recommendation].label}
                </span>
              )}
              {semantic.cached && (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--fm-text-tertiary)",
                    fontStyle: "italic",
                  }}
                  title="Result loaded from cache. Click Re-check to recompute."
                >
                  (cached)
                </span>
              )}
            </div>

            {semantic.change_summary && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--fm-text-secondary)",
                  lineHeight: 1.5,
                  fontStyle: "italic",
                }}
              >
                {semantic.change_summary}
              </div>
            )}

            {semantic.specific_changes && semantic.specific_changes.length > 0 && (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 11,
                  color: "var(--fm-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {semantic.specific_changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}

            <button
              onClick={() => runSemantic(true)}
              disabled={pending}
              style={{
                alignSelf: "flex-start",
                padding: "3px 8px",
                background: "transparent",
                color: "var(--fm-text-tertiary)",
                fontSize: 10,
                fontWeight: 600,
                border: "1px solid var(--fm-text-tertiary)",
                borderRadius: 3,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              {pending ? "Re-checking…" : "🔄 Re-check (force refresh)"}
            </button>
          </div>
        )}

        {semantic && !semantic.ok && (
          <div
            style={{
              padding: 8,
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid #dc2626",
              borderRadius: 3,
              fontSize: 11,
              color: "#7f1d1d",
            }}
          >
            <strong>AI check failed:</strong>{" "}
            {semantic.error?.includes("usage limits") ||
            semantic.error?.includes("workspace API usage") ? (
              <>
                Monthly API cap reached. Resets June 1. Coach can still publish based on the
                structural diff above.
              </>
            ) : (
              <code style={{ fontSize: 10 }}>{semantic.error}</code>
            )}
            <button
              onClick={() => runSemantic(true)}
              disabled={pending}
              style={{
                marginLeft: 8,
                padding: "2px 8px",
                background: "#7f1d1d",
                color: "#fff",
                fontSize: 10,
                fontWeight: 600,
                border: "none",
                borderRadius: 3,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-component ──────────────────────────────────────────────────────────

function DiffCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "6px 10px",
        background: "rgba(255,255,255,0.55)",
        border: "1px solid rgba(0,0,0,0.07)",
        borderRadius: 4,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          color: "var(--fm-text-tertiary)",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 11, color: "var(--fm-text-primary)" }}>{children}</div>
    </div>
  );
}
