"use client";

/**
 * "Your day" — every meal, supplement, drink, remedy and practice on ONE
 * time-ordered list, grouped by the part of the day it belongs to, plus the
 * guidance card for the standing rules that are never ticked.
 *
 * Replaces four separate Today cards (meals / supplements / daily practices /
 * remedies). The grouping and counting live in day-plan.ts; this file only
 * draws them. Why the change: see day-plan.ts and practice-kind.ts.
 */

import { useMemo, useState } from "react";
import type { AppMeal, AppPractice, AppRemedy } from "@/lib/fmdb/client-app";
import { Icon, useOchre } from "./ochre-context";
import { MealThumb, mealThumbKind, Section, SuppRow } from "./ochre-ui";
import { crisp } from "./crisp";
import { FoodDiaryCard } from "./ochre-diary";
import { BAND_META, bandForHour, buildDay, slotLabel, type BandKey, type DayBand, type DayItem } from "./day-plan";

/** Same cap as the old meal row (ochre-screens.tsx ML_MAX_COMPONENTS): the
 *  line stays two lines on a phone, and anything past it is COUNTED, never
 *  silently dropped. */
const MEAL_LINE_MAX = 5;

export interface DayActions {
  logged: Record<string, string>;
  practicesDone: Record<string, boolean>;
  onToggleSupp: (id: string) => void;
  onTogglePractice: (id: string) => void;
  /** tick every listed id that is not already ticked */
  onMarkDone: (ids: { logIds: string[]; practiceIds: string[] }) => void;
  openMeal: (slot: string) => void;
  openRemedy: (r: AppRemedy) => void;
  openBreath: () => void;
  openSomatic: (practiceId: string) => void;
  openExercise: (practiceId: string) => void;
}

const isDone = (it: DayItem, a: DayActions) =>
  it.type === "practice" ? !!a.practicesDone[it.id] : it.type === "meal" ? false : !!a.logged[it.id];

function itemName(it: DayItem): string {
  if (it.type === "meal") return slotLabel(it.meal.slot);
  if (it.type === "supp") return it.supp.name.split(" (")[0];
  if (it.type === "remedy") return it.remedy.name.split(" (")[0];
  return it.practice.name;
}

export function DayTimeline(
  props: DayActions & {
    /** tests: open every band, independent of the clock */
    openAll?: boolean;
    /** false = leave the menu's meals out of the day (maintenance — see
     *  TodayDaySections). Default true. */
    withMeals?: boolean;
  },
) {
  const data = useOchre();
  const withMeals = props.withMeals !== false;
  const bands = useMemo(
    () =>
      buildDay({
        meals: withMeals ? data.meals : [],
        supplements: data.supplements,
        remedies: data.remedies,
        practices: data.practices,
      }),
    [withMeals, data.meals, data.supplements, data.remedies, data.practices],
  );
  const now = bandForHour(new Date().getHours());
  // Open ONLY the part of the day she is in. Everything else is one line —
  // and an earlier part still open carries its own "tick all" in that line,
  // so catching up at 5 pm is one tap per part, not a long scroll.
  const [open, setOpen] = useState<Set<BandKey>>(() => {
    if (props.openAll) return new Set(bands.map((b) => b.key));
    const s = new Set<BandKey>();
    if (bands.some((b) => b.key === now)) s.add(now);
    else if (bands[0]) s.add(bands[0].key);
    return s;
  });
  const toggle = (k: BandKey) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  if (bands.length === 0) return null;
  return (
    <div className="day" id="today-day">
      {bands.map((b) => (
        <Band key={b.key} band={b} isNow={b.key === now} open={open.has(b.key)} onToggle={() => toggle(b.key)} a={props} />
      ))}
    </div>
  );
}

