"use client";

/**
 * Inline Activate button for v2 Plan tab — runs submit + publish in
 * sequence, same pattern as v1 `handleActivate` in client-tabs.tsx.
 *
 * Drafts that are catalogue-clean (plan-check 0 critical) go from
 * draft → ready_to_publish → published in one click. No detour
 * through /plans/<slug> Lifecycle tab.
 *
 * If submit fails (critical findings), the error toast tells the coach
 * to open the classic editor, where the plan-check sidebar shows
 * the specific findings to fix.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { submitPlan, publishPlan } from "@/app/plans/[slug]/lifecycle-actions";

interface Props {
  planSlug: string;
  status: string; // "draft" | "ready_to_publish"
}

export function ActivateDraftButton({ planSlug, status }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [phase, setPhase] = useState<"idle" | "submitting" | "publishing">("idle");

  const onClick = () => {
    start(async () => {
      // If already ready_to_publish, skip the submit step.
      if (status === "draft") {
        setPhase("submitting");
        const sub = await submitPlan(planSlug);
        if (!sub.ok) {
          toast.error(
            sub.error ??
              "Plan-check failed — open the plan editor to see findings",
            { duration: 8000 },
          );
          setPhase("idle");
          return;
        }
      }
      setPhase("publishing");
      const pub = await publishPlan(planSlug);
      if (!pub.ok) {
        toast.error(pub.error ?? "Publish failed", { duration: 8000 });
        setPhase("idle");
        return;
      }
      toast.success("✅ Plan activated!");
      setPhase("idle");
      router.refresh();
    });
  };

  const label =
    phase === "submitting"
      ? "⏳ Running plan check…"
      : phase === "publishing"
        ? "⏳ Publishing…"
        : status === "ready_to_publish"
          ? "🚀 Publish plan"
          : "🚀 Activate plan";

  return (
    <button
      onClick={onClick}
      disabled={pending}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 16px",
        background: "var(--fm-primary)",
        color: "#fff",
        border: 0,
        borderRadius: "var(--fm-radius-sm)",
        fontSize: 13,
        fontWeight: 700,
        cursor: pending ? "wait" : "pointer",
        fontFamily: "inherit",
        opacity: pending ? 0.7 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
