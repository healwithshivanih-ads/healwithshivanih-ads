"use client";

/**
 * Home — the new front's Today tab.
 *
 * One card says what is next. Done moves it on; Undo takes back that one
 * action. A supplement taken with a meal is its own tap. Everything else is
 * a line away: "Later today", "Your whole day", and one "This week" line.
 *
 * This file only draws. What is next, what is later and how the day is
 * counted are decided in sq-day.ts.
 */

import { useState } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import {
  anytimeMoments,
  dayCount,
  greeting,
  isTicked,
  laterSummary,
  showReturnCard,
  showStartCard,
  thisWeekLine,
  tickedAt,
  upcomingMoments,
  type SqKind,
  type SqMoment,
  type SqTicks,
  type SqWith,
} from "./sq-day";
import { SqAskBox } from "./sq-ask-ui";
import { SqDiaryCard, type SqDiaryState } from "./sq-diary";
import { SqStartCard } from "./sq-start";
import { travellingNow, tripDates } from "./sq-everything";
import { SqIcon, type SqSheet } from "./sq-ui";

export interface SqHomeProps {
  data: ClientAppData;
  moments: SqMoment[];
  ticks: SqTicks;
  /** true once the phone's own ticks and clock are known */
  ready: boolean;
  /** the tappable questions under the day, and what a tap does */
  chips: string[];
  onAsk: (q: string) => void;
  /** the device's hour (null before the page is live) */
  hour: number | null;
  /** where the phone's clock puts her in the day (sq-day.ts rankFloorAt) */
  nowRank: number;
  /** the last week whose check-in was sent from this phone */
  checkinSentWeek: number;
  /** "track every item": ticks and the count show on Home */
  track: boolean;
  /** the moment ticked most recently with Done, for the Undo line */
  lastId: string | null;
  onDone: (m: SqMoment) => void;
  onUndo: (m: SqMoment) => void;
  onToggle: (id: string, kind: SqKind) => void;
  open: (s: SqSheet) => void;
  /** the food diary, while the coach has one running (sq-diary.tsx) */
  diary?: SqDiaryState;
  /** the return card has been put away today */
  returnDismissed: boolean;
  onDismissReturn: () => void;
}

/** A supplement taken with a meal: its own tap, on the card or under "ticked". */
function Pill({ w, on, quiet, onToggle }: { w: SqWith; on: boolean; quiet?: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={"sq-pill" + (quiet ? " sq-pill-quiet" : "")} aria-pressed={on} onClick={onToggle}>
      {on && <SqIcon name="check" />}
      {w.name}
    </button>
  );
}

function Hero({ m, p }: { m: SqMoment; p: SqHomeProps }) {
  const [showHow, setShowHow] = useState(false);
  const extra = m.slot ? p.data.mealExtra[m.slot] : undefined;
  const hasRecipe = !!extra && (extra.recipe.length > 0 || extra.ingredients.length > 0);
  return (
    <section className="sq-hero" aria-label="Next">
      <div className="sq-eyebrow">
        Next · {m.part}
        {m.time && m.time !== m.part ? ` · ${m.time}` : ""}
      </div>
      <div className="sq-hero-row">
        <div>
          <h2>{m.title}</h2>
          {m.sub && <p className="sq-hero-sub">{m.sub}</p>}
        </div>
        {/* A photograph of the dish, decorative: the title already names it. */}
        {extra?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- recipe photos are remote catalogue URLs, not local assets
          <img className="sq-hphoto" src={extra.imageUrl} alt="" />
        )}
      </div>
      {m.with.length > 0 && (
        <div className="sq-with">
          <span className="sq-with-lbl">Take with it</span>
          {m.with.map((w) => (
            <Pill key={w.id} w={w} on={isTicked(w.id, "supp", p.ticks)} onToggle={() => p.onToggle(w.id, "supp")} />
          ))}
        </div>
      )}
      {m.how && showHow && <p className="sq-how">{m.how}</p>}
      <div className="sq-hero-actions">
        {hasRecipe && m.slot && (
          <button type="button" className="sq-btn sq-btn-primary" onClick={() => p.open({ k: "recipe", slot: m.slot! })}>
            See recipe
          </button>
        )}
        <button type="button" className={"sq-btn " + (hasRecipe ? "sq-btn-ghost" : "sq-btn-primary")} onClick={() => p.onDone(m)}>
          <SqIcon name="check" /> Done
        </button>
        {m.how && (
          <button type="button" className="sq-btn sq-btn-ghost" aria-expanded={showHow} onClick={() => setShowHow((v) => !v)}>
            {showHow ? "Hide how" : "How to do it"}
          </button>
        )}
      </div>
    </section>
  );
}

