"use client";

/**
 * Calm Gut inside the new app (Sequoya shell), for a client the coach gave
 * the course to (client.yaml#courses, src/lib/fmdb/client-courses.ts).
 *
 *   - SqCourseCard: on the Practices tab. This week's session with its
 *     photo, the anytime tracks, the eight weeks and the symptom check.
 *   - SqCourseWeeksSheet: the eight weeks, which are open, which are heard.
 *   - SqCourseLayer: the course's own night player and symptom check
 *     (ochre-course.tsx), shown over the Sequoya screens unchanged, so a
 *     buyer and a client hear and see the same thing.
 *
 * A client's course has no phone limit, refund or course reminders; the
 * app's own reminders cover them. Listening data goes to their own record
 * (clients/<id>/course-<slug>.json) through /api/app-course.
 */

import type { AppCourseTrack } from "@/lib/fmdb/course-app";
import { CoursePlayerOverlay, CourseScoreOverlay, useCourse } from "./ochre-course";
import { SqCard, SqNavRow } from "./sq-ui";

const ANYTIME = ["daily", "daily-short", "night", "flare"] as const;

function mins(t: AppCourseTrack): string {
  return `${t.minutes.music} min`;
}

export function SqCourseCard({
  onPlay,
  onWeeks,
  onScore,
}: {
  /** Start a track. Called straight from the tap, so sound can start. */
  onPlay: (trackId: string) => void;
  onWeeks: () => void;
  onScore: () => void;
}) {
  const { course, listened, scoreDue } = useCourse();
  const current = course.tracks.find((t) => t.id === course.currentSessionId) ?? null;
  const heard = current ? listened.has(current.id) : false;
  const intro = current?.introId ? course.tracks.find((t) => t.id === current.introId) ?? null : null;
  const nextLocked = course.tracks.find((t) => t.kind === "session" && !t.unlocked) ?? null;
  const anytime = ANYTIME.map((id) => course.tracks.find((t) => t.id === id)).filter(
    (t): t is AppCourseTrack => !!t && t.unlocked,
  );

  return (
    <>
      {current && (
        <section className="sq-card">
          {current.image && (
            <div className="sq-scthumb">
              {/* eslint-disable-next-line @next/next/no-img-element -- a prepared still from /public; next/image adds nothing here */}
              <img src={current.image.wide} alt="" />
            </div>
          )}
          <div className="sq-last">
            <div>
              <span className="sq-eyebrow sq-eyebrow-fire">
                {course.title} · {course.finished ? "all eight weeks open" : `week ${course.week} of ${course.totalWeeks}`}
              </span>
              <h3>{current.title}</h3>
              <p className="sq-sub">
                {current.minutes.music} minutes.
                {intro && !heard ? ` Starts with a ${intro.minutes.voice}-minute intro the first time.` : heard ? " Heard this week. Listen again any day." : ""}
              </p>
            </div>
            <button type="button" className="sq-btn sq-btn-quiet" onClick={() => onPlay(current.id)}>
              {heard ? "Again" : "Listen"}
            </button>
          </div>
        </section>
      )}

      <SqCard>
        <div className="sq-list">
          {anytime.map((t) => (
            <SqNavRow key={t.id} title={t.title} note={`${mins(t)} · ${t.subtitle.toLowerCase()}`} onOpen={() => onPlay(t.id)} />
          ))}
          <SqNavRow
            title="All eight weeks"
            note={nextLocked?.unlocksLabel ? `Week ${nextLocked.week} ${nextLocked.unlocksLabel.charAt(0).toLowerCase()}${nextLocked.unlocksLabel.slice(1)}` : "Every session is open"}
            onOpen={onWeeks}
          />
          {scoreDue !== null && (
            <SqNavRow title="Symptom check" note="Five questions, about 2 minutes. The same each time, so you can see what changes." onOpen={onScore} />
          )}
        </div>
      </SqCard>
    </>
  );
}

export function SqCourseWeeksSheet({ onPlay }: { onPlay: (trackId: string) => void }) {
  const { course, listened } = useCourse();
  const sessions = course.tracks.filter((t) => t.kind === "session");
  return (
    <>
      <p className="sq-sub">
        {`${course.tagline.trim()} A new session opens each week. Listen to this week's most days, and the daily practice on the others.`}
      </p>
      <SqCard>
        <div className="sq-list">
          {sessions.map((t) =>
            t.unlocked ? (
              <SqNavRow
                key={t.id}
                title={`Week ${t.week} · ${t.title}`}
                note={`${mins(t)}${t.id === course.currentSessionId ? " · this week" : ""}${listened.has(t.id) ? " · heard" : ""}`}
                onOpen={() => onPlay(t.id)}
              />
            ) : (
              <div key={t.id} className="sq-li sq-li-off" aria-disabled="true">
                <span className="sq-li-body">
                  <b>{`Week ${t.week} · ${t.title}`}</b>
                  <small>{t.unlocksLabel ?? "Opens later"}</small>
                </span>
              </div>
            ),
          )}
        </div>
      </SqCard>
      <SqCard title="Listening safely">
        <p className="sq-sub">{course.safety}</p>
      </SqCard>
    </>
  );
}

/** The course's own player or symptom check, over the Sequoya screens. */
export function SqCourseLayer({
  view,
  onClose,
  onOpenTrack,
}: {
  view: { k: "play"; id: string } | { k: "score" };
  onClose: () => void;
  onOpenTrack: (trackId: string) => void;
}) {
  return (
    <div className="sq-cg-host">
      <div className="ochre-app sequoya">
        <div className="overlay show">
          {view.k === "play" ? (
            <CoursePlayerOverlay key={view.id} trackId={view.id} onClose={onClose} onOpenTrack={onOpenTrack} />
          ) : (
            <CourseScoreOverlay onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
