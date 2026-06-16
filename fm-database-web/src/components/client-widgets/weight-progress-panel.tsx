"use client";

/**
 * WeightProgressPanel (#2) — the on/off-track verdict for a weight-loss
 * client, sitting above the WeightLossCard on the Overview → Weight loss tab.
 *
 * The WeightLossCard shows the trend but never judges it. This panel reads
 * the pure detector (assessWeightProgress) and turns the weigh-in series into
 * a verdict — on track / behind / plateau / regain / overdue weigh-in — with
 * the headline numbers and, when the client needs attention, a one-click
 * "Run rework" that fires the same assessReworkBenefitAction the check-in /
 * lab / adherence-drop paths use. The resulting rework_suggestion surfaces in
 * the <ReworkBanner> at the top of the overview.
 *
 * Renders nothing when there's no weight-loss goal (the card's empty state
 * covers that case).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmCallout } from "@/components/fm/FmCallout";
import type {
  WeightProgressResult,
  WeightProgressStatus,
  ObservedTdeeEstimate,
} from "@/lib/fmdb/weight-progress";

const TONE: Record<WeightProgressStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  no_goal: "neutral",
  no_data: "info",
  too_early: "info",
  on_track: "success",
  ahead: "info",
  behind: "danger",
  plateau: "warning",
  regain: "danger",
};

const ICON: Record<WeightProgressStatus, string> = {
  no_goal: "•",
  no_data: "⚖️",
  too_early: "⏳",
  on_track: "✅",
  ahead: "🚀",
  behind: "⚠️",
  plateau: "⏸",
  regain: "🔺",
};

export function WeightProgressPanel({
  clientId,
  result,
  tdee,
}: {
  clientId: string;
  result: WeightProgressResult;
  /** Observed-TDEE reality check (#3). Null until ~2 weeks of weigh-ins. */
  tdee?: ObservedTdeeEstimate | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ran, setRan] = useState(false);

  // No goal → nothing to say; the card renders its own empty state.
  if (result.status === "no_goal") return null;

  const runRework = () => {
    startTransition(async () => {
      const { assessReworkBenefitAction } = await import("@/lib/server-actions/clients");
      const summary =
        `Weight-loss progress check — status: ${result.status}. ${result.headline}. ` +
        `Expected ~${result.expectedWeeklyKg ?? "?"} kg/wk; actual ~${result.actualWeeklyKg ?? "?"} kg/wk` +
        (result.attainmentPct != null ? ` (${result.attainmentPct}% of expected by now)` : "") +
        `. The prescribed deficit may not be a real deficit for this client — review whether weight-loss ` +
        `resistance drivers (under-optimised thyroid, insulin resistance, cortisol/sleep, perimenopause, ` +
        `weight-gain medication) are unaddressed, whether portions/adherence need verifying, and propose a ` +
        `concrete adjustment (recompute the target off observed loss, tighten portions, add protein + ` +
        `resistance training, or a diet break) rather than just cutting calories further.`;
      const r = await assessReworkBenefitAction({
        clientId,
        // 'quick_note' is the closest existing trigger enum (same choice the
        // weekly-poll adherence-drop path uses); the Python is permissive.
        triggeredBy: "quick_note",
        eventSummary: summary,
      });
      if (!r.ok) {
        toast.error(r.error || "Rework failed");
        return;
      }
      setRan(true);
      toast.success("Rework assessed — see the suggestion at the top of the overview");
      router.refresh();
    });
  };

  const applyTdee = (value: number | null) => {
    startTransition(async () => {
      const { setWeightLossTdeeOverride } = await import("@/lib/server-actions/clients");
      const r = await setWeightLossTdeeOverride(clientId, value);
      if (!r.ok) {
        toast.error(r.error || "Couldn't update TDEE");
        return;
      }
      toast.success(
        value == null
          ? "Reverted to predicted TDEE"
          : `Calorie targets now use the observed ${value} kcal — applies to the next letter`,
      );
      router.refresh();
    });
  };

  const metrics: string[] = [];
  if (result.startKg != null && result.latestKg != null) {
    metrics.push(`${result.startKg} → ${result.latestKg} kg`);
  }
  if (result.actualLossKg != null && result.expectedLossKg != null) {
    metrics.push(`lost ${result.actualLossKg} of ~${result.expectedLossKg} kg`);
  }
  if (result.actualWeeklyKg != null && result.expectedWeeklyKg != null) {
    metrics.push(`${result.actualWeeklyKg} vs ~${result.expectedWeeklyKg} kg/wk`);
  }
  if (result.staleDays != null && result.staleDays > 14) {
    metrics.push(`last weigh-in ${result.staleDays}d ago`);
  }

  const showRework = result.needsAttention && !ran;

  return (
    <FmCallout
      tone={TONE[result.status]}
      icon={ICON[result.status]}
      title={`Progress · ${result.headline}`}
      actions={
        showRework ? (
          <button
            type="button"
            className="FmBtn FmBtn--primary FmBtn--sm"
            onClick={runRework}
            disabled={pending}
            title="Run an AI rework assessment factoring in the weight-loss stall"
          >
            {pending ? "Assessing…" : "🔁 Run rework"}
          </button>
        ) : ran ? (
          <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>✓ Rework assessed</span>
        ) : undefined
      }
    >
      <div>{result.detail}</div>
      {metrics.length > 0 && (
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            fontFamily: "var(--fm-font-mono)",
            color: "var(--fm-text-tertiary)",
          }}
        >
          {metrics.join(" · ")}
          {result.readingsCount > 0 ? ` · ${result.readingsCount} weigh-in${result.readingsCount === 1 ? "" : "s"}` : ""}
        </div>
      )}
      {tdee && (showTdee(tdee) || tdee.currentOverride != null) && (
        <TdeeRealityCheck tdee={tdee} pending={pending} onApply={applyTdee} />
      )}
    </FmCallout>
  );
}

