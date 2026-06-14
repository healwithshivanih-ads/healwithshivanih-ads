"use client";

/**
 * PlanConflictPanel — surfaces dietary / non-negotiable / allergy
 * contradictions on the draft (or published) plan page. Each conflict
 * gets an optional one-click "Apply suggestion" button that patches the
 * underlying client YAML.
 *
 * Coach's framing (2026-05-13): "If client is lactose-free and
 * non-negotiables says tea with milk — suggest nut milk, let me click
 * to apply, and the plan updates automatically."
 *
 * Lives on /clients-v2/[id]/plan and is rendered server-side from the
 * page's already-loaded client + plan data. Apply is wired via a server
 * action that mutates client.yaml; the page revalidates after each.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PlanConflict, ConflictFix } from "@/lib/fmdb/plan-conflicts";
import { applyConflictFixAction } from "./plan-conflict-actions";
import { FmCallout } from "@/components/fm";

interface Props {
  clientId: string;
  conflicts: PlanConflict[];
}

const SEVERITY_STYLE: Record<
  PlanConflict["severity"],
  { bg: string; border: string; icon: string; textCol: string }
> = {
  info: {
    bg: "rgba(26, 127, 187, 0.06)",
    border: "rgba(26, 127, 187, 0.30)",
    icon: "ℹ️",
    textCol: "var(--fm-secondary, #1a7fbb)",
  },
  warning: {
    bg: "rgba(243, 156, 18, 0.08)",
    border: "rgba(243, 156, 18, 0.40)",
    icon: "⚠️",
    textCol: "#8a5a08",
  },
  critical: {
    bg: "rgba(231, 76, 60, 0.08)",
    border: "rgba(231, 76, 60, 0.40)",
    icon: "🚩",
    textCol: "#a32c1c",
  },
};

export function PlanConflictPanel({ clientId, conflicts: initial }: Props) {
  const router = useRouter();
  const [conflicts, setConflicts] = useState<PlanConflict[]>(initial);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (conflicts.length === 0) return null;

  const applyFix = (conflict: PlanConflict, fix: ConflictFix) => {
    setPendingId(conflict.id);
    startTransition(async () => {
      const res = await applyConflictFixAction(clientId, fix);
      setPendingId(null);
      if (res.ok) {
        toast.success(`✓ Applied: ${conflict.suggested_fix?.label ?? "fix"}`);
        // Drop this conflict from the list — the patch resolved it.
        setConflicts((cs) => cs.filter((c) => c.id !== conflict.id));
        // Refresh so server components pick up the new client.yaml.
        router.refresh();
      } else {
        toast.error(`Apply failed: ${res.error}`, { duration: 12000 });
      }
    });
  };

  const dismiss = (conflict: PlanConflict) => {
    setConflicts((cs) => cs.filter((c) => c.id !== conflict.id));
    toast.message(`Dismissed: ${conflict.summary}`, {
      description:
        "Hidden for this view only — the conflict will reappear on the next page load until you resolve the underlying data.",
      duration: 6000,
    });
  };

  return (
    <FmCallout
      tone="danger"
      icon="🩺"
      title={
        <>
          Plan-conflict check · {conflicts.length} item
          {conflicts.length === 1 ? "" : "s"} need
          {conflicts.length === 1 ? "s" : ""} your call
        </>
      }
      style={{ marginBottom: 16 }}
    >
      <div style={{ display: "grid", gap: 8 }}>
        {conflicts.map((c) => {
          const sty = SEVERITY_STYLE[c.severity];
          const isPending = pendingId === c.id;
          return (
            <div
              key={c.id}
              style={{
                display: "grid",
                gap: 8,
                padding: "10px 12px",
                background: sty.bg,
                border: `1px solid ${sty.border}`,
                borderRadius: "var(--fm-radius-sm, 6px)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, lineHeight: "20px" }}>{sty.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: sty.textCol,
                    }}
                  >
                    {c.summary}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--fm-text-secondary, #5a5a5a)",
                      marginTop: 3,
                      lineHeight: 1.5,
                    }}
                  >
                    {c.details}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(c)}
                  title="Hide this conflict on this page only"
                  style={{
                    fontSize: 14,
                    background: "transparent",
                    border: "1px solid var(--fm-border-light, #e8e8e8)",
                    color: "var(--fm-text-tertiary, #999)",
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    cursor: "pointer",
                    lineHeight: "20px",
                    padding: 0,
                    fontFamily: "inherit",
                    flexShrink: 0,
                  }}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
              {c.suggested_fix && (
                <div
                  style={{
                    display: "grid",
                    gap: 6,
                    padding: 10,
                    background: "var(--fm-surface, #fff)",
                    border: "1px dashed var(--fm-border, #e8e8e8)",
                    borderRadius: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--fm-text-primary, #1a1a1a)",
                    }}
                  >
                    💡 Suggestion: {c.suggested_fix.label}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--fm-text-secondary, #5a5a5a)",
                      lineHeight: 1.5,
                    }}
                  >
                    {c.suggested_fix.rationale}
                  </div>
                  <div
                    style={{ display: "flex", gap: 6, marginTop: 2, flexWrap: "wrap" }}
                  >
                    <button
                      type="button"
                      onClick={() => applyFix(c, c.suggested_fix!.action)}
                      disabled={isPending}
                      style={{
                        padding: "5px 12px",
                        fontSize: 11,
                        fontWeight: 700,
                        background: "var(--fm-primary, #ff6b35)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        cursor: isPending ? "wait" : "pointer",
                        fontFamily: "inherit",
                        opacity: isPending ? 0.6 : 1,
                      }}
                    >
                      {isPending ? "Applying…" : "✓ Apply"}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(c)}
                      disabled={isPending}
                      style={{
                        padding: "5px 12px",
                        fontSize: 11,
                        fontWeight: 600,
                        background: "transparent",
                        color: "var(--fm-text-secondary, #5a5a5a)",
                        border: "1px solid var(--fm-border, #e8e8e8)",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Decide later
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--fm-text-tertiary, #999)",
          fontStyle: "italic",
        }}
      >
        Conflicts auto-detected from the client&apos;s preferences vs the draft
        plan. Applying a suggestion updates the underlying client profile;
        the next regenerated letter will reflect it.
      </div>
    </FmCallout>
  );
}
