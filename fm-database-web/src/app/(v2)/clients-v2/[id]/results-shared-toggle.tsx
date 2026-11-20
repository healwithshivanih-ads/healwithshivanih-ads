"use client";

/**
 * ResultsSharedToggle — the coach releases a client's results to the new app
 * front (client.yaml#results_shared_on). Until then body age and lab numbers
 * stay off the client's app and results questions come to the coach.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setResultsSharedAction } from "@/lib/server-actions/food-diary";

export function ResultsSharedToggle({ clientId, sharedOn, note }: { clientId: string; sharedOn: string | null; note: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(note ?? "");
  const act = (share: boolean) =>
    start(async () => {
      const r = await setResultsSharedAction(clientId, share, draft);
      if (r.ok) {
        toast.success(share ? "Results shared in the app" : "Results hidden in the app");
        router.refresh();
      } else toast.error(`Couldn't change it — ${r.error}`);
    });
  const btn = {
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    background: "transparent",
    color: "var(--fm-text-primary)",
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    cursor: pending ? "wait" : "pointer",
    fontFamily: "inherit",
  } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
        {sharedOn
          ? `Results shared in the new app on ${sharedOn}: body age and lab numbers, each marked within, above or below the usual range.`
          : "Results not shared in the new app: results questions come to you."}
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Optional note shown above the numbers"
        maxLength={500}
        style={{ fontSize: 12, padding: "4px 8px", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)", fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={btn} disabled={pending} onClick={() => act(true)}>
          {pending ? "Saving…" : sharedOn ? "Update note" : "Share results"}
        </button>
        {sharedOn && (
          <button type="button" style={btn} disabled={pending} onClick={() => act(false)}>
            Hide again
          </button>
        )}
      </div>
    </div>
  );
}
