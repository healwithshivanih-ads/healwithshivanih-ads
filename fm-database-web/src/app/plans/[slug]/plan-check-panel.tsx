"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runPlanCheck, type PlanCheckFinding, type PlanCheckResult } from "./actions";

interface PlanCheckPanelProps {
  slug: string;
}

const SEVERITY_ORDER: Array<PlanCheckFinding["severity"]> = [
  "CRITICAL",
  "WARNING",
  "INFO",
];

const SEVERITY_STYLES: Record<
  PlanCheckFinding["severity"],
  { badge: string; group: string; label: string }
> = {
  CRITICAL: {
    badge: "bg-red-600 text-white border-red-700",
    group:
      "border-red-300/60 bg-red-50/70 dark:bg-red-950/30 dark:border-red-900/50",
    label: "Critical",
  },
  WARNING: {
    badge: "bg-amber-500 text-white border-amber-600",
    group:
      "border-amber-300/60 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-900/50",
    label: "Warning",
  },
  INFO: {
    badge: "bg-blue-500 text-white border-blue-600",
    group:
      "border-blue-300/60 bg-blue-50/70 dark:bg-blue-950/30 dark:border-blue-900/50",
    label: "Info",
  },
};

export function PlanCheckPanel({ slug }: PlanCheckPanelProps) {
  const [result, setResult] = useState<PlanCheckResult | null>(null);
  const [openGroups, setOpenGroups] = useState<
    Record<PlanCheckFinding["severity"], boolean>
  >({ CRITICAL: true, WARNING: true, INFO: false });
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await runPlanCheck(slug);
      setResult(res);
    });
  }

  const grouped: Record<PlanCheckFinding["severity"], PlanCheckFinding[]> = {
    CRITICAL: [],
    WARNING: [],
    INFO: [],
  };
  for (const f of result?.findings ?? []) grouped[f.severity].push(f);

  return (
    <Card className="sticky top-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">🔍 Plan check</CardTitle>
          <Button
            type="button"
            size="sm"
            variant={result ? "outline" : "default"}
            onClick={run}
            disabled={isPending}
          >
            {isPending ? "Checking…" : result ? "Refresh" : "Run"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!result && !isPending && (
          <p className="text-muted-foreground text-xs">
            Run the deterministic checker to surface unresolved cross-refs,
            contraindications, and evidence-tier flags. Does not modify the
            plan.
          </p>
        )}

        {result && !result.ok && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-900 dark:text-red-200">
            {result.error ?? "Unknown error"}
          </div>
        )}

        {result?.ok && result.findings && result.findings.length === 0 && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
            0 findings — clean.
          </div>
        )}

        {result?.ok && result.findings && result.findings.length > 0 && (
          <div className="space-y-2">
            {SEVERITY_ORDER.map((sev) => {
              const items = grouped[sev];
              if (items.length === 0) return null;
              const styles = SEVERITY_STYLES[sev];
              const isOpen = openGroups[sev];
              return (
                <div
                  key={sev}
                  className={`rounded-md border ${styles.group}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((g) => ({ ...g, [sev]: !g[sev] }))
                    }
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${styles.badge}`}
                      >
                        {styles.label}
                      </Badge>
                      <span className="text-xs font-medium">
                        {items.length}{" "}
                        {items.length === 1 ? "finding" : "findings"}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="px-3 pb-2 space-y-1.5">
                      {items.map((f, i) => (
                        <li
                          key={`${f.ack_id}-${i}`}
                          className="text-xs leading-snug border-t pt-1.5 first:border-t-0 first:pt-0"
                        >
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {f.section}.{f.field}
                            {f.target && (
                              <span className="ml-1">— {f.target}</span>
                            )}
                          </div>
                          <div>{f.detail}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
