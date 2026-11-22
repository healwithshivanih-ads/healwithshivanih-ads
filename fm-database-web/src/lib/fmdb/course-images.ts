/**
 * The week photos for Calm Gut: her own photographs, one per session (plus
 * the daily, night and flare-up tracks), prepared by
 * scripts/course-images-prepare.mjs into public/ochre-app/calm-gut/.
 *
 * A track shows a photo only when its file exists, so the app looks right
 * before, during and after the photos arrive. Demo stand-ins (demo-<id>.jpg,
 * git-ignored) show only when COURSE_IMAGES_DEMO=1.
 */
import fs from "node:fs";
import path from "node:path";

export interface CourseImage {
  /** 1080×810, the Today card and the player. */
  wide: string;
  /** 512×512, the lock-screen picture (Media Session). */
  square: string;
}

/** The photo a track uses: an intro uses its session's, the short daily
 *  practice uses the daily one. */
export function photoIdFor(trackId: string): string {
  const intro = /^r(\d)$/.exec(trackId);
  if (intro) return `s${intro[1]}`;
  if (trackId === "daily-short") return "daily";
  return trackId;
}

function dir(): string {
  return path.join(process.cwd(), "public", "ochre-app", "calm-gut");
}

export function courseImage(
  trackId: string,
  env: Record<string, string | undefined> = process.env,
  root: string = dir(),
): CourseImage | null {
  const id = photoIdFor(trackId);
  const candidates = [id, ...(env.COURSE_IMAGES_DEMO === "1" ? [`demo-${id}`] : [])];
  for (const name of candidates) {
    const wide = path.join(root, `${name}.jpg`);
    const sq = path.join(root, `${name}-sq.jpg`);
    try {
      const v = Math.floor(fs.statSync(wide).mtimeMs / 1000);
      const hasSq = fs.existsSync(sq);
      return {
        wide: `/ochre-app/calm-gut/${name}.jpg?v=${v}`,
        square: hasSq ? `/ochre-app/calm-gut/${name}-sq.jpg?v=${v}` : `/ochre-app/calm-gut/${name}.jpg?v=${v}`,
      };
    } catch {
      /* not there: try the next, or no photo */
    }
  }
  return null;
}
