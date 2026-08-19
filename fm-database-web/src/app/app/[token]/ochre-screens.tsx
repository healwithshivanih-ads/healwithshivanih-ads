"use client";

/**
 * Today + Plan screens — port of screens.jsx, fed by real plan data.
 */

import { useState } from "react";
import type { AppRemedy, AppSupplement as AppSupplementT } from "@/lib/fmdb/client-app";
import { Icon, useOchre } from "./ochre-context";
import { remedySlots, type RemedySlot } from "@/lib/fmdb/remedy-slots";
import { DailyRing, MealThumb, mealThumbKind, RemedyCard, Section, SupplementSlots, Tile, Accordion, PhaseRibbon, PlateDiagram, OilGuide, FoodTiers } from "./ochre-ui";
import { MindBodyNudge } from "./ochre-eft";
import { WeekMenuSection } from "./ochre-week-menu";
import { OrderLaunchCard } from "./ochre-order";
import { GrowingTree } from "./growing-tree";
import { isGrowingTreeEnabled } from "./growing-tree-flag";
import { dailySeed } from "./daily-seed";

/** How many meal components the compact "today" row lists before it collapses
 *  the rest into "+N more". The row is two lines on a phone (.ml-dishes), which
 *  fits about five short items. Anything past this is COUNTED, never silently
 *  dropped — a capped-and-silent row hid a client's prescribed before-3pm juice
 *  entirely, and she had no way to know the row was incomplete. */
const ML_MAX_COMPONENTS = 5;

// ── time-of-day phase → the one thing to focus on right now ─────────────────

interface PhaseNow {
  eyebrow: string;
  title: string;
  sub: string;
  cta: string;
  target: string;
  glyph: string;
}

function usePhaseNow(hour: number): PhaseNow {
  const { meals, practices, remedies, supplements, planRef, breathwork, guidedWeekly, somatic } = useOchre();
  // Guided tier: no meals, no supplements — the hero is phase + practice
  // centred and must never name a surface this tier doesn't have.
  if (guidedWeekly) {
    const firstSomaticId = somatic.length && practices.length ? practices[0].id : null;
    if (hour < 11)
      return {
        eyebrow: "Right now · Morning",
        title: guidedWeekly.title,
        sub: guidedWeekly.items[0] ?? guidedWeekly.note,
        cta: "See this week's actions",
        target: "guided-week",
        glyph: "sun",
      };
    if (hour < 15)
      return {
        eyebrow: "Right now · Midday",
        title: "Lunch — make it the day's biggest meal",
        sub: guidedWeekly.middayLine || "Unhurried, and sitting down. The food framework is in your Plan.",
        cta: "See the food framework",
        target: "tab:plan",
        glyph: "bowl",
      };
    if (hour < 18)
      return {
        eyebrow: "Right now · Afternoon",
        title: practices.length ? `A few minutes of ${practices[0].name.toLowerCase()}` : "A quiet mid-afternoon pause",
        sub: "The daily practice is the programme — two to five minutes, guided.",
        cta: practices.length ? "Start the practice" : "See this week",
        target: firstSomaticId ? `somatic:${firstSomaticId}` : "guided-week",
        glyph: "breath",
      };
    return {
      eyebrow: "Right now · Evening",
      title: "Wind down on time",
      sub: "Stop eating about three hours before bed, and let sleep do the repair work.",
      cta: "Tick off today",
      target: "tab:progress",
      glyph: "moon",
    };
  }
  const teaAfterFood = /tea|chai/i.test(planRef.foods.sometimes.join(" "));
  const lunch = meals.find((m) => /lunch/i.test(m.slot));
  const dinner = meals.find((m) => /dinner/i.test(m.slot));
  const breath = practices.find((p) => /breath|4-7-8/i.test(p.name));
  const sun = practices.find((p) => /sunlight/i.test(p.name));
  const bedtimeSupps = supplements.filter((s) => s.slot === "Bedtime").map((s) => s.name.split(" (")[0]);
  // The last two hand-rolled timing tests, now on the shared parser. The old
  // `/bed/i` matched "bedside" and `/between/i` missed every remedy that names
  // its times instead of the phrase ("mid-morning, mid-afternoon, evening").
  const inSlot = (s: RemedySlot) =>
    remedies
      .filter((r) => r.assigned && r.daily && remedySlots(r.timing || r.when || "").includes(s))
      .map((r) => r.name.split(" (")[0]);
  const bedtimeDrinks = inSlot("bedtime");
  const betweenMealSips = [...new Set([...inSlot("mid_morning"), ...inSlot("mid_afternoon")])];

  if (hour < 11)
    return {
      eyebrow: "Right now · Morning",
      title: sun ? "Sunlight, then your morning supplements" : "Your morning supplements with breakfast",
      sub: `${sun ? sun.name + ", then your" : "Your"} supplements with breakfast.${teaAfterFood ? " Keep the tea for after you eat, not before." : ""}`,
      cta: "Log morning supplements",
      target: "supps",
      glyph: "sun",
    };
  if (hour < 15)
    return {
      eyebrow: "Right now · Midday",
      title: "Lunch — vegetables and dal first",
      sub: `${lunch ? "Today: " + lunch.components.map((c) => c.title).join(", ").toLowerCase() + "." : "Protein and fibre on the plate."}${betweenMealSips.length ? ` Sip ${betweenMealSips[0]} between meals.` : ""}`,
      cta: "View today’s lunch",
      target: lunch ? `meal:${lunch.slot}` : "tab:plan",
      glyph: "bowl",
    };
  if (hour < 18)
    return {
      eyebrow: "Right now · Afternoon",
      title: breathwork ? `A round of ${breathwork.name.toLowerCase()}` : breath ? `A round of ${breath.name.toLowerCase()}` : "A quiet mid-afternoon pause",
      sub: `${breathwork ? `${breathwork.rounds} slow rounds` : "A few slow breaths"} settle the afternoon. Snack only if you’re genuinely hungry.`,
      cta: breathwork ? "Start guided breathing" : "See your practices",
      target: breathwork ? "breath" : "tab:plan",
      glyph: "breath",
    };
  if (hour < 22)
    return {
      eyebrow: "Right now · Evening",
      title: "Light, early dinner",
      sub: `${dinner ? "Tonight: " + dinner.components.map((c) => c.title).join(", ").toLowerCase() + ". " : ""}Aim to finish by about 7:45 so your body gets its overnight rest.`,
      cta: "View today’s dinner",
      target: dinner ? `meal:${dinner.slot}` : "tab:plan",
      glyph: "moon",
    };
  return {
    eyebrow: "Right now · Night",
    title: bedtimeDrinks.length ? `Wind down — ${bedtimeDrinks[0].toLowerCase()}${bedtimeSupps.length ? " & " + bedtimeSupps[0].toLowerCase() : ""}` : "Wind down for sleep",
    sub: `${bedtimeDrinks.concat(bedtimeSupps).join(" + ")} before bed${breath ? ", then " + breath.name.split(/[—·(]/)[0].trim().toLowerCase() : ""}. Screens off, lights low.`,
    cta: "Log bedtime routine",
    target: "supps",
    glyph: "moon",
  };
}

