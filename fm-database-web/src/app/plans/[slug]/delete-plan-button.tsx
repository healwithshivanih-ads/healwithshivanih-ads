"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deletePlan } from "./actions";

export function DeletePlanButton({
  slug,
  status,
}: {
  slug: string;
  status: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === "published") return null; // use Revoke for published plans

  if (!confirming) {
    return (
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        🗑 Delete plan
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5">
      <span className="text-xs text-destructive font-medium">
        Delete <span className="font-mono">{slug}</span> permanently?
      </span>
      <Button
        variant="destructive"
        size="sm"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await deletePlan(slug);
            // deletePlan redirects on success — only reaches here on error
            if (result && !result.ok) setError(result.error);
          });
        }}
      >
        {isPending ? "Deleting…" : "Yes, delete"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
