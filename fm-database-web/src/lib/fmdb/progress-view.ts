/**
 * Your progress, as the coach releases it (scorecard F4; coach's decision
 * 21 Nov 2026).
 *
 * Nothing about progress reaches the client until the coach presses "Share
 * progress" (client.yaml#progress_shared_on). Each release is a dated
 * snapshot: wellbeing up to the week of the release and readings up to its
 * date, so a bad week after it never shows without the coach's framing. The
 * next look comes when she shares again, usually at the next review.
 *
 * Pure: shared by the client's sheet (sq-progress.tsx) and the coach's
 * preview (app-preview.ts), so the two can never disagree.
 */

import type { ClientAppData } from "./client-app";

type Point = { x: string; v: number };

export interface Trend {
  first: Point;
  last: Point;
  delta: number;
}

export interface AppProgressShare {
  /** the snapshot date, YYYY-MM-DD */
  on: string;
  /** the plan week on that date: wellbeing points after it are left out */
  week: number;
  /** the coach's own line, shown first; "" when she wrote none */
  note: string;
  /** the coach's switch: no weight anywhere in the progress view */
  hideWeight: boolean;
}

type ProgressInput = Pick<ClientAppData, "symptomScore" | "body" | "weightLoss">;

function trendOf(points: Point[]): Trend | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  return { first, last, delta: Math.round((last.v - first.v) * 10) / 10 };
}

export const shortDate = (ymd: string): string => {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The coach's release, read from client.yaml, or null when progress has not
 * been shared. `currentWeek` and `todayYmd` place the snapshot in the plan:
 * the week it was shared in is the current week less the whole weeks since.
 */
export function releasedProgress(client: Record<string, unknown>, currentWeek: number, todayYmd: string): AppProgressShare | null {
  const on = typeof client.progress_shared_on === "string" ? client.progress_shared_on.trim().slice(0, 10) : "";
  if (!YMD.test(on)) return null;
  const days = Math.floor((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000);
  const week = Math.max(1, currentWeek - (Number.isFinite(days) && days > 0 ? Math.floor(days / 7) : 0));
  return {
    on,
    week,
    note: typeof client.progress_shared_note === "string" ? client.progress_shared_note.trim() : "",
    hideWeight: client.progress_hide_weight === true,
  };
}

/** The data cut to the snapshot: nothing after the release, and no weight
 *  when the coach has switched it off. */
export function progressAsOf<T extends ProgressInput>(data: T, share: Pick<AppProgressShare, "on" | "week" | "hideWeight">): T {
  const pts = (data.symptomScore?.points ?? []).filter((p) => p.wk <= share.week);
  const symptomScore = data.symptomScore && pts.length >= 2 ? { ...data.symptomScore, points: pts } : null;
  const history = (data.body?.history ?? [])
    .filter((h) => h.date.slice(0, 10) <= share.on)
    .map((h) => (share.hideWeight ? { ...h, weightKg: null } : h))
    .filter((h) => h.weightKg != null || h.bpSystolic != null || h.waistCm != null || h.hipCm != null || h.moodScore != null);
  return {
    ...data,
    symptomScore,
    body: data.body ? { ...data.body, history } : data.body,
    weightLoss: share.hideWeight ? null : data.weightLoss,
  };
}

export function progressTrends(data: Pick<ClientAppData, "symptomScore" | "body">) {
  const hist = data.body?.history ?? [];
  const wellbeing = trendOf((data.symptomScore?.points ?? []).map((p) => ({ x: `Week ${p.wk}`, v: p.v })));
  const weight = trendOf(hist.filter((h) => h.weightKg != null).map((h) => ({ x: h.date, v: h.weightKg as number })));
  const bpRows = hist.filter((h) => h.bpSystolic != null && h.bpDiastolic != null);
  const systolic = trendOf(bpRows.map((h) => ({ x: h.date, v: h.bpSystolic as number })));
  const bp =
    bpRows.length >= 1
      ? {
          first: bpRows[0],
          last: bpRows[bpRows.length - 1],
          count: bpRows.length,
          systolic,
        }
      : null;
  return { wellbeing, weight, bp, weightPoints: hist.filter((h) => h.weightKg != null).length };
}

/** The good news, in plain words, or [] when there is none yet. Weight counts
 *  as good news only for a client with a weight goal; BP only when it started
 *  at or above 130 and came down. */
export function progressHeadline(data: ProgressInput): string[] {
  const t = progressTrends(data);
  const out: string[] = [];
  if (t.wellbeing && t.wellbeing.delta > 0) out.push(`You feel better: wellbeing up ${t.wellbeing.delta} points since you started.`);
  if (t.weight && data.weightLoss && t.weight.delta < 0) out.push(`Down ${Math.abs(t.weight.delta)} kg since ${shortDate(t.weight.first.x)}.`);
  const s = t.bp?.systolic;
  if (s && s.first.v >= 130 && s.delta <= -5) out.push(`Blood pressure lower than at the start: ${t.bp!.last.bpSystolic}/${t.bp!.last.bpDiastolic} now.`);
  return out;
}

/** What the client would see if the coach shared today, as plain lines for
 *  the coach's preview. Good news first, then each reading's first and now. */
export function progressDraftLines(data: ProgressInput): string[] {
  const t = progressTrends(data);
  const out = [...progressHeadline(data)];
  if (t.wellbeing) {
    // Two check-ins can carry the same week (both before the plan began, say):
    // then the weeks say nothing, so count the check-ins instead.
    const n = data.symptomScore?.points.length ?? 0;
    const span = t.wellbeing.first.x === t.wellbeing.last.x ? `from ${n} check-ins` : `${t.wellbeing.first.x} to ${t.wellbeing.last.x}`;
    out.push(`Wellbeing ${t.wellbeing.first.v} → ${t.wellbeing.last.v} / 100 (${span}).`);
  }
  else out.push("Wellbeing: not enough weekly check-ins yet (needs two).");
  if (t.weight) out.push(`Weight ${t.weight.first.v} → ${t.weight.last.v} kg (${shortDate(t.weight.first.x)} to ${shortDate(t.weight.last.x)}).`);
  if (t.bp) {
    const { first, last, count } = t.bp;
    out.push(
      count > 1
        ? `Blood pressure ${first.bpSystolic}/${first.bpDiastolic} → ${last.bpSystolic}/${last.bpDiastolic} (${shortDate(first.date)} to ${shortDate(last.date)}).`
        : `Blood pressure ${last.bpSystolic}/${last.bpDiastolic} on ${shortDate(last.date)} (one reading).`,
    );
  }
  return out;
}
