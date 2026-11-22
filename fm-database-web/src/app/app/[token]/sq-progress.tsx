"use client";

/**
 * Your progress (scorecard F4), in the new front. Headline first, the rest a
 * tap away. What improved leads; nothing here chases (no streaks, no nudges).
 *
 * The coach releases it (progress-view.ts): until she shares, the sheet says
 * the first look comes at a review and keeps only the test dates, the journey
 * and the way to save a reading. Once shared it is a dated snapshot with her
 * line on top, cut to the day she shared it, so a bad week after it never
 * shows without her.
 *
 * - Wellbeing: data.symptomScore, built only from real weekly check-ins.
 * - Weight and blood pressure: data.body.history, which is the union of all
 *   three weight stores (collectMeasurementSnapshots: the coach's log, the
 *   app's own readings and the intake), so a coach edit shows here too.
 *   Weight is left out when the coach has switched it off for this client.
 * - Tests: dates only. Numbers live on Your results, which carries the
 *   released-results switch and the plain Above / Below tags.
 */

import type { ClientAppData, JourneyItem } from "@/lib/fmdb/client-app";
import { progressAsOf, progressHeadline, progressTrends, shortDate } from "@/lib/fmdb/progress-view";
import { SqCard, SqNavRow, type SqSheet } from "./sq-ui";

type Checkpoint = ClientAppData["labCheckpoints"]["list"][number];

/** Test dates only. The baseline row carries lab numbers with no range tag in
 *  the payload, so it reads "On file"; a plan whose retest falls in the
 *  full-panel week gets one row, not two with the same week. */
export function progressCheckpoints(list: Checkpoint[]): Checkpoint[] {
  const out: Checkpoint[] = [];
  for (const c of list) {
    const row = { ...c, value: c.sub === "Baseline" ? "On file" : /full review/i.test(c.value) ? "Full review with your coach" : c.value };
    const prev = out[out.length - 1];
    if (prev && prev.label === row.label) {
      out[out.length - 1] = { ...row, sub: "Retest and full panel", value: "Full review with your coach" };
    } else out.push(row);
  }
  return out;
}

/** Newest first by real date; a check-in from an earlier plan sits below that
 *  plan's later events, not above "Your plan began". */
export function journeyByDate(items: JourneyItem[]): JourneyItem[] {
  return items
    .map((j, i) => ({ j, i }))
    .sort((a, b) => (b.j.date ?? "").localeCompare(a.j.date ?? "") || a.i - b.i)
    .map((x) => x.j);
}

