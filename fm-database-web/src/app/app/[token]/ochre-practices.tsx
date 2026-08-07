"use client";

/* ======================================================================
   The Ochre Tree — Practices tab (took the Labs slot, 2026-08-05 audit).

   The old Labs tab served 4 orders ever across the roster while the app's
   actual differentiators had no home: exercise sessions were reachable only
   from one row on Today, the mind-body reading sat mid-scroll on a long Plan
   tab, and the practice library didn't exist as a browsable place at all.
   This tab is that home. Labs didn't disappear — the vault + order flow live
   in an overlay reached from Account (always) and from a Today tile whenever
   an order is recommended; the discovery tier keeps the full Labs tab because
   lab booking IS its flow.

   Everything here is start-anytime: prescribed-vs-extra only changes labels,
   never access (the "any client-safe read can start its practice" rule).
   Daily ticking stays on Today — this tab never shows checkboxes.
   ====================================================================== */

import type { AppExerciseSession } from "@/lib/fmdb/exercise-session";

import { useOchre, Icon } from "./ochre-context";
import { Section, Tile } from "./ochre-ui";
import { MindBodyEntryCard, MindBodyReadsSection } from "./ochre-mind-body";
import { MindBodyNudge } from "./ochre-eft";

/**
 * The open movement card at the top of the tab.
 *
 * It says what the session IS before asking for the tap — how many movements,
 * that they come one at a time, that nothing is timed, and what needs fetching
 * first. Every one of those was already known and none of it was visible until
 * the client had already committed by opening the player: the equipment list in
 * particular used to arrive as step two of a session in progress.
 *
 * The first two movements are named for the same reason. "Movement session" is
 * a label; "heel raises, then a squat" is something a person can picture, and
 * picturing it is most of the decision to start.
 */
function MovementLead({ session, onStart }: { session: AppExerciseSession; onStart: () => void }) {
  const n = session.items.length;
  const preview = session.items.slice(0, 2).map((it) => it.name);
  return (
    <div className="mv-lead">
      <div className="mv-kicker">
        <Icon name="walk" size={13} /> Movement
      </div>
      <h3 className="mv-title">{session.name}</h3>
      {session.when && <p className="mv-when">{session.when}</p>}
      <p className="mv-lede">
        {n} {n === 1 ? "movement" : "movements"}, one at a time — the app shows you each one and waits for
        you. Nothing is timed, and you can stop whenever you like.
      </p>
      {preview.length > 0 && (
        <p className="mv-preview">
          Starts with {preview.join(", then ")}
          {n > preview.length ? "…" : ""}
        </p>
      )}
      {session.equipment.length > 0 && (
        <p className="mv-kit">
          <Icon name="dot" size={9} /> Have ready: {session.equipment.join(", ")}
        </p>
      )}
      <button className="mv-go" onClick={onStart}>
        Start the session
        <Icon name="chev" size={16} />
      </button>
    </div>
  );
}

