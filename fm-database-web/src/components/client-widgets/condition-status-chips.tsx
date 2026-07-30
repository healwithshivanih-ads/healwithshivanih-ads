"use client";

/**
 * Retire a condition, or bring it back.
 *
 * The coach could always edit the two lists by hand in the profile editor —
 * but that means retyping the condition into `medical_history`, deleting it
 * from `active_conditions`, and remembering to date it. Nobody does that, so
 * cleared conditions never left: a fortnight of constipation outlived itself
 * on a real client's app while his blood pressure went unmentioned.
 *
 * One tap, correct wording, dated. That is the whole point of the component.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { isResolvedEntry, stripResolvedStamp } from "@/lib/fmdb/condition-status";
import { reactivateCondition, resolveCondition } from "@/lib/server-actions/condition-status";

export function ConditionStatusChips({
  clientId,
  active,
  history,
}: {
  clientId: string;
  active: string[];
  history: string[];
}) {
  const [pending, start] = useTransition();
  const [live, setLive] = useState({ active, history });
  // Only entries WE stamped can be brought back — a hand-written history line
  // ("Appendectomy 2011") is not a condition waiting to return.
  const returnable = live.history.filter(isResolvedEntry);

  const act = (fn: () => Promise<{ ok: boolean; active?: string[]; history?: string[]; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok && r.active && r.history) {
        setLive({ active: r.active, history: r.history });
        toast.success(msg);
      } else {
        toast.error(r.error ?? "Could not update");
      }
    });

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, color: "var(--fm-muted)", marginBottom: 6 }}>
        Resolved conditions move to medical history — kept on file, but they stop
        driving the plan, the AI context and the client&apos;s app.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {live.active.map((c) => (
          <button
            key={c}
            disabled={pending}
            title="Mark resolved — moves it to medical history"
            onClick={() => act(() => resolveCondition(clientId, c), `“${c}” moved to history`)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer",
              border: "1px solid var(--fm-line)", background: "#fff", color: "var(--fm-ink, #262219)",
              opacity: pending ? 0.55 : 1,
            }}
          >
            {c}
            <span aria-hidden="true" style={{ color: "var(--fm-muted)", fontSize: 13 }}>✓</span>
          </button>
        ))}
        {live.active.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--fm-muted)" }}>No active conditions.</span>
        )}
      </div>

      {returnable.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "var(--fm-muted)", marginBottom: 5 }}>Resolved</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {returnable.map((h) => (
              <button
                key={h}
                disabled={pending}
                title="It came back — move it to active conditions"
                onClick={() =>
                  act(() => reactivateCondition(clientId, h), `“${stripResolvedStamp(h)}” is active again`)
                }
                style={{
                  fontSize: 11.5, padding: "4px 9px", borderRadius: 999, cursor: "pointer",
                  border: "1px dashed var(--fm-line)", background: "transparent",
                  color: "var(--fm-muted)", opacity: pending ? 0.55 : 1,
                }}
              >
                {h} ↩
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
