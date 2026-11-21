"use client";

/**
 * The day row on Today and what each day shows (see sq-days.ts).
 * Today keeps its own Home; any other day is a planning view: every meal
 * opens its recipe, nothing is ticked, and the day's groceries open on tap.
 */

import type { WeekMenuSlot } from "@/lib/fmdb/client-app";
import { dayGroceries, prepFor, type SqDay } from "./sq-days";
import { SqCard, SqNavRow, type SqSheet } from "./sq-ui";

export const THREE = -1;

export function SqDayRow({ days, at, pick }: { days: SqDay[]; at: number; pick: (i: number) => void }) {
  if (days.length < 2) return null;
  return (
    <div className="sq-dayrow" role="tablist" aria-label="Days">
      {days.map((d, i) => (
        <button key={i} type="button" role="tab" aria-selected={at === i} className={"sq-daychip" + (at === i ? " on" : "")} onClick={() => pick(i)}>
          {d.chip}
        </button>
      ))}
      {days.length >= 3 && (
        <button type="button" role="tab" aria-selected={at === THREE} className={"sq-daychip" + (at === THREE ? " on" : "")} onClick={() => pick(THREE)}>
          Cook for 3 days
        </button>
      )}
    </div>
  );
}

/** "For tomorrow: soak the rajma tonight" — on today, from tomorrow's dishes. */
export function SqPrepLine({ next }: { next: SqDay | undefined }) {
  const p = next ? prepFor(next) : null;
  if (!p) return null;
  return (
    <section className="sq-soft sq-prep">
      <b>For tomorrow&apos;s {p.dish}:</b> {p.step}
    </section>
  );
}

/** The day's groceries, closed until tapped: each meal's ingredients. */
export function SqDayGroceries({ day }: { day: SqDay }) {
  const meals = dayGroceries(day);
  if (!meals.some((m) => m.items.length > 0)) return null;
  return (
    <details className="sq-card sq-daygro">
      <summary>What you need {day.isToday ? "today" : `for ${day.label}`}</summary>
      {meals.map((m, i) => (
        <div key={i} className="sq-daygro-meal">
          <div className="sq-sec">
            {m.meal} · {m.dish}
          </div>
          {m.items.length > 0 ? (
            <ul>
              {m.items.map((x, j) => (
                <li key={j}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="sq-sub">No written recipe; see the meal for what goes in it.</p>
          )}
        </div>
      ))}
    </details>
  );
}

const mealNote = (s: WeekMenuSlot) => (s.recipe ? s.dish : `${s.dish} · no written recipe`);

function Meals({ day, dayIndex, open }: { day: SqDay; dayIndex: number; open: (s: SqSheet) => void }) {
  return (
    <div className="sq-list">
      {day.slots.map((s, si) => (
        <SqNavRow key={si} title={s.slot} note={mealNote(s)} onOpen={() => open({ k: "dayrecipe", d: dayIndex, s: si })} />
      ))}
    </div>
  );
}

/** Another day: its meals, each opening its recipe, and its groceries on tap. */
export function SqDayView({ days, at, open }: { days: SqDay[]; at: number; open: (s: SqSheet) => void }) {
  if (at === THREE) {
    return (
      <>
        {days.slice(0, 3).map((d, i) => (
          <SqCard key={i} title={d.label}>
            <Meals day={d} dayIndex={i} open={open} />
          </SqCard>
        ))}
        <p className="sq-sub">Tap a meal for its recipe.</p>
      </>
    );
  }
  const day = days[at];
  if (!day) return null;
  return (
    <>
      <SqPrepLine next={days[at + 1]} />
      <SqCard title={day.label}>
        <Meals day={day} dayIndex={at} open={open} />
      </SqCard>
      <SqDayGroceries day={day} />
      <p className="sq-sub">For planning. Tap a meal for its recipe.</p>
    </>
  );
}

/** One meal's recipe from the day row. */
export function SqDayRecipeSheet({ slot }: { slot: WeekMenuSlot | undefined }) {
  const r = slot?.recipe;
  if (!slot) return null;
  if (!r) return <section className="sq-soft">There is no written recipe for {slot.dish} yet.</section>;
  const meta = [r.mins, r.serves ? `serves ${r.serves}` : ""].filter(Boolean).join(" · ");
  return (
    <>
      {r.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- recipe photos are remote catalogue URLs, not local assets
        <img className="sq-rphoto" src={r.imageUrl} alt="" />
      )}
      <p className="sq-sub">{slot.dish}</p>
      {meta && <p className="sq-sub">{meta}</p>}
      {r.omits && r.omits.length > 0 && (
        <section className="sq-soft">
          Made without <strong>{r.omits.join(", ")}</strong> for you
          {r.omitsInSteps ? ". Leave it out wherever the steps below mention it." : "."}
        </section>
      )}
      {r.ingredients.length > 0 && (
        <SqCard title="You need">
          <ul className="sq-ing">
            {r.ingredients.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </SqCard>
      )}
      {r.method.length > 0 && (
        <SqCard title="Method">
          <ol className="sq-steps">
            {r.method.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </SqCard>
      )}
      {(r.more ?? []).map((c) => (
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
