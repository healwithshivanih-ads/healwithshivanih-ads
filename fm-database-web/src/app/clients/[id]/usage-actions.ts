"use server";

import path from "node:path";
import fs from "node:fs/promises";
import { getPlansRoot } from "@/lib/fmdb/paths";

export interface ApiUsageEntry {
  ts: string;
  script: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  cost_inr: number;
  notes?: string;
}

export interface ApiUsageSummary {
  ok: boolean;
  total_calls: number;
  total_cost_usd: number;
  total_cost_inr: number;
  total_input_tokens: number;
  total_output_tokens: number;
  this_month_cost_usd: number;
  this_month_cost_inr: number;
  this_month_calls: number;
  by_script: { script: string; calls: number; cost_usd: number; cost_inr: number }[];
  by_model: { model: string; calls: number; cost_usd: number; cost_inr: number }[];
  recent: ApiUsageEntry[];        // last 20
  first_call_at: string | null;
  last_call_at: string | null;
  error?: string;
}

/** Read the per-client _api_usage.jsonl file and aggregate.
 *  Returns zeros (ok: true, total_calls: 0) when the file doesn't exist
 *  yet — that's the expected state for a client with no AI calls. */
export async function loadApiUsageForClient(clientId: string): Promise<ApiUsageSummary> {
  const emptySummary: ApiUsageSummary = {
    ok: true,
    total_calls: 0,
    total_cost_usd: 0,
    total_cost_inr: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    this_month_cost_usd: 0,
    this_month_cost_inr: 0,
    this_month_calls: 0,
    by_script: [],
    by_model: [],
    recent: [],
    first_call_at: null,
    last_call_at: null,
  };

  if (!clientId) return emptySummary;

  const filePath = path.join(getPlansRoot(), "clients", clientId, "_api_usage.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return emptySummary;  // no file = no calls yet
  }

  const entries: ApiUsageEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as Partial<ApiUsageEntry>;
      entries.push({
        ts: e.ts ?? "",
        script: e.script ?? "",
        model: e.model ?? "",
        input_tokens: Number(e.input_tokens ?? 0),
        output_tokens: Number(e.output_tokens ?? 0),
        cache_read_input_tokens: Number(e.cache_read_input_tokens ?? 0),
        cache_creation_input_tokens: Number(e.cache_creation_input_tokens ?? 0),
        cost_usd: Number(e.cost_usd ?? 0),
        cost_inr: Number(e.cost_inr ?? 0),
        notes: e.notes,
      });
    } catch {
      // Skip malformed lines silently — best-effort parsing.
    }
  }

  if (entries.length === 0) return emptySummary;

  // Aggregations
  const byScript = new Map<string, { calls: number; cost_usd: number; cost_inr: number }>();
  const byModel = new Map<string, { calls: number; cost_usd: number; cost_inr: number }>();
  let totalUsd = 0;
  let totalInr = 0;
  let totalIn = 0;
  let totalOut = 0;
  let monthUsd = 0;
  let monthInr = 0;
  let monthCalls = 0;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();

  for (const e of entries) {
    totalUsd += e.cost_usd;
    totalInr += e.cost_inr;
    totalIn += e.input_tokens;
    totalOut += e.output_tokens;
    const s = byScript.get(e.script) ?? { calls: 0, cost_usd: 0, cost_inr: 0 };
    s.calls += 1; s.cost_usd += e.cost_usd; s.cost_inr += e.cost_inr;
    byScript.set(e.script, s);
    const m = byModel.get(e.model) ?? { calls: 0, cost_usd: 0, cost_inr: 0 };
    m.calls += 1; m.cost_usd += e.cost_usd; m.cost_inr += e.cost_inr;
    byModel.set(e.model, m);
    if (e.ts >= monthStartIso) {
      monthUsd += e.cost_usd;
      monthInr += e.cost_inr;
      monthCalls += 1;
    }
  }

  const recent = [...entries].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 20);
  const sortedTs = [...entries].map((e) => e.ts).sort();

  return {
    ok: true,
    total_calls: entries.length,
    total_cost_usd: Math.round(totalUsd * 10000) / 10000,
    total_cost_inr: Math.round(totalInr * 100) / 100,
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
    this_month_cost_usd: Math.round(monthUsd * 10000) / 10000,
    this_month_cost_inr: Math.round(monthInr * 100) / 100,
    this_month_calls: monthCalls,
    by_script: [...byScript.entries()]
      .map(([script, v]) => ({ script, ...v, cost_usd: Math.round(v.cost_usd * 10000) / 10000, cost_inr: Math.round(v.cost_inr * 100) / 100 }))
      .sort((a, b) => b.cost_inr - a.cost_inr),
    by_model: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v, cost_usd: Math.round(v.cost_usd * 10000) / 10000, cost_inr: Math.round(v.cost_inr * 100) / 100 }))
      .sort((a, b) => b.cost_inr - a.cost_inr),
    recent,
    first_call_at: sortedTs[0] ?? null,
    last_call_at: sortedTs[sortedTs.length - 1] ?? null,
  };
}
