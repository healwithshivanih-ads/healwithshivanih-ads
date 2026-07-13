"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadApiUsageForClient, type ApiUsageSummary } from "@/lib/server-actions/usage";

/** Per-client AI API spend tracker.
 *  Reads ~/fm-plans/clients/<id>/_api_usage.jsonl and shows totals +
 *  breakdown. Hides itself entirely when the client has zero recorded
 *  calls — keeps the Overview tab uncluttered for new clients. */
export function ApiUsagePanel({ clientId }: { clientId: string }) {
  const [summary, setSummary] = useState<ApiUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage?.getItem("fmcoach_apiusage_open") === "1";
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("fmcoach_apiusage_open", next ? "1" : "0");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadApiUsageForClient(clientId).then((r) => {
      if (!cancelled) {
        setSummary(r);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) return null;
  if (!summary || !summary.ok || summary.total_calls === 0) return null;

  const inr = (n: number) => `₹${n.toFixed(n < 10 ? 2 : 1)}`;
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const scriptLabel: Record<string, string> = {
    "assess.py":                      "🧠 Assess (Sonnet)",
    "chat.py":                        "💬 Assess chat",
    "render-client-letter.py":        "📝 App menu / plan render",
    "render-client-letter.py:validator": "✅ Menu QA (Haiku)",
    "refine-letter.py":               "✏️ Content refinement",
    "extract-symptoms.py":            "📞 Transcript / lab extract",
    "parse-functional-test.py":       "🧪 Functional test parser",
    "parse-genetic-report.py":        "🧬 Genetic report parser",
    "parse-health-text.py":           "🩺 Health text parse",
    "extract-client-from-transcript.py": "👤 Intake transcript",
    "draft-followup-message.py":      "💌 Follow-up drafts",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center justify-between gap-2 text-left hover:text-foreground/80"
          aria-expanded={open}
        >
          <CardTitle className="text-sm">
            <span className="mr-1.5">💰</span>
            AI API spend
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              {summary.total_calls} call{summary.total_calls === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold text-foreground">{inr(summary.total_cost_inr)}</span>{" "}
              <span className="text-[10px]">({usd(summary.total_cost_usd)})</span>
            </span>
          </CardTitle>
          <span className="text-xs text-muted-foreground select-none">{open ? "▾" : "▸"}</span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4 text-sm">
          {/* Totals row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">All-time</div>
              <div className="text-base font-bold tabular-nums">{inr(summary.total_cost_inr)}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">{usd(summary.total_cost_usd)} · {summary.total_calls} calls</div>
            </div>
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">This month</div>
              <div className="text-base font-bold tabular-nums">{inr(summary.this_month_cost_inr)}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">{usd(summary.this_month_cost_usd)} · {summary.this_month_calls} calls</div>
            </div>
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Input tokens</div>
              <div className="text-base font-bold tabular-nums">{summary.total_input_tokens.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">cumulative</div>
            </div>
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Output tokens</div>
              <div className="text-base font-bold tabular-nums">{summary.total_output_tokens.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">cumulative</div>
            </div>
          </div>

          {/* By script */}
          {summary.by_script.length > 0 && (
            <div className="rounded-md border">
              <div className="px-3 py-1.5 border-b bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Spend by feature
              </div>
              <div className="divide-y">
                {summary.by_script.map((s) => (
                  <div key={s.script} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                    <span className="flex-1 truncate">{scriptLabel[s.script] ?? s.script}</span>
                    <span className="text-muted-foreground tabular-nums">{s.calls}×</span>
                    <span className="font-semibold tabular-nums w-16 text-right">{inr(s.cost_inr)}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums w-14 text-right">{usd(s.cost_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By model */}
          {summary.by_model.length > 1 && (
            <div className="rounded-md border">
              <div className="px-3 py-1.5 border-b bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Spend by model
              </div>
              <div className="divide-y">
                {summary.by_model.map((m) => (
                  <div key={m.model} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                    <code className="flex-1 font-mono text-[11px] truncate">{m.model || "(unknown)"}</code>
                    <span className="text-muted-foreground tabular-nums">{m.calls}×</span>
                    <span className="font-semibold tabular-nums w-16 text-right">{inr(m.cost_inr)}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums w-14 text-right">{usd(m.cost_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent calls — collapsed by default */}
          <details className="rounded-md border">
            <summary className="cursor-pointer list-none px-3 py-1.5 bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold select-none">
              ▸ Recent calls ({summary.recent.length})
            </summary>
            <div className="divide-y max-h-64 overflow-auto">
              {summary.recent.map((e, i) => (
                <div key={i} className="px-3 py-1.5 text-[11px] flex items-baseline gap-3">
                  <span className="font-mono text-muted-foreground w-32 shrink-0">
                    {new Date(e.ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="flex-1 truncate">
                    {scriptLabel[e.script] ?? e.script}
                    {e.notes && <span className="ml-1.5 text-muted-foreground">· {e.notes}</span>}
                  </span>
                  <span className="font-semibold tabular-nums w-14 text-right">{inr(e.cost_inr)}</span>
                </div>
              ))}
            </div>
          </details>

          <p className="text-[10px] text-muted-foreground">
            Spend recorded automatically on every AI call. Rates: Anthropic published pricing × FMDB_USD_TO_INR (env var, default ₹85/USD). Tracking started {summary.first_call_at ? new Date(summary.first_call_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
