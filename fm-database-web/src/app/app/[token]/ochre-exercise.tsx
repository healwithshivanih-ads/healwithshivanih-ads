"use client";

/**
 * The exercise-session player.
 *
 * A session is worked through ONE EXERCISE AT A TIME, in the coach's order, and
 * every step is self-paced. There is no countdown and no animation, and that is
 * a clinical decision rather than a shortcut:
 *
 *   - A rep-based exercise is paced by the BODY. "Ten sit-to-stands" takes as
 *     long as ten sit-to-stands take, and a timer would either rush a client who
 *     needs to rest between reps or idle for one who does not. The somatic
 *     player animates because a breath cycle genuinely has a tempo the screen
 *     should hold. A squat does not.
 *   - Nobody props a phone up to watch it while standing on one leg. The screen
 *     is read BEFORE the movement and after it, not during — so the job is to
 *     state the dose clearly and wait, which is exactly what `rest` steps do in
 *     the somatic player (see stepMode in somatic-shapes.ts).
 *
 * Logging follows ochre-somatic.tsx exactly: measured seconds, a `logged` ref
 * against double-recording, and a record on BOTH finish and unmount. A session
 * abandoned half way is still practice and the adherence data must know.
 */

import { useEffect, useRef, useState } from "react";

import type { AppExerciseSession } from "@/lib/fmdb/exercise-session";
import { Icon } from "./ochre-context";
import { logPractice } from "./practice-log";

type Status = "intro" | "running" | "done";

