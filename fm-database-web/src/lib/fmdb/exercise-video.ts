/**
 * Demonstration videos for the movements that stills cannot show.
 *
 * WHY ONLY A FEW EXERCISES HAVE ONE. The image model has no 3D body: axial
 * rotation drawn from the front comes back as six near-identical figures, and a
 * neck movement is too small to change a full-body silhouette at all. Those are
 * the cases where a video earns its 14 credits. Everything else is a traced
 * two-pose figure, which is free to re-theme, free to re-time, and does not cost
 * the client bandwidth.
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
};

export function exerciseVideoSrc(slug: string): string | null {
  const file = VIDEO_BY_SLUG[slug];
  return file ? `/exercise-videos/${file}` : null;
}

/** Exposed for the test that pins this list against what is actually on disk. */
export const EXERCISE_VIDEO_FILES = VIDEO_BY_SLUG;
