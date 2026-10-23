"use server";

/**
 * Coach-side food diary actions (docs/FOOD_DIARY_PLAN.md) — start, extend,
 * end, mark reviewed, correct a photo, and load the review grid.
 *
 * COACH-INITIATED ONLY. Starting a diary writes `food_diary` on client.yaml
 * and hands back a WhatsApp line for the coach to send herself. Nothing here
 * sends anything: no push, no WhatsApp, no email, when a diary starts, runs
 * or ends (decision 2026-10-23 — the coach does not auto-chase clients).
 * food-diary.test.ts asserts this file imports no send path.
 *
 * Runs on the Mac (the coach UI). The Fly copy learns about a diary through
 * the staging allowlist (`food_diary` in _APP_CLIENT_KEYS).
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import { clientDir } from "@/lib/fmdb/client-thread";
import { clientAppUrl } from "@/lib/fmdb/coach-mobile";
import {
  DIARY_DEFAULT_DAYS,
  DIARY_LABEL_MAX,
  DIARY_MAX_DAYS,
  DIARY_MIN_DAYS,
  diaryDisplay,
  diaryFinishedOn,
  diaryGrid,
  diaryLastDay,
  diaryPhase,
  isYmd,
  newDiaryId,
  parseDiaryConfig,
  type DiaryPhase,
  type FoodDiaryConfig,
} from "@/lib/fmdb/food-diary";
import {
  appendDiaryLine,
  diaryToday,
  loadDiary,
  publishedPlanFor,
  readDiarySummary,
  type StoredDiarySummary,
} from "@/lib/fmdb/food-diary-store";
import { diaryGentle } from "@/lib/fmdb/food-diary-balance";
import { diaryEstimate, type DiaryEstimate } from "@/lib/fmdb/food-diary-estimate";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
type Fail = { ok: false; error: string };

function clientFile(clientId: string): string | null {
  if (!SAFE_ID.test(clientId)) return null;
  const dir = clientDir(clientId);
  return dir ? path.join(dir, "client.yaml") : null;
}

function readClient(clientId: string): { file: string; doc: Record<string, unknown> } | null {
  const file = clientFile(clientId);
  if (!file) return null;
  try {
    return { file, doc: (yaml.load(fs.readFileSync(file, "utf8")) ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

function writeClient(file: string, doc: Record<string, unknown>) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, dumpYaml(doc, { noRefs: true, sortKeys: false }), "utf8");
  fs.renameSync(tmp, file);
}


/** Store only what the model knows, dropping empty optionals. */
function toYaml(cfg: FoodDiaryConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { id: cfg.id, start: cfg.start, days: cfg.days, status: cfg.status };
  if (cfg.focus) out.focus = cfg.focus;
  if (cfg.started_at) out.started_at = cfg.started_at;
  if (cfg.ended_at) out.ended_at = cfg.ended_at;
  if (cfg.reviewed_at) out.reviewed_at = cfg.reviewed_at;
  if (typeof cfg.show_balance === "boolean") out.show_balance = cfg.show_balance;
  if (typeof cfg.show_grams === "boolean") out.show_grams = cfg.show_grams;
  return out;
}

function revalidate(clientId: string) {
  revalidatePath(`/clients-v2/${clientId}/analyse`);
  revalidatePath("/dashboard-v2");
}

function weekdayName(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
}

/** The line the coach sends herself. Second person, one ask, where to tap.
 *  Rebuilt on every load so the panel can show it again after a reload. */
function sendLine(firstName: string, cfg: FoodDiaryConfig, today: string, appUrl: string | null): string {
  const days = cfg.days === 1 ? "today" : `for the next ${cfg.days} days`;
  const when =
    cfg.start > today
      ? `From ${weekdayName(cfg.start)}, ${cfg.days === 1 ? "for one day" : `for ${cfg.days} days`}`
      : days.charAt(0).toUpperCase() + days.slice(1);
  const hi = firstName ? `Hi ${firstName}! ` : "";
  return (
    `${hi}${when}, could you snap everything you eat and drink in the app? ` +
    `Just tap "Add what you're eating" at the top of Today — no need to weigh or count anything.` +
    (appUrl ? `\n${appUrl}` : "")
  );
}