export function ExerciseOverlay({
  session,
  token,
  onClose,
}: {
  session: AppExerciseSession;
  token: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("intro");
  const [idx, setIdx] = useState(0);
  /** Which exercises the client marked done — drives the progress dots. */
  const [done, setDone] = useState<Set<number>>(new Set());

  const items = session.items;
  const item = items[idx];

  // ---- logging ------------------------------------------------------------
  // Real elapsed seconds, accumulated from when the session actually started
  // rather than from when the card opened: reading the intro is not practice.
  const logged = useRef(false);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (status === "running" && startedAt.current === null) {
      startedAt.current = Date.now();
    }
  }, [status]);

  function record(completed: boolean) {
    if (logged.current) return;
    const started = startedAt.current;
    // Never started — nothing to log, and logging a zero would inflate adherence.
    //
    // THE EARLY RETURN MUST COME BEFORE THE GUARD IS SET. Setting `logged` first
    // and returning second burns the one-record-per-session guard on a no-op,
    // and every real completion afterwards is silently skipped. React's
    // development double-mount runs this cleanup immediately on mount, which is
    // exactly that sequence — measured: a full session played through to the end
    // wrote nothing to _practice_log.jsonl, with no network request and no error
    // anywhere, because the guard had already been spent before the client
    // pressed Start.
    if (started === null) return;
    logged.current = true;
    logPractice({
      token,
      kind: "exercise",
      practiceId: session.practiceId,
      name: session.name,
      seconds: Math.round((Date.now() - started) / 1000),
      completed,
    });
  }

  useEffect(() => {
    if (status === "done") record(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record is stable via the logged ref
  }, [status]);

  useEffect(() => {
    // Closed part-way is still practice, and the adherence data has to know.
    return () => record(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
  }, []);

  function advance() {
    setDone((prev) => new Set(prev).add(idx));
    if (idx + 1 >= items.length) setStatus("done");
    else setIdx(idx + 1);
  }

  // ---- intro --------------------------------------------------------------
  if (status === "intro") {
    return (
      <div className="ex-wrap">
        <button className="ex-x" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
        <h2 className="ex-h">{session.name}</h2>
        {session.when && <p className="ex-when">{session.when}</p>}
        <ol className="ex-list">
          {items.map((it, i) => (
            <li key={`${it.slug}-${i}`}>
              <strong>{it.name}</strong>
              {it.prescription && <span> — {it.prescription}</span>}
              {/* Only when it differs from the session, so the common case stays
                  quiet and the exception is the thing that stands out. */}
              {it.cadence && <span className="ex-cad"> · {it.cadence}</span>}
            </li>
          ))}
        </ol>
        {/* Before Start, never mid-session. Discovering at exercise three that
            you needed ankle weights is the same as not being able to do it. */}
        {session.equipment.length > 0 && (
          <p className="ex-kit">You&rsquo;ll need: {session.equipment.join(" · ")}</p>
        )}
        <p className="ex-note">
          Work through them in this order. Go at your own pace — stop if anything
          hurts.
        </p>
        <button className="ex-cta" onClick={() => setStatus("running")}>
          Start
        </button>
      </div>
    );
  }

  // ---- done ---------------------------------------------------------------
  if (status === "done" || !item) {
    return (
      <div className="ex-wrap">
        <h2 className="ex-h">Done</h2>
        <p className="ex-note">
          That is the whole session. Notice how it felt — steadier, or harder
          than last time — and tell Shivani at your next check-in.
        </p>
        <button className="ex-cta" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  // ---- running ------------------------------------------------------------
  const setupSteps = item.steps.filter((s) => s.setup);
  const moveSteps = item.steps.filter((s) => !s.setup);

  return (
    <div className="ex-wrap">
      <button className="ex-x" onClick={onClose} aria-label="Close">
        <Icon name="x" />
      </button>

      <p className="ex-count">
        {idx + 1} of {items.length}
      </p>
      <h2 className="ex-h">{item.name}</h2>

      {/* The dose, given the loudest treatment on the card — it is the one
          thing that differs between this client and the next. */}
      {item.prescription && <p className="ex-dose">{item.prescription}</p>}
      {item.cadence && <p className="ex-cad-line">{item.cadence}</p>}
      {item.support && item.support !== "none" && (
        <p className="ex-support">Support: {item.support}</p>
      )}
      {item.equipment.length > 0 && (
        <p className="ex-support">You&rsquo;ll need: {item.equipment.join(" · ")}</p>
      )}

      {item.why && <p className="ex-why">{item.why}</p>}

      {/* What the movement LOOKS like, read before doing it.

          Video wins over the traced figure where both exist: video is only ever
          made for the movements two stills cannot show (rotation, the neck),
          so where there is one it carries strictly more of the movement. It
          plays muted and looping with controls — no audio to surprise anyone,
          and a client who wants it still can pause. */}
      {item.videoSrc ? (
        <video
          className="ex-figure"
          src={item.videoSrc}
          autoPlay
          loop
          muted
          playsInline
          controls
          aria-label={`${item.name} — demonstration`}
        />
      ) : (
        item.figureSvg && (
          <div
            className="ex-figure"
            aria-hidden
            // Generated by our own tracer + builder from reviewed artwork; no
            // client-supplied text reaches it unescaped.
            dangerouslySetInnerHTML={{ __html: item.figureSvg }}
          />
        )
      )}

      {setupSteps.length > 0 && (
        <>
          <p className="ex-sub">Before you start</p>
          <ul className="ex-steps">
            {setupSteps.map((s, i) => (
              <li key={`s${i}`}>{s.text}</li>
            ))}
          </ul>
        </>
      )}

      <p className="ex-sub">The movement</p>
      {/* A figure PER STEP, where the entry is a sequence of different
          movements — the warm-up is eight of them. Everything else has one
          movement and one figure above, and repeating it beside every line
          would add nothing, so this renders only where the data provides it. */}
      <ol
        className={
          moveSteps.some((s) => s.figureSvg || s.videoSrc) ? "ex-steps ex-steps--fig" : "ex-steps"
        }
      >
        {moveSteps.map((s, i) => (
          <li key={`m${i}`}>
            {s.videoSrc ? (
              <video
                className="ex-stepfig"
                src={s.videoSrc}
                autoPlay
                loop
                muted
                playsInline
                aria-label={`${s.text} — demonstration`}
              />
            ) : (
              s.figureSvg && (
                <span
                  className="ex-stepfig"
                  aria-hidden
                  // Our own tracer and builder; no client text reaches it.
                  dangerouslySetInnerHTML={{ __html: s.figureSvg }}
                />
              )
            )}
            <span>{s.text}</span>
          </li>
        ))}
      </ol>

      {/* The coach's note for THIS client, if she left one. Last, so it reads as
          the amendment it is rather than as part of the standard instruction. */}
      {item.note && <p className="ex-coach">{item.note}</p>}

      <div className="ex-dots" aria-hidden>
        {items.map((_, i) => (
          <span key={i} className={i === idx ? "on" : done.has(i) ? "did" : ""} />
        ))}
      </div>

      <button className="ex-cta" onClick={advance}>
        {idx + 1 >= items.length ? "Done — finish" : "Done — next"}
      </button>
      {idx > 0 && (
        <button className="ex-back" onClick={() => setIdx(idx - 1)}>
          back
        </button>
      )}
    </div>
  );
}