/** A row of "Later today". Tickable only when she has asked to track every item. */
function LaterRow({ m, p }: { m: SqMoment; p: SqHomeProps }) {
  // The narrow first column takes a clock time ("1:00 pm"). A plan's time hint
  // can also be a phrase ("Finish by 7–8 pm"); that reads better as the part
  // of the day here, and the phrase is still on the card when it is next.
  const clock = /^\d/.test(m.time) && m.time.length <= 9;
  const when = m.band === "anytime" ? "Any time" : clock ? m.time : m.part;
  const line = m.with.length > 0 ? `Take with it: ${m.with.map((w) => w.name).join(", ")}` : m.sub;
  const inner = (
    <>
      <time>{when}</time>
      <span className="sq-tl-body">
        <b>{m.title}</b>
        {line && <span>{line}</span>}
      </span>
    </>
  );
  if (!p.track) return <div className="sq-tl-row">{inner}</div>;
  return (
    <button
      type="button"
      className="sq-tl-row sq-tl-tick"
      aria-pressed={isTicked(m.id, m.kind, p.ticks)}
      onClick={() => p.onToggle(m.id, m.kind)}
    >
      {inner}
      <span className="sq-tick">
        <SqIcon name="check" />
      </span>
    </button>
  );
}

export function SqHome(p: SqHomeProps) {
  const { data, moments, ticks } = p;
  const [laterOpen, setLaterOpen] = useState(false);
  const sq = data.sq ?? null;
  const firstDay = showStartCard(data.client.notStarted, sq?.planDay ?? 0);

  const head = (
    <div className="sq-greet">
      <h1>
        {/* The hour is the phone's, so it is known only after the page is live. */}
        {p.hour === null ? "Hello" : greeting(p.hour)}
        {data.client.firstName ? <>, {data.client.firstName}</> : null}
      </h1>
      <p>
        {data.today.dow} {data.today.dateLabel} · week {data.client.week} of {data.client.totalWeeks}
      </p>
    </div>
  );

  // Until the phone's own ticks and clock are known, "next" cannot be known
  // either. Showing a card and then swapping it would be worse than a beat of
  // nothing.
  if (!p.ready) return head;

  const upcoming = upcomingMoments(moments, ticks, p.nowRank);
  const next = upcoming[0] ?? null;
  const later = [...upcoming.slice(1), ...anytimeMoments(moments, ticks)];
  const count = dayCount(moments, ticks);
  const last = p.lastId ? moments.find((m) => m.id === p.lastId) ?? null : null;
  const lastAt = last ? tickedAt(last.id, last.kind, ticks) : null;
  const groceryCount = data.grocery?.weeks.find((w) => w.week === data.client.week)?.items.length ?? 0;
  const week = thisWeekLine({
    week: data.client.week,
    firstDay,
    groceryCount,
    // The shopping list is marked "shopped" from its own screen, which the
    // Everything tab brings in a later build step.
    shopped: false,
    checkinSent: p.checkinSentWeek >= data.client.week,
  });

  return (
    <>
      {head}

      {showReturnCard(sq?.daysSinceLastOpen) && !p.returnDismissed && (
        <section className="sq-card sq-welcome">
          <h3>Good to see you again</h3>
          <p>Your plan is right where you left it. Today is all that matters.</p>
          <button type="button" className="sq-btn sq-btn-solid sq-btn-small" onClick={p.onDismissReturn}>
            Carry on
          </button>
        </section>
      )}

      {firstDay && <SqStartCard onOpen={() => p.open({ k: "start" })} />}

      {p.ready && travellingNow(p.data, new Date().toLocaleDateString("en-CA")) && p.data.travel && (
        <button type="button" className="sq-card sq-trip" onClick={() => p.open({ k: "trip" })}>
          <span className="sq-eyebrow">Travelling</span>
          <b>{tripDates(p.data.travel.from, p.data.travel.to)}</b>
          <small>Your coach knows. Tap for the eating-out guide or to end the trip.</small>
        </button>
      )}

      {p.diary?.view && <SqDiaryCard d={p.diary} onOpen={() => p.open({ k: "diary" })} />}

      {last && isTicked(last.id, last.kind, ticks) && (
        <section className="sq-soft sq-donebar" role="status">
          <div className="sq-db-row">
            <span className="sq-status">
              <SqIcon name="check" /> {last.part} ticked{lastAt ? ` · ${lastAt}` : ""}
            </span>
            <button type="button" className="sq-link" onClick={() => p.onUndo(last)}>
              Undo
            </button>
          </div>
          {last.with.length > 0 && (
            <div className="sq-with">
              <span className="sq-with-lbl">Took these with it?</span>
              {last.with.map((w) => (
                <Pill key={w.id} w={w} quiet on={isTicked(w.id, "supp", ticks)} onToggle={() => p.onToggle(w.id, "supp")} />
              ))}
            </div>
          )}
        </section>
      )}

      {moments.length === 0 ? (
        <section className="sq-soft">Your day will show here once your plan has meals, supplements or practices in it.</section>
      ) : next ? (
        // key: a new card for a new moment, so "How to do it" never stays open
        // across two different things.
        <Hero key={next.id} m={next} p={p} />
      ) : (
        <section className="sq-hero" aria-label="Today">
          <div className="sq-eyebrow">Today</div>
          <div className="sq-hero-row">
            <div>
              <h2>That&rsquo;s today. Rest well.</h2>
            </div>
          </div>
        </section>
      )}

      {moments.length > 0 && (
        <section className="sq-card">
          {later.length > 0 && (
            <button type="button" className="sq-fold" aria-expanded={laterOpen} onClick={() => setLaterOpen((v) => !v)}>
              <span>
                Later today <small>· {laterSummary(later)}</small>
              </span>
              <SqIcon name="chev" />
            </button>
          )}
          {later.length > 0 && laterOpen && (
            <div className="sq-tl">
              {later.map((m) => (
                <LaterRow key={m.id} m={m} p={p} />
              ))}
            </div>
          )}
          <button type="button" className="sq-link" onClick={() => p.open({ k: "day" })}>
            <SqIcon name="check" /> Your whole day
            {p.track ? ` · ${count.ticked} of ${count.total} ticked` : ""}
          </button>
        </section>
      )}

      {week && (
        <button
          type="button"
          className="sq-card sq-week"
          onClick={() => p.open({ k: "soon", title: week.opens === "grocery" ? "Shopping list" : "Weekly check-in" })}
        >
          <span className="sq-badge">
            <SqIcon name={week.opens === "grocery" ? "bag" : "pen"} />
          </span>
          <span className="sq-week-body">
            <span className="sq-eyebrow">This week</span>
            <b>{week.title}</b>
            <span className="sq-week-sub">{week.sub}</span>
          </span>
          <SqIcon name="right" />
        </button>
      )}
      {p.chips.length > 0 && <SqAskBox chips={p.chips} onAsk={p.onAsk} />}
    </>
  );
}
