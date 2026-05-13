"use client";

/**
 * EngagementPicker — small inline picker for the post-discovery
 * sign-up decision. Three options: ✅ Signed up · 🤔 Pending · 🚫 Declined.
 *
 * Renders as either:
 *  - compact pill row with the current state highlighted (when current
 *    state already exists), or
 *  - a callout card when the discovery is done but pending (coach hasn't
 *    decided yet) — bigger, more obvious "tell me what happened" UX.
 *
 * Click → server action updates client.yaml's engagement_status →
 * router.refresh() so the journey strip and stage banner re-render.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateClientProfile,
  type EngagementStatus,
} from "@/app/clients/actions";

interface Props {
  clientId: string;
  /** Current value from client.yaml. `undefined` = never set. */
  current: EngagementStatus | undefined;
  /** When true, render the "tell me what happened" callout. Else the compact pill row. */
  callout?: boolean;
}

const OPTIONS: {
  value: EngagementStatus;
  label: string;
  emoji: string;
  bg: string;
  bgActive: string;
  border: string;
  borderActive: string;
  text: string;
  textActive: string;
}[] = [
  {
    value: "signed_up",
    label: "Signed up",
    emoji: "✅",
    bg: "rgba(46, 204, 113, 0.08)",
    bgActive: "#1E8449",
    border: "rgba(46, 204, 113, 0.30)",
    borderActive: "#1E8449",
    text: "#1E8449",
    textActive: "#fff",
  },
  {
    value: "pending",
    label: "Still deciding",
    emoji: "🤔",
    bg: "rgba(243, 156, 18, 0.08)",
    bgActive: "#F39C12",
    border: "rgba(243, 156, 18, 0.30)",
    borderActive: "#F39C12",
    text: "#8a5a08",
    textActive: "#fff",
  },
  {
    value: "declined",
    label: "Declined",
    emoji: "🚫",
    bg: "rgba(231, 76, 60, 0.08)",
    bgActive: "#E74C3C",
    border: "rgba(231, 76, 60, 0.30)",
    borderActive: "#E74C3C",
    text: "#a32c1c",
    textActive: "#fff",
  },
];

export function EngagementPicker({ clientId, current, callout }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const apply = (value: EngagementStatus) => {
    if (value === current) return;
    startTransition(async () => {
      const res = await updateClientProfile({
        client_id: clientId,
        engagement_status: value,
      });
      if (res.ok) {
        const label = OPTIONS.find((o) => o.value === value)?.label ?? value;
        toast.success(`✓ Sign-up status set to "${label}"`);
        router.refresh();
      } else {
        toast.error(res.error ?? "Save failed", { duration: 12000 });
      }
    });
  };

  if (callout) {
    return (
      <div
        style={{
          padding: "12px 14px",
          background: "rgba(243, 156, 18, 0.08)",
          border: "1.5px solid rgba(243, 156, 18, 0.40)",
          borderRadius: "var(--fm-radius-md)",
          display: "grid",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🤝</span>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "#8a5a08",
            }}
          >
            Did the client sign up after discovery?
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            lineHeight: 1.45,
          }}
        >
          Marking this lets the journey strip and dashboard signal
          whether this client is moving forward to intake, still
          deciding, or politely declined.
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OPTIONS.map((o) => {
            const active = current === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => apply(o.value)}
                disabled={pending || active}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 12px",
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: active ? o.bgActive : o.bg,
                  color: active ? o.textActive : o.text,
                  border: `1px solid ${active ? o.borderActive : o.border}`,
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: pending || active ? "default" : "pointer",
                  fontFamily: "inherit",
                  opacity: pending && !active ? 0.5 : 1,
                }}
              >
                <span>{o.emoji}</span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Compact pill row
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {OPTIONS.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => apply(o.value)}
            disabled={pending || active}
            title={`Set sign-up status to "${o.label}"`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 9px",
              fontSize: 10.5,
              fontWeight: 700,
              background: active ? o.bgActive : "transparent",
              color: active ? o.textActive : o.text,
              border: `1px solid ${active ? o.borderActive : o.border}`,
              borderRadius: 999,
              cursor: pending || active ? "default" : "pointer",
              fontFamily: "inherit",
              opacity: pending && !active ? 0.5 : 1,
            }}
          >
            <span>{o.emoji}</span>
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
