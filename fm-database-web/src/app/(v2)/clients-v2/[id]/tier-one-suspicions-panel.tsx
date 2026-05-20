"use client";

/**
 * TierOneSuspicionsPanel (v0.75.7) — surfaces deterministic retrospective
 * Tier 1 suspicions on the client Overview. Zero API cost — computation
 * runs on the server-side render of page.tsx and the result is passed
 * in here.
 *
 * Renders only when the client submitted intake BEFORE v0.75.2 (no
 * structured Tier 1 fields) AND at least one suspicion was inferred
 * from the older free-text + chip fields.
 *
 * Each suspicion has a one-click "📨 Re-issue intake to verify" button
 * that re-uses the existing token generation flow.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SuspectedSignal } from "@/lib/fmdb/retrospective-tier1";

interface Props {
  clientId: string;
  suspicions: SuspectedSignal[];
  /** True if client already has Tier 1 structured fields. Hides panel entirely. */
  hasStructuredTierOne: boolean;
}

const SIGNAL_META: Record<SuspectedSignal["signal"], { icon: string; label: string }> = {
  pem: { icon: "💥", label: "Post-exertional malaise (PEM)" },
  mcas: { icon: "🔥", label: "MCAS / histamine intolerance" },
  pots: { icon: "🩺", label: "POTS / orthostatic intolerance" },
  hypermobility: { icon: "🦋", label: "Joint hypermobility / EDS" },
  mould: { icon: "🏚", label: "Mould / CIRS exposure" },
};

export function TierOneSuspicionsPanel({
  clientId,
  suspicions,
  hasStructuredTierOne,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Hide entirely when:
  //  • client has structured Tier 1 data (the form already captured it)
  //  • no suspicions inferred
  if (hasStructuredTierOne || suspicions.length === 0) return null;

  const onReissue = () => {
    startTransition(async () => {
      const { generateIntakeToken } = await import("@/lib/server-actions/intake");
      const res = await generateIntakeToken(clientId, 14, false);
      if (res.ok) {
        toast.success(
          "📨 New pre-discovery intake link generated — open the SendIntakeFormButton to send via WhatsApp",
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Token generation failed");
      }
    });
  };

  const highConfidenceCount = suspicions.filter((s) => s.confidence === "high").length;

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(99, 102, 241, 0.06)",
        border: "1.5px solid rgba(99, 102, 241, 0.30)",
        borderRadius: "var(--fm-radius-md)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🔍</span>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#4338ca" }}>
          Suspected Tier 1 signals (legacy intake)
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            fontStyle: "italic",
          }}
        >
          inferred from older free-text — verify with refresh
        </span>
      </div>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "grid",
          gap: 8,
        }}
      >
        {suspicions.map((s) => {
          const meta = SIGNAL_META[s.signal];
          const isHigh = s.confidence === "high";
          return (
            <li
              key={s.signal}
              style={{
                padding: "8px 10px",
                background: "#fff",
                border: `1px solid ${isHigh ? "rgba(220, 38, 38, 0.30)" : "rgba(148, 163, 184, 0.4)"}`,
                borderRadius: "var(--fm-radius-sm)",
                fontSize: 12,
                lineHeight: 1.5,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1.2 }}>{meta.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: isHigh ? "#b91c1c" : "var(--fm-text-primary)",
                  }}
                >
                  Suspected {meta.label}
                  <span
                    style={{
                      marginLeft: 6,
                      padding: "1px 6px",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      background: isHigh ? "#fef2f2" : "#f1f5f9",
                      color: isHigh ? "#b91c1c" : "var(--fm-text-secondary)",
                      borderRadius: 3,
                    }}
                  >
                    {s.confidence}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--fm-text-secondary)",
                    marginTop: 2,
                  }}
                >
                  {s.reason}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onReissue}
          disabled={pending}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 700,
            background: pending ? "#94a3b8" : "#4338ca",
            color: "#fff",
            border: "none",
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {pending ? "Generating…" : "📨 Re-issue intake to verify"}
        </button>
        <span
          style={{ fontSize: 11, color: "var(--fm-text-tertiary)", lineHeight: 1.4 }}
        >
          Client returns to the same form, fills only the new Tier 1 sections —
          earlier answers stay saved.
          {highConfidenceCount > 0
            ? ` (${highConfidenceCount} high-confidence signal${highConfidenceCount === 1 ? "" : "s"} — worth doing.)`
            : ""}
        </span>
      </div>
    </div>
  );
}