function Band({
  band,
  isNow,
  open,
  onToggle,
  a,
}: {
  band: DayBand;
  isNow: boolean;
  open: boolean;
  onToggle: () => void;
  a: DayActions;
}) {
  const meta = BAND_META[band.key];
  const counted = band.countedIds.length;
  const done = band.items.filter((it) => it.type !== "meal" && it.counted && isDone(it, a)).length;
  const complete = counted > 0 && done >= counted;
  const remaining = band.items.filter((it) => it.type !== "meal" && it.counted && !isDone(it, a));
  const summary = band.items.map(itemName).slice(0, 4).join(" · ") + (band.items.length > 4 ? ` · +${band.items.length - 4}` : "");

  const markAll = () =>
    a.onMarkDone({
      logIds: remaining.filter((it) => it.type !== "practice").map((it) => (it as { id: string }).id),
      practiceIds: remaining.filter((it) => it.type === "practice").map((it) => (it as { id: string }).id),
    });

  return (
    <section className={"day-band" + (isNow ? " now" : "") + (complete ? " complete" : "") + (open ? " open" : "")} id={"day-" + band.key}>
      <div className="db-head">
        <button className="db-toggle" onClick={onToggle} aria-expanded={open}>
          <span className="db-glyph">
            <Icon name={complete ? "check" : meta.glyph} size={16} />
          </span>
          <span className="db-titles">
            <span className="db-title">
              {meta.label}
              {isNow && <span className="db-now">Now</span>}
            </span>
            <span className="db-sub">{open ? meta.hint : summary}</span>
          </span>
          {counted > 0 && (open || complete || remaining.length === 0) && (
            <span className={"db-count" + (complete ? " done" : "")}>{complete ? "Done" : `${done}/${counted}`}</span>
          )}
          <span className={"db-chev" + (open ? " up" : "")}>
            <Icon name="chev" size={16} />
          </span>
        </button>
        {!open && remaining.length > 0 && (
          <button className="db-quick" onClick={markAll} aria-label={`Tick all ${remaining.length} in ${meta.label}`}>
            <Icon name="check" size={14} /> {remaining.length === 1 ? "Done" : `All ${remaining.length}`}
          </button>
        )}
      </div>
      {open && (
        <div className="db-body">
          {band.items.map((it) => (
            <DayRow key={it.type === "meal" ? it.key : it.id} it={it} a={a} />
          ))}
          {remaining.length > 1 && (
            <button className="db-markall" onClick={markAll}>
              <Icon name="check" size={16} /> Done with {meta.label.toLowerCase()} — tick all {remaining.length}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function DayRow({ it, a }: { it: DayItem; a: DayActions }) {
  if (it.type === "meal") return <MealRow meal={it.meal} onOpen={() => a.openMeal(it.meal.slot)} />;
  if (it.type === "supp") {
    const s = it.supp;
    const timing = s.notDaily === "weekly" ? "Once a week" : s.notDaily === "alternate" ? "Alternate days" : s.timing;
    return <SuppRow supp={{ ...s, timing }} logged={!!a.logged[s.id]} takenAt={a.logged[s.id]} onToggle={a.onToggleSupp} />;
  }
  if (it.type === "remedy") {
    const r = it.remedy;
    return (
      <SuppRow
        isRemedy
        supp={{ id: it.id, name: r.name, dose: r.dose, slot: "Morning", timing: r.route === "external" ? "Apply" : "" }}
        logged={!!a.logged[it.id]}
        takenAt={a.logged[it.id]}
        onToggle={a.onToggleSupp}
        onOpen={() => a.openRemedy(r)}
      />
    );
  }
  return <PracticeRow p={it.practice} done={!!a.practicesDone[it.id]} a={a} />;
}

function MealRow({ meal, onOpen }: { meal: AppMeal; onOpen: () => void }) {
  return (
    <button className="meal-lite day-meal" onClick={onOpen}>
      <MealThumb slot={meal.slot} size={44} radius={12} kind={mealThumbKind(meal.components.map((c) => c.title).join(" "))} />
      <span className="ml-body">
        <span className="ml-top">
          <span className="label">{slotLabel(meal.slot)}</span>
          {meal.ayurveda && (
            <span className="rx-ayur">
              <Icon name="leaf" size={10} /> Ayurveda
            </span>
          )}
        </span>
        <span className="ml-dishes">
          {meal.components.slice(0, MEAL_LINE_MAX).map((c, ci) => (
            <span key={ci}>
              {c.title}
              {c.portion && <span className="ml-portion">{c.portion}</span>}
              {ci < Math.min(meal.components.length, MEAL_LINE_MAX) - 1 && " · "}
            </span>
          ))}
          {meal.components.length > MEAL_LINE_MAX && (
            <span className="ml-more"> · +{meal.components.length - MEAL_LINE_MAX} more</span>
          )}
        </span>
      </span>
      <span className="chev">
        <Icon name="chev" size={18} />
      </span>
    </button>
  );
}

function PracticeRow({ p, done, a }: { p: AppPractice; done: boolean; a: DayActions }) {
  const data = useOchre();
  const [showHow, setShowHow] = useState(false);
  const isBreath = data.breathwork?.practiceId === p.id;
  const somatic = data.somatic.some((sm) => sm.practiceId === p.id);
  const exercise = data.exerciseSessions.some((ex) => ex.practiceId === p.id);
  const launch = isBreath ? a.openBreath : somatic ? () => a.openSomatic(p.id) : exercise ? () => a.openExercise(p.id) : null;
  const hasHow = !!p.details && !launch;
  return (
    <div className="practice-item">
      <div className="practice day-practice">
        <button
          className={"check-sq" + (done ? " on" : "")}
          onClick={() => a.onTogglePractice(p.id)}
          aria-pressed={done}
          aria-label={done ? `${p.name} done` : `Mark ${p.name} done`}
        >
          <Icon name="checkBold" size={15} style={{ color: "#fff" }} />
        </button>
        <span className="p-main">
          <span className={"p-name" + (done ? " done" : "")}>{p.name}</span>
          {p.kind === "weekly" && (
            <span className="p-when">{p.perWeek ? `${p.perWeek}× a week — whenever suits you` : "A few times a week"}</span>
          )}
        </span>
        {launch ? (
          <button className="p-guide" onClick={launch}>
            <Icon name={isBreath ? "breath" : "sprout"} size={13} /> {exercise ? "Start" : "Guide"}
          </button>
        ) : hasHow ? (
          <button className="p-guide" aria-expanded={showHow} onClick={() => setShowHow((v) => !v)}>
            {showHow ? "Hide ▲" : "How ▾"}
          </button>
        ) : null}
      </div>
      {hasHow && showHow && <div className="p-details">{p.details}</div>}
    </div>
  );
}

/**
 * The standing rules — "one coffee, before noon", "vegetables first" — and the
 * things kept for a moment that calls for them. Read, not ticked: a rule is
 * never finished, so it never shows as undone. The weekly check-in asks how
 * they went, which is the right size of question for a rule.
 */
export function GuidanceCard() {
  const data = useOchre();
  const [openId, setOpenId] = useState<string | null>(null);
  const rules = data.guidelines.filter((g) => g.kind === "guideline");
  const tools = data.guidelines.filter((g) => g.kind === "as_needed");
  const asNeededSupps = data.supplements.filter((s) => s.asNeeded);
  if (!rules.length && !tools.length && !asNeededSupps.length) return null;
  const row = (id: string, rawName: string, rawDetails?: string, sub?: string) => {
    // Headline first; the rest of the sentence joins the details, a tap away.
    const { head: name, rest } = crisp(rawName);
    const details = [rest, rawDetails].filter(Boolean).join("\n\n") || undefined;
    return (
    <div key={id} className="guide-row">
      <button
        className="guide-main"
        onClick={() => details && setOpenId(openId === id ? null : id)}
        aria-expanded={details ? openId === id : undefined}
        style={details ? undefined : { cursor: "default" }}
      >
        <span className="guide-dot" aria-hidden="true" />
        <span className="guide-text">
          <span className="guide-name">{name}</span>
          {sub && <span className="guide-sub">{sub}</span>}
        </span>
        {details && <span className="guide-more">{openId === id ? "▲" : "▾"}</span>}
      </button>
      {details && openId === id && <div className="guide-details">{details}</div>}
    </div>
    );
  };
  return (
    <div className="card guide-card">
      {rules.length > 0 && (
        <>
          <div className="guide-head">
            <Icon name="leaf" size={15} /> Keep these in mind
          </div>
          <p className="guide-note">Nothing to tick — these run in the background of your day.</p>
          {rules.map((g) => row(g.id, g.name, g.details))}
        </>
      )}
      {(tools.length > 0 || asNeededSupps.length > 0) && (
        <>
          <div className="guide-head" style={rules.length ? { marginTop: 14 } : undefined}>
            <Icon name="hand" size={15} /> When you need it
          </div>
          {tools.map((g) => row(g.id, g.name, g.details))}
          {asNeededSupps.map((s) => row(s.id, s.name.split(" (")[0], s.why || undefined, [s.dose, s.timing].filter(Boolean).join(" · ")))}
        </>
      )}
    </div>
  );
}

/** "Your day" + "Your guidelines" as two sections — for homes other than
 *  Today (maintenance) that should still show the day.
 *
 *  `withMeals={false}` on maintenance (coach decision 2026-10-23): a
 *  maintenance plan carries ONE seasonal SAMPLE menu (app_menu.is_sample,
 *  refreshed by the maintenance-menu-seasonal cron) — mix-and-match ideas, not
 *  a daily meal plan. Laid out in "Your day" it read as "today's breakfast,
 *  lunch, dinner". The day keeps supplements, drinks, remedies and practices;
 *  the sample menu stays in the menu section. */
export function TodayDaySections(props: DayActions & { withMeals?: boolean }) {
  const data = useOchre();
  const withMeals = props.withMeals !== false;
  const hasDay = (withMeals ? data.meals.length : 0) + data.supplements.length + data.practices.length > 0 ||
    data.remedies.some((r) => r.assigned && r.daily);
  return (
    <>
      {data.foodDiary && !hasDay && (
        <Section title="Your day">
          <FoodDiaryCard />
        </Section>
      )}
      {hasDay && (
        <Section title="Your day">
          <FoodDiaryCard />
          <DayTimeline {...props} />
        </Section>
      )}
      {(data.guidelines.length > 0 || data.supplements.some((x) => x.asNeeded)) && (
        <Section title="Your guidelines">
          <GuidanceCard />
        </Section>
      )}
    </>
  );
}