function Spark({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const W = 300, H = 70, pad = 8;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [pad + (i / (points.length - 1)) * (W - 2 * pad), pad + (1 - (v - min) / span) * (H - 2 * pad)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className="sq-prog-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--sq-growth)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="4" fill="var(--sq-growth)" />
    </svg>
  );
}

function JourneyRow({ item }: { item: JourneyItem }) {
  const more = item.summary || item.note?.text;
  const head = (
    <span className="sq-li-body">
      <b>{item.title}</b>
      <small>{item.week > 0 ? `Week ${item.week} · ${item.when}` : item.when}</small>
    </span>
  );
  if (!more) return <div className="sq-li sq-li-static">{head}</div>;
  return (
    <details className="sq-prog-j">
      <summary className="sq-li">{head}</summary>
      {item.summary && <p className="sq-sub">{item.summary}</p>}
      {item.note?.text && (
        <p className="sq-sub">
          <b>Your coach:</b> {item.note.text}
        </p>
      )}
    </details>
  );
}

export function SqProgressSheet({ data, open }: { data: ClientAppData; open: (s: SqSheet) => void }) {
  const { week, totalWeeks } = data.client;
  const share = data.sq?.progress ?? null;
  const v = share ? progressAsOf(data, share) : null;
  const t = v ? progressTrends(v) : null;
  const good = v ? progressHeadline(v) : [];
  const hist = v?.body?.history ?? [];
  const checkpoints = progressCheckpoints(data.labCheckpoints?.list ?? []);
  const journey = journeyByDate(data.journey ?? []);
  const saveReading = (
    <div className="sq-row-btns">
      <button type="button" className="sq-btn sq-btn-quiet sq-btn-small" onClick={() => open({ k: "vitals" })}>
        Save a reading
      </button>
    </div>
  );

  return (
    <>
      {share && v && t ? (
        <>
          <SqCard>
            <p className="sq-big-num">
              Week {share.week} <span className="sq-sub">of {totalWeeks}</span>
            </p>
            <p className="sq-sub sq-small">As of {shortDate(share.on)}</p>
            {share.note && (
              <p className="sq-sub">
                <b>Your coach:</b> {share.note}
              </p>
            )}
            {good.length > 0 && (
              <ul className="sq-prog-good">
                {good.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
          </SqCard>

          <SqCard title="How you feel">
            {v.symptomScore && t.wellbeing ? (
              <>
                <p className="sq-sub">
                  Wellbeing <b>{t.wellbeing.last.v}</b> / 100,{" "}
                  {t.wellbeing.delta > 0 ? `up ${t.wellbeing.delta} since your first check-in` : t.wellbeing.delta < 0 ? "lower than at your first check-in" : "the same as at your first check-in"}
                </p>
                <Spark points={v.symptomScore.points.map((p) => p.v)} label={`Wellbeing by week, now ${t.wellbeing.last.v} out of 100`} />
                <p className="sq-sub sq-small">From your weekly check-ins.</p>
              </>
            ) : (
              <p className="sq-sub">Your line starts after your second weekly check-in.</p>
            )}
          </SqCard>

          <SqCard title={share.hideWeight ? "Blood pressure" : "Weight and blood pressure"}>
            {t.weight ? (
              <>
                <p className="sq-sub">
                  Weight <b>{t.weight.last.v} kg</b> on {shortDate(t.weight.last.x)}
                  {` (${t.weight.delta > 0 ? "+" : ""}${t.weight.delta} kg since ${shortDate(t.weight.first.x)})`}
                </p>
                <Spark points={hist.filter((h) => h.weightKg != null).map((h) => h.weightKg as number)} label="Weight over time" />
              </>
            ) : t.weightPoints === 1 ? (
              <p className="sq-sub">One weight saved so far. The line starts with the next one.</p>
            ) : null}
            {t.bp && (
              <p className="sq-sub">
                Blood pressure <b>{t.bp.last.bpSystolic}/{t.bp.last.bpDiastolic}</b> on {shortDate(t.bp.last.date)}
                {t.bp.count > 1 ? ` (first saved: ${t.bp.first.bpSystolic}/${t.bp.first.bpDiastolic} on ${shortDate(t.bp.first.date)})` : ""}
              </p>
            )}
            {!t.weightPoints && !t.bp && <p className="sq-sub">No readings saved before {shortDate(share.on)}.</p>}
            <p className="sq-sub sq-small">Readings saved up to {shortDate(share.on)}.</p>
            {saveReading}
          </SqCard>
        </>
      ) : (
        <>
          <SqCard>
            <p className="sq-big-num">
              Week {week} <span className="sq-sub">of {totalWeeks}</span>
            </p>
            <p className="sq-sub">
              Your coach goes through your progress with you at a review, and it appears here then. Every check-in and reading you save counts
              towards it.
            </p>
          </SqCard>
          <SqCard title="Your readings">
            <p className="sq-sub">Save your weight or blood pressure whenever you take them.</p>
            {saveReading}
          </SqCard>
        </>
      )}

      <SqCard title="Tests">
        {checkpoints.length > 0 && (
          <div className="sq-list">
            {checkpoints.map((c) => (
              <div key={c.label} className="sq-li sq-li-static">
                <span className="sq-li-body">
                  <b>
                    {c.label} · {c.sub}
                  </b>
                  <small>{c.value}</small>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="sq-list">
          <SqNavRow title="Your results" note="Numbers your coach has gone through with you" onOpen={() => open({ k: "results" })} />
        </div>
      </SqCard>

      {journey.length > 0 && (
        <SqCard title="Your journey">
          <div className="sq-list">
            {journey.map((j, i) => (
              <JourneyRow key={`${j.kind}:${j.week}:${i}`} item={j} />
            ))}
          </div>
        </SqCard>
      )}
    </>
  );
}
