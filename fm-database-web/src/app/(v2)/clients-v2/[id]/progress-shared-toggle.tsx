"use client";

/**
 * ProgressSharedToggle — the coach releases a client's progress to the new
 * app front (client.yaml#progress_shared_on, progress-view.ts). Each share is
 * a dated snapshot with her note on top; until the first one the app says the
 * first look comes at a review. "Preview" shows what the client would see if
 * she shared today, from the app's own loader.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setProgressHideWeightAction, setProgressSharedAction } from "@/lib/server-actions/food-diary";
import { progressPreviewAction } from "@/lib/server-actions/app-preview";

export function ProgressSharedToggle({
  clientId,
  sharedOn,
  note,
  hideWeight,
}: {
  clientId: string;
  sharedOn: string | null;
  note: string | null;
  hideWeight: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(note ?? "");
  const [lines, setLines] = useState<string[] | null>(null);

  const act = (share: boolean) =>
    start(async () => {
      const r = await setProgressSharedAction(clientId, share, draft);
      if (r.ok) {
        toast.success(share ? "Progress shared in the app, as of today" : "Progress hidden in the app");
        router.refresh();
      } else toast.error(`Couldn't change it — ${r.error}`);
    });
  const weight = (hide: boolean) =>
    start(async () => {
      const r = await setProgressHideWeightAction(clientId, hide);
      if (r.ok) {
        setLines(null);
        router.refresh();
      } else toast.error(`Couldn't change it — ${r.error}`);
    });
  const preview = () =>
    start(async () => {
      const r = await progressPreviewAction(clientId, hideWeight);
      if (r.ok) setLines(r.lines);
      else toast.error(r.error);
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
      <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
        {sharedOn
          ? `Progress shared in the new app as of ${sharedOn}: wellbeing, readings and your note, up to that day. Share again after the next review for a fresh look.`
          : "Progress not shared in the new app: it says the first look comes at a review with you."}
      </span>
      {lines && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--fm-text-primary)" }}>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Your line, shown at the top of her progress"
        maxLength={500}
        style={{ fontSize: 12, padding: "4px 8px", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)", fontFamily: "inherit" }}
      />
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--fm-text-secondary)" }}>
        <input type="checkbox" checked={hideWeight} disabled={pending} onChange={(e) => weight(e.target.checked)} />
        Leave weight out of her progress
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn} disabled={pending} onClick={preview}>
          {pending && !lines ? "Loading…" : "Preview as of today"}
        </button>
        <button type="button" style={btn} disabled={pending} onClick={() => act(true)}>
          {sharedOn ? "Share an update (as of today)" : "Share progress"}
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
