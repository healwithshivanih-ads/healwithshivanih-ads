"use client";

/**
 * The Practices tab: every practice on this client's plan, one tap from
 * starting. The one she finished last sits at the top; the rest are a list.
 *
 * Only what the coach prescribed is listed (sq-practice-data.ts practiceList).
 * A plan with no practices says so plainly rather than showing an empty tab.
 */

import { SCENES, SCENE_KEYS, type PracticePrefs, type SceneKey, type SqPractice } from "./sq-practice-data";
import { SqCard, SqNavRow, type SqSheet } from "./sq-ui";

export function SqPractices({
  list,
  prefs,
  todayYmd,
  next,
  onBegin,
  open,
}: {
  list: SqPractice[];
  prefs: PracticePrefs;
  /** the phone's own date, to tell "done today" from "last used" */
  todayYmd: string;
  /** The next practice the plan holds back until an earlier one is a habit
   *  (the engine's rule, unchanged), or null when nothing is waiting. */
  next?: { nextUp: string; priorLabel: string; doneCount: number; needed: number } | null;
  /** Start a practice. Called straight from the tap, so sound can start. */
  onBegin: (id: string) => void;
  open: (s: SqSheet) => void;
}) {
  const last = prefs.last ? list.find((p) => p.id === prefs.last!.id) ?? null : null;
  const first = last ?? list[0] ?? null;
  const rest = list.filter((p) => p !== first);
  const doneToday = !!last && prefs.last!.ymd === todayYmd;
  const half = (p: SqPractice) => (prefs.resume[p.id] ? "Paused part-way · tap to carry on" : p.meta);

  return (
    <>
      <div className="sq-greet">
        <h1>Practices</h1>
        <p>Start any of these, any time.</p>
      </div>

      {!first ? (
        <SqCard>
          <p className="sq-sub">There are no practices on your plan yet. Your coach adds them when they will help.</p>
        </SqCard>
      ) : (
        <section className="sq-card sq-last">
          <div>
            {last && <span className="sq-eyebrow sq-eyebrow-fire">{doneToday ? "Done today" : "Last used"}</span>}
            <h3>{first.title}</h3>
            <p className="sq-sub">{half(first)}</p>
          </div>
          <button type="button" className="sq-btn sq-btn-quiet" onClick={() => onBegin(first.id)}>
            {doneToday ? "Again" : prefs.resume[first.id] ? "Carry on" : "Begin"}
          </button>
        </section>
      )}

      {rest.length > 0 && (
        <SqCard>
          <div className="sq-list">
            {rest.map((p) => (
              <SqNavRow key={p.id} title={p.title} note={half(p)} onOpen={() => onBegin(p.id)} />
            ))}
          </div>
        </SqCard>
      )}

      {next && (
        <section className="sq-soft">
          <b>{next.doneCount === 0 ? "Your next practice is on the way." : next.needed - next.doneCount <= 1 ? "One more day opens your next practice." : `${next.needed - next.doneCount} more days open your next practice.`}</b>{" "}
          Keep up {next.priorLabel}. {next.nextUp.charAt(0).toUpperCase() + next.nextUp.slice(1)} opens as it becomes a habit.
        </section>
      )}

      {first && (
        <SqCard>
          <div className="sq-list">
            <SqNavRow
              title="Backgrounds"
              note={prefs.scene ? `${SCENES[prefs.scene].name} for every practice` : "Four scenes; each practice picks its own"}
              onOpen={() => open({ k: "scenes" })}
            />
          </div>
        </SqCard>
      )}
    </>
  );
}

/** The four scenes, to choose one for every practice or hand the choice back. */
export function SqScenesSheet({ prefs, setPrefs }: { prefs: PracticePrefs; setPrefs: (p: PracticePrefs) => void }) {
  const pick = (scene: SceneKey | null) => setPrefs({ ...prefs, scene });
  return (
    <>
      <p className="sq-sub">Four scenes for your practices, each a short looping video with its own sound. Each practice picks its own unless you choose one here.</p>
      {SCENE_KEYS.map((s) => (
        <section key={s} className="sq-card">
          <div className="sq-scthumb">
            {/* eslint-disable-next-line @next/next/no-img-element -- a still from /public, shown once; next/image adds nothing here */}
            <img src={`/app-scenes/${s}.jpg`} alt="" />
          </div>
          <div className="sq-last">
            <div>
              <h3>{SCENES[s].name}</h3>
              <p className="sq-sub">{SCENES[s].about}</p>
            </div>
            <button type="button" className={"sq-btn sq-btn-small " + (prefs.scene === s ? "sq-btn-quiet" : "sq-btn-solid")} aria-pressed={prefs.scene === s} onClick={() => pick(s)}>
              {prefs.scene === s ? "Chosen" : "Use this"}
            </button>
          </div>
        </section>
      ))}
      <button type="button" className="sq-btn sq-btn-quiet" onClick={() => pick(null)}>
        Let each practice choose
      </button>
    </>
  );
}
