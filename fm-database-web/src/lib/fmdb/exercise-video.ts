/**
 * Demonstration videos for the movements that stills cannot show.
 *
 * WHY ONLY SOME EXERCISES HAVE ONE. Two separate reasons, and it is worth
 * keeping them apart:
 *
 *   1. The image model has no 3D body. Axial rotation drawn from the front comes
 *      back as six near-identical figures, and a neck movement is too small to
 *      change a full-body silhouette at all.
 *   2. Some movements have too many stages for two poses to carry. The coach
 *      called these on review (2026-08-05): a burpee is stand, hinge, hands
 *      down, legs back, and back up — "too many movements to come correctly with
 *      single images" — and mountain climbers read as one still because both
 *      poses are the same plank.
 *
 * Everything else stays a traced two-pose figure, which is free to re-theme,
 * free to re-time, and does not cost the client bandwidth. Generated at 480p /
 * fast / no audio: these are flat two-tone line figures, so resolution buys
 * nothing and the clip costs 6 credits instead of 22.5.
 *
 * A FILE LIST, NOT A DIRECTORY SCAN. The client app renders on Fly from a read
 * replica, and a missing-file lookup on every session render would be a
 * filesystem hit per exercise for an answer that changes only when someone
 * commits a video. The list is checked against disk by exercise-video.test.ts,
 * so a typo or a deleted file fails a test rather than silently rendering a
 * broken player.
 *
 * `/exercise-videos/` is in the middleware public allowlist — without that
 * these 404 through the intake-only gate on Fly, which is exactly what happened
 * the first time they shipped.
 */

/** Exercise slug → file basename under public/exercise-videos/. */
const VIDEO_BY_SLUG: Record<string, string> = {
  "standing-trunk-rotation": "standing-trunk-rotation.mp4",
  "joint-mobilising-sequence": "joint-mobilising-sequence.mp4",
  // Both neck clips exist and are committed, but neck-mobility is chin
  // retraction ONLY — the side-bend clip has no entry to attach to until a
  // side-bend movement is authored. Attaching it here would show a client a
  // movement their plan does not prescribe.
  "neck-mobility": "neck-retraction.mp4",
  // Multi-stage movements, per the coach's review (2026-08-05).
  "burpee": "burpee.mp4",
  "squat-jumps": "squat-jumps.mp4",
  "mountain-climbers": "mountain-climbers.mp4",
  "cool-down-stretch-sequence": "cool-down-stretch-sequence.mp4",
  // NOT split-jumps. She asked for that one as a video too, and it was tried
  // twice: given a split-stance keyframe the model produces a RUNNING STRIDE
  // both times, and the second attempt was no closer than the first. Running
  // travels across the floor; a scissor skip is done on the spot, so shipping
  // it would show a client the wrong exercise. It keeps its traced pair, with
  // motion arrows carrying the foot exchange instead.
};

export function exerciseVideoSrc(slug: string): string | null {
  const file = VIDEO_BY_SLUG[slug];
  return file ? `/exercise-videos/${file}` : null;
}

/** Exposed for the test that pins this list against what is actually on disk. */
export const EXERCISE_VIDEO_FILES = VIDEO_BY_SLUG;
