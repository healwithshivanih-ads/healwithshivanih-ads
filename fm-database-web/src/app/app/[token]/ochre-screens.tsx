"use client";

/**
 * Today + Plan screens — port of screens.jsx, fed by real plan data.
 */

import { useState } from "react";
import type { AppRemedy, AppSupplement as AppSupplementT } from "@/lib/fmdb/client-app";
import { Icon, useOchre } from "./ochre-context";
import { DailyRing, MealThumb, RemedyCard, Section, SupplementSlots, Tile, Accordion, PhaseRibbon, PlateDiagram, OilGuide, FoodTiers } from "./ochre-ui";
import { BreathLaunchCard } from "./ochre-breath";
import { WeekMenuSection } from "./ochre-week-menu";
import { OrderLaunchCard } from "./ochre-order";

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
  const { meals, practices, remedies, supplements, planRef, breathwork } = useOchre();
  const teaAfterFood = /tea|chai/i.test(planRef.foods.sometimes.join(" "));
  const lunch = meals.find((m) => /lunch/i.test(m.slot));
  const dinner = meals.find((m) => /dinner/i.test(m.slot));
  const breath = practices.find((p) => /breath|4-7-8/i.test(p.name));
  const sun = practices.find((p) => /sunlight/i.test(p.name));
  const bedtimeSupps = supplements.filter((s) => s.slot === "Bedtime").map((s) => s.name.split(" (")[0]);
  const bedtimeDrinks = remedies.filter((r) => r.assigned && r.daily && /bed/i.test(r.when ?? "")).map((r) => r.name.split(" (")[0]);
  const betweenMealSips = remedies.filter((r) => r.assigned && r.daily && /between/i.test(r.when ?? "")).map((r) => r.name.split(" (")[0]);

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
      sub: `${lunch ? "Today: " + lunch.pills.join(", ").toLowerCase() + "." : "Protein and fibre on the plate."}${betweenMealSips.length ? ` Sip ${betweenMealSips[0]} between meals.` : ""}`,
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
      sub: `${dinner ? "Tonight: " + dinner.pills.join(", ").toLowerCase() + ". " : ""}Aim to finish by about 7:45 so your body gets its overnight rest.`,
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

