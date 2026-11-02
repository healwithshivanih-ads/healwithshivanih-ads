"use client";

/**
 * ClientFitPanel — "tested against this client" for a plan.
 *
 * A protocol is a template. Before a plan can leave draft, the protocol and
 * every supplement in it need two answers: what in her record says she needs
 * it, and what could go wrong for her. The list comes from
 * fmdb/plan/client_fit.py through plan-check, so this shows exactly what the
 * gate enforces, including any clash found in a product's real ingredients.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FmPanel } from "@/components/fm";
import { runPlanCheck, updatePlan, type FitRequirement } from "@/lib/server-actions/plans";
import type { ClientFitItem } from "@/lib/fmdb/types";

const MIN_ANSWER_CHARS = 20;

const EMPTY_ROW = { decision: "keep", client_evidence: "", risk_check: "" } as const;

interface Props {
  planSlug: string;
  locked: boolean;
  rows: ClientFitItem[];
}

export function ClientFitPanel({ planSlug, locked, rows }: Props) {
  const [required, setRequired] = useState<FitRequirement[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, ClientFitItem>>(() =>
    Object.fromEntries(rows.map((r) => [r.item, r])),
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    runPlanCheck(planSlug).then((res) => {
      if (!live) return;
      if (res.ok) setRequired(res.fit_required ?? []);
      else toast.error(res.error ?? "Could not load what needs testing");
    });
    return () => {
      live = false;
    };
  }, [planSlug]);

  if (!required || required.length === 0) return null;

  const rowFor = (item: string): ClientFitItem => answers[item] ?? { item, ...EMPTY_ROW };
  const update = (item: string, change: Partial<ClientFitItem>) =>
    setAnswers((prev) => ({ ...prev, [item]: { ...rowFor(item), ...change } }));
  const isDone = (item: string) => {
    const row = rowFor(item);
    return (
      row.client_evidence.trim().length >= MIN_ANSWER_CHARS &&
      row.risk_check.trim().length >= MIN_ANSWER_CHARS
    );
  };
  const doneCount = required.filter((need) => isDone(need.item)).length;

  function save() {
    startTransition(async () => {
      const res = await updatePlan(planSlug, { client_fit: Object.values(answers) });
      if (res.ok) toast.success("Saved");
      else toast.error(res.error);
    });
  }

  return (
    <FmPanel
      title="Tested against this client"
      subtitle={`${doneCount} of ${required.length} done. A protocol listing something is not a reason to give it to her.`}
    >
      <div style={{ display: "grid", gap: 14 }}>
        {required.map((need) => {
          const row = rowFor(need.item);
          return (
            <div key={need.item} style={{ borderTop: "1px solid var(--fm-line, #e5e7eb)", paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <strong style={{ fontSize: 14 }}>
                  {need.kind === "protocol" ? `The protocol: ${need.label}` : need.label}
                  {isDone(need.item) ? " ✓" : ""}
                </strong>
                <select
                  aria-label={`Decision for ${need.label}`}
                  value={row.decision}
                  disabled={locked}
                  onChange={(e) =>
                    update(need.item, { decision: e.target.value as ClientFitItem["decision"] })
                  }
                >
                  <option value="keep">Keep</option>
                  <option value="change">Changed for her</option>
                  <option value="drop">Drop</option>
                </select>
              </div>
              {need.flags.map((flag) => (
                <p key={flag.id} style={{ fontSize: 13, color: "#9a3412", margin: "6px 0" }}>
                  ⚠ {flag.reason} {flag.ask}
                </p>
              ))}
              <label style={{ display: "block", fontSize: 13, marginTop: 6 }}>
                What in her record says she needs it?
                <textarea
                  rows={2}
                  style={{ width: "100%" }}
                  disabled={locked}
                  value={row.client_evidence}
                  onChange={(e) => update(need.item, { client_evidence: e.target.value })}
                />
              </label>
              <label style={{ display: "block", fontSize: 13, marginTop: 6 }}>
                What could go wrong for her, and what did we do about it?
                <textarea
                  rows={2}
                  style={{ width: "100%" }}
                  disabled={locked}
                  value={row.risk_check}
                  onChange={(e) => update(need.item, { risk_check: e.target.value })}
                />
              </label>
            </div>
          );
        })}
        {!locked && (
          <Button type="button" onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save answers"}
          </Button>
        )}
      </div>
    </FmPanel>
  );
}
