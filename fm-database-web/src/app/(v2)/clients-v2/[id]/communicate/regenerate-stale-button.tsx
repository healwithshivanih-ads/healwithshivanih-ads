"use client";

/**
 * RegenerateStaleButton — one-click regen for letters the plan has
 * outpaced. Triggered from the staleness banner on /clients-v2/[id]
 * /communicate. Calls generateClientLetter() per stale type, with
 * `forceRegenerate=true` so the cache hit doesn't short-circuit.
 *
 * After all letters finish, refreshes the page so the staleness
 * banner clears + the SendPackageButton picks up the new files.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  generateClientLetter,
  type LetterType,
} from "@/app/plans/[slug]/lifecycle-actions";

interface Props {
  planSlug: string;
  clientId: string;
  staleTypes: LetterType[];
}

const TYPE_LABEL: Record<LetterType, string> = {
  consolidated: "consolidated",
  meal_plan: "meal plan",
  supplement_plan: "supplement plan",
  lifestyle_guide: "lifestyle guide",
  exercise_plan: "exercise plan",
};

export function RegenerateStaleButton({
  planSlug,
  clientId,
  staleTypes,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<{ done: number; current?: string }>({
    done: 0,
  });

  const onClick = () => {
    start(async () => {
      let done = 0;
      const errors: string[] = [];
      for (const t of staleTypes) {
        setProgress({ done, current: TYPE_LABEL[t] });
        try {
          const r = await generateClientLetter(
            planSlug,
            clientId,
            undefined, // no weight-loss params; regen uses existing plan data
            t,
            undefined, // no coach notes; preserves the previous version's intent
            true, // forceRegenerate — skip cache hit
          );
          if (!r.ok) errors.push(`${TYPE_LABEL[t]}: ${r.error ?? "failed"}`);
        } catch (e) {
          errors.push(`${TYPE_LABEL[t]}: ${(e as Error).message}`);
        }
        done += 1;
        setProgress({ done });
      }
      if (errors.length === 0) {
        toast.success(
          `✅ Regenerated ${done} letter${done === 1 ? "" : "s"}`,
        );
      } else {
        toast.error(
          `${done - errors.length}/${done} succeeded · ${errors[0]}`,
          { duration: 8000 },
        );
      }
      setProgress({ done: 0 });
      router.refresh();
    });
  };

  const total = staleTypes.length;
  const label = pending
    ? progress.current
      ? `⏳ ${progress.done}/${total} · ${progress.current}…`
      : `⏳ Regenerating…`
    : `🔄 Regenerate ${total === 1 ? "letter" : `all ${total} stale`} →`;

  return (
    <button
      onClick={onClick}
      disabled={pending}
      style={{
        fontSize: 11.5,
        fontWeight: 700,
        padding: "6px 12px",
        background: "#92400e",
        color: "#fff",
        border: 0,
        borderRadius: "var(--fm-radius-sm)",
        cursor: pending ? "wait" : "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        opacity: pending ? 0.75 : 1,
      }}
    >
      {label}
    </button>
  );
}