export function TodayScreen({
  logged,
  onToggleSupp,
  onLogAll,
  dailyDone,
  dailyTotal,
  openMeal,
  openRemedy,
  goTab,
  goCheckin,
  goCoach,
  openBreath,
  practices,
  onTogglePractice,
  openGrocery,
}: {
  logged: Record<string, string>;
  onToggleSupp: (id: string) => void;
  onLogAll: () => void;
  dailyDone: number;
  dailyTotal: number;
  openMeal: (slot: string) => void;
  openRemedy: (r: AppRemedy) => void;
  goTab: (tab: string) => void;
  goCheckin: () => void;
  goCoach: () => void;
  openBreath: () => void;
  practices: { id: string; name: string; when: string; done: boolean }[];
  onTogglePractice: (id: string) => void;
  openGrocery: () => void;
}) {
  const data = useOchre();
  const hour = new Date().getHours();
  const ph = usePhaseNow(hour);
  const externalRemedies = data.remedies.filter((r) => r.assigned && r.route === "external");

  const onCta = () => {
    if (ph.target === "supps") {
      const el = document.getElementById("today-supps");
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (ph.target === "breath") openBreath();
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
          <DailyRing done={dailyDone} total={dailyTotal} size={68} />
          <div className="rn-ring-cap">today</div>
        </div>
      </div>

      {/* coach micro-copy */}
      <div className="coach-line" style={{ marginTop: 14 }}>
        <Icon name="sparkle" size={18} style={{ color: "var(--forest)", flexShrink: 0, marginTop: 1 }} />
        <div>
          <div className="q">{data.client.coachLine}</div>
          <div className="who">— {data.coach.name}</div>
        </div>
      </div>

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

      <Section title="Your supplements">
        <div id="today-supps" />
        <SupplementSlots logged={logged} onToggle={onToggleSupp} onLogAll={onLogAll} onOpenRemedy={openRemedy} />
      </Section>

      {externalRemedies.length > 0 && (
        <Section title="Ayurvedic remedies">
          <RemedyToday openRemedy={openRemedy} />
        </Section>
      )}

      {practices.length > 0 && (
        <Section title="Daily practices">
          <div className="card" style={{ overflow: "hidden" }}>
            {practices.map((p) => {
              const on = !!p.done;
              const isBreath = data.breathwork?.practiceId === p.id;
              return (
                <button
                  key={p.id}
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
                  ) : (
                    <span className="p-when">{p.when}</span>
                  )}
                </button>
              );
            })}
          </div>
          {data.breathwork && <BreathLaunchCard bw={data.breathwork} onStart={openBreath} />}
        </Section>
      )}

      <Section title="Coming up">
        <div className="stack" style={{ gap: 10 }}>
          <Tile
            icon="checkin"
            accent
            t1={`Your week ${data.client.week} check-in`}
            t2={`A few quiet minutes to tell ${data.coach.name.split(" ")[0]} how you're doing`}
            onClick={goCheckin}
          />
          {data.grocery && (
            <Tile icon="bag" t1="Shopping list" t2="Tick off what you need before your next shop" onClick={openGrocery} />
          )}
          <Tile icon="message" t1="Ask your coach" t2={`${data.coach.name.split(" ")[0]}, plus a co-pilot for quick plan questions`} onClick={goCoach} />
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

/** Compact meal rows; edible daily Ayurvedic drinks fold in by timing. */
function MealList({
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
  const beforeBreakfastDrinks = drinks.filter((r) => r.beforeBreakfast);
  const morning = drinks.filter((r) => r.when === "Morning" && !r.beforeBreakfast);
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
      {beforeBreakfastDrinks.map((r) => drinkRow(r))}
      {meals.map((m, i) => {
        const ex = mealExtra[m.slot];
        const after = /breakfast/i.test(m.slot) ? morning : [];
        return (
          <div key={i}>
            <button className="meal-lite" onClick={() => openMeal(m.slot)}>
              <MealThumb slot={m.slot} size={52} radius={13} />
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
                <span className="ml-dishes">{m.pills.slice(0, 3).join(" · ")}</span>
              </span>
              <span className="chev">
                <Icon name="chev" size={18} />
              </span>
            </button>
            {after.map(drinkRow)}
          </div>
        );
      })}
      {drinks.filter((r) => !placed.has(r.slug)).map(drinkRow)}
    </div>
  );
}

// ── MY PLAN ──────────────────────────────────────────────────────────────────

/** Plan-tab supplement list, tiered: ⭐ Core (driver-targeting) first, then
 *  the rest of the daily protocol, then a clearly-separated "As needed"
 *  group at the bottom so situational items never pollute the daily list. */
function PlanSupplements() {
  const { supplements } = useOchre();
  const byDay = (a: AppSupplementT, b: AppSupplementT) => a.chronoRank - b.chronoRank;
  const core = supplements.filter((s) => s.core && !s.asNeeded).sort(byDay);
  const daily = supplements.filter((s) => !s.core && !s.asNeeded).sort(byDay);
  const asNeeded = supplements.filter((s) => s.asNeeded);
  return (
    <>
      {core.length > 0 && (
        <>
          <div className="supp-group-label">
            <Icon name="sparkle" size={13} /> Core — the ones doing the heavy lifting
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {core.map((s) => (
              <SuppPlanCard key={s.id} supp={s} />
            ))}
          </div>
        </>
      )}
      {daily.length > 0 && (
        <>
          {core.length > 0 && <div className="supp-group-label plain">Supporting your protocol</div>}
          <div className="card" style={{ overflow: "hidden", marginTop: core.length > 0 ? 0 : undefined }}>
            {daily.map((s) => (
              <SuppPlanCard key={s.id} supp={s} />
            ))}
          </div>
        </>
      )}
      {asNeeded.length > 0 && (
        <>
          <div className="supp-group-label muted-label">As needed — not every day</div>
          <div className="card card-asneeded" style={{ overflow: "hidden" }}>
            {asNeeded.map((s) => (
              <SuppPlanCard key={s.id} supp={s} />
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6, paddingLeft: 2 }}>
            Keep these on hand — use only when the moment calls for it (eating out, travel, a reaction). Not part of your daily rhythm.
          </div>
        </>
      )}
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
            {supp.core && (
              <span className="supp-core">
                <Icon name="sparkle" size={10} /> Core
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
  const { planRef } = useOchre();
  const { focus, ayurveda, flags } = planRef;
  const [sel, setSel] = useState<number | null>(null);
  return (
    <div className="card" style={{ padding: "15px 16px", marginBottom: 14 }}>
      <div className="plan-why">{focus.why}</div>
      {ayurveda && (
        <div
          style={{
            marginTop: 12,
            padding: "12px 13px",
            background: "var(--forest-tint)",
            borderRadius: 14,
            borderLeft: "3px solid var(--forest)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <Icon name="leaf" size={14} style={{ color: "var(--forest)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--forest-deep)" }}>
              Your Ayurvedic assessment
            </span>
          </div>
          <div style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>
            Constitution: <strong>{ayurveda.constitution}</strong>
            {ayurveda.imbalance ? <> · {ayurveda.imbalance}</> : null}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, marginTop: 5 }}>{ayurveda.how}</div>
        </div>
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
    </div>
  );
}

export function PlanScreen({
  onLogAll,
  openDoc,
  openRemedy,
  openGrocery,
  openOrder,
}: {
  onLogAll: () => void;
  openDoc: (doc: { kind: string; id: string }) => void;
  openRemedy: (r: AppRemedy) => void;
  openGrocery: () => void;
  openOrder: () => void;
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
          A {data.client.totalWeeks}-week reset, built for you by {pr.authoredBy}.
        </div>
      </div>

      <PlanFocusCard openDoc={openDoc} />

      <PhaseRibbon />

      {/* ---- do-this-daily actions first; learning lives further down ---- */}

      <Section title="Your supplements">
        <PlanSupplements />
        <div className="muted" style={{ fontSize: 12, marginTop: 8, paddingLeft: 2 }}>
          Reorder links go to recommended brands. Tap any supplement for the why.
        </div>

        <button className="log-all" style={{ marginTop: 12 }} onClick={onLogAll}>
          <Icon name="check" size={17} /> Log everything for today
        </button>
      </Section>

      {/* Daily practices + guided breathing now live on the Today tab only
          (2026-06-13) — they're a daily do, not plan reference, so showing
          them in both places was duplication. */}

      {/* this week's full menu + grocery launch — so shopping happens
          BEFORE the week starts, not meal by meal. Hybrid/principle plans
          carry ONE illustrative week → "Sample menu" (coach rule
          2026-06-11: week-by-week framing confuses hybrid clients). */}
      {data.weekMenus.length > 0 && (
        <Section title={data.menuIsSample ? "Sample menu" : "This week's menu"}>
          <WeekMenuSection openGrocery={openGrocery} />
        </Section>
      )}

      <Section title="How to build your plate">
        {data.weightLoss && (
          <div
            style={{
              marginBottom: 12,
              padding: "13px 15px",
              background: "var(--ochre-tint)",
              borderRadius: 14,
              borderLeft: "3px solid var(--ochre)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 26, color: "var(--ink)", lineHeight: 1 }}>
                {data.weightLoss.dailyTarget.toLocaleString()}
              </span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>kcal / day · your guide this week</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginTop: 5 }}>
              {data.weightLoss.phaseNote}{" "}Your meals are built around this — eat to comfortable fullness, don&apos;t
              count every calorie. Your maintenance level is about {data.weightLoss.tdee.toLocaleString()} kcal.
            </div>
          </div>
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

      <Section title="Eat this, go easy on that">
        <FoodTiers />
      </Section>

      <Section title="In the kitchen">
        <OilGuide />
        {pr.cooking.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Accordion items={pr.cooking} />
          </div>
        )}
      </Section>

      <Section title={`Remedies ${pr.authoredBy.split(" ")[0]} picked`}>
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
      </Section>

      {data.lessons.length > 0 && (
        <Section title="Learn">
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
        </Section>
      )}

      {data.resources.length > 0 && (
        <Section title={`Resources ${pr.authoredBy.split(" ")[0]} picked for you`}>
          <div className="stack" style={{ gap: 10 }}>
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
        </Section>
      )}

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

      {/* Labs intentionally NOT a standalone section — the order list lives
          in Resources and the milestone view in Progress → Lab checkpoints,
          so a third listing here was pure repetition. */}
    </div>
  );
}