export interface DiaryPanelData {
  ok: true;
  config: FoodDiaryConfig | null;
  phase: DiaryPhase | null;
  today: string;
  lastDay: string | null;
  grid: ReturnType<typeof diaryGrid>;
  daysDone: string[];
  total: number;
  /** null when the client has no app link yet — a diary cannot start then. */
  appUrl: string | null;
  mobile: string | null;
  message: string | null;
  /** Coach-only estimate from the AI readings + her corrections. */
  estimate: DiaryEstimate | null;
  /** The summary session on the record, once the diary has finished. */
  summary: StoredDiarySummary | null;
  /** Anxious / benzo-SSRI / eating-disorder signals on the record. */
  gentle: boolean;
  /** What the client card shows, after the gentle rule. */
  display: { balance: boolean; grams: boolean };
}

export async function loadFoodDiaryAction(clientId: string): Promise<DiaryPanelData | Fail> {
  const c = readClient(clientId);
  if (!c) return { ok: false, error: "client not found" };
  const today = diaryToday(c.doc);
  const cfg = parseDiaryConfig(c.doc.food_diary);
  const appUrl = clientAppUrl(typeof c.doc.app_token === "string" ? c.doc.app_token : null);
  const first = String(c.doc.display_name ?? "").split(" ")[0];
  const folded = cfg ? loadDiary(clientId, cfg) : null;
  const gentle = diaryGentle(c.doc);
  return {
    ok: true,
    config: cfg,
    phase: cfg ? diaryPhase(cfg, today) : null,
    today,
    // The day it really finished — earlier than planned if she ended it.
    lastDay: cfg ? (cfg.status === "ended" ? diaryFinishedOn(cfg) : diaryLastDay(cfg)) : null,
    grid: cfg && folded ? diaryGrid(cfg, folded.entries) : [],
    daysDone: folded ? [...folded.daysDone].sort() : [],
    total: folded?.entries.length ?? 0,
    appUrl,
    mobile: typeof c.doc.mobile_number === "string" ? c.doc.mobile_number : c.doc.mobile_number ? String(c.doc.mobile_number) : null,
    message: cfg ? sendLine(first, cfg, today, appUrl) : null,
    estimate: cfg && folded ? diaryEstimate(cfg, folded.entries, c.doc, publishedPlanFor(clientId)) : null,
    summary: cfg ? readDiarySummary(clientId, cfg.id) : null,
    gentle,
    display: cfg ? diaryDisplay(cfg, gentle) : { balance: !gentle, grams: false },
  };
}

export async function startFoodDiaryAction(
  clientId: string,
  input: { start?: string; days?: number; focus?: string },
): Promise<{ ok: true; message: string } | Fail> {
  const c = readClient(clientId);
  if (!c) return { ok: false, error: "client not found" };
  if (!c.doc.app_token) return { ok: false, error: "This client has no app link yet — send the app first." };
  const today = diaryToday(c.doc);
  const existing = parseDiaryConfig(c.doc.food_diary);
  if (existing && diaryPhase(existing, today) !== "finished") {
    return { ok: false, error: "A diary is already open — end it before starting another." };
  }
  const start = input.start && isYmd(input.start) ? input.start : today;
  if (start < today) return { ok: false, error: "Start today or later." };
  const days = Math.round(Number(input.days ?? DIARY_DEFAULT_DAYS));
  if (!Number.isFinite(days) || days < DIARY_MIN_DAYS || days > DIARY_MAX_DAYS) {
    return { ok: false, error: `Pick ${DIARY_MIN_DAYS}–${DIARY_MAX_DAYS} days.` };
  }
  const cfg: FoodDiaryConfig = {
    id: newDiaryId(start, randomBytes(4).toString("hex")),
    start,
    days,
    status: "active",
    started_at: new Date().toISOString(),
    ...(input.focus?.trim() ? { focus: input.focus.trim().slice(0, 200) } : {}),
  };
  c.doc.food_diary = toYaml(cfg);
  writeClient(c.file, c.doc);
  revalidate(clientId);
  const first = String(c.doc.display_name ?? "").split(" ")[0];
  return {
    ok: true,
    message: sendLine(first, cfg, today, clientAppUrl(String(c.doc.app_token))),
  };
}

