/**
 * POST /api/cron/food-diary — read new diary photos, keep each finished
 * diary's summary on the record (docs/FOOD_DIARY_PLAN.md §5).
 *
 * Fired every 5 minutes by scripts/cron-runner.js, on the MAC only (the AI
 * reading goes through build_client's cost guard, which lives here; Fly never
 * calls the API for a diary). Steps:
 *
 *   1. Every diary that is running, or finished within DIARY_INBOX_DAYS, with
 *      a photo not yet read → one read-diary-photos.py run for all of them.
 *      Not authorized (FM_API_OK unset) → nothing read, photos stay queued.
 *   2. Every finished diary in that window → estimate (food-diary-estimate.ts,
 *      the deterministic engine) → the summary session, written once and
 *      rewritten only when something changed (a late read, a correction).
 *      Waits for unread photos to be read, but never more than a day.
 *
 * Sends nothing to anyone. Auth: x-cron-secret must match CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { runShim } from "@/lib/fmdb/shim";
import { currentHost } from "@/lib/fmdb/client-thread";
import { DIARY_INBOX_DAYS, diaryFinishedOn, diaryPhase, entryReadState } from "@/lib/fmdb/food-diary";
import {
  diaryToday,
  listDiaryClients,
  loadDiary,
  publishedPlanFor,
  readDiarySummary,
} from "@/lib/fmdb/food-diary-store";
import { diaryEstimate, diarySummaryPayload } from "@/lib/fmdb/food-diary-estimate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How long a finished diary waits for its photos to be read before the
 *  summary is written with what there is. */
const SUMMARY_WAIT_DAYS = 1;

const daysSince = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (currentHost() === "fly") {
    return NextResponse.json({ ok: false, error: "the diary reader runs on the Mac only" }, { status: 409 });
  }

  const errors: string[] = [];
  const eligible = listDiaryClients()
    .map((c) => ({ ...c, today: diaryToday(c.doc) }))
    .filter(({ cfg, today }) => {
      const phase = diaryPhase(cfg, today);
      if (phase === "running") return true;
      return phase === "finished" && daysSince(diaryFinishedOn(cfg), today) <= DIARY_INBOX_DAYS;
    });

  // 1. read
  const toRead = eligible
    .filter(({ clientId, cfg }) => loadDiary(clientId, cfg).entries.some((e) => !e.ai_reading))
    .map(({ clientId, cfg }) => ({ client_id: clientId, diary_id: cfg.id }));
  let reader: { read?: number; unreadable?: number; queued?: number; api_blocked?: boolean; errors?: string[] } = {};
  if (toRead.length) {
    try {
      reader = (await runShim("read-diary-photos.py", { clients: toRead }, 9 * 60_000)) as typeof reader;
      errors.push(...(reader.errors ?? []));
    } catch (e) {
      errors.push(e instanceof Error ? e.message.slice(0, 300) : "reader failed");
    }
  }

  // 2. summaries for finished diaries
  const summaries: { client: string; session_id: string; updated: boolean }[] = [];
  for (const { clientId, doc, cfg, today } of eligible) {
    if (diaryPhase(cfg, today) !== "finished") continue;
    const entries = loadDiary(clientId, cfg).entries;
    const pending = entries.filter((e) => entryReadState(e) === "pending").length;
    if (pending > 0 && daysSince(diaryFinishedOn(cfg), today) < SUMMARY_WAIT_DAYS) continue;
    const est = diaryEstimate(cfg, entries, doc, publishedPlanFor(clientId));
    const summary = diarySummaryPayload(cfg, entries, est);
    const stored = readDiarySummary(clientId, cfg.id);
    if (stored && stored.fingerprint === summary.fingerprint) continue;
    try {
      const out = (await runShim("save-food-diary-summary.py", { client_id: clientId, summary }, 30_000)) as {
        ok: boolean;
        session_id?: string;
        updated?: boolean;
        error?: string;
      };
      if (out.ok && out.session_id) summaries.push({ client: clientId, session_id: out.session_id, updated: !!out.updated });
      else errors.push(`${clientId}: ${out.error ?? "summary failed"}`);
    } catch (e) {
      errors.push(`${clientId}: ${e instanceof Error ? e.message.slice(0, 200) : "summary failed"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    diaries: eligible.length,
    read: reader.read ?? 0,
    unreadable: reader.unreadable ?? 0,
    queued: reader.queued ?? 0,
    api_blocked: !!reader.api_blocked,
    summaries,
    errors,
  });
}