export function PracticesScreen({
  openBreath,
  openEft,
  openSleep,
  openSomatic,
  openExercise,
}: {
  openBreath: () => void;
  openEft: () => void;
  openSleep: () => void;
  openSomatic: (practiceId: string) => void;
  openExercise: (practiceId: string) => void;
}) {
  const data = useOchre();

  const libraryRows: { key: string; icon: string; t1: string; t2: string; go: () => void }[] = [];
  if (data.breathwork) {
    libraryRows.push({
      key: "breath",
      icon: "breath",
      t1: data.breathwork.name,
      t2: "Guided breathing · a few minutes",
      go: openBreath,
    });
  }
  for (const s of data.somatic) {
    libraryRows.push({
      key: `somatic-${s.practiceId}`,
      icon: "sprout",
      t1: s.name,
      t2: s.why || "Guided somatic reset",
      go: () => openSomatic(s.practiceId),
    });
  }
  if (data.eft) {
    libraryRows.push({ key: "eft", icon: "heart", t1: "EFT tapping", t2: "A guided 2-minute round", go: openEft });
  }
  if (data.sleep) {
    libraryRows.push({
      key: "sleep",
      icon: "moon",
      t1: "Wind down for sleep",
      t2: "A slow evening off-ramp",
      go: openSleep,
    });
  }

  const hasReads = data.mindBodyReads.length > 0 || data.mindBodyWithheld > 0;
  const hasAnything = libraryRows.length > 0 || data.exerciseSessions.length > 0 || hasReads;

  // Movement leads this tab. It is the one thing here that changes strength,
  // bone and balance, and it was the third section down behind two reflective
  // ones — a client scrolling past it is a client not doing it. The first
  // session gets an open card rather than a row, because "one tap, we walk you
  // through it" is the invitation, and a closed row says none of that.
  const [lead, ...restSessions] = data.exerciseSessions;

  return (
    <div className="screen-pad screen-anim">
      <div className="greeting" style={{ paddingBottom: 4 }}>
        <div className="hi" style={{ fontSize: 24 }}>
          Practices
        </div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
          Guided resets, your movement sessions, and what your body may be saying — start anything, any time.
        </div>
      </div>

      {!hasAnything && (
        <div className="card" style={{ padding: 20, textAlign: "center", marginTop: 14 }}>
          <Icon name="sprout" size={22} style={{ color: "var(--forest)" }} />
          <h3 style={{ margin: "8px 0 4px", fontSize: 16 }}>Your practices are on their way</h3>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            As your plan takes shape, guided practices appear here — breathing, somatic resets, movement.
          </p>
        </div>
      )}

      {lead && (
        <Section title="Your movement session">
          <MovementLead session={lead} onStart={() => openExercise(lead.practiceId)} />
          {restSessions.length > 0 && (
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {restSessions.map((s) => (
                <Tile
                  key={s.practiceId}
                  icon="walk"
                  t1={s.name}
                  t2={s.when || "Guided, one exercise at a time"}
                  onClick={() => openExercise(s.practiceId)}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      <MindBodyEntryCard
        have={{
          breath: data.breathwork ? { name: data.breathwork.name } : null,
          eft: data.eft ? { name: "EFT tapping" } : null,
          sleep: data.sleep ? { name: "Wind down for sleep" } : null,
          somatic: data.somatic,
        }}
        onOpen={(route) => {
          if (route.kind === "breath") openBreath();
          else if (route.kind === "eft") openEft();
          else if (route.kind === "sleep") openSleep();
          else if (route.somatic) openSomatic(route.somatic.practiceId);
        }}
      />

      {/* The emotional reading gets room to breathe here — on the Plan tab it
          competed with the menu and eleven other sections for attention. */}
      {hasReads && (
        <Section title="The mind-body connection">
          <MindBodyReadsSection
            reads={data.mindBodyReads}
            withheldCount={data.mindBodyWithheld}
            onStart={openSomatic}
          />
        </Section>
      )}

      {libraryRows.length > 0 && (
        <Section title="Guided practice library">
          <div className="stack" style={{ gap: 8 }}>
            {libraryRows.map((r) => (
              <Tile key={r.key} icon={r.icon} t1={r.t1} t2={r.t2} onClick={r.go} />
            ))}
          </div>
          <div className="card-quiet soon" style={{ marginTop: 8 }}>
            <Icon name="dot" size={10} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <span>
              All guided, a few minutes each. Your daily list stays on Today — this shelf is for whenever you want more.
            </span>
          </div>
        </Section>
      )}

      {data.mindBody?.locked && (
        <MindBodyNudge
          nextUp={data.mindBody.nextUp}
          priorLabel={data.mindBody.priorLabel}
          doneCount={data.mindBody.doneCount}
          needed={data.mindBody.needed}
        />
      )}
    </div>
  );
}