function greetWord(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// ── TODAY ────────────────────────────────────────────────────────────────────

/** Pre-start "on hold" screen. Shown whenever the plan hasn't started yet —
 *  either the coach set a future start date (countdown), or the plan was just
 *  generated and no start date is confirmed yet ("coach will confirm"). The
 *  app unlocks itself the moment the start date arrives. */
export function PlanHoldScreen({ goCoach, openOrder }: { goCoach: () => void; openOrder: () => void }) {
  const data = useOchre();
  const days = data.client.startsInDays;
  const hasDate = days > 0; // a committed future start date to count down to
  const coachFirst = data.coach.name.split(" ")[0];
  const eyebrow = !hasDate
    ? "Starting soon"
    : days === 1
      ? "Starts tomorrow"
      : `Starts in ${days} days`;
  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">Hi {data.client.firstName}</div>
        <div className="date script">Your plan is getting ready</div>
      </div>

      <div className="rightnow">
        <div className="rn-body">
          <div className="rn-eyebrow">
            <Icon name="sparkle" size={14} /> {eyebrow}
          </div>
          <div className="rn-title">
            {hasDate ? (
              <>Your {data.client.totalWeeks}-week plan begins {data.client.startDateLabel}</>
            ) : (
              <>Your {data.client.totalWeeks}-week plan is being set up</>
            )}
          </div>
          <div className="rn-sub">
            {hasDate ? (
              <>
                Your meals, supplements and daily routine all unlock then — there&apos;s nothing
                you need to do until {data.client.startDateLabel}. The app opens up on its own that day.
              </>
            ) : (
              <>
                {coachFirst} is finalising your start date. The moment it&apos;s set, your meals,
                supplements and daily routine all unlock right here — nothing for you to do yet.
              </>
            )}
          </div>
          <button className="rn-cta" onClick={goCoach}>
            Message {coachFirst} <Icon name="arrowRight" size={16} />
          </button>
        </div>
        <div className="rn-ring">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 68,
              height: 68,
              borderRadius: "50%",
              border: "3px solid var(--forest)",
              color: "var(--forest)",
            }}
          >
            <span style={{ fontSize: hasDate ? 22 : 26, fontWeight: 700, lineHeight: 1 }}>
              {hasDate ? days : "✦"}
            </span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>
              {hasDate ? (days === 1 ? "day" : "days") : "soon"}
            </span>
          </div>
          {hasDate && <div className="rn-ring-cap">to go</div>}
        </div>
      </div>

      <div className="coach-line" style={{ marginTop: 14 }}>
        <Icon name="sparkle" size={18} style={{ color: "var(--forest)", flexShrink: 0, marginTop: 1 }} />
        <div>
          <div className="q">
            {hasDate ? (
              <>
                I&apos;ve set everything up for you, {data.client.firstName}. We&apos;ll begin
                together on {data.client.startDateLabel} — message me anytime before then.
              </>
            ) : (
              <>
                Everything&apos;s ready, {data.client.firstName}. I&apos;ll confirm your start date
                shortly and you&apos;ll see it right here — message me anytime.
              </>
            )}
          </div>
          <div className="who">— {data.coach.name}</div>
        </div>
      </div>

      {(() => {
        // Pre-Day-1 head start: let the client see + order their supplements
        // now so they arrive in time for day one. The full OrderOverlay
        // (buy links, retailer grouping, mark-as-ordered) is reachable during
        // hold — it renders independently of the held plan-content tabs.
        const order = [...data.supplements, ...(data.upcomingSupplements ?? [])];
        if (order.length === 0) return null;
        return (
          <div className="rightnow" style={{ marginTop: 14 }}>
            <div className="rn-body">
              <div className="rn-eyebrow">
                <Icon name="sparkle" size={14} /> Get a head start
              </div>
              <div className="rn-title" style={{ fontSize: 17 }}>
                {hasDate ? <>Order these before {data.client.startDateLabel}</> : <>What to have ready</>}
              </div>
              <div className="rn-sub" style={{ marginBottom: 10 }}>
                So your supplements are in hand for day one — there&apos;s nothing else to prep yet.
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
                {order.map((s, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "7px 0",
                      borderBottom: "1px solid rgba(0,0,0,0.08)",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    {s.dose && (
                      <span style={{ opacity: 0.6, fontSize: 13, textAlign: "right" }}>{s.dose}</span>
                    )}
                  </li>
                ))}
              </ul>
              <button className="rn-cta" onClick={openOrder}>
                See full order list <Icon name="arrowRight" size={16} />
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/** Seed-cycling section (its own block under the menu). The app has already
 *  worked out today's seeds from the client's cycle data — she just reads it.
 *  A "period started" tap re-keys the cycle so it stays accurate over time. */
function SeedCyclingSection() {
  const data = useOchre();
  const sc = data.seedCycling;
  const [showSchedule, setShowSchedule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!sc) return null;

  const markPeriodStarted = async () => {
    if (saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/app-period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (j.ok) {
        setMsg("Got it — updating your seeds…");
        setTimeout(() => window.location.reload(), 700);
      } else {
        setMsg(j.error || "Couldn't save — please try again");
        setSaving(false);
      }
    } catch {
      setMsg("Couldn't save — please try again");
      setSaving(false);
    }
  };

  return (
    <Section title="Seed cycling">
      <div className="card seed-card">
        <span className="seed-phase">{sc.today.line}</span>
        {sc.today.seeds.length > 0 && (
          <div className="seed-chips">
            {sc.today.seeds.map((s) => (
              <span key={s} className="seed-chip">
                <Icon name="leaf" size={14} /> {s}
              </span>
            ))}
          </div>
        )}
        <p className="seed-note">{sc.today.note}</p>

        {sc.mode === "phased" && (
          <div className="seed-actions">
            <button className="seed-btn" onClick={markPeriodStarted} disabled={saving}>
              {saving ? "Saving…" : "My period started today"}
            </button>
            {!sc.needsDate && (
              <button
                className="seed-link"
                onClick={() => setShowSchedule((v) => !v)}
                aria-expanded={showSchedule}
              >
                {showSchedule ? "Hide the full rhythm" : "See the full rhythm"}
              </button>
            )}
          </div>
        )}
        {msg && <p className="seed-saved">{msg}</p>}

        {showSchedule && (
          <div className="seed-schedule">
            <div>
              <strong>First half (follicular)</strong>
              <br />
              {sc.schedule.follicular}
            </div>
            <div>
              <strong>Second half (luteal)</strong>
              <br />
              {sc.schedule.luteal}
            </div>
            <p className="seed-note" style={{ marginTop: 0 }}>
              Grind the seeds fresh and stir into curd, a smoothie or dal — not very hot food.
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}

export function TodayScreen({
  logged,
  onToggleSupp,
  onLogAll,
  dailyDone,
  dailyTotal,
  streak,
  bonusBlossoms,
  bonusFruit,
  openMeal,
  openRemedy,
  goTab,
  goCheckin,
  goCoach,
  openBreath,
  // openEft / openSleep: still accepted (both call sites pass them) but no
  // longer consumed here — the mind-body entry card moved to the Practices tab.
  openSomatic,
  openExercise,
  practices,
  onTogglePractice,
  openGrocery,
  feelToday,
  onLogFeeling,
  openLabs,
}: {
  logged: Record<string, string>;
  onToggleSupp: (id: string) => void;
  onLogAll: () => void;
  dailyDone: number;
  dailyTotal: number;
  streak: number;
  bonusBlossoms: number;
  bonusFruit: number;
  openMeal: (slot: string) => void;
  openRemedy: (r: AppRemedy) => void;
  goTab: (tab: string) => void;
  goCheckin: () => void;
  goCoach: () => void;
  openBreath: () => void;
  openEft: () => void;
  openSleep: () => void;
  /** Opens one specific prescribed practice — a plan can carry several. */
  openSomatic: (practiceId: string) => void;
  openExercise: (practiceId: string) => void;
  practices: { id: string; name: string; when: string; details?: string; done: boolean }[];
  onTogglePractice: (id: string) => void;
  openGrocery: () => void;
  /** today's 1-5 energy tap is already in — hides the grow-today row */
  feelToday: boolean;
  onLogFeeling: () => void;
  /** Opens the labs overlay — surfaced here only while an order is recommended. */
  openLabs: () => void;
}) {
  const data = useOchre();
  const hour = new Date().getHours();
  const ph = usePhaseNow(hour);
  const externalRemedies = data.remedies.filter((r) => r.assigned && r.route === "external");
  // Which practice cards have their "How" details expanded.
  const [openPractice, setOpenPractice] = useState<Set<string>>(new Set());
  const togglePracticeDetail = (id: string) =>
    setOpenPractice((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onCta = () => {
    if (ph.target === "supps") {
      const el = document.getElementById("today-supps");
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (ph.target === "guided-week") {
      const el = document.getElementById("guided-week");
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (ph.target.startsWith("somatic:")) openSomatic(ph.target.slice(8));
    else if (ph.target === "breath") openBreath();
    else if (ph.target.startsWith("meal:")) openMeal(ph.target.slice(5));
    else if (ph.target.startsWith("tab:")) goTab(ph.target.slice(4));
  };

  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">
          {greetWord(hour)}, {data.client.firstName}
        </div>
        <div className="date script">
          {data.today.dow}, {data.today.dateLabel}
        </div>
      </div>

      {/* RIGHT NOW hero */}
      <div className="rightnow">
        <div className="rn-body">
          <div className="rn-eyebrow">
            <Icon name={ph.glyph} size={14} /> {ph.eyebrow}
          </div>
          <div className="rn-title">{ph.title}</div>
          <div className="rn-sub">{ph.sub}</div>
          <button className="rn-cta" onClick={onCta}>
            {ph.cta} <Icon name="arrowRight" size={16} />
          </button>
        </div>
        <div className="rn-ring">
          {isGrowingTreeEnabled(data.clientId) ? (
            // Small living-tree thumb; taps through to the full tree in Progress.
            <button
              className="rn-tree-thumb"
              onClick={() => goTab("progress")}
              aria-label="See your tree grow in Progress"
            >
              <GrowingTree
                week={data.client.tenureWeek}
                phaseWeek={data.client.week}
                totalWeeks={data.client.tenureTotalWeeks}
                dailyDone={dailyDone}
                dailyTotal={dailyTotal}
                streak={streak}
                bonusBlossoms={bonusBlossoms}
                bonusFruit={bonusFruit}
                size={108}
              />
              <div className="rn-ring-cap">
                {dailyDone} of {dailyTotal} today
              </div>
              {/* Streak visible from DAY ONE — days 1-2 are the highest
                  drop-off window and used to get no continuity feedback at
                  all (the old badge appeared at day 3, and only on Progress). */}
              {streak >= 1 && <div className="rn-ring-streak">Day {streak} 🌱</div>}
            </button>
          ) : (
            <>
              <DailyRing done={dailyDone} total={dailyTotal} size={68} />
              <div className="rn-ring-cap">today</div>
            </>
          )}
        </div>
      </div>

      {/* Today's seed — one line, different every day, gone tomorrow. The
          daily-return hook: asks for nothing, ticks nothing. Personal
          material (mind-body questions, already depth-gated server-side)
          surfaces ~1 day in 3 when it exists; evergreen house-voice lines
          otherwise. */}
      {(() => {
        const seed = dailySeed(data.clientId, new Date().toLocaleDateString("en-CA"), data.mindBodyReads);
        return (
          <div className="daily-seed">
            <span className="daily-seed-kicker">
              <Icon name="sparkle" size={12} /> Today&apos;s seed
            </span>
            <p className="daily-seed-line">{seed.text}</p>
          </div>
        );
      })()}

      {/* THE daily action — one ten-second tap that grows the tree, keeps the
          streak alive, and gives the coach a mood datapoint. Shown until
          today's tap is in, then it simply isn't there. Not dismissible and
          not a question card: a single door into the existing energy sheet. */}
      {!feelToday && (
        <button className="grow-today" onClick={onLogFeeling}>
          <span className="grow-today-ico" aria-hidden="true">🌱</span>
          <span className="grow-today-body">
            <span className="grow-today-title">Log today — your tree grows</span>
            <span className="grow-today-meta">Ten seconds: how&apos;s your energy?</span>
          </span>
          <Icon name="arrowRight" size={16} />
        </button>
      )}

      {/* This week — guided tier's core card: the phase's actions. */}
      {data.guidedWeekly && (
        <div id="guided-week">
          <Section title={data.guidedWeekly.title}>
            <div className="card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, marginBottom: 10 }}>
                {data.guidedWeekly.note}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                {data.guidedWeekly.items.map((it, i) => (
                  <li key={i} style={{ fontSize: 14.2, lineHeight: 1.55 }}>
                    {it}
                  </li>
                ))}
              </ul>
              {data.guidedWeekly.alsoActive.length > 0 && (
                <div style={{ fontSize: 12.6, color: "var(--muted)", marginTop: 10 }}>
                  Still in flight: {data.guidedWeekly.alsoActive.join(" · ")} — the full picture is in your Plan.
                </div>
              )}
            </div>
            <div className="card-quiet soon" style={{ marginTop: 8 }}>
              <Icon name="dot" size={10} style={{ color: "var(--muted)", flexShrink: 0 }} />
              <span>{data.guidedWeekly.standardNote}</span>
            </div>
          </Section>
        </div>
      )}

      {/* coach micro-copy — only when the coach actually wrote one */}
      {data.client.coachLine && (
        <div className="coach-line" style={{ marginTop: 14 }}>
          <Icon name="sparkle" size={18} style={{ color: "var(--forest)", flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="q">{data.client.coachLine}</div>
            <div className="who">— {data.coach.name}</div>
          </div>
        </div>
      )}

      <Section title={data.meals.length ? "Your meals for today" : "How to eat today"}>
        {data.meals.length === 0 && (
          <button
            className="tile"
            onClick={() => goTab("plan")}
            style={{ width: "100%", textAlign: "left", border: "none", cursor: "pointer", font: "inherit", marginBottom: 8 }}
          >
            <span className="ico">
              <Icon name="forkKnife" size={21} />
            </span>
            <span className="info" style={{ flex: 1 }}>
              <span className="t1" style={{ display: "block" }}>
                Your plan is principle-based this phase
              </span>
              <span className="t2" style={{ display: "block" }}>
                Build each meal from your “{data.planRef.letterFoods?.enjoyTitle ?? "eat freely"}” list — it&apos;s all on your Plan tab
              </span>
            </span>
            <span className="chev">
              <Icon name="chev" size={18} />
            </span>
          </button>
        )}
        <MealList openMeal={openMeal} logged={logged} onToggle={onToggleSupp} openRemedy={openRemedy} />
      </Section>

      {data.cyclePhase && (
        <Section title="Your cycle today">
          <div className="card seed-card">
            <span className="seed-phase">
              {data.cyclePhase.label} — day {data.cyclePhase.dayInCycle} of{" "}
              {data.cyclePhase.cycleLength}
            </span>
            <p className="seed-note" style={{ color: "var(--ink)", marginTop: 11 }}>
              {data.cyclePhase.note}
            </p>
          </div>
        </Section>
      )}

      {data.seedCycling && <SeedCyclingSection />}

      {data.periodCare && (
        <Section title="Cramp care">
          <div className="card seed-card">
            <span className="seed-phase">{data.periodCare.heading}</span>
            <p className="seed-note" style={{ color: "var(--ink)", marginTop: 11 }}>
              {data.periodCare.line}
            </p>
            <p className="seed-note">{data.periodCare.recipe}</p>
          </div>
        </Section>
      )}

      {!data.guidedWeekly && (
      <Section title="Your supplements">
        <div id="today-supps" />
        <SupplementSlots logged={logged} onToggle={onToggleSupp} onLogAll={onLogAll} onOpenRemedy={openRemedy} />
      </Section>
      )}

      {externalRemedies.length > 0 && (
        <Section title="Ayurvedic remedies">
          <RemedyToday openRemedy={openRemedy} />
        </Section>
      )}

      {/* The section used to gate on practices.length alone, which hid the
          reset link AND the mind-body unlock nudge for any client whose plan
          had no checkbox practices but did have breath/EFT/sleep/somatic
          content (2026-08-05 audit). Mind-body availability now opens it too. */}
      {(practices.length > 0 ||
        !!data.breathwork ||
        !!data.eft ||
        !!data.sleep ||
        data.somatic.length > 0 ||
        !!data.mindBody?.locked) && (
        <Section title={practices.length > 0 ? "Daily practices" : "Mind & body"}>
          {practices.length > 0 && (
          <div className="card" style={{ overflow: "hidden" }}>
            {practices.map((p) => {
              const on = !!p.done;
              const isBreath = data.breathwork?.practiceId === p.id;
              // A somatic-linked practice launches from ITS OWN row — the same
              // pattern as breathing. It used to also render a separate
              // "Chosen for you" card below, so every guided practice appeared
              // TWICE on Today: once to tick, once to start. One row does both.
              const somaticHere = data.somatic.find((sm) => sm.practiceId === p.id);
              // Same one-row-does-both rule as somatic: the session starts from
              // its own row, and its generated "do these in order" details line
              // would only restate what the player already shows.
              const exerciseHere = data.exerciseSessions.find((ex) => ex.practiceId === p.id);
              const hasDetails = !!p.details && !isBreath && !somaticHere && !exerciseHere;
              const expanded = openPractice.has(p.id);
              return (
                <div key={p.id} className="practice-item">
                  <button
                    className="practice"
                    onClick={() => onTogglePractice(p.id)}
                    style={{ width: "100%", background: "none", border: "none", font: "inherit", textAlign: "left" }}
                  >
                    <span className={"check-sq" + (on ? " on" : "")}>
                      <Icon name="checkBold" size={15} style={{ color: "#fff" }} />
                    </span>
                    <span className={"p-name" + (on ? " done" : "")}>{p.name}</span>
                    {isBreath ? (
                      <span
                        className="p-guide"
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openBreath();
                        }}
                      >
                        <Icon name="breath" size={13} /> Guide
                      </span>
                    ) : somaticHere ? (
                      <span
                        className="p-guide"
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSomatic(p.id);
                        }}
                      >
                        <Icon name="sprout" size={13} /> Guide
                      </span>
                    ) : exerciseHere ? (
                      <span
                        className="p-guide"
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openExercise(p.id);
                        }}
                      >
                        <Icon name="sprout" size={13} /> Start
                      </span>
                    ) : (
                      <span className="p-trailing">
                        {p.when && <span className="p-when">{p.when}</span>}
                        {hasDetails && (
                          <span
                            className="p-guide"
                            role="button"
                            aria-expanded={expanded}
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePracticeDetail(p.id);
                            }}
                          >
                            {expanded ? "Hide ▲" : "How ▾"}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                  {hasDetails && expanded && <div className="p-details">{p.details}</div>}
                </div>
              );
            })}
          </div>
          )}
          {/* The plan arrives in layers, and this is the only place the client
              hears about it. Deliberately NOT a count: "3 more locked" turns
              staging — which exists to protect them from a fourteen-item day —
              into a list of what they are not doing yet. No number, no lock
              icon, no progress bar to complete. Just: this is the start. */}
          {practices.length > 0 && data.practicesComingLater > 0 && (
            <p className="muted" style={{ margin: "10px 2px 0", fontSize: 13 }}>
              These come first. A few more open up later in your plan.
            </p>
          )}
          {/* The mind-body entry line lives on the PRACTICES tab only.
              It was rendered here as well, so the same card — same six chips,
              identical for every client — appeared twice in one session. Today
              is a landing screen; the resets belong with the other things the
              client is meant to DO. Component and routing untouched. */}
          {data.mindBody?.locked && (
            <MindBodyNudge
              nextUp={data.mindBody.nextUp}
              priorLabel={data.mindBody.priorLabel}
              doneCount={data.mindBody.doneCount}
              needed={data.mindBody.needed}
            />
          )}
        </Section>
      )}

      <Section title="Coming up">
        <div className="stack" style={{ gap: 10 }}>
          {!data.guidedWeekly && (
            <Tile
              icon="checkin"
              accent
              t1={`Your week ${data.client.week} check-in`}
              t2={`A few quiet minutes to tell ${data.coach.name.split(" ")[0]} how you're doing`}
              onClick={goCheckin}
            />
          )}
          {data.grocery && (
            <Tile icon="bag" t1="Shopping list" t2="Tick off what you need before your next shop" onClick={openGrocery} />
          )}
          {/* Labs left the tab bar (2026-08-05 audit) — but a recommended
              order must not lose its moment, so it surfaces here until acted
              on, exactly like the shopping list does. */}
          {data.labOrders.some((o) => o.status === "recommended") && (
            <Tile
              icon="droplet"
              accent
              t1="Book your lab test"
              t2={`${data.coach.name.split(" ")[0]} has recommended blood work — home collection`}
              onClick={openLabs}
            />
          )}
          {data.guidedWeekly ? (
            <Tile
              icon="coach"
              t1="The monthly live session"
              t2="Bring any question — details in the Coach tab"
              onClick={goCoach}
            />
          ) : (
            <Tile icon="message" t1="Ask your coach" t2={`${data.coach.name.split(" ")[0]}, plus a co-pilot for quick plan questions`} onClick={goCoach} />
          )}
        </div>
      </Section>
    </div>
  );
}

/** Daily remedies box — EXTERNAL only (oil packs, steam, compresses). */
function RemedyToday({ openRemedy }: { openRemedy: (r: AppRemedy) => void }) {
  const { remedies } = useOchre();
  const external = remedies.filter((r) => r.assigned && r.route === "external");
  return (
    <div className="card" style={{ padding: "6px 6px 8px" }}>
      {external.map((r) => (
        <button key={r.slug} className="remedy-opt" onClick={() => openRemedy(r)} style={{ borderTop: "none" }}>
          <span className="ro-ico">
            <Icon name={r.icon || "hand"} size={17} />
          </span>
          <span className="ro-body">
            <span className="ro-name">{r.name}</span>
            <span className="ro-sub">{r.when} · tap for how to use it</span>
          </span>
          <span className="ro-tag ext">Apply</span>
          <span className="rc-chev">
            <Icon name="chev" size={17} />
          </span>
        </button>
      ))}
      <div className="rmd-box-note">
        <Icon name="hand" size={13} /> Applied or inhaled — not taken by mouth. Your edible Ayurvedic drinks sit with your meals above.
      </div>
    </div>
  );
}

/** Compact meal rows; edible daily Ayurvedic drinks fold in by timing.
 *  Exported only so the render-parity test can mount this row on its own —
 *  mounting the whole TodayScreen would couple that test to twenty unrelated
 *  fields of ClientAppData and go red for reasons that aren't the meal row. */
export function MealList({
  openMeal,
  logged,
  onToggle,
  openRemedy,
}: {
  openMeal: (slot: string) => void;
  logged: Record<string, string>;
  onToggle: (id: string) => void;
  openRemedy: (r: AppRemedy) => void;
}) {
  const { meals, mealExtra, remedies } = useOchre();
  const drinks = remedies.filter((r) => r.assigned && r.daily && r.route !== "external" && !r.supplementLike);

  // THE DAY IN THE ORDER IT IS LIVED. Every remedy is placed at its own time
  // (remedy-slots.ts, one shared parser) instead of listed separately for the
  // client to cross-reference against the menu. Two rules keep it to one screen:
  //
  //   - a remedy whose slot ALREADY has a meal rides that meal's row, so
  //     mid-morning tea appears with the mid-morning snack rather than twice;
  //   - a remedy whose slot has no meal gets its own row, inserted in the right
  //     place — on waking, after lunch, after dinner, before bed. Those four are
  //     exactly the moments that had nowhere to live, which is how an
  //     after-dinner remedy ended up written into the dinner slot as the meal.
  //
  // A slot with nothing in it renders nothing at all.
  // PARSE `timing`, NOT `when`. `when` is a coarse display label — "Bedtime" |
  // "Between meals" | "Morning" | "Daily" — already lossily derived from the
  // catalogue text by another regex. Parsing the label loses everything it
  // threw away: hibiscus tea ("mid-morning or afternoon") flattens to "Daily"
  // and lands at the end of the day, after dinner, which is exactly where it
  // should not be. `timing` is the catalogue's own words.
  const slotsOf = (r: AppRemedy) => remedySlots(r.timing || r.when || "");
  const bySlot = new Map<RemedySlot, AppRemedy[]>();
  for (const r of drinks) {
    for (const s of slotsOf(r)) {
      const list = bySlot.get(s) ?? [];
      if (!list.some((x) => x.slug === r.slug)) list.push(r);
      bySlot.set(s, list);
    }
  }
  // Which meal row (if any) each slot attaches to. Slots absent from this map
  // stand alone; `after_*` deliberately follow their meal rather than merge.
  const SLOT_ON_MEAL: Partial<Record<RemedySlot, RegExp>> = {
    mid_morning: /mid.?morning/i,
    mid_afternoon: /evening snack|mid.?afternoon|afternoon/i,
  };
  const slotsAfterMeal: [RegExp, RemedySlot][] = [
    [/lunch/i, "after_lunch"],
    [/dinner/i, "after_dinner"],
  ];
  const attachedSlots = new Set(Object.keys(SLOT_ON_MEAL) as RemedySlot[]);
  const take = (s: RemedySlot) => bySlot.get(s) ?? [];
  // Anything the parser could not place still has to reach the client — it goes
  // after the meals rather than being dropped, because a remedy nobody can see
  // is a remedy nobody takes.
  const unplaced = drinks.filter((r) => slotsOf(r).length === 0);
  const placed = new Set<string>();
  const drinkRow = (r: AppRemedy) => {
    const id = "rx-" + r.slug;
    placed.add(r.slug);
    return (
      <div className="meal-rx" key={id}>
        <button
          className={"rx-tick" + (logged[id] ? " on" : "")}
          onClick={() => onToggle(id)}
          aria-pressed={!!logged[id]}
          aria-label={"Mark " + r.name + " taken"}
        >
          <Icon name="checkBold" size={15} style={{ color: "#fff" }} />
        </button>
        <button className="rx-info" onClick={() => openRemedy(r)}>
          <span className="rx-top">
            <span className="rx-name">{r.name}</span>
            <span className="rx-ayur">
              <Icon name="leaf" size={10} /> Ayurveda
            </span>
          </span>
          <span className="rx-sub">
            {r.when}
            {r.dose ? " · " + r.dose : ""}
          </span>
        </button>
        <span className="rx-chev">
          <Icon name="chev" size={16} />
        </span>
      </div>
    );
  };
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* On waking — before the first meal of the day. */}
      {take("on_waking").map((r) => drinkRow(r))}
      {meals.map((m, i) => {
        const ex = mealExtra[m.slot];
        // Remedies that ride this meal's own moment, and those that follow it.
        const withMeal = ([...attachedSlots] as RemedySlot[])
          .filter((s) => SLOT_ON_MEAL[s]?.test(m.slot))
          .flatMap((s) => take(s));
        const after = [
          ...withMeal,
          ...slotsAfterMeal.filter(([re]) => re.test(m.slot)).flatMap(([, s]) => take(s)),
        ].filter((r, k, arr) => arr.findIndex((x) => x.slug === r.slug) === k);
        return (
          <div key={i}>
            <button className="meal-lite" onClick={() => openMeal(m.slot)}>
              <MealThumb slot={m.slot} size={52} radius={13} kind={mealThumbKind(m.components.map((c) => c.title).join(" "))} />
              <span className="ml-body">
                <span className="ml-top">
                  <span className="label">{m.slot}</span>
                  <span className="ml-meta">
                    {m.ayurveda && (
                      <span className="rx-ayur" style={{ marginRight: 6 }}>
                        <Icon name="leaf" size={10} /> Ayurveda recommends
                      </span>
                    )}
                    {ex?.mins ?? ""}
                  </span>
                </span>
                <span className="ml-dishes">
                  {m.components.slice(0, ML_MAX_COMPONENTS).map((c, ci) => (
                    <span key={ci}>
                      {c.title}
                      {c.portion && <span className="ml-portion">{c.portion}</span>}
                      {ci < Math.min(m.components.length, ML_MAX_COMPONENTS) - 1 && " · "}
                    </span>
                  ))}
                  {/* The line caps to stay readable on a phone, but the cap used
                      to be SILENT: a 4-item slot simply lost its tail, so a
                      prescribed item was invisible (cl-022's before-3pm vegetable
                      juice — the whole point of moving it off her evening). The
                      row opens the full meal, so the fix is to say something is
                      there, not to overflow the line. Conservation is pinned by
                      ochre-screens-render.test.tsx. */}
                  {m.components.length > ML_MAX_COMPONENTS && (
                    <span className="ml-more"> · +{m.components.length - ML_MAX_COMPONENTS} more</span>
                  )}
                </span>
              </span>
              <span className="chev">
                <Icon name="chev" size={18} />
              </span>
            </button>
            {after.map(drinkRow)}
          </div>
        );
      })}
      {/* Before bed — after everything else in the day. */}
      {take("bedtime").map((r) => drinkRow(r))}
      {unplaced.filter((r) => !placed.has(r.slug)).map((r) => drinkRow(r))}
      {drinks.filter((r) => !placed.has(r.slug)).map(drinkRow)}
    </div>
  );
}

// ── MY PLAN ──────────────────────────────────────────────────────────────────

/** Plan-tab supplement list, tiered: ⭐ Core (driver-targeting) first, then
 *  the rest of the daily protocol, then a clearly-separated "As needed"
 *  group at the bottom so situational items never pollute the daily list. */
// The whole plan, grouped by the week each supplement starts. Each week is a
// collapsible section: the current week (and anything starting next week) is
// open by default; future and completed phases stay collapsed so the list
// reads as the full arc without overwhelming. Today's routine lives on the
// Today tab — this is the reference for the entire protocol.
function PlanSupplements() {
  const { allSupplements, supplements } = useOchre();
  // Fall back to the current-week list if an older payload has no allSupplements.
  const items = ((allSupplements && allSupplements.length ? allSupplements : supplements) ?? []).slice();
  if (items.length === 0) return null;

  const byWeek = new Map<number, AppSupplementT[]>();
  for (const s of items) {
    const wk = s.startWeek ?? 1;
    const arr = byWeek.get(wk);
    if (arr) arr.push(s);
    else byWeek.set(wk, [s]);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  const meta = (st?: string) =>
    st === "current"
      ? { tag: "On it now", color: "#2f7d4f", bg: "#eef6ef", border: "#cfe6d4", open: true, dim: false }
      : st === "upcoming"
        ? { tag: "Starts next week", color: "#b8722c", bg: "#fbf4e9", border: "#e7c79b", open: true, dim: false }
        : st === "past"
          ? { tag: "Completed", color: "#8a8a8a", bg: "#f4f4f2", border: "#e4e4df", open: false, dim: true }
          : { tag: "Coming up", color: "#5b6b7a", bg: "#f1f4f7", border: "#d8e0e8", open: false, dim: false };

  return (
    <>
      {weeks.map((wk) => {
        const group = byWeek.get(wk)!;
        const m = meta(group[0]?.status);
        return (
          <details key={wk} open={m.open} style={{ marginBottom: 10 }}>
            <summary
              style={{
                listStyle: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "9px 12px",
                borderRadius: 10,
                background: m.bg,
                border: `1px solid ${m.border}`,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <span>
                {wk <= 1 ? "Week 1 · from Day 1" : `Week ${wk}`}{" "}
                <span style={{ fontWeight: 600, color: "#9a9a93" }}>· {group.length}</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: m.color }}>{m.tag}</span>
            </summary>
            <div className="card" style={{ overflow: "hidden", marginTop: 6, opacity: m.dim ? 0.72 : 1 }}>
              {group.map((s) => (
                <SuppPlanCard key={s.id} supp={s} />
              ))}
            </div>
          </details>
        );
      })}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 4, paddingLeft: 2 }}>
        Your full protocol, in the order it unfolds. Today&apos;s doses are on the Today tab — order anything marked &ldquo;starts next week&rdquo; ahead of time so it arrives before you begin.
      </div>
    </>
  );
}

function SuppPlanCard({ supp }: { supp: ReturnType<typeof useOchre>["supplements"][number] }) {
  return (
    <div className="supp-plan">
      <div className="top">
        <div style={{ flex: 1 }}>
          <div className="name">
            {supp.name}
            {supp.core && !supp.startsNextWeek && (
              <span className="supp-core">
                <Icon name="sparkle" size={10} /> Core
              </span>
            )}
            {supp.startsNextWeek && (
              <span
                className="supp-core"
                style={{ background: "#f3e0c2", color: "#b8722c" }}
              >
                Starts next week
              </span>
            )}
          </div>
          {/* dose only — the chip already carries the timing (the old
              "· bedtime" suffix duplicated and sometimes contradicted it) */}
          <div className="dose">{supp.dose}</div>
        </div>
        <span className={"badge" + (supp.slot === "Bedtime" ? " forest" : "")}>{supp.timing}</span>
      </div>
      <div className="why">{supp.why}</div>
      <div className="supp-foot">
        {supp.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external supplement-label URL (VitaOne/iHerb); next/image would need per-domain remotePatterns
          <img
            className="supp-thumb"
            src={supp.imageUrl}
            alt={`${supp.name} label`}
            loading="lazy"
            style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <span className="stock">
          <Icon name="pill" size={13} />
          {supp.buyLabel ?? "Recommended brand"}
        </span>
        {supp.buyUrl && (
          <a className="reorder" href={supp.buyUrl} target="_blank" rel="noreferrer">
            <Icon name="bag" size={14} /> Reorder
          </a>
        )}
      </div>
    </div>
  );
}

/** Top-of-Plan explainer: what this plan is, why you're on it, and the
 *  dietary highlights as tap-to-expand chips (some link to a cheat-sheet). */
function PlanFocusCard({ openDoc }: { openDoc: (doc: { kind: string; id: string }) => void }) {
  const { planRef, tissueSalts } = useOchre();
  const { focus, ayurveda, flags } = planRef;
  const [sel, setSel] = useState<number | null>(null);
  return (
    <div className="card" style={{ padding: "15px 16px", marginBottom: 14 }}>
      <div className="plan-why">{focus.why}</div>
      {ayurveda && (
        <details
          className="list-fold"
          style={{
            marginTop: 12,
            padding: "4px 13px 8px",
            background: "var(--forest-tint)",
            borderRadius: 14,
            borderLeft: "3px solid var(--forest)",
          }}
        >
          <summary>
            <Icon name="leaf" size={14} style={{ color: "var(--forest)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--forest-deep)" }}>
              Your Ayurvedic assessment · {ayurveda.constitution}
            </span>
            <span className="lf-chev">
              <Icon name="chev" size={15} />
            </span>
          </summary>
          <div style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>
            Constitution: <strong>{ayurveda.constitution}</strong>
            {ayurveda.imbalance ? <> · {ayurveda.imbalance}</> : null}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, marginTop: 5 }}>{ayurveda.how}</div>
        </details>
      )}
      {flags.length > 0 && (
        <>
          <div className="flag-row">
            {flags.map((f, i) => (
              <button key={i} className={"flag-chip" + (sel === i ? " on" : "")} onClick={() => setSel(sel === i ? null : i)}>
                <Icon name="leaf" size={11} /> {f.label}
                <Icon name="chev" size={13} className={sel === i ? "flag-chev open" : "flag-chev"} />
              </button>
            ))}
          </div>
          {sel !== null && (
            <div className="flag-detail">
              {flags[sel].detail}
              {flags[sel].resourceId && (
                <button
                  className="flag-link"
                  onClick={() => openDoc({ kind: "resource", id: flags[sel].resourceId! })}
                >
                  <Icon name="doc" size={13} /> Read the cheat-sheet
                  <Icon name="chev" size={13} />
                </button>
              )}
            </div>
          )}
        </>
      )}
      {tissueSalts && tissueSalts.list.length > 0 && (
        <details
          className="list-fold"
          style={{
            marginTop: 12,
            padding: "4px 13px 8px",
            background: "var(--forest-tint)",
            borderRadius: 14,
            borderLeft: "3px solid var(--forest)",
          }}
        >
          <summary>
            <span style={{ fontSize: 13 }}>🧂</span>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--forest-deep)" }}>
              Gentle tissue salts · {tissueSalts.list.length}
            </span>
            <span className="lf-chev">
              <Icon name="chev" size={15} />
            </span>
          </summary>
          {tissueSalts.overview && (
            <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, marginBottom: 7 }}>
              {tissueSalts.overview}
            </div>
          )}
          {tissueSalts.list.map((s, i) => (
            <div key={i} style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.5, marginTop: i ? 7 : 0 }}>
              <strong>{s.name}</strong>
              {s.reason ? <> — {s.reason}</> : null}
              {s.how ? (
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{s.how}</div>
              ) : null}
              {s.buyUrl ? (
                <a
                  href={s.buyUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, marginTop: 4, color: "var(--accent, #b8722c)", fontWeight: 600 }}
                >
                  <Icon name="bag" size={13} /> Find it on Amazon
                </a>
              ) : null}
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5, marginTop: 8, opacity: 0.85 }}>
            A gentle traditional adjunct — optional, not a medicine, and not a replacement for your supplements or care.
          </div>
        </details>
      )}
    </div>
  );
}