async function patchDiary(
  clientId: string,
  fn: (cfg: FoodDiaryConfig, today: string) => FoodDiaryConfig | string,
): Promise<{ ok: true } | Fail> {
  const c = readClient(clientId);
  if (!c) return { ok: false, error: "client not found" };
  const cfg = parseDiaryConfig(c.doc.food_diary);
  if (!cfg) return { ok: false, error: "No diary on this client." };
  const next = fn(cfg, diaryToday(c.doc));
  if (typeof next === "string") return { ok: false, error: next };
  c.doc.food_diary = toYaml(next);
  writeClient(c.file, c.doc);
  revalidate(clientId);
  return { ok: true };
}

/** One more day. Also re-opens a diary that ran out yesterday, if the client
 *  missed a day — but never one the coach ended by hand. */
export async function extendFoodDiaryAction(clientId: string): Promise<{ ok: true } | Fail> {
  return patchDiary(clientId, (cfg) => {
    if (cfg.status === "ended") return "This diary was ended — start a new one instead.";
    if (cfg.days >= DIARY_MAX_DAYS) return `A diary runs at most ${DIARY_MAX_DAYS} days.`;
    const next = { ...cfg, days: cfg.days + 1 };
    delete next.reviewed_at;
    return next;
  });
}

export async function endFoodDiaryAction(clientId: string): Promise<{ ok: true } | Fail> {
  return patchDiary(clientId, (cfg) =>
    cfg.status === "ended" ? "Already ended." : { ...cfg, status: "ended", ended_at: new Date().toISOString() },
  );
}

/**
 * What the client card shows (§5b). `null` puts a switch back to its default
 * (balance on unless gentle; grams off). Grams cannot be switched on for a
 * gentle client — the card would never show them anyway (diaryDisplay), and
 * refusing here keeps the record honest.
 */
export async function setDiaryDisplayAction(
  clientId: string,
  patch: { show_balance?: boolean | null; show_grams?: boolean | null },
): Promise<{ ok: true } | Fail> {
  const c = readClient(clientId);
  if (!c) return { ok: false, error: "client not found" };
  if (patch.show_grams === true && diaryGentle(c.doc)) {
    return { ok: false, error: "Grams stay off for this client (anxiety / SSRI-benzo / eating-disorder signal on the record)." };
  }
  return patchDiary(clientId, (cfg) => {
    const next = { ...cfg };
    if (patch.show_balance === null) delete next.show_balance;
    else if (typeof patch.show_balance === "boolean") next.show_balance = patch.show_balance;
    if (patch.show_grams === null) delete next.show_grams;
    else if (typeof patch.show_grams === "boolean") next.show_grams = patch.show_grams;
    return next;
  });
}

/** Clears the inbox item. */
export async function markFoodDiaryReviewedAction(clientId: string): Promise<{ ok: true } | Fail> {
  return patchDiary(clientId, (cfg, today) =>
    diaryPhase(cfg, today) !== "finished" ? "The diary is still running." : { ...cfg, reviewed_at: new Date().toISOString() },
  );
}

/**
 * The coach's correction of what a photo is. Optional — she is not the
 * interpreter (phase 2 reads every photo automatically); this is only for
 * when she wants to put something right. An empty label clears hers.
 */
export async function labelDiaryEntryAction(
  clientId: string,
  entryId: string,
  label: string,
): Promise<{ ok: true } | Fail> {
  const c = readClient(clientId);
  if (!c) return { ok: false, error: "client not found" };
  const cfg = parseDiaryConfig(c.doc.food_diary);
  if (!cfg) return { ok: false, error: "No diary on this client." };
  if (!loadDiary(clientId, cfg).entries.some((e) => e.entry_id === entryId)) {
    return { ok: false, error: "That photo isn't in this diary." };
  }
  appendDiaryLine(clientId, {
    op: "label",
    diary_id: cfg.id,
    ts: new Date().toISOString(),
    entry_id: entryId,
    label: label.trim().slice(0, DIARY_LABEL_MAX),
  });
  revalidate(clientId);
  return { ok: true };
}