/** Worth surfacing the TDEE block only when it's actionable — a meaningful
 *  gap between measured and model burn, or the goal pace busts the floor. */
function showTdee(t: ObservedTdeeEstimate): boolean {
  return Math.abs(t.divergencePct) >= 8 || t.flooredAtMin;
}

function TdeeRealityCheck({
  tdee,
  pending,
  onApply,
}: {
  tdee: ObservedTdeeEstimate;
  pending: boolean;
  onApply: (value: number | null) => void;
}) {
  const sign = tdee.divergencePct > 0 ? "+" : "";
  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: "var(--fm-radius-sm)",
        border: "1px dashed var(--fm-border)",
        background: "var(--fm-surface)",
        fontSize: 11.5,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--fm-text-primary)", marginBottom: 2 }}>
        ⚖️ TDEE reality check
      </div>
      <div style={{ color: "var(--fm-text-secondary)" }}>
        Real burn ≈ <strong>{tdee.observedTdee} kcal</strong> vs the model&rsquo;s{" "}
        {tdee.modelTdee} kcal ({sign}
        {tdee.divergencePct}%, from {tdee.observedLossKg} kg over {tdee.windowDays} days
        {tdee.currentOverride != null ? ", override applied" : ""}).
        {tdee.flooredAtMin ? (
          <>
            {" "}
            To lose {tdee.expectedWeeklyKg} kg/wk she&rsquo;d need ~
            {tdee.observedTdee - tdee.requiredDailyDeficit} kcal — below the 1200 floor. Fastest
            safe loss ≈ <strong>{tdee.achievablePaceAtFloor} kg/wk</strong>; raise her burn with
            movement/strength rather than cutting food further.
          </>
        ) : (
          <>
            {" "}
            To hit {tdee.expectedWeeklyKg} kg/wk the daily target should be ~
            <strong>{tdee.correctedFullTarget} kcal</strong>.
          </>
        )}
        {tdee.lowConfidence && (
          <span style={{ color: "var(--fm-text-tertiary)" }}>
            {" "}
            Early estimate — the first weeks shed water weight, so this can read high. Confirm
            with another week of weigh-ins before applying.
          </span>
        )}
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {tdee.alreadyApplied ? (
          <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            ✓ Letters use the observed {tdee.currentOverride} kcal
          </span>
        ) : (
          <button
            type="button"
            className="FmBtn FmBtn--primary FmBtn--sm"
            onClick={() => onApply(tdee.recommendedOverride)}
            disabled={pending}
            title="Recompute all calorie targets off the measured burn instead of the formula"
          >
            {pending ? "Applying…" : `Use observed TDEE (${tdee.observedTdee})`}
          </button>
        )}
        {tdee.currentOverride != null && (
          <button
            type="button"
            className="FmBtn FmBtn--ghost FmBtn--sm"
            onClick={() => onApply(null)}
            disabled={pending}
          >
            Reset to formula
          </button>
        )}
      </div>
    </div>
  );
}