export function PlanScreen({
  openDoc,
  openRemedy,
  openGrocery,
  openOrder,
  openPortions,
}: {
  openDoc: (doc: { kind: string; id: string }) => void;
  openRemedy: (r: AppRemedy) => void;
  openGrocery: () => void;
  openOrder: () => void;
  openPortions: () => void;
}) {
  const data = useOchre();
  const pr = data.planRef;
  return (
    <div className="screen-pad screen-anim">
      <div className="greeting" style={{ paddingBottom: 4 }}>
        <div className="hi" style={{ fontSize: 24 }}>
          Your plan
        </div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
          {data.guidedWeekly
            ? `The standard ${data.client.totalWeeks}-week programme, by ${pr.authoredBy}.`
            : `A ${data.client.totalWeeks}-week reset, built for you by ${pr.authoredBy}.`}
        </div>
      </div>

      <PlanFocusCard openDoc={openDoc} />

      <PhaseRibbon />

      {/* The mind-body connection moved to the Practices tab (2026-08-05
          audit) — it was competing with the menu here, and the Practices tab
          exists to give it room. */}

      {/* ---- do-this-daily actions first; learning lives further down ---- */}

      {/* Daily practices + guided breathing now live on the Today tab only
          (2026-06-13) — they're a daily do, not plan reference, so showing
          them in both places was duplication. */}

      {/* this week's full menu + grocery launch — so shopping happens
          BEFORE the week starts, not meal by meal. Hybrid/principle plans
          carry ONE illustrative week → "Sample menu" (coach rule
          2026-06-11: week-by-week framing confuses hybrid clients). */}
      {data.weekMenus.length > 0 && (
        <details className="plan-collapse">
          <summary>
            <span className="pc-ico">
              <Icon name="forkKnife" size={16} />
            </span>
            <span className="pc-body">
              <span className="pc-title">{data.menuIsSample ? "Sample menu" : "This week's menu"}</span>
              <span className="pc-sub">
                {data.grocery
                  ? "Every day's meals + the grocery list — tap to browse"
                  : "Every day's meals for this phase — tap to browse"}
              </span>
            </span>
            <span className="pc-chev">
              <Icon name="chev" size={18} />
            </span>
          </summary>
          <div className="plan-collapse-body">
            <WeekMenuSection openGrocery={openGrocery} openPortions={openPortions} />
          </div>
        </details>
      )}

      {/* decode the household portions ("1 bowl", "½ cup", "1 katori") that
          appear on every dish above — a reference, reachable from its home
          on the Plan tab as well as inline under the menu. */}
      {data.guidedAbout && (
        <Section title="About this programme">
          <div className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 14.2, lineHeight: 1.62 }}>{data.guidedAbout.what}</div>
            <div style={{ fontSize: 13.4, lineHeight: 1.6, color: "var(--muted)", marginTop: 10 }}>
              {data.guidedAbout.arc}
            </div>
          </div>
          <div className="card" style={{ padding: "14px 16px", marginTop: 10 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>What members commonly notice</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              {data.guidedAbout.notice.map((n, i) => (
                <li key={i} style={{ fontSize: 13.8, lineHeight: 1.55 }}>{n}</li>
              ))}
            </ul>
          </div>
          <div style={{ marginTop: 10 }}>
            <Accordion
              items={[
                { t: "Who this suits", b: data.guidedAbout.rightFor.join(" · ") },
                { t: "When the assessment is the better start", b: data.guidedAbout.assessFirst.join(" · ") },
              ]}
            />
          </div>
        </Section>
      )}

      {/* Guided practice library moved to the Practices tab with everything
          else start-anytime (2026-08-05 audit). */}

      <button className="gro-launch" onClick={openPortions} style={{ marginTop: 4, marginBottom: 14 }}>
        <span className="gro-launch-ico" aria-hidden="true">
          <Icon name="bowl" size={18} />
        </span>
        <span className="gro-launch-body">
          <span className="gro-launch-title">Kitchen measures</span>
          <span className="gro-launch-meta">What a bowl, cup &amp; katori mean — in ml and grams</span>
        </span>
      </button>

      {pr.plate.length > 0 && (
      <Section title="How to build your plate">
        {data.weightLoss && (
          <details
            className="list-fold"
            style={{
              marginBottom: 12,
              padding: "4px 15px 9px",
              background: "var(--ochre-tint)",
              borderRadius: 14,
              borderLeft: "3px solid var(--ochre)",
            }}
          >
            {/* Collapsed = just the verdict — the one thing to know. The
                numbers behind it are a tap away, not a wall she scrolls past. */}
            <summary>
              <span style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.4 }}>
                {data.weightLoss.adherence === "high" ? (
                  <strong style={{ color: "var(--ochre-deep)" }}>A little generous this week</strong>
                ) : data.weightLoss.estimatedDailyKcal != null && data.weightLoss.estimatedDailyKcal < 1300 ? (
                  <strong style={{ color: "var(--ochre-deep)" }}>Eat to comfortable fullness</strong>
                ) : (
                  <strong style={{ color: "var(--forest)" }}>✓ On track</strong>
                )}{" "}
                · your guide is {data.weightLoss.dailyTarget.toLocaleString()} kcal/day
              </span>
              <span className="lf-chev">
                <Icon name="chev" size={15} />
              </span>
            </summary>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 26, color: "var(--ink)", lineHeight: 1 }}>
                {data.weightLoss.dailyTarget.toLocaleString()}
              </span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>kcal / day · your guide this week</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginTop: 5 }}>
              {data.weightLoss.phaseNote}{" "}Your meals are built around this — eat to comfortable fullness, don&apos;t
              count every calorie. Your maintenance level is about {data.weightLoss.tdee.toLocaleString()} kcal.
            </div>
            {/* One coherent message: the headline above is the guide. Below we
                reassure (no second competing number) — a weight-loss menu that
                sits at or below the guide is the deficit WORKING, not a problem.
                Only surface an actionable nudge: too generous (eat a bit less),
                or genuinely too light (<1300 kcal → eat more). */}
            {data.weightLoss.estimatedDailyKcal != null && data.weightLoss.adherence && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--line)",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--ink)",
                }}
              >
                {data.weightLoss.adherence === "high" ? (
                  <>
                    <strong style={{ color: "var(--ochre-deep)" }}>A little generous this week.</strong>{" "}Your meals run
                    a bit above the guide — go easy on extra portions and snacks, or message{" "}
                    {data.coach.name.split(" ")[0]} to adjust.
                  </>
                ) : data.weightLoss.estimatedDailyKcal < 1300 ? (
                  <>
                    <strong style={{ color: "var(--ochre-deep)" }}>Eat to comfortable fullness.</strong>{" "}This week&apos;s
                    meals look a little light — have a bit more at each meal so energy and muscle hold up. Message{" "}
                    {data.coach.name.split(" ")[0]} if they feel too small.
                  </>
                ) : (
                  <>
                    <strong style={{ color: "var(--forest)" }}>✓ A comfortable deficit.</strong>{" "}Your meals this week sit
                    nicely within your guide — right where a gentle, sustainable fat-loss week should be. Eat to fullness;
                    no need to count.
                  </>
                )}
              </div>
            )}
          </details>
        )}
        <PlateDiagram />
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8, paddingLeft: 2 }}>
          Your pattern: <strong style={{ color: "var(--forest-deep)" }}>{pr.pattern}</strong> · {pr.forNote.toLowerCase()}. Tap any part of the plate.
        </div>
        {data.principles.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Accordion items={data.principles} />
          </div>
        )}
      </Section>
      )}
      {pr.plate.length === 0 && data.principles.length > 0 && (
        <Section title="How this programme thinks">
          <Accordion items={data.principles} />
        </Section>
      )}

      <Section title="Eat this, go easy on that">
        <FoodTiers />
      </Section>

      {(pr.oils.use.length > 0 || pr.oils.avoid.length > 0 || pr.cooking.length > 0) && (
        <details className="plan-collapse">
          <summary>
            <span className="pc-ico">
              <Icon name="bowl" size={16} />
            </span>
            <span className="pc-body">
              <span className="pc-title">In the kitchen</span>
              <span className="pc-sub">Oils to cook with + kitchen habits — tap to browse</span>
            </span>
            <span className="pc-chev">
              <Icon name="chev" size={18} />
            </span>
          </summary>
          <div className="plan-collapse-body">
            {(pr.oils.use.length > 0 || pr.oils.avoid.length > 0) && <OilGuide />}
            {pr.cooking.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Accordion items={pr.cooking} />
              </div>
            )}
          </div>
        </details>
      )}

      {!data.guidedWeekly && data.remedies.some((r) => r.assigned) && (
        <details className="plan-collapse">
          <summary>
            <span className="pc-ico">
              <Icon name="leaf" size={16} />
            </span>
            <span className="pc-body">
              <span className="pc-title">{`Remedies ${pr.authoredBy.split(" ")[0]} picked`}</span>
              <span className="pc-sub">What each one is for + how to use it — daily ones appear on Today</span>
            </span>
            <span className="pc-chev">
              <Icon name="chev" size={18} />
            </span>
          </summary>
          <div className="plan-collapse-body">
            <div className="stack" style={{ gap: 10 }}>
              {data.remedies
                .filter((r) => r.assigned)
                .map((r) => (
                  <RemedyCard key={r.slug} remedy={r} onOpen={openRemedy} />
                ))}
            </div>
            <div className="card-quiet soon" style={{ marginTop: 10 }}>
              <Icon name="leaf" size={16} style={{ color: "var(--ochre)" }} />
              <span>
                The daily ones appear on your Today list. A <strong>Swap option</strong> is an either/or — use it instead of its
                partner remedy if it suits you better, never both.
              </span>
            </div>
          </div>
        </details>
      )}

      {/* Learn / Resources / Picks were three separate always-open sections —
          three scroll-lengths of link cards between the client and her
          supplements (2026-08-05 audit). One folded shelf now holds all three. */}
      {(data.lessons.length > 0 || data.resources.length > 0 || data.coachPicks.length > 0) && (
        <details className="plan-collapse">
          <summary>
            <span className="pc-ico">
              <Icon name="book" size={16} />
            </span>
            <span className="pc-body">
              <span className="pc-title">Your library</span>
              <span className="pc-sub">
                {`Lessons, guides & extras ${pr.authoredBy.split(" ")[0]} picked for you — tap to browse`}
              </span>
            </span>
            <span className="pc-chev">
              <Icon name="chev" size={18} />
            </span>
          </summary>
          <div className="plan-collapse-body">
            {data.lessons.length > 0 && (
              <div className="stack" style={{ gap: 10 }}>
                {data.lessons.map((l) => (
                  <button key={l.id} className="learn-card" onClick={() => openDoc({ kind: "lesson", id: l.id })}>
                    <span className="learn-ico">
                      <Icon name="book" size={18} />
                    </span>
                    <span className="learn-body">
                      <span className="learn-title">{l.title}</span>
                      <span className="learn-sum">{l.summary}</span>
                      <span className="learn-meta">{l.mins}</span>
                    </span>
                    <span className="chev">
                      <Icon name="chev" size={18} />
                    </span>
                  </button>
                ))}
              </div>
            )}
            {data.resources.length > 0 && (
              <div className="stack" style={{ gap: 10, marginTop: data.lessons.length > 0 ? 10 : 0 }}>
                {data.resources.map((r) => (
                  <button key={r.id} className="res-card" onClick={() => openDoc({ kind: "resource", id: r.id })}>
                    <span className="res-ico">
                      <Icon name={r.icon} size={18} />
                    </span>
                    <span className="res-body">
                      <span className="res-top">
                        <span className="res-title">{r.title}</span>
                        <span className="res-kind">{r.kind}</span>
                      </span>
                      <span className="res-desc">{r.desc}</span>
                    </span>
                    <span className="chev">
                      <Icon name="chev" size={18} />
                    </span>
                  </button>
                ))}
              </div>
            )}
            {data.coachPicks.length > 0 && (
              <>
                <div
                  className="card"
                  style={{ overflow: "hidden", marginTop: data.lessons.length > 0 || data.resources.length > 0 ? 10 : 0 }}
                >
                  {data.coachPicks.map((p, i) => (
                    <div
                      key={`${p.title}-${i}`}
                      style={{
                        padding: "11px 14px",
                        borderBottom: i < data.coachPicks.length - 1 ? "1px solid var(--line, #ece7df)" : "none",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {p.title}
                        {p.forWhat && (
                          <span style={{ fontWeight: 500, opacity: 0.7 }}> · for {p.forWhat}</span>
                        )}
                      </div>
                      {p.note && <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 3 }}>{p.note}</div>}
                      {p.buyUrl && (
                        <a
                          href={p.buyUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, marginTop: 5, color: "var(--accent, #b8722c)", fontWeight: 600 }}
                        >
                          <Icon name="bag" size={13} /> Where to get it
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6, paddingLeft: 2 }}>
                  A few extras Shivani picked for you — optional, not part of your daily routine.
                </div>
              </>
            )}
          </div>
        </details>
      )}

      {!data.guidedWeekly && (<>
      {/* 💊 doses are logged on Today; this is the why + the reorder links —
          an occasional read, so it lives with the other occasional tasks. */}
      <details className="plan-collapse">
        <summary>
          <span className="pc-ico">
            <Icon name="pill" size={16} />
          </span>
          <span className="pc-body">
            <span className="pc-title">Your supplements</span>
            <span className="pc-sub">What each one is for + reorder links — daily logging lives on Today</span>
          </span>
          <span className="pc-chev">
            <Icon name="chev" size={18} />
          </span>
        </summary>
        <div className="plan-collapse-body">
          <PlanSupplements />
        </div>
      </details>

      {/* 🛒 one-sitting ordering checklist — moved to the bottom and
          collapsed (2026-06-13): reordering is an occasional task, not
          a daily one, so it shouldn't crowd the top of the plan. */}
      <details className="plan-collapse">
        <summary>
          <span className="pc-ico">
            <Icon name="bag" size={16} />
          </span>
          <span className="pc-body">
            <span className="pc-title">Reorder your supplements</span>
            <span className="pc-sub">Order everything in one sitting — tap to open</span>
          </span>
          <span className="pc-chev">
            <Icon name="chev" size={18} />
          </span>
        </summary>
        <div className="plan-collapse-body">
          <OrderLaunchCard openOrder={openOrder} />
        </div>
      </details>
      </>)}

      {/* Labs intentionally NOT a standalone section — the order list lives
          in Resources and the milestone view in Progress → Lab checkpoints,
          so a third listing here was pure repetition. */}
    </div>
  );
}
