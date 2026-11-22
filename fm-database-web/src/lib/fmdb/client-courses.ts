/**
 * Courses a programme client has been given in their own app (Sequoya shell).
 *
 *   client.yaml#courses:
 *     - slug: calm-gut
 *       started_on: '2026-11-22'
 *
 * The coach's per-client switch on the client overview (Shivani, 22 Nov 2026:
 * "build it into the Sequoya client app"). Free for a client in care; no
 * device limit, no refund, no course reminders (the client app has its own).
 * A course BUYER is a different thing entirely: a guided subscriber with
 * their own link (guided-tier.ts), never adopted into a client token.
 *
 * Listening data for a client is saved under clients/<id>/course-<slug>.json
 * (course-store.ts, owner id "client:<id>"). Projected to Fly by
 * app-staging-action.py _APP_CLIENT_KEYS, or the switch never reaches the app.
 */

import { getCourse } from "./courses";

export interface ClientCourseEntry {
  slug: string;
  started_on: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The entries on a client record, cleaned: known courses with a real date. */
export function clientCourses(doc: Record<string, unknown> | null | undefined): ClientCourseEntry[] {
  const raw = doc?.courses;
  if (!Array.isArray(raw)) return [];
  const out: ClientCourseEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const slug = (r as Record<string, unknown>).slug;
    const started = (r as Record<string, unknown>).started_on;
    if (typeof slug !== "string" || !getCourse(slug)) continue;
    if (typeof started !== "string" || !YMD.test(started)) continue;
    if (out.some((e) => e.slug === slug)) continue;
    out.push({ slug, started_on: started });
  }
  return out;
}

/** The day the client's course started, or null when it isn't on. */
export function clientCourseStart(doc: Record<string, unknown> | null | undefined, slug: string): string | null {
  return clientCourses(doc).find((e) => e.slug === slug)?.started_on ?? null;
}

/** The new `courses` value after the coach turns a course on or off. Turning
 *  on keeps an existing start date (pressing it twice never restarts week 1). */
export function withClientCourse(
  doc: Record<string, unknown>,
  slug: string,
  on: boolean,
  todayYmd: string,
): ClientCourseEntry[] {
  const rest = clientCourses(doc).filter((e) => e.slug !== slug);
  if (!on) return rest;
  const kept = clientCourseStart(doc, slug);
  return [...rest, { slug, started_on: kept ?? todayYmd }];
}

/** Record owner id for a client's course data (course-store.ts). */
export function clientCourseOwnerId(clientId: string): string {
  return `client:${clientId}`;
}
