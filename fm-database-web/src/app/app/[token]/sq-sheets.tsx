"use client";

/**
 * The sheets Home opens: Your whole day, Your record (and one earlier day),
 * and a recipe. Each returns the BODY of a sheet; the shell (sq-app.tsx)
 * draws the title bar and the close button around it.
 */

import type { ClientAppData } from "@/lib/fmdb/client-app";
import {
  buildRecord,
  dayCount,
  dayLabel,
  dayRows,
  isTicked,
  mealTitle,
  mealsNotTracked,
  recordSummary,
  tickedAt,
  type SqKind,
  type SqMoment,
  type SqTicks,
} from "./sq-day";
import { SqCard, SqIcon, SqNavRow, SqTickRow, type SqSheet } from "./sq-ui";

// ── Your whole day ─────────────────────────────────────────────────────────

export function SqDaySheet({
  moments,
  ticks,
  track,
  onToggle,
  open,
}: {
  moments: SqMoment[];
  ticks: SqTicks;
  track: boolean;
  onToggle: (id: string, kind: SqKind) => void;
  open: (s: SqSheet) => void;
}) {
  const count = dayCount(moments, ticks);
  return (
    <>
      <p className="sq-sub">
        {track ? `${count.ticked} of ${count.total} ticked. ` : ""}
        Each meal and each supplement has its own tick. Tap a tick again to clear it.
      </p>
      <SqCard>
        <div className="sq-list">
          {dayRows(moments).map((r) => {
            const at = tickedAt(r.id, r.kind, ticks);
            return (
              <SqTickRow
                key={r.id}
                on={isTicked(r.id, r.kind, ticks)}
                name={r.name}
                note={[r.note, at ? `ticked ${at}` : ""].filter(Boolean).join(" · ")}
                under={r.under}
                onToggle={() => onToggle(r.id, r.kind)}
              />
            );
          })}
        </div>
      </SqCard>
      <button type="button" className="sq-btn sq-btn-quiet" onClick={() => open({ k: "record" })}>
        Earlier days
      </button>
    </>
  );
}

// ── Your record ────────────────────────────────────────────────────────────

export function SqRecordSheet({
  data,
  moments,
  ticks,
  todayYmd,
  open,
}: {
  data: ClientAppData;
  moments: SqMoment[];
  ticks: SqTicks;
  todayYmd: string;
  open: (s: SqSheet) => void;
}) {
  const count = dayCount(moments, ticks);
  const sections = buildRecord(data.sq?.tickHistory ?? [], todayYmd, `${count.ticked} of ${count.total} so far`);
  return (
    <>
      <p className="sq-sub">Everything you have ticked, kept for you and your coach.</p>
      {sections.map((sec) => (
        <SqCard key={sec.title} title={sec.title}>
          <div className="sq-list">
            {sec.days.map((d) => (
              <SqNavRow
                key={d.date}
                title={d.label}
                note={d.summary}
                onOpen={() => open(d.today ? { k: "day" } : { k: "recday", date: d.date })}
              />
            ))}
          </div>
        </SqCard>
      ))}
      <p className="sq-sub sq-small">A supplement that is not due every day is counted only on the days you tick it.</p>
    </>
  );
}

/** The title of an earlier day's sheet. */
export const recordDayTitle = (date: string) => dayLabel(date);

export function SqRecordDaySheet({ data, date }: { data: ClientAppData; date: string }) {
  const row = (data.sq?.tickHistory ?? []).find((d) => d.date === date);
  if (!row || row.items.length === 0) {
    return <section className="sq-soft">Nothing was ticked on this day.</section>;
  }
  return (
    <>
      <p className="sq-sub">{recordSummary(row.items)}</p>
      {mealsNotTracked(row.items) && <p className="sq-sub sq-small">Meals were not tracked on this day.</p>}
      <SqCard>
        <div className="sq-list">
          {row.items.map((it, i) => (
            <div key={`${it.kind}:${it.name}:${i}`} className="sq-li sq-li-static" data-on={it.done}>
              <span className="sq-tick">
                <SqIcon name="check" />
              </span>
              <span className="sq-li-body">
                <b>{it.name}</b>
                <small>{it.done ? it.at ?? "Ticked" : "Not ticked"}</small>
              </span>
            </div>
          ))}
        </div>
      </SqCard>
    </>
  );
}

// ── A recipe ───────────────────────────────────────────────────────────────

/** The title of a meal's recipe sheet. */
export function recipeTitle(data: ClientAppData, slot: string): string {
  const meal = data.meals.find((m) => m.slot === slot);
  return meal ? mealTitle(meal) : "Recipe";
}

const listOf = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function SqRecipeSheet({ data, slot }: { data: ClientAppData; slot: string }) {
  const ex = data.mealExtra[slot];
  if (!ex || (ex.recipe.length === 0 && ex.ingredients.length === 0)) {
    return <section className="sq-soft">There is no written recipe for this meal yet.</section>;
  }
  const meta = [ex.mins, ex.serves ? `serves ${ex.serves}` : ""].filter(Boolean).join(" · ");
  return (
    <>
      {ex.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- recipe photos are remote catalogue URLs, not local assets
        <img className="sq-rphoto" src={ex.imageUrl} alt="" />
      )}
      {meta && <p className="sq-sub">{meta}</p>}
      {/* A food left out of this recipe FOR THIS CLIENT (an allergy, a food she
          avoids). It must be said before the method, in the same words today's
          app uses, because the steps may still name it. */}
      {ex.omits && ex.omits.length > 0 && (
        <section className="sq-soft">
          Made without <strong>{listOf(ex.omits)}</strong> for you
          {ex.omitsInSteps ? ". Leave it out wherever the steps below mention it." : "."}
        </section>
      )}
      {ex.ingredients.length > 0 && (
        <SqCard title="You need">
          <ul className="sq-ing">
            {ex.ingredients.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </SqCard>
      )}
      {ex.recipe.length > 0 && (
        <SqCard title="Method">
          <ol className="sq-steps">
            {ex.recipe.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </SqCard>
      )}
      {/* The rest of a compound meal. The method above is the main dish only;
          each other dish is named, so nothing reads as the whole meal. */}
      {(ex.componentRecipes ?? []).map((c) => (
        <SqCard key={c.title} title={c.title}>
          {c.ingredients.length > 0 && (
            <ul className="sq-ing">
              {c.ingredients.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
          {c.method.length > 0 && (
            <ol className="sq-steps">
              {c.method.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          )}
        </SqCard>
      ))}
    </>
  );
}
